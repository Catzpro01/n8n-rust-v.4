// Workforce runtime — READY task -> live worker session assignment bridge (#295).
//
//   READY task -> pure scheduler recommendation -> Manager TASK_ASSIGN -> TASK_ASSIGNMENT lease
//   -> assignment envelope (OFFERED) -> session ACK -> heartbeat / lease renewal -> WORKING
//   -> READY_FOR_REVIEW (slot released) -> refill;  loss -> AGENT_MARK_LOST -> unclaim / handoff +
//   TASK_TRANSFER -> replacement session.
//
// Authority stays in the existing engine. This file never writes Task / AgentState / Lease /
// Reservation objects directly: every mutation is a ControlPlane.execute() command, issued either as
// the session's WORKER identity (own task, own lease — the engine enforces ownership) or as MANAGER
// for the Manager-loop steps (assign, unclaim, mark lost, transfer, recover, activate). The scheduler
// is called unchanged and never mutates. Sessions never receive a GitHub / owner credential.
import { randomUUID } from 'node:crypto';
import { CommandError, fail, canonicalJson, sha256, addSeconds, secondsBetween, canTransition, isTerminal } from './core.mjs';
import { plan, matchAgent, heavyRunnerClass } from './scheduler.mjs';
import { snapshot, applySafeRecovery } from './recovery.mjs';
import {
  RuntimeStore, RUNTIME_VERSION, PROTOCOL_VERSION, LIVE_SESSION_STATES, ACTIVE_ASSIGNMENT_STATES, TERMINAL_ASSIGNMENT_STATES,
  defaultRuntimeConfig, validateRuntimeConfig, validateRegistration, transitionSession, transitionAssignment,
  assertNoSecrets, newCredential, credentialDigest, credentialMatches, idempotent, emptyRuntimeState, slotWorkspace, slotBranch,
} from './session-runtime.mjs';

const MANAGER = Object.freeze({ type: 'MANAGER', id: 'MANAGER-01' });
const worker = (agentId) => ({ type: 'WORKER', id: agentId });
const ACTIVE_WORK = new Set(['CLAIMED', 'ACKNOWLEDGED', 'PREPARING', 'WORKING', 'WAITING_EXTERNAL', 'BLOCKED', 'FROZEN']);
const TRANSFERABLE = new Set(['CLAIMED', 'ACKNOWLEDGED', 'PREPARING', 'WORKING', 'WAITING_EXTERNAL', 'BLOCKED']);
const SESSION_KINDS = ['arena-session', 'local-harness'];
const REPORT_STATUSES = ['RUNNING', 'WAITING_EXTERNAL', 'BLOCKED', 'PROGRESS', 'READY_FOR_REVIEW', 'FAILED'];
const SHA40 = /^[0-9a-f]{40}$/;

/** Public projection of a session: never includes credential digests. */
export function publicSession(s) {
  if (!s) return null;
  const { tokenDigest, ...rest } = s; // eslint-disable-line no-unused-vars
  return { ...rest, history: undefined };
}

export class WorkforceRuntime {
  /**
   * @param {object} o
   * @param {import('./engine.mjs').ControlPlane} o.cp  the canonical control plane
   * @param {string} o.dir                               runtime directory (operational state, gitignored)
   * @param {() => string} [o.now]                       clock (defaults to the control-plane clock)
   */
  constructor({ cp, dir, now }) {
    this.cp = cp;
    this.policy = cp.policy;
    this.now = now ?? cp.now;
    this.store = new RuntimeStore(dir, { policy: cp.policy });
  }

  // ============================================================================ engine bridge
  #exec(actor, commandType, objectType, objectId, payload = {}, { key, reason, expectedRevision } = {}) {
    let rev = expectedRevision;
    if (rev === undefined) { const o = objectId === 'NEW' ? null : this.cp.store.get(objectType, objectId); rev = o ? o.revision : 0; }
    const r = this.cp.execute({
      commandId: `CMD-rt-${randomUUID()}`, commandType, schemaVersion: '1.0', actor,
      target: { objectType, objectId }, expectedRevision: rev,
      idempotencyKey: (key ?? `rt-${randomUUID()}`).slice(0, 200), requestedAt: this.now(),
      reason: reason ?? `workforce runtime ${commandType}`, payload,
    });
    if (!r.ok) throw new CommandError(r.error.code, r.error.message, { ...(r.error.details ?? {}), commandType, objectId });
    return r;
  }

  #config(state) { return state.config; }

  // ============================================================================ bootstrap (Manager)
  /**
   * Prepare reproducible bootstrap bundles for the canonical slots. Registers missing slots in the
   * control plane (AGENT_REGISTER, Manager), issues one short-lived enrollment credential per slot
   * (stored only as a digest) and returns the bundles. Bootstrap files never make a slot ONLINE.
   */
  bootstrap({ config: overrides = {}, slots, capabilities = ['node'], rotate = false } = {}) {
    const policy = this.policy;
    const targetSlots = slots ?? policy.workerSlots;
    for (const s of targetSlots) if (!policy.workerSlots.includes(s)) fail('FORBIDDEN', `${s} is not a canonical worker slot`);
    return this.store.transact((state, emit) => {
      const now = this.now();
      state.config = { ...state.config, ...overrides, transport: { ...state.config.transport, ...(overrides.transport ?? {}) } };
      const errs = validateRuntimeConfig(state.config);
      if (errs.length) fail('INVALID_SCHEMA', `invalid runtime configuration: ${errs.join('; ')}`, { errors: errs });
      const bundles = [];
      for (const agentId of targetSlots) {
        let agent = this.cp.store.get('AgentState', agentId);
        if (!agent) {
          this.#exec(MANAGER, 'AGENT_REGISTER', 'AgentState', agentId, { capabilities }, { key: `rt-bootstrap-register-${agentId}`, reason: `workforce runtime bootstrap: register canonical capacity slot ${agentId}` });
          agent = this.cp.store.get('AgentState', agentId);
        }
        const existing = state.enrollments[agentId];
        const valid = existing && !existing.usedAt && Date.parse(existing.expiresAt) > Date.parse(now);
        let enrollmentToken = null;
        if (!valid || rotate) {
          enrollmentToken = newCredential('are1');
          state.enrollments[agentId] = { agentId, digest: credentialDigest(enrollmentToken), issuedAt: now, expiresAt: addSeconds(now, state.config.enrollmentTtlSeconds), usedAt: null, reusable: true };
          emit('ENROLLMENT_ISSUED', now, { agentId, expiresAt: state.enrollments[agentId].expiresAt });
        }
        bundles.push({
          agentId, protocolVersion: state.config.protocolVersion, runtimeVersion: RUNTIME_VERSION,
          transport: state.config.transport, workspace: slotWorkspace(state.config, agentId), branch: slotBranch(agentId),
          capabilities: agent.capabilities, runnerClass: agent.capacity.runnerClass, heartbeatIntervalSeconds: state.config.heartbeatIntervalSeconds,
          enrollment: enrollmentToken ? { token: enrollmentToken, expiresAt: state.enrollments[agentId].expiresAt } : { token: null, note: 'an unexpired enrollment already exists; pass rotate to re-issue' },
          startCommand: `node tools/arena-session/worker.mjs start --agent ${agentId}`,
        });
      }
      state.bootstrappedAt = state.bootstrappedAt ?? now;
      return { ok: true, slots: targetSlots, bundles };
    }, { create: () => emptyRuntimeState(defaultRuntimeConfig(policy)) });
  }

  // ============================================================================ session protocol
  #auth(state, req) {
    const s = state.sessions[req?.sessionId];
    if (!s) fail('UNAUTHORIZED', `unknown session ${req?.sessionId}`);
    if (!credentialMatches(req.sessionToken, s.tokenDigest)) fail('UNAUTHORIZED', 'session credential is invalid');
    if (req.agentId !== s.agentId) fail('FORBIDDEN', `session ${s.sessionId} belongs to ${s.agentId}, not ${req.agentId}`);
    if (!LIVE_SESSION_STATES.includes(s.sessionState)) fail('FORBIDDEN', `session ${s.sessionId} is ${s.sessionState}; register a new session`);
    if (Date.parse(this.now()) >= Date.parse(s.tokenExpiresAt)) fail('UNAUTHORIZED', 'session credential expired; register a new session');
    return s;
  }

  /** Strip credentials from a request before hashing it for idempotency. */
  #requestView(req) { const { sessionToken, enrollmentToken, ...rest } = req ?? {}; return rest; } // eslint-disable-line no-unused-vars

  register(req) {
    let issued = null;
    const out = this.store.transact((state, emit) => {
      const now = this.now();
      const config = this.#config(state);
      return idempotent(state, `register:${req?.agentId}`, req?.idempotencyKey, this.#requestView(req), now, () => {
        const agent = this.policy.workerSlots.includes(req?.agentId) ? this.cp.store.get('AgentState', req.agentId) : null; // canonical check first
        const v = validateRegistration(req, { policy: this.policy, agent, config });
        if (!SESSION_KINDS.includes(req.sessionKind)) fail('INVALID_SCHEMA', `sessionKind must be one of ${SESSION_KINDS.join('/')} (declares whether this is a live Arena session or a local harness)`);
        const enr = state.enrollments[v.agentId];
        if (!enr || !credentialMatches(req.enrollmentToken, enr.digest)) fail('UNAUTHORIZED', `invalid enrollment credential for ${v.agentId}`);
        if (Date.parse(now) >= Date.parse(enr.expiresAt)) fail('UNAUTHORIZED', `enrollment for ${v.agentId} expired; the Manager re-runs worker-bootstrap`);
        if (state.sessions[v.sessionId]) fail('DUPLICATE', `session ${v.sessionId} already exists (session ids are never reused)`);
        const live = Object.values(state.sessions).find((s) => s.agentId === v.agentId && LIVE_SESSION_STATES.includes(s.sessionState));
        if (live) fail('RESOURCE_UNAVAILABLE', `slot ${v.agentId} already has live session ${live.sessionId} (${live.sessionState}); it must drain or be declared LOST first`, { liveSessionId: live.sessionId });
        const generation = Object.values(state.sessions).filter((s) => s.agentId === v.agentId).length + 1;
        const sessionToken = newCredential('ars1');
        issued = sessionToken;
        state.counters.session += 1;
        const session = {
          ...v, sessionKind: req.sessionKind, transport: req.transport ?? 'inproc', sessionState: 'ONLINE', generation,
          registeredAt: now, heartbeatAt: now, updatedAt: now, tokenDigest: credentialDigest(sessionToken),
          tokenExpiresAt: addSeconds(now, config.sessionTokenTtlSeconds), assignmentId: null, lostAt: null,
          counters: { heartbeats: 0, leaseRenewals: 0, assignments: 0, offerTimeouts: 0 }, revision: 1, history: [{ at: now, from: null, to: 'ONLINE', reason: 'REGISTERED' }],
        };
        state.sessions[v.sessionId] = session;
        enr.usedAt = now;
        emit('SESSION_REGISTERED', now, { sessionId: v.sessionId, agentId: v.agentId, sessionKind: session.sessionKind, transport: session.transport, generation, runnerClass: v.runnerClass, workspace: v.workspace });
        return { ok: true, session: publicSession(session), heartbeatIntervalSeconds: config.heartbeatIntervalSeconds };
      });
    });
    // The credential is returned exactly once and is never persisted in clear text — not in the
    // runtime document, not in the idempotency record. A replayed registration returns no credential.
    return issued ? { ...out, sessionToken: issued } : { ...out, sessionToken: null, note: 'replayed registration: the session credential is only returned on first success' };
  }

  ready(req) {
    return this.store.transact((state, emit) => {
      const now = this.now();
      const s = this.#auth(state, req);
      return idempotent(state, `session:${s.sessionId}`, req.idempotencyKey, { op: 'ready', ...this.#requestView(req) }, now, () => {
        if (s.sessionState === 'ONLINE') { transitionSession(s, 'IDLE', now, 'READY'); emit('SESSION_IDLE', now, { sessionId: s.sessionId, agentId: s.agentId }); }
        return { ok: true, sessionState: s.sessionState };
      });
    });
  }

  heartbeat(req) {
    return this.store.transact((state, emit) => {
      const now = this.now();
      const s = this.#auth(state, req);
      const config = this.#config(state);
      return idempotent(state, `session:${s.sessionId}`, req.idempotencyKey, { op: 'heartbeat', ...this.#requestView(req) }, now, () => {
        if (typeof req.timestamp !== 'string' || Number.isNaN(Date.parse(req.timestamp))) fail('INVALID_SCHEMA', 'heartbeat.timestamp (ISO-8601) is required');
        if (Math.abs(secondsBetween(now, req.timestamp)) > config.maxClockSkewSeconds) fail('POLICY_DENIED', `heartbeat timestamp skew exceeds ${config.maxClockSkewSeconds}s`);
        let directive = s.sessionState === 'DRAINING' ? 'DRAIN' : 'CONTINUE';
        let lease = null; let leaseRenewed = false;
        if (req.assignmentId || req.leaseId) {
          const a = state.assignments[req.assignmentId];
          if (!a || a.sessionId !== s.sessionId || a.agentId !== s.agentId) fail('FORBIDDEN', `assignment ${req.assignmentId} is not held by session ${s.sessionId}`);
          if (req.leaseId !== a.leaseId) fail('FORBIDDEN', `lease ${req.leaseId} is not the lease of ${a.assignmentId}; a session never renews another lease`);
          const l = this.cp.store.get('Lease', a.leaseId);
          if (!l || l.holder !== s.agentId) fail('FORBIDDEN', `lease ${a.leaseId} is not held by ${s.agentId}`);
          if (!ACTIVE_ASSIGNMENT_STATES.includes(a.status) || a.status === 'OFFERED') {
            directive = ACTIVE_ASSIGNMENT_STATES.includes(a.status) ? directive : 'STOP_ASSIGNMENT';
          } else if (l.state !== 'ACTIVE' || Date.parse(now) >= Date.parse(l.expiresAt)) {
            directive = 'STOP_ASSIGNMENT';
          } else if (secondsBetween(now, l.expiresAt) < config.leaseRenewBelowSeconds) {
            // The session renews ITS OWN lease as its WORKER identity; the engine enforces own-lease.
            this.#exec(worker(s.agentId), 'LEASE_RENEW', 'Lease', l.objectId, {}, { key: `rt-renew-${s.sessionId}-${req.idempotencyKey}`, reason: `heartbeat renewal by session ${s.sessionId}` });
            leaseRenewed = true;
            s.counters.leaseRenewals += 1;
            a.expiresAt = this.cp.store.get('Lease', l.objectId).expiresAt;
            emit('LEASE_RENEWED', now, { sessionId: s.sessionId, agentId: s.agentId, assignmentId: a.assignmentId, leaseId: l.objectId, taskId: a.taskId, expiresAt: a.expiresAt });
          }
          const cur = this.cp.store.get('Lease', a.leaseId);
          lease = { leaseId: cur.objectId, state: cur.state, expiresAt: cur.expiresAt };
        }
        // Slot heartbeat in the engine is throttled (no event is emitted by AGENT_HEARTBEAT).
        const agent = this.cp.store.get('AgentState', s.agentId);
        const seen = agent?.heartbeat?.lastSeenAt;
        if (agent && (!seen || secondsBetween(seen, now) >= config.engineHeartbeatEverySeconds)) {
          this.#exec(worker(s.agentId), 'AGENT_HEARTBEAT', 'AgentState', s.agentId, {}, { key: `rt-hb-${s.sessionId}-${req.idempotencyKey}`, reason: `session ${s.sessionId} heartbeat` });
        }
        s.heartbeatAt = now; // server clock is authoritative; the client timestamp is only checked for skew
        s.tokenExpiresAt = addSeconds(now, config.sessionTokenTtlSeconds);
        s.counters.heartbeats += 1;
        s.updatedAt = now;
        if (s.counters.heartbeats === 1) emit('SESSION_FIRST_HEARTBEAT', now, { sessionId: s.sessionId, agentId: s.agentId });
        const current = s.assignmentId ? state.assignments[s.assignmentId] : null;
        return { ok: true, sessionState: s.sessionState, reportedState: req.sessionState ?? null, directive, lease, leaseRenewed, tokenExpiresAt: s.tokenExpiresAt, assignment: current ? { assignmentId: current.assignmentId, status: current.status } : null };
      });
    });
  }

  /** Poll the session's inbox: the active envelope offered to / held by this session, if any. */
  poll(req) {
    return this.store.transact((state) => {
      const s = this.#auth(state, req);
      const a = s.assignmentId ? state.assignments[s.assignmentId] : null;
      return { ok: true, sessionState: s.sessionState, assignment: a && ACTIVE_ASSIGNMENT_STATES.includes(a.status) ? this.#envelopeView(a) : null };
    });
  }

  #envelopeView(a) { const { history, revision, updatedAt, ...env } = a; return env; } // eslint-disable-line no-unused-vars

  /** ACK / claim an offered assignment. */
  claim(req) {
    return this.store.transact((state, emit) => {
      const now = this.now();
      const s = this.#auth(state, req);
      return idempotent(state, `session:${s.sessionId}`, req.idempotencyKey, { op: 'claim', ...this.#requestView(req) }, now, () => {
        const a = state.assignments[req.assignmentId];
        if (!a) fail('NOT_FOUND', `assignment ${req.assignmentId} does not exist`);
        if (a.agentId !== s.agentId || a.sessionId !== s.sessionId) fail('FORBIDDEN', `assignment ${a.assignmentId} was offered to ${a.agentId}/${a.sessionId}, not ${s.agentId}/${s.sessionId}`);
        if (req.leaseId !== a.leaseId) fail('FORBIDDEN', `lease ${req.leaseId} does not belong to ${a.assignmentId}`);
        if (['ACKED', 'RUNNING', 'WAITING_EXTERNAL'].includes(a.status)) return { ok: true, alreadyAcked: true, assignment: this.#envelopeView(a) }; // duplicate ACK: idempotent success
        if (a.status === 'EXPIRED') fail('LEASE_EXPIRED', `assignment ${a.assignmentId} expired`);
        if (a.status !== 'OFFERED') fail('LEASE_REVOKED', `assignment ${a.assignmentId} is ${a.status}`);
        if (Date.parse(now) >= Date.parse(a.ackDeadline)) fail('LEASE_EXPIRED', `ACK deadline ${a.ackDeadline} passed`);
        const lease = this.cp.store.get('Lease', a.leaseId);
        if (!lease) fail('NOT_FOUND', `lease ${a.leaseId} is missing`);
        if (lease.state === 'EXPIRED' || (lease.state === 'ACTIVE' && Date.parse(now) >= Date.parse(lease.expiresAt))) fail('LEASE_EXPIRED', `lease ${lease.objectId} expired at ${lease.expiresAt}`);
        if (lease.state !== 'ACTIVE' || lease.holder !== s.agentId) fail('LEASE_REVOKED', `lease ${lease.objectId} is ${lease.state}`);
        const task = this.cp.store.get('Task', a.taskId);
        // A retry after a partially applied ACK (engine ACK committed, runtime write lost) may find the
        // task already ACKNOWLEDGED/PREPARING by this same lease; any other revision change is stale.
        const partial = !a.resume && ['ACKNOWLEDGED', 'PREPARING'].includes(task.state) && task.owner?.agentId === s.agentId && task.execution.activeLeaseId === a.leaseId;
        if (req.taskRevision !== a.taskRevision || (!partial && task.revision !== a.taskRevision)) fail('REVISION_CONFLICT', `task ${a.taskId} revision is ${task.revision}; the envelope was issued at ${a.taskRevision}`, { expected: req.taskRevision, current: task.revision });
        const W = worker(s.agentId);
        const k = (c) => `rt-${c}-${a.assignmentId}`;
        if (task.state === 'CLAIMED') {
          this.#exec(W, 'TASK_ACK', 'Task', a.taskId, {}, { key: k('ack'), expectedRevision: a.taskRevision, reason: `session ${s.sessionId} ACK ${a.assignmentId}` });
          this.#exec(W, 'TASK_PREPARE', 'Task', a.taskId, {}, { key: k('prepare'), reason: `session ${s.sessionId} preparing workspace` });
        } else if (task.state === 'ACKNOWLEDGED' && (partial || a.resume)) {
          this.#exec(W, 'TASK_PREPARE', 'Task', a.taskId, {}, { key: k('prepare'), reason: `session ${s.sessionId} preparing workspace` });
        } else if (partial && task.state === 'PREPARING') {
          // already prepared by the interrupted attempt
        } else {
          // Resumed (transferred) work: the task keeps its state; couple the successor slot to it.
          this.#coupleSlot(W, a, task.state);
        }
        transitionAssignment(a, 'ACKED', now, 'SESSION_ACK');
        transitionSession(s, 'WORKING', now, `ACK ${a.assignmentId}`);
        emit('ASSIGNMENT_ACKED', now, { sessionId: s.sessionId, agentId: s.agentId, assignmentId: a.assignmentId, taskId: a.taskId, leaseId: a.leaseId, resume: Boolean(a.resume) });
        return { ok: true, assignment: this.#envelopeView(a) };
      });
    });
  }

  #coupleSlot(W, a, taskState) {
    const path = { PREPARING: ['PREPARING'], WORKING: ['PREPARING', 'WORKING'], WAITING_EXTERNAL: ['PREPARING', 'WORKING', 'WAITING_EXTERNAL'], BLOCKED: ['PREPARING', 'BLOCKED'] }[taskState] ?? [];
    for (const to of path) {
      const agent = this.cp.store.get('AgentState', a.agentId);
      if (agent.state === to || !canTransition(this.policy, 'AgentState', agent.state, to)) continue;
      this.#exec(W, 'AGENT_STATUS', 'AgentState', a.agentId, { state: to }, { key: `rt-couple-${a.assignmentId}-${to}`, reason: `resume ${a.taskId}: couple slot to task state ${taskState}` });
    }
  }

  /** Reject an offered assignment before ACK. The Manager loop returns the task to READY. */
  reject(req) {
    return this.store.transact((state, emit) => {
      const now = this.now();
      const s = this.#auth(state, req);
      return idempotent(state, `session:${s.sessionId}`, req.idempotencyKey, { op: 'reject', ...this.#requestView(req) }, now, () => {
        const a = state.assignments[req.assignmentId];
        if (!a || a.sessionId !== s.sessionId) fail('FORBIDDEN', `assignment ${req.assignmentId} is not offered to ${s.sessionId}`);
        transitionAssignment(a, 'REJECTED', now, req.reason ?? 'SESSION_REJECTED');
        this.#release(state, s, now, 'REJECTED');
        state.recovery[a.taskId] = { taskId: a.taskId, fromAgentId: a.agentId, fromSessionId: s.sessionId, reason: 'OFFER_REJECTED', since: now, attempts: 0, status: 'PENDING' };
        emit('ASSIGNMENT_REJECTED', now, { sessionId: s.sessionId, agentId: s.agentId, assignmentId: a.assignmentId, taskId: a.taskId });
        return { ok: true, status: a.status };
      });
    });
  }

  /** Execution report from the session: progress, state changes, READY_FOR_REVIEW (exact head), failure. */
  report(req) {
    return this.store.transact((state, emit) => {
      const now = this.now();
      const s = this.#auth(state, req);
      return idempotent(state, `session:${s.sessionId}`, req.idempotencyKey, { op: 'report', ...this.#requestView(req) }, now, () => {
        const a = state.assignments[req.assignmentId];
        if (!a || a.sessionId !== s.sessionId || a.agentId !== s.agentId) fail('FORBIDDEN', `assignment ${req.assignmentId} is not held by ${s.sessionId}`);
        if (!REPORT_STATUSES.includes(req.status)) fail('INVALID_SCHEMA', `report.status must be one of ${REPORT_STATUSES.join('/')}`);
        if (!['ACKED', 'RUNNING', 'WAITING_EXTERNAL'].includes(a.status)) fail('INVALID_STATE_TRANSITION', `assignment ${a.assignmentId} is ${a.status}; ACK first`);
        const lease = this.cp.store.get('Lease', a.leaseId);
        if (!lease || lease.state !== 'ACTIVE') fail('LEASE_REVOKED', `lease ${a.leaseId} is ${lease?.state ?? 'missing'}`);
        if (Date.parse(now) >= Date.parse(lease.expiresAt)) fail('LEASE_EXPIRED', `lease ${a.leaseId} expired at ${lease.expiresAt}`);
        if (req.headSha !== undefined && !SHA40.test(req.headSha)) fail('INVALID_SCHEMA', 'headSha must be a 40-hex commit');
        if (req.prNumber !== undefined && !(Number.isInteger(req.prNumber) && req.prNumber > 0)) fail('INVALID_SCHEMA', 'prNumber must be a positive integer');
        assertNoSecrets({ summary: req.summary ?? null }, 'report');
        const W = worker(s.agentId);
        const key = `rt-report-${s.sessionId}-${req.idempotencyKey}`;
        const task = () => this.cp.store.get('Task', a.taskId);
        const progress = () => {
          const p = {};
          if (req.headSha) p.headSha = req.headSha;
          if (req.prNumber) p.prNumber = req.prNumber;
          if (req.summary) p.nextAction = String(req.summary).slice(0, 500);
          if (Object.keys(p).length) this.#exec(W, 'TASK_PROGRESS', 'Task', a.taskId, p, { key: `${key}-progress`, reason: `session ${s.sessionId} progress` });
        };
        const start = () => { if (['PREPARING', 'BLOCKED', 'WAITING_EXTERNAL'].includes(task().state)) this.#exec(W, 'TASK_START', 'Task', a.taskId, {}, { key: `${key}-start`, reason: `session ${s.sessionId} working` }); };
        switch (req.status) {
          case 'RUNNING': start(); progress(); transitionAssignment(a, 'RUNNING', now, 'SESSION_RUNNING'); break;
          case 'PROGRESS': progress(); break;
          case 'WAITING_EXTERNAL': start(); progress(); this.#exec(W, 'TASK_WAIT_EXTERNAL', 'Task', a.taskId, {}, { key: `${key}-wait`, reason: String(req.summary ?? 'waiting for an external system').slice(0, 300) }); transitionAssignment(a, 'WAITING_EXTERNAL', now, 'SESSION_WAITING'); break;
          case 'BLOCKED': start(); progress(); this.#exec(W, 'TASK_BLOCK', 'Task', a.taskId, { reasonCode: 'SESSION_BLOCKED' }, { key: `${key}-block`, reason: String(req.summary ?? 'blocked').slice(0, 300) }); if (a.status === 'ACKED') transitionAssignment(a, 'RUNNING', now, 'SESSION_BLOCKED'); a.blocked = true; break;
          case 'READY_FOR_REVIEW': {
            if (!req.headSha) fail('EVIDENCE_INSUFFICIENT', 'READY_FOR_REVIEW requires the exact pushed head SHA');
            start();
            this.#exec(W, 'TASK_READY_FOR_REVIEW', 'Task', a.taskId, { headSha: req.headSha, ...(req.prNumber ? { prNumber: req.prNumber } : {}) }, { key: `${key}-rfr`, reason: `session ${s.sessionId} delivered ${req.headSha.slice(0, 12)}` });
            transitionAssignment(a, 'READY_FOR_REVIEW', now, 'SESSION_DELIVERED');
            this.#release(state, s, now, 'READY_FOR_REVIEW');
            break;
          }
          case 'FAILED': {
            // The session gives up: record a handoff (worker own-task), park the task BLOCKED and
            // hand it to the Manager loop for transfer. Never completion.
            progress();
            if (['PREPARING', 'WORKING', 'WAITING_EXTERNAL'].includes(task().state)) this.#exec(W, 'TASK_BLOCK', 'Task', a.taskId, { reasonCode: 'SESSION_FAILED' }, { key: `${key}-block`, reason: String(req.summary ?? 'session failed').slice(0, 300) });
            this.#exec(W, 'HANDOFF_PUBLISH', 'Handoff', 'NEW', { taskId: a.taskId, nextAction: String(req.summary ?? 'previous session failed; resume from the last pushed head').slice(0, 500), ...(req.headSha ? { commitSha: req.headSha } : {}) }, { key: `${key}-handoff`, reason: `session ${s.sessionId} failure handoff` });
            transitionAssignment(a, 'FAILED', now, 'SESSION_FAILED');
            this.#release(state, s, now, 'FAILED');
            state.recovery[a.taskId] = { taskId: a.taskId, fromAgentId: a.agentId, fromSessionId: s.sessionId, reason: 'SESSION_FAILED', since: now, attempts: 0, status: 'PENDING' };
            break;
          }
          default: break;
        }
        const t = task();
        emit('ASSIGNMENT_REPORTED', now, { sessionId: s.sessionId, agentId: s.agentId, assignmentId: a.assignmentId, taskId: a.taskId, status: req.status, assignmentStatus: a.status, taskState: t.state, ...(req.headSha ? { headSha: req.headSha } : {}) });
        return { ok: true, assignmentStatus: a.status, taskState: t.state, sessionState: s.sessionState };
      });
    });
  }

  drain(req) {
    return this.store.transact((state, emit) => {
      const now = this.now();
      const s = this.#auth(state, req);
      return idempotent(state, `session:${s.sessionId}`, req.idempotencyKey, { op: 'drain', ...this.#requestView(req) }, now, () => {
        if (s.sessionState !== 'DRAINING') transitionSession(s, 'DRAINING', now, 'DRAIN_REQUESTED');
        if (!s.assignmentId) transitionSession(s, 'OFFLINE', now, 'DRAINED');
        emit('SESSION_DRAINING', now, { sessionId: s.sessionId, agentId: s.agentId, sessionState: s.sessionState });
        return { ok: true, sessionState: s.sessionState };
      });
    });
  }

  /** Free a session after its assignment ended. */
  #release(state, s, now, reason) {
    s.assignmentId = null;
    if (s.sessionState === 'DRAINING') transitionSession(s, 'OFFLINE', now, `DRAINED_AFTER_${reason}`);
    else if (['ASSIGNED', 'WORKING'].includes(s.sessionState)) transitionSession(s, 'IDLE', now, reason);
  }

  // ============================================================================ Manager loop
  #fresh(state, s, now) {
    const c = this.#config(state);
    return LIVE_SESSION_STATES.includes(s.sessionState) && secondsBetween(s.heartbeatAt, now) <= 3 * c.heartbeatIntervalSeconds && Date.parse(now) < Date.parse(s.tokenExpiresAt);
  }

  /** Slot view restricted to what the live session actually offers (pure input shaping for the scheduler). */
  #sessionAgentView(agent, s) {
    return { ...agent, capabilities: agent.capabilities.filter((c) => s.capabilities.includes(c)), capacity: { ...agent.capacity, runnerClass: agent.capacity.runnerClass === 'ANY' ? s.runnerClass : agent.capacity.runnerClass } };
  }

  #idleSessions(state, now) {
    return Object.values(state.sessions).filter((s) => s.sessionState === 'IDLE' && !s.assignmentId && this.#fresh(state, s, now));
  }

  #manifest(task, s, mainSha) {
    return {
      taskId: task.objectId, title: task.title, program: task.program, slice: task.slice ?? null, issue: task.issue ?? null,
      priority: task.priority ?? null, scope: task.scope ?? null, requirements: task.requirements ?? null,
      dependencies: (task.dependencies ?? []).map((d) => d.taskId ?? d),
      branch: task.branch?.taskBranch ?? null, persistentBranch: task.branch?.persistentBranch ?? null, baseSha: mainSha,
      workspace: s.workspace, worktree: `${s.workspace}/worktrees/${task.objectId}`,
      delivery: ['work only inside the declared scope and workspace', 'commit on the task branch and push', 'open or update the one Slice PR', 'report READY_FOR_REVIEW with the exact pushed head SHA', 'never merge; the Manager reconciles and merges'],
    };
  }

  /** Publish an OFFERED envelope for a task the engine has just (re)assigned to the session's slot. */
  #publish(state, emit, s, taskId, { mainSha, resume = false, idemKey, handoffId = null }) {
    const now = this.now();
    const c = this.#config(state);
    const task = this.cp.store.get('Task', taskId);
    const leaseId = task.execution.activeLeaseId;
    const lease = this.cp.store.get('Lease', leaseId);
    if (!lease || lease.holder !== s.agentId || lease.state !== 'ACTIVE') fail('INTERNAL_RECOVERY_REQUIRED', `task ${taskId} has no active lease for ${s.agentId} after assignment`);
    const dup = Object.values(state.assignments).find((x) => ACTIVE_ASSIGNMENT_STATES.includes(x.status) && (x.taskId === taskId || x.sessionId === s.sessionId));
    if (dup) fail('DUPLICATE', `an active assignment already exists for ${dup.taskId === taskId ? `task ${taskId}` : `session ${s.sessionId}`}: ${dup.assignmentId}`);
    const manifest = this.#manifest(task, s, mainSha);
    const env = {
      assignmentId: `ASN-${leaseId}`, taskId, agentId: s.agentId, sessionId: s.sessionId, leaseId,
      reservationIds: [...(task.execution.reservationIds ?? [])], taskRevision: task.revision, mainSha,
      branch: task.branch.taskBranch, taskManifestDigest: sha256(canonicalJson(manifest)), createdAt: now,
      expiresAt: lease.expiresAt, ackDeadline: addSeconds(now, c.offerAckTimeoutSeconds), status: 'OFFERED',
      idempotencyKey: idemKey, policyDigest: this.cp.policyDigest, protocolVersion: PROTOCOL_VERSION, runtimeVersion: RUNTIME_VERSION,
      resume, handoffId, manifest, revision: 1, updatedAt: now, history: [{ at: now, from: null, to: 'OFFERED', reason: resume ? 'RECOVERY_REPLACEMENT' : 'ASSIGNED' }],
    };
    assertNoSecrets(env, `assignment envelope ${env.assignmentId}`);
    state.assignments[env.assignmentId] = env;
    s.assignmentId = env.assignmentId;
    s.counters.assignments += 1;
    transitionSession(s, 'ASSIGNED', now, `OFFER ${env.assignmentId}`);
    this.store.writeInbox(s.sessionId, this.#envelopeView(env));
    emit('ASSIGNMENT_OFFERED', now, { sessionId: s.sessionId, agentId: s.agentId, assignmentId: env.assignmentId, taskId, leaseId, taskRevision: env.taskRevision, resume, reservationIds: env.reservationIds });
    return env;
  }

  /**
   * Manager step 1–7 + 13: reconcile, then fill up to `fill` idle live sessions with READY work.
   * Only slots with a live IDLE session are offered to the pure scheduler; everything else stays queued.
   */
  assignReady({ fill = 10, mainSha, runners, reconcile = true } = {}) {
    if (!SHA40.test(mainSha ?? '')) fail('INVALID_SCHEMA', 'mainSha (the verified 40-hex main commit) is required for assignment envelopes');
    if (!Number.isInteger(fill) || fill < 1 || fill > this.policy.workerSlots.length) fail('INVALID_SCHEMA', `fill must be 1..${this.policy.workerSlots.length}`);
    const reconciled = reconcile ? this.reconcile({ mainSha }) : null;
    return this.store.transact((state, emit) => {
      const now = this.now();
      const s0 = snapshot(this.cp.store);
      const bySlot = new Map(this.#idleSessions(state, now).map((s) => [s.agentId, s]));
      const agents = s0.AgentState.filter((a) => bySlot.has(a.objectId)).map((a) => this.#sessionAgentView(a, bySlot.get(a.objectId)));
      const recommendation = plan({ tasks: s0.Task, agents, reservations: s0.Reservation, runners }, this.policy, now);
      const rows = [];
      for (const rec of recommendation.assignments.slice(0, fill)) {
        const s = bySlot.get(rec.agentId);
        const task = this.cp.store.get('Task', rec.taskId);
        const row = { slot: rec.agentId, taskId: rec.taskId, sessionId: s.sessionId, leaseId: null, reservationIds: [], status: null };
        try {
          assertNoSecrets(this.#manifest(task, s, mainSha), `task ${task.objectId} manifest`);
          const idemKey = `rt-assign-${task.objectId}-r${task.revision}-${s.sessionId}`;
          this.#exec(MANAGER, 'TASK_ASSIGN', 'Task', task.objectId, { agentId: rec.agentId }, { key: idemKey, expectedRevision: task.revision, reason: `workforce runtime: scheduler recommendation to live session ${s.sessionId}` });
          const env = this.#publish(state, emit, s, task.objectId, { mainSha, idemKey });
          Object.assign(row, { assignmentId: env.assignmentId, leaseId: env.leaseId, reservationIds: env.reservationIds, expiresAt: env.expiresAt, status: 'OFFERED' });
        } catch (e) {
          if (!(e instanceof CommandError)) throw e;
          Object.assign(row, { status: 'NOT_ASSIGNED', error: { code: e.code, message: e.message } });
        }
        rows.push(row);
      }
      const liveSlots = new Set(Object.values(state.sessions).filter((s) => this.#fresh(state, s, now)).map((s) => s.agentId));
      const withoutSession = this.policy.workerSlots.filter((a) => !liveSlots.has(a));
      return {
        ok: true, at: now, mainSha, fill, reconcile: reconciled ? { actions: reconciled.actions.length } : null,
        offered: rows, idleSessions: bySlot.size, slotsWithoutLiveSession: withoutSession,
        deferred: recommendation.deferred.map((d) => ({ taskId: d.taskId, reasons: d.reasons })),
        note: bySlot.size === 0 ? 'no live IDLE session is attached: nothing is offered and no worker is reported active' : undefined,
      };
    });
  }

  /**
   * Manager steps 1, 9–12: expire elapsed leases, detect lost / timed-out sessions, synchronize
   * envelopes with the engine, recover tasks (unclaim or handoff + transfer to a live idle session),
   * recover/activate slots. `dryRun` reports without mutating.
   */
  reconcile({ dryRun = false, mainSha = null } = {}) {
    const safe = dryRun ? null : applySafeRecovery(this.cp, this.now());
    return this.store.transact((state, emit) => {
      const now = this.now();
      const c = this.#config(state);
      const actions = [];
      const act = (kind, fields) => { actions.push({ kind, ...fields }); };
      if (safe?.applied?.length) act('ENGINE_SAFE_RECOVERY', { applied: safe.applied.length });

      // A. Session liveness (Manager judgement: explicit, configured timeout; logged with evidence).
      for (const s of Object.values(state.sessions)) {
        if (!LIVE_SESSION_STATES.includes(s.sessionState)) continue;
        const age = secondsBetween(s.heartbeatAt, now);
        const expired = Date.parse(now) >= Date.parse(s.tokenExpiresAt);
        if (age >= c.sessionLostSeconds || expired) {
          act('SESSION_LOST', { sessionId: s.sessionId, agentId: s.agentId, heartbeatAgeSeconds: Math.round(age), reason: expired ? 'CREDENTIAL_EXPIRED' : 'HEARTBEAT_TIMEOUT' });
          if (!dryRun) {
            transitionSession(s, 'LOST', now, expired ? 'CREDENTIAL_EXPIRED' : 'HEARTBEAT_TIMEOUT');
            s.lostAt = now;
            emit('SESSION_LOST', now, { sessionId: s.sessionId, agentId: s.agentId, heartbeatAgeSeconds: Math.round(age), lastHeartbeatAt: s.heartbeatAt, reason: expired ? 'CREDENTIAL_EXPIRED' : 'HEARTBEAT_TIMEOUT' });
          }
        } else if (s.sessionState === 'DRAINING' && !s.assignmentId) {
          act('SESSION_OFFLINE', { sessionId: s.sessionId });
          if (!dryRun) transitionSession(s, 'OFFLINE', now, 'DRAINED');
        }
      }

      // B. Envelope <-> engine synchronization.
      for (const a of Object.values(state.assignments)) {
        if (TERMINAL_ASSIGNMENT_STATES.includes(a.status)) continue;
        const s = state.sessions[a.sessionId];
        const task = this.cp.store.get('Task', a.taskId);
        const lease = this.cp.store.get('Lease', a.leaseId);
        const end = (to, reason, recover) => {
          act('ASSIGNMENT_ENDED', { assignmentId: a.assignmentId, taskId: a.taskId, from: a.status, to, reason });
          if (dryRun) return;
          transitionAssignment(a, to, now, reason);
          if (s && s.assignmentId === a.assignmentId) this.#release(state, s, now, reason);
          if (recover) state.recovery[a.taskId] = { taskId: a.taskId, fromAgentId: a.agentId, fromSessionId: a.sessionId, reason, since: now, attempts: 0, status: 'PENDING' };
          emit('ASSIGNMENT_ENDED', now, { assignmentId: a.assignmentId, taskId: a.taskId, sessionId: a.sessionId, agentId: a.agentId, leaseId: a.leaseId, to, reason, recover: Boolean(recover) });
        };
        if (!task) { end('CANCELLED', 'TASK_MISSING', false); continue; }
        if (a.status === 'READY_FOR_REVIEW') {
          if (task.state === 'COMPLETED') end('COMPLETED', 'TASK_COMPLETED', false);
          else if (isTerminal(this.policy, 'Task', task.state)) end('CANCELLED', `TASK_${task.state}`, false);
          continue;
        }
        if (task.state === 'READY_FOR_REVIEW' && task.owner?.agentId === a.agentId && a.status !== 'OFFERED') {
          act('ASSIGNMENT_DELIVERED', { assignmentId: a.assignmentId });
          if (!dryRun) { transitionAssignment(a, 'READY_FOR_REVIEW', now, 'TASK_READY_FOR_REVIEW'); if (s?.assignmentId === a.assignmentId) this.#release(state, s, now, 'READY_FOR_REVIEW'); }
          continue;
        }
        if (isTerminal(this.policy, 'Task', task.state)) { end('CANCELLED', `TASK_${task.state}`, false); continue; }
        if (task.owner?.agentId !== a.agentId || task.execution.activeLeaseId !== a.leaseId) {
          if (!s || s.sessionState !== 'LOST') { end('CANCELLED', 'TASK_AUTHORITY_MOVED', false); continue; }
        }
        if (s?.sessionState === 'LOST') { end('EXPIRED', 'SESSION_LOST', true); continue; }
        if (!lease || lease.state !== 'ACTIVE' || Date.parse(now) >= Date.parse(lease.expiresAt)) { end('EXPIRED', 'LEASE_EXPIRED', true); continue; }
        if (a.status === 'OFFERED' && Date.parse(now) >= Date.parse(a.ackDeadline)) { if (!dryRun && s) s.counters.offerTimeouts += 1; end('EXPIRED', 'ACK_TIMEOUT', true); continue; }
        if (!dryRun && a.expiresAt !== lease.expiresAt) a.expiresAt = lease.expiresAt;
      }

      // C. Engine slot loss: a lost session's slot that still holds active work is marked LOST by the
      //    Manager (revokes the TASK_ASSIGNMENT lease, PRESERVES reservations for safe recovery).
      const lostSlots = new Set(Object.values(state.sessions).filter((s) => s.sessionState === 'LOST').map((s) => s.agentId));
      for (const agentId of lostSlots) {
        const agent = this.cp.store.get('AgentState', agentId);
        const owned = this.cp.store.list('Task').filter((t) => t.owner?.agentId === agentId && ACTIVE_WORK.has(t.state));
        if (!agent || agent.state === 'LOST' || !owned.length || !canTransition(this.policy, 'AgentState', agent.state, 'LOST')) continue;
        act('AGENT_MARK_LOST', { agentId, tasks: owned.map((t) => t.objectId) });
        if (!dryRun) {
          const lost = Object.values(state.sessions).filter((s) => s.agentId === agentId && s.sessionState === 'LOST').sort((x, y) => (y.lostAt ?? '').localeCompare(x.lostAt ?? ''))[0];
          this.#exec(MANAGER, 'AGENT_MARK_LOST', 'AgentState', agentId, { reasonCode: 'SESSION_LOST' }, { key: `rt-lost-${agentId}-${lost?.sessionId}`, reason: `workforce runtime: session ${lost?.sessionId} lost (heartbeat timeout); lease revoked, reservations preserved` });
          for (const t of owned) state.recovery[t.objectId] = state.recovery[t.objectId] ?? { taskId: t.objectId, fromAgentId: agentId, fromSessionId: lost?.sessionId ?? null, reason: 'SESSION_LOST', since: now, attempts: 0, status: 'PENDING' };
          emit('SLOT_MARKED_LOST', now, { agentId, sessionId: lost?.sessionId ?? null, taskIds: owned.map((t) => t.objectId) });
        }
      }

      // D. Task recovery: CLAIMED -> unclaim (back to READY, replaced by the next assign-ready);
      //    progressed -> Manager handoff + TASK_TRANSFER to a live idle session (replacement).
      const taken = new Set();
      for (const r of Object.values(state.recovery)) {
        if (r.status === 'DONE') continue;
        const task = this.cp.store.get('Task', r.taskId);
        const done = (outcome, extra = {}) => { act('RECOVERY', { taskId: r.taskId, outcome, ...extra }); if (!dryRun) { r.status = 'DONE'; r.outcome = outcome; r.doneAt = now; emit(`RECOVERY_${outcome}`, now, { taskId: r.taskId, fromAgentId: r.fromAgentId, fromSessionId: r.fromSessionId, reason: r.reason, ...extra }); } };
        if (!task || isTerminal(this.policy, 'Task', task.state)) { done('CLOSED'); continue; }
        if (task.state === 'UNASSIGNED') { done('REQUEUED_ALREADY'); continue; }
        const lease = task.execution.activeLeaseId ? this.cp.store.get('Lease', task.execution.activeLeaseId) : null;
        const leaseLive = lease && lease.state === 'ACTIVE' && Date.parse(now) < Date.parse(lease.expiresAt);
        const liveHeld = Object.values(state.assignments).some((x) => x.taskId === r.taskId && ACTIVE_ASSIGNMENT_STATES.includes(x.status));
        if (liveHeld) { done('ALREADY_REASSIGNED'); continue; }
        if (task.owner?.agentId !== r.fromAgentId && leaseLive) { done('ALREADY_TRANSFERRED'); continue; }
        if (dryRun) { act('RECOVERY_PENDING', { taskId: r.taskId, state: task.state }); continue; }
        r.attempts += 1;
        if (task.state === 'CLAIMED') {
          this.#exec(MANAGER, 'TASK_UNCLAIM', 'Task', task.objectId, { reasonCode: r.reason }, { key: `rt-unclaim-${task.objectId}-r${task.revision}`, reason: `workforce runtime: ${r.reason}; claim withdrawn so the task returns to READY` });
          done('REQUEUED', { via: 'TASK_UNCLAIM' });
          continue;
        }
        if (!TRANSFERABLE.has(task.state)) { done('NO_WORKER_NEEDED', { state: task.state }); continue; }
        const base = mainSha ?? (SHA40.test(task.branch?.baseSha ?? '') ? task.branch.baseSha : null);
        if (!base) { r.status = 'WAITING_MAIN_SHA'; act('RECOVERY_WAITING_MAIN_SHA', { taskId: task.objectId, note: 'runtime-reconcile --main <verified sha> is required to publish a replacement envelope' }); continue; }
        const target = this.#transferTarget(state, task, now, taken, r.fromAgentId);
        if (!target) { r.status = 'WAITING_SESSION'; act('RECOVERY_WAITING_SESSION', { taskId: task.objectId, state: task.state }); continue; }
        try {
          const h = this.#exec(MANAGER, 'HANDOFF_PUBLISH', 'Handoff', 'NEW', {
            taskId: task.objectId, branch: task.branch.taskBranch ?? undefined, ...(task.current?.headSha ? { commitSha: task.current.headSha } : {}),
            nextAction: `Resume ${task.objectId} from the last pushed head on ${task.branch.taskBranch}; previous session ${r.fromSessionId ?? 'unknown'} ended (${r.reason}). Evidence and reservations were preserved.`,
            risks: ['previous session ended without a worker handoff; verify the branch head before continuing'],
          }, { key: `rt-handoff-${task.objectId}-r${task.revision}`, reason: `workforce runtime recovery handoff for ${task.objectId}` });
          this.#exec(MANAGER, 'TASK_TRANSFER', 'Task', task.objectId, { toAgentId: target.agentId, handoffId: h.objectId }, { key: `rt-transfer-${task.objectId}-${target.sessionId}`, reason: `workforce runtime: ${r.reason}; replacement session ${target.sessionId}` });
          taken.add(target.agentId);
          const env = this.#publish(state, emit, target, task.objectId, { mainSha: base, resume: true, idemKey: `rt-transfer-${task.objectId}-${target.sessionId}`, handoffId: h.objectId });
          done('TRANSFERRED', { toAgentId: target.agentId, toSessionId: target.sessionId, assignmentId: env.assignmentId, handoffId: h.objectId });
        } catch (e) {
          if (!(e instanceof CommandError)) throw e;
          r.status = e.details?.antiThrashing ? 'FROZEN' : 'PENDING';
          r.lastError = { code: e.code, message: e.message };
          act('RECOVERY_FAILED', { taskId: task.objectId, code: e.code, message: e.message });
        }
      }

      // E. A LOST slot with no remaining active work is recovered to STOPPED (reason recorded).
      for (const agent of this.cp.store.list('AgentState').filter((x) => x.state === 'LOST')) {
        const owned = this.cp.store.list('Task').filter((t) => t.owner?.agentId === agent.objectId && ACTIVE_WORK.has(t.state));
        if (owned.length) continue;
        act('AGENT_RECOVER', { agentId: agent.objectId, to: 'STOPPED' });
        if (!dryRun) {
          this.#exec(MANAGER, 'AGENT_RECOVER', 'AgentState', agent.objectId, { state: 'STOPPED', reasonCode: 'SESSION_LOST_RECOVERED' }, { key: `rt-recover-${agent.objectId}-r${agent.revision}`, reason: 'workforce runtime: lost slot holds no active work; stopped until a new session attaches' });
          emit('SLOT_RECOVERED', now, { agentId: agent.objectId, to: 'STOPPED' });
        }
      }

      // F. A STOPPED slot with a fresh live session is activated (AVAILABLE) so it can receive work.
      for (const s of Object.values(state.sessions).filter((x) => ['IDLE'].includes(x.sessionState) && this.#fresh(state, x, now))) {
        const agent = this.cp.store.get('AgentState', s.agentId);
        if (agent?.state !== 'STOPPED') continue;
        act('AGENT_ACTIVATE', { agentId: s.agentId, sessionId: s.sessionId });
        if (!dryRun) {
          this.#exec(MANAGER, 'AGENT_ACTIVATE', 'AgentState', s.agentId, { reasonCode: 'SESSION_ATTACHED' }, { key: `rt-activate-${s.agentId}-${s.sessionId}`, reason: `workforce runtime: new session ${s.sessionId} registered and heartbeating` });
          emit('SLOT_ACTIVATED', now, { agentId: s.agentId, sessionId: s.sessionId });
        }
      }
      return { ok: true, at: now, dryRun, actions };
    });
  }

  #transferTarget(state, task, now, taken, fromAgentId) {
    const s0 = snapshot(this.cp.store);
    const activeByAgent = new Map();
    const heavyByRunner = new Map();
    for (const t of s0.Task.filter((x) => ACTIVE_WORK.has(x.state) && x.owner)) {
      activeByAgent.set(t.owner.agentId, (activeByAgent.get(t.owner.agentId) ?? 0) + 1);
      if (this.policy.scheduler.heavyBuildCapacityClasses.includes(t.requirements?.capacityClass)) heavyByRunner.set(heavyRunnerClass(t), (heavyByRunner.get(heavyRunnerClass(t)) ?? 0) + 1);
    }
    const ctx = { policy: this.policy, activeByAgent, heavyByRunner, now };
    let best = null;
    for (const s of this.#idleSessions(state, now)) {
      if (s.agentId === fromAgentId || taken.has(s.agentId)) continue;
      const agent = s0.AgentState.find((a) => a.objectId === s.agentId);
      if (!agent) continue;
      const m = matchAgent(task, this.#sessionAgentView(agent, s), ctx);
      if (m.ok && (!best || m.score > best.score || (m.score === best.score && s.agentId < best.s.agentId))) best = { s, score: m.score };
    }
    return best?.s ?? null;
  }

  // ============================================================================ status / acceptance
  status() {
    const state = this.store.read();
    const now = this.now();
    const s0 = snapshot(this.cp.store);
    const agents = new Map(s0.AgentState.map((a) => [a.objectId, a]));
    const tasks = new Map(s0.Task.map((t) => [t.objectId, t]));
    const leases = new Map(s0.Lease.map((l) => [l.objectId, l]));
    const rows = this.policy.workerSlots.map((slot) => {
      const sessions = state ? Object.values(state.sessions).filter((s) => s.agentId === slot) : [];
      const live = sessions.find((s) => LIVE_SESSION_STATES.includes(s.sessionState));
      const last = live ?? sessions.sort((x, y) => y.registeredAt.localeCompare(x.registeredAt))[0];
      const a = live?.assignmentId ? state.assignments[live.assignmentId] : null;
      const t = a ? tasks.get(a.taskId) : null;
      const l = a ? leases.get(a.leaseId) : null;
      const ag = agents.get(slot);
      return {
        slot, slotState: ag?.state ?? 'UNREGISTERED', sessionId: last?.sessionId ?? null, sessionState: last?.sessionState ?? 'NO_SESSION',
        sessionKind: last?.sessionKind ?? null, heartbeatAgeSeconds: live ? Math.round(secondsBetween(live.heartbeatAt, now)) : null,
        assignmentId: a?.assignmentId ?? null, assignmentStatus: a?.status ?? null, taskId: a?.taskId ?? null, taskState: t?.state ?? null,
        leaseId: l?.objectId ?? null, leaseState: l?.state ?? null, leaseExpiresAt: l?.expiresAt ?? null,
        runnerClass: last?.runnerClass ?? ag?.capacity?.runnerClass ?? null, workspace: last?.workspace ?? (state ? slotWorkspace(state.config, slot) : null),
      };
    });
    const integrity = this.integrity(state);
    const liveCount = state ? Object.values(state.sessions).filter((s) => this.#fresh(state, s, now)).length : 0;
    const pendingRecovery = state ? Object.values(state.recovery).filter((r) => r.status !== 'DONE').length : 0;
    let acceptance;
    if (!state) acceptance = 'NOT_BOOTSTRAPPED';
    else if (integrity.length) acceptance = 'FAILED';
    else if (state.liveGate?.status === 'PASS') acceptance = liveCount === this.policy.workerSlots.length && !pendingRecovery ? 'READY' : 'DEGRADED';
    else if (liveCount === 0) acceptance = 'BOOTSTRAPPING';
    else acceptance = 'PARTIAL';
    const kinds = state ? Object.values(state.sessions).filter((s) => this.#fresh(state, s, now)).reduce((m, s) => ({ ...m, [s.sessionKind]: (m[s.sessionKind] ?? 0) + 1 }), {}) : {};
    return { at: now, runtimeVersion: RUNTIME_VERSION, acceptance, liveSessions: liveCount, liveSessionKinds: kinds, pendingRecovery, liveGate: state?.liveGate ?? null, integrity, slots: rows };
  }

  /** Runtime invariants (#295 §17). Any finding makes the acceptance status FAILED. */
  integrity(state = this.store.read()) {
    if (!state) return [];
    const out = [];
    const active = Object.values(state.assignments).filter((a) => ACTIVE_ASSIGNMENT_STATES.includes(a.status));
    const byTask = new Map(); const bySession = new Map(); const byLease = new Map();
    for (const a of active) {
      for (const [m, k, kind] of [[byTask, a.taskId, 'TASK_HAS_TWO_ACTIVE_ASSIGNMENTS'], [bySession, a.sessionId, 'SESSION_HAS_TWO_ACTIVE_ASSIGNMENTS'], [byLease, a.leaseId, 'LEASE_HAS_TWO_ASSIGNMENTS']]) {
        if (m.has(k)) out.push({ kind, ref: k, assignments: [m.get(k), a.assignmentId] }); else m.set(k, a.assignmentId);
      }
      const s = state.sessions[a.sessionId];
      if (!s) out.push({ kind: 'ASSIGNMENT_WITHOUT_SESSION', ref: a.assignmentId });
      else if (s.agentId !== a.agentId) out.push({ kind: 'ASSIGNMENT_SLOT_MISMATCH', ref: a.assignmentId });
    }
    for (const s of Object.values(state.sessions)) {
      if (s.assignmentId && !state.assignments[s.assignmentId]) out.push({ kind: 'SESSION_POINTS_AT_MISSING_ASSIGNMENT', ref: s.sessionId });
    }
    const liveBySlot = new Map();
    for (const s of Object.values(state.sessions).filter((x) => LIVE_SESSION_STATES.includes(x.sessionState))) {
      if (liveBySlot.has(s.agentId)) out.push({ kind: 'SLOT_HAS_TWO_LIVE_SESSIONS', ref: s.agentId }); else liveBySlot.set(s.agentId, s.sessionId);
    }
    return out;
  }

  /**
   * Live acceptance gate (#295 §20), computed ONLY from the observed runtime event log and current
   * state — never from configuration or static files. Local-harness sessions never satisfy it.
   */
  evaluateLiveGate({ record = false } = {}) {
    const state = this.store.read();
    const now = this.now();
    const events = this.store.events();
    const arena = (sid) => state?.sessions[sid]?.sessionKind === 'arena-session' && state?.sessions[sid]?.transport === 'http';
    const liveArena = state ? Object.values(state.sessions).filter((s) => this.#fresh(state, s, now) && arena(s.sessionId)) : [];
    let concurrent = 0; let maxConcurrent = 0;
    const running = new Set();
    for (const e of events) {
      if (e.type === 'ASSIGNMENT_ACKED' && arena(e.sessionId)) running.add(e.assignmentId);
      if ((e.type === 'ASSIGNMENT_ENDED' || (e.type === 'ASSIGNMENT_REPORTED' && ['READY_FOR_REVIEW', 'FAILED'].includes(e.assignmentStatus)))) running.delete(e.assignmentId);
      concurrent = running.size; maxConcurrent = Math.max(maxConcurrent, concurrent);
    }
    const has = (pred) => events.some((e) => pred(e));
    const recoveredTasks = new Set(events.filter((e) => e.type === 'RECOVERY_REQUEUED' || e.type === 'RECOVERY_TRANSFERRED').map((e) => e.taskId));
    const offeredAfterRecovery = events.some((e, i) => e.type === 'ASSIGNMENT_OFFERED' && arena(e.sessionId) && recoveredTasks.has(e.taskId) && events.slice(0, i).some((p) => (p.type === 'RECOVERY_REQUEUED' || p.type === 'RECOVERY_TRANSFERRED') && p.taskId === e.taskId && p.fromSessionId !== e.sessionId));
    const deliveredSessions = new Map();
    let refill = false;
    for (const e of events) {
      if (e.type === 'ASSIGNMENT_REPORTED' && e.assignmentStatus === 'READY_FOR_REVIEW' && arena(e.sessionId)) deliveredSessions.set(e.sessionId, e.seq);
      if (e.type === 'ASSIGNMENT_OFFERED' && deliveredSessions.has(e.sessionId) && e.seq > deliveredSessions.get(e.sessionId)) refill = true;
    }
    const criteria = [
      { id: 'G1_TEN_ARENA_SESSIONS_ONLINE', met: liveArena.length >= this.policy.workerSlots.length, observed: liveArena.length },
      { id: 'G2_TWO_CONCURRENT_ASSIGNMENTS', met: maxConcurrent >= 2, observed: maxConcurrent },
      { id: 'G3_REAL_SESSION_IDS', met: liveArena.length >= this.policy.workerSlots.length, observed: liveArena.map((s) => s.sessionId) },
      { id: 'G4_ACK', met: has((e) => e.type === 'ASSIGNMENT_ACKED' && arena(e.sessionId)) },
      { id: 'G5_HEARTBEAT', met: has((e) => e.type === 'SESSION_FIRST_HEARTBEAT' && arena(e.sessionId)) },
      { id: 'G6_LEASE_RENEWAL', met: has((e) => e.type === 'LEASE_RENEWED' && arena(e.sessionId)) },
      { id: 'G7_SESSION_LOSS', met: has((e) => e.type === 'SESSION_LOST' && arena(e.sessionId)) },
      { id: 'G8_RECOVERY', met: has((e) => (e.type === 'RECOVERY_REQUEUED' || e.type === 'RECOVERY_TRANSFERRED') && arena(e.fromSessionId)) },
      { id: 'G9_REPLACEMENT', met: offeredAfterRecovery },
      { id: 'G10_REFILL', met: refill },
    ];
    const gate = { status: criteria.every((c) => c.met) ? 'PASS' : 'NOT_MET', evaluatedAt: now, criteria, eventsObserved: events.length };
    if (record) this.store.transact((st, emit) => { st.liveGate = gate.status === 'PASS' ? gate : st.liveGate; emit('LIVE_GATE_EVALUATED', now, { status: gate.status, met: criteria.filter((c) => c.met).map((c) => c.id) }); });
    return gate;
  }
}
