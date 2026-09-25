import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, expectError, M, W, SYS, SHA, HUMAN } from './helpers.mjs';

test('full lifecycle: create -> assign -> work -> review -> merge -> fresh-main -> COMPLETED', () => {
  const h = harness();
  const id = h.working(1);
  const task = h.get('Task', id);
  assert.equal(task.branch.taskBranch, `arena/agent-01/${id}`);
  assert.equal(h.get('AgentState', 'AGENT-01').state, 'WORKING');
  const mq = h.readyForMerge(id);
  assert.equal(h.get('MergeQueueItem', mq).state, 'READY');
  const done = h.mergeAndVerify(id, mq);
  assert.equal(done.resultingState, 'COMPLETED');
  const final = h.get('Task', id);
  assert.equal(final.current.completedMainSha, SHA('b'));
  assert.equal(final.execution.activeLeaseId, null);
  assert.ok(h.cp.store.list('Lease').every((l) => l.state !== 'ACTIVE'), 'no authority survives completion');
  const agent = h.get('AgentState', 'AGENT-01');
  assert.equal(agent.state, 'AVAILABLE');
  assert.equal(agent.capacity.activeTaskCount, 0);
  assert.deepEqual(agent.assignment.taskIds, []);
});

test('success result carries revisions, event ids and side effects', () => {
  const h = harness();
  h.agent(1);
  const id = h.task();
  const r = h.ok(M, 'TASK_ASSIGN', 'Task', id, { agentId: 'AGENT-01' });
  assert.equal(r.previousRevision, 1);
  assert.equal(r.newRevision, 2);
  assert.equal(r.resultingState, 'CLAIMED');
  assert.match(r.eventId, /^EVT-\d{6}$/);
  assert.equal(r.idempotentReplay, false);
  assert.ok(r.sideEffects.some((s) => s.objectType === 'Lease' && s.state === 'ACTIVE'));
  assert.ok(r.sideEffects.some((s) => s.objectType === 'AgentState' && s.state === 'ASSIGNED'));
  const evts = h.cp.store.events().filter((e) => r.eventIds.includes(e.eventId));
  assert.ok(evts.every((e) => e.policyDigest === h.cp.policyDigest && e.txId));
});

test('COMPLETE is refused without merge, without fresh-main evidence, or with only a CLAIM', () => {
  const h = harness();
  const id = h.working(1);
  h.ok(W(1), 'TASK_READY_FOR_REVIEW', 'Task', id, { headSha: SHA('a') });
  expectError(assert, h.run(M, 'TASK_COMPLETE', 'Task', id), 'INVALID_STATE_TRANSITION');
  const h2 = harness();
  const t2 = h2.working(1);
  const mq = h2.readyForMerge(t2);
  h2.ok(M, 'MQ_AUTHORIZE', 'MergeQueueItem', mq, { observedHeadSha: SHA('a') });
  h2.ok(SYS('SYSTEM-MERGE-EXECUTOR'), 'MQ_MERGE_START', 'MergeQueueItem', mq, { observedHeadSha: SHA('a') });
  h2.ok(SYS('SYSTEM-MERGE-EXECUTOR'), 'MQ_MERGE_RESULT', 'MergeQueueItem', mq, { mergedHeadSha: SHA('a'), mergeSha: SHA('b') });
  // merged but not fresh-main verified: MERGED != COMPLETE
  expectError(assert, h2.run(M, 'TASK_COMPLETE', 'Task', t2), 'EVIDENCE_INSUFFICIENT');
  expectError(assert, h2.run(M, 'MQ_VERIFY', 'MergeQueueItem', mq), 'EVIDENCE_INSUFFICIENT');
  h2.evidence(W(1), t2, 'CLAIM', null, { verifyTrust: 'SELF_REPORTED' });
  expectError(assert, h2.run(M, 'TASK_COMPLETE', 'Task', t2), 'EVIDENCE_INSUFFICIENT');
  // MAIN_VERIFICATION can never be verified below MAIN_VERIFIED
  const ev = h2.ok(M, 'EVIDENCE_PROPOSE', 'Evidence', 'NEW', { taskId: t2, type: 'MAIN_VERIFICATION', trustLevel: 'REVIEW_VERIFIED', subject: { subjectType: 'MAIN', subjectId: SHA('b') }, result: { status: 'PASS', summary: 'x' } }).objectId;
  h2.ok(M, 'EVIDENCE_PUBLISH', 'Evidence', ev);
  expectError(assert, h2.run(M, 'EVIDENCE_VERIFY', 'Evidence', ev, { trustLevel: 'REVIEW_VERIFIED' }), 'POLICY_DENIED');
});

test('evidence must be anchored to immutable subjects', () => {
  const h = harness();
  const id = h.working(1);
  const bad = (subject, type = 'CI') => h.run(W(1), 'EVIDENCE_PROPOSE', 'Evidence', 'NEW', { taskId: id, type, subject, result: { status: 'PASS', summary: 'x' } });
  expectError(assert, bad(null), 'EVIDENCE_INSUFFICIENT');
  expectError(assert, bad({ subjectType: 'COMMIT', subjectId: 'main' }), 'EVIDENCE_INSUFFICIENT');
  expectError(assert, bad({ subjectType: 'PR_HEAD', subjectId: SHA('a') }), 'EVIDENCE_INSUFFICIENT');
  expectError(assert, bad({ subjectType: 'COMMIT', subjectId: SHA('a') }, 'MAIN_VERIFICATION'), 'EVIDENCE_INSUFFICIENT');
  assert.equal(bad({ subjectType: 'WORKFLOW_RUN', subjectId: '123', subjectDigest: SHA('a') }).ok, true);
});

test('terminal objects never mutate (ALREADY_TERMINAL) and cancellation keeps the record', () => {
  const h = harness();
  const id = h.task();
  h.ok(M, 'TASK_ASSIGN', 'Task', id, { agentId: h.agent(1) });
  h.ok(M, 'TASK_CANCEL', 'Task', id, { reasonCode: 'OBSOLETE' });
  const t = h.get('Task', id);
  assert.equal(t.state, 'CANCELLED');
  assert.equal(t.current.reason.code, 'OBSOLETE');
  expectError(assert, h.run(M, 'TASK_ASSIGN', 'Task', id, { agentId: 'AGENT-01' }), 'ALREADY_TERMINAL');
  expectError(assert, h.run(M, 'TASK_CANCEL', 'Task', id, { reasonCode: 'X' }), 'ALREADY_TERMINAL');
  assert.equal(h.get('AgentState', 'AGENT-01').state, 'AVAILABLE');
});

test('reason-required states demand a structured reason code', () => {
  const h = harness();
  const id = h.working(1);
  expectError(assert, h.run(W(1), 'TASK_BLOCK', 'Task', id, {}), 'INVALID_SCHEMA');
  h.ok(W(1), 'TASK_BLOCK', 'Task', id, { reasonCode: 'WAITING_ON_TASK' });
  assert.equal(h.get('Task', id).current.blocker.code, 'WAITING_ON_TASK');
  assert.equal(h.get('AgentState', 'AGENT-01').state, 'BLOCKED');
  h.ok(W(1), 'TASK_START', 'Task', id);
  assert.equal(h.get('AgentState', 'AGENT-01').state, 'WORKING');
});

test('cancel semantics (DEC-0005): READY_FOR_REVIEW cannot cancel directly; work in progress needs a handoff; HOLD can cancel', () => {
  const h = harness();
  const id = h.working(1);
  expectError(assert, h.run(M, 'TASK_CANCEL', 'Task', id, { reasonCode: 'X' }), 'POLICY_DENIED');
  h.ok(W(1), 'TASK_READY_FOR_REVIEW', 'Task', id, { headSha: SHA('a') });
  expectError(assert, h.run(M, 'TASK_CANCEL', 'Task', id, { reasonCode: 'X' }), 'INVALID_STATE_TRANSITION');
  h.ok(M, 'TASK_HOLD', 'Task', id, { reasonCode: 'SCOPE_QUESTION' });
  const hnd = h.ok(W(1), 'HANDOFF_PUBLISH', 'Handoff', 'NEW', { taskId: id, nextAction: 'abandon', files: [], tests: [], evidence: [], decisions: [], blockers: [] }).objectId;
  h.ok(M, 'TASK_CANCEL', 'Task', id, { reasonCode: 'OBSOLETE', handoffId: hnd });
  assert.equal(h.get('Task', id).state, 'CANCELLED');
});

test('rework reissues an expired assignment lease (never revives it) and rejects the queue item', () => {
  const h = harness();
  const id = h.working(1);
  const mq = h.readyForMerge(id);
  const oldLease = h.get('Task', id).execution.activeLeaseId;
  h.advance(3700);
  h.ok(M, 'TASK_REWORK', 'Task', id, { reasonCode: 'REVIEW_CHANGES' });
  const t = h.get('Task', id);
  assert.notEqual(t.execution.activeLeaseId, oldLease);
  assert.equal(h.get('Lease', oldLease).state, 'EXPIRED');
  assert.equal(h.get('Lease', t.execution.activeLeaseId).predecessorId, oldLease);
  assert.equal(h.get('MergeQueueItem', mq).state, 'REJECTED');
  assert.equal(t.history.retryCount, 1);
});

test('agent retirement with live leases requires human approval, consumed exactly once', () => {
  const h = harness();
  h.agent(1);
  const id = h.task();
  h.ok(M, 'TASK_ASSIGN', 'Task', id, { agentId: 'AGENT-01' });
  const lease = h.ok(M, 'LEASE_ISSUE', 'Lease', 'NEW', { leaseType: 'EXTERNAL_EXECUTION', taskId: id }).objectId;
  h.ok(M, 'TASK_UNCLAIM', 'Task', id, { reasonCode: 'REPLAN' });
  assert.equal(h.get('Lease', lease).state, 'ACTIVE');
  expectError(assert, h.run(M, 'AGENT_RETIRE', 'AgentState', 'AGENT-01', { reasonCode: 'DECOMMISSION' }), 'HUMAN_APPROVAL_REQUIRED');
  const apr = h.ok(HUMAN, 'HUMAN_APPROVE', 'Approval', 'NEW', { commandType: 'AGENT_RETIRE', subjectObjectType: 'AgentState', subjectObjectId: 'AGENT-01', reasonCode: 'OWNER_OK' }).objectId;
  h.ok(M, 'AGENT_RETIRE', 'AgentState', 'AGENT-01', { reasonCode: 'DECOMMISSION', humanApprovalId: apr });
  assert.equal(h.get('AgentState', 'AGENT-01').state, 'RETIRED');
  assert.equal(h.get('Lease', lease).state, 'REVOKED');
  assert.equal(h.get('Approval', apr).consumedByCommandId !== null, true);
  assert.equal(h.get('Actor', 'AGENT-01').enabled, false);
  expectError(assert, h.run(W(1), 'AGENT_HEARTBEAT', 'AgentState', 'AGENT-01', {}), 'UNAUTHORIZED');
});

test('programs must be canonical (no invented P numbers)', () => {
  const h = harness();
  expectError(assert, h.run(M, 'TASK_CREATE', 'Task', 'NEW', { program: 'P24', title: 'new program' }), 'POLICY_DENIED');
  expectError(assert, h.run(M, 'TASK_CREATE', 'Task', 'NEW', { program: 'P12', title: 'revived legacy program' }), 'POLICY_DENIED');
  assert.equal(h.run(M, 'TASK_CREATE', 'Task', 'NEW', { program: 'P5', slice: 'P5-S01', title: 'slice under completed program' }).ok, true);
});

test('decision lifecycle: propose -> review -> activate auto-supersedes; promotion needs provenance + main SHA', () => {
  const h = harness();
  const base = { category: 'WORKFORCE', title: 't', problem: 'p', options: [{ id: 'a', summary: 'a' }, { id: 'b', summary: 'b' }], selectedOption: 'a', rationale: 'r', sources: { issues: [268] } };
  const d1 = h.ok(M, 'DECISION_PROPOSE', 'Decision', 'NEW', base).objectId;
  h.ok(M, 'DECISION_REVIEW', 'Decision', d1);
  h.ok(M, 'DECISION_ACTIVATE', 'Decision', d1);
  const d2 = h.ok(M, 'DECISION_PROPOSE', 'Decision', 'NEW', { ...base, supersedes: d1 }).objectId;
  h.ok(M, 'DECISION_REVIEW', 'Decision', d2);
  h.ok(M, 'DECISION_ACTIVATE', 'Decision', d2);
  assert.equal(h.get('Decision', d1).state, 'SUPERSEDED');
  assert.equal(h.get('Decision', d1).supersededBy, d2);
  expectError(assert, h.run(M, 'DECISION_PROMOTE_CANONICAL', 'Decision', d2, { mainPath: 'docs/x.json' }), 'EVIDENCE_INSUFFICIENT');
  h.ok(M, 'DECISION_PROMOTE_CANONICAL', 'Decision', d2, { mainPath: 'docs/x.json', mainCommitSha: SHA('c') });
  expectError(assert, h.run(M, 'DECISION_PROMOTE_CANONICAL', 'Decision', d2, { mainPath: 'docs/x.json', mainCommitSha: SHA('c') }), 'DUPLICATE');
  const d3 = h.ok(M, 'DECISION_PROPOSE', 'Decision', 'NEW', base).objectId;
  h.ok(M, 'DECISION_REJECT', 'Decision', d3, { reasonCode: 'NOT_NEEDED' });
  assert.equal(h.get('Decision', d3).state, 'REJECTED');
});

test('DEC-0011 TASK_COMPLETE_MANAGER_EXECUTED: same evidence bar, COMMIT anchored to merge SHA, never-assigned tasks only', () => {
  const h = harness();
  const ev = (taskId, type, subject, trustLevel) => {
    const id = h.ok(M, 'EVIDENCE_PROPOSE', 'Evidence', 'NEW', { taskId, type, trustLevel, subject, result: { status: 'PASS', summary: type } }).objectId;
    h.ok(M, 'EVIDENCE_PUBLISH', 'Evidence', id);
    h.ok(M, 'EVIDENCE_VERIFY', 'Evidence', id, { trustLevel });
  };
  const dep = h.task({ title: 'dep', scope: { paths: ['d/'] } });
  const t = h.task({ title: 'manager pr', scope: { paths: ['g/'] }, dependencies: [{ taskId: dep }] });
  const run = (id, sha = SHA('b')) => h.run(M, 'TASK_COMPLETE_MANAGER_EXECUTED', 'Task', id, { mergeSha: sha });
  expectError(assert, run(t), 'DEPENDENCY_BLOCKED');
  expectError(assert, run(dep), 'EVIDENCE_INSUFFICIENT');
  ev(dep, 'COMMIT', { subjectType: 'COMMIT', subjectId: SHA('b') }, 'REVIEW_VERIFIED');
  ev(dep, 'CI', { subjectType: 'WORKFLOW_RUN', subjectId: '123', subjectDigest: SHA('a') }, 'CI_VERIFIED');
  expectError(assert, run(dep), 'EVIDENCE_INSUFFICIENT');
  ev(dep, 'MAIN_VERIFICATION', { subjectType: 'MAIN', subjectId: SHA('b') }, 'MAIN_VERIFIED');
  expectError(assert, run(dep, SHA('c')), 'EVIDENCE_INSUFFICIENT');
  h.agent(1);
  expectError(assert, h.run(W(1), 'TASK_COMPLETE_MANAGER_EXECUTED', 'Task', dep, { mergeSha: SHA('b') }), 'GOVERNANCE_REQUIRED');
  h.ok(M, 'TASK_COMPLETE_MANAGER_EXECUTED', 'Task', dep, { mergeSha: SHA('b') });
  assert.equal(h.get('Task', dep).state, 'COMPLETED');
  assert.equal(h.get('Task', dep).current.completedMainSha, SHA('b'));
  expectError(assert, run(dep), 'ALREADY_TERMINAL');
  // A worker-assigned task must use TASK_COMPLETE (merge-queue path).
  const w = h.working(1, { scope: { paths: ['w/'] } });
  expectError(assert, run(w), 'INVALID_STATE_TRANSITION');
  // TASK_COMPLETE cannot use the new UNASSIGNED -> COMPLETED edge (still needs a MERGED merge-queue item).
  expectError(assert, h.run(M, 'TASK_COMPLETE', 'Task', t), 'EVIDENCE_INSUFFICIENT');
});
