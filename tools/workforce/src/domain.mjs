// Workforce control plane — pure domain rules (no I/O):
//   reservations (normalization, fingerprint, conflict detection)   #262 §7-9, #264 §4
//   dependency graph (typed deps, cycle rejection, readiness)        #264 §10
//   merge-lane classifier                                            #264 §8, #262 §16-18
//   prompt-governance conflict detection                             #266
import { canonicalJson, sha256 } from './core.mjs';

// ---------------------------------------------------------------- reservations
export function normalizePath(p) {
  let s = String(p).trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  while (s.startsWith('./')) s = s.slice(2);
  if (s.startsWith('/')) s = s.slice(1);
  if (s.endsWith('/')) s += '**';
  return s;
}

function normalizeToken(t) {
  return String(t).trim().toLowerCase();
}

/** Canonical scope: every dimension present, values normalized, de-duplicated and sorted. */
export function normalizeScope(scope = {}, dimensions) {
  const out = {};
  for (const dim of dimensions) {
    const values = (scope[dim] ?? []).map((v) => (dim === 'paths' ? normalizePath(v) : normalizeToken(v))).filter(Boolean);
    out[dim] = [...new Set(values)].sort();
  }
  return out;
}

export function scopeFingerprint(scope, dimensions) {
  return sha256(canonicalJson(normalizeScope(scope, dimensions)));
}

function literalPrefix(pattern) {
  const i = pattern.search(/[*?[{]/);
  return i === -1 ? pattern : pattern.slice(0, i);
}

/** Conservative glob overlap: two patterns overlap unless their literal prefixes diverge. */
export function pathsOverlap(a, b) {
  const pa = literalPrefix(a);
  const pb = literalPrefix(b);
  const aWild = pa !== a;
  const bWild = pb !== b;
  if (!aWild && !bWild) return a === b;
  if (aWild && bWild) return pa.startsWith(pb) || pb.startsWith(pa);
  const [literal, prefix] = aWild ? [b, pa] : [a, pb];
  return literal.startsWith(prefix);
}

export function dimensionOverlap(dim, left, right) {
  if (dim === 'paths') {
    const hits = [];
    for (const a of left) for (const b of right) if (pathsOverlap(a, b)) hits.push(a === b ? a : `${a} ~ ${b}`);
    return hits;
  }
  const set = new Set(right);
  return left.filter((v) => set.has(v));
}

/**
 * Compare a candidate reservation against existing blocking reservations of OTHER tasks.
 * Evaluation follows policy.reservation.conflictOrder. Unknown compatibility fails closed.
 * Returns { outcome: 'CLEAR'|'CONDITIONAL'|'CONFLICT', conflicts: [...] }.
 */
export function evaluateReservation(candidate, existing, policy) {
  const rp = policy.reservation;
  const dims = rp.dimensions;
  const cScope = normalizeScope(candidate.scope, dims);
  const cFp = scopeFingerprint(candidate.scope, dims);
  const conflicts = [];
  for (const other of existing) {
    if (other.objectId === candidate.objectId || other.taskId === candidate.taskId) continue;
    if (!rp.blockingStates.includes(other.state)) continue;
    const oScope = normalizeScope(other.scope, dims);
    const compat = rp.compatibility?.[candidate.mode]?.[other.mode] ?? rp.unknownCompatibility;
    // Every overlapping dimension is evaluated; the MOST severe verdict wins (fail closed). The
    // reported dimension is the first one, in canonical conflictOrder, carrying that verdict.
    let worst = null;
    for (const dim of rp.conflictOrder) {
      let overlap;
      if (dim === 'identity') overlap = cFp === (other.fingerprint ?? scopeFingerprint(other.scope, dims)) && dims.some((d) => cScope[d].length) ? ['identical scope fingerprint'] : [];
      else overlap = dimensionOverlap(dim, cScope[dim], oScope[dim]);
      if (!overlap.length) continue;
      let verdict = compat;
      if (rp.alwaysConflictDimensions.includes(dim) && !(candidate.mode === 'SHARED_READ' && other.mode === 'SHARED_READ')) verdict = 'CONFLICT';
      if (verdict === 'COMPATIBLE') continue;
      if (verdict !== 'CONDITIONAL') verdict = 'CONFLICT';
      if (!worst || (verdict === 'CONFLICT' && worst.compatibility !== 'CONFLICT')) worst = { reservationId: other.objectId, dimension: dim, compatibility: verdict, overlap: overlap.slice(0, 10) };
    }
    if (worst) conflicts.push(worst);
  }
  const outcome = conflicts.some((c) => c.compatibility === 'CONFLICT') ? 'CONFLICT' : conflicts.length ? 'CONDITIONAL' : 'CLEAR';
  return { outcome, conflicts, fingerprint: cFp };
}

// ---------------------------------------------------------------- dependency graph
/** Detect a cycle reachable from `startId` given adjacency getter. Returns the cycle path or null. */
export function findCycle(tasksById, startId, extraEdges = []) {
  const edges = new Map();
  for (const t of tasksById.values()) edges.set(t.objectId, (t.dependencies ?? []).map((d) => d.taskId));
  for (const [from, to] of extraEdges) edges.set(from, [...(edges.get(from) ?? []), to]);
  const stack = [];
  const onStack = new Set();
  const done = new Set();
  const visit = (id) => {
    if (onStack.has(id)) return [...stack.slice(stack.indexOf(id)), id];
    if (done.has(id)) return null;
    stack.push(id); onStack.add(id);
    for (const next of edges.get(id) ?? []) {
      const c = visit(next);
      if (c) return c;
    }
    stack.pop(); onStack.delete(id); done.add(id);
    return null;
  };
  return visit(startId);
}

/** Dependencies that currently block (REQUIRED not COMPLETED; CONDITIONAL with conditionMet=true not COMPLETED). */
export function blockingDependencies(task, tasksById) {
  const blocking = [];
  for (const dep of task.dependencies ?? []) {
    const target = tasksById.get(dep.taskId);
    const complete = target?.state === 'COMPLETED';
    if (dep.type === 'REQUIRED' && !complete) blocking.push({ ...dep, state: target?.state ?? 'MISSING' });
    if (dep.type === 'CONDITIONAL' && dep.conditionMet === true && !complete) blocking.push({ ...dep, state: target?.state ?? 'MISSING' });
  }
  return blocking;
}

// ---------------------------------------------------------------- merge-lane classifier
/**
 * Structured classifier (#264 §8). Returns { lane, readyEligible, reasons }.
 * SAFE-AUTO is a policy RESULT: every mandatory gate must be clear. Anything uncertain routes to
 * MANAGER; failed/unknown checks route to HOLD.
 */
export function classifyMerge(item, policy, context = {}) {
  const mp = policy.merge;
  const reasons = [];
  const holdReasons = [];
  const checks = item.checks ?? {};
  for (const name of mp.checkNames) {
    const v = checks[name];
    if (v !== mp.passValues[name]) holdReasons.push(`check ${name}=${v ?? 'MISSING'}`);
  }
  if (checks.checkedHeadSha && checks.checkedHeadSha !== item.pr.headSha) holdReasons.push('checks were produced for a different head SHA');
  if (!checks.checkedHeadSha) holdReasons.push('checks are not anchored to the exact head SHA');
  const cls = item.classification ?? {};
  for (const flag of mp.managerLaneFlags) if (cls[flag] === true) reasons.push(`classification.${flag}`);
  for (const flag of mp.managerLaneFlags) if (cls[flag] === undefined) reasons.push(`classification.${flag} unknown (fail closed)`);
  const rollback = item.rollback?.class;
  if (!mp.safeAutoRollbackClasses.includes(rollback)) reasons.push(`rollback class ${rollback ?? 'unknown'}`);
  if (item.rollback?.verified !== true) reasons.push('rollback not verified');
  if (context.task?.execution?.mergeLane && context.task.execution.mergeLane !== 'SAFE-AUTO') reasons.push(`task declares lane ${context.task.execution.mergeLane}`);
  if (context.managerLaneReservation) reasons.push('task holds a CONTRACT_LOCK/GOVERNANCE_LOCK reservation');
  if (context.unresolvedDependencies?.length) holdReasons.push(`unresolved dependencies: ${context.unresolvedDependencies.join(', ')}`);
  if (holdReasons.length) return { lane: 'HOLD', readyEligible: false, reasons: [...holdReasons, ...reasons] };
  if (reasons.length) return { lane: 'MANAGER', readyEligible: true, reasons };
  return { lane: 'SAFE-AUTO', readyEligible: true, reasons: ['all mandatory gates clear'] };
}

// ---------------------------------------------------------------- prompt-governance conflicts
const PROMPT_PATTERNS = [
  ['IGNORE_RULES', /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|prior|all|the)?\s*(rules?|instructions?|governance|restrictions?|policy|policies)\b/i],
  ['ROLE_ESCALATION', /\byou\s+(are|have)\s+(now\s+)?(the\s+)?(manager|admin|owner|root)\b|\b(grant|give)\s+(yourself|itself|me)\b[^.\n]{0,30}\b(authority|permission|manager)\b|\bmanager\s+authority\b[^.\n]{0,20}\b(granted|now yours)\b/i],
  ['GOVERNANCE_MUTATION', /\b(change|modify|rewrite|remove|override|redefine|delete)\b[^.\n]{0,30}\b(state\s*machine|transition\s*matrix|schema|governance|command\s*(api|protocol)|protected\s*labels?|labels?|merge\s*(lane|policy)|branch\s*(policy|protection)|restriction)\b/i],
  ['SKIP_CONTROLS', /\b(skip|bypass|disable)\b[^.\n]{0,20}\b(tests?|acceptance|approval|security|review|ci|checks?|gates?)\b/i],
  ['FORCE_MERGE', /\bmerge\s+(anyway|directly|now\s+regardless|without)\b|\bthis\s+branch\s+is\s+allowed\s+to\s+merge\b/i],
  ['SCOPE_OVERRIDE', /\bthis\s+task\s+overrides?\s+(the\s+)?(architecture|governance|policy)\b/i],
];

/**
 * Classify instruction text. A match never changes authority — it only produces a finding that
 * the engine attaches to a denial and that can be filed as a PROMPT_GOVERNANCE_CONFLICT request.
 */
export function detectPromptGovernanceConflict(text) {
  const s = String(text ?? '');
  const findings = PROMPT_PATTERNS.filter(([, re]) => re.test(s)).map(([code]) => code);
  return { conflict: findings.length > 0, conflictClass: findings.length ? 'PROMPT_GOVERNANCE_CONFLICT' : null, findings };
}

/** Collect all free text in a command that could carry an injected instruction. */
export function commandText(command) {
  const parts = [command?.reason ?? ''];
  const walk = (v) => {
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(command?.payload);
  return parts.join('\n');
}
