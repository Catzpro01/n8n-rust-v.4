import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMerge } from '../src/domain.mjs';
import { loadPolicy } from '../src/core.mjs';
import { harness, expectError, M, W, SYS, SHA, HUMAN } from './helpers.mjs';

const { policy } = loadPolicy();
const SAFE_CLASS = { impact: 'LOCAL', governanceChange: false, securityChange: false, contractLock: false, generatedState: false, migration: false, sharedSurface: false, humanApprovalRequired: false, decisionPending: false };

test('head change on a READY item -> HOLD, checks reset, authorization revoked (exact-head pin)', () => {
  const h = harness();
  const id = h.working(1);
  const mq = h.readyForMerge(id);
  const auth = h.ok(M, 'MQ_AUTHORIZE', 'MergeQueueItem', mq, { observedHeadSha: SHA('a') }).data.leaseId;
  const r = h.ok(SYS('SYSTEM-GITHUB-WEBHOOK'), 'MQ_OBSERVE_HEAD', 'MergeQueueItem', mq, { headSha: SHA('c') });
  assert.equal(r.data.headChanged, true);
  const item = h.get('MergeQueueItem', mq);
  assert.equal(item.state, 'HOLD');
  assert.equal(item.pr.headSha, SHA('c'));
  assert.equal(item.checks.exactHeadCi, 'PENDING');
  assert.equal(item.checks.checkedHeadSha, null);
  assert.equal(h.get('Lease', auth).state, 'REVOKED');
  expectError(assert, h.run(SYS('SYSTEM-MERGE-EXECUTOR'), 'MQ_MERGE_START', 'MergeQueueItem', mq, { observedHeadSha: SHA('c') }), 'INVALID_STATE_TRANSITION');
  // stale check results for the old head are refused
  expectError(assert, h.run(SYS('SYSTEM-CI'), 'MQ_UPDATE_CHECKS', 'MergeQueueItem', mq, { headSha: SHA('a'), checks: { exactHeadCi: 'PASS' } }), 'MERGE_HEAD_CHANGED');
  // releasing to READY is refused until exact-head evidence exists for the new head
  expectError(assert, h.run(M, 'MQ_RELEASE', 'MergeQueueItem', mq, { state: 'READY' }), 'POLICY_DENIED');
});

test('authorization and merge start verify the observed head; merge result must match the verified head', () => {
  const h = harness();
  const id = h.working(1);
  const mq = h.readyForMerge(id);
  expectError(assert, h.run(M, 'MQ_AUTHORIZE', 'MergeQueueItem', mq, { observedHeadSha: SHA('d') }), 'MERGE_HEAD_CHANGED');
  h.ok(M, 'MQ_AUTHORIZE', 'MergeQueueItem', mq, { observedHeadSha: SHA('a') });
  expectError(assert, h.run(M, 'MQ_AUTHORIZE', 'MergeQueueItem', mq, { observedHeadSha: SHA('a') }), 'DUPLICATE');
  expectError(assert, h.run(SYS('SYSTEM-MERGE-EXECUTOR'), 'MQ_MERGE_START', 'MergeQueueItem', mq, { observedHeadSha: SHA('d') }), 'MERGE_HEAD_CHANGED');
  h.ok(SYS('SYSTEM-MERGE-EXECUTOR'), 'MQ_MERGE_START', 'MergeQueueItem', mq, { observedHeadSha: SHA('a') });
  assert.equal(h.get('Task', id).state, 'MERGING');
  expectError(assert, h.run(SYS('SYSTEM-MERGE-EXECUTOR'), 'MQ_MERGE_RESULT', 'MergeQueueItem', mq, { mergedHeadSha: SHA('d'), mergeSha: SHA('b') }), 'MERGE_HEAD_CHANGED');
});

test('merge authorization expires (900s, not renewable) and must be re-issued, never revived', () => {
  const h = harness();
  const id = h.working(1);
  const mq = h.readyForMerge(id);
  const lease = h.ok(M, 'MQ_AUTHORIZE', 'MergeQueueItem', mq, { observedHeadSha: SHA('a') }).data.leaseId;
  expectError(assert, h.run(M, 'LEASE_RENEW', 'Lease', lease), 'POLICY_DENIED');
  h.advance(901);
  expectError(assert, h.run(SYS('SYSTEM-MERGE-EXECUTOR'), 'MQ_MERGE_START', 'MergeQueueItem', mq, { observedHeadSha: SHA('a') }), 'LEASE_EXPIRED');
  const again = h.ok(M, 'MQ_AUTHORIZE', 'MergeQueueItem', mq, { observedHeadSha: SHA('a') }).data.leaseId;
  assert.notEqual(again, lease);
  assert.equal(h.get('Lease', lease).state, 'EXPIRED');
  assert.equal(h.get('Lease', again).predecessorId, lease);
});

test('IRREVERSIBLE rollback class is never autonomous: human approval bound to the exact item', () => {
  const h = harness();
  const id = h.working(1, { execution: { rollbackClass: 'IRREVERSIBLE' } });
  const mq = h.readyForMerge(id);
  expectError(assert, h.run(M, 'MQ_AUTHORIZE', 'MergeQueueItem', mq, { observedHeadSha: SHA('a') }), 'HUMAN_APPROVAL_REQUIRED');
  const wrong = h.ok(HUMAN, 'HUMAN_APPROVE', 'Approval', 'NEW', { commandType: 'MQ_MERGE_START', subjectObjectType: 'MergeQueueItem', subjectObjectId: mq, reasonCode: 'OK' }).objectId;
  expectError(assert, h.run(M, 'MQ_AUTHORIZE', 'MergeQueueItem', mq, { observedHeadSha: SHA('a'), humanApprovalId: wrong }), 'HUMAN_APPROVAL_REQUIRED');
  const apr = h.ok(HUMAN, 'HUMAN_APPROVE', 'Approval', 'NEW', { commandType: 'MQ_AUTHORIZE', subjectObjectType: 'MergeQueueItem', subjectObjectId: mq, reasonCode: 'OK' }).objectId;
  h.ok(M, 'MQ_AUTHORIZE', 'MergeQueueItem', mq, { observedHeadSha: SHA('a'), humanApprovalId: apr });
  assert.equal(h.get('MergeQueueItem', mq).humanApprovalId, apr);
});

test('merge classifier: SAFE-AUTO only when every gate is explicitly clear; unknowns route to MANAGER; failures to HOLD', () => {
  const base = { pr: { headSha: SHA('a') }, checks: { exactHeadCi: 'PASS', architecture: 'PASS', acceptance: 'PASS', evidence: 'PASS', reservation: 'CLEAR', dependency: 'CLEAR', checkedHeadSha: SHA('a') }, classification: SAFE_CLASS, rollback: { class: 'SIMPLE', verified: true } };
  assert.equal(classifyMerge(base, policy, { task: { execution: { mergeLane: 'SAFE-AUTO' } } }).lane, 'SAFE-AUTO');
  assert.equal(classifyMerge({ ...base, classification: { impact: 'LOCAL' } }, policy, {}).lane, 'MANAGER');
  assert.equal(classifyMerge({ ...base, classification: { ...SAFE_CLASS, securityChange: true } }, policy, {}).lane, 'MANAGER');
  assert.equal(classifyMerge({ ...base, rollback: { class: 'MIGRATION', verified: true } }, policy, {}).lane, 'MANAGER');
  assert.equal(classifyMerge(base, policy, { managerLaneReservation: true }).lane, 'MANAGER');
  assert.equal(classifyMerge({ ...base, checks: { ...base.checks, exactHeadCi: 'FAIL' } }, policy, {}).lane, 'HOLD');
  assert.equal(classifyMerge({ ...base, checks: { ...base.checks, checkedHeadSha: SHA('9') } }, policy, {}).lane, 'HOLD');
  assert.equal(classifyMerge({ ...base, checks: { ...base.checks, checkedHeadSha: null } }, policy, {}).lane, 'HOLD');
});

test('SAFE-AUTO lane end to end: the system classifier may authorize, executor merges', () => {
  const h = harness();
  const id = h.working(1, { execution: { mergeLane: 'SAFE-AUTO', rollbackClass: 'SIMPLE' } });
  const mq = h.readyForMerge(id, 1, SHA('a'), { classification: SAFE_CLASS, rollback: { strategy: 'git revert', verified: true } });
  const item = h.get('MergeQueueItem', mq);
  assert.equal(item.lane, 'SAFE-AUTO', item.laneReasons.join('; '));
  h.ok(SYS('SYSTEM-MERGE-CLASSIFIER'), 'MQ_AUTHORIZE', 'MergeQueueItem', mq, { observedHeadSha: SHA('a') });
  assert.equal(h.mergeAndVerify.length > 0, true);
});

test('contract-lock reservation raises the lane to MANAGER', () => {
  const h = harness();
  const id = h.working(1, { execution: { mergeLane: 'SAFE-AUTO' } });
  const r = h.ok(W(1), 'RESERVATION_REQUEST', 'Reservation', 'NEW', { taskId: id, mode: 'CONTRACT_LOCK', scope: { contracts: ['rest-api'] } }).objectId;
  h.ok(M, 'RESERVATION_CHECK', 'Reservation', r);
  h.ok(M, 'RESERVATION_ACTIVATE', 'Reservation', r);
  assert.equal(h.get('Task', id).execution.mergeLane, 'MANAGER');
  const mq = h.readyForMerge(id, 1, SHA('a'), { classification: SAFE_CLASS, rollback: { verified: true } });
  assert.equal(h.get('MergeQueueItem', mq).lane, 'MANAGER');
});

test('merge queue refuses a PR head that differs from the task head and duplicate admissions', () => {
  const h = harness();
  const id = h.working(1);
  h.ok(W(1), 'TASK_READY_FOR_REVIEW', 'Task', id, { headSha: SHA('a') });
  expectError(assert, h.run(W(1), 'MQ_ADMIT', 'MergeQueueItem', 'NEW', { taskId: id, pr: { repository: 'r/r', number: 1, base: 'main', headSha: SHA('e') } }), 'MERGE_HEAD_CHANGED');
  h.ok(W(1), 'MQ_ADMIT', 'MergeQueueItem', 'NEW', { taskId: id, pr: { repository: 'r/r', number: 1, base: 'main', headSha: SHA('a') } });
  expectError(assert, h.run(W(1), 'MQ_ADMIT', 'MergeQueueItem', 'NEW', { taskId: id, pr: { repository: 'r/r', number: 1, base: 'main', headSha: SHA('a') } }), 'DUPLICATE');
});

test('transfer: handoff required, lease TRANSFERRED to a successor, reservations follow, counter increments', () => {
  const h = harness();
  const id = h.working(1);
  h.agent(2);
  const r = h.ok(W(1), 'RESERVATION_REQUEST', 'Reservation', 'NEW', { taskId: id, mode: 'EXCLUSIVE', scope: { paths: ['q/'] } }).objectId;
  h.ok(M, 'RESERVATION_CHECK', 'Reservation', r);
  h.ok(M, 'RESERVATION_ACTIVATE', 'Reservation', r);
  const oldLease = h.get('Task', id).execution.activeLeaseId;
  expectError(assert, h.run(M, 'TASK_TRANSFER', 'Task', id, { toAgentId: 'AGENT-02' }), 'POLICY_DENIED');
  const hnd = h.ok(W(1), 'HANDOFF_PUBLISH', 'Handoff', 'NEW', { taskId: id, nextAction: 'continue at step 3', files: ['q/a.mjs'], tests: [], evidence: [], decisions: [], blockers: [] }).objectId;
  h.ok(M, 'TASK_TRANSFER', 'Task', id, { toAgentId: 'AGENT-02', handoffId: hnd, reasonCode: 'REBALANCE' });
  const t = h.get('Task', id);
  assert.equal(t.owner.agentId, 'AGENT-02');
  assert.equal(t.state, 'WORKING');
  assert.equal(t.branch.taskBranch, `arena/agent-02/${id}`);
  assert.equal(t.history.reassignedCount, 1);
  assert.equal(h.get('Lease', oldLease).state, 'TRANSFERRED');
  assert.equal(h.get('Lease', oldLease).successorId, t.execution.activeLeaseId);
  assert.equal(h.get('Reservation', r).state, 'TRANSFERRED');
  const succ = h.get('Reservation', t.execution.reservationIds[0]);
  assert.equal(succ.ownerAgentId, 'AGENT-02');
  assert.equal(succ.predecessorId, r);
  assert.equal(h.get('AgentState', 'AGENT-01').state, 'AVAILABLE');
  assert.equal(h.get('AgentState', 'AGENT-02').state, 'ASSIGNED');
  expectError(assert, h.run(W(1), 'TASK_PROGRESS', 'Task', id, { nextAction: 'x' }), 'FORBIDDEN');
});

test('anti-thrashing: the 4th reassignment needs FREEZE -> DIAGNOSE -> ACTIVE decision', () => {
  const h = harness();
  const id = h.working(1);
  for (const n of [2, 3, 4]) h.agent(n);
  const hop = (to) => {
    const owner = h.get('Task', id).owner.agentId;
    const hnd = h.ok({ type: 'WORKER', id: owner }, 'HANDOFF_PUBLISH', 'Handoff', 'NEW', { taskId: id, nextAction: 'n', files: [], tests: [], evidence: [], decisions: [], blockers: [] }).objectId;
    return h.run(M, 'TASK_TRANSFER', 'Task', id, { toAgentId: to, handoffId: hnd, reasonCode: 'X' });
  };
  assert.equal(hop('AGENT-02').ok, true);
  assert.equal(hop('AGENT-03').ok, true);
  assert.equal(hop('AGENT-01').ok, true);
  const blocked = hop('AGENT-04');
  expectError(assert, blocked, 'POLICY_DENIED');
  assert.equal(blocked.error.details.antiThrashing, true);
  h.ok(M, 'TASK_FREEZE', 'Task', id, { reasonCode: 'THRASHING' });
  expectError(assert, h.run(M, 'TASK_UNFREEZE', 'Task', id, {}), 'GOVERNANCE_REQUIRED');
  const d = h.ok(M, 'DECISION_PROPOSE', 'Decision', 'NEW', { category: 'WORKFORCE', title: 'fix scope', problem: 'thrash', options: [{ id: 'split', summary: 'split task' }], selectedOption: 'split', rationale: 'r' }).objectId;
  h.ok(M, 'DECISION_REVIEW', 'Decision', d);
  h.ok(M, 'DECISION_ACTIVATE', 'Decision', d);
  h.ok(M, 'TASK_UNFREEZE', 'Task', id, { decisionId: d });
  const owner = h.get('Task', id).owner.agentId;
  const hnd = h.ok({ type: 'WORKER', id: owner }, 'HANDOFF_PUBLISH', 'Handoff', 'NEW', { taskId: id, nextAction: 'n', files: [], tests: [], evidence: [], decisions: [], blockers: [] }).objectId;
  h.ok(M, 'TASK_TRANSFER', 'Task', id, { toAgentId: 'AGENT-04', handoffId: hnd, decisionId: d, reasonCode: 'X' });
});

test('capacity: maxTasksPerWorker=1 and capability matching are enforced on assignment', () => {
  const h = harness();
  h.working(1);
  const t2 = h.task();
  expectError(assert, h.run(M, 'TASK_ASSIGN', 'Task', t2, { agentId: 'AGENT-01' }), 'RESOURCE_UNAVAILABLE');
  const t3 = h.task({ requirements: { capabilities: ['rust'] } });
  h.agent(2);
  const r = h.run(M, 'TASK_ASSIGN', 'Task', t3, { agentId: 'AGENT-02' });
  expectError(assert, r, 'POLICY_DENIED');
  assert.deepEqual(r.error.details.missing, ['rust']);
  const t4 = h.task({ execution: { hold: true } });
  expectError(assert, h.run(M, 'TASK_ASSIGN', 'Task', t4, { agentId: 'AGENT-02' }), 'POLICY_DENIED');
});
