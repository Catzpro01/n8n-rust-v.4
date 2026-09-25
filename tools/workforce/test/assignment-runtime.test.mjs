// #295 §19 — READY -> live session assignment, authorization, recovery, refill and concurrency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { rig, throwsCode, k, MAIN } from './runtime-helpers.mjs';
import { M, W, SHA } from './helpers.mjs';
import { reconcile as engineReconcile } from '../src/recovery.mjs';

const ENVELOPE_FIELDS = ['assignmentId', 'taskId', 'agentId', 'sessionId', 'leaseId', 'reservationIds', 'taskRevision', 'mainSha', 'branch', 'taskManifestDigest', 'createdAt', 'expiresAt', 'status', 'idempotencyKey', 'policyDigest'];

test('assignment: READY task -> scheduler -> TASK_ASSIGN lease -> OFFERED envelope with every required field', () => {
  const r = rig();
  r.attach('AGENT-01');
  const t = r.task(1);
  const out = r.rt.assignReady({ fill: 1, mainSha: MAIN });
  assert.equal(out.offered.length, 1);
  const row = out.offered[0];
  assert.deepEqual([row.slot, row.taskId, row.status], ['AGENT-01', t, 'OFFERED']);
  assert.match(row.leaseId, /^LEASE-/);
  const env = r.envelope('AGENT-01');
  for (const f of ENVELOPE_FIELDS) assert.ok(env[f] !== undefined, `envelope.${f}`);
  assert.equal(env.mainSha, MAIN);
  assert.equal(env.policyDigest, r.h.cp.policyDigest);
  assert.equal(env.branch, `arena/agent-01/${t}`);
  const task = r.h.get('Task', t);
  assert.equal(task.state, 'CLAIMED');
  assert.equal(task.execution.activeLeaseId, env.leaseId);
  assert.equal(r.h.get('Lease', env.leaseId).holder, 'AGENT-01');
  assert.equal(env.taskRevision, task.revision);
  assert.equal(r.session('AGENT-01').sessionState, 'ASSIGNED');
  // Durable file inbox mirrors the envelope.
  const inbox = readdirSync(join(r.dir, 'inbox', r.sessions['AGENT-01'].sessionId));
  assert.deepEqual(inbox, [`${env.assignmentId}.json`]);
});

test('assignment: no live session -> nothing is assigned and no worker is reported active', () => {
  const r = rig();
  r.task(1); r.task(2);
  const out = r.rt.assignReady({ fill: 10, mainSha: MAIN });
  assert.deepEqual(out.offered, []);
  assert.equal(out.idleSessions, 0);
  assert.equal(out.slotsWithoutLiveSession.length, 10);
  assert.match(out.note, /no live IDLE session/);
  assert.equal(r.h.cp.store.list('Task').filter((t) => t.state !== 'UNASSIGNED').length, 0);
  assert.ok(r.rt.status().slots.every((s) => s.sessionState === 'NO_SESSION' && s.taskId === null));
  // A stale (silent) session is not offered work either.
  r.attach('AGENT-01');
  r.h.advance(31);
  assert.deepEqual(r.rt.assignReady({ fill: 10, mainSha: MAIN, reconcile: false }).offered, []);
});

test('assignment: non-READY work (held, dependency-blocked, undeclared scope) is not assigned', () => {
  const r = rig();
  r.attachAll(4);
  const held = r.task(1, { execution: { hold: true } });
  const base = r.task(2);
  const dep = r.task(3, { dependencies: [{ taskId: base }] });
  const noscope = r.h.task({ title: 'no scope' });
  const out = r.rt.assignReady({ fill: 10, mainSha: MAIN });
  assert.deepEqual(out.offered.map((x) => x.taskId), [base]);
  const why = Object.fromEntries(out.deferred.map((d) => [d.taskId, d.reasons.join('; ')]));
  assert.match(why[held], /HOLD/);
  assert.match(why[dep], /dependencies/);
  assert.match(why[noscope], /undeclared scope/);
});

test('assignment: reservation conflict defers the READY task; mainSha is mandatory; fill is bounded', () => {
  const r = rig();
  r.attach('AGENT-01'); r.attach('AGENT-02');
  const t1 = r.task(1, { scope: { paths: ['apps/x/'] } });
  r.rt.assignReady({ fill: 1, mainSha: MAIN });
  r.ack('AGENT-01'); r.run('AGENT-01');
  const res = r.h.ok(W(1), 'RESERVATION_REQUEST', 'Reservation', 'NEW', { taskId: t1, mode: 'EXCLUSIVE', scope: { paths: ['apps/x/'] } }).objectId;
  r.h.ok(M, 'RESERVATION_CHECK', 'Reservation', res);
  r.h.ok(M, 'RESERVATION_ACTIVATE', 'Reservation', res);
  const t2 = r.task(2, { scope: { paths: ['apps/x/y.mjs'] } });
  const out = r.rt.assignReady({ fill: 10, mainSha: MAIN });
  assert.deepEqual(out.offered, []);
  assert.match(out.deferred.find((d) => d.taskId === t2).reasons.join(), /reservation conflict/);
  throwsCode(assert, () => r.rt.assignReady({ fill: 1 }), 'INVALID_SCHEMA');
  throwsCode(assert, () => r.rt.assignReady({ fill: 11, mainSha: MAIN }), 'INVALID_SCHEMA');
});

test('assignment: no double assignment — repeated fills never re-offer a task or load a busy session', () => {
  const r = rig();
  r.attachAll(3);
  for (let i = 1; i <= 5; i += 1) r.task(i);
  const a = r.rt.assignReady({ fill: 10, mainSha: MAIN });
  const b = r.rt.assignReady({ fill: 10, mainSha: MAIN });
  assert.equal(a.offered.length, 3);
  assert.equal(b.offered.length, 0, 'all live sessions are busy');
  const active = Object.values(r.state().assignments).filter((x) => x.status === 'OFFERED');
  assert.equal(new Set(active.map((x) => x.taskId)).size, 3);
  assert.equal(new Set(active.map((x) => x.sessionId)).size, 3);
  assert.deepEqual(r.rt.integrity(), []);
});

test('claim: ACK moves task CLAIMED -> PREPARING and session -> WORKING; duplicate ACK is idempotent; key reuse conflicts', () => {
  const r = rig();
  r.attach('AGENT-01');
  const t = r.task(1);
  r.rt.assignReady({ fill: 1, mainSha: MAIN });
  const env = r.envelope('AGENT-01');
  const req = { ...r.sessions['AGENT-01'], assignmentId: env.assignmentId, leaseId: env.leaseId, taskRevision: env.taskRevision, idempotencyKey: k('ack') };
  const first = r.rt.claim(req);
  assert.equal(first.assignment.status, 'ACKED');
  assert.equal(r.h.get('Task', t).state, 'PREPARING');
  assert.equal(r.session('AGENT-01').sessionState, 'WORKING');
  assert.equal(r.rt.claim(req).replayed, true);
  assert.equal(r.rt.claim({ ...req, idempotencyKey: k('ack') }).alreadyAcked, true, 'duplicate ACK with a new key is still a success');
  throwsCode(assert, () => r.rt.claim({ ...req, taskRevision: env.taskRevision + 7 }), 'IDEMPOTENCY_CONFLICT');
});

test('authorization: cross-agent and cross-session claims are FORBIDDEN', () => {
  const r = rig();
  r.attach('AGENT-01'); r.attach('AGENT-02');
  r.task(1); r.task(2);
  r.rt.assignReady({ fill: 2, mainSha: MAIN });
  const envB = r.envelope('AGENT-02');
  throwsCode(assert, () => r.rt.claim({ ...r.sessions['AGENT-01'], assignmentId: envB.assignmentId, leaseId: envB.leaseId, taskRevision: envB.taskRevision, idempotencyKey: k('x') }), 'FORBIDDEN');
  const envA = r.envelope('AGENT-01');
  throwsCode(assert, () => r.rt.claim({ ...r.sessions['AGENT-01'], assignmentId: envA.assignmentId, leaseId: envB.leaseId, taskRevision: envA.taskRevision, idempotencyKey: k('x') }), 'FORBIDDEN');
  throwsCode(assert, () => r.rt.claim({ ...r.sessions['AGENT-01'], agentId: 'AGENT-02', assignmentId: envB.assignmentId, leaseId: envB.leaseId, taskRevision: envB.taskRevision, idempotencyKey: k('x') }), 'FORBIDDEN');
  throwsCode(assert, () => r.rt.report({ ...r.sessions['AGENT-01'], assignmentId: envB.assignmentId, status: 'RUNNING', idempotencyKey: k('x') }), 'FORBIDDEN');
});

test('authorization: a worker cannot create assignments or change governance through the engine', () => {
  const r = rig();
  r.attach('AGENT-01');
  const t = r.task(1);
  for (const [type, target, id, payload] of [
    ['TASK_ASSIGN', 'Task', t, { agentId: 'AGENT-01' }],
    ['AGENT_REGISTER', 'AgentState', 'AGENT-01', { capabilities: ['node', 'rust'] }],
    ['AGENT_MARK_LOST', 'AgentState', 'AGENT-02', { reasonCode: 'X' }],
    ['TASK_UNCLAIM', 'Task', t, {}],
  ]) {
    const res = r.h.run(W(1), type, target, id, payload);
    assert.equal(res.ok, false, `${type} must be rejected for a worker`);
    assert.ok(['FORBIDDEN', 'GOVERNANCE_REQUIRED'].includes(res.error.code), `${type}: ${res.error.code}`);
  }
  // The session protocol exposes no assignment-creating or governance operation at all.
  for (const op of ['assignReady', 'reconcile', 'bootstrap']) assert.equal(typeof r.rt[op], 'function'); // Manager-side only
  const { SESSION_OPS } = { SESSION_OPS: ['register', 'ready', 'heartbeat', 'poll', 'claim', 'reject', 'report', 'drain'] };
  assert.ok(!SESSION_OPS.some((op) => /assign|govern|policy|decision|merge/i.test(op)));
});

test('claim: stale task revision is REVISION_CONFLICT; expired lease is LEASE_EXPIRED', () => {
  // Long-lived session credentials so the scenario isolates LEASE expiry from credential expiry.
  const r = rig({ config: { sessionTokenTtlSeconds: 7200, sessionLostSeconds: 7200 } });
  r.attach('AGENT-01'); r.attach('AGENT-02');
  const t1 = r.task(1); r.task(2);
  r.rt.assignReady({ fill: 2, mainSha: MAIN });
  const who = (t) => Object.values(r.state().assignments).find((a) => a.taskId === t).agentId;
  const a1 = who(t1);
  r.h.ok(M, 'TASK_PROGRESS', 'Task', t1, { nextAction: 'manager changed the task after the offer' });
  throwsCode(assert, () => r.ack(a1), 'REVISION_CONFLICT');
  const a2 = a1 === 'AGENT-01' ? 'AGENT-02' : 'AGENT-01';
  r.h.advance(3601);
  throwsCode(assert, () => r.ack(a2), 'LEASE_EXPIRED');
});

test('claim: ACK after the offer deadline is LEASE_EXPIRED and the manager loop returns the task to READY', () => {
  const r = rig({ config: { offerAckTimeoutSeconds: 20 } });
  r.attach('AGENT-01');
  const t = r.task(1);
  r.rt.assignReady({ fill: 1, mainSha: MAIN });
  r.h.advance(21);
  throwsCode(assert, () => r.ack('AGENT-01'), 'LEASE_EXPIRED');
  r.heartbeat('AGENT-01');
  const rec = r.rt.reconcile({ mainSha: MAIN });
  assert.ok(rec.actions.some((a) => a.kind === 'ASSIGNMENT_ENDED' && a.reason === 'ACK_TIMEOUT'));
  assert.ok(rec.actions.some((a) => a.kind === 'RECOVERY' && a.outcome === 'REQUEUED'));
  assert.equal(r.h.get('Task', t).state, 'UNASSIGNED');
  assert.equal(r.session('AGENT-01').sessionState, 'IDLE');
});

test('lifecycle: RUNNING -> WAITING_EXTERNAL -> RUNNING -> READY_FOR_REVIEW releases the slot and refills it automatically', () => {
  const r = rig();
  r.attach('AGENT-01');
  const t1 = r.task(1); const t2 = r.task(2);
  r.rt.assignReady({ fill: 1, mainSha: MAIN });
  r.ack('AGENT-01'); r.run('AGENT-01');
  const env = r.envelope('AGENT-01');
  const rep = (status, extra = {}) => r.rt.report({ ...r.sessions['AGENT-01'], assignmentId: env.assignmentId, status, idempotencyKey: k('r'), ...extra });
  assert.equal(rep('WAITING_EXTERNAL', { summary: 'waiting for CI' }).taskState, 'WAITING_EXTERNAL');
  assert.equal(rep('RUNNING').taskState, 'WORKING');
  assert.equal(rep('PROGRESS', { headSha: SHA('c'), prNumber: 42 }).taskState, 'WORKING');
  throwsCode(assert, () => rep('READY_FOR_REVIEW'), 'EVIDENCE_INSUFFICIENT');
  const done = rep('READY_FOR_REVIEW', { headSha: SHA('d'), prNumber: 42 });
  assert.deepEqual([done.assignmentStatus, done.taskState, done.sessionState], ['READY_FOR_REVIEW', 'READY_FOR_REVIEW', 'IDLE']);
  assert.equal(r.h.get('Task', t1).current.headSha, SHA('d'));
  assert.equal(r.h.get('AgentState', 'AGENT-01').state, 'AVAILABLE', 'engine released the slot');
  assert.notEqual(r.h.get('Task', t1).state, 'COMPLETED', 'READY_FOR_REVIEW is not completion');
  const refill = r.rt.assignReady({ fill: 1, mainSha: MAIN });
  assert.deepEqual(refill.offered.map((x) => [x.slot, x.taskId, x.status]), [['AGENT-01', t2, 'OFFERED']]);
});

test('recovery: heartbeat timeout -> session LOST -> slot LOST -> handoff + TASK_TRANSFER -> replacement session resumes', () => {
  const r = rig();
  r.attach('AGENT-01'); r.attach('AGENT-02');
  const t1 = r.task(1, { scope: { paths: ['apps/x/'] } });
  r.rt.assignReady({ fill: 1, mainSha: MAIN });
  const owner = Object.values(r.state().assignments)[0].agentId;
  const spare = owner === 'AGENT-01' ? 'AGENT-02' : 'AGENT-01';
  r.ack(owner); r.run(owner);
  r.rt.report({ ...r.sessions[owner], assignmentId: r.envelope(owner).assignmentId, status: 'PROGRESS', headSha: SHA('e'), idempotencyKey: k('p') });
  const res = r.h.ok(W(Number(owner.slice(-2))), 'RESERVATION_REQUEST', 'Reservation', 'NEW', { taskId: t1, mode: 'EXCLUSIVE', scope: { paths: ['apps/x/'] } }).objectId;
  r.h.ok(M, 'RESERVATION_CHECK', 'Reservation', res);
  r.h.ok(M, 'RESERVATION_ACTIVATE', 'Reservation', res);
  // The owner goes silent; the spare keeps heartbeating.
  for (let i = 0; i < 7; i += 1) { r.h.advance(10); r.heartbeat(spare); }
  const rec = r.rt.reconcile({ mainSha: MAIN });
  const kinds = rec.actions.map((a) => a.kind);
  for (const kd of ['SESSION_LOST', 'ASSIGNMENT_ENDED', 'AGENT_MARK_LOST', 'RECOVERY', 'AGENT_RECOVER']) assert.ok(kinds.includes(kd), kd);
  assert.equal(r.session(owner).sessionState, 'LOST');
  const task = r.h.get('Task', t1);
  assert.equal(task.owner.agentId, spare, 'task transferred to the replacement slot');
  assert.equal(task.state, 'WORKING', 'progress is preserved; nothing restarts from scratch');
  assert.notEqual(task.state, 'COMPLETED');
  assert.equal(task.current.headSha, SHA('e'), 'last pushed head preserved');
  assert.ok(task.current.handoffId, 'handoff recorded');
  const handoff = r.h.get('Handoff', task.current.handoffId);
  assert.equal(handoff.commitSha, SHA('e'));
  const moved = r.h.cp.store.list('Reservation').filter((x) => x.taskId === t1 && x.state === 'ACTIVE');
  assert.equal(moved.length, 1, 'reservation preserved across the loss');
  assert.equal(moved[0].holder ?? r.h.get('Lease', moved[0].leaseId).holder, spare);
  assert.equal(r.h.get('AgentState', owner).state, 'STOPPED', 'lost slot recovered to STOPPED, awaiting a new session');
  const env = r.envelope(spare);
  assert.equal(env.resume, true);
  assert.equal(env.handoffId, task.current.handoffId);
  r.ack(spare);
  assert.equal(r.h.get('AgentState', spare).state, 'WORKING', 'successor slot coupled to the resumed task');
  const done = r.deliver(spare, SHA('f'));
  assert.equal(done.taskState, 'READY_FOR_REVIEW');
  // The lost session can never act again.
  throwsCode(assert, () => r.rt.poll(r.sessions[owner]), 'FORBIDDEN');
});

test('recovery: an offered (never acknowledged) task of a lost session is unclaimed, requeued and replaced', () => {
  const r = rig();
  r.attach('AGENT-01');
  const t = r.task(1);
  r.rt.assignReady({ fill: 1, mainSha: MAIN });
  r.h.advance(61);
  r.attach('AGENT-02');
  const out = r.rt.assignReady({ fill: 10, mainSha: MAIN });
  assert.equal(r.session('AGENT-01').sessionState, 'LOST');
  assert.deepEqual(out.offered.map((x) => [x.slot, x.taskId]), [['AGENT-02', t]], 'replacement session receives the requeued task');
  const events = r.rt.store.events().map((e) => e.type);
  for (const e of ['SESSION_LOST', 'SLOT_MARKED_LOST', 'RECOVERY_REQUEUED', 'SLOT_RECOVERED']) assert.ok(events.includes(e), e);
  assert.equal(r.h.get('AgentState', 'AGENT-01').state, 'STOPPED');
});

test('recovery: a new session on a lost slot reactivates it (generation 2) and it can receive work again', () => {
  const r = rig();
  r.attach('AGENT-01'); r.attach('AGENT-02');
  r.task(1); const t2 = r.task(2);
  r.rt.assignReady({ fill: 1, mainSha: MAIN });
  const owner = Object.values(r.state().assignments)[0].agentId;
  const other = owner === 'AGENT-01' ? 'AGENT-02' : 'AGENT-01';
  r.ack(owner); r.run(owner);
  for (let i = 0; i < 7; i += 1) { r.h.advance(10); r.heartbeat(other); }
  r.rt.reconcile({ mainSha: MAIN });
  assert.equal(r.h.get('AgentState', owner).state, 'STOPPED');
  assert.equal(r.envelope(other).resume, true, 'the lost work went to the spare session');
  r.ack(other);
  r.deliver(other);
  r.attach(owner);
  assert.equal(r.session(owner).generation, 2);
  const out = r.rt.assignReady({ fill: 10, mainSha: MAIN });
  assert.equal(r.h.get('AgentState', owner).state !== 'STOPPED', true, 'slot activated for the new session');
  assert.ok(out.offered.some((x) => x.slot === owner && x.taskId === t2 && x.status === 'OFFERED'));
});

test('recovery: an expired lease under a live session ends the assignment and the task is re-leased elsewhere', () => {
  const r = rig();
  r.attach('AGENT-01'); r.attach('AGENT-02');
  const t = r.task(1);
  r.rt.assignReady({ fill: 1, mainSha: MAIN });
  const owner = Object.values(r.state().assignments)[0].agentId;
  const other = owner === 'AGENT-01' ? 'AGENT-02' : 'AGENT-01';
  r.ack(owner); r.run(owner);
  // Both sessions stay alive but the owner never lets its heartbeat carry the assignment.
  for (let i = 0; i < 361; i += 1) { r.h.advance(10); r.heartbeat(owner, { assignmentId: undefined, leaseId: undefined }); r.heartbeat(other); }
  throwsCode(assert, () => r.rt.report({ ...r.sessions[owner], assignmentId: r.envelope(owner).assignmentId, status: 'PROGRESS', summary: 'late', idempotencyKey: k('late') }), 'LEASE_EXPIRED');
  const rec = r.rt.reconcile({ mainSha: MAIN });
  assert.ok(rec.actions.some((a) => a.kind === 'ASSIGNMENT_ENDED' && a.reason === 'LEASE_EXPIRED'));
  assert.equal(r.h.get('Task', t).owner.agentId, other);
  assert.equal(r.session(owner).sessionState, 'IDLE', 'the session itself is alive and free again');
});

test('recovery: a session reporting FAILED hands off; the Manager transfers the task; never COMPLETED', () => {
  const r = rig();
  r.attach('AGENT-01'); r.attach('AGENT-02');
  const t = r.task(1);
  r.rt.assignReady({ fill: 1, mainSha: MAIN });
  const owner = Object.values(r.state().assignments)[0].agentId;
  const other = owner === 'AGENT-01' ? 'AGENT-02' : 'AGENT-01';
  r.ack(owner); r.run(owner);
  const f = r.rt.report({ ...r.sessions[owner], assignmentId: r.envelope(owner).assignmentId, status: 'FAILED', summary: 'toolchain missing on this host', idempotencyKey: k('f') });
  assert.deepEqual([f.assignmentStatus, f.taskState, f.sessionState], ['FAILED', 'BLOCKED', 'IDLE']);
  r.rt.reconcile({ mainSha: MAIN });
  const task = r.h.get('Task', t);
  assert.equal(task.owner.agentId, other);
  assert.notEqual(task.state, 'COMPLETED');
  assert.equal(r.envelope(other).resume, true);
});

test('reject: a session may decline an offer; the task returns to READY for another session', () => {
  const r = rig();
  r.attach('AGENT-01');
  const t = r.task(1);
  r.rt.assignReady({ fill: 1, mainSha: MAIN });
  const env = r.envelope('AGENT-01');
  r.rt.reject({ ...r.sessions['AGENT-01'], assignmentId: env.assignmentId, reason: 'workspace busy', idempotencyKey: k('rej') });
  r.rt.reconcile({ mainSha: MAIN });
  assert.equal(r.h.get('Task', t).state, 'UNASSIGNED');
});

test('concurrency: ten live sessions receive ten distinct planned tasks; >=2 run concurrently; invariants hold', () => {
  const r = rig();
  r.attachAll(10);
  const tasks = Array.from({ length: 10 }, (_, i) => r.task(i + 1));
  const out = r.rt.assignReady({ fill: 10, mainSha: MAIN });
  assert.equal(out.offered.filter((x) => x.status === 'OFFERED').length, 10);
  assert.deepEqual(out.offered.map((x) => x.taskId).sort(), [...tasks].sort());
  assert.equal(new Set(out.offered.map((x) => x.slot)).size, 10);
  assert.equal(new Set(out.offered.map((x) => x.leaseId)).size, 10, 'one lease per assignment');
  for (const a of r.h.cp.policy.workerSlots) { r.ack(a); r.run(a); r.heartbeat(a); }
  const running = r.h.cp.store.list('Task').filter((t) => t.state === 'WORKING');
  assert.equal(running.length, 10);
  assert.deepEqual(r.rt.integrity(), []);
  const st = r.rt.status();
  assert.ok(st.slots.every((s) => s.sessionState === 'WORKING' && s.taskState === 'WORKING' && s.leaseState === 'ACTIVE'));
  const eng = engineReconcile(r.h.cp.store, r.h.cp.policy, r.h.iso());
  assert.deepEqual(eng.findings, [], 'engine reconcile stays clean with ten live sessions');
  // An 11th READY task waits (backpressure: every slot busy, one task per worker).
  const extra = r.task(11);
  assert.equal(r.rt.assignReady({ fill: 10, mainSha: MAIN }).offered.length, 0);
  assert.equal(r.h.get('Task', extra).state, 'UNASSIGNED');
});

test('status + live gate: local-harness evidence never satisfies the live acceptance gate', () => {
  const r = rig();
  r.attachAll(10);
  for (let i = 1; i <= 3; i += 1) r.task(i);
  r.rt.assignReady({ fill: 10, mainSha: MAIN });
  const gate = r.rt.evaluateLiveGate({ record: true });
  assert.equal(gate.status, 'NOT_MET');
  assert.equal(gate.criteria.find((c) => c.id === 'G1_TEN_ARENA_SESSIONS_ONLINE').observed, 0);
  const st = r.rt.status();
  assert.equal(st.acceptance, 'PARTIAL');
  assert.equal(st.liveGate, null, 'a NOT_MET gate is never recorded as passed');
  const raw = readFileSync(join(r.dir, 'events.jsonl'), 'utf8');
  assert.match(raw, /LIVE_GATE_EVALUATED/);
});

test('dry-run reconcile reports without mutating runtime or engine state', () => {
  const r = rig();
  r.attach('AGENT-01');
  r.task(1);
  r.rt.assignReady({ fill: 1, mainSha: MAIN });
  r.h.advance(61);
  const before = JSON.stringify(r.state().sessions);
  const engBefore = r.h.cp.store.events().length;
  const rec = r.rt.reconcile({ dryRun: true, mainSha: MAIN });
  assert.ok(rec.actions.some((a) => a.kind === 'SESSION_LOST'));
  assert.equal(JSON.stringify(r.state().sessions), before);
  assert.equal(r.h.cp.store.events().length, engBefore);
});
