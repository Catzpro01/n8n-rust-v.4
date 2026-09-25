// Workforce runtime — live worker SESSION layer (#295).
//
// The control plane (engine.mjs) already owns Task / AgentState / Reservation / Lease / Evidence /
// Handoff authority, the pure scheduler, CAS and recovery. This module adds ONLY what was missing:
// a durable registry of live worker sessions attached to the ten canonical capacity slots, plus the
// assignment-envelope store the Manager publishes into. It never grants authority by itself — every
// task/lease mutation still goes through ControlPlane.execute() (see assignment-runtime.mjs).
//
// Separation of concerns:
//   * AgentState (engine)  = the durable CAPACITY SLOT (AGENT-01..AGENT-10). Never an identity of a chat.
//   * Session (here)       = one live attachment of a worker process/Arena session to a slot. Sessions
//                            come and go; a slot can receive a new session after loss (generation++).
//   * Assignment (here)    = the envelope a session receives for a task the Manager assigned through
//                            TASK_ASSIGN. It points at the engine lease; it is not a second lease.
//
// Operational state only: heartbeats and sessions live in the runtime directory (gitignored, like
// .arena/workforce-state). Nothing here is written to git (policy.timing: heartbeats never go to git).
//
// Durability: the whole runtime document is small (10 slots) and is replaced atomically
// (temp file + fsync + rename) under an exclusive LOCK; runtime events are appended to an
// append-only JSONL log used for evidence. Lock order is always runtime LOCK -> engine LOCK.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync, appendFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { CommandError, fail, canonicalJson, sha256, addSeconds } from './core.mjs';

export const RUNTIME_VERSION = '1.0.0';
export const PROTOCOL_VERSION = '1';
export const SUPPORTED_PROTOCOLS = Object.freeze(['1']);

// ------------------------------------------------------------------------------ state machines
export const SESSION_STATES = Object.freeze(['ONLINE', 'IDLE', 'ASSIGNED', 'WORKING', 'DRAINING', 'OFFLINE', 'LOST']);
export const SESSION_TRANSITIONS = Object.freeze({
  ONLINE: ['IDLE', 'DRAINING', 'OFFLINE', 'LOST'],
  IDLE: ['ASSIGNED', 'DRAINING', 'OFFLINE', 'LOST'],
  ASSIGNED: ['WORKING', 'IDLE', 'DRAINING', 'LOST'],
  WORKING: ['IDLE', 'DRAINING', 'LOST'],
  DRAINING: ['OFFLINE', 'LOST'],
  OFFLINE: [],
  LOST: [],
});
/** Sessions that are attached and heartbeating (may hold or receive work, subject to state). */
export const LIVE_SESSION_STATES = Object.freeze(['ONLINE', 'IDLE', 'ASSIGNED', 'WORKING', 'DRAINING']);

export const ASSIGNMENT_STATES = Object.freeze(['OFFERED', 'ACKED', 'REJECTED', 'RUNNING', 'WAITING_EXTERNAL', 'READY_FOR_REVIEW', 'FAILED', 'EXPIRED', 'CANCELLED', 'COMPLETED']);
export const ASSIGNMENT_TRANSITIONS = Object.freeze({
  OFFERED: ['ACKED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  ACKED: ['RUNNING', 'WAITING_EXTERNAL', 'READY_FOR_REVIEW', 'FAILED', 'EXPIRED', 'CANCELLED'],
  RUNNING: ['WAITING_EXTERNAL', 'READY_FOR_REVIEW', 'FAILED', 'EXPIRED', 'CANCELLED'],
  WAITING_EXTERNAL: ['RUNNING', 'READY_FOR_REVIEW', 'FAILED', 'EXPIRED', 'CANCELLED'],
  READY_FOR_REVIEW: ['COMPLETED', 'CANCELLED'],
  REJECTED: [], FAILED: [], EXPIRED: [], CANCELLED: [], COMPLETED: [],
});
/** An ACTIVE assignment holds its session and its task (one per task, one per session). */
export const ACTIVE_ASSIGNMENT_STATES = Object.freeze(['OFFERED', 'ACKED', 'RUNNING', 'WAITING_EXTERNAL']);
export const TERMINAL_ASSIGNMENT_STATES = Object.freeze(['REJECTED', 'FAILED', 'EXPIRED', 'CANCELLED', 'COMPLETED']);

export const ACCEPTANCE_STATUSES = Object.freeze(['NOT_BOOTSTRAPPED', 'BOOTSTRAPPING', 'PARTIAL', 'READY', 'DEGRADED', 'FAILED']);
export const RUNNER_CLASSES = Object.freeze(['ANY', 'WINDOWS', 'WSL']);

export function transitionSession(session, to, now, reason) {
  if (!SESSION_STATES.includes(to)) fail('INVALID_SCHEMA', `unknown session state ${to}`);
  if (session.sessionState === to) return session;
  if (!SESSION_TRANSITIONS[session.sessionState]?.includes(to)) fail('INVALID_STATE_TRANSITION', `session ${session.sessionId}: ${session.sessionState} -> ${to} is not allowed`);
  session.history.push({ at: now, from: session.sessionState, to, reason });
  if (session.history.length > 50) session.history.splice(0, session.history.length - 50);
  session.sessionState = to;
  session.revision += 1;
  session.updatedAt = now;
  return session;
}

export function transitionAssignment(a, to, now, reason) {
  if (!ASSIGNMENT_STATES.includes(to)) fail('INVALID_SCHEMA', `unknown assignment state ${to}`);
  if (a.status === to) return a;
  if (!ASSIGNMENT_TRANSITIONS[a.status]?.includes(to)) fail('INVALID_STATE_TRANSITION', `assignment ${a.assignmentId}: ${a.status} -> ${to} is not allowed`);
  a.history.push({ at: now, from: a.status, to, reason });
  a.status = to;
  a.revision += 1;
  a.updatedAt = now;
  return a;
}

// ------------------------------------------------------------------------------ secret guard
// Envelopes, inbox messages and runtime logs must never carry credentials (#295 §13). Patterns are
// assembled from fragments so this source file itself never contains a secret-shaped literal.
const SECRET_PATTERNS = [
  ['GITHUB_TOKEN', new RegExp(`\\b(${['gh' + 'p', 'gh' + 'o', 'gh' + 's', 'gh' + 'u', 'gh' + 'r'].join('|')})_[A-Za-z0-9]{20,}`)],
  ['GITHUB_FINE_GRAINED_PAT', new RegExp(`${'github' + '_pat'}_[A-Za-z0-9_]{20,}`)],
  ['API_KEY', new RegExp(`\\b${'s' + 'k'}-[A-Za-z0-9_-]{20,}`)],
  ['AWS_ACCESS_KEY', new RegExp(`\\b${'AK' + 'IA'}[0-9A-Z]{16}\\b`)],
  ['PRIVATE_KEY', new RegExp(`-----BEGIN [A-Z ]*${'PRIVATE' + ' KEY'}-----`)],
  ['JWT', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['WEBHOOK_SECRET', new RegExp(`\\b${'wh' + 'sec'}_[A-Za-z0-9+/=]{16,}`)],
  ['SLACK_TOKEN', new RegExp(`\\b${'xo' + 'x'}[abprs]-[A-Za-z0-9-]{10,}`)],
  ['RUNTIME_CREDENTIAL', /\bar[es]1_[A-Za-z0-9_-]{20,}/],
];
const SECRET_KEY = /^(token|secret|password|passwd|private_?key|api_?key|credential|credentials|authorization|auth_?token|session_?token|enrollment_?token|access_?key|client_?secret|webhook_?secret|pat)$/i;

/** Return every secret-like finding in a JSON-able value: [{ path, kind }]. */
export function findSecrets(value, path = '$', out = []) {
  if (typeof value === 'string') {
    for (const [kind, re] of SECRET_PATTERNS) if (re.test(value)) out.push({ path, kind });
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => findSecrets(v, `${path}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k) && v !== null && v !== undefined && v !== '') out.push({ path: `${path}.${k}`, kind: 'CREDENTIAL_FIELD' });
      findSecrets(v, `${path}.${k}`, out);
    }
  }
  return out;
}

export function assertNoSecrets(value, what) {
  const found = findSecrets(value);
  // Never echo the offending value; the path and the kind are enough to fix the source.
  if (found.length) fail('POLICY_DENIED', `${what} carries secret-like material and was rejected (fail closed)`, { findings: found });
}

// ------------------------------------------------------------------------------ credentials
// Session credentials are short-lived, scoped to one slot/session, and stored ONLY as digests.
// They are workforce-runtime credentials: they authorize session protocol calls, never GitHub,
// Supabase, webhook or owner operations, and they are never placed in envelopes or events.
export function newCredential(prefix) { return `${prefix}_${randomBytes(24).toString('base64url')}`; }
export function credentialDigest(token) { return `sha256:${createHash('sha256').update(String(token)).digest('hex')}`; }
export function credentialMatches(token, digest) {
  if (typeof token !== 'string' || typeof digest !== 'string') return false;
  const a = Buffer.from(credentialDigest(token)); const b = Buffer.from(digest);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ------------------------------------------------------------------------------ configuration
export const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/;
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{3,127}$/;
export const CAPABILITY_RE = /^[a-z][a-z0-9._-]{0,63}$/;

export function defaultRuntimeConfig(policy) {
  const t = policy.timing;
  return {
    protocolVersion: PROTOCOL_VERSION,
    workspaceRoot: '/srv/arena/workspaces',
    transport: { kind: 'http', url: 'http://127.0.0.1:8795' },
    heartbeatIntervalSeconds: 30,
    // Manager threshold for declaring a SESSION lost; defaults to the policy LOST-candidate age so the
    // runtime never becomes more aggressive than the governance timing without an explicit setting.
    sessionLostSeconds: t.heartbeatLostCandidateSeconds,
    sessionTokenTtlSeconds: 3600,
    enrollmentTtlSeconds: 86400,
    offerAckTimeoutSeconds: t.claimAckTimeoutSeconds,
    // Renew the TASK_ASSIGNMENT lease on heartbeat only when less than this remains, so routine
    // heartbeats do not flood the (git-persisted) control-plane event log with LEASE_RENEWED events.
    leaseRenewBelowSeconds: Math.floor(policy.leases.TASK_ASSIGNMENT.ttlSeconds / 2),
    // The slot heartbeat mirrored into the engine (AGENT_HEARTBEAT) only has to stay inside the
    // stale window; every engine command leaves an idempotency record in the control-plane store.
    engineHeartbeatEverySeconds: Math.max(t.heartbeatLiveSeconds, Math.floor(t.heartbeatStaleSeconds / 2)),
    maxClockSkewSeconds: 120,
  };
}

export function validateRuntimeConfig(config) {
  const errs = [];
  const int = (k, min) => { if (!Number.isInteger(config[k]) || config[k] < min) errs.push(`${k} must be an integer >= ${min}`); };
  if (!SUPPORTED_PROTOCOLS.includes(config.protocolVersion)) errs.push(`protocolVersion ${config.protocolVersion} is not supported`);
  if (typeof config.workspaceRoot !== 'string' || !config.workspaceRoot.startsWith('/') || posix.normalize(config.workspaceRoot) !== config.workspaceRoot.replace(/\/+$/, '')) errs.push('workspaceRoot must be a normalized absolute path');
  if (!['http', 'inproc'].includes(config.transport?.kind)) errs.push(`transport.kind ${config.transport?.kind} is unknown (fail closed)`);
  int('heartbeatIntervalSeconds', 1); int('sessionLostSeconds', 3); int('sessionTokenTtlSeconds', 60); int('enrollmentTtlSeconds', 60);
  int('offerAckTimeoutSeconds', 1); int('leaseRenewBelowSeconds', 1); int('engineHeartbeatEverySeconds', 1); int('maxClockSkewSeconds', 0);
  if (Number.isInteger(config.sessionLostSeconds) && Number.isInteger(config.heartbeatIntervalSeconds) && config.sessionLostSeconds < 3 * config.heartbeatIntervalSeconds) errs.push('sessionLostSeconds must be at least 3x heartbeatIntervalSeconds (a single late heartbeat never loses a session)');
  return errs;
}

// ------------------------------------------------------------------------------ registration checks
/** Canonical per-slot workspace directory and persistent branch. */
export function slotWorkspace(config, agentId) { return `${config.workspaceRoot.replace(/\/+$/, '')}/${agentId}`; }
export function slotBranch(agentId) { return `arena/agent-${agentId.slice(-2)}`; }

/**
 * Validate a session registration against the canonical slot. Pure: throws CommandError on the first
 * violation. `agent` is the engine AgentState (or null); `policy` the canonical policy.
 */
export function validateRegistration(req, { policy, agent, config }) {
  if (!req || typeof req !== 'object') fail('INVALID_SCHEMA', 'registration body is required');
  const { agentId, sessionId, protocolVersion, capabilities, runnerClass, workspace, branch } = req;
  if (typeof agentId !== 'string' || !policy.workerSlots.includes(agentId)) fail('FORBIDDEN', `${agentId} is not one of the canonical worker slots (${policy.workerSlots[0]}..${policy.workerSlots.at(-1)})`);
  if (!agent) fail('NOT_FOUND', `${agentId} is canonical but not registered in the control plane (Manager: AGENT_REGISTER / worker-bootstrap)`);
  if (agent.state === 'RETIRED' || !agent.identity?.enabled) fail('FORBIDDEN', `${agentId} is retired or disabled`);
  if (agent.state === 'SUSPENDED') fail('POLICY_DENIED', `${agentId} is SUSPENDED by the Manager; no session may attach`);
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) fail('INVALID_SCHEMA', 'sessionId must match ^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$');
  if (!SUPPORTED_PROTOCOLS.includes(protocolVersion)) fail('POLICY_DENIED', `protocolVersion ${JSON.stringify(protocolVersion)} is not supported (supported: ${SUPPORTED_PROTOCOLS.join(', ')})`);
  if (!Array.isArray(capabilities) || capabilities.some((c) => typeof c !== 'string' || !CAPABILITY_RE.test(c))) fail('INVALID_SCHEMA', 'capabilities must be an array of lowercase capability ids');
  const extra = capabilities.filter((c) => !agent.capabilities.includes(c));
  if (extra.length) fail('FORBIDDEN', `a session cannot self-grant capabilities the slot does not have: ${extra.join(', ')}`, { extra });
  if (!RUNNER_CLASSES.includes(runnerClass)) fail('INVALID_SCHEMA', `runnerClass must be one of ${RUNNER_CLASSES.join('/')}`);
  const slotClass = agent.capacity?.runnerClass ?? 'ANY';
  if (slotClass !== 'ANY' && runnerClass !== slotClass) fail('POLICY_DENIED', `slot ${agentId} is ${slotClass}; a ${runnerClass} session cannot attach`);
  if (typeof workspace !== 'string' || !workspace.startsWith('/') || workspace.includes('\0')) fail('INVALID_SCHEMA', 'workspace must be an absolute path');
  const norm = posix.normalize(workspace).replace(/\/+$/, '');
  const own = slotWorkspace(config, agentId);
  if (norm !== workspace.replace(/\/+$/, '') || workspace.split('/').includes('..')) fail('POLICY_DENIED', 'workspace must be normalized (no .., no duplicate separators)');
  if (!(norm === own || norm.startsWith(`${own}/`))) fail('POLICY_DENIED', `workspace ${norm} is outside slot ${agentId}'s boundary ${own}`);
  const persistent = slotBranch(agentId);
  if (typeof branch !== 'string' || !(branch === persistent || branch.startsWith(`${persistent}/`)) || /\.\.|[\s~^:?*[\\]/.test(branch)) fail('POLICY_DENIED', `branch must be ${persistent} or ${persistent}/<task> (a session never works on main or another slot's branch)`);
  return { agentId, sessionId, protocolVersion, capabilities: [...new Set(capabilities)].sort(), runnerClass, workspace: norm, branch };
}

// ------------------------------------------------------------------------------ durable store
const sleeper = new Int32Array(new SharedArrayBuffer(4));
function writeDurable(path, text) {
  const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  const fd = openSync(tmp, 'w', 0o600);
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
}

export function emptyRuntimeState(config) {
  return { schemaVersion: '1.0', runtimeVersion: RUNTIME_VERSION, config, counters: { event: 0, session: 0 }, sessions: {}, assignments: {}, enrollments: {}, idempotency: {}, recovery: {}, liveGate: null };
}

export class RuntimeStore {
  constructor(dir, { policy }) {
    if (!policy) throw new Error('RuntimeStore requires the canonical policy');
    this.dir = dir;
    this.policy = policy;
    mkdirSync(join(dir, 'bootstrap'), { recursive: true, mode: 0o700 });
    mkdirSync(join(dir, 'inbox'), { recursive: true, mode: 0o700 });
  }

  get path() { return join(this.dir, 'runtime.json'); }
  get eventsPath() { return join(this.dir, 'events.jsonl'); }
  exists() { return existsSync(this.path); }

  withLock(fn) {
    const lockPath = join(this.dir, 'LOCK');
    const { lockWaitMaxMs, lockPollMs, staleLockSeconds } = this.policy.timing;
    const started = Date.now();
    let fd = null;
    while (fd === null) {
      try {
        fd = openSync(lockPath, 'wx');
        writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let stale = false;
        try { stale = (Date.now() - statSync(lockPath).mtimeMs) / 1000 > staleLockSeconds; } catch { continue; }
        if (stale) { try { unlinkSync(lockPath); } catch { /* raced */ } continue; }
        if (Date.now() - started > lockWaitMaxMs) throw new CommandError('RESOURCE_UNAVAILABLE', 'workforce runtime lock is held', { lock: lockPath });
        Atomics.wait(sleeper, 0, 0, Math.min(lockPollMs, 1000));
      }
    }
    try { return fn(); } finally { closeSync(fd); try { unlinkSync(lockPath); } catch { /* already gone */ } }
  }

  read() {
    if (!this.exists()) return null;
    const doc = JSON.parse(readFileSync(this.path, 'utf8'));
    if (doc.schemaVersion !== '1.0') fail('INTERNAL_RECOVERY_REQUIRED', `unknown runtime schemaVersion ${doc.schemaVersion} (fail closed)`);
    return doc;
  }

  /** Run fn(state, emit) under the lock; persist state atomically, then append emitted events. */
  transact(fn, { create = null } = {}) {
    return this.withLock(() => {
      let state = this.read();
      if (!state) {
        if (!create) fail('INTERNAL_RECOVERY_REQUIRED', `workforce runtime is not bootstrapped at ${this.dir} (run worker-bootstrap)`);
        state = create();
      }
      const events = [];
      const emit = (type, at, fields = {}) => {
        state.counters.event += 1;
        const e = { seq: state.counters.event, at, type, ...fields };
        assertNoSecrets(e, `runtime event ${type}`);
        events.push(e);
        return e;
      };
      const result = fn(state, emit);
      // Bound idempotency memory: keep the newest 5000 records.
      const keys = Object.keys(state.idempotency);
      if (keys.length > 5000) for (const k of keys.sort((a, b) => state.idempotency[a].at.localeCompare(state.idempotency[b].at)).slice(0, keys.length - 5000)) delete state.idempotency[k];
      writeDurable(this.path, `${JSON.stringify(state, null, 1)}\n`);
      if (events.length) appendFileSync(this.eventsPath, events.map((e) => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 });
      return result;
    });
  }

  events() {
    if (!existsSync(this.eventsPath)) return [];
    return readFileSync(this.eventsPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  /** Durable per-session inbox (file transport): the latest envelope offered to a session. */
  writeInbox(sessionId, message) {
    assertNoSecrets(message, 'inbox message');
    const dir = join(this.dir, 'inbox', sessionId.replace(/[^A-Za-z0-9._-]/g, '_'));
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeDurable(join(dir, `${message.assignmentId}.json`), `${JSON.stringify(message, null, 1)}\n`);
  }
}

/** Idempotent request wrapper for session protocol calls, keyed by (scope, key). */
export function idempotent(state, scope, key, request, now, fn) {
  if (typeof key !== 'string' || !IDEMPOTENCY_KEY_RE.test(key)) fail('INVALID_SCHEMA', 'idempotencyKey is required (^[A-Za-z0-9][A-Za-z0-9._:-]{3,127}$)');
  const id = sha256(`${scope}\n${key}`);
  const digest = sha256(canonicalJson(request));
  const prior = state.idempotency[id];
  if (prior) {
    if (prior.digest !== digest) fail('IDEMPOTENCY_CONFLICT', `idempotency key ${key} was already used with a different payload`, { scope });
    return { ...prior.result, replayed: true };
  }
  const result = fn();
  state.idempotency[id] = { at: now, scope, digest, result };
  return result;
}

export { addSeconds };
