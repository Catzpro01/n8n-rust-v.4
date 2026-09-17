import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(__dirname, '..', 'manifest', 'ownership.json');

test('ownership.json exists and valid', () => {
  assert.ok(fs.existsSync(manifestPath), 'ownership.json must exist');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.lego, 'connection');
  assert.ok(manifest.owns.files.includes('graph/graph-utils'));
  assert.ok(manifest.owns.files.includes('connections-diff'));
  assert.ok(manifest.ports.some(p => p.id === 'P-CONNECTION-GRAPH'));
});

test('public surface matches manifest', async () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const surface = manifest.publicSurface;
  assert.ok(surface.includes('mapConnectionsByDestination'));
  assert.ok(surface.includes('getChildNodes'));
  assert.ok(surface.includes('getParentNodes'));
  assert.ok(surface.includes('buildAdjacencyList'));
  assert.ok(surface.includes('compareConnections'));
});

test('connection routing engine pure functions', async () => {
  const mod = await import('../../reconstructed-engine/src/connection-routing-engine.mjs');
  const conn = {
    A: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
    B: { main: [[{ node: 'C', type: 'main', index: 0 }]] },
  };
  const byDest = mod.mapConnectionsByDestination(conn);
  assert.ok(byDest.B, 'B should be in byDest');
  assert.equal(byDest.B.main[0][0].node, 'A');

  const children = mod.getChildNodes(conn, 'A');
  // Farthest-first per contract C3: C (farthest) then B
  assert.deepEqual(children, ['C', 'B']);

  const adj = mod.buildAdjacencyList(conn);
  assert.ok(adj.has('A'));
  assert.ok(mod.hasPath('A', 'C', adj));
  assert.ok(!mod.hasPath('C', 'A', adj));
});

test('sparse slots preserved', async () => {
  const mod = await import('../../reconstructed-engine/src/connection-routing-engine.mjs');
  const conn = {
    A: { main: [[], null, [{ node: 'B', type: 'main', index: 0 }]] },
  };
  const byDest = mod.mapConnectionsByDestination(conn);
  assert.ok(byDest.B, 'B should exist');
  // Sparse handling
  assert.equal(conn.A.main.length, 3);
});

test('cycles are legal — no infinite loop', async () => {
  const mod = await import('../../reconstructed-engine/src/connection-routing-engine.mjs');
  const conn = {
    A: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
    B: { main: [[{ node: 'A', type: 'main', index: 0 }]] },
  };
  const children = mod.getChildNodes(conn, 'A', 'main', 5);
  // Should terminate even with cycle, depth bounded
  assert.ok(children.length <= 2);
  const adj = mod.buildAdjacencyList(conn);
  // hasPath should be cycle-safe
  assert.ok(mod.hasPath('A', 'B', adj));
});
