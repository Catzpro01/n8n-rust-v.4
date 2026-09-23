/**
 * Workflow graph — persistent logical graph (P3 Slice A, Issues #75/#97).
 *
 * PUBLIC CONTRACT (`workflow.graph`, v1.0.0, owner: agent-1).
 *
 * The canonical workflow definition stays the AUTHORITATIVE source of truth
 * (§6: author/canonical graph → derived representations → execution). This
 * module turns that canonical definition into a CHUNKED, INDEXED, LOSSLESS
 * logical graph whose resident representation is deliberately smaller than
 * "one live JS object per node":
 *
 *   - nodes live as VERBATIM JSON strings, bucketed into fixed-size chunks;
 *   - connections are bucketed by source node into the same chunks (partial
 *     reads address one chunk, never the whole graph);
 *   - the resident index is name → ordinal (an integer), not name → object;
 *   - getChunk / getNode / getOutgoingConnections touch exactly one chunk
 *     (readStats proves it);
 *   - exportBundle / graphFromBundle give the durable logical form (manifest
 *     + chunks) with fail-closed integrity (chunk digest);
 *   - exportDefinition reconstructs the canonical n8n JSON losslessly —
 *     deep-equal roundtrip including orphan connection keys and every
 *     top-level header field — and the manifest checksum stays the
 *     n8n-editor contract checksum (calculateWorkflowChecksum).
 *
 * WHAT THIS IS NOT
 * ----------------
 * No filesystem, no network, no clock, no executor, no optimizer, no virtual
 * node layer yet (later P3 slices), no second workflow store — n8n-ts
 * WorkflowStore keeps the canonical document; this graph is a DERIVED,
 * disposable, reconstructible representation of it. No artificial node-count
 * cap: logical size is bounded by chunked structure and later slices' resource
 * budgets, never by an arbitrary ceiling (P3 anti-pattern 13).
 *
 * Owner: agent-1 (P3 owns workflow graph per Issue #98).
 */
import { createHash } from 'node:crypto';
import { calculateWorkflowChecksum } from '../checksum.mjs';

/** The contract this module publishes. */
export const WORKFLOW_GRAPH_CONTRACT = Object.freeze({
  id: `workflow.graph`,
  version: '0.1.0',
  owner: 'agent-1',
});

/** Pinned contract version for pin-style assertions. */
export const WORKFLOW_GRAPH_CONTRACT_VERSION = WORKFLOW_GRAPH_CONTRACT.version;

/** Nodes per chunk at build time (manifest records the effective size). */
export const GRAPH_CHUNK_DEFAULT_SIZE = 1024;

/** Structural validation bounds — deliberately NO node-count ceiling. */
export const WORKFLOW_GRAPH_LIMITS = Object.freeze({
  maxNameLength: 256,
  maxBundleVersion: 1,
});

/** Bundle wire format version produced by exportBundle. */
export const WORKFLOW_GRAPH_BUNDLE_VERSION = 1;

/** One error family; the code is published in errors contract 1.2.0 (untouched). */
export class WorkflowGraphError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'WorkflowGraphError';
    this.code = 'lego.contract_violation';
    this.details = Object.freeze({ ...details });
  }
}

function fail(message, details) {
  throw new WorkflowGraphError(message, details);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Count edges across an n8n connections map (all types, all bundles). */
function countEdges(connections) {
  let edges = 0;
  for (const byType of Object.values(connections)) {
    if (!isPlainObject(byType)) continue;
    for (const bundles of Object.values(byType)) {
      if (!Array.isArray(bundles)) continue;
      for (const list of bundles) {
        if (Array.isArray(list)) edges += list.length;
      }
    }
  }
  return edges;
}

function assertName(name, field) {
  if (typeof name !== 'string' || name.length === 0 || name.length > WORKFLOW_GRAPH_LIMITS.maxNameLength) {
    fail(`${field} must be a string of 1..${WORKFLOW_GRAPH_LIMITS.maxNameLength} characters`, { field });
  }
  return name;
}

/** sha256 over the chunked resident form — detects store/bundle corruption. */
function digestChunks(nodeChunks, edgeChunks, headerJson, orphanJson) {
  const hash = createHash('sha256');
  hash.update(headerJson, 'utf8');
  hash.update('\n|orphan|', 'utf8');
  hash.update(orphanJson, 'utf8');
  for (let i = 0; i < nodeChunks.length; i += 1) {
    hash.update('\n|chunk|', 'utf8');
    hash.update(String(i), 'utf8');
    for (const nodeString of nodeChunks[i]) hash.update(nodeString, 'utf8');
    hash.update(edgeChunks[i] ?? '', 'utf8');
  }
  return hash.digest('hex');
}

class LogicalWorkflowGraph {
  #manifest;
  #nodeChunks;
  #edgeChunks;
  #ordinals;
  #headerJson;
  #orphanJson;
  #reads = { chunkReads: 0 };

  constructor(parts) {
    this.#manifest = Object.freeze({ ...parts.manifest });
    this.#nodeChunks = parts.nodeChunks;
    this.#edgeChunks = parts.edgeChunks;
    this.#ordinals = parts.ordinals;
    this.#headerJson = parts.headerJson;
    this.#orphanJson = parts.orphanJson;
  }

  manifest() {
    return this.#manifest;
  }

  chunkCount() {
    return this.#nodeChunks.length;
  }

  nodeCount() {
    return this.#manifest.nodeCount;
  }

  edgeCount() {
    return this.#manifest.edgeCount;
  }

  /** Observability: chunk reads served (tests, later resource budgets). */
  readStats() {
    return { ...this.#reads };
  }

  resetReadStats() {
    this.#reads.chunkReads = 0;
  }

  /** Partial read: exactly one chunk's nodes, parsed. Never a whole-graph walk. */
  getChunk(chunkIndex) {
    if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= this.#nodeChunks.length) {
      fail('chunk index out of range', { field: 'chunkIndex', reason: 'out-of-range' });
    }
    this.#reads.chunkReads += 1;
    return this.#nodeChunks[chunkIndex].map((nodeString) => JSON.parse(nodeString));
  }

  /** Indexed node access: Map lookup → one chunk → parse one node. */
  getNode(name) {
    const ordinal = this.#ordinals.get(name);
    if (ordinal === undefined) {
      fail('node not found in the logical graph', { field: 'name', reason: 'unknown-node' });
    }
    this.#reads.chunkReads += 1;
    const chunkIndex = Math.floor(ordinal / this.#manifest.chunkSize);
    const offset = ordinal % this.#manifest.chunkSize;
    return JSON.parse(this.#nodeChunks[chunkIndex][offset]);
  }

  hasNode(name) {
    return this.#ordinals.has(name);
  }

  /** Names in canonical ordinal order, yielded chunk by chunk. */
  *nodeNames() {
    for (const chunk of this.#nodeChunks) {
      for (const nodeString of chunk) yield JSON.parse(nodeString).name;
    }
  }

  /** Connections bucketed for sourceName, read from its chunk only. */
  getOutgoingConnections(sourceName) {
    const ordinal = this.#ordinals.get(sourceName);
    if (ordinal === undefined) {
      fail('node not found in the logical graph', { field: 'name', reason: 'unknown-node' });
    }
    this.#reads.chunkReads += 1;
    const chunkIndex = Math.floor(ordinal / this.#manifest.chunkSize);
    const bucket = JSON.parse(this.#edgeChunks[chunkIndex] || '{}');
    return bucket[sourceName] ?? {};
  }

  /** Recompute the resident digest chunk-by-chunk (bounded peak memory). */
  integrity() {
    const actual = digestChunks(this.#nodeChunks, this.#edgeChunks, this.#headerJson, this.#orphanJson);
    return Object.freeze({
      ok: actual === this.#manifest.chunkDigest,
      expected: this.#manifest.chunkDigest,
      actual,
    });
  }

  /**
   * Canonical recovery: rebuild the full n8n definition, deep-equal to the
   * input that produced it (header fields + nodes + connections, orphans
   * included). A deliberate FULL read — exports are rare by design.
   */
  exportDefinition() {
    const header = JSON.parse(this.#headerJson);
    const nodes = [];
    for (const chunk of this.#nodeChunks) for (const nodeString of chunk) nodes.push(JSON.parse(nodeString));
    const connections = JSON.parse(this.#orphanJson);
    for (const edgeChunk of this.#edgeChunks) {
      if (!edgeChunk) continue;
      const bucket = JSON.parse(edgeChunk);
      for (const [sourceName, value] of Object.entries(bucket)) connections[sourceName] = value;
    }
    return { ...header, nodes, connections };
  }

  /** Durable logical form: manifest + chunk strings (+ header/orphans). */
  exportBundle() {
    return {
      bundleVersion: WORKFLOW_GRAPH_BUNDLE_VERSION,
      manifest: { ...this.#manifest },
      headerJson: this.#headerJson,
      orphanJson: this.#orphanJson,
      nodeChunks: this.#nodeChunks.map((chunk) => [...chunk]),
      edgeChunks: [...this.#edgeChunks],
    };
  }
}

/**
 * Build the persistent logical graph from a canonical n8n definition.
 * The input is read, never mutated; a later export is deep-equal to it.
 *
 * @param {object} definition canonical n8n workflow JSON
 * @param {{chunkSize?: number}} [options]
 * @returns {LogicalWorkflowGraph}
 */
export function createWorkflowGraph(definition, options = {}) {
  if (!isPlainObject(definition)) {
    fail('a canonical workflow definition (plain object) is required', { field: 'definition' });
  }
  const { nodes, connections } = definition;
  if (!Array.isArray(nodes)) fail('definition.nodes must be an array', { field: 'nodes' });
  if (!isPlainObject(connections)) fail('definition.connections must be an object', { field: 'connections' });
  const chunkSize = options.chunkSize ?? GRAPH_CHUNK_DEFAULT_SIZE;
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 65536) {
    fail('chunkSize must be a safe integer in 1..65536', { field: 'chunkSize' });
  }

  const ordinals = new Map();
  const nodeChunks = [];
  const edgeBuckets = [];
  let currentChunk = [];
  let currentEdges = {};
  const flush = () => {
    nodeChunks.push(currentChunk);
    edgeBuckets.push(Object.keys(currentEdges).length > 0 ? JSON.stringify(currentEdges) : '');
    currentChunk = [];
    currentEdges = {};
  };
  for (let ordinal = 0; ordinal < nodes.length; ordinal += 1) {
    const node = nodes[ordinal];
    if (!isPlainObject(node)) fail('every node must be a plain object', { field: 'nodes', reason: 'bad-node' });
    const name = assertName(node.name, `node.name`);
    if (ordinals.has(name)) {
      fail('node names are the graph identity and must be unique', { field: `node.name`, reason: 'duplicate-name' });
    }
    ordinals.set(name, ordinal);
    currentChunk.push(JSON.stringify(node));
    if (Object.hasOwn(connections, name)) currentEdges[name] = connections[name];
    if (currentChunk.length === chunkSize) flush();
  }
  if (currentChunk.length > 0 || Object.keys(currentEdges).length > 0) flush();

  const { nodes: _nodes, connections: _connections, ...header } = definition;
  const headerJson = JSON.stringify(header);
  const orphan = {};
  for (const key of Object.keys(connections)) if (!ordinals.has(key)) orphan[key] = connections[key];
  const orphanJson = JSON.stringify(orphan);

  const chunkDigest = digestChunks(nodeChunks, edgeBuckets, headerJson, orphanJson);
  const manifest = {
    contract: `${WORKFLOW_GRAPH_CONTRACT.id}@${WORKFLOW_GRAPH_CONTRACT.version}`,
    bundleVersion: WORKFLOW_GRAPH_BUNDLE_VERSION,
    checksum: calculateWorkflowChecksum(definition),
    chunkDigest,
    nodeCount: nodes.length,
    edgeCount: countEdges(connections),
    chunkCount: nodeChunks.length,
    chunkSize,
    addressing: 'ordinal:name→chunk=floor(o/size),offset=o%size',
    nodesField: 'nodes',
    canonical: true,
  };
  return new LogicalWorkflowGraph({ manifest, nodeChunks, edgeChunks: edgeBuckets, ordinals, headerJson, orphanJson });
}

/**
 * Rebuild a graph from its durable bundle. Fail-closed: the bundle's chunk
 * digest must recompute exactly, or the bundle is refused.
 *
 * @param {object} bundle exportBundle() output
 * @returns {LogicalWorkflowGraph}
 */
export function graphFromBundle(bundle) {
  if (!isPlainObject(bundle)) fail('a graph bundle (plain object) is required', { field: 'bundle' });
  if (bundle.bundleVersion !== WORKFLOW_GRAPH_BUNDLE_VERSION) {
    fail('unsupported graph bundle version', { field: 'bundleVersion', reason: 'unsupported-version' });
  }
  const { manifest, headerJson, orphanJson, nodeChunks, edgeChunks } = bundle;
  if (!isPlainObject(manifest)) fail('bundle.manifest is required', { field: 'manifest' });
  if (typeof headerJson !== 'string' || typeof orphanJson !== 'string') {
    fail('bundle header/orphan fields must be JSON strings', { field: 'headerJson' });
  }
  if (!Array.isArray(nodeChunks) || !Array.isArray(edgeChunks) || nodeChunks.length !== edgeChunks.length) {
    fail('bundle chunk arrays must exist and have equal length', { field: 'nodeChunks' });
  }
  const recomputed = digestChunks(nodeChunks, edgeChunks, headerJson, orphanJson);
  if (recomputed !== manifest.chunkDigest) {
    fail('bundle integrity check failed — chunk digest does not match the manifest', {
      field: 'chunkDigest',
      reason: 'integrity-mismatch',
    });
  }
  const ordinals = new Map();
  let ordinal = 0;
  for (const chunk of nodeChunks) {
    if (!Array.isArray(chunk)) fail('every node chunk must be an array of JSON strings', { field: 'nodeChunks' });
    for (const nodeString of chunk) {
      const node = JSON.parse(nodeString);
      ordinals.set(assertName(node.name, `node.name`), ordinal);
      ordinal += 1;
    }
  }
  if (ordinal !== manifest.nodeCount) {
    fail('bundle node count does not match its manifest', { field: 'nodeCount', reason: 'count-mismatch' });
  }
  return new LogicalWorkflowGraph({ manifest: { ...manifest }, nodeChunks, edgeChunks, ordinals, headerJson, orphanJson });
}
