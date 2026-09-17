/**
 * REFERENCE FIXTURE SUITE — the reconstructed rules replayed against the
 * engine recordings in tests/reference/execution-data/*.
 *
 * Two kinds of assertion:
 *  1. CONFORMANCE  — every recorded run data satisfies the envelope,
 *     source-shape and binary-representation invariants of the contract.
 *  2. REPLAY       — for the fixtures whose node transform is documented in the
 *     fixture README, the rules of this LEGO reproduce the recorded
 *     `pairedItem` sequence exactly (no engine involved).
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
	alwaysOutputDataItem,
	assignPairedItems,
	buildSourceData,
	checkBinaryRepresentation,
	returnJsonArray,
	normalizeItems,
} from '../src/index.mjs';

const FIXTURES = path.resolve(import.meta.dirname, '../../../tests/reference/execution-data');

function loadFixture(name) {
	const dir = path.join(FIXTURES, name);
	return {
		name,
		readme: readFileSync(path.join(dir, 'README.md'), 'utf8'),
		case: JSON.parse(readFileSync(path.join(dir, 'case.json'), 'utf8')),
		expected: JSON.parse(readFileSync(path.join(dir, 'expected.json'), 'utf8')),
	};
}

const ALL = readdirSync(FIXTURES, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => loadFixture(entry.name))
	.sort((a, b) => a.name.localeCompare(b.name));

const taskOf = (runData, nodeName) => runData[nodeName][0];
const branch0 = (nodeName, fixture) => taskOf(fixture.expected.runData, nodeName).main[0];
const pairsOf = (items) => items.map((item) => item.pairedItem ?? null);
const stripPairs = (items) => items.map(({ pairedItem, ...rest }) => rest);

/**
 * Run the engine's assign step the way WorkflowExecute does and return the
 * resulting `pairedItem` sequence of the first output branch.
 */
function assign(output, inputItems) {
	const branches = assignPairedItems([output], { data: { main: [inputItems] } });
	return pairsOf(branches?.[0]);
}

test('every fixture directory carries a case + expected pair', () => {
	assert.ok(ALL.length >= 7, `expected the 7 execution-data fixtures, found ${ALL.length}`);
	for (const fixture of ALL) {
		assert.ok(fixture.case.workflow?.nodes?.length, `${fixture.name}: no workflow nodes`);
		assert.ok(fixture.expected.runData, `${fixture.name}: no runData`);
	}
});

test('I1/I2: every recorded item carries a json object', () => {
	for (const fixture of ALL) {
		for (const [nodeName, runs] of Object.entries(fixture.expected.runData)) {
			for (const [runIndex, task] of runs.entries()) {
				assert.equal(task.executionStatus, 'success', `${fixture.name}/${nodeName}[${runIndex}]`);
				for (const branch of task.main) {
					for (const [itemIndex, item] of (branch ?? []).entries()) {
						assert.equal(
							typeof item.json,
							'object',
							`${fixture.name}/${nodeName}[${runIndex}].main[][${itemIndex}] has no json`,
						);
						assert.notEqual(item.json, null);
					}
				}
			}
		}
	}
});

test('I6/I7: recorded source entries match buildSourceData exactly', () => {
	for (const fixture of ALL) {
		for (const [nodeName, runs] of Object.entries(fixture.expected.runData)) {
			for (const task of runs) {
				for (const source of task.source ?? []) {
					assert.deepEqual(
						source,
						buildSourceData({
							previousNode: source.previousNode,
							previousNodeOutput: source.previousNodeOutput,
							previousNodeRun: source.previousNodeRun,
						}),
						`${fixture.name}/${nodeName}`,
					);
					assert.equal(typeof source.previousNode, 'string', 'I14: references are by NAME');
				}
			}
		}
	}
});

test('I14: runData is keyed by node name, never by id', () => {
	for (const fixture of ALL) {
		const names = new Set(fixture.case.workflow.nodes.map((node) => node.name));
		const ids = new Set(fixture.case.workflow.nodes.map((node) => node.id));
		for (const nodeName of Object.keys(fixture.expected.runData)) {
			assert.ok(
				names.has(nodeName),
				`${fixture.name}: "${nodeName}" is not a node name (ids: ${[...ids].join(', ')})`,
			);
		}
	}
});

test('I10: fixture 06 binary data is inline base64 with full metadata and no id', () => {
	const fixture = loadFixture('06-binary-reference');
	const items = branch0('BinaryCreate', fixture);
	assert.ok(items.length > 0);

	for (const item of items) {
		for (const binary of Object.values(item.binary ?? {})) {
			assert.deepEqual(checkBinaryRepresentation(binary, 'default'), {
				ok: true,
				errors: [],
			});
			assert.equal(binary.mimeType, 'text/plain');
			assert.equal(binary.fileType, 'text');
			assert.equal(binary.fileExtension, 'txt');
			assert.equal(typeof binary.fileName, 'string');
			assert.equal(binary.fileSize, '7 B');
			assert.equal(binary.bytes, 7);
			assert.equal(Buffer.from(binary.data, 'base64').toString(), `hello ${item.json.i}`);
		}
	}
});

test('03-item-pairing replay: every documented rule reproduces the recorded pairing', () => {
	const fixture = loadFixture('03-item-pairing');
	const runData = fixture.expected.runData;

	const start = stripPairs(branch0('Trigger', fixture));
	assert.equal(start.length, 3);

	// start node: 3 inputs -> 3 outputs -> index pairing
	assert.deepEqual(assign(stripPairs(start), start), [{ item: 0 }, { item: 1 }, { item: 2 }]);
	assert.deepEqual(pairsOf(branch0('Trigger', fixture)), [{ item: 0 }, { item: 1 }, { item: 2 }]);

	/** @type {Array<[string, string, (input: any[]) => any[], any[]]>} */
	const table = [
		// [producer, consumer, node transform, expected pairedItem sequence]
		['Trigger', 'MapNoPair', (input) => stripPairs(input), [{ item: 0 }, { item: 1 }, { item: 2 }]],
		['MapNoPair', 'Aggregate', () => [{ json: { all: true } }], [{ item: 0 }]],
		[
			'Aggregate',
			'ExplodeNoPair1',
			() => [{ json: { k: 0 } }, { json: { k: 1 } }],
			[{ item: 0 }, { item: 0 }],
		],
		[
			'Trigger',
			'ExplodeNoPairN',
			() => Array.from({ length: 6 }, (_unused, k) => ({ json: { k } })),
			[null, null, null, null, null, null],
		],
		[
			'Trigger',
			'ExplodePaired',
			() =>
				Array.from({ length: 6 }, (_unused, k) => ({
					json: { k },
					pairedItem: { item: Math.floor(k / 2) }, // explicit: never overwritten (I5)
				})),
			[{ item: 0 }, { item: 0 }, { item: 1 }, { item: 1 }, { item: 2 }, { item: 2 }],
		],
		[
			'ExplodePaired',
			'Echo',
			(input) => stripPairs(input),
			[0, 1, 2, 3, 4, 5].map((item) => ({ item })),
		],
	];

	for (const [producer, consumer, transform, expected] of table) {
		const input = branch0(producer, fixture);
		const output = transform(input);
		assert.deepEqual(assign(output, input), expected, `${producer} -> ${consumer}`);
		assert.deepEqual(pairsOf(branch0(consumer, fixture)), expected, `${consumer} as recorded`);
	}
});

test('07-item-helpers replay: normalizeItems/returnJsonArray + pairing reproduce the run', () => {
	const fixture = loadFixture('07-item-helpers');
	const start = branch0('Trigger', fixture);

	// Node "Norm" calls normalizeItems([{a:1},{a:2}]) on a single input item.
	const norm = normalizeItems([{ a: 1 }, { a: 2 }]);
	assert.deepEqual(norm, [{ json: { a: 1 } }, { json: { a: 2 } }]);
	assert.deepEqual(assign(norm, start), [{ item: 0 }, { item: 0 }]);
	assert.deepEqual(
		branch0('Norm', fixture).map((item) => item.json),
		[{ a: 1 }, { a: 2 }],
	);
	assert.deepEqual(pairsOf(branch0('Norm', fixture)), [{ item: 0 }, { item: 0 }]);

	// Node "RJA" calls returnJsonArray([{a:1},{json:{a:2}}]) — no double wrapping.
	const rja = returnJsonArray([{ a: 1 }, { json: { a: 2 } }]);
	assert.deepEqual(rja, [{ json: { a: 1 } }, { json: { a: 2 } }]);
	assert.deepEqual(assign(rja, norm), [{ item: 0 }, { item: 1 }]);
	assert.deepEqual(
		branch0('RJA', fixture).map((item) => item.json),
		[{ a: 1 }, { a: 2 }],
	);
	assert.deepEqual(pairsOf(branch0('RJA', fixture)), [{ item: 0 }, { item: 1 }]);
});

test('05-empty-data replay: empty branch vs alwaysOutputData synthesis', () => {
	const fixture = loadFixture('05-empty-data');
	const start = branch0('Trigger', fixture);
	const runData = fixture.expected.runData;

	// I8: `Empty` produced [[]] and `After` was never executed.
	assert.deepEqual(taskOf(runData, 'Empty').main, [[]]);
	assert.equal(runData.After, undefined, 'a downstream node of an empty branch must not run');

	// I9: `EmptyAlways` syntheses one item paired to every input item.
	const synthesised = alwaysOutputDataItem({ data: { main: [start] } });
	assert.deepEqual(synthesised, [
		{ json: {}, pairedItem: [{ item: 0, input: 0 }, { item: 1, input: 0 }] },
	]);
	assert.deepEqual(branch0('EmptyAlways', fixture), synthesised);

	// …and its downstream node does run, with plain single-input pairing.
	assert.deepEqual(assign(stripPairs(synthesised), synthesised), [{ item: 0 }]);
	assert.deepEqual(pairsOf(branch0('AfterAlways', fixture)), [{ item: 0 }]);
});

test('01/02/04 replay: linear and multi-item runs keep index pairing end to end', () => {
	for (const name of ['01-single-item', '02-multiple-items', '04-multiple-output']) {
		const fixture = loadFixture(name);
		const start = branch0('Trigger', fixture);
		assert.deepEqual(
			assign(stripPairs(start), start),
			pairsOf(start),
			`${name}: start node pairing`,
		);
	}
});
