/**
 * P3 Slice A — persistent logical graph (Issues #75/#97, marathon §30 Slice A).
 *
 * Proves: canonical stays authoritative · chunked partial reads · one-chunk
 * access (readStats) · name→ordinal index · lossless deep-equal roundtrip ·
 * n8n-editor contract checksum · fail-closed bundle integrity · determinism ·
 * no artificial node-count ceiling.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GRAPH_CHUNK_DEFAULT_SIZE,
  WORKFLOW_GRAPH_BUNDLE_VERSION,
  WORKFLOW_GRAPH_CONTRACT,
  WORKFLOW_GRAPH_CONTRACT_VERSION,
  WORKFLOW_GRAPH_LIMITS,
  WorkflowGraphError,
  createWorkflowGraph,
  graphFromBundle,
} from '../src/lego/workflow-graph.mjs';
import { calculateWorkflowChecksum } from '../src/checksum.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const read = (relative) => readFileSync(join(REPO_ROOT, relative), 'utf8');
const LOCK = JSON.parse(read('apps/n8n-lego/src/lego/contracts/contract-lock.json'));
const ROWS = LOCK.contracts ?? LOCK;
const DOMAINS = JSON.parse(read('apps/n8n-lego/src/lego/manifest/domains.json'));
const WORKFLOW = (DOMAINS.domains ?? DOMAINS).find((d) => d.id === 'workflow');
const ERRORS = JSON.parse(read('apps/n8n-lego/src/lego/contracts/errors.contract.json'));

const caught = (fn) => {
  try { fn(); return null; } catch (error) { return error; }
};

function sampleDefinition() {
  return {
    name: 'P3 slice A sample',
    settings: { timezone: 'Asia/Jakarta', executionOrder: 'v1' },
    meta: { instanceId: 'i-test' },
    pinData: { Start: [{ json: { seeded: true } }] },
    active: false,
    nodes: [
      { name: 'Start', type: 'n8n-nodes-base.start', typeVersion: 1, position: [0, 0], parameters: {}, id: 'n1' },
      { name: 'HTTP', type: 'n8n-nodes-base.httpRequest', typeVersion: 4, position: [200, 0], parameters: { url: 'https://example.test' }, id: 'n2' },
      { name: 'Branch', type: 'n8n-nodes-base.if', typeVersion: 2, position: [400, 0], parameters: {}, id: 'n3' },
      { name: 'Set A', type: 'n8n-nodes-base.set', typeVersion: 3, position: [600, -80], parameters: {}, id: 'n4' },
      { name: 'Set B', type: 'n8n-nodes-base.set', typeVersion: 3, position: [600, 80], parameters: {}, id: 'n5' },
    ],
    connections: {
      Start: { main: [[{ node: 'HTTP', type: 'main', index: 0 }]] },
      HTTP: { main: [[{ node: 'Branch', type: 'main', index: 0 }]] },
      Branch: { main: [[{ node: 'Set A', type: 'main', index: 0 }], [{ node: 'Set B', type: 'main', index: 0 }]] },
      'Set A': { main: [[]] },
      Ghost: { main: [[{ node: 'Start', type: 'main', index: 0 }]] },
    },
  };
}

/* ================================================= A. CONTRACT / LOCK ROW */

test('the lock row is the thirty-third: workflow.graph@1.0.0, owner agent-1, exports byte-parity', () => {
  const row = ROWS.find((r) => r.id === 'workflow.graph');
  assert.ok(row, 'workflow.graph is locked');
  assert.equal(ROWS.length, 33, 'P3 Slice A adds exactly one row — count-pins say 33');
  assert.equal(row.owner, 'agent-1', 'Issue #98: Agent 1 owns the workflow graph');
  assert.equal(row.domain, 'workflow');
  assert.equal(row.version, '0.1.0', 'R9: matches the workflow domain contract version (0.1.0)');
  assert.equal(row.status, 'implemented');
  assert.deepEqual(row.surface, ['src/lego/workflow-graph.mjs']);
  const module_ = {
    GRAPH_CHUNK_DEFAULT_SIZE, WORKFLOW_GRAPH_BUNDLE_VERSION, WORKFLOW_GRAPH_CONTRACT,
    WORKFLOW_GRAPH_CONTRACT_VERSION, WORKFLOW_GRAPH_LIMITS, WorkflowGraphError,
    createWorkflowGraph, graphFromBundle,
  };
  const locked = row.exports['src/lego/workflow-graph.mjs'];
  assert.deepEqual([...locked].sort(), Object.keys(module_).sort(), 'lock ⇄ module exports');
  assert.deepEqual([...locked], [...locked].slice().sort(), 'sorted ASCII');
  assert.deepEqual(row.tests, ['apps/n8n-lego/test/lego-workflow-graph.test.mjs']);
  assert.equal('operations' in row, false, 'no capability/REST surface in Slice A (by design)');
  assert.equal('permissions' in row, false);
  assert.equal(WORKFLOW_GRAPH_CONTRACT.id, row.id);
  assert.equal(WORKFLOW_GRAPH_CONTRACT_VERSION, row.version);
  assert.equal(WORKFLOW_GRAPH_CONTRACT.owner, row.owner);
});

test('the workflow domain owns the module; no capability was added; the n8n checksum seam stays', () => {
  assert.ok(WORKFLOW.paths.includes('src/lego/workflow-graph.mjs'));
  assert.ok(WORKFLOW.paths.includes('src/checksum.mjs'), 'the checksum seam is still the domain');
  assert.equal(WORKFLOW.capabilities.length, 4, 'workflow.checksum/crud/history/source-control unchanged');
  assert.equal(WORKFLOW.status, 'partial', 'domain status unchanged by a slice');
  assert.equal(ERRORS.version, '1.2.0', 'errors contract untouched');
  // one error family, published code
  for (const match of readFileSync(join(REPO_ROOT, 'apps/n8n-lego/src/lego/workflow-graph.mjs'), 'utf8').matchAll(/'(lego\.[a-z0-9_]+)'/g)) {
    const published = new Set((ERRORS.codes ?? ERRORS.errors ?? []).map((e) => e.code ?? e.id));
    assert.ok(published.has(match[1]), `${match[1]} is published`);
  }
});

/* ==================================================== B. BUILD / VALIDATE */

test('a canonical definition builds a manifest carrying the n8n-editor checksum', () => {
  const def = sampleDefinition();
  const graph = createWorkflowGraph(def);
  const manifest = graph.manifest();
  assert.equal(manifest.contract, 'workflow.graph@0.1.0');
  assert.equal(manifest.bundleVersion, WORKFLOW_GRAPH_BUNDLE_VERSION);
  assert.equal(manifest.checksum, calculateWorkflowChecksum(def), 'manifest checksum IS the n8n contract checksum');
  assert.equal(manifest.nodeCount, 5);
  assert.equal(manifest.edgeCount, 5, 'Start→HTTP, HTTP→Branch, Branch→A, Branch→B, Ghost→Start');
  assert.equal(manifest.chunkSize, GRAPH_CHUNK_DEFAULT_SIZE);
  assert.equal(manifest.chunkCount, Math.ceil(5 / GRAPH_CHUNK_DEFAULT_SIZE));
  assert.equal(typeof manifest.chunkDigest, 'string');
  assert.equal(manifest.chunkDigest.length, 64);
  assert.equal(manifest.canonical, true);
  assert.equal(graph.nodeCount(), 5);
  assert.equal(graph.edgeCount(), 5);
});

test('build is deterministic: two builds of the same definition produce identical manifests', () => {
  const def = sampleDefinition();
  const a = createWorkflowGraph(def).manifest();
  const b = createWorkflowGraph(def).manifest();
  assert.deepEqual(a, b, 'same input ⇒ same checksum, same chunk digest, same addressing');
});

test('the canonical input is never mutated by graph construction', () => {
  const def = sampleDefinition();
  const before = JSON.stringify(def);
  const graph = createWorkflowGraph(def, { chunkSize: 2 });
  graph.exportDefinition();
  graph.exportBundle();
  assert.equal(JSON.stringify(def), before, 'the author document stays byte-identical');
});

test('validation refuses malformed definitions with the one error family', () => {
  for (const bad of [null, 'def', 42, []]) {
    const error = caught(() => createWorkflowGraph(bad));
    assert.ok(error);
    assert.ok(error instanceof WorkflowGraphError);
    assert.equal(error.code, 'lego.contract_violation');
  }
  assert.match(caught(() => createWorkflowGraph({ connections: {} })).message, /nodes must be an array/);
  assert.match(caught(() => createWorkflowGraph({ nodes: [] })).message, /connections must be an object/);
  const dup = caught(() => createWorkflowGraph({
    nodes: [{ name: 'A', type: 't', position: [0, 0], parameters: {} }, { name: 'A', type: 't', position: [1, 1], parameters: {} }],
    connections: {},
  }));
  assert.equal(dup.details.reason, 'duplicate-name');
  const nameless = caught(() => createWorkflowGraph({ nodes: [{ type: 't' }], connections: {} }));
  assert.equal(nameless.details.field, 'node.name');
  const overlong = caught(() => createWorkflowGraph({ nodes: [{ name: 'x'.repeat(257) }], connections: {} }));
  assert.match(overlong.message, /1\.\.256/);
  assert.match(caught(() => createWorkflowGraph({ nodes: [], connections: {} }, { chunkSize: 0 })).message, /chunkSize/);
});

test('there is no artificial node-count ceiling — a large logical graph builds fine', () => {
  assert.equal('maxNodes' in WORKFLOW_GRAPH_LIMITS, false, 'anti-pattern 13: no artificial low node limit');
  const nodes = Array.from({ length: 5000 }, (_, i) => ({ name: `N${i}`, type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [i, 0], parameters: {} }));
  const graph = createWorkflowGraph({
    name: 'wide', nodes,
    connections: Object.fromEntries(nodes.map((n) => [n.name, { main: [] }])),
  });
  assert.equal(graph.nodeCount(), 5000);
  assert.equal(graph.chunkCount(), Math.ceil(5000 / GRAPH_CHUNK_DEFAULT_SIZE));
  assert.ok(graph.getNode('N4999'), 'the last logical node is reachable by index');
});

/* ================================== C. LOSSLESS ROUNDTRIP / CANONICAL TRUTH */

test('exportDefinition deep-equals the canonical definition (header + nodes + connections + orphans)', () => {
  const def = sampleDefinition();
  const graph = createWorkflowGraph(def, { chunkSize: 2 });
  assert.deepStrictEqual(graph.exportDefinition(), def,
    'canonical recovery: same semantics, same data, orphan Ghost preserved');
  const bundleGraph = graphFromBundle(JSON.parse(JSON.stringify(graph.exportBundle())));
  assert.deepStrictEqual(bundleGraph.exportDefinition(), def);
  assert.equal(calculateWorkflowChecksum(bundleGraph.exportDefinition()),
    calculateWorkflowChecksum(def), 'the editor checksum survives every roundtrip');
});

test('bundle survives JSON serialization (durable wire format)', () => {
  const def = sampleDefinition();
  const graph = createWorkflowGraph(def, { chunkSize: 2 });
  const wire = JSON.parse(JSON.stringify(graph.exportBundle()));
  assert.equal(wire.bundleVersion, WORKFLOW_GRAPH_BUNDLE_VERSION);
  const restored = graphFromBundle(wire);
  assert.deepStrictEqual(restored.exportDefinition(), def);
  assert.deepEqual(restored.manifest(), graph.manifest());
});

/* ============================================= D. CHUNKING / PARTIAL READS */

test('getChunk is a bounded partial read of exactly one chunk', () => {
  const nodes = Array.from({ length: 7 }, (_, i) => ({ name: `N${i}`, type: 't', position: [i, 0], parameters: { v: i } }));
  const graph = createWorkflowGraph({ name: 'c', nodes, connections: {} }, { chunkSize: 3 });
  assert.equal(graph.chunkCount(), 3, '7 nodes / size 3 → chunks of 3,3,1');
  const first = graph.getChunk(0);
  assert.equal(first.length, 3);
  assert.deepEqual(first.map((n) => n.name), ['N0', 'N1', 'N2']);
  const last = graph.getChunk(2);
  assert.equal(last.length, 1);
  assert.deepEqual(last.map((n) => n.name), ['N6']);
  for (const bad of [-1, 3, 1.5, '0']) {
    const error = caught(() => graph.getChunk(bad));
    assert.ok(error, `chunk ${bad} refuses`);
    assert.equal(error.details.reason, 'out-of-range');
  }
});

test('one-chunk discipline: every single accessor touches exactly one chunk (readStats)', () => {
  const nodes = Array.from({ length: 3000 }, (_, i) => ({ name: `N${i}`, type: 't', position: [i, 0], parameters: {} }));
  const graph = createWorkflowGraph({ name: 'stats', nodes, connections: {} });
  graph.resetReadStats();
  graph.getNode('N0');
  assert.equal(graph.readStats().chunkReads, 1, 'getNode → exactly one chunk, never a scan');
  graph.getNode('N2999');
  assert.equal(graph.readStats().chunkReads, 2, 'last node still one chunk (index, not search)');
  graph.getChunk(1);
  assert.equal(graph.readStats().chunkReads, 3);
  graph.getOutgoingConnections('N0');
  assert.equal(graph.readStats().chunkReads, 4, 'edge reads are chunked too');
  graph.resetReadStats();
  assert.equal(graph.readStats().chunkReads, 0);
});

test('node access: hasNode, unknown-node refusal, ordinal-order iteration', () => {
  const def = sampleDefinition();
  const graph = createWorkflowGraph(def, { chunkSize: 2 });
  assert.equal(graph.hasNode('HTTP'), true);
  assert.equal(graph.hasNode('Nope'), false);
  const error = caught(() => graph.getNode('Nope'));
  assert.equal(error.details.reason, 'unknown-node');
  const edgeError = caught(() => graph.getOutgoingConnections('Nope'));
  assert.equal(edgeError.details.reason, 'unknown-node');
  assert.deepEqual([...graph.nodeNames()], def.nodes.map((n) => n.name), 'iteration preserves canonical order');
});

test('connections are bucketed per source chunk and read back losslessly', () => {
  const def = sampleDefinition();
  const graph = createWorkflowGraph(def, { chunkSize: 2 });
  assert.deepEqual(graph.getOutgoingConnections('Start'), def.connections.Start);
  assert.deepEqual(graph.getOutgoingConnections('Branch'), def.connections.Branch);
  assert.equal(graph.hasNode('Ghost'), false, 'an orphan connection key is NOT a node');
  assert.equal(caught(() => graph.getOutgoingConnections('Ghost')).details.reason, 'unknown-node',
    'identity rule: edge access is indexed by node ordinal; orphans survive via exportDefinition only');
  assert.deepEqual(graph.getOutgoingConnections('Set A'), def.connections['Set A']);
  assert.deepEqual(graph.getOutgoingConnections('Set B'), {}, 'a node without connections answers empty');
});

/* =========================================== E. INTEGRITY / FAIL-CLOSED LOAD */

test('integrity() re-verifies the resident digest and detects corruption', () => {
  const def = sampleDefinition();
  const graph = createWorkflowGraph(def, { chunkSize: 2 });
  assert.equal(graph.integrity().ok, true);
  const bundle = JSON.parse(JSON.stringify(graph.exportBundle()));
  bundle.nodeChunks[0][0] = bundle.nodeChunks[0][0].replace('Start', 'StartTampered');
  const refused = caught(() => graphFromBundle(bundle));
  assert.ok(refused, 'a tampered bundle must be refused');
  assert.equal(refused.code, 'lego.contract_violation');
  assert.equal(refused.details.reason, 'integrity-mismatch');
  assert.match(refused.message, /integrity/);
});

test('graphFromBundle fails closed on structural damage before any node is served', () => {
  const def = sampleDefinition();
  const bundle = JSON.parse(JSON.stringify(createWorkflowGraph(def).exportBundle()));
  assert.match(caught(() => graphFromBundle(null)).message, /bundle/);
  const wrongVersion = { ...bundle, bundleVersion: 99 };
  wrongVersion.manifest = { ...bundle.manifest }; // digest path still guards below
  assert.equal(caught(() => graphFromBundle(wrongVersion)).details.reason, 'unsupported-version');
  const missingChunks = { ...bundle, nodeChunks: 'nope' };
  assert.match(caught(() => graphFromBundle(missingChunks)).message, /equal length|array/);
  const wrongCount = JSON.parse(JSON.stringify(bundle));
  wrongCount.manifest.nodeCount = wrongCount.manifest.nodeCount + 1;
  // digest still matches (manifest change only) → count check must catch it
  const countError = caught(() => graphFromBundle(wrongCount));
  assert.equal(countError.details.reason, 'count-mismatch');
});

/* ==================================== F. RESIDENCY SHAPE / P3 INVARIANT PROOF */

test('resident form stores strings and integers — not one live object per node', () => {
  const n = 4000;
  const nodes = Array.from({ length: n }, (_, i) => ({ name: `N${i}`, type: 't', position: [i, 0], parameters: { payload: `value-${i}` } }));
  const graph = createWorkflowGraph({ name: 'res', nodes, connections: {} });
  const bundle = graph.exportBundle();
  assert.ok(bundle.nodeChunks.every((chunk) => chunk.every((entry) => typeof entry === 'string')),
    'nodes live as verbatim JSON strings in the resident form');
  assert.equal(graph.integrity().ok, true);
  // the invariant: logical count exists as data, resident index holds integers
  // (name→ordinal), and accessing any single node never materializes the graph
  graph.resetReadStats();
  graph.getNode(`N${n - 1}`);
  assert.equal(graph.nodeCount(), n, 'logical size recorded');
  assert.equal(graph.readStats().chunkReads, 1, 'working set for a lookup = one chunk, not the graph');
});

test('manifest is frozen and readStats are copies — callers cannot corrupt the graph state', () => {
  const graph = createWorkflowGraph(sampleDefinition());
  const manifest = graph.manifest();
  assert.equal(Object.isFrozen(manifest), true);
  assert.equal(graph.readStats() === graph.readStats(), false, 'stats are value copies');
  const stats = graph.readStats();
  stats.chunkReads = 9999;
  graph.getNode('Start');
  assert.equal(graph.readStats().chunkReads, 1, 'external mutation of stats never lands inside');
});

/* ============================== G. SLICE B — INDEXED EDGE ACCESS */

test('the reverse index is lazy: not built at construction, 0 reads until asked', () => {
  const graph = createWorkflowGraph(sampleDefinition(), { chunkSize: 2 });
  assert.equal(graph.hasReverseIndex(), false, 'deriving the index at build time would defeat laziness');
  graph.resetReadStats();
  assert.equal(graph.readStats().chunkReads, 0);
});

test('getIncoming materializes once (one read per edge bucket) then serves pure index hits', () => {
  const graph = createWorkflowGraph(sampleDefinition(), { chunkSize: 2 });
  graph.resetReadStats();
  const incomingHTTP = graph.getIncoming('HTTP');
  assert.equal(graph.hasReverseIndex(), true);
  const buckets = graph.exportBundle().edgeChunks.filter((entry) => entry !== '').length;
  assert.equal(graph.readStats().chunkReads, buckets,
    'materialization = one read per NON-EMPTY edge bucket, once (empty buckets are never read)');
  assert.deepEqual(incomingHTTP, [{ source: 'Start', type: 'main', index: 0 }]);
  graph.getIncoming('Branch');
  graph.getIncoming('Set A');
  assert.equal(graph.readStats().chunkReads, buckets, 'subsequent lookups are index hits — 0 chunk reads');
  assert.equal(graph.releaseReverseIndex(), true, 'evict drops the derived index');
  assert.equal(graph.hasReverseIndex(), false);
  graph.getIncoming('Start');
  assert.equal(graph.hasReverseIndex(), true, 'rematerializes on demand');
  assert.equal(graph.readStats().chunkReads, buckets * 2, 'second build pays the bucket reads again');
});

test('reverse lookups are correct, ordered, frozen — and dangling targets are never indexed', () => {
  const def = sampleDefinition();
  def.connections.Branch.main[0].push({ node: 'Dangling', type: 'main', index: 1 });
  const graph = createWorkflowGraph(def, { chunkSize: 2 });
  assert.deepEqual(graph.getIncoming('Start'), [], 'Start has no indexed incoming edge (Ghost is not a node)');
  assert.deepEqual(graph.getIncoming('HTTP'), [{ source: 'Start', type: 'main', index: 0 }]);
  assert.deepEqual(graph.getIncoming('Branch'), [{ source: 'HTTP', type: 'main', index: 0 }]);
  assert.deepEqual(graph.getIncoming('Set A'), [{ source: 'Branch', type: 'main', index: 0 }],
    'output bundle 0 → Set A');
  assert.deepEqual(graph.getIncoming('Set B'), [{ source: 'Branch', type: 'main', index: 1 }],
    'index = which output bundle (main[1]) produced the edge');
  assert.equal(graph.hasNode('Dangling'), false);
  const frozen = graph.getIncoming('HTTP');
  assert.equal(Object.isFrozen(frozen), true, 'returned rows are frozen');
  assert.equal(Object.isFrozen(frozen[0]), true);
  const unknown = caught(() => graph.getIncoming('Nope'));
  assert.equal(unknown.details.reason, 'unknown-node', 'identity rule matches getNode');
  // the canonical definition still roundtrips with the dangling entry intact
  assert.deepStrictEqual(graph.exportDefinition(), def);
});

test('the reverse index is derived: never bundled, rebuilds after a bundle roundtrip', () => {
  const graph = createWorkflowGraph(sampleDefinition(), { chunkSize: 2 });
  graph.getIncoming('HTTP');
  assert.equal(graph.hasReverseIndex(), true);
  const wire = JSON.parse(JSON.stringify(graph.exportBundle()));
  assert.equal('incoming' in wire, false, 'derived index never rides the durable bundle');
  assert.equal('reverseIndex' in wire, false);
  const restored = graphFromBundle(wire);
  assert.equal(restored.hasReverseIndex(), false, 'fresh graph starts without the index');
  assert.deepEqual(restored.getIncoming('HTTP'), [{ source: 'Start', type: 'main', index: 0 }]);
  assert.deepStrictEqual(restored.exportDefinition(), sampleDefinition());
});
