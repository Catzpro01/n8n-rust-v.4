/**
 * Gate 5 — surface parity + reference integrity.
 *
 * The public surface declared in the manifest, implemented by the TS facade and
 * generated for the isolated unit must be the SAME set of symbols. Otherwise
 * downstream LEGOs would depend on something the isolation does not actually
 * provide.
 *
 * Additionally: the reference tree must be byte-identical to the pinned hashes —
 * this is what licenses the claim "n8n still behaves identically".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST } from '../../../tools/workflow-boundary-map.mjs';
import { MODEL_SURFACE_NAMES } from '../../../tools/reference-model-api.mjs';

const PKG = join(fileURLToPath(import.meta.url), '..', '..');
const REPO = join(PKG, '..', '..');
const require = createRequire(import.meta.url);

test('manifest public surface == harness surface == facade exports', () => {
	const declared = [
		...MANIFEST.publicSurface.aggregate,
		...MANIFEST.publicSurface.graph,
		...MANIFEST.publicSurface.content,
	].sort();
	assert.deepEqual(declared, [...MODEL_SURFACE_NAMES].sort(), 'manifest and harness disagree on the public surface');

	const facade = readFileSync(join(PKG, 'src', 'model-surface.ts'), 'utf8');
	for (const name of declared) {
		assert.match(facade, new RegExp(`\\b${name}\\b`), `facade does not export ${name}`);
	}
});

test('isolated unit exposes exactly the declared runtime surface', () => {
	const built = require(join(PKG, '.extract', 'dist', 'model-api.js'));
	const exported = Object.keys(built)
		.filter((k) => typeof built[k] === 'function')
		.sort();
	assert.deepEqual(exported, [...MODEL_SURFACE_NAMES].sort());
});

test('reference tree is byte-identical to the pinned hashes', () => {
	const result = spawnSync(process.execPath, [join(REPO, 'tools', 'workflow-reference-manifest.mjs'), '--check'], {
		cwd: REPO,
		encoding: 'utf8',
	});
	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
	assert.match(result.stdout, /Reference integrity check: PASS/);
});

test('LEGO provenance records the unconditional ZERO-RUST policy', () => {
	const src = readFileSync(join(PKG, 'src', 'index.ts'), 'utf8');
	assert.match(src, /rustImplementation: 'forbidden'/);
	assert.ok(existsSync(join(PKG, 'manifest', 'ownership.json')));
});
