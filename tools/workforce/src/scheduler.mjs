// Workforce scheduler + matcher + cross-P concurrency classifier (#264 §6-§9, #267).
//
// PURE: plan(snapshot, policy, now) -> recommendations. The scheduler never mutates state; the
// Manager executes a plan through ordinary commands (TASK_ASSIGN / TASK_DEFER / TASK_FREEZE), so
// every decision still passes the full authorization + CAS + transition pipeline.
//
// Parallelism is a scheduling OUTCOME, not a permission (#267): reservations are the collision
// boundary; every pair of candidate/active tasks is classified SAFE_PARALLEL, CONDITIONAL_PARALLEL,
// SERIALIZED or HOLD, with the reason.
import { isTerminal } from './core.mjs';
import { blockingDependencies, evaluateReservation, normalizeScope } from './domain.mjs';

const ACTIVE_WORK = new Set(['CLAIMED', 'ACKNOWLEDGED', 'PREPARING', 'WORKING', 'WAITING_EXTERNAL', 'BLOCKED', 'FROZEN']);
const RISK_PENALTY = { LOW: 0, NORMAL: 0, HIGH: 1, CRITICAL: 2 };
const hours = (a, b) => (Date.parse(b) - Date.parse(a)) / 3_600_000;

/** Priority + bounded aging (starvation prevention, #264 §7). */
export function effectivePriority(task, policy, now) {
  const s = policy.scheduler;
  const base = s.priorities[task.priority] ?? s.priorities.NORMAL;
  const byAge = Math.floor(Math.max(0, hours(task.createdAt, now)) / s.agingHoursPerLevel);
  const byDefer = Math.floor((task.history?.deferCount ?? 0) / s.deferralsPerLevel);
  const aging = Math.min(s.maxAgingBonus, byAge + byDefer);
  return { base, aging, effective: base + aging };
}

/** Would `task` (by declared scope) collide with the reservations currently held by other tasks? */
function scopeVerdict(task, reservations, policy) {
  const dims = policy.reservation.dimensions;
  const scope = normalizeScope(task.scope, dims);
  if (!dims.some((d) => scope[d].length)) return { outcome: 'UNKNOWN', conflicts: [] };
  const mode = scope.governanceSurfaces.length ? 'GOVERNANCE_LOCK' : scope.contracts.length ? 'CONTRACT_LOCK' : 'SHARED_WRITE';
  return evaluateReservation({ objectId: `candidate:${task.objectId}`, taskId: task.objectId, scope: task.scope, mode }, reservations, policy);
}

/** Classify a pair of tasks for cross-P concurrency (#267 §4-§6). */
export function classifyPair(a, b, ctx) {
  const { policy, tasksById } = ctx;
  const held = (t) => t.execution?.hold || t.execution?.decisionPending || t.state === 'FROZEN' || t.state === 'HOLD';
  if (held(a) || held(b)) return { class: 'HOLD', reason: `${held(a) ? a.objectId : b.objectId} is on hold / frozen / awaiting decision` };
  const dependsOn = (x, y, seen = new Set()) => (x.dependencies ?? []).some((d) => {
    if (d.type !== 'REQUIRED' && !(d.type === 'CONDITIONAL' && d.conditionMet === true)) return false;
    if (d.taskId === y.objectId) return true;
    if (seen.has(d.taskId)) return false;
    seen.add(d.taskId);
    const n = tasksById.get(d.taskId);
    return n ? dependsOn(n, y, seen) : false;
  });
  if (dependsOn(a, b) || dependsOn(b, a)) return { class: 'SERIALIZED', reason: `dependency chain between ${a.objectId} and ${b.objectId}` };
  const dims = policy.reservation.dimensions;
  const sa = normalizeScope(a.scope, dims);
  const sb = normalizeScope(b.scope, dims);
  if (!dims.some((d) => sa[d].length) || !dims.some((d) => sb[d].length)) {
    return { class: 'SERIALIZED', reason: 'undeclared scope — unknown compatibility fails closed' };
  }
  const modeOf = (s) => (s.governanceSurfaces.length ? 'GOVERNANCE_LOCK' : s.contracts.length ? 'CONTRACT_LOCK' : 'SHARED_WRITE');
  const v = evaluateReservation(
    { objectId: `pair:${a.objectId}`, taskId: a.objectId, scope: a.scope, mode: modeOf(sa) },
    [{ objectId: `pair:${b.objectId}`, taskId: b.objectId, scope: b.scope, mode: modeOf(sb), state: 'ACTIVE' }],
    policy,
  );
  if (v.outcome === 'CONFLICT') return { class: 'SERIALIZED', reason: `reservation conflict on ${v.conflicts[0].dimension}: ${v.conflicts[0].overlap.join(', ')}` };
  if (v.outcome === 'CONDITIONAL') return { class: 'CONDITIONAL_PARALLEL', reason: `conditional on ${v.conflicts[0].dimension} (contract/interface coordination required)` };
  const riskBoth = (RISK_PENALTY[a.risk] ?? 0) > 0 && (RISK_PENALTY[b.risk] ?? 0) > 0;
  if (riskBoth) return { class: 'CONDITIONAL_PARALLEL', reason: 'both tasks are high risk — merge serially' };
  return { class: 'SAFE_PARALLEL', reason: 'disjoint scopes, no dependency, compatible modes' };
}

/** Matcher: can `agent` take `task` right now? Returns { ok, reasons, score }. */
export function matchAgent(task, agent, ctx) {
  const { policy, activeByAgent, heavyByRunner } = ctx;
  const reasons = [];
  if (!agent.identity?.enabled) reasons.push('agent disabled');
  if (!['AVAILABLE', 'STOPPED', 'READY_FOR_REVIEW', 'VERIFYING'].includes(agent.state)) reasons.push(`agent state ${agent.state}`);
  const missing = (task.requirements?.capabilities ?? []).filter((c) => !agent.capabilities.includes(c));
  if (missing.length) reasons.push(`missing capabilities ${missing.join(',')}`);
  const runners = task.requirements?.runnerClasses ?? ['ANY'];
  if (!runners.includes('ANY') && agent.capacity.runnerClass !== 'ANY' && !runners.includes(agent.capacity.runnerClass)) reasons.push(`runner ${agent.capacity.runnerClass} not in ${runners.join('/')}`);
  const cap = Math.min(agent.capacity.maxConcurrentTasks, policy.backpressure.maxTasksPerWorker);
  if ((activeByAgent.get(agent.objectId) ?? 0) >= cap) reasons.push('agent at capacity');
  const heavy = policy.scheduler.heavyBuildCapacityClasses.includes(task.requirements?.capacityClass);
  if (heavy) {
    const rc = agent.capacity.runnerClass;
    const limit = policy.backpressure.maxHeavyBuildsPerRunnerClass[rc] ?? policy.backpressure.maxHeavyBuildsPerRunnerClass.ANY;
    if ((heavyByRunner.get(rc) ?? 0) >= limit) reasons.push(`heavy-build limit reached on ${rc}`);
  }
  if (agent.health?.status && agent.health.status !== 'HEALTHY') reasons.push(`agent health ${agent.health.status}`);
  // Fairness score: prefer specialists (fewer surplus capabilities), then least-recently assigned.
  const surplus = agent.capabilities.length - (task.requirements?.capabilities ?? []).length;
  const idleHours = agent.assignment?.lastReleasedAt ? hours(agent.assignment.lastReleasedAt, ctx.now) : 0;
  const score = -surplus + Math.min(idleHours, 72) / 24 - (agent.health?.consecutiveFailures ?? 0);
  return { ok: reasons.length === 0, reasons, score };
}

/**
 * Produce a scheduling plan.
 * snapshot: { tasks, agents, reservations }
 */
export function plan(snapshot, policy, now) {
  const tasks = snapshot.tasks ?? [];
  const agents = (snapshot.agents ?? []).filter((a) => a.state !== 'RETIRED');
  const reservations = snapshot.reservations ?? [];
  const tasksById = new Map(tasks.map((t) => [t.objectId, t]));
  const active = tasks.filter((t) => ACTIVE_WORK.has(t.state));
  const activeByAgent = new Map();
  const heavyByRunner = new Map();
  const agentById = new Map(agents.map((a) => [a.objectId, a]));
  for (const t of active) {
    if (!t.owner) continue;
    activeByAgent.set(t.owner.agentId, (activeByAgent.get(t.owner.agentId) ?? 0) + 1);
    if (policy.scheduler.heavyBuildCapacityClasses.includes(t.requirements?.capacityClass)) {
      const rc = agentById.get(t.owner.agentId)?.capacity.runnerClass ?? 'ANY';
      heavyByRunner.set(rc, (heavyByRunner.get(rc) ?? 0) + 1);
    }
  }
  const ctx = { policy, now, tasksById, activeByAgent, heavyByRunner };
  const blockingRes = reservations.filter((r) => policy.reservation.blockingStates.includes(r.state));

  const candidates = tasks
    .filter((t) => t.state === 'UNASSIGNED')
    .map((t) => ({ task: t, prio: effectivePriority(t, policy, now) }))
    .sort((x, y) => y.prio.effective - x.prio.effective
      || (RISK_PENALTY[x.task.risk] ?? 0) - (RISK_PENALTY[y.task.risk] ?? 0)
      || Date.parse(x.task.createdAt) - Date.parse(y.task.createdAt)
      || x.task.objectId.localeCompare(y.task.objectId));

  const assignments = [];
  const deferred = [];
  let slots = policy.backpressure.maxActiveTasks - active.length;
  const planned = [];
  for (const { task, prio } of candidates) {
    const why = [];
    if (task.execution?.hold) why.push('task on HOLD');
    if (task.execution?.decisionPending) why.push('waiting for Manager decision');
    const blocking = blockingDependencies(task, tasksById);
    if (blocking.length) why.push(`dependencies: ${blocking.map((b) => `${b.taskId}(${b.state})`).join(', ')}`);
    const sv = scopeVerdict(task, blockingRes, policy);
    if (sv.outcome === 'CONFLICT') why.push(`reservation conflict: ${sv.conflicts.map((c) => `${c.reservationId}/${c.dimension}`).join(', ')}`);
    if (sv.outcome === 'UNKNOWN') why.push('undeclared scope (fail closed)');
    for (const p of planned) {
      const pc = classifyPair(task, p, ctx);
      if (pc.class === 'SERIALIZED' || pc.class === 'HOLD') { why.push(`serialized behind planned ${p.objectId}: ${pc.reason}`); break; }
    }
    if (slots <= 0) why.push('backpressure: maxActiveTasks reached');
    let best = null;
    const rejections = [];
    if (!why.length) {
      for (const agent of agents) {
        const m = matchAgent(task, agent, ctx);
        if (!m.ok) { rejections.push({ agentId: agent.objectId, reasons: m.reasons }); continue; }
        if (!best || m.score > best.score || (m.score === best.score && agent.objectId < best.agentId)) best = { agentId: agent.objectId, score: m.score };
      }
      if (!best) why.push('no eligible agent (capability/capacity/runner)');
    }
    if (why.length) {
      deferred.push({ taskId: task.objectId, priority: prio, reasons: why, agentRejections: rejections.slice(0, 10) });
      continue;
    }
    assignments.push({ taskId: task.objectId, agentId: best.agentId, priority: prio, command: 'TASK_ASSIGN' });
    activeByAgent.set(best.agentId, (activeByAgent.get(best.agentId) ?? 0) + 1);
    if (policy.scheduler.heavyBuildCapacityClasses.includes(task.requirements?.capacityClass)) {
      const rc = agentById.get(best.agentId).capacity.runnerClass;
      heavyByRunner.set(rc, (heavyByRunner.get(rc) ?? 0) + 1);
    }
    planned.push(task);
    slots -= 1;
  }

  // Cross-P concurrency matrix over active + newly planned work (#267 "show why tasks are serialized").
  const inFlight = [...active, ...planned];
  const pairs = [];
  for (let i = 0; i < inFlight.length; i += 1) {
    for (let j = i + 1; j < inFlight.length; j += 1) {
      const c = classifyPair(inFlight[i], inFlight[j], ctx);
      pairs.push({ a: inFlight[i].objectId, b: inFlight[j].objectId, programs: [inFlight[i].program, inFlight[j].program], ...c });
    }
  }

  // Alerts: starvation, anti-thrashing, idle workers, backpressure.
  const s = policy.scheduler;
  const at = policy.antiThrashing;
  const alerts = [];
  for (const d of deferred) {
    const t = tasksById.get(d.taskId);
    if (hours(t.createdAt, now) >= s.starvationAlertHours || (t.history?.deferCount ?? 0) >= s.starvationAlertDeferrals) alerts.push({ kind: 'STARVATION', taskId: t.objectId, reasons: d.reasons });
  }
  for (const t of tasks.filter((x) => !isTerminal(policy, 'Task', x.state) && x.state !== 'FROZEN')) {
    const h = t.history ?? {};
    const trips = [
      ['reassignedCount', at.reassignFreezeThreshold], ['recoveryCount', at.recoveryFreezeThreshold], ['ciRetryCount', at.ciRetryFreezeThreshold],
      ['reservationConflictCount', at.reservationConflictFreezeThreshold], ['scopeCorrectionCount', at.scopeCorrectionFreezeThreshold],
    ].filter(([k, lim]) => (h[k] ?? 0) >= lim).map(([k, lim]) => `${k}=${h[k]}>=${lim}`);
    if (trips.length) alerts.push({ kind: 'ANTI_THRASH_FREEZE', taskId: t.objectId, reasons: trips, action: at.action, command: ACTIVE_WORK.has(t.state) || t.state === 'VERIFYING' ? 'TASK_FREEZE' : null });
  }
  for (const a of agents) {
    if (a.state === 'AVAILABLE' && a.assignment?.lastReleasedAt && hours(a.assignment.lastReleasedAt, now) >= s.workerIdleAlertHours && deferred.length) {
      alerts.push({ kind: 'WORKER_IDLE_WITH_BACKLOG', agentId: a.objectId, reasons: ['idle while tasks are deferred — check capability/scope fit'] });
    }
  }
  const queued = candidates.length;
  if (queued >= policy.backpressure.maxQueuedTasks) alerts.push({ kind: 'BACKPRESSURE', reasons: [`queued ${queued} >= ${policy.backpressure.maxQueuedTasks}`] });
  if (active.length >= policy.backpressure.maxActiveTasks) alerts.push({ kind: 'BACKPRESSURE', reasons: [`active ${active.length} >= ${policy.backpressure.maxActiveTasks}`] });

  const summary = { SAFE_PARALLEL: 0, CONDITIONAL_PARALLEL: 0, SERIALIZED: 0, HOLD: 0 };
  for (const p of pairs) summary[p.class] += 1;
  return {
    generatedAt: now,
    capacity: { maxActiveTasks: policy.backpressure.maxActiveTasks, active: active.length, plannedAssignments: assignments.length, queued },
    assignments,
    deferred,
    concurrency: { summary, pairs },
    alerts,
  };
}
