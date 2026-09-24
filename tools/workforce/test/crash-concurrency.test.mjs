import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ControlPlane } from '../src/engine.mjs';
import { verifyEventLog, verifyIntegrity } from '../src/recovery.mjs';
import { harness, expectError, M, tempDir, ACTORS } from './helpers.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));

for (const fault of ['afterJournal', 'afterFirstWrite', 'beforeJournalRemove']) {
  test(`crash injection (${fault}): command reports INTERNAL_RECOVERY_REQUIRED; restart rolls forward atomically; retry replays`, () => {
    const setup = harness();
    setup.agent(1);
    const id = setup.task();
    // Same state dir, new process-equivalent with a fault armed.
    const crashing = new ControlPlane({ stateDir: setup.stateDir, now: setup.iso, fault });
    const env = setup.envelope(M, 'TASK_ASSIGN', 'Task', id, { agentId: 'AGENT-01' }, { idempotencyKey: `assign-${fault}` });
    const r = crashing.execute(env);
    expectError(assert, r, 'INTERNAL_RECOVERY_REQUIRED');
    assert.equal(r.error.retrySafe, true);
    assert.equal(existsSync(join(setup.stateDir, 'journal', 'pending.json')), true, 'journal must survive the crash');
    // "Restart": a fresh control plane rolls the committed journal forward on open.
    const restarted = new ControlPlane({ stateDir: setup.stateDir, now: setup.iso });
    assert.equal(restarted.store.recovered.recovered, true);
    const task = restarted.store.get('Task', id);
    const agent = restarted.store.get('AgentState', 'AGENT-01');
    const lease = restarted.store.get('Lease', task.execution.activeLeaseId);
    // All-or-nothing: every object of the transaction is present together.
    assert.equal(task.state, 'CLAIMED');
    assert.equal(agent.state, 'ASSIGNED');
    assert.equal(lease.state, 'ACTIVE');
    assert.deepEqual(verifyIntegrity(restarted.store, restarted.policy), []);
    assert.deepEqual(verifyEventLog(restarted.store, restarted.policy).findings, []);
    // The caller retries with the same key and gets the committed result, no double application.
    const eventsBefore = restarted.store.events().length;
    const retry = restarted.execute({ ...env, commandId: `CMD-retry-${fault}` });
    assert.equal(retry.ok, true);
    assert.equal(retry.idempotentReplay, true);
    assert.equal(restarted.store.events().length, eventsBefore);
    assert.equal(restarted.store.list('Lease').length, 1);
  });
}

test('torn journal is quarantined and nothing is applied', () => {
  const h = harness();
  const id = h.task();
  writeFileSync(join(h.stateDir, 'journal', 'pending.json'), '{"txId":"TX-1","writes":[{"path":');
  const cp = new ControlPlane({ stateDir: h.stateDir, now: h.iso });
  assert.equal(cp.store.recovered.tornJournalQuarantined, true);
  assert.ok(readdirSync(join(h.stateDir, 'journal')).some((f) => f.startsWith('torn-')));
  assert.equal(cp.store.get('Task', id).revision, 1);
});

function runWorker(stateDir, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(HERE, 'fixtures', 'concurrent-worker.mjs'), stateDir, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`worker exited ${code}: ${err}`))));
  });
}

test('multi-process CAS race: exactly one of N concurrent same-revision mutations wins', async () => {
  const h = harness();
  for (const n of [1, 2, 3, 4, 5, 6]) h.agent(n);
  const id = h.task();
  const results = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => runWorker(h.stateDir, ['assign', id, `AGENT-0${n}`, '1'])));
  const wins = results.filter((r) => r.ok);
  assert.equal(wins.length, 1, JSON.stringify(results.map((r) => r.error?.code ?? 'ok')));
  assert.ok(results.filter((r) => !r.ok).every((r) => r.error.code === 'REVISION_CONFLICT'));
  const cp = new ControlPlane({ stateDir: h.stateDir, now: h.iso });
  assert.equal(cp.store.list('Lease').filter((l) => l.state === 'ACTIVE').length, 1);
  assert.deepEqual(verifyIntegrity(cp.store, cp.policy), []);
});

test('multi-process creates allocate unique ids and a gap-free event log', async () => {
  const h = harness();
  const results = await Promise.all([1, 2, 3, 4].map((n) => runWorker(h.stateDir, ['create', String(n), '5'])));
  const ids = results.flat().map((r) => r.objectId);
  assert.equal(ids.length, 20);
  assert.equal(new Set(ids).size, 20);
  const cp = new ControlPlane({ stateDir: h.stateDir, now: h.iso });
  assert.equal(cp.store.list('Task').length, 20);
  const log = verifyEventLog(cp.store, cp.policy);
  assert.deepEqual(log.findings, []);
  assert.ok(ACTORS.length > 0);
});
