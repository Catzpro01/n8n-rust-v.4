/**
 * Records language-neutral fixtures for the REFERENCE part of the Validation LEGO
 * (type-validation.ts: validateFieldType / tryToParse*) straight from the real n8n-workflow 2.9.4
 * runtime — no hand-written expectations. Output: fixtures/ref-*.json
 *   { id, fn, input: { args }, expected: <return value, JSON-safe> | { throws: { name, message } } }
 * Non-JSON values are encoded: DateTime → { $luxon: iso }, undefined → omitted key.
 * Run: N8N_RUNTIME=/home/user/n8n-runtime node tests/reference/agent-4/validation/gen-reference-fixtures.mjs
 */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const RUNTIME = process.env.N8N_RUNTIME ?? '/home/user/n8n-runtime';
const w = createRequire(resolve(RUNTIME, 'package.json'))('n8n-workflow');
const out = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');
mkdirSync(out, { recursive: true });

const enc = (v) => v === undefined ? undefined : v && typeof v === 'object' && typeof v.toISO === 'function' && 'zoneName' in v ? { $luxon: v.toISO() } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, enc(x)])) : v;
const run = (fn, args) => { try { return { expected: enc(w[fn](...args)) }; } catch (e) { return { expected: { throws: { name: e.constructor.name, message: e.message } } }; } };

const opts = { valueOptions: [{ name: 'a', value: 'a' }, { name: 'b', value: 'b' }] };
const cases = [
	// validateFieldType — A1..A24 + extra edges
	...[
		[null, 'number'], ['42', 'number'], ['42', 'number', { strict: true }], ['A', 'number'], [true, 'number'], ['1e3', 'number'], ['', 'number'], [' 7 ', 'number'],
		['01', 'boolean'], ['TRUE', 'boolean'], [1, 'boolean'], ['000', 'boolean'], ['FALSE', 'boolean'], [0, 'boolean'], ['yes', 'boolean'], [2, 'boolean'], [-1, 'boolean'], ['tru', 'boolean'], ['false', 'boolean', { strict: true }],
		[42, 'string'], [42, 'string', { parseStrings: true }], [{ a: 1 }, 'string', { parseStrings: true }], [null, 'string'],
		['1abc', 'string-alphanumeric'], ['abc_1', 'string-alphanumeric'], ['ab-c', 'string-alphanumeric'],
		['1994-11-05T08:15:30-05:00', 'dateTime'], ['not a date', 'dateTime'], ['2024-02-30', 'dateTime'], ['Tue, 01 Nov 2016 13:23:12 +0630', 'dateTime'], ['2017-05-15 09:24:15', 'dateTime'],
		['23:23', 'time'], ['25:99', 'time'], ['23:23:59', 'time'], ['9:5', 'time'], ['23h', 'time'],
		['x', 'options', opts], ['a', 'options', opts], ['a', 'options'],
		[{ data: 'x' }, 'binary'], [{ mimeType: 'text/plain', id: '1' }, 'binary'], [{ mimeType: 'text/plain', data: 'AA==' }, 'binary'], ['str', 'binary'],
		['nope', 'jwt'], ['eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig', 'jwt'],
		['{"a": 1}', 'object'], ['{a: 1}', 'object'], ['[1]', 'object'], [[], 'object', { strict: true }], [{ a: 1 }, 'object'], ['nope', 'object'],
		['[1,2]', 'array'], ['1,2', 'array'], [[1], 'array'], ['{"a":1}', 'array'], ['x', 'array', { strict: true }],
		['x', 'whatever'], ['5', 'url'], ['https://n8n.io', 'url'], ['x', 'form-fields'],
	].map((a, i) => ({ id: `ref-vft-${String(i + 1).padStart(2, '0')}`, fn: 'validateFieldType', args: ['f', ...a] })),
	// tryToParse* — B cases
	...['tryToParseNumber', 'tryToParseString', 'tryToParseAlphanumericString', 'tryToParseBoolean', 'tryToParseDateTime', 'tryToParseTime', 'tryToParseArray', 'tryToParseObject', 'tryToParseUrl', 'tryToParseJwt']
		.flatMap((fn) => ['42', 'abc', '', null, undefined, true, 0, '1.5', '[1,2]', '{"a":1}', '{a:1}', 'https://n8n.io', '23:59', '2020-01-01', 'a_1', 'a-1', 'eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig']
			.filter((v) => typeof w[fn] === 'function' && !(fn === 'tryToParseDateTime' && v === '23:59')) // '23:59' → DateTime for *today* (wall-clock dependent, documented in golden B, not recordable)
			.map((v, i) => ({ id: `ref-${fn}-${String(i + 1).padStart(2, '0')}`, fn, args: [v] }))),
];
const files = [];
for (const c of cases) {
	const fx = { id: c.id, fn: c.fn, input: { args: enc(c.args) === undefined ? [] : c.args.map((x) => x === undefined ? { $undefined: true } : x) }, ...run(c.fn, c.args) };
	writeFileSync(resolve(out, `${c.id}.json`), JSON.stringify(fx, null, 2) + '\n'); files.push(c.id);
}
writeFileSync(resolve(out, 'ref-index.json'), JSON.stringify({ source: 'n8n-workflow 2.9.4 runtime (recorded, not hand-written)', version: w.LoggerProxy ? undefined : undefined, encoding: { luxonDateTime: '{ $luxon: iso }', undefinedArg: '{ $undefined: true }', throw: '{ throws: { name, message } }' }, cases: files }, null, 2) + '\n');
console.log(`recorded ${files.length} reference fixtures`);
