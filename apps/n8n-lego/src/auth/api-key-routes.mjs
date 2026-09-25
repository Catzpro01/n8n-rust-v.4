/**
 * P5.7 — API keys and machine identities at the storage/HTTP boundary.
 *
 *   /rest/api-keys           upstream wire contract (api-keys.controller.ts):
 *     GET    /                redacted list for the caller
 *     GET    /scopes          scopes the caller's role may place on a key
 *     POST   /                { label, scopes, expiresAt } -> key + rawApiKey ONCE
 *     PATCH  /:id             { label, scopes } -> { success: true }
 *     DELETE /:id             revoke -> { success: true }
 *   all behind global scope `apiKey:manage`, exactly like upstream.
 *
 *   authenticateMachineCredential()  the verifier a key-accepting surface calls.
 *     `/api/v1` (src/auth/public-api-routes.mjs, P5-M03) mounts it; worker and
 *     agent transports must use it too. `/rest/*` keeps accepting session
 *     cookies only, as upstream does.
 *
 *   service principals (workers / agents / MCP / gateway) — programmatic
 *     lifecycle: create (credential shown once), list (redacted), revoke.
 *
 * STORAGE. Keys and service principals live on their accountable owner's user
 * record (`apiKeys`, `servicePrincipals`), bounded per owner. No new store
 * collection: deleting the owner deletes every credential they could have
 * issued, which is the only safe default for authority that is derived from
 * theirs. `toPublicUser` is a whitelist, so neither field leaves the server
 * through any user payload.
 *
 * Differences from pinned n8n, all security-driven and invisible to the editor:
 *   - only a SHA-256 digest and a 4-character hint are stored (upstream stores
 *     the raw JWT);
 *   - requested scopes are honoured and attenuated to the role (upstream
 *     ignores them unless the enterprise `apiKeyScopes` licence is present, and
 *     then grants the role's full set);
 *   - effective scopes are re-intersected with the owner's CURRENT role on every
 *     use, so a demotion shrinks keys immediately.
 */
import { randomBytes } from 'node:crypto';

import { badRequest, forbidden } from '../compat/error.mjs';
import { sendData } from '../compat/response.mjs';
import { requireUser } from '../compat/auth-context.mjs';
import { getGlobalScopes } from '../compat/scopes.mjs';
import { apiKeyScopesForRole, loadApiKeyScopes } from '../compat/api-key-scopes.mjs';
import { securityVersionFor } from '../auth.mjs';
import { createPermissionRegistry } from './security/permission-registry.mjs';
import {
  API_KEY_AUDIENCE,
  API_KEY_POLICY,
  API_KEY_VERDICT,
  apiKeyMatches,
  apiKeyVerdict,
  attenuateScopes,
  generateApiKey,
  lastUsedIsStale,
  parseApiKey,
  pruneTombstones,
  redactApiKey,
  revokeWithTombstone,
} from './security/api-key.mjs';
import {
  DEFAULT_TENANT_SECURITY_POLICY,
  createServicePrincipalRecord,
  keyPolicyViolation,
  machineAuditEvent,
  machinePrincipal,
} from './security/machine-identity.mjs';

/** Upstream RESPONSE_ERROR_MESSAGES.MISSING_SCOPE. */
export const MISSING_SCOPE_MESSAGE = 'User is missing a scope required to perform this action';
const SCOPE_FORMAT = /^[a-zA-Z]+:[a-zA-Z]+$/;
const SCOPE_FORMAT_MESSAGE = "Each scope must follow the format '{resource}:{scope}' with only letters (e.g., 'workflow:create')";

/* ------------------------------------------------------- canonical universe */

/**
 * The P5.3 registry over the API-key vocabulary. Memoised per extracted
 * vocabulary object, so it is built once and never diverges from the file.
 */
const REGISTRIES = new WeakMap();
export function apiKeyPermissionRegistry(config) {
  const vocabulary = loadApiKeyScopes(config);
  if (vocabulary.all.length === 0) return null;
  let registry = REGISTRIES.get(vocabulary);
  if (!registry) {
    registry = createPermissionRegistry({ global: [{ scopes: vocabulary.all }] });
    REGISTRIES.set(vocabulary, registry);
  }
  return registry;
}

/* ----------------------------------------------------------------- helpers */

/** 96-bit opaque record id, base64url (no '.', so it is safe inside a key). */
function newCredentialId() {
  return randomBytes(12).toString('base64url');
}

function requireApiKeyScope(ctx) {
  const user = requireUser(ctx);
  if (!getGlobalScopes(user, ctx.config).includes('apiKey:manage')) throw forbidden(MISSING_SCOPE_MESSAGE);
  return user;
}

function publicApiKeys(user) {
  return (user.apiKeys ?? []).filter((key) => key.audience === API_KEY_AUDIENCE.PUBLIC_API && !key.revokedAt);
}

/** Upstream response shape (ApiKey + userId/audience), plus last-used metadata. */
function apiKeyDto(record, userId) {
  return {
    id: record.id,
    label: record.label,
    userId,
    scopes: [...record.scopes],
    audience: record.audience,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    apiKey: redactApiKey(record.hint),
    expiresAt: record.expiresAt ?? null,
    lastUsedAt: record.lastUsedAt ?? null,
  };
}

function validateLabel(label) {
  // Upstream: z.string().min(1).max(50) and an xss() round-trip; a value xss
  // would rewrite (any angle bracket) is refused rather than stored escaped.
  if (typeof label !== 'string' || label.length < 1 || label.length > API_KEY_POLICY.maxLabelLength || /[<>]/.test(label)) {
    throw badRequest(`label must be 1 to ${API_KEY_POLICY.maxLabelLength} characters, without markup`);
  }
  return label;
}

function validateScopeShape(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) throw badRequest('scopes must contain at least one scope');
  for (const scope of scopes) if (typeof scope !== 'string' || !SCOPE_FORMAT.test(scope)) throw badRequest(SCOPE_FORMAT_MESSAGE);
  return scopes;
}

function audit(logger, type, fields) {
  const event = machineAuditEvent(type, fields);
  logger?.info?.(`auth.${type}`, event);
  return event;
}

/* ----------------------------------------------------------- authentication */

/**
 * Verifies a presented machine credential and returns the principal it proves.
 * Never throws for a bad credential: every failure is `{ ok: false, verdict }`
 * with a reason for audit, and the caller answers a uniform 401.
 *
 * @param {object} input
 * @param {object} input.store
 * @param {object} input.config
 * @param {unknown} input.presented       the X-N8N-API-KEY value
 * @param {string} [input.audience]       API_KEY_AUDIENCE.PUBLIC_API (default) or .SERVICE
 * @param {object} [input.logger]
 * @param {number} [input.now]
 * @returns {{ ok: true, principal: object, record: object, owner: object } | { ok: false, verdict: string }}
 */
export function authenticateMachineCredential({ store, config, presented, audience = API_KEY_AUDIENCE.PUBLIC_API, logger = null, now = Date.now() }) {
  const parsed = parseApiKey(presented);
  if (!parsed) return { ok: false, verdict: API_KEY_VERDICT.MALFORMED };
  const owner = store.users.get(parsed.ownerId) ?? null;
  const field = audience === API_KEY_AUDIENCE.SERVICE ? 'servicePrincipals' : 'apiKeys';
  const record = (owner?.[field] ?? []).find((candidate) => candidate.id === parsed.keyId) ?? null;
  // The digest check runs whether or not a record was found, so an unknown key
  // and a wrong secret cost the same.
  const matches = apiKeyMatches(presented, record?.digest ?? 'x'.repeat(43));
  let verdict = matches ? apiKeyVerdict(record, { now, owner, audience }) : API_KEY_VERDICT.UNKNOWN;
  if (verdict !== API_KEY_VERDICT.OK) {
    audit(logger, audience === API_KEY_AUDIENCE.SERVICE ? 'service-principal.denied' : 'api-key.denied', {
      keyRef: record ? parsed.keyId : undefined,
      reason: verdict,
    });
    return { ok: false, verdict };
  }
  const registry = apiKeyPermissionRegistry(config);
  if (!registry) {
    verdict = 'authority-unavailable';
    return { ok: false, verdict };
  }
  const principal = machinePrincipal({
    record,
    owner,
    kind: audience === API_KEY_AUDIENCE.SERVICE ? 'service' : 'api-key',
    ownerGrantable: apiKeyScopesForRole(owner.role ?? 'global:owner', config),
    universe: registry.universe,
    principalVersion: securityVersionFor(owner.id),
    now,
  });
  if (lastUsedIsStale(record, now)) {
    // Bounded write amplification: at most one write per key per interval.
    const at = new Date(now).toISOString();
    store.users.update(owner.id, {
      [field]: owner[field].map((candidate) => (candidate.id === record.id ? { ...candidate, lastUsedAt: at } : candidate)),
    });
  }
  return { ok: true, principal, record, owner };
}

/* -------------------------------------------------------- service principals */

/**
 * @returns {{ servicePrincipal: object, rawCredential: string }} the credential is shown ONCE
 */
export function createServicePrincipal({ store, config, ownerId, kind, label, scopes, expiresAt = null, policy = DEFAULT_TENANT_SECURITY_POLICY, logger = null, now = Date.now() }) {
  const owner = store.users.get(ownerId);
  if (!owner) throw badRequest('Unknown owner');
  if (!getGlobalScopes(owner, config).includes('apiKey:manage')) throw forbidden(MISSING_SCOPE_MESSAGE);
  const existing = (owner.servicePrincipals ?? []).filter((sp) => !sp.revokedAt);
  const { record, raw } = createServicePrincipalRecord({
    id: newCredentialId(),
    owner,
    kind,
    label,
    scopes,
    ownerGrantable: apiKeyScopesForRole(owner.role ?? 'global:owner', config),
    expiresAt,
    policy,
    existing: existing.length,
    now,
  });
  store.users.update(owner.id, { servicePrincipals: [...pruneTombstones(owner.servicePrincipals), record] });
  audit(logger, 'service-principal.created', { tenantId: record.tenantId, principalRef: `svc:${record.id}`, ownerRef: owner.id, kind, scopeCount: record.scopes.length });
  return { servicePrincipal: servicePrincipalDto(record, owner.id), rawCredential: raw };
}

export function servicePrincipalDto(record, ownerId) {
  return {
    id: record.id,
    kind: record.kind,
    label: record.label,
    ownerId,
    tenantId: record.tenantId,
    scopes: [...record.scopes],
    credential: redactApiKey(record.hint),
    createdAt: record.createdAt,
    expiresAt: record.expiresAt ?? null,
    lastUsedAt: record.lastUsedAt ?? null,
  };
}

export function listServicePrincipals({ store, ownerId }) {
  const owner = store.users.get(ownerId);
  return (owner?.servicePrincipals ?? []).filter((sp) => !sp.revokedAt).map((sp) => servicePrincipalDto(sp, ownerId));
}

/**
 * Revocation keeps a tombstone (P5-M01): the credential then fails as REVOKED, not UNKNOWN, and the
 * record survives for audit. Revoking an unknown or already revoked id is a no-op (false).
 */
export function revokeServicePrincipal({ store, ownerId, id, reason = 'revoked-by-owner', logger = null, now = Date.now() }) {
  const owner = store.users.get(ownerId);
  const result = owner ? revokeWithTombstone(owner.servicePrincipals, id, { reason, now }) : null;
  if (!result) return false;
  store.users.update(owner.id, { servicePrincipals: result.records });
  audit(logger, 'service-principal.revoked', { tenantId: result.revoked.tenantId, principalRef: `svc:${id}`, ownerRef: owner.id, reason });
  return true;
}

/* ------------------------------------------------------------------ routes */

/**
 * @param {object} options
 * @param {object} options.logger
 * @param {Readonly<object>} [options.policy] tenant security policy input
 */
export function apiKeyRoutes({ logger, policy = DEFAULT_TENANT_SECURITY_POLICY }) {
  return [
    {
      method: 'GET',
      path: '/rest/api-keys',
      handler: (ctx) => {
        const user = requireApiKeyScope(ctx);
        sendData(ctx.res, publicApiKeys(user).map((key) => apiKeyDto(key, user.id)));
      },
    },
    {
      method: 'GET',
      path: '/rest/api-keys/scopes',
      handler: (ctx) => {
        const user = requireApiKeyScope(ctx);
        sendData(ctx.res, apiKeyScopesForRole(user.role ?? 'global:owner', ctx.config));
      },
    },
    {
      method: 'POST',
      path: '/rest/api-keys',
      handler: (ctx) => {
        const user = requireApiKeyScope(ctx);
        const body = ctx.body ?? {};
        const label = validateLabel(body.label);
        const requested = validateScopeShape(body.scopes);
        const expiresAt = body.expiresAt === undefined ? null : body.expiresAt;
        if (expiresAt !== null && typeof expiresAt !== 'number') throw badRequest('Expiration date must be in the future or null');
        const violation = keyPolicyViolation(policy, { expiresAt });
        if (violation) throw badRequest(violation);
        const attenuated = attenuateScopes(requested, apiKeyScopesForRole(user.role ?? 'global:owner', ctx.config));
        if (!attenuated.ok) {
          audit(logger, 'api-key.denied', { ownerRef: user.id, reason: 'scope-escalation', scopeCount: attenuated.escalated.length });
          throw badRequest('Invalid scopes for user role');
        }
        const existing = (user.apiKeys ?? []).filter((key) => !key.revokedAt);
        if (existing.length >= API_KEY_POLICY.maxKeysPerOwner) {
          throw badRequest(`You have reached the maximum of ${API_KEY_POLICY.maxKeysPerOwner} API keys`);
        }
        const id = newCredentialId();
        const minted = generateApiKey({ ownerId: user.id, keyId: id });
        const at = new Date().toISOString();
        const record = {
          id,
          label,
          scopes: attenuated.scopes,
          audience: API_KEY_AUDIENCE.PUBLIC_API,
          tenantId: policy.tenantId,
          digest: minted.digest,
          hint: minted.hint,
          createdAt: at,
          updatedAt: at,
          expiresAt,
          lastUsedAt: null,
          revokedAt: null,
        };
        ctx.store.users.update(user.id, { apiKeys: [...pruneTombstones(user.apiKeys), record] });
        audit(logger, 'api-key.created', { tenantId: record.tenantId, keyRef: id, ownerRef: user.id, scopeCount: record.scopes.length });
        sendData(ctx.res, { ...apiKeyDto(record, user.id), rawApiKey: minted.raw });
      },
    },
    {
      method: 'PATCH',
      path: '/rest/api-keys/:id',
      handler: (ctx) => {
        const user = requireApiKeyScope(ctx);
        const body = ctx.body ?? {};
        const label = validateLabel(body.label);
        const requested = validateScopeShape(body.scopes);
        const attenuated = attenuateScopes(requested, apiKeyScopesForRole(user.role ?? 'global:owner', ctx.config));
        if (!attenuated.ok) {
          audit(logger, 'api-key.denied', { ownerRef: user.id, keyRef: String(ctx.params.id).slice(0, 64), reason: 'scope-escalation', scopeCount: attenuated.escalated.length });
          throw badRequest('Invalid scopes for user role');
        }
        const keys = user.apiKeys ?? [];
        // Upstream updates `WHERE id AND userId`: another user's id is a silent
        // no-op, so the response never confirms that a key id exists.
        if (keys.some((key) => key.id === ctx.params.id && !key.revokedAt)) {
          const at = new Date().toISOString();
          ctx.store.users.update(user.id, {
            apiKeys: keys.map((key) => (key.id === ctx.params.id ? { ...key, label, scopes: attenuated.scopes, updatedAt: at } : key)),
          });
          audit(logger, 'api-key.updated', { keyRef: ctx.params.id, ownerRef: user.id, scopeCount: attenuated.scopes.length });
        }
        sendData(ctx.res, { success: true });
      },
    },
    {
      method: 'DELETE',
      path: '/rest/api-keys/:id',
      handler: (ctx) => {
        const user = requireApiKeyScope(ctx);
        // Tombstone, not delete (P5-M01): the record stays with revokedAt so the credential is
        // reported REVOKED and the audit row survives. Unknown or already revoked ids are a silent
        // no-op, as upstream: the response never confirms that a key id exists.
        const result = revokeWithTombstone(user.apiKeys, ctx.params.id, { reason: 'revoked-by-owner' });
        if (result) {
          ctx.store.users.update(user.id, { apiKeys: result.records });
          audit(logger, 'api-key.revoked', { keyRef: ctx.params.id, ownerRef: user.id, reason: 'revoked-by-owner' });
        }
        sendData(ctx.res, { success: true });
      },
    },
  ];
}

