// DEC-0015: two-phase execution (issue #285, owner model B).
// PHASE_A_REMOTE work keeps flowing while the self-hosted runners are offline; PHASE_B_RUNNER work
// waits in WAITING_RUNNER without holding a worker slot. A delivery PR may merge on green GitHub-hosted
// checks while self-hosted checks are WAITING_RUNNER, but WAITING_RUNNER is never PASS: the Slice stays
// VERIFYING until the self-hosted checks pass on main, and a failure moves it to REGRESSION.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, expectError, M, W, SYS, SHA } from './helpers.mjs';
import { verifyIntegrity } from '../src/recovery.mjs';
import { plan } from '../src/scheduler.mjs';
import { snapshot } from '../src/recovery.mjs';
import { classifyChecks, formatChecks } from '../src/checks.mjs';
import { statusReport } from '../src/render.mjs';
import { parseRunners } from '../src/cli.mjs';

const REGISTER = 'docs/n8n-lego/milestones.json';
const DEFERRED = ['Windows worker portability probe', 'validation'];

/** Slice with one Phase A task and one Phase B task, both READY_FOR_REVIEW. */
function mixedSlice(h) {
  const sl = h.slice('P5', 1, { key: 'P5-M01' });
  const a = h.working(1, { program: 'P5', slice: sl.key, title: 'contract + unit tests', scope: { paths: ['apps/a/'] } });
  const b = h.working(2, { program: 'P5', slice: sl.key, title: 'browser validation', scope: { paths: ['tests/e2e/'] }, execution: { phase: 'PHASE_B_RUNNER' }, requirements: { runnerType: 'WSL' } });
  h.ok(W(1), 'TASK_READY_FOR_REVIEW', 'Task', a, { headSha: SHA('1') });
  h.ok(W(2), 'TASK_READY_FOR_REVIEW', 'Task', b, { headSha: SHA('2') });
  return { sl, a, b };
}

/** Admit the delivery PR with hosted checks green and self-hosted checks WAITING_RUNNER, merge, verify main. */
function mergeWithDeferredChecks(h, sliceId, head = SHA('c'), main = SHA('d')) {
  h.sliceEvidence(sliceId, 'COMMIT', { subjectType: 'COMMIT', subjectId: head });
  h.sliceEvidence(sliceId, 'CI', { subjectType: 'PR_HEAD', subjectId: head, prNumber: 30 }, { trust: 'CI_VERIFIED', verifyTrust: 'CI_VERIFIED', actor: SYS('SYSTEM-CI') });
  const mq = h.ok(M, 'MQ_ADMIT', 'MergeQueueItem', 'NEW', { sliceId, pr: { repository: 'Catzpro01/n8n-rust-v.4', number: 30, base: 'main', headSha: head } }).objectId;
  h.ok(SYS('SYSTEM-CI'), 'MQ_UPDATE_CHECKS', 'MergeQueueItem', mq, { headSha: head, checks: { exactHeadCi: 'PASS', architecture: 'PASS', acceptance: 'PASS' }, deferredRunnerChecks: DEFERRED });
  const cls = h.ok(M, 'MQ_CLASSIFY', 'MergeQueueItem', mq);
  h.ok(M, 'MQ_AUTHORIZE', 'MergeQueueItem', mq, { observedHeadSha: head });
  h.ok(SYS('SYSTEM-MERGE-EXECUTOR'), 'MQ_MERGE_START', 'MergeQueueItem', mq, { observedHeadSha: head });
  h.ok(SYS('SYSTEM-MERGE-EXECUTOR'), 'MQ_MERGE_RESULT', 'MergeQueueItem', mq, { mergedHeadSha: head, mergeSha: main });
  h.sliceEvidence(sliceId, 'COMMIT', { subjectType: 'COMMIT', subjectId: main });
  h.sliceEvidence(sliceId, 'MAIN_VERIFICATION', { subjectType: 'MAIN', subjectId: main }, { trust: 'MAIN_VERIFIED', verifyTrust: 'MAIN_VERIFIED' });
  h.ok(M, 'MQ_VERIFY', 'MergeQueueItem', mq);
  return { mq, cls };
}

function runnerEvidence(h, owner, status, main, checks = DEFERRED) {
  const key = owner.sliceId ? { sliceId: owner.sliceId } : { taskId: owner.taskId };
  const id = h.ok(SYS('SYSTEM-CI'), 'EVIDENCE_PROPOSE', 'Evidence', 'NEW', { ...key, type: 'RUNNER_VERIFICATION', trustLevel: 'CI_VERIFIED', subject: { subjectType: 'MAIN', subjectId: main }, result: { status, summary: `self-hosted ${status}`, checks } }).objectId;
  h.ok(M, 'EVIDENCE_PUBLISH', 'Evidence', id);
  h.ok(M, 'EVIDENCE_VERIFY', 'Evidence', id, { trustLevel: 'CI_VERIFIED' });
  return id;
}

const meetAll = (h, sliceId) => {
  const sl = h.get('Slice', sliceId);
  h.ok(M, 'SLICE_UPDATE_ACCEPTANCE', 'Slice', sliceId, { criteria: sl.acceptance.criteria.map((c) => ({ id: c.id, met: true, evidenceRef: 'PR evidence' })) });
};
const complete = (h, sliceId, sha = SHA('d')) => h.run(M, 'SLICE_COMPLETE', 'Slice', sliceId, { milestoneRegister: { path: REGISTER, commitSha: sha } });

test('tasks are classified PHASE_A_REMOTE by default; PHASE_B_RUNNER declares its runner type', () => {
  const h = harness();
  const a = h.task();
  const ta = h.get('Task', a);
  assert.equal(ta.execution.phase, 'PHASE_A_REMOTE');
  assert.equal(ta.requirements.runnerRequired, false);
  assert.equal(ta.requirements.runnerType, null);
  const b = h.task({ execution: { phase: 'PHASE_B_RUNNER' }, requirements: { runnerType: 'WINDOWS' } });
  const tb = h.get('Task', b);
  assert.equal(tb.requirements.runnerRequired, true);
  assert.deepEqual(tb.requirements.runnerClasses, ['WINDOWS']);
  expectError(assert, h.run(M, 'TASK_CREATE', 'Task', 'NEW', { program: 'GOVERNANCE', title: 'x', execution: { phase: 'PHASE_B_RUNNER' } }), 'INVALID_SCHEMA');
  expectError(assert, h.run(M, 'TASK_CREATE', 'Task', 'NEW', { program: 'GOVERNANCE', title: 'x', requirements: { runnerType: 'WSL' } }), 'INVALID_SCHEMA');
  expectError(assert, h.run(M, 'TASK_CREATE', 'Task', 'NEW', { program: 'GOVERNANCE', title: 'x', execution: { phase: 'PHASE_C' } }), 'INVALID_SCHEMA');
});

test('runner offline: Phase A is scheduled, Phase B waits in WAITING_RUNNER without a slot and returns when a runner is online', () => {
  const h = harness();
  for (let i = 1; i <= 3; i += 1) h.agent(i);
  const a = h.task({ title: 'remote', scope: { paths: ['apps/a/'] } });
  const b = h.task({ title: 'runner', scope: { paths: ['apps/b/'] }, execution: { phase: 'PHASE_B_RUNNER' }, requirements: { runnerType: 'WSL' } });
  const snap = () => { const s = snapshot(h.cp.store); return { tasks: s.Task, agents: s.AgentState, reservations: s.Reservation }; };
  let p = plan({ ...snap(), runners: { WINDOWS: 0, WSL: 0 } }, h.cp.policy, h.iso());
  assert.deepEqual(p.assignments.map((x) => x.taskId), [a]);
  const d = p.deferred.find((x) => x.taskId === b);
  assert.equal(d.waitingRunner, true);
  assert.match(d.reasons.join(), /WAITING_RUNNER: no online WSL runner/);
  assert.deepEqual(p.runner.actions, [{ taskId: b, command: 'TASK_WAIT_RUNNER', reason: 'runner-required task parked without holding a worker slot' }]);
  // Unknown availability fails closed.
  p = plan(snap(), h.cp.policy, h.iso());
  assert.match(p.deferred.find((x) => x.taskId === b).reasons.join(), /availability unknown/);
  // Park it: WAITING_RUNNER is not BLOCKED and holds no slot.
  expectError(assert, h.run(M, 'TASK_WAIT_RUNNER', 'Task', a), 'POLICY_DENIED');
  h.ok(M, 'TASK_WAIT_RUNNER', 'Task', b);
  const status = statusReport(h.cp, h.iso(), { runners: { WINDOWS: 0, WSL: 0 } });
  assert.match(status, new RegExp(`WAITING_RUNNER: ${b}`));
  assert.match(status, /BLOCKERS: none/);
  assert.match(status, /RUNNERS: WINDOWS 0 online, WSL 0 online/);
  // A Windows runner does not serve a WSL task; a WSL runner does.
  assert.deepEqual(plan({ ...snap(), runners: { WINDOWS: 2, WSL: 0 } }, h.cp.policy, h.iso()).runner.actions, []);
  p = plan({ ...snap(), runners: { WINDOWS: 0, WSL: 1 } }, h.cp.policy, h.iso());
  assert.deepEqual(p.runner.actions.map((x) => [x.taskId, x.command]), [[b, 'TASK_RUNNER_AVAILABLE']]);
  h.ok(M, 'TASK_RUNNER_AVAILABLE', 'Task', b);
  p = plan({ ...snap(), runners: { WINDOWS: 0, WSL: 1 } }, h.cp.policy, h.iso());
  assert.ok(p.assignments.some((x) => x.taskId === b));
  assert.deepEqual(verifyIntegrity(h.cp.store, h.cp.policy), []);
});

test('runner-required work in progress is parked only with a handoff and frees the worker slot', () => {
  const h = harness();
  const id = h.working(1, { execution: { phase: 'PHASE_B_RUNNER' }, requirements: { runnerType: 'WINDOWS' } });
  expectError(assert, h.run(M, 'TASK_WAIT_RUNNER', 'Task', id), 'POLICY_DENIED');
  const hnd = h.ok(W(1), 'HANDOFF_PUBLISH', 'Handoff', 'NEW', { taskId: id, nextAction: 'run the Windows probe', files: [], tests: [], evidence: [], decisions: [], blockers: [] }).objectId;
  h.ok(M, 'TASK_WAIT_RUNNER', 'Task', id, { handoffId: hnd });
  const t = h.get('Task', id);
  assert.equal(t.state, 'WAITING_RUNNER');
  assert.equal(t.owner, null);
  assert.equal(t.execution.activeLeaseId, null);
  assert.equal(h.get('AgentState', 'AGENT-01').state, 'AVAILABLE');
  assert.deepEqual(verifyIntegrity(h.cp.store, h.cp.policy), []);
});

test('model B: merge with self-hosted WAITING_RUNNER; the Slice stays VERIFYING until runner PASS, then COMPLETE', () => {
  const h = harness();
  const { sl, a, b } = mixedSlice(h);
  const { mq, cls } = mergeWithDeferredChecks(h, sl.id);
  assert.equal(cls.data?.lane ?? h.get('MergeQueueItem', mq).lane, 'MANAGER');
  assert.ok(h.get('MergeQueueItem', mq).laneReasons.some((r) => r.startsWith('ALLOWED_BY_DEC-0015')));
  assert.equal(h.get('MergeQueueItem', mq).checks.runnerChecks, 'WAITING_RUNNER');
  const slice = h.get('Slice', sl.id);
  assert.equal(slice.state, 'VERIFYING');
  assert.deepEqual(slice.runnerVerification, { status: 'WAITING_RUNNER', checks: [...DEFERRED].sort(), mainSha: null, evidenceId: null, regressionTaskIds: [] });
  meetAll(h, sl.id);
  const r = expectError(assert, complete(h, sl.id), 'EVIDENCE_INSUFFICIENT');
  assert.equal(r.error.details.gate, 'MAIN_REVERIFIED');
  assert.match(r.error.message, /WAITING_RUNNER is not PASS/);
  assert.match(statusReport(h.cp, h.iso()), /P5-M01\(VERIFYING, self-hosted WAITING_RUNNER\)/);
  // Partial coverage is not a PASS.
  const partial = runnerEvidence(h, { sliceId: sl.id }, 'PASS', SHA('e'), [DEFERRED[0]]);
  expectError(assert, h.run(M, 'SLICE_RUNNER_RESULT', 'Slice', sl.id, { evidenceId: partial }), 'EVIDENCE_INSUFFICIENT');
  const pass = runnerEvidence(h, { sliceId: sl.id }, 'PASS', SHA('e'));
  h.ok(M, 'SLICE_RUNNER_RESULT', 'Slice', sl.id, { evidenceId: pass });
  assert.equal(h.get('Slice', sl.id).runnerVerification.status, 'PASS');
  h.ok(M, 'SLICE_COMPLETE', 'Slice', sl.id, { milestoneRegister: { path: REGISTER, commitSha: SHA('d') } });
  assert.equal(h.get('Slice', sl.id).state, 'COMPLETED');
  for (const t of [a, b]) assert.equal(h.get('Task', t).state, 'COMPLETED');
  assert.deepEqual(verifyIntegrity(h.cp.store, h.cp.policy), []);
});

test('runner FAIL moves the Slice to REGRESSION with a linked regression task; it completes only after the fix and a new PASS', () => {
  const h = harness();
  const { sl } = mixedSlice(h);
  mergeWithDeferredChecks(h, sl.id);
  meetAll(h, sl.id);
  const fail = runnerEvidence(h, { sliceId: sl.id }, 'FAIL', SHA('e'));
  expectError(assert, h.run(M, 'SLICE_RUNNER_RESULT', 'Slice', sl.id, { evidenceId: fail }), 'INVALID_SCHEMA');
  const fixSlice = h.slice('P5', 2, { key: 'P5-M02' });
  const fix = h.task({ program: 'P5', slice: fixSlice.key, title: 'fix the Windows portability regression', scope: { paths: ['apps/a/'] } });
  h.ok(M, 'SLICE_RUNNER_RESULT', 'Slice', sl.id, { evidenceId: fail, regressionTaskId: fix });
  let s = h.get('Slice', sl.id);
  assert.equal(s.state, 'REGRESSION');
  assert.deepEqual(s.runnerVerification.regressionTaskIds, [fix]);
  expectError(assert, complete(h, sl.id), 'INVALID_STATE_TRANSITION');
  expectError(assert, h.run(M, 'SLICE_REGRESSION_RESOLVED', 'Slice', sl.id), 'DEPENDENCY_BLOCKED');
  // Simulate the fix slice being delivered: the regression task reaches COMPLETED through its own slice.
  h.ok(M, 'TASK_ASSIGN', 'Task', fix, { agentId: 'AGENT-01' });
  for (const c of ['TASK_ACK', 'TASK_PREPARE', 'TASK_START']) h.ok(W(1), c, 'Task', fix);
  h.ok(W(1), 'TASK_READY_FOR_REVIEW', 'Task', fix, { headSha: SHA('f') });
  const mq2 = h.readySliceDelivery(fixSlice.id, SHA('f'), 31);
  h.mergeSliceDelivery(fixSlice.id, mq2, SHA('f'), SHA('9'));
  meetAll(h, fixSlice.id);
  h.ok(M, 'SLICE_COMPLETE', 'Slice', fixSlice.id, { milestoneRegister: { path: REGISTER, commitSha: SHA('9') } });
  h.ok(M, 'SLICE_REGRESSION_RESOLVED', 'Slice', sl.id);
  s = h.get('Slice', sl.id);
  assert.equal(s.state, 'VERIFYING');
  assert.equal(s.runnerVerification.status, 'WAITING_RUNNER');
  expectError(assert, complete(h, sl.id), 'EVIDENCE_INSUFFICIENT');
  const pass = runnerEvidence(h, { sliceId: sl.id }, 'PASS', SHA('9'));
  h.ok(M, 'SLICE_RUNNER_RESULT', 'Slice', sl.id, { evidenceId: pass });
  h.ok(M, 'SLICE_COMPLETE', 'Slice', sl.id, { milestoneRegister: { path: REGISTER, commitSha: SHA('d') } });
  assert.equal(h.get('Slice', sl.id).state, 'COMPLETED');
  assert.deepEqual(verifyIntegrity(h.cp.store, h.cp.policy), []);
});

test('the regression fix never joins the merged Slice (one delivery PR per Slice)', () => {
  const h = harness();
  const { sl } = mixedSlice(h);
  mergeWithDeferredChecks(h, sl.id);
  const fail = runnerEvidence(h, { sliceId: sl.id }, 'FAIL', SHA('e'));
  const own = h.get('Slice', sl.id);
  const inSlice = h.cp.store.list('Task').find((t) => t.slice === own.key).objectId;
  expectError(assert, h.run(M, 'SLICE_RUNNER_RESULT', 'Slice', sl.id, { evidenceId: fail, regressionTaskId: inSlice }), 'POLICY_DENIED');
});

test('manager-executed governance work with deferred runner checks waits in WAITING_RUNNER, never completes on WAITING_RUNNER', () => {
  const h = harness();
  const t = h.task({ title: 'DEC-0015 governance' });
  const merge = SHA('7');
  h.evidence(M, t, 'COMMIT', { subjectType: 'COMMIT', subjectId: merge });
  const ci = h.ok(SYS('SYSTEM-CI'), 'EVIDENCE_PROPOSE', 'Evidence', 'NEW', { taskId: t, type: 'CI', trustLevel: 'CI_VERIFIED', subject: { subjectType: 'WORKFLOW_RUN', subjectId: '123', subjectDigest: SHA('6') }, result: { status: 'PASS', summary: 'hosted 7/7 PASS; self-hosted WAITING_RUNNER', deferredRunnerChecks: DEFERRED } }).objectId;
  h.ok(M, 'EVIDENCE_PUBLISH', 'Evidence', ci);
  h.ok(M, 'EVIDENCE_VERIFY', 'Evidence', ci, { trustLevel: 'CI_VERIFIED' });
  h.evidence(M, t, 'MAIN_VERIFICATION', { subjectType: 'MAIN', subjectId: merge }, { trust: 'MAIN_VERIFIED', verifyTrust: 'MAIN_VERIFIED' });
  let r = expectError(assert, h.run(M, 'TASK_COMPLETE_MANAGER_EXECUTED', 'Task', t, { mergeSha: merge }), 'EVIDENCE_INSUFFICIENT');
  assert.match(r.error.message, /TASK_WAIT_RUNNER/);
  h.ok(M, 'TASK_WAIT_RUNNER', 'Task', t, { deferredRunnerChecks: DEFERRED, mergeSha: merge });
  assert.equal(h.get('Task', t).state, 'WAITING_RUNNER');
  expectError(assert, h.run(M, 'TASK_RUNNER_AVAILABLE', 'Task', t), 'POLICY_DENIED');
  r = expectError(assert, h.run(M, 'TASK_COMPLETE_MANAGER_EXECUTED', 'Task', t, { mergeSha: merge }), 'EVIDENCE_INSUFFICIENT');
  assert.match(r.error.message, /WAITING_RUNNER is not PASS/);
  const pass = runnerEvidence(h, { taskId: t }, 'PASS', SHA('8'));
  h.ok(M, 'TASK_RUNNER_RESULT', 'Task', t, { evidenceId: pass });
  h.ok(M, 'TASK_COMPLETE_MANAGER_EXECUTED', 'Task', t, { mergeSha: merge });
  assert.equal(h.get('Task', t).state, 'COMPLETED');
  assert.deepEqual(verifyIntegrity(h.cp.store, h.cp.policy), []);
});

test('RUNNER_VERIFICATION evidence is anchored to main', () => {
  const h = harness();
  const t = h.task();
  expectError(assert, h.run(SYS('SYSTEM-CI'), 'EVIDENCE_PROPOSE', 'Evidence', 'NEW', { taskId: t, type: 'RUNNER_VERIFICATION', trustLevel: 'CI_VERIFIED', subject: { subjectType: 'COMMIT', subjectId: SHA('1') }, result: { status: 'PASS', summary: 'x', checks: ['a'] } }), 'EVIDENCE_INSUFFICIENT');
});

test('check classifier: hosted green + self-hosted queued with no online runner = ALLOWED_BY_DEC-0015 (not PASS)', () => {
  const hosted = (name, conclusion = 'success', status = 'completed') => ({ name, status, conclusion, labels: ['ubuntu-latest'] });
  const self = (name, status = 'queued', conclusion = null, labels = ['self-hosted', 'windows', 'x64']) => ({ name, status, conclusion, labels });
  const jobs = [hosted('gate'), hosted('architecture'), self('Windows worker portability probe'), self('validation', 'queued', null, ['self-hosted', 'linux', 'x64'])];
  let c = classifyChecks(jobs, { onlineRunners: [] });
  assert.equal(c.verdict, 'ALLOWED_BY_DEC-0015');
  assert.equal(c.mergeAllowed, true);
  assert.deepEqual(c.deferredRunnerChecks, ['Windows worker portability probe', 'validation']);
  assert.equal(formatChecks(c), 'GitHub-hosted: PASS 2/2 | Self-hosted: WAITING_RUNNER 2 (Windows worker portability probe, validation) | Merge: ALLOWED_BY_DEC-0015');
  // An online runner that matches the labels may still pick it up: wait.
  c = classifyChecks(jobs, { onlineRunners: [{ labels: [{ name: 'self-hosted' }, { name: 'Windows' }, { name: 'X64' }] }] });
  assert.equal(c.verdict, 'PENDING');
  assert.deepEqual(c.selfHosted.waitingRunner, ['validation']);
  // Unknown availability: never assume the runner is gone.
  assert.equal(classifyChecks(jobs).verdict, 'PENDING');
  // Hosted pending, hosted failure, self-hosted failure, nothing ran, only self-hosted.
  assert.equal(classifyChecks([hosted('gate', null, 'in_progress'), self('v')], { onlineRunners: [] }).verdict, 'PENDING');
  assert.equal(classifyChecks([hosted('gate', 'failure'), self('v')], { onlineRunners: [] }).verdict, 'BLOCKED');
  assert.equal(classifyChecks([hosted('gate'), self('v', 'completed', 'failure')], { onlineRunners: [] }).verdict, 'BLOCKED');
  assert.equal(classifyChecks([], { onlineRunners: [] }).verdict, 'BLOCKED');
  assert.equal(classifyChecks([self('v')], { onlineRunners: [] }).verdict, 'BLOCKED');
  // Everything green, skipped jobs are not failures.
  c = classifyChecks([hosted('gate'), hosted('fork-only', 'skipped'), self('v', 'completed', 'success')], { onlineRunners: [] });
  assert.equal(c.verdict, 'ALL_GREEN');
  assert.deepEqual(c.deferredRunnerChecks, []);
});

test('--runners parsing is strict', () => {
  assert.deepEqual(parseRunners('WINDOWS=0,WSL=2'), { WINDOWS: 0, WSL: 2 });
  assert.equal(parseRunners(undefined), undefined);
  assert.throws(() => parseRunners('MAC=1'));
  assert.throws(() => parseRunners('WSL=x'));
});
