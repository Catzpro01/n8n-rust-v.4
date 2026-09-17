import assert from 'node:assert/strict';
import test from 'node:test';

import {
	alwaysOutputDataItem,
	assignPairedItems,
	buildSourceData,
	isEmptyNodeResult,
	resolveSourceOverwrite,
	rewriteInputPairedItems,
} from '../src/paired-items.mjs';

const items = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ json: { i }, ...extra }));

/** pairedItem list of a single ITEM array. */
const pairsOf = (list) => (list ?? []).map((item) => item?.pairedItem ?? null);

/** pairedItem list of the first output branch of an assignPairedItems result. */
const assignedPairsOf = (branches) => pairsOf(branches?.[0]);

/** The same list as it survives JSON round-tripping (undefined keys dropped). */
const jsonPairsOf = (list) => JSON.parse(JSON.stringify(pairsOf(list)));

test('I3/P-01: input 0 loses the `input` key, input 1 keeps it', () => {
	const rewritten = rewriteInputPairedItems({
		data: { main: [items(2), items(1)] },
	});
	// the `input` key is always WRITTEN; for input 0 its value is `undefined`
	// and therefore vanishes on serialisation.
	assert.deepEqual(pairsOf(rewritten.data.main[0]), [{ item: 0, input: undefined }, { item: 1, input: undefined }]);
	assert.deepEqual(jsonPairsOf(rewritten.data.main[0]), [{ item: 0 }, { item: 1 }]);
	assert.deepEqual(jsonPairsOf(rewritten.data.main[1]), [{ item: 0, input: 1 }]);
	assert.deepEqual(Object.keys(rewritten.data.main[1][0].pairedItem), ['item', 'input']);
});

test('I3: existing item keys survive the rewrite; pairedItem is always replaced', () => {
	const input = [{ json: { a: 1 }, pairedItem: { item: 99 }, binary: { b: 1 } }];
	const rewritten = rewriteInputPairedItems({ data: { main: [input] } });
	assert.deepEqual(JSON.parse(JSON.stringify(rewritten.data.main[0])), [
		{ json: { a: 1 }, pairedItem: { item: 0 }, binary: { b: 1 } },
	]);
});

test('P-02: a null input branch is passed through untouched', () => {
	const rewritten = rewriteInputPairedItems({ data: { main: [null, items(1)] } });
	assert.equal(rewritten.data.main[0], null);
	assert.deepEqual(jsonPairsOf(rewritten.data.main[1]), [{ item: 0, input: 1 }]);
});

test('P-03: sourceOverwrite is threaded in for tool executions only', () => {
	const overwrite = { previousNode: 'Agent', previousNodeOutput: 0 };
	const plain = rewriteInputPairedItems({ data: { main: [items(1)] } });
	assert.deepEqual(jsonPairsOf(plain.data.main[0]), [{ item: 0 }]);

	const tool = rewriteInputPairedItems({
		data: { main: [items(1)] },
		metadata: { preserveSourceOverwrite: true, preservedSourceOverwrite: overwrite },
	});
	assert.deepEqual(jsonPairsOf(tool.data.main[0]), [{ item: 0, sourceOverwrite: overwrite }]);
});

test('resolveSourceOverwrite prefers preservedSourceOverwrite, then the item value', () => {
	const fromItem = { previousNode: 'X' };
	const item = { json: {}, pairedItem: { item: 0, sourceOverwrite: fromItem } };
	assert.equal(resolveSourceOverwrite(item, { metadata: { preserveSourceOverwrite: true } }), fromItem);
	assert.equal(resolveSourceOverwrite(item, {}), null);
	assert.equal(resolveSourceOverwrite({ json: {} }, { metadata: { preserveSourceOverwrite: true } }), null);
});

test('I4 rule (a): one input item -> every output item is { item: 0 }', () => {
	const out = items(3);
	const result = assignPairedItems([out], { data: { main: [items(1)] } });
	assert.deepEqual(assignedPairsOf(result), [{ item: 0 }, { item: 0 }, { item: 0 }]);
});

test('I4 rule (b): same item count -> index pairing', () => {
	const out = items(3);
	const result = assignPairedItems([out], { data: { main: [items(3)] } });
	assert.deepEqual(assignedPairsOf(result), [{ item: 0 }, { item: 1 }, { item: 2 }]);
});

test('I4 rule (c): many inputs collapsed into one output -> { item: 0 }', () => {
	const out = items(1);
	const result = assignPairedItems([out], { data: { main: [items(3)] } });
	assert.deepEqual(assignedPairsOf(result), [{ item: 0 }]);
});

test('I4: no rule applies -> pairedItem stays undefined', () => {
	const out = items(6);
	const result = assignPairedItems([out], { data: { main: [items(3)] } });
	assert.deepEqual(assignedPairsOf(result), [null, null, null, null, null, null]);
});

test('I5: an explicit pairedItem is never overwritten', () => {
	const out = [
		{ json: {}, pairedItem: { item: 0 } },
		{ json: {}, pairedItem: { item: 0 } },
		{ json: {}, pairedItem: { item: 1 } },
		{ json: {}, pairedItem: { item: 1 } },
		{ json: {}, pairedItem: { item: 2 } },
		{ json: {}, pairedItem: { item: 2 } },
	];
	const result = assignPairedItems([out], { data: { main: [items(3)] } });
	assert.deepEqual(assignedPairsOf(result), [
		{ item: 0 }, { item: 0 }, { item: 1 }, { item: 1 }, { item: 2 }, { item: 2 },
	]);
});

test('P-04: the first unfixable item aborts the whole assignment loop', () => {
	const out = [items(2), items(2)];
	const result = assignPairedItems(out, { data: { main: [items(1)] } });
	// isSingleInputAndOutput is true, so EVERY item in EVERY branch is {item:0}
	assert.deepEqual(pairsOf(result[0]), [{ item: 0 }, { item: 0 }]);
	assert.deepEqual(pairsOf(result[1]), [{ item: 0 }, { item: 0 }]);

	// now the aborting case: 3 inputs -> 6 outputs, mixed with one explicit pair
	const mixed = [{ json: {}, pairedItem: { item: 0 } }, ...items(5)];
	assignPairedItems([mixed], { data: { main: [items(3)] } });
	assert.equal(mixed[1].pairedItem, undefined, 'loop broke before the second item');
});

test('P-05: two output branches never get index pairing', () => {
	const out = [items(3), items(3)];
	const result = assignPairedItems(out, { data: { main: [items(3)] } });
	assert.deepEqual(pairsOf(result[0]), [null, null, null]);
	assert.deepEqual(pairsOf(result[1]), [null, null, null]);
});

test('P-06: assignPairedItems mutates in place and returns the same array', () => {
	const out = [items(3)];
	const result = assignPairedItems(out, { data: { main: [items(3)] } });
	assert.equal(result, out);
});

test('null/undefined node results are normalised to null', () => {
	assert.equal(assignPairedItems(null, { data: { main: [items(1)] } }), null);
	assert.equal(assignPairedItems(undefined, { data: { main: [items(1)] } }), null);
});

test('P-07: buildSourceData normalises `null` to `undefined`, not to `null`', () => {
	// `outputIndex ?? undefined` fires on null as well as undefined — this is the
	// ONLY input class that distinguishes the 1:1 port from a naive passthrough.
	const source = buildSourceData({ previousNode: 'A', previousNodeOutput: null, previousNodeRun: null });
	assert.equal(source.previousNodeOutput, undefined);
	assert.equal(source.previousNodeRun, undefined);
	assert.ok('previousNodeOutput' in source && 'previousNodeRun' in source, 'keys stay present');
	assert.deepEqual(JSON.parse(JSON.stringify(source)), { previousNode: 'A' });
});

test('I6/I7/P-07: buildSourceData keeps index 0 and drops undefined', () => {
	assert.deepEqual(buildSourceData({ previousNode: 'A', previousNodeOutput: 0, previousNodeRun: 0 }), {
		previousNode: 'A',
		previousNodeOutput: 0,
		previousNodeRun: 0,
	});
	assert.deepEqual(buildSourceData({ previousNode: 'A', previousNodeOutput: 2 }), {
		previousNode: 'A',
		previousNodeOutput: 2,
		previousNodeRun: undefined,
	});
});

test('I9/P-08: alwaysOutputData synthesises one empty item paired to every input', () => {
	const executionData = { data: { main: [items(2), items(1)] } };
	assert.deepEqual(alwaysOutputDataItem(executionData), [
		{ json: {}, pairedItem: [{ item: 0, input: 0 }, { item: 1, input: 0 }, { item: 0, input: 1 }] },
	]);
});

test('alwaysOutputData skips null input branches', () => {
	const executionData = { data: { main: [null, items(1)] } };
	assert.deepEqual(alwaysOutputDataItem(executionData), [
		{ json: {}, pairedItem: [{ item: 0, input: 1 }] },
	]);
});

test('isEmptyNodeResult matches the engine precondition', () => {
	assert.equal(isEmptyNodeResult([[]]), true);
	assert.equal(isEmptyNodeResult([]), true);
	assert.equal(isEmptyNodeResult(null), true);
	assert.equal(isEmptyNodeResult(undefined), true);
	assert.equal(isEmptyNodeResult([[{}]]), false);
});
