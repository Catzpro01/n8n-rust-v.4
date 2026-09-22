/**
 * Agent Machine LEGO — bounded execution foundation (P2.16).
 *
 * PUBLIC CONTRACT: ai.agent-machine@1.0.0 (owner: manager).
 *
 * This module owns one canonical Agent Machine contract: the bounded identity,
 * lifecycle, step bookkeeping, budgets and deterministic state transitions of a
 * controlled agent execution. It consumes the established ai.context,
 * ai.agent-session, ai.memory and ai.workspace contracts by REFERENCE ONLY —
 * it holds opaque references and never redefines or drives their lifecycles.
 *
 * It is a foundation, not an engine: nothing here executes a step. Steps are
 * bounded, caller-reported records validated against identity, sequence,
 * budget and lifecycle rules. A replaceable executor/provider seam
 * (`InMemoryAgentMachineProvider` default) owns record storage; a future
 * executor satisfies the same contract without changing this module.
 *
 * Deliberately absent: the agent loop, model inference, tool execution,
 * delegation, parallelism, shell, filesystem, process, MCP, credentials and
 * Rust. Those belong to later milestones and other contracts.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(HERE, "manifest", "agent-machine.json");

const MANIFEST = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

export const AGENT_MACHINE_CONTRACT = Object.freeze({
  id: "ai.agent-machine",
  version: '1.0.0',
  owner: 'manager',
  fields: Object.freeze([
    'machineId', 'taskId', 'executorKind', 'lifecycle',
    'sessionReference', 'contextReference', 'workspaceReference',
    'budgets', 'metadata', 'steps', 'stepCount', 'failure',
    'version', 'createdAt', 'updatedAt',
  ]),
});

export const AGENT_MACHINE_CONTRACT_VERSION = AGENT_MACHINE_CONTRACT.version;

/**
 * Executor kinds are DECLARATIONS, not authority. The provider must explicitly
 * support the requested kind; the core never infers shell, filesystem, process
 * or remote execution from it. IN_MEMORY is the bounded default; EXTERNAL
 * names a replaceable external executor without selecting one.
 */
export const AGENT_MACHINE_EXECUTOR_KINDS = Object.freeze(['IN_MEMORY', 'EXTERNAL']);

/**
 * Lifecycle vocabulary is the canonical agent vocabulary already declared by
 * the AI set and used by ai.agent-session@1.0.0. Waiting is entered only by an
 * approval-required step and left only by cancel: approval RESOLUTION is the
 * ai.approval contract's boundary, not this one, and fail-closed means an
 * unresolved approval never advances the machine.
 */
export const AGENT_MACHINE_LIFECYCLE = Object.freeze({
  states: Object.freeze(['created', 'running', 'waiting', 'paused', 'completed', 'failed', 'cancelled']),
  initial: 'created',
  terminal: Object.freeze(['completed', 'failed', 'cancelled']),
  transitions: Object.freeze({
    created: Object.freeze(['running', 'cancelled']),
    running: Object.freeze(['waiting', 'paused', 'completed', 'failed', 'cancelled']),
    waiting: Object.freeze(['cancelled']),
    paused: Object.freeze(['running', 'cancelled']),
    completed: Object.freeze([]),
    failed: Object.freeze([]),
    cancelled: Object.freeze([]),
  }),
});

export const AGENT_MACHINE_LIFECYCLE_STATES = AGENT_MACHINE_LIFECYCLE.states;

/**
 * Exactly seven published operations. start/step carry ai:agent:invoke because
 * they advance execution state; pause/resume/cancel carry ai:agent:control;
 * describe carries ai:agent:read; create carries ai:agent:create. There is no
 * ai:agent:delegate permission in P2.16 (delegation is a later boundary) and
 * no stream/send/artifact/close operation (those belong to the future
 * ai.agent-runtime full loop, which builds on this foundation).
 */
export const AGENT_MACHINE_OPERATIONS = Object.freeze([
  "agentMachine.create",
  "agentMachine.describe",
  "agentMachine.start",
  "agentMachine.step",
  "agentMachine.pause",
  "agentMachine.resume",
  "agentMachine.cancel",
]);

export const AGENT_MACHINE_PERMISSIONS = Object.freeze([
  'ai:agent:create',
  'ai:agent:invoke',
  'ai:agent:control',
  'ai:agent:read',
]);

/**
 * Step outcomes: what a bounded step report may say happened. `succeeded`
 * ends the machine only when the step is final; `failed` and `cancelled` are
 * terminal; `approval-required` moves the machine to waiting and MUST carry
 * an approvalReference (fail-closed: an approval requirement with no
 * reference to the ai.approval record that gates it is invalid input).
 */
export const AGENT_MACHINE_STEP_OUTCOMES = Object.freeze([
  'succeeded',
  'failed',
  'cancelled',
  'approval-required',
]);

export const AGENT_MACHINE_FIELDS = AGENT_MACHINE_CONTRACT.fields;

/**
 * Global bounds. Per-machine budgets are declared at create and clamped to
 * these: an execution can never exceed them, and budget exhaustion is a
 * stable terminal condition (failure code budget-exhausted), never an
 * unbounded continuation.
 */
export const AGENT_MACHINE_LIMITS = Object.freeze({
  maxMachines: 256,
  maxIdentifierLength: 64,
  maxReferenceIdLength: 128,
  maxMetadataBytes: 16 * 1024,
  maxMetadataKeys: 32,
  maxMetadataDepth: 4,
  maxMetadataKeyLength: 64,
  maxSteps: 64,
  maxDurationMs: 10 * 60 * 1000,
  maxContinuationBytes: 64 * 1024,
  maxReferences: 8,
});

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const REFERENCE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const FORBIDDEN_KEY = /(?:credential|secret|password|token|cookie|authorization|api[-_]?key|private[-_]?key|host[-_]?path|filesystem|terminal|process|command|shell|mcp|runtime|provider)/i;

export class AgentMachineError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AgentMachineError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(message, details = {}) {
  throw new AgentMachineError('lego.contract_violation', message, details);
}

function notFound(machineId) {
  throw new AgentMachineError('storage.not_found', `agent machine '${machineId}' does not exist`, { machineId });
}

function conflict(message, details = {}) {
  throw new AgentMachineError('storage.conflict', message, details);
}

function unavailable(message, details = {}) {
  throw new AgentMachineError('lego.unavailable', message, details);
}

function transition(message, details = {}) {
  throw new AgentMachineError('lego.interaction_mismatch', message, details);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function stableJson(value) {
  return JSON.stringify(value);
}

function bytes(value) {
  return Buffer.byteLength(stableJson(value), 'utf8');
}

function iso(now) {
  const value = now();
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail('now() must return an ISO timestamp');
  return value;
}

function assertPlainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field} must be a plain object`);
}

function assertId(value, field, pattern = ID_RE, max = AGENT_MACHINE_LIMITS.maxIdentifierLength) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || !pattern.test(value)) {
    fail(`${field} must be an opaque identifier matching ${pattern} and be 1..${max} characters`);
  }
}

function assertReference(value, field, limits) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > limits.maxReferenceIdLength || !REFERENCE_ID_RE.test(value)) {
    fail(`${field} must be an opaque reference of 1..${limits.maxReferenceIdLength} characters`);
  }
  return value;
}

function validateJsonValue(value, path, depth, limits, seen = new Set()) {
  if (depth > limits.maxMetadataDepth) fail(`${path} exceeds metadata nesting depth ${limits.maxMetadataDepth}`, { limit: limits.maxMetadataDepth });
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${path} contains a non-finite number`);
    return;
  }
  if (typeof value !== 'object') fail(`${path} contains unsupported value type '${typeof value}'`);
  if (seen.has(value)) fail(`${path} contains a cyclic value`);
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) validateJsonValue(value[i], `${path}[${i}]`, depth + 1, limits, seen);
  } else {
    const keys = Object.keys(value);
    if (keys.length > limits.maxMetadataKeys) fail(`${path} exceeds metadata key limit ${limits.maxMetadataKeys}`, { limit: limits.maxMetadataKeys });
    for (const key of keys) {
      if (key.length === 0 || key.length > limits.maxMetadataKeyLength) fail(`${path} has a metadata key longer than ${limits.maxMetadataKeyLength} characters`);
      if (FORBIDDEN_KEY.test(key)) fail(`${path}.${key} is forbidden: Agent Machine metadata cannot carry authority, credentials or runtime handles`);
      validateJsonValue(value[key], `${path}.${key}`, depth + 1, limits, seen);
    }
  }
  seen.delete(value);
}

function validateMetadata(metadata, limits) {
  assertPlainObject(metadata, 'metadata');
  validateJsonValue(metadata, 'metadata', 0, limits);
  const safe = clone(metadata);
  const size = bytes(safe);
  if (size > limits.maxMetadataBytes) fail(`metadata exceeds ${limits.maxMetadataBytes} bytes`, { size, limit: limits.maxMetadataBytes });
  return safe;
}

function validateBudgets(budgets, limits) {
  assertPlainObject(budgets, 'budgets');
  const entries = Object.entries(budgets);
  if (entries.length === 0) fail('budgets must declare at least one bounded dimension');
  const declared = {
    maxSteps: 0,
    maxDurationMs: 0,
    maxContinuationBytes: 0,
    maxReferences: 0,
  };
  for (const [key, value] of entries) {
    if (!Object.keys(declared).includes(key)) fail(`budgets declares unknown dimension '${key}'`);
    if (!Number.isInteger(value) || value <= 0) fail(`budgets.${key} must be a positive integer`);
    const ceiling = limits[key];
    if (value > ceiling) fail(`budgets.${key} exceeds the bounded ceiling ${ceiling}`, { value, limit: ceiling });
    declared[key] = value;
  }
  return Object.freeze(declared);
}

function assertLifecycleState(lifecycle) {
  if (!AGENT_MACHINE_LIFECYCLE_STATES.includes(lifecycle)) {
    fail(`lifecycle must be one of ${AGENT_MACHINE_LIFECYCLE_STATES.join(', ')}`);
  }
}

function assertStepOutcome(outcome) {
  if (!AGENT_MACHINE_STEP_OUTCOMES.includes(outcome)) {
    fail(`step result.outcome must be one of ${AGENT_MACHINE_STEP_OUTCOMES.join(', ')}`);
  }
}

function terminalOf(record) {
  return AGENT_MACHINE_LIFECYCLE.terminal.includes(record.lifecycle);
}

function publicMachine(record) {
  return freezeDeep(clone(record));
}

// ---------------------------------------------------------------------------
// Provider / executor seam
// ---------------------------------------------------------------------------

/**
 * Minimal provider seam. The provider stores opaque Agent Machine records
 * only: it never receives a step payload to execute, a command, a path, a
 * credential or a runtime handle. `supports(kind)` is mandatory so executor
 * capabilities cannot become implicit Agent Machine capabilities. The default
 * provider is bounded, in-memory and process-local — it claims no durability
 * and no execution.
 */
export class InMemoryAgentMachineProvider {
  constructor() {
    this.store = new Map();
  }

  supports(kind) {
    return kind === 'IN_MEMORY';
  }

  put(record) {
    this.store.set(record.machineId, clone(record));
  }

  get(machineId) {
    const record = this.store.get(machineId);
    return record ? clone(record) : null;
  }

  list() {
    return Array.from(this.store.values()).map(clone);
  }

  clear() {
    this.store.clear();
  }

  get size() {
    return this.store.size;
  }
}

function makeManager(options = {}) {
  const provider = options.provider ?? new InMemoryAgentMachineProvider();
  const now = options.now ?? (() => new Date().toISOString());
  const limits = Object.freeze({ ...AGENT_MACHINE_LIMITS, ...(options.limits ?? {}) });

  if (typeof provider.supports !== 'function' || typeof provider.put !== 'function'
    || typeof provider.get !== 'function' || typeof provider.list !== 'function') {
    fail('provider must implement { supports, put, get, list }');
  }

  function get(machineId) {
    assertId(machineId, 'machineId');
    return provider.get(machineId);
  }

  function load(machineId, operation) {
    const record = get(machineId);
    if (!record) notFound(machineId);
    assertLifecycleState(record.lifecycle);
    return record;
  }

  /** Optimistic concurrency: every mutation must name the version it read. */
  function assertVersion(record, input, operation) {
    const expected = input.expectedVersion;
    if (!Number.isInteger(expected) || expected < 1) {
      fail(`${operation} requires expectedVersion, the machine version the caller last read`);
    }
    if (expected !== record.version) {
      conflict(`${operation} received a stale expectedVersion: machine '${record.machineId}' is at version ${record.version}, the caller expected ${expected}`, {
        machineId: record.machineId,
        actual: record.version,
        expected,
      });
    }
  }

  function commit(record, timestamp) {
    const next = { ...record, version: record.version + 1, updatedAt: timestamp };
    provider.put(next);
    return next;
  }

  function assertKind(kind) {
    if (typeof kind !== 'string' || !AGENT_MACHINE_EXECUTOR_KINDS.includes(kind)) {
      fail(`executorKind must be one of ${AGENT_MACHINE_EXECUTOR_KINDS.join(', ')}`);
    }
  }

  function create(input) {
    assertPlainObject(input, 'create input');
    const {
      machineId,
      taskId,
      executorKind = 'IN_MEMORY',
      sessionReference,
      contextReference,
      workspaceReference,
      budgets,
      metadata = {},
    } = input;
    assertId(machineId, 'machineId');
    assertId(taskId, 'taskId');
    assertKind(executorKind);
    assertReference(sessionReference, 'sessionReference', limits);
    assertReference(contextReference, 'contextReference', limits);
    assertReference(workspaceReference, 'workspaceReference', limits);
    const safeBudgets = validateBudgets(budgets, limits);
    const safeMetadata = validateMetadata(metadata, limits);
    const existing = get(machineId);
    if (existing) conflict(`agent machine '${machineId}' already exists`, { machineId });
    if (provider.list().length >= limits.maxMachines) {
      fail('agent machine store has reached its bounded machine limit', { limit: limits.maxMachines });
    }
    if (!provider.supports(executorKind)) {
      unavailable(`provider does not support executor kind '${executorKind}'`, { executorKind });
    }
    const timestamp = iso(now);
    const record = {
      machineId,
      taskId,
      executorKind,
      lifecycle: 'created',
      sessionReference: sessionReference ?? null,
      contextReference: contextReference ?? null,
      workspaceReference: workspaceReference ?? null,
      budgets: safeBudgets,
      metadata: safeMetadata,
      steps: [],
      stepCount: 0,
      startedAt: null,
      failure: null,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    provider.put(record);
    return publicMachine(record);
  }

  function describe(input) {
    assertPlainObject(input, 'describe input');
    assertId(input.machineId, 'machineId');
    const record = get(input.machineId);
    return record ? publicMachine(record) : null;
  }

  function start(input) {
    assertPlainObject(input, 'start input');
    const record = load(input.machineId, 'start');
    // Idempotent: a running machine stays running.
    if (record.lifecycle === 'running') return publicMachine(record);
    assertVersion(record, input, 'agentMachine.start');
    if (terminalOf(record)) transition(`terminal agent machine '${record.machineId}' (${record.lifecycle}) cannot be started`, { machineId: record.machineId, lifecycle: record.lifecycle });
    if (record.lifecycle !== 'created') transition(`agent machine '${record.machineId}' cannot be started from '${record.lifecycle}'`, { machineId: record.machineId, lifecycle: record.lifecycle });
    const next = commit({ ...record, lifecycle: 'running', startedAt: iso(now) }, iso(now));
    return publicMachine(next);
  }

  function step(input) {
    assertPlainObject(input, 'step input');
    const record = load(input.machineId, 'step');
    if (record.lifecycle !== 'running') {
      transition(`agent machine '${record.machineId}' is '${record.lifecycle}'; a step is accepted only while running`, { machineId: record.machineId, lifecycle: record.lifecycle });
    }
    assertVersion(record, input, 'agentMachine.step');
    const {
      stepId,
      sequence,
      inputReference,
      approvalReference,
      result,
    } = input;
    assertId(stepId, 'stepId');
    if (record.steps.some((entry) => entry.stepId === stepId)) {
      conflict(`step '${stepId}' was already recorded for machine '${record.machineId}'`, { machineId: record.machineId, stepId });
    }
    const expectedSequence = record.stepCount + 1;
    if (!Number.isInteger(sequence) || sequence !== expectedSequence) {
      conflict(`step sequence must be ${expectedSequence} for machine '${record.machineId}'; a stale or duplicate submission is refused`, {
        machineId: record.machineId,
        expectedSequence,
        received: sequence ?? null,
      });
    }
    const safeInputReference = assertReference(inputReference, 'inputReference', limits);
    const safeApprovalReference = assertReference(approvalReference, 'approvalReference', limits);
    assertPlainObject(result, 'result');
    const {
      outcome,
      final = false,
      resultReference,
      errorReference,
      continuation,
    } = result;
    assertStepOutcome(outcome);
    if (typeof final !== 'boolean') fail('result.final must be a boolean');
    const safeResultReference = assertReference(resultReference, 'result.resultReference', limits);
    const safeErrorReference = assertReference(errorReference, 'result.errorReference', limits);
    let safeContinuation = null;
    if (continuation !== undefined) {
      if (typeof continuation !== 'string') fail('result.continuation must be a bounded string');
      const size = Buffer.byteLength(continuation, 'utf8');
      if (size > record.budgets.maxContinuationBytes) {
        fail(`result.continuation exceeds the machine continuation budget ${record.budgets.maxContinuationBytes} bytes`, { size, limit: record.budgets.maxContinuationBytes });
      }
      safeContinuation = continuation;
    }
    const referenceCount = [safeInputReference, safeApprovalReference, safeResultReference, safeErrorReference].filter((value) => value !== null).length;
    if (referenceCount > record.budgets.maxReferences) {
      fail(`step references exceed the machine reference budget ${record.budgets.maxReferences}`, { count: referenceCount, limit: record.budgets.maxReferences });
    }
    if (outcome === 'approval-required' && safeApprovalReference === null) {
      fail('an approval-required step must carry an approvalReference to the ai.approval record that gates it (fail-closed)');
    }

    // Budget gates: exhausted budget is a stable terminal failure, never a
    // rejected call that leaves the machine pretending it can continue.
    if (record.stepCount >= record.budgets.maxSteps) {
      commit({
        ...record,
        lifecycle: 'failed',
        failure: { code: 'budget-exhausted', budget: 'maxSteps', stepId },
      }, iso(now));
      fail(`step '${stepId}' exceeds the machine step budget: machine '${record.machineId}' is now terminally failed (budget-exhausted)`, {
        machineId: record.machineId,
        budget: 'maxSteps',
        limit: record.budgets.maxSteps,
      });
    }
    const elapsedMs = Date.parse(iso(now)) - Date.parse(record.startedAt);
    if (elapsedMs >= record.budgets.maxDurationMs) {
      commit({
        ...record,
        lifecycle: 'failed',
        failure: { code: 'budget-exhausted', budget: 'maxDurationMs', stepId },
      }, iso(now));
      fail(`step '${stepId}' exceeds the machine duration budget: machine '${record.machineId}' is now terminally failed (budget-exhausted)`, {
        machineId: record.machineId,
        budget: 'maxDurationMs',
        limit: record.budgets.maxDurationMs,
      });
    }

    const stepRecord = {
      stepId,
      sequence: expectedSequence,
      inputReference: safeInputReference,
      approvalReference: safeApprovalReference,
      outcome,
      final,
      resultReference: safeResultReference,
      errorReference: safeErrorReference,
      continuation: safeContinuation,
      recordedAt: iso(now),
    };
    let lifecycle = record.lifecycle;
    let failure = record.failure;
    if (outcome === 'succeeded') {
      if (final) {
        lifecycle = 'completed';
      }
    } else if (outcome === 'failed') {
      lifecycle = 'failed';
      failure = { code: 'step-failed', stepId, errorReference: safeErrorReference };
    } else if (outcome === 'cancelled') {
      lifecycle = 'cancelled';
    } else {
      lifecycle = 'waiting';
    }
    const next = commit({
      ...record,
      lifecycle,
      failure,
      steps: [...record.steps, stepRecord],
      stepCount: record.stepCount + 1,
    }, iso(now));
    return publicMachine(next);
  }

  function pause(input) {
    assertPlainObject(input, 'pause input');
    const record = load(input.machineId, 'pause');
    // Idempotent: a paused machine stays paused.
    if (record.lifecycle === 'paused') return publicMachine(record);
    assertVersion(record, input, 'agentMachine.pause');
    if (record.lifecycle !== 'running') {
      transition(`agent machine '${record.machineId}' cannot be paused from '${record.lifecycle}'`, { machineId: record.machineId, lifecycle: record.lifecycle });
    }
    const next = commit({ ...record, lifecycle: 'paused' }, iso(now));
    return publicMachine(next);
  }

  function resume(input) {
    assertPlainObject(input, 'resume input');
    const record = load(input.machineId, 'resume');
    // Idempotent: a running machine stays running.
    if (record.lifecycle === 'running') return publicMachine(record);
    assertVersion(record, input, 'agentMachine.resume');
    if (terminalOf(record)) transition(`terminal agent machine '${record.machineId}' (${record.lifecycle}) cannot be resumed`, { machineId: record.machineId, lifecycle: record.lifecycle });
    if (record.lifecycle === 'waiting') {
      transition(`agent machine '${record.machineId}' is waiting on an approval reference; P2.16 has no approval resolution, so it can only be cancelled (fail-closed)`, { machineId: record.machineId, lifecycle: record.lifecycle });
    }
    if (record.lifecycle !== 'paused') transition(`agent machine '${record.machineId}' cannot be resumed from '${record.lifecycle}'`, { machineId: record.machineId, lifecycle: record.lifecycle });
    const next = commit({ ...record, lifecycle: 'running' }, iso(now));
    return publicMachine(next);
  }

  function cancel(input) {
    assertPlainObject(input, 'cancel input');
    const record = load(input.machineId, 'cancel');
    // Idempotent: a cancelled machine stays cancelled.
    if (record.lifecycle === 'cancelled') return publicMachine(record);
    assertVersion(record, input, 'agentMachine.cancel');
    if (terminalOf(record)) {
      transition(`terminal agent machine '${record.machineId}' is '${record.lifecycle}'; it cannot be cancelled into another outcome`, { machineId: record.machineId, lifecycle: record.lifecycle });
    }
    const next = commit({ ...record, lifecycle: 'cancelled' }, iso(now));
    return publicMachine(next);
  }

  return Object.freeze({
    contract: AGENT_MACHINE_CONTRACT_VERSION,
    limits,
    provider,
    create,
    describe,
    start,
    step,
    pause,
    resume,
    cancel,
    get count() { return provider.list().length; },
    clear: () => provider.clear?.(),
  });
}

export function createAgentMachineManager(options = {}) {
  return makeManager(options);
}

export const createAgentMachineProvider = () => new InMemoryAgentMachineProvider();
export const AGENT_MACHINE_MANIFEST = Object.freeze(clone(MANIFEST));
