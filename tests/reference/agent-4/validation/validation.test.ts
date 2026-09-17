/**
 * Validation LEGO — reference tests.
 *  Part 1: golden cases A/B/C from docs/isolation/validation-golden-cases.md against the REAL n8n-workflow 2.9.4.
 *  Part 2: golden cases D (NEW CAPABILITY) against workflow-rules.ts.
 * Run: node --test tests/reference/agent-4/validation/validation.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasRuntime, n8nRequire, here } from '../helpers.ts';
import * as rules from './workflow-rules.ts';
const { validateWorkflow, detectCycles, checkNodeUniqueness, checkDanglingConnections } = rules;

const skipUnit = { skip: hasRuntime ? false : 'N8N_RUNTIME not available' };
const ref = (name: string) => JSON.parse(readFileSync(resolve(here, '..', name, 'workflow.json'), 'utf8'));

// ---------------- Part 1: reference behaviour (frozen) ----------------
test('A: validateFieldType coercion, strict, parseStrings, null, unknown type', skipUnit, () => {
	const { validateFieldType: v } = n8nRequire('n8n-workflow');
	assert.deepEqual(v('f', null, 'number'), { valid: true });
	assert.deepEqual(v('f', '42', 'number'), { valid: true, newValue: 42 });
	assert.deepEqual(v('f', '42', 'number', { strict: true }), { valid: false, errorMessage: "'f' expects a number but we got '42'" });
	assert.deepEqual(v('f', true, 'number'), { valid: true, newValue: 1 });
	for (const t of ['01', 'TRUE', 1]) assert.deepEqual(v('f', t, 'boolean'), { valid: true, newValue: true });
	for (const f of ['000', 'FALSE', 0]) assert.deepEqual(v('f', f, 'boolean'), { valid: true, newValue: false });
	for (const bad of ['yes', 2, -1, 'tru']) assert.equal(v('f', bad, 'boolean').valid, false);
	assert.deepEqual(v('f', 42, 'string'), { valid: true, newValue: 42 });
	assert.deepEqual(v('f', 42, 'string', { parseStrings: true }), { valid: true, newValue: '42' });
	assert.deepEqual(v('f', 'x', 'whatever'), { valid: true, newValue: 'x' });
	assert.deepEqual(v('f', [], 'object', { strict: true }), { valid: false, errorMessage: "'f' expects a object but we got array" });
	assert.deepEqual(v('f', '{a: 1}', 'object'), { valid: true, newValue: { a: 1 } });
	assert.deepEqual(v('f', '[1,2]', 'array'), { valid: true, newValue: [1, 2] });
});

test('A: frozen error messages (alphanumeric, time quirk, options, binary, jwt, dateTime)', skipUnit, () => {
	const { validateFieldType: v } = n8nRequire('n8n-workflow');
	assert.equal(v('f', '1abc', 'string-alphanumeric').errorMessage, 'Value is not a valid alphanumeric string, only letters, numbers and underscore allowed');
	assert.deepEqual(v('f', 'abc_1', 'string-alphanumeric'), { valid: true, newValue: 'abc_1' });
	assert.deepEqual(v('f', '23:23', 'time'), { valid: true, newValue: '23:23' });
	assert.deepEqual(v('f', '25:99', 'time'), { valid: true, newValue: '25:99' }, 'shape-only quirk is frozen');
	assert.equal(v('f', 'x', 'options', { valueOptions: [{ name: 'a', value: 'a' }, { name: 'b', value: 'b' }] }).errorMessage, "'f' expects one of the following values: [a, b] but we got 'x'");
	assert.equal(v('f', { data: 'x' }, 'binary').errorMessage, "'f' expects a binary but we got object. Make sure the value is a valid binary data object with 'mimeType' and 'data' or 'id' property.");
	assert.equal(v('f', { mimeType: 'text/plain', id: '1' }, 'binary').valid, true);
	assert.equal(v('f', 'nope', 'jwt').errorMessage, 'Value is not a valid JWT token');
	assert.match(v('f', 'not a date', 'dateTime').errorMessage, /^'f' expects a dateTime but we got 'not a date' <br\/><br\/> Consider using .*DateTime\.fromFormat/);
	assert.equal(v('f', '1994-11-05T08:15:30-05:00', 'dateTime').valid, true);
});

test('B: tryToParse* throw ApplicationError with frozen messages; getValueDescription', skipUnit, () => {
	const w = n8nRequire('n8n-workflow');
	const throwsMsg = (fn: () => unknown, msg: string) => assert.throws(fn, (e: any) => e.constructor.name === 'ApplicationError' && e.message === msg);
	throwsMsg(() => w.tryToParseNumber('A'), 'Failed to parse value to number');
	throwsMsg(() => w.tryToParseBoolean('yes'), 'Failed to parse value as boolean');
	throwsMsg(() => w.tryToParseArray('{"a":1}'), 'Value is not a valid array');
	throwsMsg(() => w.tryToParseObject('[1]'), 'Value is not a valid object');
	throwsMsg(() => w.tryToParseUrl('not a url'), 'The value "https://not a url" is not a valid url.'); // source prefixes https:// when '://' is absent
	assert.equal(w.tryToParseUrl('example.com/x'), 'https://example.com/x');
	throwsMsg(() => w.tryToParseUrl('javascript://x'), 'The value "javascript://x" is not a valid url.'); // ALLOWED_URL_PROTOCOLS = http, https, ftp, file
	assert.equal(w.tryToParseUrl('ftp://example.com'), 'ftp://example.com');
	throwsMsg(() => w.tryToParseJwt(''), 'The value "" is not a valid JWT token.');
	throwsMsg(() => w.tryToParseJsonToFormFields('not json'), 'Value is not valid JSON');
	assert.equal(w.tryToParseDateTime('2018-05-16', 'America/New_York').zoneName, 'America/New_York');
	assert.equal(w.tryToParseDateTime('1994-11-05T08:15:30-05:00', 'UTC').offset, -300);
	assert.deepEqual([w.getValueDescription('s'), w.getValueDescription([1]), w.getValueDescription({ a: 1 }), w.getValueDescription(1), w.getValueDescription(null)], ["'s'", 'array', 'object', "'1'", "'null'"]);
});

test('C: type guards and zod schemas', skipUnit, () => {
	const w = n8nRequire('n8n-workflow');
	assert.deepEqual([w.isNodeConnectionType('main'), w.isNodeConnectionType('ai_tool'), w.isNodeConnectionType('nope')], [true, true, false]);
	assert.deepEqual([w.isBinaryValue({ mimeType: 'a', id: '1' }), w.isBinaryValue({ mimeType: 'a' })], [true, false]);
	assert.equal(w.isResourceLocatorValue({ __rl: true, mode: 'id', value: '1' }), true);
	assert.equal(w.INodeParametersSchema.safeParse({ a: 1, b: 'x', c: { __rl: true, mode: 'id', value: '1' } }).success, true);
	assert.equal(w.INodeParametersSchema.safeParse('nope').success, false);
	const r = w.NodeConnectionTypeSchema.safeParse('bogus');
	assert.equal(r.success, false);
	assert.equal(r.error.issues[0].code, 'invalid_enum_value');
	// parity: our mirrored list equals the reference's nodeConnectionTypes
	const { NODE_CONNECTION_TYPES } = rules;
	assert.deepEqual([...NODE_CONNECTION_TYPES].sort(), [...w.nodeConnectionTypes].sort());
});


// ---------------- Part 2: NEW CAPABILITY ----------------
const node = (name: string, extra: object = {}) => ({ id: name, name, type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [0, 0], parameters: {}, ...extra });
const edge = (to: string, type = 'main') => [[{ node: to, type, index: 0 }]];

test('D1/D2: reference golden workflows are valid', () => {
	assert.deepEqual(validateWorkflow(ref('01-empty-workflow')), { valid: true, errors: [] });
	assert.deepEqual(validateWorkflow(ref('03-linear')), { valid: true, errors: [] });
	assert.deepEqual(validateWorkflow(ref('03-linear'), { allowCycles: false }), { valid: true, errors: [] });
});

test('D3/D9: NodeUniqueness (disabled nodes still count)', () => {
	const wf = { nodes: [node('Code'), node('Code', { disabled: true })], connections: {} };
	assert.deepEqual(validateWorkflow(wf), { valid: false, errors: [{ code: 'DUPLICATE_NODE_NAME', node: 'Code', path: ['nodes', '1', 'name'], message: 'Duplicate node name "Code"' }] });
	assert.equal(checkNodeUniqueness({ nodes: [node('A'), node('B')] }).length, 0);
});

test('D4/D5: DanglingConnections and INVALID_CONNECTION_TYPE', () => {
	const wf = { nodes: [node('Trigger')], connections: { Trigger: { main: edge('Ghost') } } };
	const r = validateWorkflow(wf);
	assert.equal(r.valid, false);
	assert.deepEqual(r.errors, [{ code: 'DANGLING_CONNECTION', node: 'Trigger', path: ['connections', 'Trigger', 'main', '0', '0'], message: 'Connection from "Trigger" to unknown node "Ghost"' }]);
	const bad = validateWorkflow({ nodes: [node('A'), node('B')], connections: { A: { foo: edge('B', 'foo') } } });
	assert.deepEqual(bad.errors.map((e) => e.code), ['INVALID_CONNECTION_TYPE', 'INVALID_CONNECTION_TYPE']);
	const unknownSource = checkDanglingConnections({ nodes: [node('A')], connections: { Nope: { main: edge('A') } } });
	assert.equal(unknownSource[0].message, 'Connection from unknown node "Nope"');
});

test('D6/D7/D8: CycleDetection is opt-in, main-only, deterministic path', () => {
	const cyclic = { nodes: [node('A'), node('B')], connections: { A: { main: edge('B') }, B: { main: edge('A') } } };
	assert.deepEqual(validateWorkflow(cyclic), { valid: true, errors: [] }, 'default allowCycles=true (reference parity)');
	assert.deepEqual(validateWorkflow(cyclic, { allowCycles: false }).errors, [{ code: 'CYCLE_DETECTED', node: 'A', path: ['connections', 'B', 'main'], message: 'Cycle detected: A → B → A' }]);
	const aiOnly = { nodes: [node('A'), node('B')], connections: { A: { ai_tool: edge('B', 'ai_tool') }, B: { ai_tool: edge('A', 'ai_tool') } } };
	assert.deepEqual(validateWorkflow(aiOnly, { allowCycles: false }), { valid: true, errors: [] });
	// self loop + longer cycle + DAG with diamond (no false positive)
	assert.equal(detectCycles({ nodes: [node('A')], connections: { A: { main: edge('A') } } })[0].message, 'Cycle detected: A → A');
	assert.equal(detectCycles({ nodes: [node('A'), node('B'), node('C')], connections: { A: { main: edge('B') }, B: { main: edge('C') }, C: { main: edge('A') } } })[0].message, 'Cycle detected: A → B → C → A');
	const diamond = { nodes: [node('A'), node('B'), node('C'), node('D')], connections: { A: { main: [[{ node: 'B', type: 'main', index: 0 }, { node: 'C', type: 'main', index: 0 }]] }, B: { main: edge('D') }, C: { main: edge('D') } } };
	assert.deepEqual(detectCycles(diamond), []);
});

test('D10: malformed input never throws', () => {
	assert.equal(validateWorkflow('garbage').errors[0].code, 'INVALID_INPUT');
	assert.equal(validateWorkflow({ nodes: 'x' }).errors[0].code, 'INVALID_INPUT');
	assert.equal(validateWorkflow({ nodes: [], connections: [] }).errors[0].code, 'INVALID_INPUT');
	assert.equal(validateWorkflow({ nodes: [{ name: 1 }] }).errors[0].code, 'INVALID_INPUT');
	assert.deepEqual(validateWorkflow({ nodes: [] }), { valid: true, errors: [] });
});

test('pure: input is not mutated', () => {
	const wf = ref('03-linear');
	const before = JSON.stringify(wf);
	validateWorkflow(wf, { allowCycles: false });
	assert.equal(JSON.stringify(wf), before);
});

test('fixtures: parity fixtures match the TS oracle (regenerate with gen-fixtures.ts if this fails)', () => {
	const dir = resolve(here, 'validation', 'fixtures');
	const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as any)[k])])) : v;
	const files = readdirSync(dir).filter((f) => f.startsWith('D') && f.endsWith('.json'));
	assert.ok(files.length >= 14);
	for (const f of files) {
		const fx = JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
		assert.deepEqual(canon(validateWorkflow(fx.input.workflow, fx.input.options)), fx.expected, f);
	}
});

test('robustness: validateWorkflow never throws and always returns a well-formed report (spec §8)', () => {
	const CODES = new Set(['INVALID_INPUT', 'DUPLICATE_NODE_NAME', 'DANGLING_CONNECTION', 'INVALID_CONNECTION_TYPE', 'CYCLE_DETECTED']);
	const junk: unknown[] = [undefined, null, 0, 1, 'x', true, [], {}, { nodes: null }, { nodes: {} }, { nodes: [null] }, { nodes: [{}] }, { nodes: [{ name: 1 }] },
		{ nodes: [], connections: [] }, { nodes: [], connections: 'x' }, { nodes: [], connections: null },
		{ nodes: [{ name: 'A' }], connections: { A: null } }, { nodes: [{ name: 'A' }], connections: { A: [] } }, { nodes: [{ name: 'A' }], connections: { A: { main: null } } },
		{ nodes: [{ name: 'A' }], connections: { A: { main: {} } } }, { nodes: [{ name: 'A' }], connections: { A: { main: [null, [null], [{}], [{ node: 1 }], [{ node: 'A', type: 7 }], [{ node: 'A', type: 'zzz' }]] } } },
		{ nodes: [{ name: 'A' }], connections: { A: { main: [[{ node: 'A', type: 'main', index: 0 }]] } } }, // self-loop
		{ nodes: [{ name: '' }, { name: '' }], connections: { '': { '': [[{ node: '' }]] } } }, // empty-string names/types
		{ nodes: [{ name: '__proto__' }, { name: 'constructor' }], connections: { __proto__: { main: [[{ node: 'constructor', type: 'main', index: 0 }]] }, constructor: { main: [[{ node: '__proto__', type: 'main', index: 0 }]] } } },
	];
	// deterministic PRNG-generated deep garbage
	let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
	const gen = (d: number): unknown => { const r = rnd(); if (d > 3 || r < 0.2) return [null, 1, 'A', 'B', true][Math.floor(rnd() * 5)]; if (r < 0.5) return Array.from({ length: Math.floor(rnd() * 3) }, () => gen(d + 1)); const o: any = {}; for (const k of ['nodes', 'connections', 'name', 'node', 'type', 'main', 'A', 'B', 'index']) if (rnd() < 0.4) o[k] = gen(d + 1); return o; };
	for (let i = 0; i < 300; i++) junk.push(gen(0));

	for (const w of junk) for (const opts of [{}, { allowCycles: false }]) {
		let r: any; assert.doesNotThrow(() => { r = validateWorkflow(w, opts); }, `threw on ${JSON.stringify(w)}`);
		assert.equal(typeof r.valid, 'boolean'); assert.ok(Array.isArray(r.errors)); assert.equal(r.valid, r.errors.length === 0);
		for (const e of r.errors) { assert.ok(CODES.has(e.code), e.code); assert.equal(typeof e.message, 'string'); if (e.path) assert.ok(e.path.every((p: unknown) => typeof p === 'string')); }
		// determinism: same input twice → identical report
		assert.deepEqual(validateWorkflow(w, opts), r);
	}
	// self-loop shape is frozen (spec §7)
	const self = validateWorkflow({ nodes: [{ name: 'A' }], connections: { A: { main: [[{ node: 'A', type: 'main', index: 0 }]] } } }, { allowCycles: false });
	assert.deepEqual(self.errors, [{ code: 'CYCLE_DETECTED', node: 'A', path: ['connections', 'A', 'main'], message: 'Cycle detected: A → A' }]);
});

test('golden E: INodeSchema (real n8n-workflow 2.9.4) — parity anchor for node shape', { skip: hasRuntime ? false : 'N8N_RUNTIME not found' }, () => {
	const w = n8nRequire('n8n-workflow');
	const base = { id: '1', name: 'A', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [0, 0], parameters: {} };
	const ok = (v: unknown) => w.INodeSchema.safeParse(v);
	const fail = (v: unknown, path: string, code: string) => { const r = ok(v); assert.equal(r.success, false); assert.deepEqual([r.error.issues[0].path.join('.'), r.error.issues[0].code], [path, code]); };
	assert.equal(ok(base).success, true, 'E1 minimal node');
	assert.equal(ok({ ...base, disabled: true, notes: 'n', notesInFlow: true, retryOnFail: true, maxTries: 3, waitBetweenTries: 1000, alwaysOutputData: true, executeOnce: true, onError: 'continueErrorOutput', continueOnFail: false, webhookId: 'w', extendsCredential: 'x', rewireOutputLogTo: 'ai_tool', credentials: { httpBasicAuth: { id: null, name: 'c' } }, forceCustomOperation: { resource: 'r', operation: 'o' } }).success, true, 'E2 all 15 optional fields');
	const { parameters: _p, ...noParams } = base; fail(noParams, 'parameters', 'invalid_type');            // E3 parameters is REQUIRED (not defaulted)
	fail({ ...base, position: [0, 0, 0] }, 'position', 'too_big');                                          // E4 position is a strict 2-tuple
	fail({ ...base, typeVersion: '1' }, 'typeVersion', 'invalid_type');                                     // E5 no coercion
	fail({ ...base, onError: 'explode' }, 'onError', 'invalid_enum_value');                                 // E6 OnErrorSchema enum
	fail({ ...base, rewireOutputLogTo: 'foo' }, 'rewireOutputLogTo', 'invalid_enum_value');                 // E7 NodeConnectionTypeSchema enum
	fail({ ...base, credentials: { x: { name: 'c' } } }, 'credentials.x.id', 'invalid_type');               // E8 credentials.id: string|null, required key
	const extra = ok({ ...base, someFutureField: 42 });                                                     // E9 unknown keys: accepted but STRIPPED (zod default)
	assert.equal(extra.success, true); assert.equal('someFutureField' in extra.data, false, 'zod strips unknown keys — a port must NOT use this schema as a save gate or it loses round-trip data');
	for (const d of ['01-empty-workflow', '03-linear']) {                                                  // E10 reference fixtures conform
		const wf = JSON.parse(readFileSync(resolve(here, '..', d, 'workflow.json'), 'utf8'));
		assert.equal(w.INodesSchema.safeParse(wf.nodes).success, true, d);
	}
});

test('reference fixtures: 229 recorded validateFieldType/tryToParse* results still match the live n8n-workflow 2.9.4 runtime', { skip: hasRuntime ? false : 'N8N_RUNTIME not found' }, () => {
	const w = n8nRequire('n8n-workflow');
	const dir = resolve(here, 'validation', 'fixtures');
	const enc = (v: any): any => v === undefined ? undefined : v && typeof v === 'object' && typeof v.toISO === 'function' && 'zoneName' in v ? { $luxon: v.toISO() } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, enc(x)])) : v;
	const files = readdirSync(dir).filter((f) => f.startsWith('ref-') && f !== 'ref-index.json');
	assert.equal(files.length, 229);
	for (const f of files) {
		const fx = JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
		const args = fx.input.args.map((a: any) => a && typeof a === 'object' && a.$undefined ? undefined : a);
		let actual: any; try { actual = enc(w[fx.fn](...args)); } catch (e: any) { actual = { throws: { name: e.constructor.name, message: e.message } }; }
		assert.deepEqual(actual, fx.expected, f);
	}
});

test('guard fixtures: 352 recorded type-guard results (incl. 21 TypeErrors) still match the live runtime', { skip: hasRuntime ? false : 'N8N_RUNTIME not found' }, () => {
	const w = n8nRequire('n8n-workflow');
	const dir = resolve(here, 'validation', 'fixtures');
	const files = readdirSync(dir).filter((f) => f.startsWith('guard-'));
	assert.equal(files.length, 352);
	let throws = 0;
	for (const f of files) {
		const fx = JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
		const v = fx.input.value && typeof fx.input.value === 'object' && fx.input.value.$undefined ? undefined : fx.input.value;
		let actual: any; try { actual = w[fx.fn](v); } catch (e: any) { actual = { throws: { name: e.constructor.name, message: e.message } }; throws++; }
		assert.deepEqual(actual, fx.expected, f);
	}
	assert.equal(throws, 21, 'three item-guards × seven non-object inputs');
});
