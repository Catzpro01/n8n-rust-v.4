import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, loadPolicy } from '../src/core.mjs';
import { evaluateReservation, normalizePath, scopeFingerprint, pathsOverlap } from '../src/domain.mjs';
import { harness, expectError, M, W, SYS, SHA } from './helpers.mjs';

const { policy } = loadPolicy();

test('dependency graph rejects self, direct and indirect cycles', () => {
  const h = harness();
  const a = h.task();
  const b = h.task({ dependencies: [{ taskId: a }] });
  const c = h.task({ dependencies: [{ taskId: b }] });
  expectError(assert, h.run(M, 'TASK_ADD_DEPENDENCY', 'Task', a, { taskId: a }), 'DEPENDENCY_BLOCKED');
  expectError(assert, h.run(M, 'TASK_ADD_DEPENDENCY', 'Task', a, { taskId: b }), 'DEPENDENCY_BLOCKED');
  const r = h.run(M, 'TASK_ADD_DEPENDENCY', 'Task', a, { taskId: c });
  expectError(assert, r, 'DEPENDENCY_BLOCKED');
  assert.deepEqual(r.error.details.cycle, [a, c, b, a]);
  expectError(assert, h.run(M, 'TASK_CREATE', 'Task', 'NEW', { program: 'GOVERNANCE', title: 'x', dependencies: [{ taskId: 'TASK-9999' }] }), 'NOT_FOUND');
  expectError(assert, h.run(M, 'TASK_ADD_DEPENDENCY', 'Task', c, { taskId: b }), 'DUPLICATE');
});

test('only REQUIRED (and CONDITIONAL with condition met) dependencies block merge readiness', () => {
  const h = harness();
  const opt = h.task();
  const cond = h.task();
  const id = h.working(1, { dependencies: [{ taskId: opt, type: 'OPTIONAL' }, { taskId: cond, type: 'CONDITIONAL', condition: 'if API changes', conditionMet: false }] });
  const mq = h.readyForMerge(id);
  assert.equal(h.get('MergeQueueItem', mq).state, 'READY', 'OPTIONAL / unmet CONDITIONAL never block');
  const h2 = harness();
  const other = h2.task();
  const id2 = h2.working(1);
  h2.ok(M, 'TASK_ADD_DEPENDENCY', 'Task', id2, { taskId: other, type: 'REQUIRED' });
  const mq2 = h2.readyForMerge(id2);
  assert.equal(h2.get('MergeQueueItem', mq2).state, 'HOLD');
  assert.ok(h2.get('MergeQueueItem', mq2).laneReasons.some((x) => x.includes(other)));
  expectError(assert, h2.run(M, 'MQ_AUTHORIZE', 'MergeQueueItem', mq2, { observedHeadSha: SHA('a') }), 'INVALID_STATE_TRANSITION');
});

test('path normalization and conservative overlap', () => {
  assert.equal(normalizePath('.\\apps\\x\\'), 'apps/x/**');
  assert.equal(normalizePath('/apps//x/a.mjs'), 'apps/x/a.mjs');
  assert.ok(pathsOverlap('apps/x/**', 'apps/x/a.mjs'));
  assert.ok(pathsOverlap('apps/**', 'apps/x/*.mjs'));
  assert.ok(!pathsOverlap('apps/x/**', 'apps/y/a.mjs'));
  assert.ok(!pathsOverlap('apps/x/a.mjs', 'apps/x/b.mjs'));
  const dims = policy.reservation.dimensions;
  assert.equal(scopeFingerprint({ paths: ['b', 'a', 'a'], domains: ['X'] }, dims), scopeFingerprint({ domains: ['x'], paths: ['a', 'b'] }, dims));
});

test('reservation compatibility: EXCLUSIVE conflicts; SHARED_READ pairs are compatible; security surfaces always conflict', () => {
  const mk = (id, taskId, mode, scope, state = 'ACTIVE') => ({ objectId: id, taskId, mode, scope, state });
  const ex = [mk('RES-0001', 'TASK-0001', 'EXCLUSIVE', { paths: ['apps/x/'] })];
  assert.equal(evaluateReservation(mk('RES-0002', 'TASK-0002', 'SHARED_READ', { paths: ['apps/x/a.mjs'] }), ex, policy).outcome, 'CONFLICT');
  const rd = [mk('RES-0001', 'TASK-0001', 'SHARED_READ', { paths: ['apps/x/'] })];
  assert.equal(evaluateReservation(mk('RES-0002', 'TASK-0002', 'SHARED_READ', { paths: ['apps/x/'] }), rd, policy).outcome, 'CLEAR');
  const sec = [mk('RES-0001', 'TASK-0001', 'SHARED_WRITE', { securitySurfaces: ['auth'] })];
  assert.equal(evaluateReservation(mk('RES-0002', 'TASK-0002', 'SHARED_WRITE', { securitySurfaces: ['AUTH'] }), sec, policy).outcome, 'CONFLICT');
  // Released reservations never block; own task never conflicts with itself.
  assert.equal(evaluateReservation(mk('RES-0002', 'TASK-0002', 'EXCLUSIVE', { paths: ['apps/x/'] }), [{ ...ex[0], state: 'RELEASED' }], policy).outcome, 'CLEAR');
  assert.equal(evaluateReservation(mk('RES-0002', 'TASK-0001', 'EXCLUSIVE', { paths: ['apps/x/'] }), ex, policy).outcome, 'CLEAR');
});

test('unknown compatibility fails closed', () => {
  const p = JSON.parse(canonicalJson(policy));
  delete p.reservation.compatibility.SHARED_WRITE.SHARED_WRITE;
  const v = evaluateReservation({ objectId: 'RES-0002', taskId: 'TASK-0002', mode: 'SHARED_WRITE', scope: { paths: ['a/'] } }, [{ objectId: 'RES-0001', taskId: 'TASK-0001', mode: 'SHARED_WRITE', scope: { paths: ['a/'] }, state: 'ACTIVE' }], p);
  assert.equal(v.outcome, 'CONFLICT');
});

test('reservation lifecycle: request -> check -> activate with lease; conflicts serialize; release frees', () => {
  const h = harness();
  const t1 = h.working(1);
  const t2 = h.working(2);
  const r1 = h.ok(W(1), 'RESERVATION_REQUEST', 'Reservation', 'NEW', { taskId: t1, mode: 'EXCLUSIVE', scope: { paths: ['apps/x/'] } }).objectId;
  h.ok(M, 'RESERVATION_CHECK', 'Reservation', r1);
  h.ok(M, 'RESERVATION_ACTIVATE', 'Reservation', r1);
  const res1 = h.get('Reservation', r1);
  assert.equal(res1.state, 'ACTIVE');
  assert.equal(h.get('Lease', res1.leaseId).leaseType, 'RESERVATION');
  const r2 = h.ok(W(2), 'RESERVATION_REQUEST', 'Reservation', 'NEW', { taskId: t2, mode: 'SHARED_WRITE', scope: { paths: ['apps/x/y.mjs'] } }).objectId;
  const chk = h.ok(M, 'RESERVATION_CHECK', 'Reservation', r2);
  assert.equal(chk.resultingState, 'CONFLICT');
  assert.equal(h.get('Reservation', r2).parallelism, 'SERIALIZED');
  assert.equal(h.get('Task', t2).history.reservationConflictCount, 1);
  h.ok(M, 'RESERVATION_RELEASE', 'Reservation', r1);
  assert.equal(h.get('Lease', res1.leaseId).state, 'COMPLETED');
  assert.equal(h.ok(M, 'RESERVATION_CHECK', 'Reservation', r2).resultingState, 'RESERVED');
});

test('activation re-evaluates conflicts that appeared after the check', () => {
  const h = harness();
  const t1 = h.working(1);
  const t2 = h.working(2);
  const r1 = h.ok(W(1), 'RESERVATION_REQUEST', 'Reservation', 'NEW', { taskId: t1, mode: 'EXCLUSIVE', scope: { paths: ['a/'] } }).objectId;
  const r2 = h.ok(W(2), 'RESERVATION_REQUEST', 'Reservation', 'NEW', { taskId: t2, mode: 'EXCLUSIVE', scope: { paths: ['a/b'] } }).objectId;
  h.ok(M, 'RESERVATION_CHECK', 'Reservation', r1);
  h.ok(M, 'RESERVATION_CHECK', 'Reservation', r2); // r1 only RESERVED -> blocking state -> conflict
  assert.equal(h.get('Reservation', r2).state, 'CONFLICT');
  h.ok(M, 'RESERVATION_ACTIVATE', 'Reservation', r1);
  expectError(assert, h.run(M, 'RESERVATION_ACTIVATE', 'Reservation', r2), 'INVALID_STATE_TRANSITION');
});

test('GOVERNANCE_LOCK and governance surfaces are Manager-only; forbidden paths are enforced', () => {
  const h = harness();
  const id = h.working(1, { constraints: { forbiddenPaths: ['docs/n8n-lego/milestones.json'] } });
  expectError(assert, h.run(W(1), 'RESERVATION_REQUEST', 'Reservation', 'NEW', { taskId: id, mode: 'GOVERNANCE_LOCK', scope: { paths: ['x'] } }), 'GOVERNANCE_REQUIRED');
  expectError(assert, h.run(W(1), 'RESERVATION_REQUEST', 'Reservation', 'NEW', { taskId: id, mode: 'SHARED_WRITE', scope: { governanceSurfaces: ['branch-policy'] } }), 'GOVERNANCE_REQUIRED');
  expectError(assert, h.run(W(1), 'RESERVATION_REQUEST', 'Reservation', 'NEW', { taskId: id, mode: 'SHARED_WRITE', scope: { paths: ['docs/n8n-lego/'] } }), 'POLICY_DENIED');
  expectError(assert, h.run(W(1), 'RESERVATION_REQUEST', 'Reservation', 'NEW', { taskId: id, mode: 'SHARED_WRITE', scope: {} }), 'INVALID_SCHEMA');
  const r = h.ok(M, 'RESERVATION_REQUEST', 'Reservation', 'NEW', { taskId: id, mode: 'GOVERNANCE_LOCK', scope: { governanceSurfaces: ['branch-policy'] } }).objectId;
  h.ok(M, 'RESERVATION_CHECK', 'Reservation', r);
  h.ok(M, 'RESERVATION_ACTIVATE', 'Reservation', r);
  expectError(assert, h.run(M, 'RESERVATION_TRANSFER', 'Reservation', r, { toAgentId: h.agent(2) }), 'HUMAN_APPROVAL_REQUIRED');
});

test('assignment lease: expired lease blocks worker mutation (LEASE_EXPIRED) and is never revived', () => {
  const h = harness();
  const id = h.working(1);
  const leaseId = h.get('Task', id).execution.activeLeaseId;
  h.advance(3601);
  expectError(assert, h.run(W(1), 'TASK_PROGRESS', 'Task', id, { nextAction: 'x' }), 'LEASE_EXPIRED');
  expectError(assert, h.run(W(1), 'LEASE_RENEW', 'Lease', leaseId), 'LEASE_EXPIRED');
  h.ok(SYS('SYSTEM-RECOVERY'), 'LEASE_EXPIRE', 'Lease', leaseId);
  expectError(assert, h.run(W(1), 'TASK_PROGRESS', 'Task', id, { nextAction: 'x' }), 'LEASE_EXPIRED');
  expectError(assert, h.run(M, 'LEASE_RENEW', 'Lease', leaseId), 'ALREADY_TERMINAL');
});

test('lease renewal is CAS-protected, monotonic and capped at max lifetime; merge authorizations are not renewable', () => {
  const h = harness();
  const id = h.working(1);
  const leaseId = h.get('Task', id).execution.activeLeaseId;
  const stale = h.get('Lease', leaseId).revision;
  h.advance(1800);
  h.ok(W(1), 'LEASE_RENEW', 'Lease', leaseId);
  expectError(assert, h.run(W(1), 'LEASE_RENEW', 'Lease', leaseId, {}, { expectedRevision: stale }), 'REVISION_CONFLICT');
  const l = h.get('Lease', leaseId);
  assert.equal(l.renewCount, 1);
  assert.equal(Date.parse(l.expiresAt), h.clock.t + 3600e3);
  // walk to the max lifetime cap
  for (let i = 0; i < 30; i += 1) { h.advance(3000); const r = h.run(W(1), 'LEASE_RENEW', 'Lease', leaseId); if (!r.ok) { assert.equal(r.error.code, 'POLICY_DENIED'); break; } }
  assert.equal(h.get('Lease', leaseId).expiresAt, h.get('Lease', leaseId).maxExpiresAt);
  // reservation leases are not worker-renewable
  const r = h.ok(W(1), 'RESERVATION_REQUEST', 'Reservation', 'NEW', { taskId: id, mode: 'SHARED_WRITE', scope: { paths: ['z/'] } }).objectId;
  h.ok(M, 'RESERVATION_CHECK', 'Reservation', r);
  h.ok(M, 'RESERVATION_ACTIVATE', 'Reservation', r);
  expectError(assert, h.run(W(1), 'LEASE_RENEW', 'Lease', h.get('Reservation', r).leaseId), 'FORBIDDEN');
  // MERGE_AUTHORIZATION leases are never renewable
  h.ok(W(1), 'TASK_READY_FOR_REVIEW', 'Task', id, { headSha: SHA('a') });
});
