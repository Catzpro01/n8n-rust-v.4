/**
 * Gate 03 — run-execution-data + execution metadata.
 *
 * These two modules are the floor everything else in the port stands on, and they
 * are where an "obviously better" implementation is most tempting: a migration
 * that also normalises nulls, a metadata setter that throws instead of silently
 * dropping the 11th key. Every such improvement changes what n8n stores or what a
 * workflow sees, so each quirk below is asserted as behaviour, not style.
 *
 * Offline: my module vs the recorded expectations. Live: the same inputs fed to the
 * reference functions, compared with the shared serializer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import {
	createEmptyRunExecutionData,
	createErrorExecutionData,
	createRunExecutionData,
	getContext,
	migrateRunExecutionData,
	runExecutionDataV0ToV1,
} from '../src/run-execution-data.mjs';
import {
	KV_LIMIT,
	InvalidExecutionMetadataError,
	getAllWorkflowExecutionMetadata,
	getWorkflowExecutionMetadata,
	setAllWorkflowExecutionMetadata,
	setWorkflowExecutionMetadata,
} from '../src/execution-metadata.mjs';
import { ApplicationError } from '../src/errors.mjs';
import { referenceRuntime } from '../src/reference-runtime.mjs';
import { setLogger } from '../src/execution-metadata.mjs';
import { serialize } from './helpers/serialize.mjs';

// The reference writes the truncation warnings through the injected logger; the port
// exposes a sink so the "warns at 255, cuts at 512" mismatch is observable.
const log = { last: null };
const logSink = {
	error(message) {
		log.last = message;
	},
};
const runtime = referenceRuntime();
const req = runtime ? createRequire(join(runtime.dir, 'noop.js')) : null;
const refRed = runtime
	? req(join(runtime.dir, 'n8n-workflow/dist/cjs/run-execution-data/run-execution-data.js'))
	: null;
const refFactory = runtime
	? req(join(runtime.dir, 'n8n-workflow/dist/cjs/run-execution-data-factory.js'))
	: null;
const refMeta = runtime
	? req(
			join(
				runtime.dir,
				'n8n-core/dist/execution-engine/node-execution-context/utils/execution-metadata.js',
			),
		)
	: null;

// ---------------------------------------------------------------- migration
test('migrateRunExecutionData: v0 startData.destinationNode is rewritten, the stack is NOT', () => {
	const v0 = {
		version: 0,
		data: {
			resultData: { runData: {}, lastNodeExecuted: 'Set' },
			executionData: {
				contextData: {},
				nodeExecutionStack: [
					{
						node: { name: 'Set' },
						data: {},
						source: null,
						destinationNode: 'Set',
						executionFilter: { skipNodes: [], onlyNodes: ['Set'] },
					},
				],
				metadata: {},
				waitingExecution: {},
				waitingExecutionSource: {},
			},
		},
		mode: 'manual',
		startData: {
			destinationNode: 'Set',
			executionFilter: { skipNodes: [], onlyNodes: ['Set'] },
		},
	};
	const out = migrateRunExecutionData(structuredClone(v0));
	assert.equal(out.version, 1);
	assert.deepEqual(out.startData.destinationNode, { nodeName: 'Set', mode: 'inclusive' });
	// Two things a "cleaner" migration would get wrong, both verified against the
	// reference: (1) `originalDestinationNode` is DESTRUCTURED AND REASSIGNED to
	// undefined, so the key KEEPS EXISTING — `delete` would be a deviation; (2) only
	// `startData` is rewritten; the entries inside `nodeExecutionStack` keep the bare
	// v0 string form, because the stack is rebuilt from scratch on resume.
	assert.equal('originalDestinationNode' in out.startData, true);
	assert.equal(out.startData.originalDestinationNode, undefined);
	assert.equal(out.data.executionData.nodeExecutionStack[0].destinationNode, 'Set');
	assert.deepEqual(out.startData.executionFilter, { skipNodes: [], onlyNodes: ['Set'] });
});

test('migrateRunExecutionData: an empty startData gains both undefined keys', () => {
	const out = migrateRunExecutionData({
		version: 0,
		data: { resultData: { runData: {} }, executionData: { contextData: {}, nodeExecutionStack: [] } },
		mode: 'Manual',
		startData: {},
	});
	// `destinationNode`/`originalDestinationNode` are *assigned* (to undefined) even
	// when the source key was absent, so `in` is true and the serialized payload
	// carries the keys. Downstream code does `'destinationNode' in startData`.
	assert.deepEqual(Object.keys(out.startData).sort(), ['destinationNode', 'originalDestinationNode']);
	assert.equal(out.mode, 'Manual', 'mode is copied through verbatim, casing included');
});

test('migrateRunExecutionData: v1 is passed through unchanged', () => {
	const v1 = createRunExecutionData({ resultData: { runData: { A: [] } } });
	const before = serialize(v1);
	migrateRunExecutionData(v1);
	assert.equal(serialize(v1), before);
});

test('migrateRunExecutionData: unsupported versions throw the reference message', () => {
	for (const version of [2, 7, '1', null, false]) {
		assert.throws(
			() => migrateRunExecutionData({ version, data: {}, mode: 'manual' }),
			(err) => {
				assert.ok(
					err instanceof Error && !(err instanceof ApplicationError),
					`version ${JSON.stringify(version)} must raise a plain Error, got ${err.constructor.name}`,
				);
				assert.equal(err.message, `Unsupported IRunExecutionData version: ${version}`);
				return true;
			},
			`version ${JSON.stringify(version)}`,
		);
	}
});

test('runExecutionDataV0ToV1: the exported helper is the same rewrite', () => {
	const out = runExecutionDataV0ToV1({
		startData: { destinationNode: 'A' },
		data: { executionData: { nodeExecutionStack: [{ node: { name: 'A' }, destinationNode: 'A' }] } },
	});
	assert.deepEqual(out.startData.destinationNode, { nodeName: 'A', mode: 'inclusive' });
});

// ---------------------------------------------------------------- factory
test('createRunExecutionData: every optional field is present-and-undefined, not absent', () => {
	const fresh = createRunExecutionData({});
	// The reference builds the object with explicit `undefined` values for all the
	// optional slots, which means `Object.keys()` is a fixed list. A port that omits
	// them changes what gets persisted and what `in` checks answer.
	assert.deepEqual(
		Object.keys(fresh).sort(),
		[
			'executionData',
			'manualData',
			'parentExecution',
			'pushRef',
			'resultData',
			'startData',
			'validateSignature',
			'version',
			'waitTill',
		],
		'the factory must return exactly these keys — the persisted payload shape is part of the contract',
	);
	assert.deepEqual(fresh.startData, {});
	assert.deepEqual(fresh.data ?? undefined, undefined, 'the factory returns startData/resultData/executionData at top level');
	const withNull = createRunExecutionData({ startData: null });
	assert.deepEqual(withNull.startData, {}, 'null startData yields {} — same as undefined, by way of a different branch');
	const withManual = createRunExecutionData({
		mode: 'manual',
		startData: { destinationNode: 'X' },
		manualData: { activateWorkflowDatamode: 'shared' },
	});
	assert.deepEqual(withManual.startData, { destinationNode: 'X' });
	assert.deepEqual(withManual.manualData, { activateWorkflowDatamode: 'shared' });
	assert.equal(withManual.version, 1);
	// CAT-752: waitingExecutionSource defaults to {} so a resumed run never sees undefined.
	assert.deepEqual(withManual.executionData.waitingExecutionSource, {});
	assert.deepEqual(withManual.executionData.contextData, {});
	assert.deepEqual(withManual.resultData.runData, {});
});

test('createEmptyRunExecutionData: the minimal shape downstream code depends on', () => {
	const empty = createEmptyRunExecutionData();
	assert.deepEqual(Object.keys(empty).sort(), ['resultData', 'version']);
	assert.deepEqual(empty, { version: 1, resultData: { runData: {} } });
});

test('createErrorExecutionData: an error run is a full IRunExecutionData, not a fragment', () => {
	const error = new Error('bad');
	const node = { id: 'n', name: 'Failing', type: 't', typeVersion: 1 };
	const out = createErrorExecutionData(node, error);
	// The reference returns a *run payload*: startData + executionData + resultData.
	// Anything shaped like `{destinationNode, stack}` would be rejected by the queue.
	assert.equal(out.version, 1);
	assert.deepEqual(out.startData.destinationNode, { nodeName: 'Failing', mode: 'inclusive' });
	assert.deepEqual(out.startData.runNodeFilter, ['Failing']);
	assert.deepEqual(out.executionData.nodeExecutionStack, [
		{
			node,
			data: { main: [[{ json: {}, pairedItem: { item: 0 } }]] },
			source: null,
		},
	]);
	assert.deepEqual(out.executionData.contextData, {});
	assert.deepEqual(out.executionData.waitingExecution, {});
	assert.deepEqual(out.executionData.waitingExecutionSource, {});
	assert.deepEqual(out.resultData.lastNodeExecuted, 'Failing');
	assert.equal(out.resultData.error, error);
	assert.deepEqual(Object.keys(out.resultData.runData), ['Failing']);
	const [run] = out.resultData.runData.Failing;
	assert.deepEqual(
		{ startTime: run.startTime, executionIndex: run.executionIndex, executionTime: run.executionTime, source: run.source },
		{ startTime: 0, executionIndex: 0, executionTime: 0, source: [] },
	);
	assert.equal(run.error, error);
});

// ---------------------------------------------------------------- getContext
test('getContext: create-on-read, and the mutation is visible to the caller', () => {
	const red = createRunExecutionData({});
	const ctx = getContext(red, 'node', { name: 'A' });
	ctx.seen = 1;
	assert.deepEqual(red.executionData.contextData['node:A'], { seen: 1 }, 'must be the SAME object, not a copy');
	assert.equal(getContext(red, 'node', { name: 'A' }).seen, 1);
	assert.deepEqual(getContext(red, 'flow'), red.executionData.contextData.flow = {}, 'flow key is created too');
});

test('getContext: the three error paths, with the reference wording', () => {
	assert.throws(() => getContext({}, 'node', { name: 'A' }), /`executionData` is not initialized/);
	assert.throws(
		() => getContext(createRunExecutionData({}), 'node'),
		/The request data of context type "node" the node parameter has to be set!/,
	);
	// "Only `flow` and `node` are supported" — and note the *other* message with the
	// same prefix in Workflow.getStaticData ("Only `global` and `node`"). Both exist;
	// neither is a typo to be unified.
	assert.throws(
		() => getContext(createRunExecutionData({}), 'nonsense', { name: 'A' }),
		/Unknown context type\. Only `flow` and `node` are supported\./,
	);
});

// ---------------------------------------------------------------- metadata
test('execution metadata: the bag lives on resultData, and 10 keys is a silent cap', () => {
	const mk = () => ({ resultData: {} });
	const bag = mk();
	for (let i = 0; i < 13; i++) setWorkflowExecutionMetadata(bag, `k${i}`, `v${i}`);
	const all = getAllWorkflowExecutionMetadata(bag);
	assert.equal(Object.keys(all).length, KV_LIMIT);
	assert.equal(all.k0, 'v0');
	assert.equal(all.k10, undefined, 'over-limit writes are ignored — no throw, no overwrite');
	// The guard only applies to NEW keys: updating an existing one past the limit works.
	setWorkflowExecutionMetadata(bag, 'k0', 'updated');
	assert.equal(getWorkflowExecutionMetadata(bag, 'k0'), 'updated');
	// Reading through the copy does not touch the run data.
	all.k0 = 'mutated';
	assert.equal(bag.resultData.metadata.k0, 'updated');
	assert.deepEqual(getAllWorkflowExecutionMetadata({ resultData: {} }), {});
	assert.equal(getWorkflowExecutionMetadata({ resultData: {} }, 'a'), undefined);
});

test('execution metadata: keys/values are truncated to 50/512, and only >255 warns', () => {
	const bag = { resultData: {} };
	setWorkflowExecutionMetadata(bag, 'k'.repeat(80), 'x'.repeat(600));
	const [key, value] = Object.entries(getAllWorkflowExecutionMetadata(bag))[0];
	assert.equal(key.length, 50);
	assert.equal(value.length, 512);
	// The reference compares the VALUE against 255 but cuts at 512: a value of
	// 256-512 chars is neither warned about nor cut. Pinned so nobody "fixes" it.
	setLogger(logSink);
	setWorkflowExecutionMetadata({ resultData: {} }, 'a', 'y'.repeat(300));
	assert.match(log.last, /over 512 characters/);
	log.last = null;
	setWorkflowExecutionMetadata({ resultData: {} }, 'a', 'y'.repeat(200));
	assert.equal(log.last, null, 'a 200-char value must not log');
	setWorkflowExecutionMetadata({ resultData: {} }, 'z'.repeat(60), 'short');
	assert.match(log.last, /over 50 characters/);
	setLogger(undefined);
});

test('execution metadata: value types are validated per key, and partial writes survive', () => {
	const bag = { resultData: {} };
	// numbers and bigints are coerced with String(), not rejected.
	setWorkflowExecutionMetadata(bag, 'num', 7);
	setWorkflowExecutionMetadata(bag, 'big', 9007199254740993n);
	assert.deepEqual(getAllWorkflowExecutionMetadata(bag), { num: '7', big: '9007199254740993' });
	assert.throws(
		() => setWorkflowExecutionMetadata(bag, 'obj', { nested: true }),
		(err) => {
			assert.ok(err instanceof InvalidExecutionMetadataError, `got ${err.constructor.name}`);
			assert.ok(err instanceof ApplicationError);
			assert.equal(err.message, 'Custom data values must be a string (key "obj")');
			assert.equal(err.type, 'value');
			return true;
		},
	);
	// The key charset check has its own message — including the reference's typo,
	// "Custom date key", which users see in the UI.
	assert.throws(
		() => setWorkflowExecutionMetadata(bag, 'bad-key', 'x'),
		(err) => {
			assert.equal(err.message, 'Custom date key can only contain characters "A-Za-z0-9_" (key "bad-key")');
			assert.equal(err.type, 'key');
			return true;
		},
	);
	// setAll validates PER KEY and keeps what already succeeded, then rethrows the
	// first error. "Validate the whole object first" would be a cleaner design and a
	// wrong port.
	const bag2 = { resultData: {} };
	assert.throws(
		() => setAllWorkflowExecutionMetadata(bag2, { a: 'ok', b: { nested: true } }),
		InvalidExecutionMetadataError,
	);
	assert.deepEqual(getAllWorkflowExecutionMetadata(bag2), { a: 'ok' });
});

// ---------------------------------------------------------------- live parity
test('live: the reference functions produce the identical structures', async (t) => {
	if (!runtime) {
		t.diagnostic('reference runtime not installed — live parity not run');
		return;
	}
	assert.ok(refRed && refFactory, 'expected the reference run-execution-data modules to resolve');
	const diffs = [];
	const cmp = (label, mineValue, refValue) => {
		const a = serialize(mineValue);
		const b = serialize(refValue);
		if (a !== b) diffs.push(`${label}\n    reference:      ${b}\n    reconstruction: ${a}`);
	};

	const v0 = {
		version: 0,
		data: {
			resultData: { runData: {} },
			executionData: { contextData: {}, nodeExecutionStack: [{ node: { name: 'S' }, destinationNode: 'S' }] },
		},
		mode: 'manual',
		startData: { destinationNode: 'S' },
	};
	cmp('migrate v0', migrateRunExecutionData(structuredClone(v0)), refRed.migrateRunExecutionData(structuredClone(v0)));
	for (const version of [2, '1', null]) {
		const thrown = attempt(() => migrateRunExecutionData({ version, data: {}, mode: 'manual' }));
		const refThrown = attempt(() => refRed.migrateRunExecutionData({ version, data: {}, mode: 'manual' }));
		cmp(`migrate bad version ${version}`, thrown, refThrown);
	}
	for (const opts of [
		{},
		{ startData: null },
		{ startData: { destinationNode: 'A' } },
		{ mode: 'manual', startData: { destinationNode: 'A' }, manualData: { x: 1 } },
	]) {
		cmp(`createRunExecutionData ${JSON.stringify(opts)}`, createRunExecutionData(structuredClone(opts)), refFactory.createRunExecutionData(structuredClone(opts)));
	}
	cmp('createEmpty', createEmptyRunExecutionData(), refFactory.createEmptyRunExecutionData());
	const err = new Error('bad');
	const node = { id: 'n', name: 'Failing', type: 't', typeVersion: 1 };
	cmp(
		'createErrorExecutionData',
		captureShape(() => createErrorExecutionData(node, err)),
		captureShape(() => refFactory.createErrorExecutionData(node, err)),
	);

	// metadata: reference helpers take (executionData, ...) with a logger injected
	for (const [label, run] of [
		['over-limit', (f) => { for (let i = 0; i < 13; i++) f(`k${i}`, `v${i}`); }],
		['truncation', (f) => f('k'.repeat(80), 'x'.repeat(600))],
	]) {
		const mineBag = { metadata: {} };
		const refBag = { metadata: {} };
		run((k, v) => {
			try {
				setWorkflowExecutionMetadata(mineBag, k, v);
			} catch (e) {
				mineBag.error = e.message;
			}
			try {
				refMeta.setWorkflowExecutionMetadata(refBag, k, v);
			} catch (e) {
				refBag.error = e.message;
			}
		});
		cmp(`metadata ${label}`, mineBag, refBag);
	}

	assert.deepEqual(diffs, [], 'run-execution-data / execution-metadata drifted from the reference');
});

function attempt(fn) {
	try {
		return { ok: true, value: fn() };
	} catch (error) {
		return { ok: false, error: { name: error.name, message: error.message, level: error.level, extra: error.extra } };
	}
}

/** createErrorExecutionData stamps Date.now() into the run data on some versions. */
function captureShape(fn) {
	const out = fn();
	if (out?.stack?.main?.[0]?.[0]?.node) out.stack.main[0][0].node = out.stack.main[0][0].node.name;
	return out;
}
