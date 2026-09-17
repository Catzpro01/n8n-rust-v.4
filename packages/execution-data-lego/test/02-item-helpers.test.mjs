import assert from 'node:assert/strict';
import test from 'node:test';

import {
	copyInputItems,
	constructExecutionMetaData,
	normalizeItems,
	returnJsonArray,
} from '../src/item-helpers.mjs';

test('returnJsonArray wraps a bare object under json', () => {
	assert.deepEqual(returnJsonArray({ a: 1 }), [{ json: { a: 1 } }]);
	assert.deepEqual(returnJsonArray([{ a: 1 }, { a: 2 }]), [{ json: { a: 1 } }, { json: { a: 2 } }]);
});

test('H-01: the double-wrap guard is a TRUTHINESS test, so falsy json double-wraps', () => {
	assert.deepEqual(returnJsonArray([{ json: { a: 1 } }]), [{ json: { a: 1 } }], 'no double wrap');
	assert.deepEqual(returnJsonArray([{ json: null }]), [{ json: { json: null } }]);
	assert.deepEqual(returnJsonArray([{ json: '' }]), [{ json: { json: '' } }]);
	assert.deepEqual(returnJsonArray([{ json: 0 }]), [{ json: { json: 0 } }]);
});

test('H-02: sibling keys (binary, error, …) survive the spread', () => {
	const out = returnJsonArray([{ json: { a: 1 }, binary: { data: { mimeType: 'text/plain' } } }]);
	assert.deepEqual(out, [{ json: { a: 1 }, binary: { data: { mimeType: 'text/plain' } } }]);
});

test('normalizeItems wraps raw objects and passes through json envelopes', () => {
	assert.deepEqual(normalizeItems([{ a: 1 }, { a: 2 }]), [{ json: { a: 1 } }, { json: { a: 2 } }]);
	const already = [{ json: { a: 1 } }];
	assert.equal(normalizeItems(already), already, 'arrays of json items are returned by reference');
});

test('H-03: a bare object is unwrapped with the same truthiness test', () => {
	assert.deepEqual(normalizeItems({ a: 1 }), [{ json: { a: 1 } }]);
	assert.deepEqual(normalizeItems({ json: { a: 1 } }), [{ json: { a: 1 } }]);
	assert.deepEqual(normalizeItems({ json: null }), [{ json: { json: null } }]);
});

test('H-04: a mixed json/raw array throws Inconsistent item format', () => {
	assert.throws(
		() => normalizeItems([{ json: { a: 1 } }, { b: 2 }]),
		(err) => err.message === 'Inconsistent item format' && err.level === 'error',
	);
});

test('H-05: an all-binary array is reshaped; a mixed one throws', () => {
	const binary = { data: { mimeType: 'text/plain' } };
	assert.deepEqual(normalizeItems([{ a: 1, binary }]), [{ json: { a: 1 }, binary }]);
	assert.throws(
		() => normalizeItems([{ a: 1, binary }, { b: 2 }]),
		/Inconsistent item format/,
	);
});

test('H-06: non-null primitives bypass the `in` probes and get wrapped', () => {
	assert.deepEqual(normalizeItems(['a', 1]), [{ json: 'a' }, { json: 1 }]);
});

test('H-06: a null member THROWS — typeof null === "object" passes the guard', () => {
	assert.throws(
		() => normalizeItems(['a', null]),
		(err) =>
			err instanceof TypeError &&
			err.message === "Cannot use 'in' operator to search for 'json' in null",
	);
	assert.throws(() => normalizeItems([null]), TypeError);
});

test('constructExecutionMetaData stamps itemData on every input item', () => {
	const input = [{ json: { a: 1 } }, { json: { a: 2 } }];
	assert.deepEqual(constructExecutionMetaData(input, { itemData: { item: 0 } }), [
		{ json: { a: 1 }, pairedItem: { item: 0 } },
		{ json: { a: 2 }, pairedItem: { item: 0 } },
	]);
});

test('H-07: itemData is stamped when the item has no pairedItem', () => {
	const input = [{ json: { a: 1 }, binary: { x: 1 } }];
	assert.deepEqual(constructExecutionMetaData(input, { itemData: { item: 3 } }), [
		{ json: { a: 1 }, pairedItem: { item: 3 }, binary: { x: 1 } },
	]);
});

test('H-07: an EXISTING pairedItem WINS over itemData (the ...rest spread is last)', () => {
	const input = [{ json: { a: 1 }, pairedItem: { item: 9 }, binary: { x: 1 } }];
	assert.deepEqual(constructExecutionMetaData(input, { itemData: { item: 3 } }), [
		{ json: { a: 1 }, pairedItem: { item: 9 }, binary: { x: 1 } },
	]);
});

test('H-08/H-09: copyInputItems nulls missing props and deep-copies values', () => {
	const items = [{ json: { a: 1, b: { c: 2 }, when: new Date('2024-01-01T00:00:00.000Z') } }];
	const out = copyInputItems(items, ['a', 'b', 'missing', 'when']);
	assert.deepEqual(out, [
		{
			a: 1,
			b: { c: 2 },
			missing: null,
			when: '2024-01-01T00:00:00.000Z', // DC-1 leaks through deepCopy
		},
	]);
	assert.notEqual(out[0].b, items[0].json.b, 'values are deep copied, not shared');
});
