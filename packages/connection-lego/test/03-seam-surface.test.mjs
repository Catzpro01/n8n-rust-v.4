/**
 * Gate 3 — seam parity: model-surface exports exactly the runtime symbols declared in manifest/ownership.json,
 * and src/index.ts still declares rustImplementation: 'not-started'.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PKG } from './_setup.mjs';

const manifest = JSON.parse(readFileSync(join(PKG, 'manifest', 'ownership.json'), 'utf8'));

test('model-surface runtime exports == manifest publicSurface.runtime', async () => {
	const M = await import('../src/model-surface.ts');
	const runtime = Object.keys(M).filter((k) => typeof M[k] === 'function').sort();
	assert.deepEqual(runtime, [...manifest.publicSurface.runtime].sort());
});

test('providedPort symbol groups cover the runtime surface exactly', () => {
	const { traversal, graph, content } = manifest.providedPort.symbols;
	assert.deepEqual([...traversal, ...graph, ...content].sort(), [...manifest.publicSurface.runtime].sort());
});

test('index declares LEGO metadata with rustImplementation not-started', async () => {
	const I = await import('../src/index.ts');
	assert.equal(I.LEGO.name, 'connection');
	assert.equal(I.LEGO.rustImplementation, 'not-started');
	assert.equal(I.LEGO.pinnedReference, 'n8n@2.9.4');
	assert.equal(I.portMode(), process.env.LEGO_PORT_MODE === 'strict' ? 'strict' : 'reference');
});
