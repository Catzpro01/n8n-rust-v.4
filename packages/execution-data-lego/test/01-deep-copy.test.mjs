import assert from 'node:assert/strict';
import test from 'node:test';

import { deepCopy } from '../src/deep-copy.mjs';

test('primitives, null and functions are returned as-is', () => {
	assert.equal(deepCopy(1), 1);
	assert.equal(deepCopy('a'), 'a');
	assert.equal(deepCopy(null), null);
	assert.equal(deepCopy(undefined), undefined);
	const fn = () => 1;
	assert.equal(deepCopy(fn), fn, 'DC-2: functions are returned by reference');
});

test('arrays and nested objects are cloned, not shared', () => {
	const source = { a: [1, { b: 2 }], c: { d: [{ e: 3 }] } };
	const clone = deepCopy(source);
	assert.deepEqual(clone, source);
	assert.notEqual(clone, source);
	assert.notEqual(clone.a, source.a);
	assert.notEqual(clone.a[1], source.a[1]);
});

test('DC-1: an object with toJSON is REPLACED by toJSON(), not cloned', () => {
	const date = new Date('2024-01-02T03:04:05.000Z');
	assert.equal(deepCopy(date), '2024-01-02T03:04:05.000Z');

	const nested = { when: date, n: 1 };
	assert.deepEqual(deepCopy(nested), { when: '2024-01-02T03:04:05.000Z', n: 1 });
});

test('DC-4: cycles are resolved through the shared WeakMap', () => {
	const source = { name: 'root' };
	source.self = source;
	source.list = [source, { back: source }];

	const clone = deepCopy(source);
	assert.notEqual(clone, source);
	assert.equal(clone.self, clone, 'cycle points at the CLONE, not the source');
	assert.equal(clone.list[0], clone);
	assert.equal(clone.list[1].back, clone);
});

test('DC-3: a plain-object clone loses a custom prototype but keeps Array', () => {
	class Point {
		constructor(x) {
			this.x = x;
		}
		get doubled() {
			return this.x * 2;
		}
	}
	const clone = deepCopy(new Point(3));
	assert.deepEqual(Object.keys(clone), ['x']);
	assert.equal(Object.getPrototypeOf(clone), Object.prototype);

	const arr = deepCopy([1, 2]);
	assert.ok(Array.isArray(arr));
});

test('non-enumerable properties are not copied (for..in semantics)', () => {
	const source = {};
	Object.defineProperty(source, 'hidden', { value: 1, enumerable: false });
	Object.defineProperty(source, 'shown', { value: 2, enumerable: true });
	const clone = deepCopy(source);
	assert.deepEqual(Object.keys(clone), ['shown']);
});

test('inherited (prototype) properties are not copied (hasOwnProperty guard)', () => {
	const proto = { inherited: 1 };
	const source = Object.create(proto);
	source.own = 2;
	const clone = deepCopy(source);
	assert.deepEqual(Object.keys(clone), ['own']);
});

test('an empty object/array round-trips to an equal, distinct value', () => {
	const o = deepCopy({});
	assert.deepEqual(o, {});
	assert.notEqual(o, {});
	const a = deepCopy([]);
	assert.deepEqual(a, []);
});
