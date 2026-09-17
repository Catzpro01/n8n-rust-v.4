/** Gate 1 — boundary integrity: owned sources are byte-pinned, their import closure matches the declared ports, reference tree untouched. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const PKG = join(fileURLToPath(import.meta.url), '..', '..'); const REPO = join(PKG, '..', '..');
const SRC = join(REPO, 'reference/n8n/packages/workflow/src');
const manifest = JSON.parse(readFileSync(join(PKG, 'manifest/ownership.json'), 'utf8'));

test('owned reference sources are byte-identical to the pinned hashes', () => {
	for (const f of manifest.owns.files) {
		const sha = createHash('sha256').update(readFileSync(join(SRC, `${f}.ts`))).digest('hex');
		assert.equal(sha, manifest.owns.sha256[f], `${f}.ts drifted from the pin`);
	}
});

test('import closure of the owned sources == declared ports (no undeclared crossing)', () => {
	const declared = new Set(['./interfaces', './errors', './utils', './type-guards', 'luxon', 'zod', 'lodash/isObject']);
	const seen = new Set();
	for (const f of manifest.owns.files) for (const m of readFileSync(join(SRC, `${f}.ts`), 'utf8').matchAll(/from '([^']+)'/g)) seen.add(m[1]);
	const undeclared = [...seen].filter((s) => !declared.has(s));
	assert.deepEqual(undeclared, [], `undeclared imports: ${undeclared.join(', ')}`);
	// intra-LEGO edge only: type-validation -> type-guards
	assert.ok(seen.has('./type-guards'));
});

test('owned schema surface == `export const *Schema` in the pinned schemas.ts', () => {
	const names = (readFileSync(join(SRC, 'schemas.ts'), 'utf8').match(/^export const ([A-Za-z0-9_]+Schema)/gm) ?? []).map((l) => l.split(' ')[2]);
	const frozen = JSON.parse(readFileSync(join(PKG, 'manifest/schema-surface.json'), 'utf8'));
	assert.deepEqual(names, frozen.names); assert.equal(frozen.count, 45);
});

test('the new capability has zero imports (standalone, additive)', () => {
	const src = readFileSync(join(PKG, 'src/rules/workflow-rules.ts'), 'utf8');
	assert.equal((src.match(/^import /gm) ?? []).length, 0);
});
