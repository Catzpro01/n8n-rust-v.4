/** Gate 2 — the facade exports exactly the manifest's public surface, and each reference symbol is the ORIGINAL (identity, not a copy). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const PKG = join(fileURLToPath(import.meta.url), '..', '..');
const manifest = JSON.parse(readFileSync(join(PKG, 'manifest/ownership.json'), 'utf8'));
const lego = await import(join(PKG, 'src/index.ts'));
const ref = createRequire(join(lego.referencePackage(), 'package.json'))('n8n-workflow');

test('facade exports the declared public surface', () => {
	for (const n of [...manifest.publicSurface.typeValidation, ...manifest.publicSurface.typeGuards, ...manifest.publicSurface.rules]) assert.equal(typeof lego[n], n === 'NODE_CONNECTION_TYPES' ? 'object' : 'function', n);
	assert.equal(Object.keys(lego.schemas).length, 45);
});
test('reference symbols are the pinned originals by identity (1:1, no rewrite)', () => {
	for (const n of [...manifest.publicSurface.typeValidation, ...manifest.publicSurface.typeGuards]) assert.equal(lego[n], ref[n], n);
	for (const [k, s] of Object.entries(lego.schemas)) assert.equal(s, ref[k], k);
});
test('provenance: reference 2.9.4 pinned, Rust not started', () => {
	assert.equal(lego.LEGO_PROVENANCE.referenceCommit, manifest.reference.pinnedCommit);
	assert.equal(lego.LEGO_PROVENANCE.rustImplementation, 'not-started');
	assert.equal(createRequire(join(lego.referencePackage(), 'package.json'))('n8n-workflow/package.json').version, '2.9.1');
});
