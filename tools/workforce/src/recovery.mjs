// Recovery, reconciliation and replay verification (#264 §5, §15; #265 §28-§30).
//
// reconcile() is read-only: it reports findings and PROPOSED commands. applySafeRecovery() executes
// only the mechanical, policy-allowlisted actions (expire elapsed leases/reservations) through the
// normal command pipeline as SYSTEM-RECOVERY. Everything that needs judgement (LOST, transfer,
// cancellation, freeze) is surfaced for the Manager and never auto-applied.
import { canTransition, isTerminal } from './core.mjs';
import { validate } from './schema.mjs';

const OBJECT_TYPES = ['Task', 'AgentState', 'Reservation', 'Lease', 'Evidence', 'Decision', 'MergeQueueItem', 'Handoff', 'Request', 'Approval', 'JournalEntry', 'Actor', 'Slice'];
const secs = (a, b) => (Date.parse(b) - Date.parse(a)) / 1000;

export function snapshot(store) {
  const out = {};
  for (const t of OBJECT_TYPES) out[t] = store.list(t);
  return out;
}

/** Verify the event log: ordering, per-object revision monotonicity and legal state chains. */
export function verifyEventLog(store, policy) {
  const findings = [];
  const events = store.events();
  const seen = new Set();
  const lastRev = new Map();
  const lastState = new Map();
  let prevSeq = 0;
  for (const e of events) {
    if (seen.has(e.eventId)) findings.push({ kind: 'DUPLICATE_EVENT', eventId: e.eventId });
    seen.add(e.eventId);
    const seq = Number(e.eventId.slice(4));
    if (seq <= prevSeq) findings.push({ kind: 'EVENT_ORDER', eventId: e.eventId });
    prevSeq = seq;
    const errs = validate('Event', e);
    if (errs.length) findings.push({ kind: 'INVALID_EVENT', eventId: e.eventId, errors: errs });
    const key = `${e.objectType}/${e.objectId}`;
    if (lastRev.has(key) && e.revision < lastRev.get(key)) findings.push({ kind: 'REVISION_REGRESSION', object: key, eventId: e.eventId });
    lastRev.set(key, e.revision);
    if (e.toState && policy.stateMachines[e.objectType]) {
      const prev = lastState.get(key);
      if (prev !== undefined && e.fromState !== prev) findings.push({ kind: 'STATE_CHAIN_GAP', object: key, eventId: e.eventId, expectedFrom: prev, fromState: e.fromState });
      if (e.fromState && e.fromState !== e.toState && !canTransition(policy, e.objectType, e.fromState, e.toState)) findings.push({ kind: 'ILLEGAL_TRANSITION_IN_LOG', object: key, eventId: e.eventId, from: e.fromState, to: e.toState });
      lastState.set(key, e.toState);
    }
  }
  // Every snapshot must agree with the replayed state and never be behind the log.
  for (const [key, state] of lastState) {
    const [type, id] = key.split('/');
    const obj = store.get(type, id);
    if (!obj) { findings.push({ kind: 'SNAPSHOT_MISSING', object: key }); continue; }
    if (obj.state !== state) findings.push({ kind: 'SNAPSHOT_STATE_MISMATCH', object: key, snapshot: obj.state, replayed: state });
    if (obj.revision < lastRev.get(key)) findings.push({ kind: 'SNAPSHOT_BEHIND_LOG', object: key });
  }
  return { events: events.length, findings };
}

/** Referential integrity + schema validity of every snapshot. */
export function verifyIntegrity(store, policy) {
  const s = snapshot(store);
  const findings = [];
  const byId = (type) => new Map(s[type].map((o) => [o.objectId, o]));
  const tasks = byId('Task'); const leases = byId('Lease'); const agents = byId('AgentState'); const res = byId('Reservation'); const mq = byId('MergeQueueItem');
  for (const type of OBJECT_TYPES) for (const o of s[type]) {
    const errs = validate(type, o);
    if (errs.length) findings.push({ kind: 'INVALID_SNAPSHOT', object: `${type}/${o.objectId}`, errors: errs });
  }
  for (const t of s.Task) {
    if (t.owner && !agents.has(t.owner.agentId)) findings.push({ kind: 'DANGLING_OWNER', object: `Task/${t.objectId}`, ref: t.owner.agentId });
    for (const d of t.dependencies) if (!tasks.has(d.taskId)) findings.push({ kind: 'DANGLING_DEPENDENCY', object: `Task/${t.objectId}`, ref: d.taskId });
    const l = t.execution.activeLeaseId ? leases.get(t.execution.activeLeaseId) : null;
    if (t.execution.activeLeaseId && !l) findings.push({ kind: 'DANGLING_LEASE', object: `Task/${t.objectId}`, ref: t.execution.activeLeaseId });
    if (l && l.state !== 'ACTIVE') findings.push({ kind: 'TASK_POINTS_AT_ENDED_LEASE', object: `Task/${t.objectId}`, ref: l.objectId, leaseState: l.state });
    if (isTerminal(policy, 'Task', t.state) && t.execution.activeLeaseId) findings.push({ kind: 'TERMINAL_TASK_HOLDS_LEASE', object: `Task/${t.objectId}` });
    for (const r of t.execution.reservationIds) if (!res.has(r)) findings.push({ kind: 'DANGLING_RESERVATION', object: `Task/${t.objectId}`, ref: r });
    // DEC-0015: WAITING_RUNNER work never holds a worker slot; completion never hides pending runner checks.
    if (t.state === 'WAITING_RUNNER' && (t.owner || t.execution.activeLeaseId)) findings.push({ kind: 'WAITING_RUNNER_HOLDS_SLOT', object: `Task/${t.objectId}` });
    if (t.state === 'COMPLETED' && t.runnerVerification && t.runnerVerification.status !== 'PASS' && t.runnerVerification.status !== 'NOT_REQUIRED') findings.push({ kind: 'COMPLETED_WITH_UNVERIFIED_RUNNER_CHECKS', object: `Task/${t.objectId}`, status: t.runnerVerification.status });
  }
  for (const sl of s.Slice ?? []) {
    if (sl.state === 'COMPLETED' && sl.runnerVerification && !['PASS', 'NOT_REQUIRED'].includes(sl.runnerVerification.status)) findings.push({ kind: 'COMPLETED_WITH_UNVERIFIED_RUNNER_CHECKS', object: `Slice/${sl.objectId}`, status: sl.runnerVerification.status });
    for (const id of sl.runnerVerification?.regressionTaskIds ?? []) if (!tasks.has(id)) findings.push({ kind: 'DANGLING_REGRESSION_TASK', object: `Slice/${sl.objectId}`, ref: id });
  }
  for (const r of s.Reservation) {
    if (!tasks.has(r.taskId)) findings.push({ kind: 'DANGLING_TASK', object: `Reservation/${r.objectId}`, ref: r.taskId });
    const t = tasks.get(r.taskId);
    if (t && isTerminal(policy, 'Task', t.state) && r.state === 'ACTIVE') findings.push({ kind: 'ORPHAN_ACTIVE_RESERVATION', object: `Reservation/${r.objectId}`, task: t.objectId });
  }
  const slices = byId('Slice');
  for (const m of s.MergeQueueItem) {
    if (m.taskId && !tasks.has(m.taskId)) findings.push({ kind: 'DANGLING_TASK', object: `MergeQueueItem/${m.objectId}`, ref: m.taskId });
    if (!m.taskId && !m.sliceId) findings.push({ kind: 'MQ_WITHOUT_SUBJECT', object: `MergeQueueItem/${m.objectId}` });
    if (m.sliceId && !slices.has(m.sliceId)) findings.push({ kind: 'DANGLING_SLICE', object: `MergeQueueItem/${m.objectId}`, ref: m.sliceId });
    for (const id of m.taskIds ?? []) if (!tasks.has(id)) findings.push({ kind: 'DANGLING_TASK', object: `MergeQueueItem/${m.objectId}`, ref: id });
  }
  // DEC-0014: a Slice has at most one merged delivery PR, and slice tasks never own a merge-queue item.
  for (const sl of s.Slice) {
    const merged = s.MergeQueueItem.filter((m) => m.sliceId === sl.objectId && m.mergeSha);
    if (merged.length > 1) findings.push({ kind: 'SLICE_MULTIPLE_DELIVERY_PRS', object: `Slice/${sl.objectId}`, prs: merged.map((m) => m.pr.number) });
  }
  const sliceKeys = new Set(s.Slice.map((sl) => sl.key));
  for (const m of s.MergeQueueItem) {
    const t = m.taskId ? tasks.get(m.taskId) : null;
    if (t?.slice && sliceKeys.has(t.slice)) findings.push({ kind: 'SLICE_TASK_OWN_PR', object: `MergeQueueItem/${m.objectId}`, task: t.objectId, slice: t.slice });
  }
  for (const l of s.Lease) {
    if (l.subject.taskId && !tasks.has(l.subject.taskId)) findings.push({ kind: 'DANGLING_TASK', object: `Lease/${l.objectId}`, ref: l.subject.taskId });
    if (l.subject.queueItemId && !mq.has(l.subject.queueItemId)) findings.push({ kind: 'DANGLING_MQ', object: `Lease/${l.objectId}`, ref: l.subject.queueItemId });
  }
  for (const a of s.AgentState) {
    const owned = s.Task.filter((t) => t.owner?.agentId === a.objectId && !isTerminal(policy, 'Task', t.state)).map((t) => t.objectId).sort();
    const recorded = [...(a.assignment?.taskIds ?? [])].sort();
    if (owned.join() !== recorded.join()) findings.push({ kind: 'AGENT_ASSIGNMENT_DRIFT', object: `AgentState/${a.objectId}`, recorded, derived: owned });
  }
  return findings;
}

/** Operational reconciliation: what is overdue, stale, lost or blocked right now. */
export function reconcile(store, policy, now) {
  const s = snapshot(store);
  const tm = policy.timing;
  const findings = [];
  const proposals = [];
  if (store.hasPendingJournal()) findings.push({ kind: 'PENDING_JOURNAL', severity: 'HIGH', action: 'roll forward (automatic on next command or `workforce recover`)' });
  for (const l of s.Lease.filter((x) => x.state === 'ACTIVE' && Date.parse(now) >= Date.parse(x.expiresAt))) {
    findings.push({ kind: 'LEASE_ELAPSED', object: `Lease/${l.objectId}`, expiresAt: l.expiresAt, leaseType: l.leaseType });
    if (l.leaseType === 'RESERVATION' && l.subject.reservationId) {
      const r = s.Reservation.find((x) => x.objectId === l.subject.reservationId);
      if (r?.state === 'ACTIVE') { proposals.push({ safe: true, commandType: 'RESERVATION_EXPIRE', target: { objectType: 'Reservation', objectId: r.objectId }, expectedRevision: r.revision }); continue; }
    }
    proposals.push({ safe: true, commandType: 'LEASE_EXPIRE', target: { objectType: 'Lease', objectId: l.objectId }, expectedRevision: l.revision });
  }
  for (const a of s.AgentState.filter((x) => !['RETIRED', 'LOST', 'SUSPENDED', 'STOPPED'].includes(x.state))) {
    const hasWork = (a.assignment?.taskIds ?? []).length > 0;
    const seen = a.heartbeat?.lastSeenAt;
    if (!seen) { if (hasWork) findings.push({ kind: 'NO_HEARTBEAT', object: `AgentState/${a.objectId}` }); continue; }
    const age = secs(seen, now);
    if (age >= tm.heartbeatLostCandidateSeconds && hasWork) {
      findings.push({ kind: 'LOST_CANDIDATE', severity: 'HIGH', object: `AgentState/${a.objectId}`, ageSeconds: Math.round(age) });
      proposals.push({ safe: false, commandType: 'AGENT_MARK_LOST', target: { objectType: 'AgentState', objectId: a.objectId }, expectedRevision: a.revision, note: 'Manager judgement required; heartbeat age alone never makes an agent LOST' });
    } else if (age >= tm.heartbeatStaleSeconds) findings.push({ kind: 'HEARTBEAT_STALE', object: `AgentState/${a.objectId}`, ageSeconds: Math.round(age) });
  }
  for (const t of s.Task.filter((x) => x.state === 'CLAIMED' && x.owner && secs(x.owner.assignedAt, now) >= tm.claimAckTimeoutSeconds)) {
    findings.push({ kind: 'CLAIM_NOT_ACKNOWLEDGED', object: `Task/${t.objectId}`, agentId: t.owner.agentId });
    proposals.push({ safe: false, commandType: 'TASK_UNCLAIM', target: { objectType: 'Task', objectId: t.objectId }, expectedRevision: t.revision, note: 'return to queue after ack timeout' });
  }
  for (const t of s.Task.filter((x) => x.owner && !isTerminal(policy, 'Task', x.state) && !x.execution.activeLeaseId && !['READY_FOR_REVIEW', 'MERGING', 'VERIFYING', 'HOLD'].includes(x.state))) {
    findings.push({ kind: 'TASK_WITHOUT_AUTHORITY', object: `Task/${t.objectId}`, state: t.state, note: 'owner lost or lease ended; handoff + TASK_TRANSFER or TASK_REWORK re-issues authority' });
  }
  for (const m of s.MergeQueueItem.filter((x) => x.state === 'READY' && x.checks.checkedHeadSha !== x.pr.headSha)) {
    findings.push({ kind: 'MQ_READY_UNANCHORED', severity: 'HIGH', object: `MergeQueueItem/${m.objectId}` });
  }
  const open = s.Request.filter((r) => r.state === 'OPEN');
  for (const r of open) findings.push({ kind: r.kind === 'PROMPT_GOVERNANCE_CONFLICT' ? 'PROMPT_GOVERNANCE_CONFLICT_OPEN' : 'REQUEST_OPEN', object: `Request/${r.objectId}` });
  const integrity = verifyIntegrity(store, policy);
  const log = verifyEventLog(store, policy);
  return { generatedAt: now, findings: [...findings, ...integrity, ...log.findings], proposals, events: log.events };
}

/** Apply ONLY safe proposals through the command pipeline as SYSTEM-RECOVERY. */
export function applySafeRecovery(controlPlane, now, { actorId = 'SYSTEM-RECOVERY', commandPrefix = 'CMD-recovery' } = {}) {
  const store = controlPlane.store;
  const recovered = store.hasPendingJournal() ? store.withLock(() => store.recover()) : { recovered: false };
  const report = reconcile(store, controlPlane.policy, now);
  const results = [];
  for (const p of report.proposals.filter((x) => x.safe)) {
    const stamp = `${p.target.objectId}-r${p.expectedRevision}`;
    results.push(controlPlane.execute({
      commandId: `${commandPrefix}-${stamp}`, commandType: p.commandType, schemaVersion: '1.0', actor: { type: 'SYSTEM', id: actorId },
      target: p.target, expectedRevision: p.expectedRevision, idempotencyKey: `recovery:${p.commandType}:${stamp}`, requestedAt: now,
      reason: 'lease TTL elapsed; mechanical expiry by recovery', payload: {},
    }));
  }
  return { journal: recovered, applied: results.filter((r) => r.ok).length, results, remaining: reconcile(store, controlPlane.policy, now) };
}
