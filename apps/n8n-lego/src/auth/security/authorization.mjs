/**
 * P5.3 — Authorization engine, resource policy and versioned decision cache.
 *
 * PUBLIC CONTRACT (`auth.authorization`, v1.0.0, owner: agent-1).
 *
 * ```text
 * principal + tenant + action + resourceType + resourceId + capability + policyVersion
 *   → ALLOW / DENY
 * ```
 *
 * DEFAULT IS DENY, and that is structural rather than a matter of defaults: the
 * evaluator walks an ordered list of checks and any failure returns DENY. There
 * is no code path that reaches ALLOW by falling through.
 *
 * WHAT AUTHORIZATION MUST NOT INFER. Issue #216 is explicit that authority is
 * not inferred from:
 *
 *  - **authentication** — being logged in grants nothing here;
 *  - **UI visibility** — a button existing is not a permission;
 *  - **plugin trust** — trust class is about isolation, not entitlement;
 *  - **language** — a prompt or tool name is never an authorization;
 *  - **provider existence** — a configured provider is not a grant.
 *
 * None of those appear in this file.
 *
 * APPROVAL AND STEP-UP ARE *INPUTS*, not local logic. This module consumes
 * `approval` and `requiredAuthStrength` as constraints supplied by the caller
 * (P5.6 owns the approval state machine; P5.1 owns the strength ladder). It never
 * decides what counts as an approval — it only refuses when the supplied input
 * does not satisfy the requirement.
 *
 * THE CACHE IS AN OPTIMIZATION; VERSIONS ARE THE CORRECTNESS MECHANISM.
 * A cached decision is re-checked against the current SecurityStamp on every
 * read. If authority moved on, the entry is dropped and re-evaluated. The cache
 * therefore cannot return a decision computed under older authority.
 */
import { createHash } from 'node:crypto';
import { SECURITY_REASON } from './security-error.mjs';
import { hasPermission, isPrincipalSnapshot, meetsAuthStrength } from './principal.mjs';
import { isSecurityContext } from './security-context.mjs';
import { STAMP_AUTHORITY, evaluateStampAuthority, isSecurityStamp } from './security-stamp.mjs';

/** Resource authorization outcomes. Two only — there is no "maybe". */
export const DECISION = Object.freeze({ ALLOW: 'ALLOW', DENY: 'DENY' });

/** Default cache budget. Bounded: the cache can never grow without limit. */
export const CACHE_POLICY = Object.freeze({
  maxEntries: 4_096,
  /** How many entries to evict when the budget is hit (amortised eviction). */
  evictBatch: 64,
});

function deny(reasonCode, details = null) {
  return Object.freeze({
    decision: DECISION.DENY,
    allowed: false,
    reasonCode,
    cached: false,
    details: details ? Object.freeze({ ...details }) : null,
  });
}

function allow(details = null) {
  return Object.freeze({
    decision: DECISION.ALLOW,
    allowed: true,
    reasonCode: null,
    cached: false,
    details: details ? Object.freeze({ ...details }) : null,
  });
}

/**
 * Does an approval actually cover THIS request?
 *
 * An approval for a different action or resource is not a partial approval — it
 * is no approval at all. That is the confused-deputy guard.
 */
function approvalSatisfies(approval, request, now) {
  if (!approval || approval.granted !== true) return { ok: false, why: 'absent' };
  if (typeof approval.expiresAt === 'number' && now >= approval.expiresAt) {
    return { ok: false, why: 'expired' };
  }
  if (typeof approval.action === 'string' && approval.action !== request.action) {
    return { ok: false, why: 'action-mismatch' };
  }
  if (
    typeof approval.resourceId === 'string' &&
    request.resourceId !== undefined &&
    approval.resourceId !== request.resourceId
  ) {
    return { ok: false, why: 'resource-mismatch' };
  }
  return { ok: true, why: null };
}

/**
 * Evaluates one authorization request. Pure: no I/O, no clock other than the
 * injectable `now`, no network, no storage.
 *
 * Check order is deliberate — cheapest and most fundamental first, so a malformed
 * request costs almost nothing and a prober gains no timing signal about which
 * resources exist.
 *
 * @param {object} request
 * @param {Readonly<object>} request.principal  validated PrincipalSnapshot
 * @param {string} request.action               canonical permission, e.g. `workflow:read`
 * @param {string} [request.resourceType]
 * @param {string} [request.resourceId]
 * @param {string} [request.resourceTenantId]
 * @param {string} [request.capability]         required capability token
 * @param {string[]} [request.capabilityGrants] capability tokens actually held
 * @param {string} [request.requiredAuthStrength]
 * @param {object|null} [request.approval]
 * @param {number} [request.now]
 * @param {object} [options]
 * @param {Readonly<object>} [options.registry] permission registry (enables unknown-scope denial)
 * @param {Readonly<object>} [options.context]  request SecurityContext, for stamp validation
 * @returns {Readonly<object>} decision
 */
export function authorize(request, options = {}) {
  const { registry = null, context = null } = options;
  if (request === null || typeof request !== 'object') {
    return deny(SECURITY_REASON.MALFORMED_INPUT, { field: 'request' });
  }

  const now = request.now ?? Date.now();
  const { principal, action, resourceType, resourceId, resourceTenantId } = request;

  // 1. A principal must exist and be a real snapshot. Authentication is not
  //    authorization: being signed in contributes nothing here.
  if (!isPrincipalSnapshot(principal)) {
    return deny(SECURITY_REASON.NO_PRINCIPAL, { field: 'principal' });
  }
  // 2. The action must be a canonical permission string.
  if (typeof action !== 'string' || action === '') {
    return deny(SECURITY_REASON.MALFORMED_INPUT, { field: 'action' });
  }

  // 3. UNKNOWN PERMISSION FAILS CLOSED — the P5.3 critical invariant. A typo'd or
  //    invented scope is a rejection, never an inert no-op.
  if (registry && !registry.has(action)) {
    return deny(SECURITY_REASON.UNKNOWN_PERMISSION, { action, unknownPermission: true });
  }

  // 4. Principal expiry — a bound, checked before anything expensive.
  if (typeof principal.expiresAt === 'number' && now >= principal.expiresAt) {
    return deny(SECURITY_REASON.SESSION_INVALID, { reason: 'principal-expired' });
  }

  // 5. TENANT BOUNDARY. `default` is not a wildcard — it is one tenant among
  //    others, and a cross-tenant read is denied.
  if (resourceTenantId !== undefined && resourceTenantId !== null) {
    if (principal.tenantId !== resourceTenantId) {
      return deny(SECURITY_REASON.TENANT_MISMATCH, {
        principalTenant: principal.tenantId,
        resourceTenant: resourceTenantId,
      });
    }
  }

  // 6. CONTEXT / STAMP validity, when a context is supplied.
  if (context) {
    if (!isSecurityContext(context)) {
      return deny(SECURITY_REASON.MALFORMED_INPUT, { field: 'context' });
    }
    if (context.principalId !== principal.principalId) {
      return deny(SECURITY_REASON.MALFORMED_INPUT, { reason: 'context-principal-mismatch' });
    }
    if (!isSecurityStamp(context.stamp)) {
      return deny(SECURITY_REASON.MALFORMED_INPUT, { field: 'context.stamp' });
    }
  }

  // 7. PERMISSION — the canonical scope check.
  if (!hasPermission(principal, action)) {
    return deny(SECURITY_REASON.PERMISSION_DENIED, { action });
  }

  // 8. CAPABILITY — a separate axis from permission. Holding a scope does not
  //    grant a capability; both must hold.
  if (typeof request.capability === 'string' && request.capability !== '') {
    const grants = Array.isArray(request.capabilityGrants) ? request.capabilityGrants : [];
    if (!grants.includes(request.capability)) {
      return deny(SECURITY_REASON.CAPABILITY_UNAVAILABLE, { capability: request.capability });
    }
  }

  // 9. STEP-UP — an input constraint, not a policy decided here.
  if (typeof request.requiredAuthStrength === 'string') {
    if (!meetsAuthStrength(principal, request.requiredAuthStrength)) {
      return deny(SECURITY_REASON.PERMISSION_DENIED, {
        reason: 'auth-strength-insufficient',
        required: request.requiredAuthStrength,
        actual: principal.authStrength,
      });
    }
  }

  // 10. APPROVAL — an input constraint; P5.6 owns the state machine.
  if (request.approval !== undefined && request.approval !== null) {
    const verdict = approvalSatisfies(request.approval, request, now);
    if (!verdict.ok) {
      return deny(SECURITY_REASON.APPROVAL_MISMATCH, { reason: verdict.why });
    }
  }

  return allow(resourceType === undefined ? null : { resourceType, resourceId: resourceId ?? null });
}

/**
 * A bounded, version-aware decision cache.
 *
 * Two properties matter and they are not the same property:
 *
 *  - **Bounded** — at most `maxEntries`. A flood of distinct requests cannot grow
 *    it, and eviction is batched so it stays amortised.
 *  - **Version-aware** — every entry records the SecurityStamp it was decided
 *    under. On read, if authority moved on, the entry is dropped and the caller
 *    re-evaluates.
 *
 * The cache stores **no credential material**: entries hold ids, versions and a
 * decision, never a secret.
 */
export function createDecisionCache(policy = {}) {
  const options = { ...CACHE_POLICY, ...policy };
  const entries = new Map();

  return Object.freeze({
    policy: () => ({ ...options }),
    size: () => entries.size,

    /**
     * @param {string} key
     * @param {Readonly<object>} currentStamp authority versions in force now
     * @returns {{ hit: boolean, decision: object|null, reason: string }}
     */
    get(key, currentStamp) {
      const entry = entries.get(key);
      if (!entry) return { hit: false, decision: null, reason: 'miss' };
      if (!isSecurityStamp(currentStamp)) {
        // Cannot validate → must not serve.
        entries.delete(key);
        return { hit: false, decision: null, reason: 'unstampable' };
      }
      const authority = evaluateStampAuthority(entry.stamp, currentStamp);
      if (authority.verdict !== STAMP_AUTHORITY.CURRENT) {
        // The most important line in this file: a stale entry is dropped, never
        // served. The cache is an optimization; versions are correctness.
        entries.delete(key);
        return { hit: false, decision: null, reason: `stale:${authority.verdict}` };
      }
      return { hit: true, decision: { ...entry.decision, cached: true }, reason: 'hit' };
    },

    set(key, decision, stamp) {
      if (!isSecurityStamp(stamp)) return false;
      if (entries.size >= options.maxEntries) {
        // Map preserves insertion order, so the front is the oldest.
        let removed = 0;
        for (const existing of entries.keys()) {
          if (removed >= options.evictBatch) break;
          entries.delete(existing);
          removed += 1;
        }
      }
      entries.set(key, { decision, stamp });
      return true;
    },

    delete(key) {
      return entries.delete(key);
    },

    /** Drops everything — used when authority moves in a way keys cannot express. */
    clear() {
      const dropped = entries.size;
      entries.clear();
      return dropped;
    },

    /** Drops every entry whose stamp is no longer current. */
    invalidate(currentStamp) {
      if (!isSecurityStamp(currentStamp)) return entries.size;
      let dropped = 0;
      for (const [key, entry] of entries) {
        if (evaluateStampAuthority(entry.stamp, currentStamp).verdict !== STAMP_AUTHORITY.CURRENT) {
          entries.delete(key);
          dropped += 1;
        }
      }
      return dropped;
    },
  });
}

/**
 * Builds a stable cache key from a request. Only fields that change the answer
 * are included; `now` is deliberately excluded so identical requests share an
 * entry across time (expiry is enforced by the stamp, not by the key).
 */
export function cacheKeyFor(request) {
  const parts = [
    request.principal?.principalId ?? '',
    String(request.principal?.principalVersion ?? ''),
    request.principal?.tenantId ?? '',
    request.action ?? '',
    request.resourceType ?? '',
    request.resourceId ?? '',
    request.resourceTenantId ?? '',
    request.capability ?? '',
    (request.capabilityGrants ?? []).join(','),
    request.requiredAuthStrength ?? '',
    request.approval?.granted === true ? 'approved' : 'no-approval',
    String(request.policyVersion ?? ''),
    String(request.tenantVersion ?? ''),
  ];
  return createHash('sha256').update(parts.join('␟')).digest('base64url').slice(0, 32);
}

/**
 * The cached authorization path: validate against current authority, evaluate on
 * miss, store the result under the stamp it was computed with.
 *
 * DENY results are cached too, so an attacker probing a forbidden resource pays
 * the evaluation cost once rather than once per attempt.
 *
 * @param {ReturnType<createDecisionCache>} cache
 * @param {object} request
 * @param {object} options
 * @param {Readonly<object>} options.currentStamp authority versions in force now
 * @param {Readonly<object>} [options.registry]
 * @param {Readonly<object>} [options.context]
 */
export function authorizeCached(cache, request, options) {
  const { currentStamp, registry = null, context = null } = options;
  if (!isSecurityStamp(currentStamp)) {
    // No authority to validate against: evaluate uncached rather than risk
    // storing a decision that can never be proven current.
    return authorize(request, { registry, context });
  }
  const key = cacheKeyFor(request);
  const cached = cache.get(key, currentStamp);
  if (cached.hit) return cached.decision;

  const decision = authorize(request, { registry, context });
  cache.set(key, decision, context?.stamp ?? currentStamp);
  return decision;
}
