// DEC-0016: the Manager executes Slice tasks itself when no worker session is attached.
// Attribution stays honest (executor MANAGER, never a worker slot) and delivery rules are unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, expectError, M, W, SYS, SHA } from './helpers.mjs';
import { verifyIntegrity } from '../src/recovery.mjs';

const REGISTER = 'docs/n8n-lego/milestones.json';
const BR = 'arena/manager/p5-m01';
const create = (h, slice, extra = {}) => h.ok(M, 'TASK_CREATE', 'Task', 'NEW', { program: 'P5', slice, title: 'hardening task', scope: { paths: ['apps/n8n-lego/src/auth/'] }, ...extra }).objectId;
const execute = (h, id, extra = {}) => h.run(M, 'TASK_MANAGER_EXECUTED', 'Task', id, { reasonCode: 'NO_WORKER_SESSION', branch: BR, headSha: SHA('c'), ...extra });

test('manager-executed slice tasks -> one delivery PR -> merge -> SLICE_COMPLETE; no worker slot is touched', () => {
  const h = harness();
  const sl = h.slice('P5', 1, { key: 'P5-M01' });
  const a = create(h, sl.key);
  const b = create(h, sl.key, { title: 'second', scope: { paths: ['apps/n8n-lego/src/compat/'] }, dependencies: [{ taskId: a, type: 'REQUIRED' }] });
  // b depends on a: a sibling that is READY_FOR_REVIEW counts, an UNASSIGNED one does not.
  expectError(assert, execute(h, b), 'DEPENDENCY_BLOCKED');
  assert.equal(execute(h, a).ok, true);
  assert.equal(execute(h, b).ok, true);
  const ta = h.cp.store.get('Task', a);
  assert.equal(ta.state, 'READY_FOR_REVIEW');
  assert.deepEqual(ta.execution.executor, { type: 'MANAGER', id: 'MANAGER-01', decision: 'DEC-0016', reasonCode: 'NO_WORKER_SESSION', branch: BR });
  assert.equal(ta.owner, null);
  assert.equal(h.cp.store.list('Lease').length, 0, 'no worker lease was issued');
  const mq = h.readySliceDelivery(sl.id);
  h.mergeSliceDelivery(sl.id, mq);
  h.ok(M, 'SLICE_UPDATE_ACCEPTANCE', 'Slice', sl.id, { criteria: [{ id: 'AC-1', met: true, evidenceRef: 'PR test evidence' }] });
  const done = h.run(M, 'SLICE_COMPLETE', 'Slice', sl.id, { milestoneRegister: { path: REGISTER, commitSha: SHA('d') } });
  assert.equal(done.ok, true, JSON.stringify(done.error));
  assert.equal(h.cp.store.get('Slice', sl.id).state, 'COMPLETED');
  for (const id of [a, b]) assert.equal(h.cp.store.get('Task', id).state, 'COMPLETED');
  assert.deepEqual(verifyIntegrity(h.cp.store, h.cp.policy), []);
});

test('denied: GOVERNANCE tasks, worker-owned tasks, missing reason/head/branch, workers issuing the command', () => {
  const h = harness();
  const sl = h.slice('P5', 1, { key: 'P5-M01' });
  const gov = h.ok(M, 'TASK_CREATE', 'Task', 'NEW', { program: 'GOVERNANCE', title: 'gov', scope: { paths: ['docs/x/'] } }).objectId;
  const g = execute(h, gov); expectError(assert, g, 'POLICY_DENIED'); assert.match(g.error.message, /DEC-0011/);
  const owned = h.working(1, { program: 'P5', slice: sl.key, scope: { paths: ['apps/other/'] } });
  expectError(assert, execute(h, owned), 'INVALID_STATE_TRANSITION');
  const t = create(h, sl.key);
  expectError(assert, execute(h, t, { reasonCode: 'FASTER' }), 'INVALID_SCHEMA');
  expectError(assert, execute(h, t, { headSha: 'abc' }), 'EVIDENCE_INSUFFICIENT');
  expectError(assert, execute(h, t, { branch: '' }), 'INVALID_SCHEMA');
  const w = h.run(W(2), 'TASK_MANAGER_EXECUTED', 'Task', t, { reasonCode: 'NO_WORKER_SESSION', branch: BR, headSha: SHA('c') });
  assert.equal(w.ok, false);
  assert.equal(h.cp.store.get('Task', t).state, 'UNASSIGNED');
});

test('denied: scope overlapping a task a worker currently holds (workers keep priority)', () => {
  const h = harness();
  const sl = h.slice('P5', 1, { key: 'P5-M01' });
  const other = h.slice('P5', 2, { key: 'P5-M02' });
  const held = h.working(3, { program: 'P5', slice: other.key, scope: { paths: ['apps/n8n-lego/src/auth/security/'] } });
  const t = create(h, sl.key);
  const r = execute(h, t);
  expectError(assert, r, 'RESERVATION_CONFLICT');
  assert.match(r.error.message, new RegExp(held));
  const free = create(h, sl.key, { scope: { paths: ['apps/n8n-lego/src/compat/'] } });
  assert.equal(execute(h, free).ok, true);
});

test('DEC-0015 still applies: deferred runner checks keep the manager-executed Slice VERIFYING', () => {
  const h = harness();
  const sl = h.slice('P5', 1, { key: 'P5-M01' });
  const t = create(h, sl.key);
  assert.equal(execute(h, t).ok, true);
  h.sliceEvidence(sl.id, 'COMMIT', { subjectType: 'COMMIT', subjectId: SHA('c') });
  h.sliceEvidence(sl.id, 'CI', { subjectType: 'PR_HEAD', subjectId: SHA('c'), prNumber: 30 }, { trust: 'CI_VERIFIED', verifyTrust: 'CI_VERIFIED', actor: SYS('SYSTEM-CI') });
  const mq = h.ok(M, 'MQ_ADMIT', 'MergeQueueItem', 'NEW', { sliceId: sl.id, pr: { repository: 'Catzpro01/n8n-rust-v.4', number: 30, base: 'main', headSha: SHA('c') } }).objectId;
  h.ok(SYS('SYSTEM-CI'), 'MQ_UPDATE_CHECKS', 'MergeQueueItem', mq, { headSha: SHA('c'), checks: { exactHeadCi: 'PASS', architecture: 'PASS', acceptance: 'PASS' }, deferredRunnerChecks: ['Level 0 (Check & Format)'] });
  h.ok(M, 'MQ_CLASSIFY', 'MergeQueueItem', mq);
  assert.equal(h.cp.store.get('MergeQueueItem', mq).lane, 'MANAGER');
  h.mergeSliceDelivery(sl.id, mq);
  const early = h.run(M, 'SLICE_COMPLETE', 'Slice', sl.id, { milestoneRegister: { path: REGISTER, commitSha: SHA('d') } });
  assert.equal(early.ok, false);
  assert.equal(h.cp.store.get('Slice', sl.id).state, 'VERIFYING');
});
