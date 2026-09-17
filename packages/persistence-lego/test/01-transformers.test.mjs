/**
 * POOL-004 · Suite 01 — @n8n/db utils/transformers.ts
 * Reference: packages/@n8n/db/src/utils/transformers.ts (full-file port).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	idStringifier,
	lowerCaser,
	objectRetriever,
	sqlite,
	bigintStringToNumber,
} from '../src/utils/transformers.mjs';
import { setPersistenceConfig, resetPersistencePorts } from '../src/ports.mjs';

test('idStringifier.from: number -> string; undefined -> undefined', () => {
	assert.equal(idStringifier.from(123), '123');
	assert.equal(idStringifier.from(0), '0');
	assert.equal(idStringifier.from(undefined), undefined);
	assert.equal(idStringifier.from(), undefined);
});

test('idStringifier.to: string -> Number; non-string passes through untouched', () => {
	assert.equal(idStringifier.to('42'), 42);
	assert.equal(idStringifier.to('007'), 7);
	const findOperator = { _type: 'in', _value: [1, 2] }; // TypeORM FindOperator shape
	assert.equal(idStringifier.to(findOperator), findOperator); // same reference
	assert.equal(idStringifier.to(undefined), undefined);
	assert.equal(idStringifier.to(17), 17);
});

test('lowerCaser: from is identity; to lowercases strings only', () => {
	const v = { a: 1 };
	assert.equal(lowerCaser.from(v), v);
	assert.equal(lowerCaser.to('AbC.XyZ'), 'abc.xyz');
	assert.equal(lowerCaser.to(42), 42);
	assert.equal(lowerCaser.to(null), null);
});

test('objectRetriever: to is identity; from parses via consumed n8n-workflow jsonParse', () => {
	const obj = { nested: { list: [1, 2, 3] }, s: 'x' };
	assert.equal(objectRetriever.to(obj), obj); // same reference out

	assert.deepEqual(objectRetriever.from('{"a":1,"b":[true,null]}'), { a: 1, b: [true, null] });
	assert.deepEqual(objectRetriever.from(obj), obj); // non-string passthrough
});

test('objectRetriever.from: invalid JSON throws (jsonParse without fallbackValue)', () => {
	assert.throws(() => objectRetriever.from('{not json'));
});

test('sqlite.jsonColumn.to: sqlite stringifies, postgresdb passes object through', () => {
	setPersistenceConfig({ database: { type: 'sqlite' } });
	const v = { k: ['v', 1] };
	assert.equal(sqlite.jsonColumn.to(v), JSON.stringify(v));

	setPersistenceConfig({ database: { type: 'postgresdb' } });
	assert.equal(sqlite.jsonColumn.to(v), v); // same reference
	resetPersistencePorts();
});

test('sqlite.jsonColumn.from: string parsed via jsonParse; object passthrough', () => {
	assert.deepEqual(sqlite.jsonColumn.from('{"x":"y"}'), { x: 'y' });
	const obj = { x: 'z' };
	assert.equal(sqlite.jsonColumn.from(obj), obj);
});

test('bigintStringToNumber: to identity; from Number()s strings only', () => {
	assert.equal(bigintStringToNumber.to(900719925474090), 900719925474090);
	assert.equal(bigintStringToNumber.from('123'), 123);
	assert.equal(bigintStringToNumber.from(456), 456);
});

test('config port: default dbType is sqlite (reference default)', () => {
	resetPersistencePorts();
	const v = { a: 1 };
	assert.equal(sqlite.jsonColumn.to(v), JSON.stringify(v));
});
