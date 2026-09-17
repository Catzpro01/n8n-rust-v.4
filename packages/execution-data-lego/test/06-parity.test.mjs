/**
 * A/B PARITY SUITE — Execution Data LEGO vs the pinned reference runtime.
 *
 * Every assertion here diffs this reconstruction against the REAL n8n packages
 * (n8n-workflow@2.9.1 / n8n-core@2.9.1 == the n8n 2.9.4 dependency set) instead
 * of against a hand-written expectation, so a divergence in any frozen quirk
 * fails the build.
 *
 * The suite SKIPS (loudly) when the runtime is absent — it never reports a
 * false green.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ALLOW_NO_REFERENCE, SKIP_REASON, loadReference, paritySkip } from './helpers/reference.mjs';
import {
	constructExecutionMetaData,
	copyInputItems,
	createEmptyRunExecutionData,
	createErrorExecutionData,
	createRunExecutionData,
	deepCopy,
	fileTypeFromMimeType,
	migrateRunExecutionData,
	normalizeItems,
	prettyBytes,
	returnJsonArray,
	runExecutionDataV0ToV1,
} from '../src/index.mjs';

const ref = loadReference();
const skip = paritySkip(ref);

test('parity: A/B evidence requires the pinned reference runtime', () => {
	if (!ref) {
		if (ALLOW_NO_REFERENCE) return; // explicit opt-out: no A/B evidence, and no green claim
		assert.fail(
			`${SKIP_REASON}\n` +
				'A fully skipped parity suite exits 0 while running ZERO differential checks ' +
				'(.runtime is gitignored and excluded from workspace snapshots). Install the ' +
				'runtime, or opt out explicitly with LEGO_ALLOW_NO_REFERENCE=1.',
		);
	}
	assert.equal(ref.versions['n8n-workflow'], '2.9.1', 'n8n-workflow is not the pinned version');
	assert.equal(ref.versions['n8n-core'], '2.9.1', 'n8n-core is not the pinned version');
});

/**
 * Runs `fn` and captures either its value or a normalised error, so a corpus
 * that is expected to throw can be compared across both implementations.
 */
function outcome(fn) {
	try {
		return { value: fn() };
	} catch (error) {
		return {
			error: {
				name: error.constructor.name,
				message: error.message,
				level: error.level,
				tags: error.tags,
			},
		};
	}
}

const SIZES = [
	0, 1, 2, 7, 13, 99, 100, 512, 999, 1000, 1001, 1024, 1234, 9999, 10_000, 123_456, 999_999,
	1_000_000, 1_500_000, 12_345_678, 1_000_000_000, 1_099_511_627_776, 0.4, 0.04, -7, -1234,
];

const MIME_TYPES = [
	'application/json',
	'application/json; charset=utf-8',
	'text/html',
	'text/plain',
	'text/csv',
	'image/jpeg',
	'image/png',
	'image/gif',
	'audio/mpeg',
	'video/mp4',
	'application/javascript',
	'application/pdf',
	'application/zip',
	'application/xml',
	'application/octet-stream',
	'',
];

const DEEP_COPY_CORPUS = [
	1,
	'a',
	null,
	undefined,
	true,
	{},
	[],
	[{ a: 1 }, { b: [1, 2, { c: 3 }] }],
	{ a: { b: { c: { d: [1, 'two', null] } } } },
	{ when: new Date('2024-01-02T03:04:05.000Z') },
	{ n: 1, nested: { when: new Date(0) } },
	(function () {
		const cyclic = { name: 'root', list: [] };
		cyclic.self = cyclic;
		cyclic.list.push(cyclic, { back: cyclic });
		return cyclic;
	})(),
	(function () {
		const proto = { inherited: 1 };
		const obj = Object.create(proto);
		obj.own = 2;
		return obj;
	})(),
];

test('parity: deepCopy', { skip }, () => {
	DEEP_COPY_CORPUS.forEach((value, index) => {
		assert.deepStrictEqual(
			deepCopy(value),
			ref.workflow.deepCopy(value),
			`deepCopy corpus #${index}`,
		);
	});
});

test('parity: returnJsonArray', { skip }, () => {
	const corpus = [
		{ a: 1 },
		[{ a: 1 }],
		[{ a: 1 }, { a: 2 }],
		[{ json: { a: 1 } }],
		[{ json: null }],
		[{ json: '' }],
		[{ json: 0 }],
		[{ a: 1 }, { json: { b: 2 } }],
		[{ json: { a: 1 }, binary: { data: { mimeType: 'text/plain' } } }],
		[],
		[null, undefined],
	];
	for (const value of corpus) {
		assert.deepStrictEqual(returnJsonArray(value), ref.core.returnJsonArray(value), JSON.stringify(value));
	}
});

test('parity: normalizeItems', { skip }, () => {
	const binary = { data: { mimeType: 'text/plain' } };
	const corpus = [
		{ a: 1 },
		[{ a: 1 }, { a: 2 }],
		[{ json: { a: 1 } }],
		[{ json: null }],
		[{ a: 1, binary }],
		[{ a: 1, binary }, { b: 2, binary }],
		[{ json: { a: 1 } }],
		['a', 1],
		[null],
		[],
	];
	for (const value of corpus) {
		// H-06: `null` members throw a TypeError in BOTH implementations — the
		// outcome comparison pins that instead of hiding it.
		assert.deepStrictEqual(
			outcome(() => normalizeItems(value)),
			outcome(() => ref.core.normalizeItems(value)),
			`normalizeItems(${JSON.stringify(value)})`,
		);
	}

	for (const value of [[{ json: { a: 1 } }, { b: 2 }], [{ a: 1, binary }, { b: 2 }]]) {
		let mine;
		let theirs;
		try {
			normalizeItems(value);
		} catch (error) {
			mine = error;
		}
		try {
			ref.core.normalizeItems(value);
		} catch (error) {
			theirs = error;
		}
		assert.ok(mine && theirs, 'both must throw on an inconsistent item format');
		assert.equal(mine.message, theirs.message);
		assert.equal(mine.level, theirs.level);
		assert.deepStrictEqual(mine.tags, theirs.tags);
		assert.equal(mine.extra, theirs.extra);
	}
});

test('parity: constructExecutionMetaData', { skip }, () => {
	// The third input pins H-07: an item that ALREADY carries a pairedItem keeps
	// its own value, because `...rest` is spread after `pairedItem: itemData`.
	const inputs = [
		[{ json: { a: 1 } }],
		[{ json: { a: 1 } }, { json: { a: 2 } }],
		[{ json: { a: 1 }, pairedItem: { item: 9 }, binary: { x: 1 } }],
		[{ json: { a: 1 }, pairedItem: [{ item: 0, input: 1 }] }],
		[],
	];
	const options = [{ itemData: { item: 0 } }, { itemData: [{ item: 0 }, { item: 1 }] }];
	for (const input of inputs) {
		for (const option of options) {
			assert.deepStrictEqual(
				constructExecutionMetaData(input, option),
				ref.core.constructExecutionMetaData(input, option),
				`${JSON.stringify(input)} / ${JSON.stringify(option)}`,
			);
		}
	}
});

test('parity: copyInputItems', { skip }, () => {
	const copyInputItemsRef = ref.coreUtil('copy-input-items').copyInputItems;
	const items = [
		{ json: { a: 1, b: { c: 2 } } },
		{ json: { a: new Date('2024-01-01T00:00:00.000Z'), b: [1, 2] } },
		{ json: {} },
	];
	for (const properties of [['a'], ['a', 'b'], ['a', 'missing'], []]) {
		assert.deepStrictEqual(
			copyInputItems(items, properties),
			copyInputItemsRef(items, properties),
			`properties ${JSON.stringify(properties)}`,
		);
	}
});

test('parity: IRunExecutionData factories', { skip }, () => {
	const optionSets = [
		undefined,
		{},
		{ resultData: { runData: null }, executionData: null },
		{ resultData: {}, executionData: {} },
		{ startData: { runNodeFilter: ['A'] }, resultData: { lastNodeExecuted: 'A' } },
		{ executionData: { nodeExecutionStack: [{ node: { name: 'A' }, data: {}, source: null }] } },
	];
	for (const options of optionSets) {
		assert.deepStrictEqual(
			createRunExecutionData(options),
			ref.workflow.createRunExecutionData(options),
			`createRunExecutionData(${JSON.stringify(options)})`,
		);
	}

	assert.deepStrictEqual(
		createEmptyRunExecutionData(),
		ref.workflow.createEmptyRunExecutionData(),
	);

	const node = { name: 'Boom', type: 'ref.boom', typeVersion: 1, parameters: {} };
	const error = { message: 'nope', name: 'NodeOperationError' };
	assert.deepStrictEqual(
		createErrorExecutionData(node, error),
		ref.workflow.createErrorExecutionData(node, error),
	);
});

test('parity: run execution data migration', { skip }, () => {
	const { runExecutionDataV0ToV1: refLift } = ref.workflowModule('run-execution-data/run-execution-data.v1');
	const { migrateRunExecutionData: refMigrate } = ref.workflowModule('run-execution-data/run-execution-data');

	const corpus = [
		{ resultData: { runData: {} } },
		{ version: 0, resultData: { runData: {} } },
		{ version: 0, startData: { destinationNode: 'A' }, resultData: { runData: {} } },
		{
			version: 0,
			startData: { destinationNode: 'A', originalDestinationNode: 'B', runNodeFilter: ['A'] },
			resultData: { runData: {} },
		},
		{ version: 1, startData: {}, resultData: { runData: {} } },
	];

	for (const value of corpus) {
		assert.deepStrictEqual(
			runExecutionDataV0ToV1(value),
			refLift(value),
			`runExecutionDataV0ToV1(${JSON.stringify(value)})`,
		);
		assert.deepStrictEqual(
			migrateRunExecutionData(value),
			refMigrate(value),
			`migrateRunExecutionData(${JSON.stringify(value)})`,
		);
	}

	for (const version of [2, 99]) {
		const value = { version, resultData: { runData: {} } };
		let mine;
		let theirs;
		try {
			migrateRunExecutionData(value);
		} catch (error) {
			mine = error;
		}
		try {
			refMigrate(value);
		} catch (error) {
			theirs = error;
		}
		assert.ok(mine && theirs, 'both must reject an unsupported version');
		assert.equal(mine.message, theirs.message);
		assert.equal(mine instanceof Error, theirs instanceof Error);
	}
});

test('parity: fileTypeFromMimeType', { skip }, () => {
	for (const mimeType of MIME_TYPES) {
		assert.strictEqual(
			fileTypeFromMimeType(mimeType),
			ref.workflow.fileTypeFromMimeType(mimeType),
			mimeType,
		);
	}
});

test('parity: prettyBytes', { skip }, () => {
	for (const size of SIZES) {
		assert.strictEqual(prettyBytes(size), ref.prettyBytes(size), `prettyBytes(${size})`);
	}
});
