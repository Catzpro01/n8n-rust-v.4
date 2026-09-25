// #295 §19 — session registration, credentials, heartbeat, idempotency and the no-secret guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rig, throwsCode, k, MAIN } from './runtime-helpers.mjs';
import { findSecrets, assertNoSecrets, validateRuntimeConfig, defaultRuntimeConfig, SESSION_TRANSITIONS, transitionSession } from '../src/session-runtime.mjs';
import { W } from './helpers.mjs';

// Secret-shaped fixtures are assembled at runtime so no secret-like literal exists in the repo.
const FAKE = {
  classicPat: ['gh', 'p_'].join('') + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
  fineGrained: ['github', '_pat_'].join('') + '11ABCDEFG0123456789_abcdefghijklmnop',
  apiKey: ['s', 'k-'].join('') + 'abcdefghijklmnopqrstuvwxyz012345',
  jwt: ['ey', 'J'].join('') + 'hbGciOiJIUzI1NiJ9.' + ['ey', 'J'].join('') + 'yb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlc2lnbmF0dXJl',
};

test('registration: ten canonical slots register ONLINE -> IDLE with distinct sessions and generation 1', () => {
  const r = rig();
  r.attachAll(10);
  const st = r.state();
  const live = Object.values(st.sessions);
  assert.equal(live.length, 10);
  assert.deepEqual([...new Set(live.map((s) => s.agentId))].sort(), r.h.cp.policy.workerSlots);
  for (const s of live) { assert.equal(s.sessionState, 'IDLE'); assert.equal(s.generation, 1); assert.equal(s.protocolVersion, '1'); }
  const status = r.rt.status();
  assert.equal(status.liveSessions, 10);
  assert.equal(status.acceptance, 'PARTIAL', 'local-harness sessions never make the runtime READY');
});

test('registration: session credential is returned once, stored only as a digest, never in the runtime document', () => {
  const r = rig();
  const req = r.regReq('AGENT-01');
  const first = r.rt.register(req);
  assert.match(first.sessionToken, /^ars1_/);
  const raw = readFileSync(join(r.dir, 'runtime.json'), 'utf8') + readFileSync(join(r.dir, 'events.jsonl'), 'utf8');
  assert.ok(!raw.includes(first.sessionToken), 'session credential leaked into runtime state');
  assert.ok(!raw.includes(r.bundles['AGENT-01'].enrollment.token), 'enrollment credential leaked into runtime state');
  const replay = r.rt.register(req);
  assert.equal(replay.replayed, true);
  assert.equal(replay.sessionToken, null, 'a replayed registration never re-issues the credential');
  assert.equal(first.session.tokenDigest, undefined);
});

test('registration: duplicate session id and a second live session for the same slot are rejected', () => {
  const r = rig();
  const me = r.attach('AGENT-01');
  throwsCode(assert, () => r.rt.register(r.regReq('AGENT-01', { sessionId: me.sessionId })), 'DUPLICATE');
  throwsCode(assert, () => r.rt.register(r.regReq('AGENT-01')), 'RESOURCE_UNAVAILABLE');
});

test('registration: invalid agent, protocol, workspace, branch, capability, runner class and enrollment fail closed', () => {
  const r = rig();
  throwsCode(assert, () => r.rt.register(r.regReq('AGENT-01', { agentId: 'AGENT-11' })), 'FORBIDDEN');
  throwsCode(assert, () => r.rt.register(r.regReq('AGENT-01', { agentId: 'agent-01' })), 'FORBIDDEN');
  throwsCode(assert, () => r.rt.register(r.regReq('AGENT-01', { protocolVersion: '2' })), 'POLICY_DENIED');
  throwsCode(assert, () => r.rt.register(r.regReq('AGENT-01', { protocolVersion: undefined })), 'POLICY_DENIED');
  throwsCode(assert, () => r.rt.register(r.regReq('AGENT-01', { workspace: r.bundles['AGENT-02'].workspace })), 'POLICY_DENIED');
  throwsCode(assert, () => r.rt.register(r.regReq('AGENT-01', { workspace: `${r.bundles['AGENT-01'].workspace}/../AGENT-02` })), 'POLICY_DENIED');
  throwsCode(assert, () => r.rt.register(r.regReq('AGENT-01', { workspace: 'relative/AGENT-01' })), 'INVALID_SCHEMA');
  throwsCode(assert, () => r.rt.register(r.regReq('AGENT-01', { branch: 'main' })), 'POLICY_DENIED');
  throwsCode(assert, () => r.rt.register(r.regReq('AGENT-01', { branch: 'arena/agent-02' })), 'POLICY_DENIED');
  throwsCode(assert, () => r.rt.register(r.regReq('AGENT-01', { capabilities: ['node', 'rust'] })), 'FORBIDDEN');
  throwsCode(assert, () => r.rt.register(r.regReq('AGENT-01', { runnerClass: 'MAC' })), 'INVALID_SCHEMA');
  throwsCode(assert, () => r.rt.register(r.regReq('AGENT-01', { enrollmentToken: r.bundles['AGENT-02'].enrollment.token })), 'UNAUTHORIZED');
  throwsCode(assert, () => r.rt.register(r.regReq('AGENT-01', { sessionKind: 'unknown' })), 'INVALID_SCHEMA');
  throwsCode(assert, () => r.rt.register(r.regReq('AGENT-01', { sessionId: 'x' })), 'INVALID_SCHEMA');
  assert.equal(Object.keys(r.state().sessions).length, 0, 'no rejected registration leaves a session behind');
});

test('registration: an expired enrollment is rejected; a SUSPENDED slot accepts no session', () => {
  const r = rig({ config: { enrollmentTtlSeconds: 120 } });
  r.h.advance(121);
  throwsCode(assert, () => r.rt.register(r.regReq('AGENT-01')), 'UNAUTHORIZED');
  const r2 = rig();
  r2.h.ok({ type: 'MANAGER', id: 'MANAGER-01' }, 'AGENT_SUSPEND', 'AgentState', 'AGENT-03', { reasonCode: 'TEST' });
  throwsCode(assert, () => r2.rt.register(r2.regReq('AGENT-03')), 'POLICY_DENIED');
});

test('session protocol: wrong credential is UNAUTHORIZED; another slot identity is FORBIDDEN', () => {
  const r = rig();
  const a = r.attach('AGENT-01');
  const b = r.attach('AGENT-02');
  throwsCode(assert, () => r.rt.poll({ ...a, sessionToken: b.sessionToken }), 'UNAUTHORIZED');
  throwsCode(assert, () => r.rt.poll({ ...a, agentId: 'AGENT-02' }), 'FORBIDDEN');
  throwsCode(assert, () => r.rt.poll({ ...a, sessionToken: undefined }), 'UNAUTHORIZED');
});

test('heartbeat: renews the own lease only near expiry, duplicate heartbeat is idempotent, conflicting reuse is rejected', () => {
  const r = rig();
  r.attach('AGENT-01');
  r.task(1);
  r.rt.assignReady({ fill: 1, mainSha: MAIN });
  r.ack('AGENT-01');
  const env = r.envelope('AGENT-01');
  const hb1 = r.heartbeat('AGENT-01');
  assert.equal(hb1.leaseRenewed, false, 'a fresh lease is not renewed on every heartbeat (no event noise)');
  r.h.advance(1900);
  const req = { ...r.sessions['AGENT-01'], assignmentId: env.assignmentId, leaseId: env.leaseId, timestamp: r.h.iso(), sessionState: 'WORKING', idempotencyKey: k('hb') };
  const hb2 = r.rt.heartbeat(req);
  assert.equal(hb2.leaseRenewed, true);
  const renewed = r.h.get('Lease', env.leaseId);
  assert.equal(renewed.renewCount, 1);
  const again = r.rt.heartbeat(req);
  assert.equal(again.replayed, true);
  assert.equal(r.h.get('Lease', env.leaseId).renewCount, 1, 'a replayed heartbeat never renews twice');
  throwsCode(assert, () => r.rt.heartbeat({ ...req, sessionState: 'IDLE' }), 'IDEMPOTENCY_CONFLICT');
  assert.equal(r.h.get('AgentState', 'AGENT-01').heartbeat.lastSeenAt !== null, true, 'slot heartbeat mirrored into the engine');
});

test('heartbeat: a session can never heartbeat or renew another session\'s assignment or lease', () => {
  const r = rig();
  r.attach('AGENT-01'); r.attach('AGENT-02');
  r.task(1); r.task(2);
  r.rt.assignReady({ fill: 2, mainSha: MAIN });
  r.ack('AGENT-01'); r.ack('AGENT-02');
  const other = r.envelope('AGENT-02');
  throwsCode(assert, () => r.heartbeat('AGENT-01', { assignmentId: other.assignmentId, leaseId: other.leaseId }), 'FORBIDDEN');
  const own = r.envelope('AGENT-01');
  throwsCode(assert, () => r.heartbeat('AGENT-01', { assignmentId: own.assignmentId, leaseId: other.leaseId }), 'FORBIDDEN');
  // Direct engine path: a worker cannot renew another worker's lease either.
  const res = r.h.run(W(1), 'LEASE_RENEW', 'Lease', other.leaseId, {});
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'FORBIDDEN');
  throwsCode(assert, () => r.heartbeat('AGENT-01', { timestamp: '2020-01-01T00:00:00Z' }), 'POLICY_DENIED');
});

test('drain: an idle session drains straight to OFFLINE and cannot be used afterwards', () => {
  const r = rig();
  const me = r.attach('AGENT-04');
  assert.equal(r.rt.drain({ ...me, idempotencyKey: k('drain') }).sessionState, 'OFFLINE');
  throwsCode(assert, () => r.rt.poll(me), 'FORBIDDEN');
  r.attach('AGENT-04');
  assert.equal(r.session('AGENT-04').generation, 2, 'a slot receives a new session (generation 2) — sessions are not identities');
});

test('secret guard: credential patterns and credential-named fields are detected without echoing values', () => {
  for (const v of Object.values(FAKE)) assert.equal(findSecrets({ note: `x ${v} y` }).length, 1, v.slice(0, 6));
  assert.deepEqual(findSecrets({ nested: { token: 'abc' } }).map((f) => f.kind), ['CREDENTIAL_FIELD']);
  assert.equal(findSecrets({ title: 'fix the token bucket limiter', tokens: 3 }).length, 0, 'ordinary words are not secrets');
  try { assertNoSecrets({ a: FAKE.classicPat }, 'thing'); assert.fail('should throw'); } catch (e) { assert.equal(e.code, 'POLICY_DENIED'); assert.ok(!JSON.stringify(e.details).includes(FAKE.classicPat)); assert.ok(!e.message.includes(FAKE.classicPat)); }
});

test('secret guard: a task carrying a credential is never published in an envelope; reports are screened too', () => {
  const r = rig();
  r.attach('AGENT-01'); r.attach('AGENT-02');
  const bad = r.task(1, { title: `rotate ${FAKE.fineGrained}` });
  const good = r.task(2);
  const out = r.rt.assignReady({ fill: 2, mainSha: MAIN });
  const badRow = out.offered.find((x) => x.taskId === bad);
  assert.equal(badRow.status, 'NOT_ASSIGNED');
  assert.equal(badRow.error.code, 'POLICY_DENIED');
  assert.equal(r.h.get('Task', bad).state, 'UNASSIGNED', 'fail closed before TASK_ASSIGN');
  assert.equal(out.offered.find((x) => x.taskId === good).status, 'OFFERED');
  const agent = out.offered.find((x) => x.taskId === good).slot;
  r.ack(agent);
  const env = r.envelope(agent);
  throwsCode(assert, () => r.rt.report({ ...r.sessions[agent], assignmentId: env.assignmentId, status: 'PROGRESS', summary: `pushed with ${FAKE.apiKey}`, idempotencyKey: k('p') }), 'POLICY_DENIED');
  const raw = readFileSync(join(r.dir, 'runtime.json'), 'utf8') + readFileSync(join(r.dir, 'events.jsonl'), 'utf8');
  for (const v of Object.values(FAKE)) assert.ok(!raw.includes(v));
});

test('config and state machines: unknown transport fails closed; single late heartbeat never loses a session', () => {
  const policy = rig().h.cp.policy;
  const d = defaultRuntimeConfig(policy);
  assert.deepEqual(validateRuntimeConfig(d), []);
  assert.equal(d.sessionLostSeconds, policy.timing.heartbeatLostCandidateSeconds, 'default loss threshold follows the policy');
  assert.ok(validateRuntimeConfig({ ...d, transport: { kind: 'carrier-pigeon' } }).some((e) => /fail closed/.test(e)));
  assert.ok(validateRuntimeConfig({ ...d, sessionLostSeconds: 20, heartbeatIntervalSeconds: 10 }).length > 0);
  assert.deepEqual(SESSION_TRANSITIONS.LOST, []);
  assert.deepEqual(SESSION_TRANSITIONS.OFFLINE, []);
  const s = { sessionId: 's', sessionState: 'LOST', history: [], revision: 1 };
  assert.throws(() => transitionSession(s, 'IDLE', 'now', 'x'), /not allowed/);
});
