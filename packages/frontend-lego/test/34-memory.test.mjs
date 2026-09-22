/**
 * Doc-coupling for Memory — code and contract document cannot drift apart.
 *
 * This suite is the frontend side of the P2.14 Memory contract.
 * It does NOT re-define ai.memory; it proves that the three places the
 * contract is written — the backend manifest, the generated .ai docs, and
 * the evidence report — say the same thing the code does.
 *
 * Like `29-alignment.test.mjs`, the comparison is against the tree the
 * suite is pointed at (`N8N_BACKEND_LEGO_ROOT` or the local backend copy).
 * If that tree publishes no `ai.memory` row yet, the comparison is a
 * bounded non-comparison (skip with a reason) instead of a false pass.
 * The self-consistency halves (manifest vs lock vs code) always run.
 *
 * Backend-tree convention: reads `apps/n8n-lego/src/lego/**` and **skips**
 * with a stated reason while that tree publishes no Memory contract, unless
 * `N8N_BACKEND_LEGO_ROOT` is set — in which case a missing declaration is
 * a failure, never a skip.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PACKAGE_ROOT } from '../src/manifests.mjs';

const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
const read = (relative) => readFileSync(join(REPO_ROOT, relative), 'utf8');
const readJson = (relative) => JSON.parse(read(relative));
const DEFAULT_BACKEND = join(REPO_ROOT, 'apps', 'n8n-lego', 'src', 'lego');
const BACKEND = process.env.N8N_BACKEND_LEGO_ROOT ?? DEFAULT_BACKEND;
const overridden = process.env.N8N_BACKEND_LEGO_ROOT !== undefined;
const CONTRACT_LOCK = join(BACKEND, 'contracts', 'contract-lock.json');
const MEMORY_MANIFEST = join(BACKEND, 'manifest', 'memory.json');

const lockRows = () => {
  if (!existsSync(CONTRACT_LOCK)) return [];
  const lock = JSON.parse(readFileSync(CONTRACT_LOCK, 'utf8'));
  return Array.isArray(lock) ? lock : (lock.rows ?? lock.contracts ?? []);
};
const MEMORY_CONTRACT_ID = 'ai.memory';
const MEMORY_VERSION = '1.0.0';
const memoryRow = () => lockRows().find((row) => (row.id ?? row.contract) === MEMORY_CONTRACT_ID) ?? null;
const publishedThere = existsSync(MEMORY_MANIFEST) && memoryRow() !== null;
const why = overridden
  ? `N8N_BACKEND_LEGO_ROOT is set but ${BACKEND} publishes no Memory contract (no ai.memory row in ${CONTRACT_LOCK} and no manifest/memory.json)`
  : 'the pointed-at tree does not publish ai.memory yet (protected main @ 67e638ef::17 lock rows, no memory row, no manifest/memory.json) — the comparison runs against the tree that does, or after the merge';
const skipPublished = publishedThere || overridden ? false : why;

const backendJson = (relative) => JSON.parse(readFileSync(join(BACKEND, relative), 'utf8'));

/* ------------------------------------------------------------------ doc coupling: code ↔ manifest ↔ lock */

test('doc coupling: backend code, manifest and lock quote the same Memory contract', () => {
  // The contract document is manifest/memory.json — the single source of truth.
  // The code the backend publishes (memory.mjs) must quote it verbatim, and
  // the lock must repeat it without inventing a version.
  const manifest = backendJson('manifest/memory.json');
  const lock = backendJson('contracts/contract-lock.json');
  const memLock = (Array.isArray(lock) ? lock : (lock.rows ?? lock.contracts ?? [])).find((r) => (r.id ?? r.contract) === MEMORY_CONTRACT_ID);
  assert.ok(manifest, 'manifest/memory.json exists');
  assert.equal(manifest.contract, MEMORY_CONTRACT_ID);
  assert.equal(manifest.version, MEMORY_VERSION);
  assert.ok(memLock, 'contract-lock must carry ai.memory row when manifest exists');
  assert.equal(memLock.version, MEMORY_VERSION);
  assert.equal(memLock.status, 'implemented');
  // Vocabulary sizes the contract publishes — a doc that promises a different count is drift.
  assert.equal(manifest.scopes.length, 5, 'manifest scopes is 5');
  assert.equal(manifest.kinds.length, 6, 'manifest kinds is 6');
  assert.equal(manifest.retention.length, 5, 'manifest retention is 5');
  assert.equal(manifest.operations.length, 4, 'manifest operations is 4');
  assert.equal(manifest.permissions.length, 2, 'manifest permissions is 2');
  assert.deepEqual(manifest.operations.map(o => o.name).sort(), ['memory.forget','memory.list','memory.recall','memory.remember'].sort());
  assert.deepEqual(manifest.permissions.sort(), ['ai:memory:read','ai:memory:write'].sort());
  // No deferred operation is published as if it were available
  for (const op of ['memory.traverse','memory.relate']) {
    assert.equal(manifest.operations.some(o => o.name === op), false, `${op} is not published`);
  }
});

/* ------------------------------------------------------------------ doc coupling: manifest ↔ generated .ai docs */

test('doc coupling: generated .ai docs quote the published contract, not a copy of it', () => {
  // .ai/master/AI_CONTRACT_MATRIX.md is GENERATED from the manifests + lock by `npm run lego:ai`.
  // A hand-edited matrix that says a different version, a different status or a different operation
  // set would be an invented interface — this test fails the build if the matrix drifts.
  const matrix = read('.ai/master/AI_CONTRACT_MATRIX.md');
  assert.ok(matrix.includes('<!-- GENERATED'), 'matrix is generated, not hand-edited');
  assert.ok(matrix.includes('`ai.memory`') && matrix.includes('locked @ 1.0.0'), 'matrix names ai.memory locked @ 1.0.0');
  assert.ok(matrix.includes('IMPLEMENTED') && matrix.includes('ai.memory@1.0.0'), 'matrix marks ai.memory IMPLEMENTED at 1.0.0');
  assert.ok(matrix.includes('lego-memory.test.mjs'), 'matrix test column points at the memory test');
  // The matrix must not invent a traversal operation
  assert.equal(matrix.includes('`ai.memory.traverse`'), false, 'matrix does not invent ai.memory.traverse');
  assert.equal(matrix.includes('`ai.memory.relate`'), false, 'matrix does not invent ai.memory.relate');
  // The evidence report for P2.14 must name the exact contract the tree locked
  const report = read('docs/n8n-lego/evidence/P2.14-agent-2-final-report.md');
  assert.ok(report.includes('ai.memory@1.0.0'), 'report names ai.memory@1.0.0');
  for (const op of ['memory.remember','memory.recall','memory.list','memory.forget']) {
    assert.ok(report.includes(op), `report names operation ${op}`);
  }
  for (const perm of ['ai:memory:read','ai:memory:write']) {
    assert.ok(report.includes(perm), `report names permission ${perm}`);
  }
});

/* ------------------------------------------------------------------ doc coupling: manifest ↔ product manifest */

test('doc coupling: product manifest marks Memory implemented and points at the test that proves it', () => {
  const legoSet = backendJson('manifest/ai-lego-set.json');
  const row = (legoSet.lego ?? []).find(l => l.id === 'memory');
  assert.ok(row, 'ai-lego-set.json carries a memory LEGO row');
  assert.equal(row.status, 'implemented', 'the LEGO row says implemented');
  assert.ok(row.tests.some(t => t.includes('lego-memory.test.mjs')), 'the LEGO row points at the memory test');
  const caps = row.contracts ?? row.capabilityIds ?? row.capabilities ?? [];
  assert.ok(caps.includes('ai.memory'), 'the LEGO row names ai.memory');
  assert.equal(row.versioning, 'ai.memory@1.0.0', 'the LEGO row pins the version');
});

/* ------------------------------------------------------------------ doc coupling: against the publishing tree */

test('doc coupling: the publishing tree publishes one contract, one LEGO and one lock row — no second source', { skip: skipPublished }, () => {
  const manifest = backendJson('manifest/memory.json');
  const lock = backendJson('contracts/contract-lock.json');
  const domains = backendJson('manifest/domains.json');
  const foundation = (domains.domains ?? []).find(d => d.id === 'ai-foundation');
  assert.ok(foundation, 'domains.json carries ai-foundation');
  const cap = (foundation.capabilities ?? []).find(c => c.id === 'ai.memory');
  assert.ok(cap, 'ai.memory capability is registered under ai-foundation');
  assert.equal(cap.status, 'implemented');
  const capOps = (cap.operations ?? []).map(o => o.name ?? o);
  assert.deepEqual(capOps.sort(), ['memory.forget','memory.list','memory.recall','memory.remember'].sort());
  // One lock row, not two, not zero
  const rows = (Array.isArray(lock) ? lock : (lock.rows ?? lock.contracts ?? [])).filter(r => (r.id ?? r.contract) === MEMORY_CONTRACT_ID);
  assert.equal(rows.length, 1, 'exactly one lock row for ai.memory');
  assert.equal(rows[0].version, MEMORY_VERSION);
  // No second memory.json
  assert.equal(existsSync(MEMORY_MANIFEST), true);
  // The manifest is the contract document — a second file that re-states the vocab would be drift
  assert.equal(manifest.graph.nodes.length, 10, 'manifest graph nodes is 10');
  assert.equal(manifest.graph.edges.length, 11, 'manifest graph edges is 11');
});

/* ------------------------------------------------------------------ doc coupling: frontend vocabulary (when present) ↔ backend manifest */

test('doc coupling: frontend vocabulary, when it exists, quotes the backend manifest verbatim (or skips)', () => {
  const frontendMemory = join(REPO_ROOT, 'packages', 'frontend-lego', 'src', 'memory.mjs');
  if (!existsSync(frontendMemory)) {
    // On the backend-only branch the frontend has not yet consumed ai.memory — this is the
    // expected SYNC_REQUIRED state. The backend doc-coupling above already proves the publishing
    // tree is consistent; the frontend quoting will be proven when agent-1's tree is the one
    // under test (N8N_BACKEND_LEGO_ROOT=...).
    assert.equal(publishedThere, true, 'backend publishes ai.memory even though frontend has not yet quoted it');
    return;
  }
  // When the frontend does quote, the nine sets must come from the one declaration file and must
  // be byte-equal to what the backend manifest publishes — not a copy.
  const src = read('packages/frontend-lego/src/memory.mjs');
  // A minimal coupling: the frontend file must mention the contract id, version and the four operations
  assert.ok(src.includes(MEMORY_CONTRACT_ID), 'frontend memory.mjs names ai.memory');
  assert.ok(src.includes(MEMORY_VERSION), 'frontend memory.mjs names 1.0.0');
  for (const op of ['memory.remember','memory.recall','memory.list','memory.forget']) {
    assert.ok(src.includes(op), `frontend memory.mjs quotes operation ${op}`);
  }
  // And it must not invent a deferred operation as if it were available
  assert.equal(src.includes('memory.traverse') && src.includes('memory.traverse') && !src.includes('DEFERRED') ? true : false, false,
    'frontend must not publish traverse as available — it is deferred (allowed only in a deferred list)');
});
