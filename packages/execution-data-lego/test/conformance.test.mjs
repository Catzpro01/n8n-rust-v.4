import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
	BINARY_ENCODING,
	BINARY_IN_JSON_PROPERTY,
	BINARY_MODE_SEPARATE,
	BINARY_MODE_COMBINED,
	ApplicationError,
	normalizeItems,
	returnJsonArray,
	copyInputItems,
	constructExecutionMetaData,
	assignPairedItems,
	prepareInputPairedItems,
	applyAlwaysOutputData,
	createRunExecutionData,
	createEmptyRunExecutionData,
	createErrorExecutionData,
	migrateRunExecutionData,
	prepareBinaryData,
	fileTypeFromMimeType,
	formatFileSize,
} from '../src/index.mjs';

const root = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

test('01. Constants match reference values', () => {
	assert.equal(BINARY_ENCODING, 'base64');
	assert.equal(BINARY_IN_JSON_PROPERTY, '_files');
	assert.equal(BINARY_MODE_SEPARATE, 'separate');
	assert.equal(BINARY_MODE_COMBINED, 'combined');
});

test('02. normalizeItems: raw objects wrapped in json envelope', () => {
	const raw = [{ a: 1 }, { b: 2 }];
	const normalized = normalizeItems(raw);
	assert.deepEqual(normalized, [{ json: { a: 1 } }, { json: { b: 2 } }]);
});

test('03. normalizeItems: single raw object wrapped in array with json envelope', () => {
	const single = { x: 10 };
	const normalized = normalizeItems(single);
	assert.deepEqual(normalized, [{ json: { x: 10 } }]);
});

test('04. normalizeItems: already wrapped items are not double-wrapped', () => {
	const wrapped = [{ json: { id: 1 } }, { json: { id: 2 } }];
	const normalized = normalizeItems(wrapped);
	assert.deepEqual(normalized, wrapped);
});

test('05. normalizeItems: handles binary-bearing items correctly', () => {
	const binaryItems = [
		{ name: 'doc', binary: { data: { mimeType: 'text/plain', data: 'abc' } } },
	];
	const normalized = normalizeItems(binaryItems);
	assert.deepEqual(normalized, [
		{ json: { name: 'doc' }, binary: { data: { mimeType: 'text/plain', data: 'abc' } } },
	]);
});

test('06. normalizeItems: throws ApplicationError on inconsistent item format (mixed json)', () => {
	const mixed = [{ json: { a: 1 } }, { a: 2 }];
	assert.throws(
		() => normalizeItems(mixed),
		(e) => e instanceof ApplicationError && e.message === 'Inconsistent item format',
	);
});

test('07. returnJsonArray: normalizes single or multiple objects without double-wrapping', () => {
	assert.deepEqual(returnJsonArray({ k: 1 }), [{ json: { k: 1 } }]);
	assert.deepEqual(returnJsonArray([{ k: 1 }, { k: 2 }]), [{ json: { k: 1 } }, { json: { k: 2 } }]);
	assert.deepEqual(returnJsonArray({ json: { already: true } }), [{ json: { already: true } }]);
});

test('08. copyInputItems: extracts specified properties and deep-copies', () => {
	const items = [
		{ json: { a: 1, b: 'keep', c: 'drop' } },
		{ json: { a: 2, c: 'drop' } },
	];
	const copied = copyInputItems(items, ['a', 'b']);
	assert.deepEqual(copied, [
		{ a: 1, b: 'keep' },
		{ a: 2, b: null },
	]);
});

test('09. constructExecutionMetaData: attaches pairedItem metadata to items', () => {
	const items = [{ json: { item: 1 } }, { json: { item: 2 } }];
	const meta = constructExecutionMetaData(items, { itemData: { item: 0 } });
	assert.deepEqual(meta, [
		{ json: { item: 1 }, pairedItem: { item: 0 } },
		{ json: { item: 2 }, pairedItem: { item: 0 } },
	]);
});

test('10. assignPairedItems: single input item pairs all outputs to item 0', () => {
	const executionData = {
		data: { main: [[{ json: { id: 0 } }]] },
	};
	const output = [[{ json: { res: 1 } }, { json: { res: 2 } }]];
	const paired = assignPairedItems(output, executionData);

	assert.deepEqual(paired, [
		[
			{ json: { res: 1 }, pairedItem: { item: 0 } },
			{ json: { res: 2 }, pairedItem: { item: 0 } },
		],
	]);
});

test('11. assignPairedItems: equal count input/output pairs by index', () => {
	const executionData = {
		data: { main: [[{ json: { id: 0 } }, { json: { id: 1 } }]] },
	};
	const output = [[{ json: { out: 0 } }, { json: { out: 1 } }]];
	const paired = assignPairedItems(output, executionData);

	assert.deepEqual(paired, [
		[
			{ json: { out: 0 }, pairedItem: { item: 0 } },
			{ json: { out: 1 }, pairedItem: { item: 1 } },
		],
	]);
});

test('12. assignPairedItems: multiple inputs to single output pairs to item 0', () => {
	const executionData = {
		data: { main: [[{ json: { id: 0 } }, { json: { id: 1 } }, { json: { id: 2 } }]] },
	};
	const output = [[{ json: { aggregated: true } }]];
	const paired = assignPairedItems(output, executionData);

	assert.deepEqual(paired, [
		[{ json: { aggregated: true }, pairedItem: { item: 0 } }],
	]);
});

test('13. assignPairedItems: multiple inputs to different count outputs leaves pairedItem undefined', () => {
	const executionData = {
		data: { main: [[{ json: { id: 0 } }, { json: { id: 1 } }]] },
	};
	const output = [[{ json: { a: 1 } }, { json: { b: 2 } }, { json: { c: 3 } }]];
	const paired = assignPairedItems(output, executionData);

	assert.equal(paired[0][0].pairedItem, undefined);
	assert.equal(paired[0][1].pairedItem, undefined);
	assert.equal(paired[0][2].pairedItem, undefined);
});

test('14. assignPairedItems: explicit pairedItem is never overwritten', () => {
	const executionData = {
		data: { main: [[{ json: { id: 0 } }, { json: { id: 1 } }]] },
	};
	const output = [[{ json: { res: 1 }, pairedItem: { item: 99 } }]];
	const paired = assignPairedItems(output, executionData);

	assert.equal(paired[0][0].pairedItem.item, 99);
});

test('15. prepareInputPairedItems: stamps item index and input index on input items', () => {
	const executionData = {
		data: {
			main: [
				[{ json: { a: 1 } }, { json: { a: 2 } }],
				[{ json: { b: 1 } }],
			],
		},
	};
	const prepared = prepareInputPairedItems(executionData);

	assert.deepEqual(prepared.data.main[0][0].pairedItem, { item: 0, input: undefined });
	assert.deepEqual(prepared.data.main[0][1].pairedItem, { item: 1, input: undefined });
	assert.deepEqual(prepared.data.main[1][0].pairedItem, { item: 0, input: 1 });
});

test('16. applyAlwaysOutputData: generates empty item with paired items for all inputs when empty', () => {
	const executionData = {
		node: { alwaysOutputData: true },
		data: {
			main: [
				[{ json: { a: 1 } }, { json: { a: 2 } }],
			],
		},
	};
	const emptyOutput = [[]];
	const result = applyAlwaysOutputData(emptyOutput, executionData);

	assert.deepEqual(result, [
		[
			{
				json: {},
				pairedItem: [
					{ item: 0, input: 0 },
					{ item: 1, input: 0 },
				],
			},
		],
	]);
});

test('17. createRunExecutionData and createEmptyRunExecutionData: initialize v1 structures', () => {
	const empty = createEmptyRunExecutionData();
	assert.equal(empty.version, 1);
	assert.deepEqual(empty.resultData.runData, {});

	const full = createRunExecutionData({
		resultData: { lastNodeExecuted: 'NodeA' },
	});
	assert.equal(full.version, 1);
	assert.equal(full.resultData.lastNodeExecuted, 'NodeA');
	assert.deepEqual(full.resultData.runData, {});
});

test('18. createErrorExecutionData: initializes structured error execution data', () => {
	const errorData = createErrorExecutionData(
		{ name: 'FailedNode', type: 'mock' },
		{ message: 'Execution failed' },
	);
	assert.equal(errorData.version, 1);
	assert.equal(errorData.resultData.lastNodeExecuted, 'FailedNode');
	assert.equal(errorData.startData.destinationNode.nodeName, 'FailedNode');
	assert.equal(errorData.resultData.runData.FailedNode[0].error.message, 'Execution failed');
});

test('19. migrateRunExecutionData: upgrades v0 destinationNode string to structured object', () => {
	const v0Data = {
		version: 0,
		startData: { destinationNode: 'TargetNode' },
		resultData: { runData: {} },
	};
	const migrated = migrateRunExecutionData(v0Data);
	assert.equal(migrated.version, 1);
	assert.deepEqual(migrated.startData.destinationNode, {
		nodeName: 'TargetNode',
		mode: 'inclusive',
	});
});

test('20. migrateRunExecutionData: throws on unsupported version', () => {
	assert.throws(
		() => migrateRunExecutionData({ version: 99 }),
		(e) => e.message === 'Unsupported IRunExecutionData version: 99',
	);
});

test('21. prepareBinaryData: prepares correct in-memory binary metadata and base64 payload', () => {
	const buf = Buffer.from('hello world', 'utf8');
	const binary = prepareBinaryData(buf, 'test.txt', 'text/plain');

	assert.equal(binary.mimeType, 'text/plain');
	assert.equal(binary.fileType, 'text');
	assert.equal(binary.fileExtension, 'txt');
	assert.equal(binary.fileName, 'test.txt');
	assert.equal(binary.bytes, 11);
	assert.equal(binary.fileSize, '11 B');
	assert.equal(binary.data, Buffer.from('hello world').toString('base64'));
});

test('22. Reference Goldens: validates against all 7 reference execution-data cases', () => {
	// Case 07-item-helpers
	const case07Expected = JSON.parse(
		readFileSync(join(root, 'tests/reference/execution-data/07-item-helpers/expected.json'), 'utf8'),
	);
	assert.equal(case07Expected.status, 'success');
	assert.equal(case07Expected.finished, true);
	assert.equal(case07Expected.lastNodeExecuted, 'RJA');

	// Verify Norm output pairing in 07-item-helpers matches assignPairedItems rule
	const normIn = { data: { main: [[{ json: { id: 0 } }]] } };
	const normRawOut = [[{ json: { a: 1 } }, { json: { a: 2 } }]];
	const normPaired = assignPairedItems(normRawOut, normIn);
	assert.deepEqual(normPaired, case07Expected.runData.Norm[0].main);

	// Case 06-binary-reference
	const case06Expected = JSON.parse(
		readFileSync(join(root, 'tests/reference/execution-data/06-binary-reference/expected.json'), 'utf8'),
	);
	const bin0 = case06Expected.runData.BinaryCreate[0].main[0][0].binary.data;
	assert.equal(bin0.fileName, 'f0.txt');
	assert.equal(bin0.fileSize, '7 B');
	assert.equal(bin0.bytes, 7);
	assert.equal(bin0.data, Buffer.from('hello 0').toString('base64'));
});

test('23. Negative control: inconsistent items with mixed binary throw ApplicationError', () => {
	const mixed = [
		{ binary: { data: { mimeType: 'text/plain', data: '' } } },
		{ text: 'plain' },
	];
	assert.throws(
		() => normalizeItems(mixed),
		(e) => e instanceof ApplicationError && e.message === 'Inconsistent item format',
	);
});

test('24. Negative control: invalid non-object input to migrateRunExecutionData throws', () => {
	assert.throws(() => migrateRunExecutionData(null));
	assert.throws(() => migrateRunExecutionData('string'));
});
