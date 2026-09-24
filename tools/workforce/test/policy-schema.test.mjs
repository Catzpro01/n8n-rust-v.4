import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ERROR_CODES, loadPolicy, validatePolicy, canonicalJson } from '../src/core.mjs';
import { CORE_OBJECT_TYPES, validate, SCHEMA_FILES, WORKFORCE_DOCS } from '../src/schema.mjs';
import { harness } from './helpers.mjs';

const { policy } = loadPolicy();
const engineSource = readFileSync(new URL('../src/engine.mjs', import.meta.url), 'utf8');

test('canonical policy validates and is digest-pinned', () => {
  const p = loadPolicy();
  assert.match(p.digest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(validatePolicy(p.policy), []);
});

test('exactly the 20 stable error codes exist, each with a retry-safe flag', () => {
  const expected = ['INVALID_SCHEMA', 'UNAUTHORIZED', 'FORBIDDEN', 'REVISION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'NOT_FOUND', 'INVALID_STATE_TRANSITION', 'DEPENDENCY_BLOCKED', 'RESERVATION_CONFLICT', 'LEASE_EXPIRED', 'LEASE_REVOKED', 'EVIDENCE_INSUFFICIENT', 'MERGE_HEAD_CHANGED', 'POLICY_DENIED', 'GOVERNANCE_REQUIRED', 'HUMAN_APPROVAL_REQUIRED', 'RESOURCE_UNAVAILABLE', 'ALREADY_TERMINAL', 'DUPLICATE', 'INTERNAL_RECOVERY_REQUIRED'];
  assert.deepEqual(Object.keys(ERROR_CODES).sort(), [...expected].sort());
  for (const c of expected) assert.equal(typeof ERROR_CODES[c].retrySafe, 'boolean');
  const retrySafe = expected.filter((c) => ERROR_CODES[c].retrySafe).sort();
  assert.deepEqual(retrySafe, ['DEPENDENCY_BLOCKED', 'EVIDENCE_INSUFFICIENT', 'HUMAN_APPROVAL_REQUIRED', 'INTERNAL_RECOVERY_REQUIRED', 'RESERVATION_CONFLICT', 'RESOURCE_UNAVAILABLE']);
});

test('seven core schemas exist and every policy command has an engine handler', () => {
  assert.deepEqual([...CORE_OBJECT_TYPES].sort(), ['AgentState', 'Decision', 'Evidence', 'Lease', 'MergeQueueItem', 'Reservation', 'Task']);
  for (const f of Object.values(SCHEMA_FILES)) JSON.parse(readFileSync(join(WORKFORCE_DOCS, 'schemas', f), 'utf8'));
  for (const name of Object.keys(policy.commands)) assert.match(engineSource, new RegExp(`\\b${name}\\(ctx\\)`), `missing handler ${name}`);
});

test('state machines: terminal states have no outgoing edges; exact #265 matrix decisions (DEC-0005)', () => {
  for (const [type, sm] of Object.entries(policy.stateMachines)) for (const t of sm.terminal) assert.deepEqual(sm.transitions[t], [], `${type}.${t}`);
  const task = policy.stateMachines.Task.transitions;
  for (const s of ['READY_FOR_REVIEW', 'MERGING', 'VERIFYING']) assert.ok(!task[s].includes('CANCELLED'), `${s} must not cancel directly`);
  assert.ok(task.HOLD.includes('CANCELLED'));
  assert.ok(!('LOST_RECOVERY' in task));
  assert.ok(policy.stateMachines.Decision.transitions.PROPOSED.includes('REJECTED'));
  const agentEdges = policy.stateMachines.AgentState.managerOnlyEdges;
  assert.equal(agentEdges.decision, 'DEC-0005');
  for (const [a, b] of agentEdges.edges) assert.ok(policy.stateMachines.AgentState.transitions[a].includes(b));
});

test('validatePolicy rejects unsafe mutations (fail closed)', () => {
  const clone = () => JSON.parse(canonicalJson(policy));
  const p1 = clone(); p1.stateMachines.Task.transitions.COMPLETED = ['WORKING'];
  assert.ok(validatePolicy(p1).length > 0);
  const p2 = clone(); p2.timing.pollIntervalMaxMs = 5000;
  assert.ok(validatePolicy(p2).length > 0);
  const p3 = clone(); p3.reservation.compatibility.EXCLUSIVE.SHARED_READ = 'COMPATIBLE';
  assert.ok(validatePolicy(p3).length > 0, 'asymmetric compatibility must be rejected');
  const p4 = clone(); p4.labels.workerWhitelist = ['status:done'];
  assert.ok(validatePolicy(p4).length > 0, 'protected labels can never be worker-writable');
  const p5 = clone(); p5.systemActorAllowlist['SYSTEM-CI'].push('DECISION_ACTIVATE');
  assert.ok(validatePolicy(p5).length > 0);
});

test('schemas reject unknown fields and malformed identifiers', () => {
  const h = harness();
  const id = h.task();
  const task = h.get('Task', id);
  assert.deepEqual(validate('Task', task), []);
  assert.ok(validate('Task', { ...task, surprise: true }).length > 0);
  assert.ok(validate('Task', { ...task, objectId: 'TASK-1' }).length > 0);
  assert.ok(validate('Task', { ...task, state: 'LOST_RECOVERY' }).length > 0);
});

test('INVALID_SCHEMA on malformed envelope, unknown command and target mismatch', () => {
  const h = harness();
  const e = h.envelope({ type: 'MANAGER', id: 'MANAGER-01' }, 'TASK_CREATE', 'Task', 'NEW', { program: 'GOVERNANCE', title: 'x' });
  assert.equal(h.cp.execute({ ...e, commandType: 'TASK_TELEPORT' }).error.code, 'INVALID_SCHEMA');
  assert.equal(h.cp.execute({ ...e, target: { objectType: 'Lease', objectId: 'NEW' } }).error.code, 'INVALID_SCHEMA');
  const { reason, ...noReason } = e;
  assert.equal(h.cp.execute(noReason).error.code, 'INVALID_SCHEMA');
  assert.equal(h.cp.execute(null).error.code, 'INVALID_SCHEMA');
});
