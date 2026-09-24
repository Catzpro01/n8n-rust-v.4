import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { harness, expectError, M, W } from './helpers.mjs';

function fsSnapshot(dir) {
  const out = {};
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name !== 'LOCK') out[p] = readFileSync(p, 'utf8'); } };
  walk(dir);
  return out;
}

test('stale expectedRevision -> REVISION_CONFLICT with current state and zero mutation', () => {
  const h = harness();
  h.agent(1);
  const id = h.task();
  const before = fsSnapshot(h.stateDir);
  const r = h.run(M, 'TASK_ASSIGN', 'Task', id, { agentId: 'AGENT-01' }, { expectedRevision: 7 });
  expectError(assert, r, 'REVISION_CONFLICT');
  assert.deepEqual(r.current, { revision: 1, state: 'UNASSIGNED' });
  assert.equal(r.error.retrySafe, false);
  assert.deepEqual(fsSnapshot(h.stateDir), before, 'rejected command must not touch disk');
});

test('every failing command leaves the store byte-identical', () => {
  const h = harness();
  const id = h.working(1);
  const before = fsSnapshot(h.stateDir);
  expectError(assert, h.run(M, 'TASK_COMPLETE', 'Task', id), 'INVALID_STATE_TRANSITION');
  expectError(assert, h.run(W(1), 'TASK_ASSIGN', 'Task', id, { agentId: 'AGENT-01' }), 'FORBIDDEN');
  expectError(assert, h.run(M, 'TASK_ADD_DEPENDENCY', 'Task', id, { taskId: id }), 'DEPENDENCY_BLOCKED');
  expectError(assert, h.run(M, 'TASK_CANCEL', 'Task', id, { reasonCode: 'X' }), 'POLICY_DENIED');
  assert.deepEqual(fsSnapshot(h.stateDir), before);
});

test('same idempotency key + same payload replays the original result without a second mutation', () => {
  const h = harness();
  const env = h.envelope(M, 'TASK_CREATE', 'Task', 'NEW', { program: 'GOVERNANCE', title: 'once' }, { idempotencyKey: 'create-once' });
  const first = h.cp.execute(env);
  const eventsAfterFirst = h.cp.store.events().length;
  const second = h.cp.execute({ ...env, commandId: 'CMD-retry-0002' });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.objectId, first.objectId);
  assert.equal(second.replayOfCommandId, first.commandId);
  assert.equal(h.cp.store.list('Task').length, 1);
  assert.equal(h.cp.store.events().length, eventsAfterFirst);
});

test('same idempotency key + different payload -> IDEMPOTENCY_CONFLICT', () => {
  const h = harness();
  h.cp.execute(h.envelope(M, 'TASK_CREATE', 'Task', 'NEW', { program: 'GOVERNANCE', title: 'a' }, { idempotencyKey: 'dup-key' }));
  const r = h.cp.execute(h.envelope(M, 'TASK_CREATE', 'Task', 'NEW', { program: 'GOVERNANCE', title: 'b' }, { idempotencyKey: 'dup-key' }));
  expectError(assert, r, 'IDEMPOTENCY_CONFLICT');
  assert.equal(h.cp.store.list('Task').length, 1);
});

test('idempotency keys are scoped per actor', () => {
  const h = harness();
  h.agent(1);
  h.agent(2);
  const a = h.run(W(1), 'AGENT_HEARTBEAT', 'AgentState', 'AGENT-01', {}, { idempotencyKey: 'hb-1' });
  const b = h.run(W(2), 'AGENT_HEARTBEAT', 'AgentState', 'AGENT-02', {}, { idempotencyKey: 'hb-1' });
  assert.equal(a.ok && b.ok, true);
  assert.equal(b.idempotentReplay, false);
});

test('explicit create ids: DUPLICATE on reuse, sequence never reissues them; create requires revision 0', () => {
  const h = harness();
  h.ok(M, 'TASK_CREATE', 'Task', 'TASK-0005', { program: 'GOVERNANCE', title: 'explicit' });
  expectError(assert, h.run(M, 'TASK_CREATE', 'Task', 'TASK-0005', { program: 'GOVERNANCE', title: 'again' }, { expectedRevision: 0 }), 'DUPLICATE');
  expectError(assert, h.run(M, 'TASK_CREATE', 'Task', 'NEW', { program: 'GOVERNANCE', title: 'x' }, { expectedRevision: 1 }), 'REVISION_CONFLICT');
  const next = h.task();
  assert.equal(next, 'TASK-0006');
  expectError(assert, h.run(M, 'AGENT_REGISTER', 'AgentState', 'AGENT-11', {}), 'INVALID_SCHEMA');
  h.agent(1);
  expectError(assert, h.run(M, 'AGENT_REGISTER', 'AgentState', 'AGENT-01', { capabilities: [] }, { expectedRevision: 0 }), 'DUPLICATE');
});

test('revision increments by exactly one per mutation and events reference the new revision', () => {
  const h = harness();
  const id = h.working(1);
  const t = h.get('Task', id);
  assert.equal(t.revision, 5);
  const evts = h.cp.store.events().filter((e) => e.objectType === 'Task' && e.objectId === id);
  assert.deepEqual(evts.map((e) => e.revision), [1, 2, 3, 4, 5]);
  assert.deepEqual(evts.map((e) => e.toState), ['UNASSIGNED', 'CLAIMED', 'ACKNOWLEDGED', 'PREPARING', 'WORKING']);
});
