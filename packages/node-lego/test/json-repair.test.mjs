/**
 * Reference-port regression tests for the `jsonrepair` port (DELTA-05) and its wiring as the
 * default `repairJSON` adapter of `jsonParse`.
 *
 * Oracles:
 * - reference/n8n/packages/workflow/test/utils.test.ts `describe('JSON repair')` L162-290
 *   (25 cases, all ported below with their expectations verbatim) and the `acceptJSObject`
 *   block above it (L100-160) for the non-repair paths that must stay unchanged.
 * - reference/n8n/packages/workflow/src/utils.ts L152-180 (`jsonParse`, incl. the
 *   `repairJSON` branch L164-170 that calls `jsonrepair` + `JSON.parse`).
 * - differential group `N26` compares the same behaviour end-to-end against the published
 *   `n8n-workflow@2.9.1` build's own bundled jsonrepair (76 comparisons).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { JSONRepairError, jsonParse, jsonrepair } from '../src/index.mjs';

test('JSON repair: recovery edge cases (oracle L163-L250)', () => {
	// "should handle simple object with single quotes"
	assert.deepEqual(jsonParse("{name: 'John', age: 30}", { repairJSON: true }), { name: 'John', age: 30 });
	// "should handle nested objects with single quotes"
	assert.deepEqual(jsonParse("{user: {name: 'John', active: true},}", { repairJSON: true }), {
		user: { name: 'John', active: true },
	});
	// "should handle empty string values"
	assert.deepEqual(jsonParse("{key: ''}", { repairJSON: true }), { key: '' });
	// "should handle numeric string values" / "should recover numeric values with single quotes"
	assert.deepEqual(jsonParse("{key: '123'}", { repairJSON: true }), { key: '123' });
	// "should handle multiple keys with trailing comma"
	assert.deepEqual(jsonParse("{a: '1', b: '2', c: '3',}", { repairJSON: true }), { a: '1', b: '2', c: '3' });
	// "should recover single quotes around strings"
	assert.deepEqual(jsonParse("{key: 'value'}", { repairJSON: true }), { key: 'value' });
	// "should recover unquoted keys"
	assert.deepEqual(jsonParse("{myKey: 'value'}", { repairJSON: true }), { myKey: 'value' });
	// "should recover trailing commas in objects"
	assert.deepEqual(jsonParse("{key: 'value',}", { repairJSON: true }), { key: 'value' });
	// "should recover trailing commas in nested objects"
	assert.deepEqual(jsonParse("{outer: {inner: 'value',},}", { repairJSON: true }), { outer: { inner: 'value' } });
	// "should recover multiple issues at once"
	assert.deepEqual(jsonParse("{key1: 'value1', key2: 'value2',}", { repairJSON: true }), {
		key1: 'value1',
		key2: 'value2',
	});
	// "should recover boolean values with single quotes"
	assert.deepEqual(jsonParse("{key: 'true'}", { repairJSON: true }), { key: 'true' });
	// "should handle urls"
	assert.deepEqual(jsonParse('{"key": "https://example.com",}', { repairJSON: true }), {
		key: 'https://example.com',
	});
	// "should handle ipv6 addresses"
	assert.deepEqual(jsonParse('{"key": "2a01:c50e:3544:bd00:4df0:7609:251a:f6d0",}', { repairJSON: true }), {
		key: '2a01:c50e:3544:bd00:4df0:7609:251a:f6d0',
	});
	// "should handle single quotes containing double quotes"
	assert.deepEqual(jsonParse('{key: \'value with "quotes" inside\'}', { repairJSON: true }), {
		key: 'value with "quotes" inside',
	});
	// "should handle escaped single quotes"
	assert.deepEqual(jsonParse("{key: 'it\\'s escaped'}", { repairJSON: true }), { key: "it's escaped" });
	// "should handle keys containing hyphens"
	assert.deepEqual(jsonParse("{key-with-dash: 'value'}", { repairJSON: true }), { 'key-with-dash': 'value' });
	// "should handle keys containing dots"
	assert.deepEqual(jsonParse("{key.name: 'value'}", { repairJSON: true }), { 'key.name': 'value' });
	// "should handle unquoted string values"
	assert.deepEqual(jsonParse('{key: value}', { repairJSON: true }), { key: 'value' });
	// "should handle unquoted multi-word values"
	assert.deepEqual(jsonParse('{key: some text}', { repairJSON: true }), { key: 'some text' });
	// "should handle input with double quotes mixed with single quotes"
	assert.deepEqual(jsonParse('{key: "value with \'single\' quotes"}', { repairJSON: true }), {
		key: "value with 'single' quotes",
	});
	// "should handle keys starting with numbers"
	assert.deepEqual(jsonParse("{123key: 'value'}", { repairJSON: true }), { '123key': 'value' });
	// "should handle nested objects containing quotes"
	assert.deepEqual(jsonParse('{outer: {inner: \'value with "quotes"\', other: \'test\'},}', { repairJSON: true }), {
		outer: { inner: 'value with "quotes"', other: 'test' },
	});
	// "should handle complex nested quote conflicts"
	assert.deepEqual(
		jsonParse('{key: \'value with "quotes" inside\', nested: {inner: \'test\'}}', { repairJSON: true }),
		{ key: 'value with "quotes" inside', nested: { inner: 'test' } },
	);
});

test('JSON repair: the wider jsonrepair@3.13.1 feature set (values REF-verified)', () => {
	// jsonrepair keeps the input's own whitespace style where it re-emits tokens, so these
	// expectations are the exact upstream strings (each one also compared through N26 against
	// the reference build's bundled jsonrepair).
	assert.equal(jsonrepair('{a: True, b: False, c: None}'), '{"a": true, "b": false, "c": null}');
	assert.equal(jsonrepair('{a: 1, // note\nb: 2}'), '{"a": 1, \n"b": 2}');
	assert.equal(jsonrepair('{a: 1 /* note */, b: 2}'), '{"a": 1 , "b": 2}');
	assert.equal(jsonrepair('{a: 1 b: 2}'), '{"a": 1, "b": 2}');
	assert.equal(jsonrepair('{"a": 1'), '{"a": 1}');
	assert.equal(jsonrepair('[1, 2'), '[1, 2]');
	assert.equal(jsonrepair('{"a": "value'), '{"a": "value"}');
	assert.equal(jsonrepair('```json\n{"a": 1}\n```'), '\n{"a": 1}\n');
	assert.equal(jsonrepair('callback({"a": 1});'), '{"a": 1}');
	assert.equal(jsonrepair('{"a": 1, ...}'), '{"a": 1 }');
	assert.equal(jsonrepair('{"a":\u00a01}'), '{"a": 1}');
	assert.equal(jsonrepair("{a: 'say \"hi\"'}"), '{"a": "say \\\"hi\\\""}');
	assert.equal(jsonrepair('{"a": "line1\nline2"}'), '{"a": "line1\\nline2"}');
	// missing values become null rather than an error
	assert.equal(jsonrepair('{"a": }'), '{"a": null}');
	assert.equal(jsonrepair('{,}'), '{}');
	// `#` is only a comment marker inside an object, and stray text is not silently dropped
	assert.throws(() => jsonrepair('{a: 1} # trailing'), /Unexpected character "#" at position 7/);
	assert.throws(() => jsonrepair('Here is the JSON: {"a": 1}'), /Unexpected character "\{" at position 18/);
});

test('jsonrepair leaves already-valid JSON untouched (idempotent)', () => {
	for (const text of ['{"a": 1}', '[1, 2, 3]', '"hello"', '42', 'true', 'null', '{"a": {"b": [1, {"c": null}]}}']) {
		assert.equal(jsonrepair(text), text);
	}
});

test('JSONRepairError carries the position like the upstream package', () => {
	const error = new JSONRepairError('Unexpected character', 7);
	assert.ok(error instanceof Error);
	assert.equal(error.name, 'Error');
	assert.equal(error.message, 'Unexpected character at position 7');
	assert.equal(error.position, 7);

	assert.throws(() => jsonrepair('{{{'), (thrown) => {
		assert.ok(thrown instanceof JSONRepairError);
		assert.equal(thrown.message, 'Unexpected character "{" at position 1');
		assert.equal(thrown.position, 1);
		return true;
	});
});

test('jsonParse unchanged paths: repairJSON defaults off and the stricts paths still throw', () => {
	// `repairJSON` is not implied: a relaxed string still throws without it
	assert.throws(() => jsonParse("{a: 1}"));
	assert.throws(() => jsonParse("{a: 1}", { errorMessage: 'bad json' }), /bad json/);
	assert.deepEqual(jsonParse("{a: 1}", { fallbackValue: { fallback: true } }), { fallback: true });
	assert.deepEqual(jsonParse("{a: 1}", { fallbackValue: () => ['f'] }), ['f']);
	// acceptJSObject (DELTA-05's other adapter) is unaffected and wins before the repair path
	assert.deepEqual(jsonParse("{'a':'b'}", { acceptJSObject: true }), { a: 'b' });
	// valid JSON never reaches the repair path
	assert.deepEqual(jsonParse('{"a":1}', { repairJSON: true }), { a: 1 });
	// a repair that itself fails rethrows the ORIGINAL JSON.parse error (reference behaviour:
	// the jsonrepair error is swallowed by the `catch (e)` inside the repair branch)
	assert.throws(
		() => jsonParse('{{{', { repairJSON: true }),
		(thrown) => !(thrown instanceof JSONRepairError) && thrown instanceof SyntaxError,
	);
});

test('an injected repairJSONParser still wins over the default port', () => {
	let calls = 0;
	const injected = (text) => {
		calls += 1;
		return `{"injected": ${JSON.stringify(text)}}`;
	};
	assert.deepEqual(jsonParse('not json at all', { repairJSON: true, repairJSONParser: injected }), {
		injected: 'not json at all',
	});
	assert.equal(calls, 1);
	// a throwing adapter falls through to the original error, exactly like a throwing jsonrepair
	assert.throws(() =>
		jsonParse('not json at all', {
			repairJSON: true,
			repairJSONParser: () => {
				throw new Error('nope');
			},
		}),
	);
});
