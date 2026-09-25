// DEC-0014: Slice = delivery boundary, Task = execution boundary, PR = Slice delivery boundary.
// Every Slice produces exactly one delivery PR; its tasks never deliver their own PR.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, expectError, M, W, SYS, SHA } from './helpers.mjs';
import { verifyIntegrity } from '../src/recovery.mjs';

const REGISTER = 'docs/n8n-lego/milestones.json';

/** Slice with `n` tasks, each worked by its own worker and brought to READY_FOR_REVIEW. */
function sliceWithReadyTasks(h, n = 3, { program = 'P2', criteria } = {}) {
  const sl = h.slice(program, 16, criteria ? { acceptance: { criteria } } : {});
  const tasks = [];
  for (let i = 1; i <= n; i += 1) {
    const id = h.working(i, { program, slice: sl.key, title: `task ${i}`, scope: { paths: [`apps/part-${i}/`] } });
    h.ok(W(i), 'TASK_READY_FOR_REVIEW', 'Task', id, { headSha: SHA(String(i)) });
    tasks.push(id);
  }
  return { sl, tasks };
}

const complete = (h, sliceId, commitSha = SHA('d')) => h.run(M, 'SLICE_COMPLETE', 'Slice', sliceId, { milestoneRegister: { path: REGISTER, commitSha } });
const meetAll = (h, sliceId) => {
  const sl = h.get('Slice', sliceId);
  h.ok(M, 'SLICE_UPDATE_ACCEPTANCE', 'Slice', sliceId, { criteria: sl.acceptance.criteria.map((c) => ({ id: c.id, met: true, evidenceRef: 'PR test evidence' })) });
};

test('slice with four tasks on four workers -> one delivery PR -> slice COMPLETE and every task COMPLETE', () => {
  const h = harness();
  const { sl, tasks } = sliceWithReadyTasks(h, 4);
  const mq = h.readySliceDelivery(sl.id);
  const item = h.get('MergeQueueItem', mq);
  assert.equal(item.taskId, null);
  assert.equal(item.sliceId, sl.id);
  assert.deepEqual([...item.taskIds].sort(), [...tasks].sort());
  assert.equal(h.get('Slice', sl.id).state, 'DELIVERING');
  h.mergeSliceDelivery(sl.id, mq);
  assert.equal(h.get('Slice', sl.id).state, 'VERIFYING');
  for (const t of tasks) assert.equal(h.get('Task', t).state, 'VERIFYING');
  meetAll(h, sl.id);
  assert.equal(complete(h, sl.id).ok, true);
  const done = h.get('Slice', sl.id);
  assert.equal(done.state, 'COMPLETED');
  assert.equal(done.completedMainSha, SHA('d'));
  assert.deepEqual(done.milestoneRegister, { path: REGISTER, commitSha: SHA('d') });
  assert.equal(done.delivery.prNumber, 30);
  for (const t of tasks) {
    assert.equal(h.get('Task', t).state, 'COMPLETED');
    assert.equal(h.get('Task', t).current.completedMainSha, SHA('d'));
  }
  for (const n of [1, 2, 3, 4]) assert.equal(h.get('AgentState', W(n).id).state, 'AVAILABLE', 'slots released');
  assert.deepEqual(verifyIntegrity(h.cp.store, h.cp.policy), []);
});

test('a small slice with a single task is also delivered by exactly one PR', () => {
  const h = harness();
  const { sl, tasks } = sliceWithReadyTasks(h, 1);
  const mq = h.readySliceDelivery(sl.id);
  h.mergeSliceDelivery(sl.id, mq);
  meetAll(h, sl.id);
  assert.equal(complete(h, sl.id).ok, true);
  assert.equal(h.get('Task', tasks[0]).state, 'COMPLETED');
});

test('forbidden: a slice task delivering its own PR, or completing on its own', () => {
  const h = harness();
  const { tasks } = sliceWithReadyTasks(h, 2);
  const own = h.run(W(1), 'MQ_ADMIT', 'MergeQueueItem', 'NEW', { taskId: tasks[0], pr: { repository: 'Catzpro01/n8n-rust-v.4', number: 301, base: 'main', headSha: SHA('1') } });
  expectError(assert, own, 'POLICY_DENIED');
  assert.match(own.error.message, /one delivery PR per Slice/);
  expectError(assert, h.run(M, 'MQ_ADMIT', 'MergeQueueItem', 'NEW', { taskId: tasks[1], pr: { repository: 'Catzpro01/n8n-rust-v.4', number: 302, base: 'main', headSha: SHA('2') } }), 'POLICY_DENIED');
  expectError(assert, h.run(M, 'TASK_COMPLETE', 'Task', tasks[0]), 'INVALID_STATE_TRANSITION');
  // Even after the slice PR merged, a task cannot complete on its own: it completes with its Slice.
  const sl = h.cp.store.list('Slice')[0];
  const mq = h.readySliceDelivery(sl.objectId);
  h.mergeSliceDelivery(sl.objectId, mq);
  const solo = h.run(M, 'TASK_COMPLETE', 'Task', tasks[0]);
  expectError(assert, solo, 'POLICY_DENIED');
  assert.match(solo.error.message, /SLICE_COMPLETE/);
});

test('slice membership: P-program tasks need a registered OPEN slice of the same program; GOVERNANCE stays per task', () => {
  const h = harness();
  expectError(assert, h.run(M, 'TASK_CREATE', 'Task', 'NEW', { program: 'P2', title: 'no slice' }), 'POLICY_DENIED');
  expectError(assert, h.run(M, 'TASK_CREATE', 'Task', 'NEW', { program: 'P2', slice: 'P2-S99', title: 'unregistered slice' }), 'POLICY_DENIED');
  h.slice('P2', 16);
  expectError(assert, h.run(M, 'TASK_CREATE', 'Task', 'NEW', { program: 'P3', slice: 'P2-S16', title: 'wrong program' }), 'POLICY_DENIED');
  assert.equal(h.run(M, 'TASK_CREATE', 'Task', 'NEW', { program: 'P2', slice: 'P2-S16', title: 'ok' }).ok, true);
  assert.equal(h.run(M, 'TASK_CREATE', 'Task', 'NEW', { program: 'GOVERNANCE', title: 'governance task' }).ok, true);
  expectError(assert, h.run(M, 'SLICE_CREATE', 'Slice', 'NEW', { program: 'GOVERNANCE', key: 'GOVERNANCE-S01', title: 'x', acceptance: { criteria: [{ text: 'x' }] } }), 'POLICY_DENIED');
  expectError(assert, h.run(M, 'SLICE_CREATE', 'Slice', 'NEW', { program: 'P2', key: 'P3-S01', title: 'x', acceptance: { criteria: [{ text: 'x' }] } }), 'INVALID_SCHEMA');
  expectError(assert, h.run(M, 'SLICE_CREATE', 'Slice', 'NEW', { program: 'P2', key: 'P2.28', title: 'x', acceptance: { criteria: [{ text: 'x' }] } }), 'INVALID_SCHEMA');
  expectError(assert, h.run(M, 'SLICE_CREATE', 'Slice', 'NEW', { program: 'P24', key: 'P24-S01', title: 'x', acceptance: { criteria: [{ text: 'x' }] } }), 'POLICY_DENIED');
  expectError(assert, h.run(M, 'SLICE_CREATE', 'Slice', 'NEW', { program: 'P2', key: 'P2-S16', title: 'dup', acceptance: { criteria: [{ text: 'x' }] } }), 'DUPLICATE');
  expectError(assert, h.run(M, 'SLICE_CREATE', 'Slice', 'NEW', { program: 'P2', key: 'P2-S17', title: 'no criteria', acceptance: { criteria: [] } }), 'INVALID_SCHEMA');
  expectError(assert, h.run(W(1), 'SLICE_CREATE', 'Slice', 'NEW', { program: 'P2', key: 'P2-S18', title: 'x', acceptance: { criteria: [{ text: 'x' }] } }), 'UNAUTHORIZED');
});

test('delivery admission waits for every task; tasks cannot join once the delivery PR is fixed', () => {
  const h = harness();
  const { sl, tasks } = sliceWithReadyTasks(h, 2);
  const late = h.working(3, { program: 'P2', slice: sl.key, title: 'still working' });
  const r = h.run(M, 'MQ_ADMIT', 'MergeQueueItem', 'NEW', { sliceId: sl.id, pr: { repository: 'Catzpro01/n8n-rust-v.4', number: 30, base: 'main', headSha: SHA('c') } });
  expectError(assert, r, 'DEPENDENCY_BLOCKED');
  assert.deepEqual(r.error.details.pending, [late]);
  h.ok(W(3), 'TASK_READY_FOR_REVIEW', 'Task', late, { headSha: SHA('3') });
  h.readySliceDelivery(sl.id);
  expectError(assert, h.run(M, 'TASK_CREATE', 'Task', 'NEW', { program: 'P2', slice: sl.key, title: 'too late' }), 'POLICY_DENIED');
  assert.equal(tasks.length, 2);
});

test('exactly one delivery PR: a rejected PR reopens the slice; after merge no second PR is possible', () => {
  const h = harness();
  const { sl } = sliceWithReadyTasks(h, 2);
  const first = h.readySliceDelivery(sl.id, SHA('c'), 30);
  expectError(assert, h.run(M, 'MQ_ADMIT', 'MergeQueueItem', 'NEW', { sliceId: sl.id, pr: { repository: 'Catzpro01/n8n-rust-v.4', number: 31, base: 'main', headSha: SHA('e') } }), 'INVALID_STATE_TRANSITION');
  h.ok(M, 'MQ_HOLD', 'MergeQueueItem', first, { reasonCode: 'RECONCILE_TASK_COMMITS' });
  assert.equal(h.get('Slice', sl.id).state, 'DELIVERING');
  h.ok(M, 'MQ_REJECT', 'MergeQueueItem', first, { reasonCode: 'REPLACED_BY_RECONCILED_PR' });
  const reopened = h.get('Slice', sl.id);
  assert.equal(reopened.state, 'OPEN');
  assert.equal(reopened.rejectedDeliveries.length, 1);
  assert.equal(reopened.rejectedDeliveries[0].prNumber, 30);
  const second = h.readySliceDelivery(sl.id, SHA('e'), 31);
  h.mergeSliceDelivery(sl.id, second, SHA('e'), SHA('f'));
  expectError(assert, h.run(M, 'MQ_ADMIT', 'MergeQueueItem', 'NEW', { sliceId: sl.id, pr: { repository: 'Catzpro01/n8n-rust-v.4', number: 32, base: 'main', headSha: SHA('a') } }), 'DUPLICATE');
  meetAll(h, sl.id);
  assert.equal(complete(h, sl.id, SHA('f')).ok, true);
  assert.equal(h.get('Slice', sl.id).delivery.prNumber, 31);
});

test('a PR number belongs to one delivery subject only', () => {
  const h = harness();
  const { sl } = sliceWithReadyTasks(h, 1);
  const other = h.slice('P3', 1);
  const t = h.working(2, { program: 'P3', slice: other.key });
  h.ok(W(2), 'TASK_READY_FOR_REVIEW', 'Task', t, { headSha: SHA('9') });
  const mq = h.readySliceDelivery(sl.id, SHA('c'), 40);
  h.mergeSliceDelivery(sl.id, mq);
  expectError(assert, h.run(M, 'MQ_ADMIT', 'MergeQueueItem', 'NEW', { sliceId: other.id, pr: { repository: 'Catzpro01/n8n-rust-v.4', number: 40, base: 'main', headSha: SHA('9') } }), 'DUPLICATE');
});

test('completion gate enforces all eight points, in order', () => {
  const h = harness();
  const { sl } = sliceWithReadyTasks(h, 2, { criteria: [{ id: 'AC-1', text: 'feature works' }, { id: 'AC-2', text: 'docs updated' }] });
  const gateOf = (r) => { expectError(assert, r, 'EVIDENCE_INSUFFICIENT'); return r.error.details.gate; };
  // Not merged yet: SLICE_COMPLETE is only reachable from VERIFYING.
  expectError(assert, complete(h, sl.id), 'INVALID_STATE_TRANSITION');
  const mq = h.readySliceDelivery(sl.id);
  h.mergeSliceDelivery(sl.id, mq);
  // 2. acceptance
  assert.equal(gateOf(complete(h, sl.id)), 'ACCEPTANCE_MET');
  expectError(assert, h.run(M, 'SLICE_UPDATE_ACCEPTANCE', 'Slice', sl.id, { criteria: [{ id: 'AC-1', met: true }] }), 'EVIDENCE_INSUFFICIENT');
  h.ok(M, 'SLICE_UPDATE_ACCEPTANCE', 'Slice', sl.id, { criteria: [{ id: 'AC-1', met: true, evidenceRef: 'e2e run' }] });
  assert.equal(gateOf(complete(h, sl.id)), 'ACCEPTANCE_MET');
  h.ok(M, 'SLICE_UPDATE_ACCEPTANCE', 'Slice', sl.id, { criteria: [{ id: 'AC-2', met: true, evidenceRef: 'docs diff' }] });
  // 8. milestone register
  assert.equal(gateOf(h.run(M, 'SLICE_COMPLETE', 'Slice', sl.id, {})), 'MILESTONE_REGISTER_UPDATED');
  assert.equal(gateOf(complete(h, sl.id, SHA('7'))), 'MILESTONE_REGISTER_UPDATED');
  assert.equal(gateOf(h.run(M, 'SLICE_COMPLETE', 'Slice', sl.id, { milestoneRegister: { path: 'README.md', commitSha: SHA('d') } })), 'MILESTONE_REGISTER_UPDATED');
  assert.equal(complete(h, sl.id).ok, true);
});

test('completion gate: CI must be anchored to the exact delivery head; main verification must match', () => {
  const h = harness();
  const { sl } = sliceWithReadyTasks(h, 1);
  const head = SHA('c');
  // Admit with CI evidence on the head, then revoke it after the merge to prove the gate re-checks.
  const mq = h.readySliceDelivery(sl.id, head);
  h.mergeSliceDelivery(sl.id, mq, head, SHA('d'));
  meetAll(h, sl.id);
  const ci = h.cp.store.list('Evidence').find((e) => e.sliceId === sl.id && e.type === 'CI');
  h.ok(M, 'EVIDENCE_REVOKE', 'Evidence', ci.objectId, { reasonCode: 'WRONG_RUN' });
  const r = complete(h, sl.id);
  expectError(assert, r, 'EVIDENCE_INSUFFICIENT');
  assert.equal(r.error.details.gate, 'EXACT_HEAD_CI_PASS');
  h.sliceEvidence(sl.id, 'CI', { subjectType: 'WORKFLOW_RUN', subjectId: '123456', subjectDigest: SHA('e') }, { trust: 'CI_VERIFIED', verifyTrust: 'CI_VERIFIED', actor: SYS('SYSTEM-CI') });
  assert.equal(complete(h, sl.id).error.details.gate, 'EXACT_HEAD_CI_PASS', 'CI on another head does not count');
  h.sliceEvidence(sl.id, 'CI', { subjectType: 'WORKFLOW_RUN', subjectId: '123457', subjectDigest: head }, { trust: 'CI_VERIFIED', verifyTrust: 'CI_VERIFIED', actor: SYS('SYSTEM-CI') });
  assert.equal(complete(h, sl.id).ok, true);
});

test('rework of one slice task rejects the pending delivery PR and reopens the slice', () => {
  const h = harness();
  const { sl, tasks } = sliceWithReadyTasks(h, 2);
  const mq = h.readySliceDelivery(sl.id);
  h.ok(M, 'TASK_REWORK', 'Task', tasks[0], { reasonCode: 'REVIEW_FINDINGS' });
  assert.equal(h.get('MergeQueueItem', mq).state, 'REJECTED');
  assert.equal(h.get('Slice', sl.id).state, 'OPEN');
  assert.equal(h.get('Task', tasks[0]).state, 'WORKING');
  assert.equal(h.get('Task', tasks[1]).state, 'READY_FOR_REVIEW');
});

test('merge-start moves every slice task; a hold during merging returns tasks to HOLD and the slice to DELIVERING', () => {
  const h = harness();
  const { sl, tasks } = sliceWithReadyTasks(h, 2);
  const mq = h.readySliceDelivery(sl.id);
  h.ok(M, 'MQ_AUTHORIZE', 'MergeQueueItem', mq, { observedHeadSha: SHA('c') });
  h.ok(SYS('SYSTEM-MERGE-EXECUTOR'), 'MQ_MERGE_START', 'MergeQueueItem', mq, { observedHeadSha: SHA('c') });
  assert.equal(h.get('Slice', sl.id).state, 'MERGING');
  for (const t of tasks) assert.equal(h.get('Task', t).state, 'MERGING');
  h.ok(M, 'MQ_OBSERVE_HEAD', 'MergeQueueItem', mq, { headSha: SHA('e') });
  assert.equal(h.get('MergeQueueItem', mq).state, 'HOLD');
  assert.equal(h.get('Slice', sl.id).state, 'DELIVERING');
  assert.equal(h.get('Slice', sl.id).delivery.headSha, SHA('e'));
  for (const t of tasks) assert.equal(h.get('Task', t).state, 'HOLD');
});

test('a merged slice delivery cannot be rejected (fix forward); cancel/supersede need terminal tasks', () => {
  const h = harness();
  const { sl, tasks } = sliceWithReadyTasks(h, 1);
  const mq = h.readySliceDelivery(sl.id);
  h.mergeSliceDelivery(sl.id, mq);
  expectError(assert, h.run(M, 'MQ_REJECT', 'MergeQueueItem', mq, { reasonCode: 'LATE' }), 'ALREADY_TERMINAL');
  const other = h.slice('P4', 1);
  const t = h.task({ program: 'P4', slice: other.key });
  expectError(assert, h.run(M, 'SLICE_CANCEL', 'Slice', other.id, { reasonCode: 'DESCOPED' }), 'DEPENDENCY_BLOCKED');
  h.ok(M, 'TASK_SUPERSEDE', 'Task', t, { supersededBy: tasks[0], reasonCode: 'MERGED_ELSEWHERE' });
  const repl = h.slice('P4', 2);
  expectError(assert, h.run(M, 'SLICE_SUPERSEDE', 'Slice', other.id, { supersededBy: repl.id }), 'INVALID_SCHEMA');
  h.ok(M, 'SLICE_SUPERSEDE', 'Slice', other.id, { supersededBy: repl.id, reasonCode: 'SCOPE_MERGED' });
  assert.equal(h.get('Slice', other.id).supersededBy, repl.id);
  expectError(assert, h.run(M, 'SLICE_CANCEL', 'Slice', repl.id), 'INVALID_SCHEMA');
  h.ok(M, 'SLICE_CANCEL', 'Slice', repl.id, { reasonCode: 'DESCOPED' });
});

test('dependencies between tasks of the same slice do not block its delivery PR', () => {
  const h = harness();
  const sl = h.slice('P6', 1);
  const a = h.working(1, { program: 'P6', slice: sl.key, scope: { paths: ['a/'] } });
  const b = h.working(2, { program: 'P6', slice: sl.key, scope: { paths: ['b/'] }, dependencies: [{ taskId: a }] });
  for (const [n, id] of [[1, a], [2, b]]) h.ok(W(n), 'TASK_READY_FOR_REVIEW', 'Task', id, { headSha: SHA(String(n)) });
  const mq = h.readySliceDelivery(sl.id);
  const item = h.get('MergeQueueItem', mq);
  assert.equal(item.checks.dependency, 'CLEAR');
  assert.equal(item.state, 'READY');
});
