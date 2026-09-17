/** Gate 3 — behaviour through the seam == recorded n8n 2.9.4 behaviour (229 + 352 + 1125 fixtures) and the rule oracle (D01–D14). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const PKG = join(fileURLToPath(import.meta.url), '..', '..');
const FX = join(PKG, '../../tests/reference/agent-4/validation/fixtures');
const lego = await import(join(PKG, 'src/index.ts'));
const un = (v) => v && typeof v === 'object' && v.$undefined ? undefined : v;
const enc = (v) => v === undefined ? undefined : v && typeof v === 'object' && typeof v.toISO === 'function' && 'zoneName' in v ? { $luxon: v.toISO() } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, enc(x)])) : v;
const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;

test('type-validation: 229 recorded cases through the seam', () => {
	let n = 0;
	for (const f of readdirSync(FX).filter((f) => f.startsWith('ref-') && f !== 'ref-index.json')) {
		const fx = JSON.parse(readFileSync(join(FX, f), 'utf8')); let actual;
		try { actual = enc(lego[fx.fn](...fx.input.args.map(un))); } catch (e) { actual = { throws: { name: e.constructor.name, message: e.message } }; }
		assert.deepEqual(actual, fx.expected, f); n++;
	}
	assert.equal(n, 229);
});
test('type-guards: 352 recorded cases through the seam', () => {
	let n = 0;
	for (const f of readdirSync(FX).filter((f) => f.startsWith('guard-'))) {
		const fx = JSON.parse(readFileSync(join(FX, f), 'utf8')); let actual;
		try { actual = lego[fx.fn](un(fx.input.value)); } catch (e) { actual = { throws: { name: e.constructor.name, message: e.message } }; }
		assert.deepEqual(actual, fx.expected, f); n++;
	}
	assert.equal(n, 352);
});
test('schemas: 1125 recorded cases + frozen enums through the seam', () => {
	const lines = readFileSync(join(FX, 'schema-cases.jsonl'), 'utf8').trim().split('\n'); assert.equal(lines.length, 1125);
	for (const l of lines) { const fx = JSON.parse(l); const r = lego.schemas[fx.schema].safeParse(un(fx.input.value));
		assert.deepEqual(r.success ? { success: true, data: r.data === undefined ? { $undefined: true } : r.data } : { success: false, issues: r.error.issues.map((i) => ({ path: i.path, code: i.code })) }, fx.expected, fx.id); }
	const enums = JSON.parse(readFileSync(join(FX, 'schema-enums.json'), 'utf8')).enums;
	assert.deepEqual([...enums.NodeConnectionTypeSchema].sort(), [...lego.NODE_CONNECTION_TYPES].sort());
});
test('rules: oracle fixtures D01–D14 through the seam', () => {
	const files = readdirSync(FX).filter((f) => /^D\d\d-/.test(f)); assert.equal(files.length, 14);
	for (const f of files) { const fx = JSON.parse(readFileSync(join(FX, f), 'utf8')); assert.deepEqual(canon(lego.validateWorkflow(fx.input.workflow, fx.input.options)), fx.expected, f); }
});
