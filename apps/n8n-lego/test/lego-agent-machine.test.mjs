/**
 * P2.16 Agent Machine LEGO contract and bounded-execution-foundation tests.
 *
 * These tests exercise only the published ai.agent-machine surface. They prove
 * that Agent Machine owns one canonical bounded execution state machine —
 * identity, lifecycle, step bookkeeping, budgets, deterministic transitions —
 * while consuming Context, Session, Memory and Workspace by opaque reference
 * only and refusing to become an engine, a shell or a privilege escalation.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  AGENT_MACHINE_CONTRACT,
  AGENT_MACHINE_CONTRACT_VERSION,
  AGENT_MACHINE_EXECUTOR_KINDS,
  AGENT_MACHINE_FIELDS,
  AGENT_MACHINE_LIMITS,
  AGENT_MACHINE_LIFECYCLE,
  AGENT_MACHINE_LIFECYCLE_STATES,
  AGENT_MACHINE_OPERATIONS,
  AGENT_MACHINE_PERMISSIONS,
  AGENT_MACHINE_STEP_OUTCOMES,
  AgentMachineError,
  InMemoryAgentMachineProvider,
  createAgentMachineManager,
  createAgentMachineProvider,
} from '../src/lego/agent-machine.mjs';
import { loadRegistry } from '../src/lego/registry.mjs';

const manifest = JSON.parse(readFileSync(new URL('../src/lego/manifest/agent-machine.json', import.meta.url), 'utf8'));
const registry = loadRegistry({ reload: true });
const BUDGETS = { maxSteps: 4, maxDurationMs: 600000, maxContinuationBytes: 64, maxReferences: 8 };
const fresh = (options = {}) => createAgentMachineManager({
  now: (() => {
    let tick = 0;
    return () => `2026-09-22T00:00:0${tick++ % 10}.000Z`;
  })(),
  ...options,
});
const create = (manager, machineId, extra = {}) => manager.create({
  machineId,
  taskId: `task-${machineId}`,
  budgets: { ...BUDGETS },
  metadata: { label: machineId },
  ...extra,
});
const start = (manager, machineId, version = 1) => manager.start({ machineId, expectedVersion: version });
const step = (manager, machineId, version, stepId, sequence, result, extra = {}) => manager.step({
  machineId, expectedVersion: version, stepId, sequence, result, ...extra,
});
const codeOf = (error) => (error instanceof AgentMachineError ? error.code : null);

/* -------------------------------------------------------------- contract */

test('the contract has one identity, version and bounded published surface', () => {
  assert.equal(AGENT_MACHINE_CONTRACT.id, 'ai.agent-machine');
  assert.equal(AGENT_MACHINE_CONTRACT_VERSION, '1.0.0');
  assert.equal(AGENT_MACHINE_CONTRACT.owner, 'manager');
  assert.deepEqual([...AGENT_MACHINE_OPERATIONS], [
    'agentMachine.create', 'agentMachine.describe', 'agentMachine.start',
    'agentMachine.step', 'agentMachine.pause', 'agentMachine.resume', 'agentMachine.cancel',
  ]);
  assert.deepEqual([...AGENT_MACHINE_PERMISSIONS], ['ai:agent:create', 'ai:agent:invoke', 'ai:agent:control', 'ai:agent:read']);
  assert.deepEqual([...AGENT_MACHINE_LIFECYCLE_STATES], [
    'created', 'running', 'waiting', 'paused', 'completed', 'failed', 'cancelled',
  ]);
  assert.deepEqual([...AGENT_MACHINE_STEP_OUTCOMES], ['succeeded', 'failed', 'cancelled', 'approval-required']);
  assert.deepEqual([...AGENT_MACHINE_EXECUTOR_KINDS], ['IN_MEMORY', 'EXTERNAL']);
  assert.deepEqual([...AGENT_MACHINE_FIELDS].sort(), [
    'budgets', 'contextReference', 'createdAt', 'executorKind', 'failure', 'lifecycle',
    'machineId', 'metadata', 'sessionReference', 'stepCount', 'steps', 'taskId', 'updatedAt',
    'version', 'workspaceReference',
  ]);
  assert.equal(manifest.contract, AGENT_MACHINE_CONTRACT.id);
  assert.equal(manifest.version, AGENT_MACHINE_CONTRACT_VERSION);
  assert.equal(manifest.status, 'implemented');
  assert.equal(manifest.operations.length, 7);
  assert.equal(manifest.permissions.includes('ai:agent:delegate'), false,
    'delegation is a later boundary and has no P2.16 permission');
  assert.equal(manifest.notScope.some((entry) => entry.includes('the agent loop')), true);
});

test('the lifecycle is the canonical agent vocabulary with fail-closed waiting', () => {
  assert.equal(AGENT_MACHINE_LIFECYCLE.initial, 'created');
  assert.deepEqual([...AGENT_MACHINE_LIFECYCLE.terminal], ['completed', 'failed', 'cancelled']);
  for (const state of AGENT_MACHINE_LIFECYCLE_STATES) {
    assert.ok(AGENT_MACHINE_LIFECYCLE.transitions[state], `${state} declares its exits`);
  }
  assert.deepEqual([...AGENT_MACHINE_LIFECYCLE.transitions.waiting], ['cancelled'],
    'waiting has exactly one exit: cancel (approval resolution is the ai.approval boundary)');
  assert.deepEqual([...AGENT_MACHINE_LIFECYCLE.transitions.completed], []);
  assert.deepEqual([...AGENT_MACHINE_LIFECYCLE.transitions.failed], []);
  assert.deepEqual([...AGENT_MACHINE_LIFECYCLE.transitions.cancelled], []);
});

test('budgets are bounded and unlimited is not a value', () => {
  assert.equal(AGENT_MACHINE_LIMITS.maxSteps, 64);
  assert.equal(AGENT_MACHINE_LIMITS.maxDurationMs, 10 * 60 * 1000);
  assert.equal(AGENT_MACHINE_LIMITS.maxContinuationBytes, 64 * 1024);
  assert.equal(AGENT_MACHINE_LIMITS.maxReferences, 8);
  for (const value of Object.values(AGENT_MACHINE_LIMITS)) {
    assert.ok(Number.isFinite(value) && value > 0, 'every ceiling is a positive finite number');
  }
});

test('the registry locks the contract exactly once and the capability matches the contract', () => {
  const rows = registry.contractLock.contracts.filter((contract) => contract.id === 'ai.agent-machine');
  assert.equal(rows.length, 1, 'exactly one locked ai.agent-machine row');
  assert.equal(rows[0].version, '1.0.0');
  assert.equal(rows[0].domain, 'ai-foundation');
  assert.equal(rows[0].status, 'implemented');
  const domain = registry.byId.get('ai-foundation');
  assert.ok(domain.paths.includes('src/lego/agent-machine.mjs'), 'the module is claimed by one domain');
  assert.ok(domain.paths.includes('src/lego/manifest/agent-machine.json'), 'the manifest is claimed by one domain');
  assert.ok(domain.public.includes('src/lego/agent-machine.mjs'));
  const capability = domain.capabilities.find((entry) => entry.id === 'ai.agent-machine');
  assert.ok(capability, 'the capability registry declares ai.agent-machine');
  assert.equal(capability.status, 'implemented');
  assert.deepEqual(capability.operations.map((entry) => `agentMachine.${entry.name}`), [...AGENT_MACHINE_OPERATIONS]);
  assert.deepEqual(capability.permissions, [...AGENT_MACHINE_PERMISSIONS]);
  assert.equal(capability.availability, 'available');
});

test('the provider seam is bounded and explicit, and nothing executes work in it', () => {
  const provider = createAgentMachineProvider();
  assert.ok(provider instanceof InMemoryAgentMachineProvider);
  assert.equal(provider.supports('IN_MEMORY'), true);
  assert.equal(provider.supports('EXTERNAL'), false);
  assert.equal(provider.size, 0);
  const manager = fresh();
  assert.deepEqual(
    Object.keys(manager).filter((key) => typeof manager[key] === 'function'),
    ['create', 'describe', 'start', 'step', 'pause', 'resume', 'cancel', 'clear'],
  );
  for (const forbidden of ['execute', 'run', 'invoke', 'spawn', 'shell', 'send', 'stream', 'artifact', 'close', 'delegate']) {
    assert.equal(typeof manager[forbidden], 'undefined', `no ${forbidden} authority is published`);
  }
});

/* ------------------------------------------------------------- lifecycle */

test('the valid lifecycle path reaches each terminal state deterministically', () => {
  const manager = fresh();
  create(manager, 'am-completed');
  assert.equal(start(manager, 'am-completed').lifecycle, 'running');
  const done = step(manager, 'am-completed', 2, 's1', 1, { outcome: 'succeeded', final: true });
  assert.equal(done.lifecycle, 'completed');

  create(manager, 'am-failed');
  start(manager, 'am-failed');
  const failed = step(manager, 'am-failed', 2, 's1', 1, { outcome: 'failed', errorReference: 'err:1' });
  assert.equal(failed.lifecycle, 'failed');
  assert.deepEqual(failed.failure, { code: 'step-failed', stepId: 's1', errorReference: 'err:1' });

  create(manager, 'am-cancelled');
  start(manager, 'am-cancelled');
  assert.equal(manager.cancel({ machineId: 'am-cancelled', expectedVersion: 2 }).lifecycle, 'cancelled');
});

test('invalid transitions fail closed with a stable error', () => {
  const manager = fresh();
  create(manager, 'am-x');
  // pause/resume are not valid from created.
  for (const operation of ['pause', 'resume']) {
    assert.throws(
      () => manager[operation]({ machineId: 'am-x', expectedVersion: 1 }),
      (error) => codeOf(error) === 'lego.interaction_mismatch',
      `${operation} from created must fail`,
    );
  }
  start(manager, 'am-x');
  // start from running is the idempotent no-op, not an error.
  assert.equal(manager.start({ machineId: 'am-x', expectedVersion: 2 }).lifecycle, 'running');
  // cancel from running is valid.
  const cancelled = manager.cancel({ machineId: 'am-x', expectedVersion: 2 });
  assert.equal(cancelled.lifecycle, 'cancelled');
  // terminal machines accept no mutation other than the idempotent cancel.
  assert.equal(manager.cancel({ machineId: 'am-x', expectedVersion: 3 }).lifecycle, 'cancelled');
  for (const operation of ['start', 'pause', 'resume']) {
    assert.throws(
      () => manager[operation]({ machineId: 'am-x', expectedVersion: 3 }),
      (error) => codeOf(error) === 'lego.interaction_mismatch',
      `${operation} on a terminal machine must fail`,
    );
  }
  assert.throws(
    () => step(manager, 'am-x', 3, 's1', 1, { outcome: 'succeeded' }),
    (error) => codeOf(error) === 'lego.interaction_mismatch',
    'a step after cancellation must fail',
  );
});

test('unknown identities fail closed for mutations and resolve to null for reads', () => {
  const manager = fresh();
  assert.equal(manager.describe({ machineId: 'am-ghost' }), null);
  for (const call of [
    () => start(manager, 'am-ghost', 1),
    () => manager.pause({ machineId: 'am-ghost', expectedVersion: 1 }),
    () => manager.resume({ machineId: 'am-ghost', expectedVersion: 1 }),
    () => manager.cancel({ machineId: 'am-ghost', expectedVersion: 1 }),
    () => step(manager, 'am-ghost', 1, 's1', 1, { outcome: 'succeeded' }),
  ]) {
    assert.throws(call, (error) => codeOf(error) === 'storage.not_found');
  }
});

/* ------------------------------------------------------------- execution */

test('a step is one bounded record with identity, sequence, references and budget', () => {
  const manager = createAgentMachineManager({ now: () => '2026-09-22T00:00:00.000Z' });
  manager.create({ machineId: 'am-step', taskId: 'task-am-step', budgets: { ...BUDGETS }, metadata: { label: 'am-step' }, sessionReference: 'sess-1', contextReference: 'ctx-1', workspaceReference: 'ws-1' });
  const started = start(manager, 'am-step');
  const record = step(manager, 'am-step', started.version, 's1', 1, {
    outcome: 'succeeded',
    final: true,
    resultReference: 'res:1',
    continuation: 'bounded-state',
  }, { inputReference: 'ctx-1:load' });
  assert.equal(record.lifecycle, 'completed');
  assert.equal(record.stepCount, 1);
  assert.deepEqual(record.steps, [{
    stepId: 's1',
    sequence: 1,
    inputReference: 'ctx-1:load',
    approvalReference: null,
    outcome: 'succeeded',
    final: true,
    resultReference: 'res:1',
    errorReference: null,
    continuation: 'bounded-state',
    recordedAt: record.updatedAt,
  }]);
});

test('step sequencing is explicit: stale, out-of-order and duplicate steps are conflicts', () => {
  const manager = fresh();
  create(manager, 'am-seq');
  start(manager, 'am-seq');
  step(manager, 'am-seq', 2, 's1', 1, { outcome: 'succeeded' });
  assert.throws(
    () => step(manager, 'am-seq', 3, 's2', 1, { outcome: 'succeeded' }),
    (error) => codeOf(error) === 'storage.conflict' && error.details.expectedSequence === 2,
    'reusing sequence 1 must be a conflict',
  );
  assert.throws(
    () => step(manager, 'am-seq', 3, 's3', 3, { outcome: 'succeeded' }),
    (error) => codeOf(error) === 'storage.conflict',
    'skipping ahead must be a conflict',
  );
  step(manager, 'am-seq', 3, 's2', 2, { outcome: 'succeeded' });
  assert.throws(
    () => step(manager, 'am-seq', 4, 's2', 3, { outcome: 'succeeded' }),
    (error) => codeOf(error) === 'storage.conflict',
    'a duplicate stepId must be a conflict',
  );
});

test('budget exhaustion is a stable error and a stable terminal failure', () => {
  const manager = fresh();
  create(manager, 'am-budget', { budgets: { ...BUDGETS, maxSteps: 1 } });
  start(manager, 'am-budget');
  step(manager, 'am-budget', 2, 's1', 1, { outcome: 'succeeded' });
  assert.throws(
    () => step(manager, 'am-budget', 3, 's2', 2, { outcome: 'succeeded' }),
    (error) => codeOf(error) === 'lego.contract_violation' && error.details.budget === 'maxSteps',
  );
  const exhausted = manager.describe({ machineId: 'am-budget' });
  assert.equal(exhausted.lifecycle, 'failed');
  assert.deepEqual(exhausted.failure, { code: 'budget-exhausted', budget: 'maxSteps', stepId: 's2' });
});

test('the duration budget bounds the execution window', () => {
  let tick = 0;
  const manager = createAgentMachineManager({
    now: () => `2026-09-22T00:00:${String(tick).padStart(2, '0')}.000Z`,
    limits: { ...AGENT_MACHINE_LIMITS },
  });
  manager.create({ machineId: 'am-dur', taskId: 't', budgets: { ...BUDGETS, maxDurationMs: 1000 } });
  manager.start({ machineId: 'am-dur', expectedVersion: 1 });
  tick = 5; // 5 seconds later: beyond the 1 second budget
  assert.throws(
    () => manager.step({ machineId: 'am-dur', expectedVersion: 2, stepId: 's1', sequence: 1, result: { outcome: 'succeeded' } }),
    (error) => codeOf(error) === 'lego.contract_violation' && error.details.budget === 'maxDurationMs',
  );
  assert.equal(manager.describe({ machineId: 'am-dur' }).failure.code, 'budget-exhausted');
});

test('continuation size and per-step reference counts are bounded', () => {
  const manager = fresh();
  create(manager, 'am-continuation', { budgets: { ...BUDGETS, maxContinuationBytes: 8 } });
  start(manager, 'am-continuation');
  assert.throws(
    () => step(manager, 'am-continuation', 2, 's1', 1, { outcome: 'succeeded', continuation: 'longer than eight bytes' }),
    (error) => codeOf(error) === 'lego.contract_violation' && /continuation/.test(error.message),
  );
  create(manager, 'am-refs', { budgets: { ...BUDGETS, maxReferences: 3 } });
  start(manager, 'am-refs');
  assert.throws(
    () => step(manager, 'am-refs', 2, 's1', 1, {
      outcome: 'succeeded', resultReference: 'r:1', errorReference: 'r:2',
    }, { inputReference: 'r:3', approvalReference: 'r:4' }),
    (error) => codeOf(error) === 'lego.contract_violation' && /reference budget/.test(error.message),
  );
});

test('budget declarations are validated at create and clamped to the ceilings', () => {
  const manager = fresh();
  for (const budgets of [
    {},
    { maxSteps: 0 },
    { maxSteps: -1 },
    { maxSteps: 1.5 },
    { maxSteps: 'many' },
    { maxSteps: AGENT_MACHINE_LIMITS.maxSteps + 1 },
    { maxDurationMs: 1, maxContinuationBytes: 1, maxReferences: 1, unknown: 1 },
  ]) {
    assert.throws(() => create(manager, 'am-bad-budget', { budgets }), (error) => codeOf(error) === 'lego.contract_violation');
  }
  create(manager, 'am-clamped', { budgets: { maxSteps: AGENT_MACHINE_LIMITS.maxSteps, maxDurationMs: AGENT_MACHINE_LIMITS.maxDurationMs, maxContinuationBytes: AGENT_MACHINE_LIMITS.maxContinuationBytes, maxReferences: AGENT_MACHINE_LIMITS.maxReferences } });
  assert.equal(manager.describe({ machineId: 'am-clamped' }).budgets.maxSteps, AGENT_MACHINE_LIMITS.maxSteps);
});

test('an approval-required step is fail-closed: reference mandatory, waiting bounded', () => {
  const manager = fresh();
  create(manager, 'am-approval');
  start(manager, 'am-approval');
  assert.throws(
    () => step(manager, 'am-approval', 2, 's1', 1, { outcome: 'approval-required' }),
    (error) => codeOf(error) === 'lego.contract_violation' && /approvalReference/.test(error.message),
  );
  const waiting = step(manager, 'am-approval', 2, 's1', 1, { outcome: 'approval-required' }, { approvalReference: 'approval-1' });
  assert.equal(waiting.lifecycle, 'waiting');
  assert.equal(waiting.steps[0].approvalReference, 'approval-1');
  for (const operation of ['pause', 'resume', 'start']) {
    assert.throws(
      () => manager[operation]({ machineId: 'am-approval', expectedVersion: 3 }),
      (error) => codeOf(error) === 'lego.interaction_mismatch',
      `${operation} from waiting must fail`,
    );
  }
  const cancelled = manager.cancel({ machineId: 'am-approval', expectedVersion: 3 });
  assert.equal(cancelled.lifecycle, 'cancelled');
});

test('a step outcome is recorded data, not an error: failure is never faked into success', () => {
  const manager = fresh();
  create(manager, 'am-outcome');
  start(manager, 'am-outcome');
  const failed = step(manager, 'am-outcome', 2, 's1', 1, { outcome: 'failed', errorReference: 'err:1' });
  assert.equal(failed.lifecycle, 'failed');
  assert.equal(failed.failure.code, 'step-failed');
  assert.equal(failed.steps[0].outcome, 'failed');
  const cancelled = create(manager, 'am-outcome-2');
  start(manager, 'am-outcome-2');
  const reportedCancel = step(manager, 'am-outcome-2', 2, 's1', 1, { outcome: 'cancelled' });
  assert.equal(reportedCancel.lifecycle, 'cancelled');
});

/* ------------------------------------------------------ context / session */

test('Context and Session are held as opaque references, never redefined or driven', () => {
  const manager = fresh();
  const record = create(manager, 'am-refs', {
    sessionReference: 'sess-1',
    contextReference: 'ctx-1',
    workspaceReference: 'ws-1',
  });
  assert.equal(record.sessionReference, 'sess-1');
  assert.equal(record.contextReference, 'ctx-1');
  assert.equal(record.workspaceReference, 'ws-1');
  // references are validated, never dereferenced: the machine knows nothing of their lifecycles
  const surface = JSON.stringify(Object.keys(record));
  for (const foreign of ['contextLifecycle', 'sessionLifecycle', 'workspaceLifecycle', 'memory', 'transcript']) {
    assert.ok(!surface.includes(foreign), `no ${foreign} state is absorbed`);
  }
  for (const bad of ['../escape', '/host/path', 'x'.repeat(AGENT_MACHINE_LIMITS.maxReferenceIdLength + 1), '']) {
    assert.throws(
      () => create(manager, `am-bad-ref-${bad.length}-${bad.slice(0, 1)}`, { sessionReference: bad, contextReference: bad, workspaceReference: bad }),
      (error) => codeOf(error) === 'lego.contract_violation',
      `reference ${JSON.stringify(bad)} must fail closed`,
    );
  }
  // absent references are the explicit null, never an empty string
  const absent = create(manager, 'am-no-refs');
  assert.equal(absent.sessionReference, null);
  assert.equal(absent.contextReference, null);
  assert.equal(absent.workspaceReference, null);
});

test('Memory stays out of execution bookkeeping entirely', () => {
  const manager = fresh();
  const record = create(manager, 'am-no-memory');
  const surface = JSON.stringify(record);
  for (const word of ['memoryId', 'remember', 'recall', 'forget', 'memoryScope']) {
    assert.ok(!surface.includes(word), `no ${word} in the execution foundation`);
  }
  const moduleSource = readFileSync(new URL('../src/lego/agent-machine.mjs', import.meta.url), 'utf8');
  assert.ok(!/import\s+[\s\S]*?from\s+['"]\.\/(memory|context|agent-session|workspace)\.mjs['"]/.test(moduleSource),
    'Agent Machine imports no other AI contract module: references are opaque strings, not dependencies');
});

/* ------------------------------------------------------------- isolation */

test('machine A can never return or mutate machine B', () => {
  const manager = fresh();
  create(manager, 'am-a', { metadata: { who: 'a' } });
  create(manager, 'am-b', { metadata: { who: 'b' } });
  start(manager, 'am-a');
  const a = manager.describe({ machineId: 'am-a' });
  const b = manager.describe({ machineId: 'am-b' });
  assert.equal(a.metadata.who, 'a');
  assert.equal(b.metadata.who, 'b');
  assert.equal(a.lifecycle, 'running');
  assert.equal(b.lifecycle, 'created');
  // a step reported against A with A's version cannot touch B's state
  step(manager, 'am-a', a.version, 's1', 1, { outcome: 'succeeded' });
  const bAfter = manager.describe({ machineId: 'am-b' });
  assert.equal(bAfter.lifecycle, 'created');
  assert.equal(bAfter.stepCount, 0);
  assert.equal(bAfter.version, b.version);
});

test('identities are exact: a near-identical machineId is a different, absent identity', () => {
  const manager = fresh();
  create(manager, 'am-task-1');
  assert.ok(manager.describe({ machineId: 'am-task-1' }), 'the exact identity resolves');
  assert.equal(manager.describe({ machineId: 'am-task-1' }).taskId, 'task-am-task-1');
  assert.equal(manager.describe({ machineId: 'am-task-2' }), null, 'a different identity is absent, never a fallback');
});

test('two managers over two providers are fully isolated', () => {
  const one = fresh();
  const two = fresh();
  create(one, 'shared-id', { metadata: { side: 'one' } });
  create(two, 'shared-id', { metadata: { side: 'two' } });
  assert.equal(one.describe({ machineId: 'shared-id' }).metadata.side, 'one');
  assert.equal(two.describe({ machineId: 'shared-id' }).metadata.side, 'two');
  assert.equal(one.count, 1);
  assert.equal(two.count, 1);
});

/* ----------------------------------------------------------- determinism */

test('same valid input produces a stable result; same invalid transition a stable error', () => {
  const run = () => {
    const manager = fresh();
    create(manager, 'am-deterministic');
    const started = start(manager, 'am-deterministic');
    const done = step(manager, 'am-deterministic', started.version, 's1', 1, { outcome: 'succeeded', final: true });
    return JSON.stringify({ lifecycle: done.lifecycle, version: done.version, steps: done.steps.length });
  };
  assert.equal(run(), run(), 'two identical executions book the identical state');
  const manager = fresh();
  create(manager, 'am-deterministic');
  const invalid = () => manager.pause({ machineId: 'am-deterministic', expectedVersion: 1 });
  let first = null;
  let second = null;
  try { invalid(); } catch (error) { first = codeOf(error); }
  try { invalid(); } catch (error) { second = codeOf(error); }
  assert.equal(first, 'lego.interaction_mismatch');
  assert.equal(first, second, 'the same invalid transition always produces the same stable error');
});

test('optimistic concurrency: a stale expectedVersion is a deterministic conflict', () => {
  const manager = fresh();
  create(manager, 'am-version');
  start(manager, 'am-version');
  assert.throws(
    () => manager.pause({ machineId: 'am-version', expectedVersion: 1 }),
    (error) => codeOf(error) === 'storage.conflict' && error.details.actual === 2 && error.details.expected === 1,
  );
  assert.equal(manager.describe({ machineId: 'am-version' }).lifecycle, 'running', 'the stale caller changed nothing');
  const paused = manager.pause({ machineId: 'am-version', expectedVersion: 2 });
  assert.equal(paused.lifecycle, 'paused');
});

test('duplicate idempotent operations are stable no-ops', () => {
  const manager = fresh();
  create(manager, 'am-idempotent');
  const started = start(manager, 'am-idempotent');
  assert.equal(manager.start({ machineId: 'am-idempotent', expectedVersion: 99 }).lifecycle, 'running');
  const paused = manager.pause({ machineId: 'am-idempotent', expectedVersion: started.version });
  assert.equal(manager.pause({ machineId: 'am-idempotent', expectedVersion: 99 }).lifecycle, 'paused');
  const resumed = manager.resume({ machineId: 'am-idempotent', expectedVersion: paused.version });
  assert.equal(manager.resume({ machineId: 'am-idempotent', expectedVersion: 99 }).lifecycle, 'running');
  const cancelled = manager.cancel({ machineId: 'am-idempotent', expectedVersion: resumed.version });
  assert.equal(manager.cancel({ machineId: 'am-idempotent', expectedVersion: 99 }).lifecycle, 'cancelled');
});

/* ------------------------------------------------------- validation rules */

test('identities, kinds and metadata fail closed', () => {
  const manager = fresh();
  for (const machineId of ['', 'bad id', '/host/path', 'x'.repeat(AGENT_MACHINE_LIMITS.maxIdentifierLength + 1), null]) {
    assert.throws(
      () => create(manager, machineId),
      (error) => codeOf(error) === 'lego.contract_violation',
      `machineId ${String(machineId)} must fail closed`,
    );
  }
  assert.throws(() => create(manager, 'am-kind', { executorKind: 'SHELL' }), (error) => codeOf(error) === 'lego.contract_violation');
  assert.throws(() => create(manager, 'am-meta', { metadata: { command: 'rm -rf /' } }), (error) => /forbidden/.test(error.message));
  assert.throws(() => create(manager, 'am-meta-2', { metadata: { token: 'abc' } }), (error) => /forbidden/.test(error.message));
  assert.throws(
    () => create(manager, 'am-meta-3', { metadata: { a: { b: { c: { d: { e: 'deep' } } } } } }),
    (error) => codeOf(error) === 'lego.contract_violation',
  );
});

test('the store is bounded: the machine ceiling is enforced deterministically', () => {
  const manager = fresh({ limits: { ...AGENT_MACHINE_LIMITS, maxMachines: 2 } });
  create(manager, 'am-fill-1');
  create(manager, 'am-fill-2');
  assert.throws(
    () => create(manager, 'am-fill-3'),
    (error) => codeOf(error) === 'lego.contract_violation' && /bounded machine limit/.test(error.message),
  );
  assert.equal(manager.count, 2);
});

test('an unsupported executor kind is unavailable, not silently coerced', () => {
  const manager = fresh();
  assert.throws(
    () => create(manager, 'am-external', { executorKind: 'EXTERNAL' }),
    (error) => codeOf(error) === 'lego.unavailable',
    'the default provider supports IN_MEMORY only',
  );
  const custom = new InMemoryAgentMachineProvider();
  custom.supports = (kind) => kind === 'EXTERNAL';
  const externalManager = fresh({ provider: custom });
  const external = create(externalManager, 'am-external', { executorKind: 'EXTERNAL' });
  assert.equal(external.executorKind, 'EXTERNAL', 'an explicit provider may serve a declared kind');
  assert.throws(
    () => create(externalManager, 'am-in-memory', { executorKind: 'IN_MEMORY' }),
    (error) => codeOf(error) === 'lego.unavailable',
  );
});

test('a provider missing the seam surface is refused', () => {
  assert.throws(
    () => createAgentMachineManager({ provider: { put() {}, get() {} } }),
    (error) => codeOf(error) === 'lego.contract_violation',
  );
});

test('the manifest, module and lock tell one story', () => {
  assert.deepEqual(manifest.lifecycle.states, [...AGENT_MACHINE_LIFECYCLE_STATES]);
  assert.deepEqual(manifest.lifecycle.transitions.created, [...AGENT_MACHINE_LIFECYCLE.transitions.created]);
  assert.deepEqual(manifest.lifecycle.transitions.waiting, [...AGENT_MACHINE_LIFECYCLE.transitions.waiting]);
  assert.deepEqual(manifest.operations.map((entry) => entry.name), [...AGENT_MACHINE_OPERATIONS]);
  assert.deepEqual(manifest.permissions, [...AGENT_MACHINE_PERMISSIONS]);
  assert.deepEqual(manifest.limits, AGENT_MACHINE_LIMITS);
  assert.equal(manifest.approvalBoundary.contract, 'ai.approval');
  assert.equal(manifest.ownership.domain, 'ai-foundation');
});
