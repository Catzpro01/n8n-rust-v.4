/**
 * POOL-004 · Suite 06 — execution repository shaping + ExecutionPersistence.create
 * (execution.repository.ts + execution-persistence.ts pure layer).
 * A/B side runs against the pinned n8n-workflow@2.9.1 + flatted@3.2.7 in .runtime.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	MAX_UPDATE_BATCH_SIZE,
	handleExecutionRunData,
	reportInvalidExecutions,
	serializeAnnotation,
	shapeMultipleExecutions,
	shapeSingleExecution,
	splitUpdateExecutionPayload,
	toExecutionIdString,
	planMarkAsCrashed,
	planExecutionPersistenceCreate,
	UnexpectedError,
} from '../src/index.mjs';
import { flattedParse, flattedStringify, migrateRunExecutionData } from '../src/consumed.mjs';

const collectingReporter = () => {
	const calls = { error: [], info: [] };
	return {
		calls,
		error: (...args) => calls.error.push(args),
		info: (...args) => calls.info.push(args),
	};
};

// ---------------------------------------------------------------- fixtures
// Canonical n8n 2.9.x IRunExecutionDataV1 — FLAT root keys (no `.data` wrapper; that nesting
// is the pre-2.x shape). Verified against n8n-workflow@2.9.1 run-execution-data[-factory].d.ts:
// createEmptyRunExecutionData() === {version:1, resultData:{runData:{}}}.
function makeV1RunExecutionData() {
	return {
		version: 1,
		startData: {},
		resultData: {
			runData: {
				Start: [
					{
						hint: [],
						startTime: 1700000000000,
						executionIndex: 0,
						executionTime: 5,
						source: [],
						data: { main: [[{ json: { a: 1 }, pairedItem: { item: 0 } }]] },
					},
				],
			},
			lastNodeExecuted: 'Start',
		},
		executionData: {
			contextData: {},
			nodeExecutionStack: [],
			metadata: {},
			waitingExecution: {},
			waitingExecutionSource: null,
		},
	};
}

const makeExecutionRow = (over = {}) => ({
	id: '101',
	status: 'success',
	finished: true,
	mode: 'manual',
	workflowId: 'wf-1',
	createdAt: new Date(1700000000000),
	startedAt: new Date(1700000001000),
	stoppedAt: new Date(1700000002000),
	executionData: {
		data: flattedStringify(makeV1RunExecutionData()),
		workflowData: { id: 'wf-1', name: 'WF', nodes: [], connections: {} },
	},
	metadata: [
		{ key: 'k1', value: 'v1' },
		{ key: 'k2', value: 2 },
	],
	annotation: null,
	...over,
});

// ---------------------------------------------------------------- handleExecutionRunData
test('handleExecutionRunData: without unflattenData returns the wire string as-is', () => {
	const wire = flattedStringify(makeV1RunExecutionData());
	assert.equal(handleExecutionRunData(wire), wire);
	assert.equal(handleExecutionRunData(wire, {}), wire);
	assert.equal(handleExecutionRunData(wire, { unflattenData: false }), wire);
});

test('handleExecutionRunData: unflatten parses + migrates; v1 identity (A/B real dist)', () => {
	const v1 = makeV1RunExecutionData();
	const wire = flattedStringify(v1);

	const mine = handleExecutionRunData(wire, { unflattenData: true });
	const reference = migrateRunExecutionData(flattedParse(wire));

	assert.deepEqual(mine, reference);
	// Frozen truth (real dist): migrateRunExecutionData(v1) returns the SAME object.
	const parsed = flattedParse(wire);
	assert.equal(migrateRunExecutionData(parsed), parsed);
	assert.equal(mine.version, 1);
});

test('handleExecutionRunData: v0->v1 lift acts on startData.destinationNode/originalDestinationNode (A/B)', () => {
	// Evidence pin (real n8n-workflow@2.9.1 runExecutionDataV0ToV1):
	//  - conversion targets data.startData.destinationNode / originalDestinationNode (strings)
	//  - absent v0 fields become OWN keys with value `undefined`
	//  - untracked v0 fields (e.g. resultData.destinationExecutionData) are NOT converted
	//  - the v1 object is a NEW object; untouched nested refs (runData) stay shared
	const v0 = makeV1RunExecutionData();
	delete v0.version; // missing version means version 0
	v0.startData.destinationNode = 'StartAndEnd';
	v0.resultData.destinationExecutionData = 'LeftAsString'; // untracked sibling field
	const wire = flattedStringify(v0);

	const mine = handleExecutionRunData(wire, { unflattenData: true });
	const reference = migrateRunExecutionData(flattedParse(wire));

	assert.deepEqual(mine, reference);
	assert.equal(mine.version, 1);
	assert.deepEqual(mine.startData.destinationNode, {
		nodeName: 'StartAndEnd',
		mode: 'inclusive',
	});
	// originalDestinationNode was absent in v0 -> own key with undefined value
	assert.equal('originalDestinationNode' in mine.startData, true);
	assert.equal(mine.startData.originalDestinationNode, undefined);
	// unconverted sibling field stays a string (spread-through)
	assert.equal(mine.resultData.destinationExecutionData, 'LeftAsString');

	// no-destination v0: BOTH keys exist as own-undefined; resultData ref is shared (no deep copy)
	const v0Bare = flattedParse(flattedStringify((() => { const d = makeV1RunExecutionData(); delete d.version; return d; })()));
	const bare = migrateRunExecutionData(v0Bare);
	assert.equal(bare.startData.destinationNode, undefined);
	assert.equal('destinationNode' in bare.startData, true);
	assert.equal('originalDestinationNode' in bare.startData, true);
	assert.equal(bare.resultData, v0Bare.resultData); // untouched nested refs stay shared
});

test('handleExecutionRunData: JSON-primitive roots throw the raw flatted error (unwrapped on the DB path)', () => {
	// The reference's falsy-guard (`if (deserializedData)`) is defensive: with flatted@3.2.7
	// every JSON-primitive root already throws inside parse, so the throw propagates raw.
	assert.throws(() => handleExecutionRunData('null', { unflattenData: true }), /Cannot read properties of null/);
	assert.throws(() => handleExecutionRunData('0', { unflattenData: true }), /\.map is not a function/);
});

test('handleExecutionRunData: corrupt wire input throws raw (no wrapper on the DB path)', () => {
	assert.throws(() => handleExecutionRunData('[["a"', { unflattenData: true }));
});

// ---------------------------------------------------------------- reportInvalidExecutions
test('reportInvalidExecutions: silent for empty, UnexpectedError with executionIds otherwise', () => {
	const reporter = collectingReporter();
	reportInvalidExecutions([], reporter);
	assert.equal(reporter.calls.error.length, 0);

	reportInvalidExecutions([{ id: '7' }, { id: '8' }], reporter);
	assert.equal(reporter.calls.error.length, 1);
	const [err] = reporter.calls.error[0];
	assert.ok(err instanceof UnexpectedError);
	assert.equal(err.name, 'UnexpectedError');
	assert.equal(err.message, 'Found executions without executionData');
	assert.deepEqual(err.extra, { executionIds: ['7', '8'] });
});

// ---------------------------------------------------------------- serializeAnnotation
test('serializeAnnotation: null->null; picks only {id,name} from tags; missing tags -> []', () => {
	assert.equal(serializeAnnotation(null), null);
	assert.equal(serializeAnnotation(undefined), null);

	const ann = { id: 'a1', vote: 'up', tags: [{ id: 't1', name: 'bug', color: '#fff' }], extra: 'dropped' };
	assert.deepEqual(serializeAnnotation(ann), { id: 'a1', vote: 'up', tags: [{ id: 't1', name: 'bug' }] });
	assert.deepEqual(serializeAnnotation({ id: 'a2', vote: null }), { id: 'a2', vote: null, tags: [] });
	assert.deepEqual(serializeAnnotation({ id: 'a3', vote: 'down', tags: null }), {
		id: 'a3',
		vote: 'down',
		tags: [],
	});
});

// ---------------------------------------------------------------- shapeMultipleExecutions
test('shapeMultipleExecutions: includeData=false strips executionData from ALL rows, no report abort', () => {
	const reporter = collectingReporter();
	const rows = [makeExecutionRow(), makeExecutionRow({ id: '102', executionData: null })];
	const out = shapeMultipleExecutions(rows, {}, reporter);
	assert.equal(out.length, 2);
	for (const row of out) {
		assert.equal('executionData' in row, false);
		assert.equal('customData' in row, false);
	}
	// invalid row still reported (executionData === null)
	assert.equal(reporter.calls.error.length, 1);
	assert.deepEqual(reporter.calls.error[0][0].extra, { executionIds: ['102'] });
});

test('shapeMultipleExecutions: includeData=true maps only valid rows; customData + passthrough data', () => {
	const reporter = collectingReporter();
	const wire = flattedStringify(makeV1RunExecutionData());
	const rows = [
		makeExecutionRow({ id: '201', executionData: { data: wire, workflowData: { id: 'wf-1' } } }),
		makeExecutionRow({ id: '202', executionData: null }),
	];
	const out = shapeMultipleExecutions(rows, { includeData: true }, reporter);
	assert.equal(out.length, 1);
	assert.equal(out[0].id, '201');
	assert.equal(out[0].data, wire); // string passthrough (no unflattenData)
	assert.deepEqual(out[0].workflowData, { id: 'wf-1' });
	assert.deepEqual(out[0].customData, { k1: 'v1', k2: 2 });
});

test('shapeMultipleExecutions: unflattenData upgrades data to migrated object', () => {
	const wire = flattedStringify(makeV1RunExecutionData());
	const rows = [makeExecutionRow({ executionData: { data: wire, workflowData: {} } })];
	const out = shapeMultipleExecutions(rows, { includeData: true, unflattenData: true }, collectingReporter());
	assert.deepEqual(out[0].data, makeV1RunExecutionData());
});

// ---------------------------------------------------------------- shapeSingleExecution
test('shapeSingleExecution: findOne miss -> undefined', () => {
	assert.equal(shapeSingleExecution(null, { includeData: true }, collectingReporter()), undefined);
	assert.equal(shapeSingleExecution(undefined, {}, collectingReporter()), undefined);
});

test('shapeSingleExecution: anomaly report on success + "[]" data (reference L324-331)', () => {
	const reporter = collectingReporter();
	const row = makeExecutionRow({
		id: '301',
		status: 'success',
		annotation: null,
		executionData: { data: '[]', workflowData: { id: 'wf-9' } },
	});
	shapeSingleExecution(row, {}, reporter);
	assert.equal(reporter.calls.error.length, 1);
	const [message, opts] = reporter.calls.error[0];
	assert.equal(message, 'Found successful execution where data is empty stringified array');
	assert.deepEqual(opts.extra, { executionId: '301', workflowId: 'wf-9' });
});

test('shapeSingleExecution: includeData=false drops executionData but KEEPS raw annotation/metadata (reference quirk)', () => {
	const ann = { id: 'ann1', vote: 'up', tags: [{ id: 't', name: 'n', color: '#f00' }] };
	const row = makeExecutionRow({ status: 'error', annotation: ann });

	// Reference !includeData branch: `const { executionData, ...rest } = execution` — only
	// executionData is stripped; metadata AND the RAW entity annotation survive.
	const without = shapeSingleExecution(row, {}, collectingReporter());
	assert.equal('executionData' in without, false);
	assert.equal(without.annotation, ann); // raw entity form (tags NOT picked)
	assert.deepEqual(without.metadata, [
		{ key: 'k1', value: 'v1' },
		{ key: 'k2', value: 2 },
	]);

	// includeAnnotation merges the SERIALIZED annotation over the raw one.
	const withAnn = shapeSingleExecution(row, { includeAnnotation: true }, collectingReporter());
	assert.deepEqual(withAnn.annotation, { id: 'ann1', vote: 'up', tags: [{ id: 't', name: 'n' }] });

	// null annotation: serialized is null -> &&-chain contributes nothing -> raw null survives.
	const nullAnn = shapeSingleExecution(
		makeExecutionRow({ status: 'error', annotation: null }),
		{ includeAnnotation: true },
		collectingReporter(),
	);
	assert.equal('annotation' in nullAnn, true);
	assert.equal(nullAnn.annotation, null);
});

test('shapeSingleExecution: includeData=true assembles rest+data+workflowData+customData(+annotation)', () => {
	const wire = flattedStringify(makeV1RunExecutionData());
	const row = makeExecutionRow({
		status: 'error',
		annotation: { id: 'a', vote: 'down', tags: [] },
		executionData: { data: wire, workflowData: { id: 'wf-1', name: 'WF' } },
	});
	const out = shapeSingleExecution(row, { includeData: true, includeAnnotation: true }, collectingReporter());
	assert.equal(out.data, wire);
	assert.deepEqual(out.workflowData, { id: 'wf-1', name: 'WF' });
	assert.deepEqual(out.customData, { k1: 'v1', k2: 2 });
	assert.deepEqual(out.annotation, { id: 'a', vote: 'down', tags: [] });
	assert.equal(out.status, 'error');
});

// ---------------------------------------------------------------- splitUpdateExecutionPayload
test('splitUpdateExecutionPayload: protected keys never enter executionInformation', () => {
	const run = makeV1RunExecutionData();
	const { executionInformation, executionData } = splitUpdateExecutionPayload({
		id: '999',
		data: run,
		workflowId: 'wf-1',
		workflowData: { id: 'wf-1', name: 'W' },
		createdAt: new Date(1),
		startedAt: new Date(2),
		customData: { x: 1 },
		status: 'success',
		finished: true,
		stoppedAt: new Date(3),
		waitTill: null,
	});

	assert.deepEqual(Object.keys(executionInformation).sort(), ['finished', 'status', 'stoppedAt', 'waitTill']);
	assert.equal(flattedParse(executionData.data) === null, false); // parseable
	assert.deepEqual(flattedParse(executionData.data), run); // A/B: real flatted round-trip
	assert.deepEqual(executionData.workflowData, { id: 'wf-1', name: 'W' });
});

test('splitUpdateExecutionPayload: absent data/workflowData leave executionData empty', () => {
	const { executionData } = splitUpdateExecutionPayload({ id: '1', status: 'running' });
	assert.deepEqual(executionData, {});
});

// ---------------------------------------------------------------- toExecutionIdString
test('toExecutionIdString: String(identifiers[0].id)', () => {
	assert.equal(toExecutionIdString(42), '42');
	assert.equal(toExecutionIdString('42'), '42');
});

// ---------------------------------------------------------------- planMarkAsCrashed
test('planMarkAsCrashed: 900-row batches; reporter.info receives the FULL id list (quirk)', () => {
	const reporter = collectingReporter();
	const ids = Array.from({ length: 1901 }, (_, i) => String(i + 1));
	const fixedNow = new Date(1700000100000);
	const plan = planMarkAsCrashed(ids, { now: () => fixedNow, reporter });

	assert.equal(plan.length, 3);
	assert.deepEqual(
		plan.map((b) => b.where.id.values.length),
		[900, 900, 101],
	);
	assert.equal(MAX_UPDATE_BATCH_SIZE, 900);
	for (const batch of plan) {
		assert.equal(batch.where.id.operator, 'In');
		assert.deepEqual(batch.update, { status: 'crashed', stoppedAt: fixedNow });
	}
	assert.equal(reporter.calls.info.length, 3);
	assert.equal(reporter.calls.info[0][0], 'Marked executions as `crashed`');
	assert.equal(reporter.calls.info[0][1].executionIds.length, 1901); // NOT the batch — reference quirk
});

test('planMarkAsCrashed: single string id normalizes to one batch', () => {
	const plan = planMarkAsCrashed('77', { now: () => new Date(0), reporter: collectingReporter() });
	assert.equal(plan.length, 1);
	assert.deepEqual(plan[0].where.id.values, ['77']);
});

// ---------------------------------------------------------------- planExecutionPersistenceCreate
test('planExecutionPersistenceCreate (db mode): entity insert then ExecutionData insert — exact rows', () => {
	const now = new Date(1700000200000);
	const rawRunData = makeV1RunExecutionData();
	const plan = planExecutionPersistenceCreate(
		{
			data: rawRunData,
			workflowData: {
				id: 'wf-1',
				name: 'My WF',
				nodes: [{ id: 'n1' }],
				connections: { A: {} },
				settings: { executionOrder: 'v1' },
				versionId: 'ver-9',
				pinData: { Start: [{ json: {} }] }, // NOT part of the snapshot — must be dropped
				active: true, // NOT part of the snapshot either
			},
			mode: 'manual',
			startedAt: new Date(1700000190000),
			workflowId: 'wf-1',
			status: 'running',
		},
		{ modeTag: 'db', now: () => now },
	);

	assert.equal(plan.storedAt, 'db');
	assert.equal(plan.insert.entity, 'ExecutionEntity');
	assert.deepEqual(plan.insert.row, {
		mode: 'manual',
		startedAt: new Date(1700000190000),
		workflowId: 'wf-1',
		status: 'running',
		createdAt: now,
		storedAt: 'db',
	});

	const step2 = plan.onExecutionId('4242');
	assert.equal(step2.kind, 'insert');
	assert.equal(step2.entity, 'ExecutionData');
	assert.equal(step2.row.executionId, '4242');
	// WorkflowSnapshot = exactly {connections,nodes,name,settings,id} (pinData/active dropped)
	assert.deepEqual(step2.row.workflowData, {
		id: 'wf-1',
		name: 'My WF',
		nodes: [{ id: 'n1' }],
		connections: { A: {} },
		settings: { executionOrder: 'v1' },
	});
	assert.equal(step2.row.workflowVersionId, 'ver-9');
	// flatted round-trip A/B: stored blob parses back to the exact run data
	assert.deepEqual(flattedParse(step2.row.data), rawRunData);
});

test('planExecutionPersistenceCreate (fs mode): fs write plan; workflowVersionId null when absent', () => {
	const plan = planExecutionPersistenceCreate(
		{
			data: makeV1RunExecutionData(),
			workflowData: { id: 'wf-2', name: 'FS', nodes: [], connections: {}, settings: {} },
			mode: 'webhook',
		},
		{ modeTag: 'fs', now: () => new Date(1700000300000) },
	);

	assert.equal(plan.insert.row.storedAt, 'fs');
	const step2 = plan.onExecutionId('777');
	assert.deepEqual(step2, {
		kind: 'fs-write',
		ref: { workflowId: 'wf-2', executionId: '777' },
		payload: {
			data: flattedStringify(makeV1RunExecutionData()),
			workflowData: { id: 'wf-2', name: 'FS', nodes: [], connections: {}, settings: {} },
			workflowVersionId: null,
		},
	});
});
