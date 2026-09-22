/**
 * Capability governance: lifecycle states, criticality, trust and degradation.
 *
 * These are the semantic rules the registry enforces as *data*. Nothing here
 * loads, mounts or renders anything — a frontend LEGO is metadata first, and the
 * expensive part (code) stays outside until somebody asks for it.
 *
 *   declared/available  ≠  installed  ≠  loaded  ≠  active
 *
 * The distinction matters for two reasons: an installed feature must not consume
 * runtime resources, and a missing optional feature must degrade to a documented
 * fallback instead of breaking the editor.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */

/** Runtime states of a capability, from "the catalog mentions it" to "switched off". */
export const CAPABILITY_STATES = Object.freeze([
  'available',  // declared in the contract catalog; no package resolved yet
  'installed',  // package present; metadata registered; code never evaluated
  'loaded',     // module evaluated; nothing rendered, no hook attached
  'active',     // attached to its surfaces and rendering
  'idle',       // activated earlier, currently quiescent (background tab, unused route)
  'unloaded',   // code released; metadata kept so it can come back
  'disabled',   // administratively off; must not be auto-activated
]);

/** The state machine. Everything not listed here is a refused transition. */
export const STATE_TRANSITIONS = Object.freeze({
  available: Object.freeze(['installed', 'disabled']),
  installed: Object.freeze(['loaded', 'unloaded', 'disabled']),
  loaded: Object.freeze(['active', 'unloaded', 'disabled']),
  active: Object.freeze(['idle', 'unloaded', 'disabled']),
  idle: Object.freeze(['active', 'unloaded', 'disabled']),
  unloaded: Object.freeze(['loaded', 'installed', 'disabled']),
  disabled: Object.freeze(['available']),
});

/** States in which a capability may render or answer an operation. */
export const RUNNABLE_STATES = Object.freeze(['loaded', 'active', 'idle']);

/** How much the UI may rely on a capability. */
export const CRITICALITY = Object.freeze(['core', 'optional', 'enhancement']);

/** Who wrote a capability, and therefore what it may touch. */
export const TRUST_LEVELS = Object.freeze(['core', 'feature', 'extension', 'untrusted']);

const TRUST_RANK = Object.freeze({ core: 0, feature: 1, extension: 2, untrusted: 3 });

/** What each trust level may do. A child may not be more trusted than its parent. */
export const TRUST_RULES = Object.freeze({
  core: Object.freeze({
    may: Object.freeze(['render-own-surfaces', 'own-routes', 'attach-hooks', 'read-session', 'call-declared-endpoints', 'register-commands']),
    mayNot: Object.freeze([]),
  }),
  feature: Object.freeze({
    may: Object.freeze(['render-own-surfaces', 'attach-hooks', 'read-session', 'call-declared-endpoints', 'register-commands']),
    mayNot: Object.freeze(['own-routes', 'mutate-context-not-its-own']),
  }),
  extension: Object.freeze({
    may: Object.freeze(['attach-hooks', 'render-own-subtree', 'call-declared-endpoints']),
    mayNot: Object.freeze(['own-routes', 'read-session', 'mutate-context-not-its-own', 'observe-other-extensions']),
  }),
  untrusted: Object.freeze({
    may: Object.freeze(['render-own-subtree']),
    mayNot: Object.freeze(['attach-hooks', 'own-routes', 'read-session', 'call-declared-endpoints', 'mutate-context-not-its-own']),
  }),
});

export class LifecycleError extends Error {
  constructor(message, { capabilityId, from, to } = {}) {
    super(message);
    this.name = 'LifecycleError';
    this.code = 'frontend.lifecycle.invalid-transition';
    this.capabilityId = capabilityId ?? null;
    this.from = from ?? null;
    this.to = to ?? null;
  }
}

/** Rank of a trust level (lower is more trusted). */
export function trustRank(level) {
  const rank = TRUST_RANK[level];
  if (rank === undefined) throw new Error(`unknown trust level "${level}" (one of ${TRUST_LEVELS.join(', ')})`);
  return rank;
}

/** True when `child` is no more trusted than `parent` — the inheritance rule. */
export function trustInherited(parentLevel, childLevel) {
  try {
    return trustRank(childLevel) >= trustRank(parentLevel);
  } catch {
    return false;
  }
}

/** Whether a trust level may perform an action, with the reason when it may not. */
export function mayPerform(level, action) {
  const rules = TRUST_RULES[level];
  if (!rules) return { allowed: false, reason: `unknown trust level "${level}"` };
  if (rules.may.includes(action)) return { allowed: true, reason: null };
  return { allowed: false, reason: `trust level "${level}" may not ${action}` };
}

/**
 * What happens when a capability is not available.
 *
 * `core` may not be treated as optional: if it is missing the UI is wrong, and
 * pretending otherwise hides a broken instance. `optional` degrades to a declared
 * fallback. `enhancement` is left out without comment.
 */
export function degradationFor({ criticality, degradation } = {}) {
  if (!CRITICALITY.includes(criticality)) {
    return Object.freeze({ behavior: 'fail-loud', fallback: null, detail: `unknown criticality "${criticality}" — treated as core` });
  }
  if (criticality === 'core') {
    return Object.freeze({ behavior: 'fail-loud', fallback: null, detail: 'a core capability that is missing is a broken instance, not a degraded one' });
  }
  if (criticality === 'optional') {
    return Object.freeze({
      behavior: 'fallback',
      fallback: degradation?.fallback ?? 'native-behavior',
      detail: degradation?.detail ?? 'the surface keeps working with its built-in behavior',
    });
  }
  return Object.freeze({ behavior: 'continue', fallback: 'none', detail: 'absence needs no fallback and no notice' });
}

/** Is a capability usable in this state, and is it worth waking up? */
export function isRunnable(state) {
  return RUNNABLE_STATES.includes(state);
}

export function canTransition(from, to) {
  return Boolean(STATE_TRANSITIONS[from]?.includes(to));
}

/**
 * A single capability's runtime state, with an audit trail.
 *
 * Deliberately tiny: the registry stays cheap, and a state machine that needs a
 * scheduler to be correct is a scheduler, not a state machine.
 *
 * @param {{ capabilityId: string, state?: string, now?: () => number }} init
 */
export function createLifecycle({ capabilityId, state = 'available', now = () => Date.now() } = {}) {
  if (!capabilityId) throw new LifecycleError('createLifecycle needs a capabilityId');
  if (!CAPABILITY_STATES.includes(state)) {
    throw new LifecycleError(`unknown initial state "${state}"`, { capabilityId, to: state });
  }

  let current = state;
  const history = [{ state, at: now() }];

  function transition(next, { reason = null } = {}) {
    if (!CAPABILITY_STATES.includes(next)) {
      throw new LifecycleError(`unknown state "${next}"`, { capabilityId, from: current, to: next });
    }
    if (next === current) return current;
    if (!canTransition(current, next)) {
      throw new LifecycleError(
        `"${capabilityId}" cannot move ${current} -> ${next} (allowed: ${(STATE_TRANSITIONS[current] ?? []).join(', ') || 'none'})`,
        { capabilityId, from: current, to: next },
      );
    }
    current = next;
    history.push({ state: next, at: now(), reason });
    return current;
  }

  return Object.freeze({
    capabilityId,
    get state() {
      return current;
    },
    get runnable() {
      return isRunnable(current);
    },
    can: (next) => canTransition(current, next),
    transition,
    /** A copy per read: the internal trail keeps growing, the exposed one cannot be edited. */
    get history() {
      return Object.freeze([...history]);
    },
    describe: () => Object.freeze({ capabilityId, state: current, runnable: isRunnable(current) }),
  });
}

/** Human-readable catalog of the states, for docs, `.ai/` cards and the boot payload. */
export function describeLifecycle() {
  return Object.freeze(CAPABILITY_STATES.map((state) => Object.freeze({
    state,
    runnable: isRunnable(state),
    canMoveTo: STATE_TRANSITIONS[state],
  })));
}

/** Trust model as data: levels, inheritance rule and the per-level permissions. */
export function describeTrust() {
  return Object.freeze(TRUST_LEVELS.map((level) => Object.freeze({
    level,
    rank: TRUST_RANK[level],
    may: TRUST_RULES[level].may,
    mayNot: TRUST_RULES[level].mayNot,
  })));
}
