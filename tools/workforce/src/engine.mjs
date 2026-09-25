// Workforce control plane — Command API engine (#265 §18-§31, #264 §11-§14).
//
// Pipeline for every authoritative mutation (any failure => NO state mutation):
//   schema -> authenticate actor -> resolve role/capability -> [lock] -> idempotency replay check ->
//   load target -> ownership/scope -> terminal check -> CAS -> lease -> policy/human approval ->
//   references/dependencies/reservations/evidence (handler) -> transition matrix -> schema of every
//   written object -> atomic commit (snapshots + events + idempotency record) -> result.
//
// Authority derives ONLY from the actor registry + canonical policy. Nothing in a command's reason
// or payload can grant, elevate or redefine authority (#266 "prompt is not policy").
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validate, REPO_ROOT } from './schema.mjs';
import { CommandError, ERROR_CODES, addSeconds, canTransition, canonicalJson, fail, isTerminal, isoNow, loadPolicy, sha256 } from './core.mjs';
import { FileStore } from './store.mjs';
import { blockingDependencies, classifyMerge, commandText, detectPromptGovernanceConflict, evaluateReservation, findCycle, normalizeScope, pathsOverlap, scopeFingerprint } from './domain.mjs';

const ACTIVE_WORK = new Set(['CLAIMED', 'ACKNOWLEDGED', 'PREPARING', 'WORKING', 'WAITING_EXTERNAL', 'BLOCKED', 'FROZEN']);
const TRANSFERABLE = new Set(['CLAIMED', 'ACKNOWLEDGED', 'PREPARING', 'WORKING', 'WAITING_EXTERNAL', 'BLOCKED', 'FROZEN', 'HOLD']);
const HANDOFF_REQUIRED_ON_CANCEL = new Set(['PREPARING', 'WORKING', 'WAITING_EXTERNAL', 'BLOCKED', 'HOLD', 'FROZEN']);
const ID_PREFIX = { Task: 'TASK', Reservation: 'RES', Lease: 'LEASE', Evidence: 'EVD', Decision: 'DEC', MergeQueueItem: 'MQ', Handoff: 'HND', Request: 'REQ', Approval: 'APR', JournalEntry: 'JRN' };

function loadCanonicalPrograms() {
  const p = join(REPO_ROOT, 'docs', 'n8n-lego', 'milestones.json');
  if (!existsSync(p)) return null;
  const reg = JSON.parse(readFileSync(p, 'utf8'));
  return new Set([...(reg.programs ?? []).map((x) => x.id), ...(reg.futurePrograms ?? []).map((x) => x.id), 'GOVERNANCE']);
}

export class ControlPlane {
  constructor({ stateDir, policyPath, now = () => isoNow(), fault = null, programs } = {}) {
    const loaded = loadPolicy(policyPath);
    this.policy = loaded.policy;
    this.policyDigest = loaded.digest;
    this.now = now;
    this.store = new FileStore(stateDir, { policy: this.policy, fault });
    this.programs = programs === undefined ? loadCanonicalPrograms() : programs;
  }

  // ------------------------------------------------------------------ bootstrap
  /** Register actor identities. Manager initialization only; recorded as ACTOR_REGISTERED events. */
  bootstrapActors(actors) {
    return this.store.withLock(() => {
      const tx = this.store.begin();
      const now = this.now();
      for (const a of actors) {
        if (tx.get('Actor', a.id)) continue;
        const actor = { schemaVersion: '1.0', objectType: 'Actor', objectId: a.id, revision: 1, createdAt: now, updatedAt: now, events: [], actorType: a.type, enabled: true, displayName: a.displayName ?? null };
        const errors = validate('Actor', actor);
        if (errors.length) throw new Error(`invalid actor ${a.id}: ${errors.join('; ')}`);
        const evt = this.#event(tx, { eventType: 'ACTOR_REGISTERED', obj: actor, fromState: null, toState: null, actor: { type: 'MANAGER', id: 'MANAGER-01' }, commandId: 'CMD-bootstrap', reasonCode: 'BOOTSTRAP' });
        actor.events = [evt.eventId];
        tx.put(actor);
      }
      this.store.commit(tx);
      return this.store.list('Actor').map((a) => a.objectId);
    });
  }

  // ------------------------------------------------------------------ execute
  execute(command) {
    try {
      return this.#execute(command);
    } catch (error) {
      if (error instanceof CommandError) return this.#failure(command, error);
      return this.#failure(command, new CommandError('INTERNAL_RECOVERY_REQUIRED', `unexpected engine failure: ${error.message}`, { recovery: 'store state is unchanged or recoverable from the journal; run reconcile' }));
    }
  }

  #failure(command, error) {
    let current = null;
    try {
      const t = command?.target;
      if (t?.objectType && t?.objectId && t.objectId !== 'NEW') {
        const obj = this.store.get(t.objectType, t.objectId);
        if (obj) current = { revision: obj.revision, state: obj.state ?? null };
      }
    } catch { /* best effort */ }
    return {
      ok: false,
      commandId: command?.commandId ?? null,
      error: { code: error.code, message: error.message, retrySafe: ERROR_CODES[error.code].retrySafe, details: error.details ?? {} },
      current,
      idempotentReplay: false,
    };
  }

  #execute(command) {
    const schemaErrors = validate('Command', command);
    if (schemaErrors.length) fail('INVALID_SCHEMA', 'command envelope is invalid', { errors: schemaErrors });
    const spec = this.policy.commands[command.commandType];
    if (command.target.objectType !== spec.target) fail('INVALID_SCHEMA', `${command.commandType} targets ${spec.target}, not ${command.target.objectType}`);
    const prompt = detectPromptGovernanceConflict(commandText(command));

    // Authenticate: identity must exist in the registry, be enabled and match the declared type.
    const actorRecord = this.store.get('Actor', command.actor.id);
    if (!actorRecord || !actorRecord.enabled || actorRecord.actorType !== command.actor.type) {
      fail('UNAUTHORIZED', `actor ${command.actor.id} is not a registered, enabled ${command.actor.type}`, prompt.conflict ? { promptGovernanceConflict: prompt } : {});
    }
    // Role authorization (before any state is read for mutation).
    const roleRule = spec.roles[command.actor.type];
    if (!roleRule) {
      const code = spec.governance && command.actor.type !== 'MANAGER' ? 'GOVERNANCE_REQUIRED' : 'FORBIDDEN';
      fail(code, `${command.actor.type} may not run ${command.commandType}${code === 'GOVERNANCE_REQUIRED' ? '; file REQUEST_MANAGER_CHANGE' : ''}`, prompt.conflict ? { promptGovernanceConflict: prompt } : {});
    }
    if (command.actor.type === 'SYSTEM') {
      const allow = this.policy.systemActorAllowlist[command.actor.id] ?? [];
      if (!allow.includes(command.commandType) || this.policy.systemNeverAllowed.includes(command.commandType)) fail('FORBIDDEN', `system actor ${command.actor.id} is not allowlisted for ${command.commandType}`);
    }

    return this.store.withLock(() => {
      // A leftover journal is a committed-but-unapplied transaction: roll it forward before reading.
      if (this.store.hasPendingJournal()) this.store.recover();
      const prior = this.store.getIdempotency(command.actor.id, command.idempotencyKey);
      const payloadDigest = sha256(canonicalJson({ commandType: command.commandType, target: command.target, payload: command.payload, expectedRevision: command.expectedRevision }));
      if (prior) {
        if (prior.payloadDigest !== payloadDigest) fail('IDEMPOTENCY_CONFLICT', 'idempotency key was already used with a different semantic payload', { firstCommandId: prior.result.commandId });
        return { ...prior.result, idempotentReplay: true, replayOfCommandId: prior.result.commandId, commandId: command.commandId };
      }
      const tx = this.store.begin();
      const ctx = this.#context(tx, command, spec, roleRule, prompt);
      const handler = HANDLERS[command.commandType];
      if (!handler) fail('INTERNAL_RECOVERY_REQUIRED', `no handler for ${command.commandType}`);
      handler(ctx);
      if (ctx.prompt.conflict) ctx.recordPromptConflict();
      for (const obj of tx.writes.values()) {
        const errors = validate(obj.objectType, obj);
        if (errors.length) fail('INVALID_SCHEMA', `resulting ${obj.objectType} ${obj.objectId} is invalid`, { errors });
      }
      for (const evt of tx.events) {
        const errors = validate('Event', { ...evt });
        if (errors.length) fail('INTERNAL_RECOVERY_REQUIRED', 'engine produced an invalid event', { errors });
      }
      const target = ctx.targetObject;
      const result = {
        ok: true,
        commandId: command.commandId,
        objectType: command.target.objectType,
        objectId: target.objectId,
        previousRevision: ctx.previousRevision,
        newRevision: target.revision,
        resultingState: target.state ?? null,
        eventId: ctx.targetEventId,
        eventIds: tx.events.map((e) => e.eventId),
        idempotentReplay: false,
        sideEffects: ctx.sideEffects,
        warnings: ctx.warnings,
        data: ctx.data,
      };
      tx.setIdempotency(command.actor.id, command.idempotencyKey, { payloadDigest, committedAt: this.now(), result });
      this.store.commit(tx);
      return result;
    });
  }

  #event(tx, { eventType, obj, fromState, toState, actor, commandId, reasonCode, evidenceIds = [] }) {
    const evt = {
      eventId: tx.nextId('EVT', 6),
      eventType,
      objectType: obj.objectType,
      objectId: obj.objectId,
      fromState: fromState ?? null,
      toState: toState ?? null,
      actor,
      revision: obj.revision,
      timestamp: this.now(),
      commandId,
      reasonCode: reasonCode ?? null,
      evidenceIds,
      policyDigest: this.policyDigest,
    };
    tx.event(evt);
    return evt;
  }

  // ------------------------------------------------------------------ handler context
  #context(tx, command, spec, roleRule, prompt) {
    const engine = this;
    const policy = this.policy;
    const now = this.now();
    const actor = command.actor;
    const p = command.payload ?? {};
    const refLimit = policy.events.snapshotEventRefs;
    const ctx = {
      tx, command, spec, policy, now, actor, p, prompt,
      programs: engine.programs,
      isManager: actor.type === 'MANAGER',
      isWorker: actor.type === 'WORKER',
      sideEffects: [],
      warnings: [],
      data: {},
      targetObject: null,
      targetEventId: null,
      previousRevision: command.expectedRevision,

      reason(required) {
        if (!p.reasonCode) {
          if (required) fail('INVALID_SCHEMA', `payload.reasonCode is required for ${command.commandType} (structured reason, #265 §27)`);
          return null;
        }
        return { code: p.reasonCode, summary: command.reason, actor: actor.id, refs: p.refs ?? [] };
      },

      emit(obj, eventType, fromState, toState, reasonCode, evidenceIds) {
        const evt = engine.#event(tx, { eventType, obj, fromState, toState, actor, commandId: command.commandId, reasonCode, evidenceIds });
        obj.events = [...(obj.events ?? []), evt.eventId].slice(-refLimit);
        if (ctx.targetObject && obj.objectType === ctx.targetObject.objectType && obj.objectId === ctx.targetObject.objectId) ctx.targetEventId = evt.eventId;
        return evt;
      },

      create(obj, eventType) {
        obj.schemaVersion = '1.0';
        obj.revision = 1;
        obj.createdAt = now;
        obj.updatedAt = now;
        obj.events = [];
        ctx.emit(obj, eventType, null, obj.state ?? null, p.reasonCode ?? null);
        tx.put(obj);
        return obj;
      },

      /** Move obj to `to` through the exact matrix; bumps revision; emits event; stages the write. */
      transition(obj, to, { eventType, reasonRequired, reasonCode, evidenceIds, managerEdge = false } = {}) {
        const from = obj.state;
        if (isTerminal(policy, obj.objectType, from)) fail('ALREADY_TERMINAL', `${obj.objectType} ${obj.objectId} is terminal (${from})`);
        if (!canTransition(policy, obj.objectType, from, to)) fail('INVALID_STATE_TRANSITION', `${obj.objectType} ${from} -> ${to} is not in the exact state matrix`, { from, to });
        const edges = policy.stateMachines[obj.objectType].managerOnlyEdges?.edges ?? [];
        if (!managerEdge && edges.some(([a, b]) => a === from && b === to) && obj.objectType === 'AgentState' && !ctx.isManager) {
          fail('FORBIDDEN', `${from} -> ${to} is a Manager-only release edge (DEC-0005)`);
        }
        const needReason = reasonRequired ?? policy.reasonRequiredStates.includes(to);
        let reason = null;
        if (reasonCode) reason = { code: reasonCode, summary: command.reason, actor: actor.id, refs: p.refs ?? [] };
        else reason = ctx.reason(needReason);
        obj.state = to;
        obj.revision += 1;
        obj.updatedAt = now;
        if (obj.objectType === 'Task') obj.current.reason = reason;
        else if ('reason' in obj || reason) obj.reason = reason;
        ctx.emit(obj, eventType ?? `${obj.objectType.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}_STATE_CHANGED`, from, to, reason?.code ?? null, evidenceIds);
        tx.put(obj);
        if (obj !== ctx.targetObject) ctx.sideEffects.push({ objectType: obj.objectType, objectId: obj.objectId, state: obj.state });
        return obj;
      },

      /** Non-state mutation with revision bump and (optional) event. */
      touch(obj, eventType, { emitEvent = true } = {}) {
        obj.revision += 1;
        obj.updatedAt = now;
        if (emitEvent) ctx.emit(obj, eventType, obj.state ?? null, obj.state ?? null, p.reasonCode ?? null);
        tx.put(obj);
        if (obj !== ctx.targetObject && !ctx.sideEffects.some((s) => s.objectId === obj.objectId)) ctx.sideEffects.push({ objectType: obj.objectType, objectId: obj.objectId, state: obj.state ?? null });
        return obj;
      },

      mustGet(type, id, what = type) {
        const obj = id ? tx.get(type, id) : null;
        if (!obj) fail('NOT_FOUND', `${what} ${id ?? '(missing id)'} does not exist`);
        return obj;
      },

      newId(type) {
        const prefix = ID_PREFIX[type];
        let id;
        do { id = tx.nextId(prefix); } while (tx.get(type, id));
        return id;
      },

      requireHumanApproval(subjectType, subjectId) {
        const id = p.humanApprovalId;
        const approval = id ? tx.get('Approval', id) : null;
        if (!approval || !['APPROVED', 'OVERRIDE'].includes(approval.state) || approval.commandType !== command.commandType
          || approval.subjectObjectType !== subjectType || approval.subjectObjectId !== subjectId || approval.consumedByCommandId) {
          fail('HUMAN_APPROVAL_REQUIRED', `${command.commandType} on ${subjectType} ${subjectId} requires an unconsumed HUMAN approval (payload.humanApprovalId)`);
        }
        approval.consumedByCommandId = command.commandId;
        ctx.touch(approval, 'APPROVAL_CONSUMED');
        return approval;
      },

      issueLease(leaseType, subject, holder, { predecessorId = null, id = null } = {}) {
        const conf = policy.leases[leaseType];
        const lease = {
          objectType: 'Lease', objectId: id ?? ctx.newId('Lease'), state: 'ACTIVE', leaseType,
          subject: { taskId: null, reservationId: null, queueItemId: null, repository: null, prNumber: null, base: null, headSha: null, ...subject },
          holder, issuedBy: actor.id, issuedAt: now, renewedAt: null,
          expiresAt: addSeconds(now, conf.ttlSeconds), maxExpiresAt: addSeconds(now, conf.maxLifetimeSeconds),
          renewable: conf.renewable, renewCount: 0, predecessorId, successorId: null, reason: null,
        };
        ctx.create(lease, 'LEASE_ISSUED');
        ctx.sideEffects.push({ objectType: 'Lease', objectId: lease.objectId, state: lease.state });
        return lease;
      },

      endLease(leaseId, to, reasonCode) {
        if (!leaseId) return null;
        const lease = tx.get('Lease', leaseId);
        if (!lease || lease.state !== 'ACTIVE') return lease;
        return ctx.transition(lease, to, { reasonCode, reasonRequired: false });
      },

      leaseValidity(lease) {
        if (!lease) return 'MISSING';
        if (lease.state !== 'ACTIVE') return lease.state === 'EXPIRED' ? 'EXPIRED' : 'REVOKED';
        if (Date.parse(now) >= Date.parse(lease.expiresAt)) return 'EXPIRED';
        return 'ACTIVE';
      },

      requireTaskLease(task) {
        const lease = task.execution?.activeLeaseId ? tx.get('Lease', task.execution.activeLeaseId) : null;
        const v = ctx.leaseValidity(lease);
        if (v === 'EXPIRED') fail('LEASE_EXPIRED', `assignment lease ${lease.objectId} expired at ${lease.expiresAt}; the Manager must issue a replacement`);
        if (v !== 'ACTIVE') fail('LEASE_REVOKED', `task ${task.objectId} has no ACTIVE assignment lease (${v})`);
        if (lease.holder !== actor.id) fail('FORBIDDEN', `assignment lease ${lease.objectId} is held by ${lease.holder}`);
        return lease;
      },

      /** Recompute derived agent assignment fields and release the slot when it has no active work. */
      syncAgent(agentId) {
        if (!agentId) return null;
        const agent = tx.get('AgentState', agentId);
        if (!agent) return null;
        const owned = tx.list('Task').filter((t) => t.owner?.agentId === agentId && !isTerminal(policy, 'Task', t.state));
        const active = owned.filter((t) => ACTIVE_WORK.has(t.state));
        const before = canonicalJson({ a: agent.assignment, c: agent.capacity.activeTaskCount });
        agent.assignment = { taskIds: owned.map((t) => t.objectId), lastAssignedAt: agent.assignment?.lastAssignedAt ?? null, lastReleasedAt: agent.assignment?.lastReleasedAt ?? null };
        const released = agent.capacity.activeTaskCount > active.length;
        agent.capacity.activeTaskCount = active.length;
        if (released) agent.assignment.lastReleasedAt = now;
        const releaseStates = ['ASSIGNED', 'PREPARING', 'WORKING', 'WAITING_EXTERNAL', 'BLOCKED', 'READY_FOR_REVIEW', 'VERIFYING'];
        if (active.length === 0 && releaseStates.includes(agent.state)) {
          ctx.transition(agent, 'AVAILABLE', { reasonCode: 'SLOT_RELEASED', reasonRequired: false, managerEdge: true });
        } else if (canonicalJson({ a: agent.assignment, c: agent.capacity.activeTaskCount }) !== before) {
          ctx.touch(agent, 'AGENT_ASSIGNMENT_SYNCED', { emitEvent: false });
        }
        return agent;
      },

      /** Couple the owner's slot state to a task step when (and only when) the edge is legal. */
      coupleAgent(task, expectedFrom, to) {
        const agent = task.owner ? tx.get('AgentState', task.owner.agentId) : null;
        if (agent && expectedFrom.includes(agent.state) && canTransition(policy, 'AgentState', agent.state, to)) {
          ctx.transition(agent, to, { reasonCode: 'TASK_COUPLED', reasonRequired: false });
        }
      },

      checkAgentCanTake(agent, task) {
        if (agent.state === 'RETIRED') fail('POLICY_DENIED', `${agent.objectId} is RETIRED and cannot receive work`);
        if (!agent.identity.enabled) fail('POLICY_DENIED', `${agent.objectId} is disabled`);
        if (!['AVAILABLE', 'STOPPED', 'ASSIGNED', 'PREPARING', 'WORKING', 'WAITING_EXTERNAL', 'BLOCKED', 'READY_FOR_REVIEW', 'VERIFYING'].includes(agent.state)) fail('POLICY_DENIED', `${agent.objectId} is ${agent.state} and cannot receive work`);
        const actorRec = tx.get('Actor', agent.objectId);
        if (!actorRec?.enabled) fail('POLICY_DENIED', `${agent.objectId} has no enabled WORKER identity`);
        const need = task.requirements?.capabilities ?? [];
        const missing = need.filter((c) => !agent.capabilities.includes(c));
        if (missing.length) fail('POLICY_DENIED', `${agent.objectId} lacks capabilities: ${missing.join(', ')}`, { missing });
        const runners = task.requirements?.runnerClasses ?? [];
        if (runners.length && !runners.includes('ANY') && agent.capacity.runnerClass !== 'ANY' && !runners.includes(agent.capacity.runnerClass)) {
          fail('POLICY_DENIED', `${agent.objectId} runner class ${agent.capacity.runnerClass} does not satisfy ${runners.join('/')}`);
        }
        const perWorker = Math.min(agent.capacity.maxConcurrentTasks, policy.backpressure.maxTasksPerWorker);
        const active = tx.list('Task').filter((t) => t.owner?.agentId === agent.objectId && ACTIVE_WORK.has(t.state)).length;
        if (active >= perWorker) fail('RESOURCE_UNAVAILABLE', `${agent.objectId} is at capacity (${active}/${perWorker})`);
      },

      recordPromptConflict() {
        const req = {
          objectType: 'Request', objectId: ctx.newId('Request'), state: 'OPEN', kind: 'PROMPT_GOVERNANCE_CONFLICT',
          requestedBy: 'control-plane', summary: `Instruction text in ${command.commandType} from ${actor.id} attempted governance/authority change; authority unchanged`,
          subject: { objectType: command.target.objectType, objectId: ctx.targetObject?.objectId ?? command.target.objectId, current: null, requested: null },
          findings: prompt.findings, resolution: null,
        };
        ctx.create(req, 'REQUEST_OPENED');
        ctx.warnings.push({ class: 'PROMPT_GOVERNANCE_CONFLICT', findings: prompt.findings, requestId: req.objectId });
      },
    };

    // Load target / enforce create semantics / ownership / terminal / CAS.
    if (spec.kind === 'create') {
      if (command.expectedRevision !== 0) fail('REVISION_CONFLICT', 'create commands require expectedRevision 0');
      let id = command.target.objectId;
      if (id === 'NEW') {
        if (spec.target === 'AgentState') fail('INVALID_SCHEMA', 'AgentState ids are fixed worker slots');
        id = ctx.newId(spec.target);
      } else {
        const pattern = policy.idPatterns[spec.target];
        if (!new RegExp(pattern).test(id)) fail('INVALID_SCHEMA', `${id} does not match ${pattern}`);
        if (tx.get(spec.target, id)) fail('DUPLICATE', `${spec.target} ${id} already exists`);
        const m = /-(\d+)$/.exec(id);
        if (m && ID_PREFIX[spec.target]) tx.reserveSequenceAtLeast(ID_PREFIX[spec.target], Number(m[1]));
      }
      ctx.newObjectId = id;
      ctx.previousRevision = 0;
    } else {
      const obj = tx.get(spec.target, command.target.objectId);
      if (!obj) fail('NOT_FOUND', `${spec.target} ${command.target.objectId} does not exist`);
      ctx.targetObject = obj;
      ctx.previousRevision = obj.revision;
      // ownership
      const own = {
        own: () => (spec.target === 'AgentState' ? obj.objectId === actor.id : obj.owner?.agentId === actor.id),
        'own-lease': () => obj.holder === actor.id,
        'own-evidence': () => obj.producedBy === actor.id,
        'own-task': () => { const t = tx.get('Task', obj.taskId); return t?.owner?.agentId === actor.id; },
        any: () => true,
        allowlist: () => true,
      }[roleRule];
      if (!own || !own()) fail('FORBIDDEN', `${actor.id} does not own ${spec.target} ${obj.objectId}; route a REQUEST through the Manager`, prompt.conflict ? { promptGovernanceConflict: prompt } : {});
      if (obj.state && isTerminal(policy, spec.target, obj.state)) fail('ALREADY_TERMINAL', `${spec.target} ${obj.objectId} is terminal (${obj.state})`);
      if (obj.revision !== command.expectedRevision) fail('REVISION_CONFLICT', `expected revision ${command.expectedRevision}, current ${obj.revision}`, { currentRevision: obj.revision, currentState: obj.state ?? null });
      // Precondition: the declared target state must be reachable from the current state (exact matrix)
      // before any deeper gate runs, so callers get the structural reason first.
      if (spec.to && obj.state && !spec.toFromPayload && !canTransition(policy, spec.target, obj.state, spec.to)) {
        fail('INVALID_STATE_TRANSITION', `${spec.target} ${obj.state} -> ${spec.to} is not in the exact state matrix`, { from: obj.state, to: spec.to });
      }
      if (spec.from && !spec.from.includes(obj.state)) fail('INVALID_STATE_TRANSITION', `${command.commandType} requires ${spec.from.join('/')}, current ${obj.state}`);
      if (spec.requiresLease === 'TASK_ASSIGNMENT' && ctx.isWorker) ctx.requireTaskLease(obj);
    }
    if (spec.kind === 'create' && roleRule === 'own-task') {
      const t = tx.get('Task', p.taskId);
      if (!t) fail('NOT_FOUND', `task ${p.taskId} does not exist`);
      if (t.owner?.agentId !== actor.id) fail('FORBIDDEN', `${actor.id} does not own task ${p.taskId}`, prompt.conflict ? { promptGovernanceConflict: prompt } : {});
    }
    return ctx;
  }
}

// ======================================================================================= handlers
function emptyScope(scope = {}) {
  const dims = ['paths', 'domains', 'contracts', 'generatedSurfaces', 'vocabulary', 'semanticSurfaces', 'securitySurfaces', 'governanceSurfaces'];
  return Object.fromEntries(dims.map((d) => [d, [...(scope[d] ?? [])]]));
}

function taskOf(ctx) { return ctx.targetObject; }

function releaseTaskAuthority(ctx, task, { leaseTo = 'REVOKED', reasonCode = 'TASK_RELEASED' } = {}) {
  ctx.endLease(task.execution?.activeLeaseId, leaseTo, reasonCode);
  task.execution.activeLeaseId = null;
  for (const res of ctx.tx.list('Reservation').filter((r) => r.taskId === task.objectId && !isTerminal(ctx.policy, 'Reservation', r.state))) {
    ctx.endLease(res.leaseId, leaseTo === 'REVOKED' ? 'REVOKED' : 'COMPLETED', reasonCode);
    if (res.state === 'ACTIVE') { res.releasedAt = ctx.now; ctx.transition(res, 'RELEASED', { reasonCode, reasonRequired: false }); }
    else if (['CHECKING', 'RESERVED'].includes(res.state)) ctx.transition(res, 'REJECTED', { reasonCode, reasonRequired: false });
    else if (res.state === 'REQUESTED') { ctx.transition(res, 'CHECKING', { reasonCode, reasonRequired: false }); ctx.transition(res, 'REJECTED', { reasonCode, reasonRequired: false }); }
    else if (res.state === 'CONFLICT') { ctx.transition(res, 'CHECKING', { reasonCode, reasonRequired: false }); ctx.transition(res, 'REJECTED', { reasonCode, reasonRequired: false }); }
  }
  task.execution.reservationIds = [];
}

function taskMergeItem(ctx, taskId, states) {
  return ctx.tx.list('MergeQueueItem').find((m) => m.taskId === taskId && states.includes(m.state)) ?? null;
}

function verifiedEvidence(ctx, taskId) {
  return ctx.tx.list('Evidence').filter((e) => e.taskId === taskId && e.state === 'VERIFIED');
}

const trustRank = (policy, level) => policy.evidence.trustOrder.indexOf(level);

function computedGates(ctx, item) {
  const task = ctx.tx.get('Task', item.taskId);
  const head = item.pr.headSha;
  const ev = ctx.tx.list('Evidence').filter((e) => e.taskId === item.taskId && ['PUBLISHED', 'VERIFIED'].includes(e.state));
  const anchoredAtHead = (e) => ['COMMIT', 'PR_HEAD'].includes(e.subject?.subjectType) && e.subject.subjectId === head;
  const commitOk = ev.some((e) => e.type === 'COMMIT' && anchoredAtHead(e));
  const ciOk = ev.some((e) => e.type === 'CI' && e.result.status === 'PASS' && anchoredAtHead(e) && trustRank(ctx.policy, e.trustLevel) >= trustRank(ctx.policy, 'CI_VERIFIED'));
  const reservations = ctx.tx.list('Reservation').filter((r) => r.taskId === item.taskId && !isTerminal(ctx.policy, 'Reservation', r.state));
  const reservationClear = reservations.every((r) => r.state === 'ACTIVE');
  const tasksById = new Map(ctx.tx.list('Task').map((t) => [t.objectId, t]));
  const blocking = task ? blockingDependencies(task, tasksById) : [];
  const managerLaneReservation = reservations.some((r) => ctx.policy.reservation.managerLaneModes.includes(r.mode) && r.state === 'ACTIVE');
  return {
    evidence: commitOk && ciOk ? 'PASS' : 'FAIL',
    reservation: reservationClear ? 'CLEAR' : 'BLOCKED',
    dependency: blocking.length ? 'BLOCKED' : 'CLEAR',
    blocking: blocking.map((b) => b.taskId),
    managerLaneReservation,
    task,
  };
}

function applyClassification(ctx, item) {
  const g = computedGates(ctx, item);
  item.checks = { ...item.checks, evidence: g.evidence, reservation: g.reservation, dependency: g.dependency };
  const verdict = classifyMerge(item, ctx.policy, { task: g.task, managerLaneReservation: g.managerLaneReservation, unresolvedDependencies: g.blocking });
  item.lane = verdict.lane;
  item.laneReasons = verdict.reasons;
  return verdict;
}

function holdMergeItem(ctx, item, reasonCode) {
  if (item.authorizationLeaseId) { ctx.endLease(item.authorizationLeaseId, 'REVOKED', reasonCode); item.authorizationLeaseId = null; }
  if (item.state !== 'HOLD') ctx.transition(item, 'HOLD', { reasonCode });
  const task = ctx.tx.get('Task', item.taskId);
  if (task?.state === 'MERGING') ctx.transition(task, 'HOLD', { reasonCode });
}

function validateAnchor(ctx, type, subject) {
  const anchorless = ctx.policy.evidence.anchorlessTypes.includes(type);
  if (!subject) { if (anchorless) return; fail('EVIDENCE_INSUFFICIENT', `${type} evidence must be anchored to an immutable subject`); }
  const sha = /^[0-9a-f]{40}$/;
  switch (subject.subjectType) {
    case 'COMMIT': case 'MAIN':
      if (!sha.test(subject.subjectId)) fail('EVIDENCE_INSUFFICIENT', `${subject.subjectType} anchor must be a full 40-hex SHA`); break;
    case 'PR_HEAD':
      if (!sha.test(subject.subjectId) || !Number.isInteger(subject.prNumber)) fail('EVIDENCE_INSUFFICIENT', 'PR_HEAD anchor needs the exact head SHA and prNumber'); break;
    case 'WORKFLOW_RUN':
      if (!/^[0-9]+$/.test(subject.subjectId) || !sha.test(subject.subjectDigest ?? '')) fail('EVIDENCE_INSUFFICIENT', 'WORKFLOW_RUN anchor needs the run id and the head SHA it ran on (subjectDigest)'); break;
    case 'ARTIFACT':
      if (!/^sha256:[0-9a-f]{64}$/.test(subject.subjectDigest ?? '')) fail('EVIDENCE_INSUFFICIENT', 'ARTIFACT anchor needs a sha256 digest'); break;
    default: fail('EVIDENCE_INSUFFICIENT', `unknown anchor type ${subject.subjectType}`);
  }
  if (type === 'MAIN_VERIFICATION' && subject.subjectType !== 'MAIN') fail('EVIDENCE_INSUFFICIENT', 'MAIN_VERIFICATION evidence must be anchored to a main SHA');
}

const HANDLERS = {
  // ---------------------------------------------------------------- Task
  TASK_CREATE(ctx) {
    const { p, tx } = ctx;
    if (ctx.programs && !ctx.programs.has(p.program)) fail('POLICY_DENIED', `program ${p.program} is not a canonical program in docs/n8n-lego/milestones.json (no new P numbers without a strategic decision)`);
    const deps = (p.dependencies ?? []).map((d) => ({ taskId: d.taskId, type: d.type ?? 'REQUIRED', condition: d.condition ?? null, conditionMet: d.conditionMet ?? null }));
    for (const d of deps) {
      if (d.taskId === ctx.newObjectId) fail('DEPENDENCY_BLOCKED', 'self-dependency is a cycle');
      ctx.mustGet('Task', d.taskId, 'dependency task');
    }
    const task = {
      objectType: 'Task', objectId: ctx.newObjectId, state: 'UNASSIGNED', jobId: p.jobId ?? null, issue: p.issue ?? null,
      program: p.program, milestone: p.milestone ?? null, slice: p.slice ?? null, title: p.title, description: p.description ?? '',
      priority: p.priority ?? 'NORMAL', risk: p.risk ?? 'NORMAL', owner: null, dependencies: deps, scope: emptyScope(p.scope),
      constraints: { forbiddenPaths: [], forbiddenDomains: [], forbiddenContracts: [], securityBoundaries: [], workspaceBoundary: 'task-scoped', ...(p.constraints ?? {}) },
      requirements: { capabilities: [], capacityClass: 'NORMAL', runnerClasses: ['ANY'], network: 'NONE', ...(p.requirements ?? {}) },
      acceptance: { criteria: [], requiredEvidenceTypes: [], requiredGates: [], ...(p.acceptance ?? {}) },
      execution: { mergeLane: p.execution?.mergeLane ?? 'MANAGER', rollbackClass: p.execution?.rollbackClass ?? 'SIMPLE', activeLeaseId: null, reservationIds: [], decisionPending: p.execution?.decisionPending ?? false, hold: p.execution?.hold ?? false },
      branch: { persistentBranch: null, taskBranch: null, baseSha: p.branch?.baseSha ?? null },
      current: { headSha: null, prNumber: null, nextAction: p.nextAction ?? null, blocker: null, handoffId: null, reason: null, supersededBy: null, completedMainSha: null },
      history: { reassignedCount: 0, retryCount: 0, recoveryCount: 0, deferCount: 0, ciRetryCount: 0, reservationConflictCount: 0, scopeCorrectionCount: 0 },
    };
    const tasks = new Map(tx.list('Task').map((t) => [t.objectId, t]));
    tasks.set(task.objectId, task);
    const cycle = findCycle(tasks, task.objectId);
    if (cycle) fail('DEPENDENCY_BLOCKED', `dependency cycle: ${cycle.join(' -> ')}`, { cycle });
    if (tx.list('Task').filter((t) => t.state === 'UNASSIGNED').length >= ctx.policy.backpressure.maxQueuedTasks) fail('RESOURCE_UNAVAILABLE', 'task queue is at maxQueuedTasks (backpressure)');
    ctx.targetObject = task;
    ctx.create(task, 'TASK_CREATED');
  },

  TASK_ADD_DEPENDENCY(ctx) {
    const task = taskOf(ctx);
    const { taskId, type = 'REQUIRED', condition = null, conditionMet = null } = ctx.p;
    ctx.mustGet('Task', taskId, 'dependency task');
    if (task.dependencies.some((d) => d.taskId === taskId)) fail('DUPLICATE', `${task.objectId} already depends on ${taskId}`);
    const tasks = new Map(ctx.tx.list('Task').map((t) => [t.objectId, t]));
    const cycle = findCycle(tasks, task.objectId, [[task.objectId, taskId]]);
    if (cycle) fail('DEPENDENCY_BLOCKED', `dependency cycle: ${cycle.join(' -> ')}`, { cycle });
    task.dependencies.push({ taskId, type, condition, conditionMet });
    ctx.touch(task, 'TASK_DEPENDENCY_ADDED');
  },

  TASK_ASSIGN(ctx) {
    const task = taskOf(ctx);
    const agent = ctx.mustGet('AgentState', ctx.p.agentId, 'agent');
    if (task.execution.hold || task.execution.decisionPending) fail('POLICY_DENIED', `${task.objectId} is on hold / waiting for a Manager decision`);
    ctx.checkAgentCanTake(agent, task);
    const active = ctx.tx.list('Task').filter((t) => ACTIVE_WORK.has(t.state)).length;
    if (active >= ctx.policy.backpressure.maxActiveTasks) fail('RESOURCE_UNAVAILABLE', `maxActiveTasks (${ctx.policy.backpressure.maxActiveTasks}) reached — queue instead of spawning (backpressure)`);
    const lease = ctx.issueLease('TASK_ASSIGNMENT', { taskId: task.objectId }, agent.objectId);
    task.owner = { agentId: agent.objectId, assignedAt: ctx.now, assignedBy: ctx.actor.id };
    task.execution.activeLeaseId = lease.objectId;
    task.branch.persistentBranch = agent.slot;
    task.branch.taskBranch = `${agent.slot}/${task.objectId}`;
    ctx.transition(task, 'CLAIMED', { eventType: 'TASK_ASSIGNED' });
    agent.assignment = { ...(agent.assignment ?? {}), lastAssignedAt: ctx.now };
    if (['AVAILABLE', 'STOPPED'].includes(agent.state)) ctx.transition(agent, 'ASSIGNED', { reasonCode: 'TASK_ASSIGNED', reasonRequired: false });
    ctx.syncAgent(agent.objectId);
    ctx.data.leaseId = lease.objectId;
  },

  TASK_UNCLAIM(ctx) {
    const task = taskOf(ctx);
    const prev = task.owner?.agentId;
    releaseTaskAuthority(ctx, task, { reasonCode: ctx.p.reasonCode ?? 'CLAIM_WITHDRAWN' });
    task.owner = null;
    task.branch.persistentBranch = null; task.branch.taskBranch = null;
    ctx.transition(task, 'UNASSIGNED', { eventType: 'TASK_UNCLAIMED', reasonCode: ctx.p.reasonCode ?? 'CLAIM_WITHDRAWN' });
    ctx.syncAgent(prev);
  },

  TASK_ACK(ctx) { ctx.transition(taskOf(ctx), 'ACKNOWLEDGED', { eventType: 'TASK_ACKNOWLEDGED' }); },

  TASK_PREPARE(ctx) {
    const task = taskOf(ctx);
    ctx.transition(task, 'PREPARING', { eventType: 'TASK_PREPARING' });
    ctx.coupleAgent(task, ['ASSIGNED'], 'PREPARING');
  },

  TASK_START(ctx) {
    const task = taskOf(ctx);
    const from = task.state;
    ctx.transition(task, 'WORKING', { eventType: from === 'PREPARING' ? 'TASK_STARTED' : 'TASK_RESUMED' });
    ctx.coupleAgent(task, ['PREPARING', 'BLOCKED', 'WAITING_EXTERNAL'], 'WORKING');
  },

  TASK_WAIT_EXTERNAL(ctx) {
    const task = taskOf(ctx);
    ctx.transition(task, 'WAITING_EXTERNAL', { eventType: 'TASK_WAITING_EXTERNAL' });
    ctx.coupleAgent(task, ['WORKING'], 'WAITING_EXTERNAL');
  },

  TASK_BLOCK(ctx) {
    const task = taskOf(ctx);
    task.current.blocker = ctx.reason(true);
    ctx.transition(task, 'BLOCKED', { eventType: 'TASK_BLOCKED' });
    ctx.coupleAgent(task, ['PREPARING', 'WORKING', 'WAITING_EXTERNAL'], 'BLOCKED');
  },

  TASK_PROGRESS(ctx) {
    const task = taskOf(ctx);
    const { headSha, prNumber, nextAction, baseSha } = ctx.p;
    if (headSha !== undefined) task.current.headSha = headSha;
    if (prNumber !== undefined) task.current.prNumber = prNumber;
    if (nextAction !== undefined) task.current.nextAction = nextAction;
    if (baseSha !== undefined) task.branch.baseSha = baseSha;
    if (ctx.p.ciRetry === true) task.history.ciRetryCount += 1;
    if (ctx.p.scopeCorrection === true) task.history.scopeCorrectionCount += 1;
    ctx.touch(task, 'TASK_PROGRESS');
    const agent = task.owner ? ctx.tx.get('AgentState', task.owner.agentId) : null;
    if (agent && ctx.isWorker) { agent.heartbeat = { ...agent.heartbeat, lastProgressAt: ctx.now, lastSeenAt: ctx.now }; ctx.touch(agent, 'AGENT_PROGRESS', { emitEvent: false }); }
  },

  TASK_READY_FOR_REVIEW(ctx) {
    const task = taskOf(ctx);
    if (ctx.p.headSha) task.current.headSha = ctx.p.headSha;
    if (ctx.p.prNumber) task.current.prNumber = ctx.p.prNumber;
    if (!task.current.headSha) fail('EVIDENCE_INSUFFICIENT', 'READY_FOR_REVIEW requires the exact PR head SHA (payload.headSha)');
    task.current.blocker = null;
    ctx.transition(task, 'READY_FOR_REVIEW', { eventType: 'TASK_READY_FOR_REVIEW' });
    ctx.coupleAgent(task, ['WORKING'], 'READY_FOR_REVIEW');
    ctx.syncAgent(task.owner?.agentId);
  },

  TASK_HOLD(ctx) { ctx.transition(taskOf(ctx), 'HOLD', { eventType: 'TASK_HELD' }); },
  TASK_RESUME_REVIEW(ctx) { ctx.transition(taskOf(ctx), 'READY_FOR_REVIEW', { eventType: 'TASK_READY_FOR_REVIEW' }); },

  TASK_REWORK(ctx) {
    const task = taskOf(ctx);
    const item = taskMergeItem(ctx, task.objectId, ['QUEUED', 'READY', 'HOLD']);
    if (item) { if (item.state === 'READY') holdMergeItem(ctx, item, 'TASK_REWORK'); ctx.transition(item, 'REJECTED', { reasonCode: 'TASK_REWORK' }); }
    task.history.retryCount += 1;
    const lease = task.execution.activeLeaseId ? ctx.tx.get('Lease', task.execution.activeLeaseId) : null;
    if (task.owner && ctx.leaseValidity(lease) !== 'ACTIVE') {
      if (lease?.state === 'ACTIVE') ctx.transition(lease, 'EXPIRED', { reasonCode: 'LEASE_TTL_ELAPSED', reasonRequired: false });
      const next = ctx.issueLease('TASK_ASSIGNMENT', { taskId: task.objectId }, task.owner.agentId, { predecessorId: lease?.objectId ?? null });
      if (lease) { lease.successorId = next.objectId; ctx.touch(lease, 'LEASE_SUCCESSOR_LINKED', { emitEvent: false }); }
      task.execution.activeLeaseId = next.objectId;
    }
    ctx.transition(task, 'WORKING', { eventType: 'TASK_REWORK', reasonCode: ctx.p.reasonCode ?? 'REWORK_REQUESTED' });
    ctx.syncAgent(task.owner?.agentId);
  },

  TASK_MERGE_START(ctx) {
    const task = taskOf(ctx);
    if (!taskMergeItem(ctx, task.objectId, ['MERGING'])) fail('POLICY_DENIED', 'task can only enter MERGING through its merge-queue item (MQ_MERGE_START)');
    ctx.transition(task, 'MERGING');
  },

  TASK_VERIFY_START(ctx) {
    const task = taskOf(ctx);
    if (!taskMergeItem(ctx, task.objectId, ['VERIFYING', 'MERGED'])) fail('POLICY_DENIED', 'task can only enter VERIFYING after its merge result is recorded (MQ_MERGE_RESULT)');
    ctx.transition(task, 'VERIFYING');
  },

  TASK_COMPLETE(ctx) {
    const task = taskOf(ctx);
    const tasks = new Map(ctx.tx.list('Task').map((t) => [t.objectId, t]));
    const blocking = blockingDependencies(task, tasks);
    if (blocking.length) fail('DEPENDENCY_BLOCKED', `required dependencies incomplete: ${blocking.map((b) => `${b.taskId}(${b.state})`).join(', ')}`, { blocking });
    const merged = taskMergeItem(ctx, task.objectId, ['MERGED']);
    if (!merged) fail('EVIDENCE_INSUFFICIENT', 'no MERGED merge-queue item for this task (MERGED != COMPLETE without fresh-main verification)');
    const ev = verifiedEvidence(ctx, task.objectId).filter((e) => e.type !== 'CLAIM');
    const required = [...new Set([...ctx.policy.completion.requiredEvidenceTypes, ...(task.acceptance.requiredEvidenceTypes ?? [])])].filter((t) => t !== 'CLAIM');
    const missing = required.filter((t) => !ev.some((e) => e.type === t));
    if (missing.length) fail('EVIDENCE_INSUFFICIENT', `missing VERIFIED evidence: ${missing.join(', ')}`, { missing });
    const mainEv = ev.find((e) => e.type === 'MAIN_VERIFICATION' && ctx.policy.completion.mainVerificationTrust.includes(e.trustLevel) && e.result.status === 'PASS');
    if (!mainEv) fail('EVIDENCE_INSUFFICIENT', 'fresh-main verification evidence (MAIN_VERIFICATION, trust >= MAIN_VERIFIED, PASS) is required');
    if (merged.verifiedMainSha !== mainEv.subject.subjectId) fail('EVIDENCE_INSUFFICIENT', 'main verification evidence does not match the merge item verified main SHA');
    task.current.completedMainSha = mainEv.subject.subjectId;
    releaseTaskAuthority(ctx, task, { leaseTo: 'COMPLETED', reasonCode: 'TASK_COMPLETED' });
    ctx.transition(task, 'COMPLETED', { eventType: 'TASK_COMPLETED', evidenceIds: ev.map((e) => e.objectId) });
    ctx.syncAgent(task.owner?.agentId);
  },

  TASK_COMPLETE_MANAGER_EXECUTED(ctx) {
    // DEC-0011: Manager-executed governance work. Same evidence bar as TASK_COMPLETE; the MERGED
    // merge-queue item is replaced by a VERIFIED COMMIT anchored to the declared merge SHA.
    const task = taskOf(ctx);
    const spec = ctx.policy.managerExecuted;
    if (!spec) fail('POLICY_DENIED', 'policy.managerExecuted is not configured');
    if (task.owner) fail('POLICY_DENIED', `${task.objectId} was assigned to ${task.owner.agentId}; use TASK_COMPLETE`);
    const tasks = new Map(ctx.tx.list('Task').map((t) => [t.objectId, t]));
    const blocking = blockingDependencies(task, tasks);
    if (blocking.length) fail('DEPENDENCY_BLOCKED', `required dependencies incomplete: ${blocking.map((b) => `${b.taskId}(${b.state})`).join(', ')}`, { blocking });
    const mergeSha = ctx.p.mergeSha;
    if (!/^[0-9a-f]{40}$/.test(mergeSha ?? '')) fail('EVIDENCE_INSUFFICIENT', 'payload.mergeSha (40-hex) is required');
    const ev = verifiedEvidence(ctx, task.objectId).filter((e) => e.type !== 'CLAIM');
    const required = [...new Set([...spec.requiredEvidenceTypes, ...(task.acceptance.requiredEvidenceTypes ?? [])])].filter((t) => t !== 'CLAIM');
    const missing = required.filter((t) => !ev.some((e) => e.type === t));
    if (missing.length) fail('EVIDENCE_INSUFFICIENT', `missing VERIFIED evidence: ${missing.join(', ')}`, { missing });
    if (!ev.some((e) => e.type === 'COMMIT' && e.subject?.subjectId === mergeSha)) fail('EVIDENCE_INSUFFICIENT', 'no VERIFIED COMMIT evidence anchored to payload.mergeSha');
    const mainEv = ev.find((e) => e.type === 'MAIN_VERIFICATION' && ctx.policy.completion.mainVerificationTrust.includes(e.trustLevel) && e.result.status === 'PASS');
    if (!mainEv) fail('EVIDENCE_INSUFFICIENT', 'fresh-main verification evidence (MAIN_VERIFICATION, trust >= MAIN_VERIFIED, PASS) is required');
    task.current.completedMainSha = mainEv.subject.subjectId;
    if (task.execution) { task.execution.hold = false; task.execution.decisionPending = false; }
    ctx.transition(task, 'COMPLETED', { eventType: 'TASK_COMPLETED', evidenceIds: ev.map((e) => e.objectId) });
  },

  TASK_FREEZE(ctx) {
    const task = taskOf(ctx);
    ctx.transition(task, 'FROZEN', { eventType: 'TASK_FROZEN' });
  },

  TASK_UNFREEZE(ctx) {
    const task = taskOf(ctx);
    if (!ctx.p.decisionId) fail('GOVERNANCE_REQUIRED', 'unfreezing requires the Manager decision that diagnosed the task (payload.decisionId)');
    const dec = ctx.mustGet('Decision', ctx.p.decisionId, 'decision');
    if (dec.state !== 'ACTIVE') fail('GOVERNANCE_REQUIRED', `decision ${dec.objectId} is ${dec.state}, not ACTIVE`);
    ctx.transition(task, 'WORKING', { eventType: 'TASK_UNFROZEN', reasonCode: ctx.p.reasonCode ?? 'DIAGNOSED' });
  },

  TASK_CANCEL(ctx) {
    const task = taskOf(ctx);
    if (HANDOFF_REQUIRED_ON_CANCEL.has(task.state)) {
      const h = ctx.p.handoffId ? ctx.tx.get('Handoff', ctx.p.handoffId) : null;
      if (!h || h.taskId !== task.objectId) fail('POLICY_DENIED', 'cancelling work in progress requires a handoff for this task (cancellation is not deletion)');
      task.current.handoffId = h.objectId;
    }
    for (const item of ctx.tx.list('MergeQueueItem').filter((m) => m.taskId === task.objectId && !isTerminal(ctx.policy, 'MergeQueueItem', m.state))) {
      if (item.state === 'READY') holdMergeItem(ctx, item, 'TASK_CANCELLED');
      ctx.transition(item, 'REJECTED', { reasonCode: 'TASK_CANCELLED' });
    }
    releaseTaskAuthority(ctx, task, { reasonCode: 'TASK_CANCELLED' });
    ctx.transition(task, 'CANCELLED', { eventType: 'TASK_CANCELLED' });
    ctx.syncAgent(task.owner?.agentId);
  },

  TASK_SUPERSEDE(ctx) {
    const task = taskOf(ctx);
    const repl = ctx.mustGet('Task', ctx.p.supersededBy, 'replacement task');
    if (repl.objectId === task.objectId) fail('POLICY_DENIED', 'a task cannot supersede itself');
    task.current.supersededBy = repl.objectId;
    releaseTaskAuthority(ctx, task, { reasonCode: 'TASK_SUPERSEDED' });
    ctx.transition(task, 'SUPERSEDED', { eventType: 'TASK_SUPERSEDED' });
    ctx.syncAgent(task.owner?.agentId);
  },

  TASK_TRANSFER(ctx) {
    const task = taskOf(ctx);
    const { policy, tx } = ctx;
    if (!TRANSFERABLE.has(task.state)) fail('INVALID_STATE_TRANSITION', `a ${task.state} task cannot be transferred`);
    if (!task.owner) fail('POLICY_DENIED', 'task has no owner to transfer from');
    const to = ctx.mustGet('AgentState', ctx.p.toAgentId, 'successor agent');
    if (to.objectId === task.owner.agentId) fail('POLICY_DENIED', 'successor equals current owner');
    const handoff = ctx.p.handoffId ? tx.get('Handoff', ctx.p.handoffId) : null;
    if (!handoff || handoff.taskId !== task.objectId) fail('POLICY_DENIED', 'transfer requires a handoff for this task (never silently change owner)');
    if (task.history.reassignedCount >= policy.antiThrashing.reassignFreezeThreshold) {
      const dec = ctx.p.decisionId ? tx.get('Decision', ctx.p.decisionId) : null;
      if (!dec || dec.state !== 'ACTIVE') fail('POLICY_DENIED', `anti-thrashing: ${task.history.reassignedCount} reassignments; FREEZE -> DIAGNOSE -> ACTIVE decision required (payload.decisionId)`, { antiThrashing: true });
    }
    ctx.checkAgentCanTake(to, task);
    const from = tx.get('AgentState', task.owner.agentId);
    const oldLease = task.execution.activeLeaseId ? tx.get('Lease', task.execution.activeLeaseId) : null;
    const newLease = ctx.issueLease('TASK_ASSIGNMENT', { taskId: task.objectId }, to.objectId, { predecessorId: oldLease?.objectId ?? null });
    if (oldLease && oldLease.state === 'ACTIVE') { oldLease.successorId = newLease.objectId; ctx.transition(oldLease, 'TRANSFERRED', { reasonCode: 'TASK_TRANSFERRED', reasonRequired: false }); }
    const newReservationIds = [];
    for (const res of tx.list('Reservation').filter((r) => r.taskId === task.objectId && r.state === 'ACTIVE')) {
      newReservationIds.push(transferReservation(ctx, res, to.objectId).objectId);
    }
    task.execution.activeLeaseId = newLease.objectId;
    task.execution.reservationIds = newReservationIds;
    if (from?.state === 'LOST') task.history.recoveryCount += 1;
    task.history.reassignedCount += 1;
    task.current.handoffId = handoff.objectId;
    task.owner = { agentId: to.objectId, assignedAt: ctx.now, assignedBy: ctx.actor.id };
    task.branch.persistentBranch = to.slot;
    task.branch.taskBranch = `${to.slot}/${task.objectId}`;
    ctx.touch(task, 'TASK_TRANSFERRED');
    to.assignment = { ...(to.assignment ?? {}), lastAssignedAt: ctx.now };
    if (['AVAILABLE', 'STOPPED'].includes(to.state)) ctx.transition(to, 'ASSIGNED', { reasonCode: 'TASK_TRANSFERRED', reasonRequired: false });
    ctx.syncAgent(to.objectId);
    ctx.syncAgent(from?.objectId);
  },

  TASK_DEFER(ctx) {
    const task = taskOf(ctx);
    task.history.deferCount += 1;
    ctx.touch(task, 'TASK_DEFERRED');
  },

  // ---------------------------------------------------------------- AgentState
  AGENT_REGISTER(ctx) {
    const { p, tx, policy } = ctx;
    const id = ctx.newObjectId;
    if (!policy.workerSlots.includes(id)) fail('POLICY_DENIED', `${id} is not one of the ten worker slots`);
    const agent = {
      objectType: 'AgentState', objectId: id, state: 'AVAILABLE', slot: `arena/agent-${id.slice(-2)}`,
      identity: { role: 'WORKER', enabled: true, generation: p.generation ?? 1 },
      capabilities: [...new Set(p.capabilities ?? [])].sort(),
      capacity: { class: p.capacity?.class ?? 'NORMAL', activeTaskCount: 0, maxConcurrentTasks: p.capacity?.maxConcurrentTasks ?? 1, runnerClass: p.capacity?.runnerClass ?? 'ANY', ...(p.capacity?.cpuClass ? { cpuClass: p.capacity.cpuClass } : {}), ...(p.capacity?.memoryClass ? { memoryClass: p.capacity.memoryClass } : {}) },
      assignment: { taskIds: [], lastAssignedAt: null, lastReleasedAt: ctx.now },
      heartbeat: { lastSeenAt: null, lastProgressAt: null, runnerId: p.runnerId ?? null },
      branch: { persistent: `arena/agent-${id.slice(-2)}`, task: null, headSha: null },
      health: { status: 'HEALTHY', consecutiveFailures: 0 },
      reason: null,
    };
    ctx.targetObject = agent;
    ctx.create(agent, 'AGENT_REGISTERED');
    if (!tx.get('Actor', id)) {
      ctx.create({ objectType: 'Actor', objectId: id, actorType: 'WORKER', enabled: true, displayName: null }, 'ACTOR_REGISTERED');
      ctx.sideEffects.push({ objectType: 'Actor', objectId: id, state: null });
    }
  },

  AGENT_RECONFIGURE(ctx) {
    // DEC-0010: slots are open; the Manager may change a slot's capabilities/capacity only while it holds no work.
    const agent = ctx.targetObject;
    const owned = ctx.tx.list('Task').filter((t) => t.owner?.agentId === agent.objectId && !isTerminal(ctx.policy, 'Task', t.state));
    if (owned.length) fail('POLICY_DENIED', `reconfigure only an idle slot; owned tasks: ${owned.map((t) => t.objectId).join(', ')}`);
    const { capabilities, capacity } = ctx.p;
    if (capabilities === undefined && capacity === undefined) fail('INVALID_SCHEMA', 'payload needs capabilities and/or capacity');
    if (capabilities !== undefined) agent.capabilities = [...new Set(capabilities)].sort();
    if (capacity !== undefined) {
      for (const k of Object.keys(capacity)) if (!['class', 'maxConcurrentTasks', 'runnerClass', 'cpuClass', 'memoryClass'].includes(k)) fail('INVALID_SCHEMA', `capacity.${k} is not reconfigurable`);
      agent.capacity = { ...agent.capacity, ...capacity };
    }
    ctx.touch(agent, 'AGENT_RECONFIGURED');
  },

  AGENT_HEARTBEAT(ctx) {
    const agent = ctx.targetObject;
    agent.heartbeat = { ...agent.heartbeat, lastSeenAt: ctx.now, ...(ctx.p.progress ? { lastProgressAt: ctx.now } : {}), ...(ctx.p.runnerId ? { runnerId: ctx.p.runnerId } : {}) };
    ctx.touch(agent, 'AGENT_HEARTBEAT', { emitEvent: false });
  },

  AGENT_STATUS(ctx) {
    const agent = ctx.targetObject;
    const to = ctx.p.state;
    if (ctx.isWorker && !ctx.spec.workerAllowedTo.includes(to)) fail('FORBIDDEN', `a worker may not move its own slot to ${to}`);
    if (ctx.isWorker && ctx.policy.stateMachines.AgentState.managerOnlyStates.includes(to)) fail('FORBIDDEN', `${to} is Manager-only`);
    ctx.transition(agent, to, { eventType: 'AGENT_STATUS' });
  },

  AGENT_SUSPEND(ctx) { ctx.transition(ctx.targetObject, 'SUSPENDED', { eventType: 'AGENT_SUSPENDED', reasonRequired: true }); },
  AGENT_STOP(ctx) { ctx.transition(ctx.targetObject, 'STOPPED', { eventType: 'AGENT_STOPPED', reasonRequired: true }); },

  AGENT_MARK_LOST(ctx) {
    const agent = ctx.targetObject;
    ctx.transition(agent, 'LOST', { eventType: 'AGENT_LOST' });
    // Assignment authority ends; reservations are PRESERVED for safe recovery (#264 §5).
    for (const t of ctx.tx.list('Task').filter((x) => x.owner?.agentId === agent.objectId && !isTerminal(ctx.policy, 'Task', x.state))) {
      if (t.execution.activeLeaseId) { ctx.endLease(t.execution.activeLeaseId, 'REVOKED', 'AGENT_LOST'); t.execution.activeLeaseId = null; ctx.touch(t, 'TASK_OWNER_LOST'); }
    }
  },

  AGENT_RECOVER(ctx) {
    const to = ctx.p.state;
    if (!ctx.spec.allowedTo.includes(to)) fail('INVALID_STATE_TRANSITION', `AGENT_RECOVER may move LOST only to ${ctx.spec.allowedTo.join('/')}`);
    ctx.transition(ctx.targetObject, to, { eventType: 'AGENT_RECOVERED', reasonRequired: true });
  },

  AGENT_ACTIVATE(ctx) {
    const agent = ctx.targetObject;
    agent.health = { status: 'HEALTHY', consecutiveFailures: 0 };
    ctx.transition(agent, 'AVAILABLE', { eventType: 'AGENT_ACTIVATED', reasonRequired: true });
    ctx.syncAgent(agent.objectId);
  },

  AGENT_RETIRE(ctx) {
    const agent = ctx.targetObject;
    const owned = ctx.tx.list('Task').filter((t) => t.owner?.agentId === agent.objectId && !isTerminal(ctx.policy, 'Task', t.state));
    if (owned.length) fail('POLICY_DENIED', `transfer or close owned tasks first: ${owned.map((t) => t.objectId).join(', ')}`);
    const live = ctx.tx.list('Lease').filter((l) => l.holder === agent.objectId && l.state === 'ACTIVE');
    if (live.length) ctx.requireHumanApproval('AgentState', agent.objectId);
    for (const l of live) ctx.transition(l, 'REVOKED', { reasonCode: 'AGENT_RETIRED', reasonRequired: false });
    agent.identity.enabled = false;
    ctx.transition(agent, 'RETIRED', { eventType: 'AGENT_RETIRED' });
    const actorRec = ctx.tx.get('Actor', agent.objectId);
    if (actorRec) { actorRec.enabled = false; ctx.touch(actorRec, 'ACTOR_DISABLED'); }
  },

  // ---------------------------------------------------------------- Reservation
  RESERVATION_REQUEST(ctx) {
    const { p, tx, policy } = ctx;
    const task = ctx.mustGet('Task', p.taskId, 'task');
    if (isTerminal(policy, 'Task', task.state)) fail('ALREADY_TERMINAL', `task ${task.objectId} is terminal`);
    const mode = p.mode;
    if (!policy.reservation.modes.includes(mode)) fail('INVALID_SCHEMA', `unknown reservation mode ${mode}`);
    if (policy.reservation.managerOnlyModes.includes(mode) && !ctx.isManager) fail('GOVERNANCE_REQUIRED', `${mode} is Manager-only; file REQUEST_MANAGER_CHANGE`);
    const scope = emptyScope(p.scope);
    const dims = policy.reservation.dimensions;
    const norm = normalizeScope(scope, dims);
    if (!dims.some((d) => norm[d].length)) fail('INVALID_SCHEMA', 'reservation scope is empty');
    if ((norm.governanceSurfaces.length) && !ctx.isManager) fail('GOVERNANCE_REQUIRED', 'governance surfaces can only be reserved by the Manager');
    const forbidden = task.constraints.forbiddenPaths.map((x) => x.replace(/\\/g, '/'));
    const hit = norm.paths.filter((a) => forbidden.some((f) => pathsOverlap(a, f)));
    if (hit.length) fail('POLICY_DENIED', `scope overlaps the task's forbidden paths: ${hit.join(', ')}`);
    const domHit = norm.domains.filter((d) => task.constraints.forbiddenDomains.map((x) => x.toLowerCase()).includes(d));
    if (domHit.length) fail('POLICY_DENIED', `scope includes forbidden domains: ${domHit.join(', ')}`);
    const live = tx.list('Reservation').filter((r) => !isTerminal(policy, 'Reservation', r.state)).length;
    if (live >= policy.backpressure.maxActiveReservations) fail('RESOURCE_UNAVAILABLE', 'maxActiveReservations reached (backpressure)');
    const res = {
      objectType: 'Reservation', objectId: ctx.newObjectId, state: 'REQUESTED', taskId: task.objectId, ownerAgentId: task.owner?.agentId ?? null,
      scope, mode, fingerprint: scopeFingerprint(scope, dims), conflicts: [], parallelism: null, leaseId: null,
      predecessorId: null, successorId: null, expiresAt: null, releasedAt: null, reason: ctx.reason(false),
    };
    ctx.targetObject = res;
    ctx.create(res, 'RESERVATION_REQUESTED');
  },

  RESERVATION_CHECK(ctx) {
    const res = ctx.targetObject;
    const { policy, tx } = ctx;
    if (!['REQUESTED', 'CONFLICT'].includes(res.state)) fail('INVALID_STATE_TRANSITION', `RESERVATION_CHECK requires REQUESTED/CONFLICT, current ${res.state}`);
    ctx.transition(res, 'CHECKING', { reasonCode: 'CHECK_STARTED', reasonRequired: false });
    const verdict = evaluateReservation(res, tx.list('Reservation'), policy);
    res.conflicts = verdict.conflicts;
    res.fingerprint = verdict.fingerprint;
    const task = tx.get('Task', res.taskId);
    if (verdict.outcome === 'CONFLICT') {
      res.parallelism = 'SERIALIZED';
      ctx.transition(res, 'CONFLICT', { reasonCode: 'RESERVATION_CONFLICT', reasonRequired: false });
      if (task) { task.history.reservationConflictCount += 1; ctx.touch(task, 'TASK_RESERVATION_CONFLICT'); }
    } else {
      res.parallelism = verdict.outcome === 'CONDITIONAL' ? 'CONDITIONAL_PARALLEL' : 'SAFE_PARALLEL';
      ctx.transition(res, 'RESERVED', { reasonCode: verdict.outcome === 'CONDITIONAL' ? 'RESERVED_CONDITIONAL' : 'RESERVED_CLEAR', reasonRequired: false });
      if (task && policy.reservation.managerLaneModes.includes(res.mode) && task.execution.mergeLane !== 'MANAGER') { task.execution.mergeLane = 'MANAGER'; ctx.touch(task, 'TASK_MERGE_LANE_RAISED'); }
    }
    ctx.data.outcome = verdict.outcome;
    ctx.data.conflicts = verdict.conflicts;
  },

  RESERVATION_ACTIVATE(ctx) {
    const res = ctx.targetObject;
    const verdict = evaluateReservation(res, ctx.tx.list('Reservation'), ctx.policy);
    if (verdict.outcome === 'CONFLICT') fail('RESERVATION_CONFLICT', 'a conflicting reservation became blocking after the check', { conflicts: verdict.conflicts });
    const task = ctx.mustGet('Task', res.taskId, 'task');
    const lease = ctx.issueLease('RESERVATION', { taskId: res.taskId, reservationId: res.objectId }, res.ownerAgentId ?? ctx.actor.id);
    res.leaseId = lease.objectId;
    res.expiresAt = lease.expiresAt;
    res.conflicts = verdict.conflicts;
    res.parallelism = verdict.outcome === 'CONDITIONAL' ? 'CONDITIONAL_PARALLEL' : 'SAFE_PARALLEL';
    ctx.transition(res, 'ACTIVE', { eventType: 'RESERVATION_ACTIVATED' });
    task.execution.reservationIds = [...new Set([...task.execution.reservationIds, res.objectId])];
    ctx.touch(task, 'TASK_RESERVATION_ACTIVE');
  },

  RESERVATION_REJECT(ctx) { ctx.transition(ctx.targetObject, 'REJECTED', { eventType: 'RESERVATION_REJECTED' }); },

  RESERVATION_RELEASE(ctx) {
    const res = ctx.targetObject;
    ctx.endLease(res.leaseId, 'COMPLETED', 'RESERVATION_RELEASED');
    res.releasedAt = ctx.now;
    ctx.transition(res, 'RELEASED', { eventType: 'RESERVATION_RELEASED', reasonRequired: false });
    const task = ctx.tx.get('Task', res.taskId);
    if (task) { task.execution.reservationIds = task.execution.reservationIds.filter((x) => x !== res.objectId); ctx.touch(task, 'TASK_RESERVATION_RELEASED'); }
  },

  RESERVATION_EXPIRE(ctx) {
    const res = ctx.targetObject;
    const lease = res.leaseId ? ctx.tx.get('Lease', res.leaseId) : null;
    if (ctx.leaseValidity(lease) === 'ACTIVE') fail('POLICY_DENIED', `reservation lease ${lease.objectId} is still valid until ${lease.expiresAt}`);
    if (lease?.state === 'ACTIVE') ctx.transition(lease, 'EXPIRED', { reasonCode: 'LEASE_TTL_ELAPSED', reasonRequired: false });
    ctx.transition(res, 'EXPIRED', { eventType: 'RESERVATION_EXPIRED', reasonCode: 'LEASE_TTL_ELAPSED', reasonRequired: false });
    const task = ctx.tx.get('Task', res.taskId);
    if (task) { task.execution.reservationIds = task.execution.reservationIds.filter((x) => x !== res.objectId); ctx.touch(task, 'TASK_RESERVATION_EXPIRED'); }
  },

  RESERVATION_TRANSFER(ctx) {
    const res = ctx.targetObject;
    if (res.mode === 'GOVERNANCE_LOCK') ctx.requireHumanApproval('Reservation', res.objectId);
    const to = ctx.mustGet('AgentState', ctx.p.toAgentId, 'successor agent');
    const succ = transferReservation(ctx, res, to.objectId);
    ctx.data.successorId = succ.objectId;
  },

  // ---------------------------------------------------------------- Lease
  LEASE_ISSUE(ctx) {
    const { p } = ctx;
    if (p.leaseType !== 'EXTERNAL_EXECUTION') fail('POLICY_DENIED', 'only EXTERNAL_EXECUTION leases are issued directly; other leases are side effects of their commands');
    const task = ctx.mustGet('Task', p.taskId, 'task');
    if (!task.owner) fail('POLICY_DENIED', 'external execution requires an assigned task');
    const lease = ctx.issueLease('EXTERNAL_EXECUTION', { taskId: task.objectId }, p.holder ?? task.owner.agentId, { id: ctx.newObjectId });
    ctx.targetObject = lease;
    ctx.targetEventId = lease.events.at(-1);
  },

  LEASE_RENEW(ctx) {
    const lease = ctx.targetObject;
    const conf = ctx.policy.leases[lease.leaseType];
    if (ctx.leaseValidity(lease) === 'EXPIRED') fail('LEASE_EXPIRED', `lease ${lease.objectId} expired at ${lease.expiresAt}; a replacement lease is required`);
    if (!lease.renewable || !conf.renewable) fail('POLICY_DENIED', `${lease.leaseType} leases are not renewable`);
    if (ctx.isWorker && !conf.workerRenewable) fail('FORBIDDEN', `workers may not renew ${lease.leaseType} leases`);
    const proposed = Math.min(Date.parse(addSeconds(ctx.now, conf.ttlSeconds)), Date.parse(lease.maxExpiresAt));
    if (proposed <= Date.parse(lease.expiresAt)) fail('POLICY_DENIED', 'renewal would not extend the lease (monotonic; max lifetime reached)', { maxExpiresAt: lease.maxExpiresAt });
    lease.expiresAt = new Date(proposed).toISOString().replace('.000Z', 'Z');
    lease.renewedAt = ctx.now;
    lease.renewCount += 1;
    ctx.transition(lease, 'ACTIVE', { eventType: 'LEASE_RENEWED', reasonRequired: false });
    if (lease.leaseType === 'RESERVATION' && lease.subject.reservationId) {
      const res = ctx.tx.get('Reservation', lease.subject.reservationId);
      if (res?.state === 'ACTIVE') { res.expiresAt = lease.expiresAt; ctx.touch(res, 'RESERVATION_LEASE_RENEWED', { emitEvent: false }); }
    }
  },

  LEASE_REVOKE(ctx) { ctx.transition(ctx.targetObject, 'REVOKED', { eventType: 'LEASE_REVOKED', reasonRequired: true }); },
  LEASE_COMPLETE(ctx) { ctx.transition(ctx.targetObject, 'COMPLETED', { eventType: 'LEASE_COMPLETED', reasonRequired: false }); },
  LEASE_EXPIRE(ctx) {
    const lease = ctx.targetObject;
    if (Date.parse(ctx.now) < Date.parse(lease.expiresAt)) fail('POLICY_DENIED', `lease ${lease.objectId} is valid until ${lease.expiresAt}`);
    ctx.transition(lease, 'EXPIRED', { eventType: 'LEASE_EXPIRED', reasonCode: 'LEASE_TTL_ELAPSED', reasonRequired: false });
  },

  // ---------------------------------------------------------------- Evidence
  EVIDENCE_PROPOSE(ctx) {
    const { p, policy } = ctx;
    const task = ctx.mustGet('Task', p.taskId, 'task');
    const trust = p.trustLevel ?? 'SELF_REPORTED';
    const rank = trustRank(policy, trust);
    if (rank < 0) fail('INVALID_SCHEMA', `unknown trust level ${trust}`);
    if (ctx.isWorker && rank > trustRank(policy, policy.evidence.workerMaxTrust)) fail('POLICY_DENIED', `workers publish at most ${policy.evidence.workerMaxTrust}; verification is a Manager act`);
    if (ctx.actor.type === 'SYSTEM' && rank > trustRank(policy, policy.evidence.systemMaxTrust)) fail('POLICY_DENIED', `system actors publish at most ${policy.evidence.systemMaxTrust}`);
    validateAnchor(ctx, p.type, p.subject ?? null);
    const ev = {
      objectType: 'Evidence', objectId: ctx.newObjectId, state: 'PROPOSED', taskId: task.objectId, type: p.type, trustLevel: trust,
      subject: p.subject ? { subjectDigest: null, repository: null, prNumber: null, url: null, ...p.subject } : null,
      result: { metrics: {}, failureClass: null, ...(p.result ?? {}) }, producedBy: ctx.actor.id, verifiedAt: null, verifiedBy: null, reason: null,
    };
    ctx.targetObject = ev;
    ctx.create(ev, 'EVIDENCE_PROPOSED');
  },

  EVIDENCE_PUBLISH(ctx) { ctx.transition(ctx.targetObject, 'PUBLISHED', { eventType: 'EVIDENCE_PUBLISHED' }); },

  EVIDENCE_VERIFY(ctx) {
    const ev = ctx.targetObject;
    const trust = ctx.p.trustLevel ?? 'REVIEW_VERIFIED';
    if (trustRank(ctx.policy, trust) < trustRank(ctx.policy, ev.trustLevel)) fail('POLICY_DENIED', 'verification cannot lower trust');
    if (ev.type === 'MAIN_VERIFICATION' && !ctx.policy.completion.mainVerificationTrust.includes(trust)) fail('POLICY_DENIED', 'MAIN_VERIFICATION must be verified at MAIN_VERIFIED or higher');
    if (ev.type === 'CLAIM' && trustRank(ctx.policy, trust) > trustRank(ctx.policy, 'SELF_REPORTED')) fail('POLICY_DENIED', 'a CLAIM stays SELF_REPORTED; publish anchored evidence instead');
    ev.trustLevel = trust;
    ev.verifiedAt = ctx.now;
    ev.verifiedBy = ctx.actor.id;
    ctx.transition(ev, 'VERIFIED', { eventType: 'EVIDENCE_VERIFIED', reasonRequired: false });
  },

  EVIDENCE_REVOKE(ctx) { ctx.transition(ctx.targetObject, 'REVOKED', { eventType: 'EVIDENCE_REVOKED', reasonRequired: true }); },

  // ---------------------------------------------------------------- Decision
  DECISION_PROPOSE(ctx) {
    const { p } = ctx;
    if (p.supersedes) ctx.mustGet('Decision', p.supersedes, 'superseded decision');
    for (const e of p.evidence ?? []) ctx.mustGet('Evidence', e, 'decision evidence');
    const dec = {
      objectType: 'Decision', objectId: ctx.newObjectId, state: 'PROPOSED', category: p.category, title: p.title, problem: p.problem,
      options: p.options ?? [], selectedOption: p.selectedOption, rationale: p.rationale, scope: { programs: [], slices: [], domains: [], surfaces: [], ...(p.scope ?? {}) },
      authority: { decidedBy: 'UNDECIDED', managerOnly: true, humanEscalation: Boolean(p.humanEscalation), proposedBy: ctx.actor.id },
      evidence: p.evidence ?? [], evidenceRefs: p.evidenceRefs ?? [],
      sources: { issues: [], prs: [], commits: [], requests: [], ...(p.sources ?? {}) },
      supersedes: p.supersedes ?? null, supersededBy: null,
      promotion: { canonical: false, mainPath: null, mainCommitSha: null, promotedAt: null, promotedBy: null }, reason: null,
    };
    ctx.targetObject = dec;
    ctx.create(dec, 'DECISION_PROPOSED');
  },

  DECISION_REVIEW(ctx) { ctx.transition(ctx.targetObject, 'UNDER_REVIEW', { eventType: 'DECISION_UNDER_REVIEW', reasonRequired: false }); },

  DECISION_ACTIVATE(ctx) {
    const dec = ctx.targetObject;
    dec.authority.decidedBy = ctx.actor.id;
    ctx.transition(dec, 'ACTIVE', { eventType: 'DECISION_ACTIVATED', reasonRequired: false });
    if (dec.supersedes) {
      const old = ctx.mustGet('Decision', dec.supersedes, 'superseded decision');
      if (old.state === 'ACTIVE') { old.supersededBy = dec.objectId; ctx.transition(old, 'SUPERSEDED', { eventType: 'DECISION_SUPERSEDED', reasonCode: 'SUPERSEDED_BY_NEW_DECISION' }); }
    }
  },

  DECISION_REJECT(ctx) { ctx.transition(ctx.targetObject, 'REJECTED', { eventType: 'DECISION_REJECTED' }); },

  DECISION_SUPERSEDE(ctx) {
    const dec = ctx.targetObject;
    const repl = ctx.mustGet('Decision', ctx.p.supersededBy, 'replacement decision');
    if (repl.supersedes !== dec.objectId || !['UNDER_REVIEW', 'ACTIVE'].includes(repl.state)) fail('GOVERNANCE_REQUIRED', 'supersession needs a replacement decision that declares supersedes and is under review or active');
    dec.supersededBy = repl.objectId;
    ctx.transition(dec, 'SUPERSEDED', { eventType: 'DECISION_SUPERSEDED' });
  },

  DECISION_REVOKE(ctx) { ctx.transition(ctx.targetObject, 'REVOKED', { eventType: 'DECISION_REVOKED' }); },

  DECISION_PROMOTE_CANONICAL(ctx) {
    const dec = ctx.targetObject;
    if (dec.state !== 'ACTIVE') fail('GOVERNANCE_REQUIRED', `only ACTIVE decisions are promoted (current ${dec.state})`);
    if (dec.promotion.canonical) fail('DUPLICATE', `${dec.objectId} is already canonical at ${dec.promotion.mainCommitSha}`);
    if (!(dec.sources.issues.length || dec.sources.prs.length) || !dec.rationale) fail('GOVERNANCE_REQUIRED', 'canonical promotion requires provenance (source issue/PR) and rationale');
    if (!/^[0-9a-f]{40}$/.test(ctx.p.mainCommitSha ?? '') || !ctx.p.mainPath) fail('EVIDENCE_INSUFFICIENT', 'promotion records the canonical destination (mainPath) and the resulting main commit SHA');
    dec.promotion = { canonical: true, mainPath: ctx.p.mainPath, mainCommitSha: ctx.p.mainCommitSha, promotedAt: ctx.now, promotedBy: ctx.actor.id };
    ctx.touch(dec, 'DECISION_PROMOTED_CANONICAL');
  },

  // ---------------------------------------------------------------- Merge queue
  MQ_ADMIT(ctx) {
    const { p, tx, policy } = ctx;
    const task = ctx.mustGet('Task', p.taskId, 'task');
    if (task.state !== 'READY_FOR_REVIEW') fail('INVALID_STATE_TRANSITION', `merge admission requires READY_FOR_REVIEW, task is ${task.state}`);
    if (p.pr?.headSha !== task.current.headSha) fail('MERGE_HEAD_CHANGED', `PR head ${p.pr?.headSha} differs from the task's exact head ${task.current.headSha}`);
    const dup = tx.list('MergeQueueItem').find((m) => !isTerminal(policy, 'MergeQueueItem', m.state) && (m.taskId === task.objectId || (m.pr.repository === p.pr.repository && m.pr.number === p.pr.number)));
    if (dup) fail('DUPLICATE', `${dup.objectId} already queues this task/PR`);
    if (tx.list('MergeQueueItem').filter((m) => !isTerminal(policy, 'MergeQueueItem', m.state)).length >= policy.backpressure.maxMergeQueueItems) fail('RESOURCE_UNAVAILABLE', 'merge queue is full (backpressure)');
    const classification = { impact: 'LOCAL', ...(p.classification ?? {}) };
    const item = {
      objectType: 'MergeQueueItem', objectId: ctx.newObjectId, state: 'QUEUED',
      pr: { repository: p.pr.repository, number: p.pr.number, base: p.pr.base, headSha: p.pr.headSha, baseSha: p.pr.baseSha ?? null },
      taskId: task.objectId, agentId: task.owner?.agentId ?? null, lane: 'HOLD', classification,
      checks: { exactHeadCi: 'PENDING', architecture: 'PENDING', acceptance: 'PENDING', evidence: 'PENDING', reservation: 'PENDING', dependency: 'PENDING', checkedHeadSha: null },
      rollback: { class: task.execution.rollbackClass, strategy: p.rollback?.strategy ?? null, verified: p.rollback?.verified ?? false, ...(p.rollback?.class ? { class: p.rollback.class } : {}) },
      authorizationLeaseId: null, humanApprovalId: null, mergeSha: null, verifiedMainSha: null, laneReasons: ['awaiting classification'], reason: null,
    };
    ctx.targetObject = item;
    ctx.create(item, 'MQ_ADMITTED');
  },

  MQ_UPDATE_CHECKS(ctx) {
    const item = ctx.targetObject;
    if (ctx.p.headSha !== item.pr.headSha) fail('MERGE_HEAD_CHANGED', `checks were produced for ${ctx.p.headSha}, pinned head is ${item.pr.headSha}`, { pinnedHeadSha: item.pr.headSha });
    const allowed = ['exactHeadCi', 'architecture', 'acceptance'];
    for (const [k, v] of Object.entries(ctx.p.checks ?? {})) {
      if (!allowed.includes(k)) fail('POLICY_DENIED', `${k} is computed by the control plane, not reported`);
      item.checks[k] = v;
    }
    item.checks.checkedHeadSha = item.pr.headSha;
    if (item.state === 'READY' && allowed.some((k) => item.checks[k] !== ctx.policy.merge.passValues[k])) holdMergeItem(ctx, item, 'CHECK_FAILED');
    ctx.touch(item, 'MQ_CHECKS_UPDATED');
  },

  MQ_CLASSIFY(ctx) {
    const item = ctx.targetObject;
    if (!['QUEUED', 'HOLD'].includes(item.state)) fail('INVALID_STATE_TRANSITION', `classification applies to QUEUED/HOLD items, current ${item.state}`);
    const verdict = applyClassification(ctx, item);
    if (verdict.readyEligible) ctx.transition(item, 'READY', { eventType: 'MQ_READY', reasonRequired: false });
    else if (item.state === 'QUEUED') ctx.transition(item, 'HOLD', { eventType: 'MQ_HELD', reasonCode: 'LANE_HOLD' });
    else ctx.touch(item, 'MQ_RECLASSIFIED');
    ctx.data.lane = verdict.lane;
    ctx.data.reasons = verdict.reasons;
  },

  MQ_OBSERVE_HEAD(ctx) {
    const item = ctx.targetObject;
    const head = ctx.p.headSha;
    if (!/^[0-9a-f]{40}$/.test(head ?? '')) fail('INVALID_SCHEMA', 'payload.headSha must be a 40-hex SHA');
    if (head === item.pr.headSha) { ctx.touch(item, 'MQ_HEAD_CONFIRMED', { emitEvent: false }); ctx.data.headChanged = false; return; }
    const previous = item.pr.headSha;
    item.pr.headSha = head;
    item.checks = { exactHeadCi: 'PENDING', architecture: 'PENDING', acceptance: 'PENDING', evidence: 'PENDING', reservation: 'PENDING', dependency: 'PENDING', checkedHeadSha: null };
    item.laneReasons = [`head changed ${previous.slice(0, 12)} -> ${head.slice(0, 12)}; exact-head checks must rerun`];
    if (['READY', 'MERGING', 'VERIFYING'].includes(item.state)) holdMergeItem(ctx, item, 'MERGE_HEAD_CHANGED');
    else if (item.state === 'QUEUED') ctx.transition(item, 'HOLD', { reasonCode: 'MERGE_HEAD_CHANGED' });
    else ctx.touch(item, 'MQ_HEAD_CHANGED');
    ctx.data.headChanged = true;
    ctx.data.previousHeadSha = previous;
  },

  MQ_AUTHORIZE(ctx) {
    const item = ctx.targetObject;
    if (item.state !== 'READY') fail('INVALID_STATE_TRANSITION', `merge authorization requires READY, current ${item.state}`);
    if (ctx.p.observedHeadSha !== item.pr.headSha) fail('MERGE_HEAD_CHANGED', 'observed head differs from the pinned exact head', { pinnedHeadSha: item.pr.headSha });
    if (item.checks.checkedHeadSha !== item.pr.headSha) fail('EVIDENCE_INSUFFICIENT', 'checks are not anchored to the pinned head');
    const verdict = classifyMerge(item, ctx.policy, {});
    if (verdict.lane === 'HOLD' || item.lane === 'HOLD') fail('POLICY_DENIED', 'HOLD lane items cannot be authorized', { reasons: verdict.reasons });
    if (item.lane === 'MANAGER' && !ctx.isManager) fail('FORBIDDEN', 'MANAGER-lane merges are authorized by the Manager only');
    if (ctx.policy.merge.neverAutonomousRollbackClasses.includes(item.rollback.class)) item.humanApprovalId = ctx.requireHumanApproval('MergeQueueItem', item.objectId).objectId;
    const existing = item.authorizationLeaseId ? ctx.tx.get('Lease', item.authorizationLeaseId) : null;
    if (existing && ctx.leaseValidity(existing) === 'ACTIVE') fail('DUPLICATE', `authorization ${existing.objectId} is still valid`);
    if (existing?.state === 'ACTIVE') ctx.transition(existing, 'EXPIRED', { reasonCode: 'LEASE_TTL_ELAPSED', reasonRequired: false });
    const lease = ctx.issueLease('MERGE_AUTHORIZATION', { taskId: item.taskId, queueItemId: item.objectId, repository: item.pr.repository, prNumber: item.pr.number, base: item.pr.base, headSha: item.pr.headSha }, ctx.p.executor ?? 'SYSTEM-MERGE-EXECUTOR', { predecessorId: existing?.objectId ?? null });
    item.authorizationLeaseId = lease.objectId;
    ctx.touch(item, 'MQ_AUTHORIZED');
    ctx.data.leaseId = lease.objectId;
    ctx.data.expiresAt = lease.expiresAt;
  },

  MQ_MERGE_START(ctx) {
    const item = ctx.targetObject;
    if (ctx.p.observedHeadSha !== item.pr.headSha) fail('MERGE_HEAD_CHANGED', 'observed head differs from the pinned exact head', { pinnedHeadSha: item.pr.headSha });
    const lease = item.authorizationLeaseId ? ctx.tx.get('Lease', item.authorizationLeaseId) : null;
    const v = ctx.leaseValidity(lease);
    if (v === 'EXPIRED') fail('LEASE_EXPIRED', 'merge authorization expired; re-authorize on the current head');
    if (v !== 'ACTIVE') fail('LEASE_REVOKED', 'no valid merge authorization lease');
    if (lease.subject.headSha !== item.pr.headSha || lease.subject.prNumber !== item.pr.number || lease.subject.base !== item.pr.base) fail('MERGE_HEAD_CHANGED', 'authorization lease pins a different PR/base/head');
    if (ctx.actor.type === 'SYSTEM' && lease.holder !== ctx.actor.id) fail('FORBIDDEN', `authorization lease is held by ${lease.holder}`);
    const task = ctx.mustGet('Task', item.taskId, 'task');
    if (task.state !== 'READY_FOR_REVIEW') fail('POLICY_DENIED', `task is ${task.state}; it must be READY_FOR_REVIEW to merge`);
    ctx.transition(item, 'MERGING', { eventType: 'MQ_MERGING', reasonRequired: false });
    ctx.transition(task, 'MERGING', { eventType: 'TASK_MERGING', reasonRequired: false });
  },

  MQ_MERGE_RESULT(ctx) {
    const item = ctx.targetObject;
    if (item.state !== 'MERGING') fail('INVALID_STATE_TRANSITION', `merge result requires MERGING, current ${item.state}`);
    if (ctx.p.mergedHeadSha !== item.pr.headSha) fail('MERGE_HEAD_CHANGED', 'the merged head is not the verified head');
    if (!/^[0-9a-f]{40}$/.test(ctx.p.mergeSha ?? '')) fail('INVALID_SCHEMA', 'payload.mergeSha must be a 40-hex SHA');
    item.mergeSha = ctx.p.mergeSha;
    ctx.endLease(item.authorizationLeaseId, 'COMPLETED', 'MERGED');
    ctx.transition(item, 'VERIFYING', { eventType: 'MQ_MERGED_VERIFYING', reasonRequired: false });
    const task = ctx.mustGet('Task', item.taskId, 'task');
    if (task.state === 'MERGING') ctx.transition(task, 'VERIFYING', { eventType: 'TASK_VERIFYING', reasonRequired: false });
  },

  MQ_VERIFY(ctx) {
    const item = ctx.targetObject;
    const mainEv = verifiedEvidence(ctx, item.taskId).find((e) => e.type === 'MAIN_VERIFICATION' && ctx.policy.completion.mainVerificationTrust.includes(e.trustLevel) && e.result.status === 'PASS');
    if (!mainEv) fail('EVIDENCE_INSUFFICIENT', 'fresh-main verification evidence (VERIFIED, MAIN_VERIFIED, PASS) is required');
    if (ctx.p.verifiedMainSha && ctx.p.verifiedMainSha !== mainEv.subject.subjectId) fail('EVIDENCE_INSUFFICIENT', 'payload main SHA does not match the main verification evidence');
    item.verifiedMainSha = mainEv.subject.subjectId;
    ctx.transition(item, 'MERGED', { eventType: 'MQ_VERIFIED', reasonRequired: false, evidenceIds: [mainEv.objectId] });
  },

  MQ_HOLD(ctx) { if (!ctx.p.reasonCode) fail('INVALID_SCHEMA', 'payload.reasonCode is required for HOLD'); holdMergeItem(ctx, ctx.targetObject, ctx.p.reasonCode); },

  MQ_RELEASE(ctx) {
    const item = ctx.targetObject;
    const to = ctx.p.state;
    if (!ctx.spec.allowedTo.includes(to)) fail('INVALID_STATE_TRANSITION', `MQ_RELEASE moves HOLD only to ${ctx.spec.allowedTo.join('/')}`);
    if (to === 'READY') {
      const verdict = applyClassification(ctx, item);
      if (!verdict.readyEligible) fail('POLICY_DENIED', 'item is not eligible for READY on its current head', { reasons: verdict.reasons });
    }
    ctx.transition(item, to, { eventType: 'MQ_RELEASED', reasonRequired: false });
  },

  MQ_REJECT(ctx) {
    const item = ctx.targetObject;
    if (item.state === 'READY') holdMergeItem(ctx, item, ctx.p.reasonCode ?? 'REJECTED');
    const task = ctx.tx.get('Task', item.taskId);
    if (task?.state === 'MERGING') ctx.transition(task, 'HOLD', { reasonCode: ctx.p.reasonCode ?? 'MERGE_REJECTED' });
    ctx.endLease(item.authorizationLeaseId, 'REVOKED', 'MQ_REJECTED');
    ctx.transition(item, 'REJECTED', { eventType: 'MQ_REJECTED' });
  },

  MQ_SUPERSEDE(ctx) { ctx.transition(ctx.targetObject, 'SUPERSEDED', { eventType: 'MQ_SUPERSEDED' }); },

  // ---------------------------------------------------------------- records
  HANDOFF_PUBLISH(ctx) {
    const { p } = ctx;
    const task = ctx.mustGet('Task', p.taskId, 'task');
    for (const e of p.evidence ?? []) ctx.mustGet('Evidence', e, 'handoff evidence');
    const h = {
      objectType: 'Handoff', objectId: ctx.newObjectId, taskId: task.objectId, author: ctx.actor.id, issue: task.issue, slice: task.slice,
      branch: p.branch ?? task.branch.taskBranch ?? 'unassigned', commitSha: p.commitSha ?? task.current.headSha ?? null,
      files: p.files ?? [], tests: p.tests ?? [], evidence: p.evidence ?? [], decisions: p.decisions ?? [], blockers: p.blockers ?? [], risks: p.risks ?? [],
      nextAction: p.nextAction, managerDecisionRequired: Boolean(p.managerDecisionRequired),
    };
    ctx.targetObject = h;
    ctx.create(h, 'HANDOFF_PUBLISHED');
    task.current.handoffId = h.objectId;
    ctx.touch(task, 'TASK_HANDOFF_RECORDED');
  },

  REQUEST_MANAGER_CHANGE(ctx) {
    const { p } = ctx;
    if (!ctx.policy.requestKinds.includes(p.kind)) fail('INVALID_SCHEMA', `unknown request kind ${p.kind}`);
    const req = { objectType: 'Request', objectId: ctx.newObjectId, state: 'OPEN', kind: p.kind, requestedBy: ctx.actor.id, summary: p.summary, subject: p.subject ?? null, findings: [...(p.findings ?? []), ...(ctx.prompt.findings ?? [])], resolution: null };
    ctx.targetObject = req;
    ctx.create(req, 'REQUEST_OPENED');
    ctx.prompt = { conflict: false, findings: [] }; // the request itself is the conflict record
  },

  REQUEST_RESOLVE(ctx) {
    const req = ctx.targetObject;
    if (req.state !== 'OPEN') fail('ALREADY_TERMINAL', `request ${req.objectId} is ${req.state}`);
    const to = ctx.p.resolution;
    if (!['ACCEPTED', 'REJECTED'].includes(to)) fail('INVALID_SCHEMA', 'payload.resolution must be ACCEPTED or REJECTED');
    if (ctx.p.decisionId) ctx.mustGet('Decision', ctx.p.decisionId, 'decision');
    req.resolution = { by: ctx.actor.id, decisionId: ctx.p.decisionId ?? null, summary: ctx.command.reason };
    const from = req.state;
    req.state = to;
    req.revision += 1;
    req.updatedAt = ctx.now;
    ctx.emit(req, 'REQUEST_RESOLVED', from, to, ctx.p.reasonCode ?? null);
    ctx.tx.put(req);
  },

  HUMAN_APPROVE(ctx) { createApproval(ctx, 'APPROVED'); },
  HUMAN_REJECT(ctx) { createApproval(ctx, 'REJECTED'); },
  HUMAN_OVERRIDE(ctx) { createApproval(ctx, 'OVERRIDE'); },
  HUMAN_ESCALATION_RESOLUTION(ctx) { createApproval(ctx, 'RESOLVED'); },

  JOURNAL_APPEND(ctx) {
    const { p } = ctx;
    if (!ctx.policy.journalKinds.includes(p.kind)) fail('INVALID_SCHEMA', `journal kind must be one of ${ctx.policy.journalKinds.join('/')}`);
    const j = { objectType: 'JournalEntry', objectId: ctx.newObjectId, kind: p.kind, summary: p.summary, author: ctx.actor.id, refs: p.refs ?? [] };
    ctx.targetObject = j;
    ctx.create(j, 'JOURNAL_APPENDED');
  },
};

function createApproval(ctx, state) {
  const { p } = ctx;
  if (!ctx.policy.commands[p.commandType]) fail('INVALID_SCHEMA', `unknown commandType ${p.commandType}`);
  ctx.mustGet(p.subjectObjectType, p.subjectObjectId, 'approval subject');
  if (p.decisionId) ctx.mustGet('Decision', p.decisionId, 'decision');
  const a = { objectType: 'Approval', objectId: ctx.newObjectId, state, commandType: p.commandType, subjectObjectType: p.subjectObjectType, subjectObjectId: p.subjectObjectId, approvedBy: ctx.actor.id, decisionId: p.decisionId ?? null, reason: ctx.reason(true), consumedByCommandId: null };
  ctx.targetObject = a;
  ctx.create(a, `HUMAN_${state}`);
}

function transferReservation(ctx, res, toAgentId) {
  const succ = {
    objectType: 'Reservation', objectId: ctx.newId('Reservation'), state: 'ACTIVE', taskId: res.taskId, ownerAgentId: toAgentId,
    scope: structuredClone(res.scope), mode: res.mode, fingerprint: res.fingerprint, conflicts: res.conflicts, parallelism: res.parallelism,
    leaseId: null, predecessorId: res.objectId, successorId: null, expiresAt: null, releasedAt: null, reason: { code: 'RESERVATION_TRANSFERRED', summary: ctx.command.reason, actor: ctx.actor.id, refs: [] },
  };
  const lease = ctx.issueLease('RESERVATION', { taskId: res.taskId, reservationId: succ.objectId }, toAgentId, { predecessorId: res.leaseId });
  succ.leaseId = lease.objectId;
  succ.expiresAt = lease.expiresAt;
  ctx.create(succ, 'RESERVATION_TRANSFERRED_IN');
  ctx.sideEffects.push({ objectType: 'Reservation', objectId: succ.objectId, state: succ.state });
  const old = ctx.endLease(res.leaseId, 'TRANSFERRED', 'RESERVATION_TRANSFERRED');
  if (old) { old.successorId = lease.objectId; ctx.tx.put(old); }
  res.successorId = succ.objectId;
  ctx.transition(res, 'TRANSFERRED', { eventType: 'RESERVATION_TRANSFERRED', reasonCode: 'RESERVATION_TRANSFERRED', reasonRequired: false });
  return succ;
}
