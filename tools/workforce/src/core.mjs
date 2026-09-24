// Workforce control plane — shared primitives: canonical JSON, digests, error contract, policy loading.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORKFORCE_DOCS } from './schema.mjs';

/** Deterministic JSON: object keys sorted recursively, no whitespace. Used for digests/idempotency. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function sha256(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

export function isoNow(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, (m) => (m === '.000Z' ? 'Z' : m));
}

export function addSeconds(iso, seconds) {
  return isoNow(new Date(Date.parse(iso) + seconds * 1000));
}

export function secondsBetween(fromIso, toIso) {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 1000;
}

// ---------------------------------------------------------------------------------------------
// Stable error contract (#265 §20). `retrySafe` tells the caller whether resubmitting the SAME
// command (same idempotency key) can succeed without an intervening state change.
export const ERROR_CODES = Object.freeze({
  INVALID_SCHEMA: { retrySafe: false, summary: 'command or resulting object fails the canonical schema' },
  UNAUTHORIZED: { retrySafe: false, summary: 'actor identity is unknown or disabled' },
  FORBIDDEN: { retrySafe: false, summary: 'actor role/scope may not perform this command' },
  REVISION_CONFLICT: { retrySafe: false, summary: 'expectedRevision differs from the current revision; reload and resubmit with a new key' },
  IDEMPOTENCY_CONFLICT: { retrySafe: false, summary: 'idempotency key already used with a different semantic payload' },
  NOT_FOUND: { retrySafe: false, summary: 'target or referenced object does not exist' },
  INVALID_STATE_TRANSITION: { retrySafe: false, summary: 'transition is not in the exact state matrix' },
  DEPENDENCY_BLOCKED: { retrySafe: true, summary: 'a REQUIRED (or triggered CONDITIONAL) dependency is not complete, or the graph would contain a cycle' },
  RESERVATION_CONFLICT: { retrySafe: true, summary: 'scope conflicts with a blocking reservation' },
  LEASE_EXPIRED: { retrySafe: false, summary: 'required lease has expired; a replacement lease is needed' },
  LEASE_REVOKED: { retrySafe: false, summary: 'required lease was revoked, transferred or completed' },
  EVIDENCE_INSUFFICIENT: { retrySafe: true, summary: 'required verified evidence is missing' },
  MERGE_HEAD_CHANGED: { retrySafe: false, summary: 'observed PR head differs from the pinned exact head' },
  POLICY_DENIED: { retrySafe: false, summary: 'policy forbids this command in the current context' },
  GOVERNANCE_REQUIRED: { retrySafe: false, summary: 'governance mutation requires Manager authority; file REQUEST_MANAGER_CHANGE' },
  HUMAN_APPROVAL_REQUIRED: { retrySafe: true, summary: 'an explicit HUMAN approval for this command/subject is required' },
  RESOURCE_UNAVAILABLE: { retrySafe: true, summary: 'capacity/backpressure/lock limit reached' },
  ALREADY_TERMINAL: { retrySafe: false, summary: 'object is in a terminal state and is immutable' },
  DUPLICATE: { retrySafe: false, summary: 'object id already exists' },
  INTERNAL_RECOVERY_REQUIRED: { retrySafe: true, summary: 'store needs recovery/reconciliation before accepting mutations' },
});

export class CommandError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    if (!ERROR_CODES[code]) throw new Error(`unknown error code ${code}`);
    this.code = code;
    this.details = details;
  }
}

export function fail(code, message, details) {
  throw new CommandError(code, message, details);
}

// ---------------------------------------------------------------------------------------------
export const POLICY_PATH = join(WORKFORCE_DOCS, 'policy.json');

/** Structural validation of the canonical policy. The engine refuses to start on any error. */
export function validatePolicy(policy) {
  const errors = [];
  const sm = policy.stateMachines ?? {};
  for (const [type, machine] of Object.entries(sm)) {
    const states = new Set(Object.keys(machine.transitions));
    if (!states.has(machine.initial)) errors.push(`${type}: initial ${machine.initial} is not a state`);
    for (const t of machine.terminal) {
      if (!states.has(t)) errors.push(`${type}: terminal ${t} is not a state`);
      else if (machine.transitions[t].length) errors.push(`${type}: terminal ${t} must have no outgoing transitions`);
    }
    for (const [from, tos] of Object.entries(machine.transitions)) {
      for (const to of tos) {
        if (!states.has(to)) errors.push(`${type}: ${from} -> ${to} targets an unknown state`);
        if (from === to && !(machine.selfTransitions ?? []).includes(from)) errors.push(`${type}: undeclared self transition ${from}`);
      }
    }
  }
  for (const [type, machine] of Object.entries(sm)) {
    for (const [from, to] of machine.managerOnlyEdges?.edges ?? []) {
      if (!(machine.transitions[from] ?? []).includes(to)) errors.push(`${type}: managerOnlyEdge ${from} -> ${to} is not in the transition matrix`);
    }
  }
  const roles = new Set(policy.actorTypes);
  for (const [name, spec] of Object.entries(policy.commands ?? {})) {
    const machine = sm[spec.target];
    if (spec.to && machine && !(spec.to in machine.transitions)) errors.push(`${name}: to=${spec.to} is not a ${spec.target} state`);
    for (const r of Object.keys(spec.roles ?? {})) if (!roles.has(r)) errors.push(`${name}: unknown role ${r}`);
    if (!Object.keys(spec.roles ?? {}).length) errors.push(`${name}: no role may run it`);
    if (spec.roles?.SYSTEM && (policy.systemNeverAllowed ?? []).includes(name)) errors.push(`${name}: SYSTEM role conflicts with systemNeverAllowed`);
    for (const f of spec.from ?? []) if (machine && !(f in machine.transitions)) errors.push(`${name}: from=${f} unknown`);
  }
  for (const [actor, cmds] of Object.entries(policy.systemActorAllowlist ?? {})) {
    for (const c of cmds) {
      if (!policy.commands[c]) errors.push(`system allowlist ${actor}: unknown command ${c}`);
      else if (!policy.commands[c].roles.SYSTEM) errors.push(`system allowlist ${actor}: ${c} does not admit SYSTEM`);
    }
  }
  const modes = policy.reservation?.modes ?? [];
  for (const a of modes) for (const b of modes) {
    const ab = policy.reservation.compatibility?.[a]?.[b];
    const ba = policy.reservation.compatibility?.[b]?.[a];
    if (!ab) errors.push(`reservation compatibility ${a}/${b} missing`);
    else if (ab !== ba) errors.push(`reservation compatibility ${a}/${b} is not symmetric`);
  }
  for (const lt of Object.keys(policy.leases ?? {})) {
    const l = policy.leases[lt];
    if (!(l.ttlSeconds > 0) || l.maxLifetimeSeconds < l.ttlSeconds) errors.push(`lease ${lt}: invalid ttl/maxLifetime`);
  }
  if (!(policy.timing?.pollIntervalMaxMs <= 1000)) errors.push('timing.pollIntervalMaxMs must be <= 1000 (runner protocol)');
  if (!(policy.timing?.lockPollMs <= 1000)) errors.push('timing.lockPollMs must be <= 1000 (runner protocol)');
  if ((policy.labels?.workerWhitelist ?? []).some((l) => (policy.labels.protectedPrefixes ?? []).some((p) => l.startsWith(p)))) errors.push('labels: worker whitelist contains a protected label');
  return errors;
}

let policyCache = null;
export function loadPolicy(path = POLICY_PATH) {
  if (policyCache?.path === path) return policyCache;
  const text = readFileSync(path, 'utf8');
  const policy = JSON.parse(text);
  const errors = validatePolicy(policy);
  if (errors.length) throw new Error(`workforce policy invalid:\n- ${errors.join('\n- ')}`);
  policyCache = { path, policy, digest: sha256(canonicalJson(policy)) };
  return policyCache;
}

export function isTerminal(policy, objectType, state) {
  return (policy.stateMachines[objectType]?.terminal ?? []).includes(state);
}

export function canTransition(policy, objectType, from, to) {
  return (policy.stateMachines[objectType]?.transitions[from] ?? []).includes(to);
}
