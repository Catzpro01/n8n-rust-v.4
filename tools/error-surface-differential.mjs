#!/usr/bin/env node
/**
 * Error-surface differential for ISSUE-024 (TASK-EERR-01).
 *
 * Runs identical NodeOperationError construction matrices on
 *   R = the published n8n-workflow@2.9.1 build (packages/workflow-lego node_modules)
 *   A = packages/node-lego/src/errors.mjs
 *   B = packages/execution-engine/src/errors.mjs
 * and reports per-comparison AGREE / DIVERGE. Informational EVIDENCE for the
 * ISSUE-024 consolidation decision — NOT a gate:
 *   exit 0 — every comparison produced an outcome (even with DIVERGE)
 *   exit 1 — the harness itself broke.
 *
 * Volatile fields (timestamp when not fixed, stack) are excluded; everything the
 * reference makes observable is compared: name, message, level, tags, extra, node,
 * messages, description, context, functionality, type, cause presence, reflection.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const workflowLegoRequire = createRequire(join(repoRoot, 'packages', 'workflow-lego', 'package.json'));
const R = workflowLegoRequire('n8n-workflow');
const A = (await import(join(repoRoot, 'packages', 'node-lego', 'src', 'index.mjs'))).NodeOperationError;
const B = (await import(join(repoRoot, 'packages', 'execution-engine', 'src', 'index.mjs'))).NodeOperationError;

const findings = [];
let harnessErrors = 0;

const NODE = { id: 'n1', name: 'My Node', type: 'n8n-nodes-base.test', typeVersion: 1, position: [0, 0], parameters: {} };
const FIXED_TS = 1700000000000;

/** Normalize an error instance into a comparable plain object (volatile fields excluded). */
function project(err) {
  if (!err || typeof err !== 'object') return { value: err ?? null };
  const own = (k) => (err[k] === undefined ? undefined : err[k]);
  return {
    name: own('name'),
    message: own('message'),
    level: own('level'),
    tags: own('tags') ?? null,
    extra: own('extra') ?? null,
    nodeIsSameObject: err.node === NODE,
    nodeName: err.node?.name,
    nodeType: err.node?.type,
    messages: own('messages') ?? null,
    description: own('description') ?? null,
    context: own('context') ?? null,
    functionality: own('functionality') ?? null,
    type: own('type') ?? null,
    errorResponse: own('errorResponse') ?? null,
    causePresent: own('cause') !== undefined,
    causeMessage: err.cause?.message,
    timestampType: typeof err.timestamp,
  };
}

const strip = (value) =>
  JSON.parse(JSON.stringify(value ?? null, (_k, v) => (v === undefined ? null : v)));

// DOCUMENTED DELTAS (not regressions): tags/extra — the published build's surface is the
// EXTERNAL @n8n/errors package (observed tags = {packageName: 'workflow-lego'}, extra
// undefined; the 2.9.4 NodeError passes no tags/extra at all). Both ports emulate the
// classic NodeError surface (tags {node: type}, extra {nodeName}) by lane decision
// (see the lane boundary notes in both errors.mjs).
const KNOWN_DELTA_KEYS = new Set(['tags', 'extra']);

function compare(label, r, a, b) {
  const pairs = [
    ['R≈A', strip(project(r)), strip(project(a))],
    ['R≈B', strip(project(r)), strip(project(b))],
  ];
  for (const [tag, x, y] of pairs) {
    let verdict = 'AGREE';
    let detail = '';
    const diffKeys = Object.keys(x).filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k]));
    if (diffKeys.length > 0) {
      const knownOnly = diffKeys.every((k) => KNOWN_DELTA_KEYS.has(k));
      verdict = knownOnly ? 'DIVERGE-DOCUMENTED' : 'DIVERGE';
      detail = diffKeys
        .map((k) => `${k}: ${JSON.stringify(x[k])} vs ${JSON.stringify(y[k])}`)
        .join(' · ')
        .slice(0, 240);
    }
    findings.push({ label, pair: tag, verdict });
    console.log(`[${verdict}] ${label} :: ${tag}${diffKeys.length ? ` — ${detail}` : ''}`);
  }
}

async function runScenario(name, fn) {
  try {
    await fn(({ r, a, b, note }) => {
      if (note) console.log(`[NOTE] ${name} :: ${note}`);
      compare(name, r, a, b);
    });
  } catch (error) {
    console.error(`[HARNESS-ERROR] ${name}: ${error?.stack ?? error}`);
    harnessErrors++;
  }
}

const build = (Cls, node, error, options) => {
  try {
    return { err: new Cls(node, error, options) };
  } catch (e) {
    return { err: e, threw: true };
  }
};

// --- S1: fully explicit options -------------------------------------------------
await runScenario('S1 explicit options', (emit) => {
  const opts = {
    level: 'error', tags: { t: '1' }, extra: { e: '2' }, description: 'desc',
    functionality: 'regular', type: 'myType', timestamp: FIXED_TS,
    runIndex: 1, itemIndex: 2, metadata: { m: 3 }, message: 'override-message',
  };
  const r = build(R.NodeOperationError, NODE, 'boom', opts);
  const a = build(A, NODE, 'boom', opts);
  const b = build(B, NODE, 'boom', opts);
  emit({ r: r.err, a: a.err, b: b.err });
});

// --- S2: bare defaults ------------------------------------------------------------
await runScenario('S2 bare defaults (level, context, functionality, type)', (emit) => {
  const r = build(R.NodeOperationError, NODE, 'boom', { timestamp: FIXED_TS });
  const a = build(A, NODE, 'boom', { timestamp: FIXED_TS });
  const b = build(B, NODE, 'boom', { timestamp: FIXED_TS });
  emit({ r: r.err, a: a.err, b: b.err });
});

// --- S3: Error instance as input ---------------------------------------------------
await runScenario('S3 Error input (cause chain)', (emit) => {
  const inner = new Error('inner-failure');
  const r = build(R.NodeOperationError, NODE, inner, { timestamp: FIXED_TS });
  const a = build(A, NODE, inner, { timestamp: FIXED_TS });
  const b = build(B, NODE, inner, { timestamp: FIXED_TS });
  emit({ r: r.err, a: a.err, b: b.err });
});

// --- S4: Error input carrying a description ---------------------------------------
await runScenario('S4 Error with description field', (emit) => {
  const inner = new Error('inner-failure');
  inner.description = 'inner-description';
  const r = build(R.NodeOperationError, NODE, inner, { timestamp: FIXED_TS });
  const a = build(A, NODE, inner, { timestamp: FIXED_TS });
  const b = build(B, NODE, inner, { timestamp: FIXED_TS });
  emit({ r: r.err, a: a.err, b: b.err });
});

// --- S5: COMMON_ERRORS mapping (node.error.ts setDescriptiveErrorMessage) ----------
await runScenario('S5 COMMON_ERRORS: message containing ETIMEDOUT', (emit) => {
  const r = build(R.NodeOperationError, NODE, 'connect ETIMEDOUT 10.0.0.1', { timestamp: FIXED_TS });
  const a = build(A, NODE, 'connect ETIMEDOUT 10.0.0.1', { timestamp: FIXED_TS });
  const b = build(B, NODE, 'connect ETIMEDOUT 10.0.0.1', { timestamp: FIXED_TS });
  emit({ r: r.err, a: a.err, b: b.err });
});

// --- S6: reflection (SOURCE-pinned: node-operation.error.ts L16-18 returns the same
// instance). NOTE: the published 2.9.1 build predates this guard — its observed
// sameInstance is false — so R is reported as a build/source delta, and A/B are
// compared against the 2.9.4 source expectation (sameInstance: true).
await runScenario('S6 reflection (source-pinned): re-wrapping returns the SAME instance', (emit) => {
  const r1 = new R.NodeOperationError(NODE, 'first', { timestamp: FIXED_TS });
  const r2 = new R.NodeOperationError(NODE, r1, { timestamp: FIXED_TS });
  const a1 = new A(NODE, 'first', { timestamp: FIXED_TS });
  const a2 = new A(NODE, a1, { timestamp: FIXED_TS });
  const b1 = new B(NODE, 'first', { timestamp: FIXED_TS });
  const b2 = new B(NODE, b1, { timestamp: FIXED_TS });
  emit({
    note: `published 2.9.1 build observed sameInstance=${r2 === r1} (build/source delta; ` +
          '2.9.4 source node-operation.error.ts L16-18 pins reflection) — A/B compared against source',
  });
  findings.push({ label: 'S6 reflection', pair: 'A vs source', verdict: a2 === a1 ? 'AGREE' : 'DIVERGE' });
  findings.push({ label: 'S6 reflection', pair: 'B vs source', verdict: b2 === b1 ? 'AGREE' : 'DIVERGE' });
  console.log(`[${a2 === a1 ? 'AGREE' : 'DIVERGE'}] S6 reflection :: A vs source (a2 === a1: ${a2 === a1})`);
  console.log(`[${b2 === b1 ? 'AGREE' : 'DIVERGE'}] S6 reflection :: B vs source (b2 === b1: ${b2 === b1})`);
});

// --- S7: description === message collapses to undefined -----------------------------
await runScenario('S7 description===message collapse', (emit) => {
  const r = build(R.NodeOperationError, NODE, 'dup', { description: 'dup', timestamp: FIXED_TS });
  const a = build(A, NODE, 'dup', { description: 'dup', timestamp: FIXED_TS });
  const b = build(B, NODE, 'dup', { description: 'dup', timestamp: FIXED_TS });
  emit({ r: r.err, a: a.err, b: b.err });
});

// --- S8: string error wrap level (REF wraps strings at level ?? 'warning') ----------
await runScenario('S8 string input + no level option: wrap and default level', (emit) => {
  const r = build(R.NodeOperationError, NODE, 'plain string', { timestamp: FIXED_TS });
  const a = build(A, NODE, 'plain string', { timestamp: FIXED_TS });
  const b = build(B, NODE, 'plain string', { timestamp: FIXED_TS });
  emit({ r: r.err, a: a.err, b: b.err });
});

// --- summary -------------------------------------------------------------------------
const agree = findings.filter((f) => f.verdict === 'AGREE').length;
const documented = findings.filter((f) => f.verdict === 'DIVERGE-DOCUMENTED').length;
const diverge = findings.filter((f) => f.verdict === 'DIVERGE').length;
console.log('-------------------------------------------------------');
console.log(`ERROR-SURFACE DIFFERENTIAL: ${agree} agree / ${documented} documented-delta / ${diverge} diverge across ${findings.length} comparisons (${harnessErrors} harness errors)`);
process.exit(harnessErrors ? 1 : 0);
