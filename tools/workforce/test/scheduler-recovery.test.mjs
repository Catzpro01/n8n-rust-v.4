import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { plan, effectivePriority, classifyPair, heavyRunnerClass } from '../src/scheduler.mjs';
import { reconcile, applySafeRecovery, verifyEventLog, verifyIntegrity, snapshot } from '../src/recovery.mjs';
import { renderMemory, statusReport } from '../src/render.mjs';
import { loadPolicy } from '../src/core.mjs';
import { harness, expectError, M, W, SHA } from './helpers.mjs';

const { policy } = loadPolicy();
const planOf = (h) => { const s = snapshot(h.cp.store); return plan({ tasks: s.Task, agents: s.AgentState, reservations: s.Reservation }, policy, h.iso()); };

test('scheduler: priority order, capability matching, dependency and scope deferrals with reasons', () => {
  const h = harness();
  h.agent(1, { capabilities: ['node'] });
  h.agent(2, { capabilities: ['node', 'rust'] });
  const low = h.task({ title: 'low', priority: 'LOW', scope: { paths: ['a/'] } });
  const crit = h.task({ title: 'crit', priority: 'CRITICAL', scope: { paths: ['b/'] }, requirements: { capabilities: ['rust'] } });
  const dep = h.task({ title: 'dep', dependencies: [{ taskId: low }], scope: { paths: ['c/'] } });
  const noscope = h.task({ title: 'no scope' });
  const p = planOf(h);
  assert.deepEqual(p.assignments.map((a) => [a.taskId, a.agentId]), [[crit, 'AGENT-02'], [low, 'AGENT-01']]);
  const why = Object.fromEntries(p.deferred.map((d) => [d.taskId, d.reasons.join('|')]));
  assert.match(why[dep], /dependencies/);
  assert.match(why[noscope], /undeclared scope/);
});

test('scheduler: SERIALIZED on conflicting scopes, HOLD for held work, SAFE_PARALLEL across programs', () => {
  const h = harness();
  for (const n of [1, 2, 3]) h.agent(n);
  for (const prog of ['P7', 'P8', 'P11', 'P10']) h.slice(prog, 1);
  const a = h.task({ program: 'P7', slice: 'P7-S01', scope: { paths: ['apps/x/'], securitySurfaces: ['auth'] } });
  const b = h.task({ program: 'P8', slice: 'P8-S01', scope: { paths: ['apps/y/'], securitySurfaces: ['auth'] } });
  const c = h.task({ program: 'P11', slice: 'P11-S01', scope: { paths: ['tools/z/'] } });
  const d = h.task({ program: 'P10', slice: 'P10-S01', scope: { paths: ['q/'] }, execution: { hold: true } });
  const p = planOf(h);
  assert.deepEqual(p.assignments.map((x) => x.taskId).sort(), [a, c].sort());
  assert.match(p.deferred.find((x) => x.taskId === b).reasons.join(), /serialized behind planned/);
  assert.match(p.deferred.find((x) => x.taskId === d).reasons.join(), /HOLD/);
  const pair = p.concurrency.pairs.find((x) => [x.a, x.b].sort().join() === [a, c].sort().join());
  assert.equal(pair.class, 'SAFE_PARALLEL');
  const ctx = { policy, tasksById: new Map(snapshot(h.cp.store).Task.map((t) => [t.objectId, t])) };
  assert.equal(classifyPair(h.get('Task', a), h.get('Task', d), ctx).class, 'HOLD');
  assert.equal(classifyPair(h.get('Task', a), h.get('Task', b), ctx).class, 'SERIALIZED');
});

test('scheduler: backpressure caps active work; aging is bounded; starvation and anti-thrash alerts fire', () => {
  const h = harness();
  const t = h.task({ scope: { paths: ['a/'] } });
  const task = h.get('Task', t);
  assert.equal(effectivePriority(task, policy, h.iso()).aging, 0);
  h.advance(24 * 3600 * 10);
  assert.equal(effectivePriority(task, policy, h.iso()).aging, policy.scheduler.maxAgingBonus);
  const p = planOf(h);
  assert.ok(p.alerts.some((a) => a.kind === 'STARVATION' && a.taskId === t), 'no agent + old task = starvation alert');
  const h2 = harness();
  for (let n = 1; n <= 10; n += 1) h2.working(n, { scope: { paths: [`w${n}/`] } });
  h2.task({ scope: { paths: ['extra/'] } });
  const p2 = planOf(h2);
  assert.equal(p2.assignments.length, 0);
  assert.ok(p2.deferred[0].reasons.some((r) => r.includes('backpressure')));
  assert.ok(p2.alerts.some((a) => a.kind === 'BACKPRESSURE'));
  const id = h2.cp.store.list('Task')[0].objectId;
  for (let i = 0; i < 3; i += 1) h2.ok(W(1), 'TASK_PROGRESS', 'Task', id, { ciRetry: true });
  assert.ok(planOf(h2).alerts.some((a) => a.kind === 'ANTI_THRASH_FREEZE' && a.taskId === id && a.command === 'TASK_FREEZE'));
});

test('recovery: elapsed leases are proposed as SAFE and applied as SYSTEM-RECOVERY; LOST is never automatic', () => {
  const h = harness();
  const id = h.working(1);
  h.ok({ type: 'WORKER', id: 'AGENT-01' }, 'AGENT_HEARTBEAT', 'AgentState', 'AGENT-01', {});
  h.advance(3700);
  const rep = reconcile(h.cp.store, policy, h.iso());
  assert.ok(rep.findings.some((f) => f.kind === 'LEASE_ELAPSED'));
  assert.ok(rep.findings.some((f) => f.kind === 'LOST_CANDIDATE'));
  assert.ok(rep.proposals.some((p) => p.commandType === 'AGENT_MARK_LOST' && p.safe === false));
  const applied = applySafeRecovery(h.cp, h.iso());
  assert.equal(applied.applied, 1);
  assert.equal(h.get('Lease', h.get('Task', id).execution.activeLeaseId).state, 'EXPIRED');
  assert.equal(h.get('AgentState', 'AGENT-01').state, 'WORKING', 'recovery never marks LOST on its own');
  const again = applySafeRecovery(h.cp, h.iso());
  assert.equal(again.applied, 0, 'recovery is idempotent');
});

test('LOST agent: assignment leases revoked, reservations preserved; worker loses authority (LEASE_REVOKED); transfer recovers', () => {
  const h = harness();
  const id = h.working(1);
  const r = h.ok(W(1), 'RESERVATION_REQUEST', 'Reservation', 'NEW', { taskId: id, mode: 'EXCLUSIVE', scope: { paths: ['k/'] } }).objectId;
  h.ok(M, 'RESERVATION_CHECK', 'Reservation', r);
  h.ok(M, 'RESERVATION_ACTIVATE', 'Reservation', r);
  h.ok(M, 'AGENT_MARK_LOST', 'AgentState', 'AGENT-01', { reasonCode: 'NO_HEARTBEAT' });
  assert.equal(h.get('Task', id).execution.activeLeaseId, null);
  assert.equal(h.get('Reservation', r).state, 'ACTIVE');
  expectError(assert, h.run(W(1), 'TASK_PROGRESS', 'Task', id, { nextAction: 'zombie' }), 'LEASE_REVOKED');
  const rep = reconcile(h.cp.store, policy, h.iso());
  assert.ok(rep.findings.some((f) => f.kind === 'TASK_WITHOUT_AUTHORITY'));
  h.agent(2);
  const hnd = h.ok(M, 'HANDOFF_PUBLISH', 'Handoff', 'NEW', { taskId: id, nextAction: 'resume from last commit', files: [], tests: [], evidence: [], decisions: [], blockers: [], managerDecisionRequired: false }).objectId;
  h.ok(M, 'TASK_TRANSFER', 'Task', id, { toAgentId: 'AGENT-02', handoffId: hnd, reasonCode: 'OWNER_LOST' });
  const t = h.get('Task', id);
  assert.equal(t.history.recoveryCount, 1);
  assert.equal(h.get('Reservation', t.execution.reservationIds[0]).ownerAgentId, 'AGENT-02');
  assert.deepEqual(verifyIntegrity(h.cp.store, policy), []);
});

test('replay verification detects snapshot tampering and illegal chains', () => {
  const h = harness();
  const id = h.working(1);
  assert.deepEqual(verifyEventLog(h.cp.store, policy).findings, []);
  const path = h.cp.store.objectPath('Task', id);
  const obj = JSON.parse(readFileSync(path, 'utf8'));
  obj.state = 'COMPLETED';
  writeFileSync(path, JSON.stringify(obj));
  const kinds = verifyEventLog(h.cp.store, policy).findings.map((f) => f.kind);
  assert.ok(kinds.includes('SNAPSHOT_STATE_MISMATCH'));
});

test('memory views and MANAGER STATUS render every required section', () => {
  const h = harness();
  const sl = h.slice('P7', 1);
  const id = h.working(1, { program: 'P7', slice: sl.key, scope: { paths: ['a/'] } });
  h.ok(W(1), 'TASK_READY_FOR_REVIEW', 'Task', id, { headSha: SHA('c') });
  const mq = h.readySliceDelivery(sl.id);
  h.mergeSliceDelivery(sl.id, mq);
  h.ok(M, 'SLICE_UPDATE_ACCEPTANCE', 'Slice', sl.id, { criteria: [{ id: 'AC-1', met: true, evidenceRef: 'EVD-0001' }] });
  h.ok(M, 'SLICE_COMPLETE', 'Slice', sl.id, { milestoneRegister: { path: 'docs/n8n-lego/milestones.json', commitSha: SHA('d') } });
  h.ok(M, 'JOURNAL_APPEND', 'JournalEntry', 'NEW', { kind: 'LESSON', summary: 'exact-head pins prevent stale merges' });
  const files = renderMemory(h.cp, h.iso(), { main: SHA('b') });
  for (const f of ['CURRENT.md', 'AGENTS.md', 'TASKS.md', 'MERGE-QUEUE.md', 'BLOCKERS.md', 'BOTTLENECKS.md', 'HANDOFFS.md', 'JOURNAL.md', 'LESSONS.md', 'DECISIONS.md', 'RESERVATIONS.md', 'RECOVERY.md', 'SLICES.md']) assert.ok(files[f], f);
  assert.match(files['SLICES.md'], /P7-S01 \| COMPLETED/);
  assert.match(files['CURRENT.md'], /SLICES: COMPLETED 1/);
  assert.match(files['LESSONS.md'], /exact-head pins/);
  const status = statusReport(h.cp, h.iso(), { main: SHA('b') });
  for (const k of ['MAIN', 'ARENA-MANAGER', 'WORKERS', 'TASKS', 'PROGRAMS', 'RESERVATIONS', 'LEASES', 'MERGE QUEUE', 'DECISIONS', 'RECOVERY', 'BLOCKERS', 'COMPLETED', 'NEXT']) assert.match(status, new RegExp(`^${k}: `, 'm'), k);
  assert.match(status, new RegExp(`COMPLETED: ${id}`));
  // deterministic
  assert.deepEqual(renderMemory(h.cp, h.iso(), { main: SHA('b') }), files);
});

test('MANAGER STATUS reports held and decision-pending work that has not started', () => {
  const h = harness();
  const held = h.task({ execution: { hold: true }, nextAction: 'waiting for credential' });
  const pending = h.task({ execution: { decisionPending: true } });
  const status = statusReport(h.cp, h.iso(), {});
  assert.match(status, new RegExp(`BLOCKERS: .*${held}\\(ON_HOLD\\)`));
  assert.match(status, new RegExp(`BLOCKERS: .*${pending}\\(DECISION_PENDING\\)`));
  assert.match(renderMemory(h.cp, h.iso(), {})['BLOCKERS.md'], /waiting for credential/);
});

test('DEC-0010 open slots: any idle slot takes any task; runner pool is shared; heavy limits count the task runner class', () => {
  assert.equal(policy.runnerPool.model, 'SHARED');
  assert.equal(policy.runnerPool.defaultRunnerClass, 'ANY');
  const h = harness();
  for (const n of [1, 2, 3, 4]) h.agent(n);
  for (const n of [1, 2, 3, 4]) assert.equal(h.get('AgentState', `AGENT-0${n}`).capacity.runnerClass, 'ANY');
  const win = h.task({ title: 'win', scope: { paths: ['w/'] }, requirements: { runnerClasses: ['WINDOWS'] } });
  const wsl = h.task({ title: 'wsl', scope: { paths: ['l/'] }, requirements: { runnerClasses: ['WSL'] } });
  const any = h.task({ title: 'any', scope: { paths: ['a/'] } });
  const p = planOf(h);
  assert.deepEqual(p.assignments.map((a) => a.taskId).sort(), [win, wsl, any].sort(), 'no task waits for a specific slot');
  assert.equal(new Set(p.assignments.map((a) => a.agentId)).size, 3);
  assert.equal(heavyRunnerClass({ requirements: { runnerClasses: ['WINDOWS'] } }), 'WINDOWS');
  assert.equal(heavyRunnerClass({ requirements: { runnerClasses: ['WINDOWS', 'WSL'] } }), 'ANY');
  assert.equal(heavyRunnerClass({}), 'ANY');
  // Heavy WINDOWS builds are capped by the pool limit even though every slot is ANY.
  const h2 = harness();
  for (let n = 1; n <= 6; n += 1) h2.agent(n);
  const heavy = [];
  for (let i = 0; i < 5; i += 1) heavy.push(h2.task({ title: `hw${i}`, scope: { paths: [`hw${i}/`] }, requirements: { capacityClass: 'HEAVY', runnerClasses: ['WINDOWS'] } }));
  const p2 = planOf(h2);
  assert.equal(p2.assignments.length, policy.backpressure.maxHeavyBuildsPerRunnerClass.WINDOWS);
  assert.ok(p2.deferred.every((d) => d.reasons.join().includes('no eligible agent')));
});

test('AGENT_RECONFIGURE: Manager reconfigures an idle slot; busy slots and worker callers are refused', () => {
  const h = harness();
  h.agent(1, { capacity: { runnerClass: 'WINDOWS' } });
  h.ok(M, 'AGENT_RECONFIGURE', 'AgentState', 'AGENT-01', { capacity: { runnerClass: 'ANY' }, capabilities: ['node', 'git', 'node'] });
  const a = h.get('AgentState', 'AGENT-01');
  assert.equal(a.capacity.runnerClass, 'ANY');
  assert.deepEqual(a.capabilities, ['git', 'node']);
  expectError(assert, h.run(M, 'AGENT_RECONFIGURE', 'AgentState', 'AGENT-01', { capacity: { activeTaskCount: 5 } }), 'INVALID_SCHEMA');
  expectError(assert, h.run(W(1), 'AGENT_RECONFIGURE', 'AgentState', 'AGENT-01', { capacity: { runnerClass: 'WSL' } }), 'FORBIDDEN');
  h.working(1, { scope: { paths: ['x/'] } });
  expectError(assert, h.run(M, 'AGENT_RECONFIGURE', 'AgentState', 'AGENT-01', { capacity: { runnerClass: 'WSL' } }), 'POLICY_DENIED');
});
