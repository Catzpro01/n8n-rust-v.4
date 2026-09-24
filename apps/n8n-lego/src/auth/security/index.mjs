/**
 * P5.1 — SECURITY KERNEL, public contract facade.
 *
 * PUBLIC CONTRACT (`auth.principal`, v1.0.0, owner: agent-1).
 *
 * This file is a re-export and nothing else, mirroring the discipline already
 * established by `src/auth/contract/index.mjs` (`auth.identity@1.0.0`): the
 * public surface is exactly the modules listed in the contract lock, pinned by
 * `test/lego-security-kernel.test.mjs`, so it cannot widen without a version
 * decision.
 *
 * WHAT THIS CONTRACT IS: the compiled, immutable security state that the hot
 * path reads — a principal snapshot, a request-local context, and the version
 * stamp that decides whether either is still authoritative.
 *
 * WHAT IT IS NOT, deliberately:
 *  - not an authentication mechanism — no password, token, cookie or session
 *    logic lives here (`src/auth.mjs`, P5.2);
 *  - not an authorization engine — deciding `action + resource → ALLOW/DENY`
 *    against the canonical n8n scope model is P5.3;
 *  - not a credential path — no secret material, no SecretRef (P5.4);
 *  - not a second capability engine — plugin capability policy stays in
 *    `src/lego/plugin-policy.mjs` (P2.27) and this plane consumes it;
 *  - not an authority upgrade to `auth.identity`, which remains a read-only
 *    projection.
 *
 * The kernel performs **no I/O**: no network, no filesystem, no decryption, no
 * clock other than an injected `now`. That is what makes it safe to sit on the
 * path every request and every node execution takes.
 */
export {
  SECURITY_DECISION,
  SECURITY_REASON,
  SecurityError,
  assertSecurityReason,
} from './security-error.mjs';

export {
  AUTH_METHODS,
  AUTH_STRENGTHS,
  DEFAULT_TENANT,
  PRINCIPAL_BOUNDS,
  PRINCIPAL_TYPES,
  authStrengthRank,
  compilePermissions,
  createPrincipalSnapshot,
  hasPermission,
  isPrincipalExpired,
  isPrincipalSnapshot,
  meetsAuthStrength,
  permissionSetIdFor,
} from './principal.mjs';

export {
  RESOURCE_VERSION_FIELD,
  STAMP_AUTHORITY,
  STAMP_FIELDS,
  createSecurityStamp,
  evaluateStampAuthority,
  isSecurityStamp,
} from './security-stamp.mjs';

export {
  assertSecurityContext,
  checkTenantBinding,
  createSecurityContext,
  isSecurityContext,
} from './security-context.mjs';
