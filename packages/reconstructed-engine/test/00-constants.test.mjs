/**
 * Gate 00 — constants.
 *
 * `src/constants.mjs` claims to be a COMPLETE port of
 * `packages/workflow/src/constants.ts`. Two independent ways to be wrong:
 * a value drifts, or the export SET drifts (a renamed or dropped constant still
 * passes a value-by-value test that iterates over what my module exports).
 *
 * So the check runs in two modes:
 *   offline — compare against fixtures/reference-snapshot.json, which was read
 *             out of the reference package and committed. Always runs.
 *   live    — re-derive the same lists from the installed runtime and compare
 *             them to the snapshot, which is what proves the snapshot is not
 *             stale. Runs when the runtime resolves, and says so out loud.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const PKG = resolve(import.meta.dirname, '..');
const snapshot = JSON.parse(readFileSync(join(PKG, 'fixtures', 'reference-snapshot.json'), 'utf8'));
const mine = await import('../src/constants.mjs');
const require = createRequire(import.meta.url);

const decode = (value) => {
	if (value && typeof value === 'object') {
		if ('#date' in value) return new Date(value['#date']);
		if ('#set' in value) return new Set(value['#set'].map(decode));
		if ('#map' in value) return new Map(value['#map'].map(([k, v]) => [k, decode(v)]));
		if (Array.isArray(value)) return value.map(decode);
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v)]));
	}
	return value;
};

const encode = (value) => {
	if (value instanceof Date) return { '#date': value.toISOString() };
	if (value instanceof Set) return { '#set': [...value].map(encode) };
	if (value instanceof Map) return { '#map': [...value.entries()].map(([k, v]) => [k, encode(v)]) };
	if (Array.isArray(value)) return value.map(encode);
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
	}
	return value;
};

test('constants: every reference export exists here with the identical value', () => {
	const names = Object.keys(snapshot.constants);
	assert.ok(names.length > 60, `snapshot looks truncated (${names.length} names)`);
	const diffs = [];
	for (const name of names) {
		if (!(name in mine)) {
			diffs.push(`${name}: MISSING from src/constants.mjs`);
			continue;
		}
		// Compare the ENCODED forms: the snapshot is encoded, and encoding is the
		// canonical comparison (it turns Date/Set/Map into ordered JSON).
		const expected = JSON.stringify(encode(mine[name]));
		const actual = JSON.stringify(snapshot.constants[name]);
		if (expected !== actual) diffs.push(`${name}: mine=${expected} reference=${actual}`);
	}
	assert.deepEqual(diffs, [], 'constants drifted from the recorded reference values');
});

test('constants: no undeclared extras', () => {
	const surface = JSON.parse(readFileSync(join(PKG, 'manifest', 'port-surface.json'), 'utf8'));
	const declared = Object.keys(surface.modules['constants.mjs'].additions ?? {});
	const extras = Object.keys(mine).filter((k) => !(k in snapshot.constants));
	assert.deepEqual(
		extras.sort(),
		declared.sort(),
		`src/constants.mjs exports symbols that are not in the reference module and not declared as additions in the manifest (${declared.join(', ')}). Either drop them or declare them in test/helpers/record-surface.mjs`,
	);
});

test('constants: arrays and sets are mutable, matching the compiled reference', () => {
	// The reference does not freeze these. Freezing them here would be a silent
	// behaviour change for every caller that pushes into a returned array.
	assert.ok(Array.isArray(mine.SCRIPTING_NODE_TYPES));
	// `Object.isFrozen` rather than a mutation: the suite shares this module, and a
	// mutation that leaks into another test file is worse than the deviation caught.
	assert.equal(Object.isFrozen(mine.SCRIPTING_NODE_TYPES), false);
	assert.equal(Object.isFrozen(mine.NODES_WITH_RENAMABLE_CONTENT), false);
	assert.equal(mine.WAIT_INDEFINITELY.toISOString(), '3000-01-01T00:00:00.000Z');
});

test('constants: live reference agrees with the committed snapshot (stale-snapshot guard)', async (t) => {
	const { referenceRuntime } = await import('../src/reference-runtime.mjs');
	const runtime = referenceRuntime();
	if (!runtime) {
		t.diagnostic('reference runtime not installed — live comparison not run (offline gate)');
		return;
	}
	const req = createRequire(join(runtime.dir, 'noop.js'));
	const ref = req(join(runtime.dir, 'n8n-workflow/dist/cjs/constants.js'));
	const live = Object.fromEntries(Object.entries(ref).map(([k, v]) => [k, encode(v)]));
	assert.deepEqual(
		live,
		snapshot.constants,
		'fixtures/reference-snapshot.json no longer matches the installed runtime — re-record with test/helpers/record-surface.mjs',
	);
	assert.deepEqual(
		Object.keys(live).sort(),
		Object.keys(snapshot.constants).sort(),
		'snapshot export set drifted from the installed runtime',
	);
});
