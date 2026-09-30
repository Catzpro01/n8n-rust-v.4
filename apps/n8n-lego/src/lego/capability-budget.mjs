/**
 * P2-M01 — Lazy tool/skill discovery + token-aware capability budgets
 * (activated from FUTURE-AI-ECOSYSTEM-S01; legacy P18, issue #234 / #418).
 *
 * PUBLIC CONTRACT (`ai.capability-budget@1.0.0`, owner: manager).
 *
 * WHAT THIS MODULE IS
 * -------------------
 * A deterministic, fail-closed capability discovery, on-demand schema loader,
 * token/context budget ledger, and agent runtime workload admission controller.
 * It implements the five canonical P2-M01 / #234 deliverables:
 *
 *   1. Lazy tool / skill discovery (FUTURE-AI-ECOSYSTEM-F-P18-001)
 *      Tools and skills register lightweight L0/L1 metadata and lazy loader
 *      callbacks (`loadSchema`, `loadProcedure`). Listing, indexing, filtering,
 *      searching, and summarizing never invoke a schema or procedure loader.
 *
 *   2. Progressive capability discovery (FUTURE-AI-ECOSYSTEM-F-P18-002)
 *      Four explicit disclosure tiers (`L0_INDEX`, `L1_SUMMARY`, `L2_SCHEMA`,
 *      `L3_PROCEDURE`). Broad catalog scans operate strictly at L0/L1 under a
 *      bounded discovery result count and discovery token ceiling.
 *
 *   3. On-demand tool schema loading (FUTURE-AI-ECOSYSTEM-F-P18-003)
 *      Full tool parameter schemas (`L2_SCHEMA`) and skill procedures
 *      (`L3_PROCEDURE`) are loaded one capability at a time only when selected,
 *      validated against structural and byte/token ceilings, and scanned for
 *      credential/secret leakage before entering context.
 *
 *   4. Token / context-aware capability budgets (FUTURE-AI-ECOSYSTEM-F-P18-004)
 *      An explicit, versioned (CAS) budget ledger tracking token consumption
 *      and loaded-schema slot limits across `call`, `run`, and `session` scopes
 *      with honest provenance (`reported` vs `estimated`, never fabricated 0).
 *
 *   5. Agent runtime workload admission (FUTURE-AI-ECOSYSTEM-F-P18-005)
 *      Pre-execution workload admission that enforces declaration, P5 caller
 *      authorization, provider availability, secret hygiene, and token/context
 *      budgets (`reject` fail-closed by default, or explicit `degrade-to-lazy`
 *      to L1 summaries when configured).
 *
 * THE P5 SECURITY & AUTHORITY INVARIANTS (#234 / #418)
 * ----------------------------------------------------
 *   - Capability discovery != authorization. Discovering a tool or skill in
 *     `L0_INDEX` or `L1_SUMMARY` never grants permission to load its schema or
 *     admit it into a workload. `authorizedCapabilities` is caller-supplied from
 *     the P5 authority layer and treated as strictly read-only.
 *   - Undeclared capabilities fail closed (`CAPABILITY_BUDGET_UNDECLARED`).
 *   - Unauthorized capabilities fail closed (`CAPABILITY_BUDGET_UNAUTHORIZED`).
 *   - Raw secrets and credential material are refused at registration AND at
 *     on-demand schema/procedure load time (`CAPABILITY_BUDGET_SECRET_REJECTED`).
 *   - Process-agnostic and deterministic: zero module-scope mutable state, zero
 *     `process.env` reads, zero filesystem/network I/O.
 */

export const CAPABILITY_BUDGET_CONTRACT = 'ai.capability-budget@1.0.0';
export const CAPABILITY_BUDGET_VERSION = '1.0.0';

/** Capability entry kinds governed by lazy discovery. */
export const CAPABILITY_KINDS = Object.freeze(['tool', 'skill']);

/** Progressive disclosure tiers, ordered from cheapest to deepest. */
export const DISCOVERY_TIERS = Object.freeze([
  'L0_INDEX',
  'L1_SUMMARY',
  'L2_SCHEMA',
  'L3_PROCEDURE',
]);

/** Operational availability states for a registered tool or skill. */
export const CAPABILITY_AVAILABILITY = Object.freeze([
  'available',
  'degraded',
  'unavailable',
  'disabled',
]);

/** Side-effect classes aligned with `ai-foundation.mjs#TOOL_SIDE_EFFECTS`. */
export const CAPABILITY_SIDE_EFFECTS = Object.freeze([
  'read-only',
  'writes',
  'destructive',
  'external',
]);

/** Scopes aligned with `token-usage.mjs#USAGE_SCOPES`. */
export const BUDGET_SCOPES = Object.freeze(['call', 'run', 'session']);

/** Honest token provenance aligned with `token-usage.mjs#USAGE_STATUSES`. */
export const TOKEN_PROVENANCE = Object.freeze(['reported', 'estimated']);

/** Workload admission policies when capability budget is pressured. */
export const ADMISSION_POLICIES = Object.freeze(['reject', 'degrade-to-lazy']);

/** Workload admission outcome statuses. */
export const ADMISSION_DECISIONS = Object.freeze(['admitted', 'degraded', 'rejected']);

/** Hard structural ceilings. Callers may tighten these bounds, never exceed them. */
export const CAPABILITY_BUDGET_LIMITS = Object.freeze({
  maxCatalogSize: 2048,
  maxDiscoveryResults: 64,
  maxLoadedSchemas: 32,
  maxSchemaBytes: 65536,
  maxSchemaTokensPerItem: 4096,
  maxProcedureBytes: 131072,
  maxProcedureTokensPerItem: 8192,
  maxContextTokens: 200000,
  maxCapabilityBudgetTokens: 32768,
  defaultReserveResponseTokens: 1024,
  maxTagsPerCapability: 16,
  maxRequiredCapabilities: 16,
  maxIdLength: 128,
  maxSummaryLength: 512,
  maxSchemaDepth: 12,
  maxSchemaProperties: 128,
  maxWorkloadCapabilities: 64,
});

/** Closed identifier pattern for tools, skills, capabilities, and workloads. */
export const CAPABILITY_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

/** Closed error code vocabulary. */
export const CAPABILITY_ERROR_CODES = Object.freeze({
  INVALID: 'CAPABILITY_BUDGET_INVALID',
  NOT_FOUND: 'CAPABILITY_BUDGET_NOT_FOUND',
  CONFLICT: 'CAPABILITY_BUDGET_CONFLICT',
  CATALOG_FULL: 'CAPABILITY_BUDGET_CATALOG_FULL',
  UNAVAILABLE: 'CAPABILITY_BUDGET_UNAVAILABLE',
  UNAUTHORIZED: 'CAPABILITY_BUDGET_UNAUTHORIZED',
  UNDECLARED: 'CAPABILITY_BUDGET_UNDECLARED',
  EXHAUSTED: 'CAPABILITY_BUDGET_EXHAUSTED',
  MALFORMED_SCHEMA: 'CAPABILITY_BUDGET_MALFORMED_SCHEMA',
  SECRET_REJECTED: 'CAPABILITY_BUDGET_SECRET_REJECTED',
});

export class CapabilityBudgetError extends Error {
  constructor(code, message, details = {}) {
    if (!Object.values(CAPABILITY_ERROR_CODES).includes(code)) {
      throw new TypeError(`CapabilityBudgetError: unknown error code ${String(code)}`);
    }
    super(message);
    this.name = 'CapabilityBudgetError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

const errInvalid = (message, details) =>
  new CapabilityBudgetError(CAPABILITY_ERROR_CODES.INVALID, message, details);
const errNotFound = (message, details) =>
  new CapabilityBudgetError(CAPABILITY_ERROR_CODES.NOT_FOUND, message, details);
const errConflict = (message, details) =>
  new CapabilityBudgetError(CAPABILITY_ERROR_CODES.CONFLICT, message, details);
const errCatalogFull = (message, details) =>
  new CapabilityBudgetError(CAPABILITY_ERROR_CODES.CATALOG_FULL, message, details);
const errUnavailable = (message, details) =>
  new CapabilityBudgetError(CAPABILITY_ERROR_CODES.UNAVAILABLE, message, details);
const errUnauthorized = (message, details) =>
  new CapabilityBudgetError(CAPABILITY_ERROR_CODES.UNAUTHORIZED, message, details);
const errUndeclared = (message, details) =>
  new CapabilityBudgetError(CAPABILITY_ERROR_CODES.UNDECLARED, message, details);
const errExhausted = (message, details) =>
  new CapabilityBudgetError(CAPABILITY_ERROR_CODES.EXHAUSTED, message, details);
const errMalformedSchema = (message, details) =>
  new CapabilityBudgetError(CAPABILITY_ERROR_CODES.MALFORMED_SCHEMA, message, details);
const errSecretRejected = (message, details) =>
  new CapabilityBudgetError(CAPABILITY_ERROR_CODES.SECRET_REJECTED, message, details);

/* ------------------------------------------------ secret & credential guard */

/**
 * Field names that must never appear in capability declarations, tool schemas,
 * default parameter values, or skill procedures loaded into model context.
 */
export const SECRET_KEY_PATTERN =
  /(?:^|[_.-])(password|passwd|secret|api[_-]?key|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|session[_-]?token|auth[_-]?token|bearer|credential[_-]?secret|connection[_-]?string)(?:$|[_.-])/i;

/**
 * Value patterns representing raw credentials/tokens that must never enter
 * model context.
 */
export const SECRET_VALUE_PATTERN =
  /(?:\bsk-[A-Za-z0-9_-]{16,}\b|\bgh[pousr]_[A-Za-z0-9]{16,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b)/;

/**
 * Recursively scans a value for raw secrets or credential-shaped keys.
 * Rejects circular structures and excessive depth.
 *
 * @param {unknown} value
 * @param {string} [where]
 */
export function assertNoSecretsInCapability(value, where = 'capability') {
  const seen = new Set();

  function walk(node, path, depth) {
    if (depth > CAPABILITY_BUDGET_LIMITS.maxSchemaDepth) {
      throw errMalformedSchema(`${where} exceeds max nesting depth (${CAPABILITY_BUDGET_LIMITS.maxSchemaDepth})`, {
        where: path,
        maxDepth: CAPABILITY_BUDGET_LIMITS.maxSchemaDepth,
      });
    }
    if (node === null || node === undefined) return;
    const t = typeof node;
    if (t === 'function' || t === 'symbol' || t === 'bigint') {
      throw errMalformedSchema(`${where} contains non-serializable ${t} at ${path}`, {
        where: path,
        type: t,
      });
    }
    if (t === 'string') {
      if (SECRET_VALUE_PATTERN.test(node)) {
        throw errSecretRejected(`raw secret or credential token detected in ${path}`, {
          where: path,
        });
      }
      return;
    }
    if (t !== 'object') return;
    if (seen.has(node)) {
      throw errMalformedSchema(`${where} contains a circular reference at ${path}`, {
        where: path,
      });
    }
    seen.add(node);
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        walk(node[i], `${path}[${i}]`, depth + 1);
      }
    } else {
      const proto = Object.getPrototypeOf(node);
      if (proto !== Object.prototype && proto !== null) {
        throw errMalformedSchema(`${where} must contain plain objects only at ${path}`, {
          where: path,
        });
      }
      if (
        Object.prototype.hasOwnProperty.call(node, '__proto__') ||
        Object.prototype.hasOwnProperty.call(node, 'constructor') ||
        Object.prototype.hasOwnProperty.call(node, 'prototype')
      ) {
        throw errMalformedSchema(`${where} contains forbidden prototype key at ${path}`, {
          where: path,
        });
      }
      for (const [k, v] of Object.entries(node)) {
        if (SECRET_KEY_PATTERN.test(k)) {
          throw errSecretRejected(`forbidden credential/secret field '${k}' in ${path}`, {
            where: `${path}.${k}`,
            field: k,
          });
        }
        walk(v, `${path}.${k}`, depth + 1);
      }
    }
    seen.delete(node);
  }

  walk(value, where, 0);
}

/* ------------------------------------------- honest token estimation helper */

/**
 * Computes or validates token cost for a capability artifact.
 * Never fabricates 0 for non-empty payloads.
 *
 * @param {unknown} payload
 * @param {number} [reportedTokens]
 * @returns {{ tokens: number, status: 'reported' | 'estimated', estimator: string | null, bytes: number }}
 */
export function estimateCapabilityTokens(payload, reportedTokens) {
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload ?? '');
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (reportedTokens !== undefined && reportedTokens !== null) {
    if (!Number.isInteger(reportedTokens) || reportedTokens < 1) {
      throw errInvalid('reportedTokens must be a positive integer when provided', {
        reportedTokens,
      });
    }
    return Object.freeze({
      tokens: reportedTokens,
      status: 'reported',
      estimator: null,
      bytes,
    });
  }
  const estimated = Math.max(1, Math.ceil(bytes / 4));
  return Object.freeze({
    tokens: estimated,
    status: 'estimated',
    estimator: 'utf8-quarter-byte-v1',
    bytes,
  });
}

function deepFreezePlain(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => deepFreezePlain(item)));
  }
  const out = {};
  for (const key of Object.keys(value)) {
    out[key] = deepFreezePlain(value[key]);
  }
  return Object.freeze(out);
}

function assertValidId(value, label) {
  if (typeof value !== 'string' || !CAPABILITY_ID_PATTERN.test(value)) {
    throw errInvalid(`${label} must match ${CAPABILITY_ID_PATTERN}`, {
      label,
      value: typeof value === 'string' ? value.slice(0, 64) : typeof value,
    });
  }
  return value;
}

function normalizeCapabilitySet(input, label) {
  if (input === undefined || input === null) return null;
  if (input instanceof Set) {
    for (const item of input) assertValidId(item, label);
    return new Set(input);
  }
  if (Array.isArray(input)) {
    for (const item of input) assertValidId(item, label);
    return new Set(input);
  }
  throw errInvalid(`${label} must be an Array or Set of capability IDs`, { label });
}

function checkAuthority(record, declaredSet, authorizedSet, requireAuthorization) {
  if (declaredSet !== null) {
    const undeclared = record.requiredCapabilities.filter((cap) => !declaredSet.has(cap));
    if (undeclared.length > 0) {
      return {
        ok: false,
        code: CAPABILITY_ERROR_CODES.UNDECLARED,
        missingDeclared: Object.freeze(undeclared),
        missingAuthorized: Object.freeze([]),
      };
    }
  }
  if (requireAuthorization) {
    if (authorizedSet === null) {
      return {
        ok: false,
        code: CAPABILITY_ERROR_CODES.UNAUTHORIZED,
        missingDeclared: Object.freeze([]),
        missingAuthorized: Object.freeze([record.id, ...record.requiredCapabilities]),
      };
    }
    const unauthorized = record.requiredCapabilities.filter((cap) => !authorizedSet.has(cap));
    if (unauthorized.length > 0 || !authorizedSet.has(record.id)) {
      const missing = !authorizedSet.has(record.id)
        ? [record.id, ...unauthorized]
        : unauthorized;
      return {
        ok: false,
        code: CAPABILITY_ERROR_CODES.UNAUTHORIZED,
        missingDeclared: Object.freeze([]),
        missingAuthorized: Object.freeze(missing),
      };
    }
  }
  return {
    ok: true,
    code: null,
    missingDeclared: Object.freeze([]),
    missingAuthorized: Object.freeze([]),
  };
}

function validateLoadedSchema(schema, capabilityId, limits) {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw errMalformedSchema(`schema for '${capabilityId}' must be a non-null plain object`, {
      capabilityId,
    });
  }
  assertNoSecretsInCapability(schema, `schema(${capabilityId})`);

  if (typeof schema.type !== 'string' || schema.type.length === 0) {
    throw errMalformedSchema(`schema for '${capabilityId}' must declare a non-empty string 'type'`, {
      capabilityId,
    });
  }
  if (schema.properties !== undefined) {
    if (schema.properties === null || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
      throw errMalformedSchema(`schema.properties for '${capabilityId}' must be a plain object`, {
        capabilityId,
      });
    }
    const propKeys = Object.keys(schema.properties);
    if (propKeys.length > limits.maxSchemaProperties) {
      throw errMalformedSchema(
        `schema for '${capabilityId}' has ${propKeys.length} properties (max ${limits.maxSchemaProperties})`,
        { capabilityId, count: propKeys.length, max: limits.maxSchemaProperties },
      );
    }
    for (const [propName, propDef] of Object.entries(schema.properties)) {
      if (propDef === null || typeof propDef !== 'object' || Array.isArray(propDef)) {
        throw errMalformedSchema(
          `schema property '${propName}' in '${capabilityId}' must be a plain object`,
          { capabilityId, property: propName },
        );
      }
    }
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || !schema.required.every((r) => typeof r === 'string' && r.length > 0)) {
      throw errMalformedSchema(`schema.required for '${capabilityId}' must be an array of non-empty strings`, {
        capabilityId,
      });
    }
  }

  const estimate = estimateCapabilityTokens(schema);
  if (estimate.bytes > limits.maxSchemaBytes) {
    throw errMalformedSchema(
      `schema for '${capabilityId}' is ${estimate.bytes} bytes (max ${limits.maxSchemaBytes})`,
      { capabilityId, bytes: estimate.bytes, maxSchemaBytes: limits.maxSchemaBytes },
    );
  }
  if (estimate.tokens > limits.maxSchemaTokensPerItem) {
    throw errMalformedSchema(
      `schema for '${capabilityId}' costs ${estimate.tokens} tokens (max ${limits.maxSchemaTokensPerItem})`,
      { capabilityId, tokens: estimate.tokens, maxSchemaTokensPerItem: limits.maxSchemaTokensPerItem },
    );
  }
  return { frozenSchema: deepFreezePlain(schema), estimate };
}

function validateLoadedProcedure(procedure, capabilityId, limits) {
  if (procedure === null || typeof procedure !== 'object' || Array.isArray(procedure)) {
    throw errMalformedSchema(`procedure for '${capabilityId}' must be a non-null plain object`, {
      capabilityId,
    });
  }
  assertNoSecretsInCapability(procedure, `procedure(${capabilityId})`);
  if (!Array.isArray(procedure.steps) || procedure.steps.length === 0) {
    throw errMalformedSchema(`procedure for '${capabilityId}' must declare a non-empty 'steps' array`, {
      capabilityId,
    });
  }
  const estimate = estimateCapabilityTokens(procedure);
  if (estimate.bytes > limits.maxProcedureBytes) {
    throw errMalformedSchema(
      `procedure for '${capabilityId}' is ${estimate.bytes} bytes (max ${limits.maxProcedureBytes})`,
      { capabilityId, bytes: estimate.bytes, maxProcedureBytes: limits.maxProcedureBytes },
    );
  }
  if (estimate.tokens > limits.maxProcedureTokensPerItem) {
    throw errMalformedSchema(
      `procedure for '${capabilityId}' costs ${estimate.tokens} tokens (max ${limits.maxProcedureTokensPerItem})`,
      { capabilityId, tokens: estimate.tokens, maxProcedureTokensPerItem: limits.maxProcedureTokensPerItem },
    );
  }
  return { frozenProcedure: deepFreezePlain(procedure), estimate };
}

/* ---------------------------- Token / Context-Aware Capability Budget (P18) */

/**
 * Creates a bounded, CAS-versioned token & context capability budget ledger.
 *
 * @param {object} [options]
 * @param {number} [options.maxContextTokens]
 * @param {number} [options.maxCapabilityBudgetTokens]
 * @param {number} [options.maxLoadedSchemas]
 * @param {number} [options.reserveResponseTokens]
 */
export function createCapabilityBudget(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw errInvalid('budget options must be a plain object');
  }
  const maxContextTokens = options.maxContextTokens ?? CAPABILITY_BUDGET_LIMITS.maxContextTokens;
  const maxCapabilityBudgetTokens =
    options.maxCapabilityBudgetTokens ?? CAPABILITY_BUDGET_LIMITS.maxCapabilityBudgetTokens;
  const maxLoadedSchemas = options.maxLoadedSchemas ?? CAPABILITY_BUDGET_LIMITS.maxLoadedSchemas;
  const reserveResponseTokens =
    options.reserveResponseTokens ?? CAPABILITY_BUDGET_LIMITS.defaultReserveResponseTokens;

  if (
    !Number.isInteger(maxContextTokens) ||
    maxContextTokens < 1 ||
    maxContextTokens > CAPABILITY_BUDGET_LIMITS.maxContextTokens
  ) {
    throw errInvalid(
      `maxContextTokens must be an integer in [1, ${CAPABILITY_BUDGET_LIMITS.maxContextTokens}]`,
      { maxContextTokens },
    );
  }
  if (
    !Number.isInteger(maxCapabilityBudgetTokens) ||
    maxCapabilityBudgetTokens < 1 ||
    maxCapabilityBudgetTokens > CAPABILITY_BUDGET_LIMITS.maxCapabilityBudgetTokens ||
    maxCapabilityBudgetTokens > maxContextTokens
  ) {
    throw errInvalid(
      `maxCapabilityBudgetTokens must be an integer in [1, min(${maxContextTokens}, ${CAPABILITY_BUDGET_LIMITS.maxCapabilityBudgetTokens})]`,
      { maxCapabilityBudgetTokens, maxContextTokens },
    );
  }
  if (
    !Number.isInteger(maxLoadedSchemas) ||
    maxLoadedSchemas < 1 ||
    maxLoadedSchemas > CAPABILITY_BUDGET_LIMITS.maxLoadedSchemas
  ) {
    throw errInvalid(
      `maxLoadedSchemas must be an integer in [1, ${CAPABILITY_BUDGET_LIMITS.maxLoadedSchemas}]`,
      { maxLoadedSchemas },
    );
  }
  if (
    !Number.isInteger(reserveResponseTokens) ||
    reserveResponseTokens < 0 ||
    reserveResponseTokens >= maxContextTokens
  ) {
    throw errInvalid('reserveResponseTokens must be a non-negative integer smaller than maxContextTokens', {
      reserveResponseTokens,
      maxContextTokens,
    });
  }

  // Instance-scoped state (scale-out-safe: no module-global state).
  const allocations = new Map();
  let version = 1;
  let nextAllocationSeq = 1;

  function validateScope(scope, scopeRef) {
    if (!BUDGET_SCOPES.includes(scope)) {
      throw errInvalid(`scope must be one of ${BUDGET_SCOPES.join(', ')}`, { scope });
    }
    assertValidId(scopeRef, 'scopeRef');
  }

  function validateContextTokensUsed(contextTokensUsed = 0) {
    if (!Number.isInteger(contextTokensUsed) || contextTokensUsed < 0) {
      throw errInvalid('contextTokensUsed must be a non-negative integer', { contextTokensUsed });
    }
    return contextTokensUsed;
  }

  function entriesForScope(scope, scopeRef) {
    const out = [];
    for (const entry of allocations.values()) {
      if (scope && entry.scope !== scope) continue;
      if (scopeRef && entry.scopeRef !== scopeRef) continue;
      out.push(entry);
    }
    return out;
  }

  function computeTotals(scope, scopeRef, contextTokensUsed = 0) {
    const usedContext = validateContextTokensUsed(contextTokensUsed);
    const matching = entriesForScope(scope, scopeRef);
    let allocatedTokens = 0;
    let loadedSchemaCount = 0;
    const byTier = {
      L0_INDEX: 0,
      L1_SUMMARY: 0,
      L2_SCHEMA: 0,
      L3_PROCEDURE: 0,
    };
    for (const item of matching) {
      allocatedTokens += item.tokens;
      byTier[item.tier] = (byTier[item.tier] ?? 0) + item.tokens;
      if (item.tier === 'L2_SCHEMA' || item.tier === 'L3_PROCEDURE') {
        loadedSchemaCount += 1;
      }
    }
    const availableContextForCapabilities = Math.max(
      0,
      maxContextTokens - usedContext - reserveResponseTokens - allocatedTokens,
    );
    const remainingCapabilityTokens = Math.max(0, maxCapabilityBudgetTokens - allocatedTokens);
    const effectiveRemainingTokens = Math.min(remainingCapabilityTokens, availableContextForCapabilities);
    const remainingSchemaSlots = Math.max(0, maxLoadedSchemas - loadedSchemaCount);

    return {
      allocatedTokens,
      loadedSchemaCount,
      remainingCapabilityTokens,
      availableContextForCapabilities,
      effectiveRemainingTokens,
      remainingSchemaSlots,
      byTier: Object.freeze(byTier),
      matching,
    };
  }

  function checkAllocation({
    capabilityId,
    tier,
    tokens,
    scope = 'run',
    scopeRef = 'default',
    contextTokensUsed = 0,
  } = {}) {
    assertValidId(capabilityId, 'capabilityId');
    validateScope(scope, scopeRef);
    if (!DISCOVERY_TIERS.includes(tier)) {
      throw errInvalid(`tier must be one of ${DISCOVERY_TIERS.join(', ')}`, { tier });
    }
    if (!Number.isInteger(tokens) || tokens < 1) {
      throw errInvalid('tokens must be a positive integer', { tokens });
    }
    const totals = computeTotals(scope, scopeRef, contextTokensUsed);
    const dedupeKey = `${scope}:${scopeRef}:${capabilityId}:${tier}`;
    if (allocations.has(dedupeKey)) {
      return Object.freeze({
        allowed: true,
        alreadyAllocated: true,
        reason: null,
        remainingTokens: totals.effectiveRemainingTokens,
        remainingSchemaSlots: totals.remainingSchemaSlots,
        version,
      });
    }

    const isDeepTier = tier === 'L2_SCHEMA' || tier === 'L3_PROCEDURE';
    if (isDeepTier && totals.remainingSchemaSlots < 1) {
      return Object.freeze({
        allowed: false,
        alreadyAllocated: false,
        reason: 'max-loaded-schemas-exceeded',
        remainingTokens: totals.effectiveRemainingTokens,
        remainingSchemaSlots: totals.remainingSchemaSlots,
        version,
      });
    }
    if (tokens > totals.remainingCapabilityTokens) {
      return Object.freeze({
        allowed: false,
        alreadyAllocated: false,
        reason: 'capability-token-budget-exceeded',
        remainingTokens: totals.effectiveRemainingTokens,
        remainingSchemaSlots: totals.remainingSchemaSlots,
        version,
      });
    }
    if (tokens > totals.availableContextForCapabilities) {
      return Object.freeze({
        allowed: false,
        alreadyAllocated: false,
        reason: 'context-window-budget-exceeded',
        remainingTokens: totals.effectiveRemainingTokens,
        remainingSchemaSlots: totals.remainingSchemaSlots,
        version,
      });
    }

    return Object.freeze({
      allowed: true,
      alreadyAllocated: false,
      reason: null,
      remainingTokens: totals.effectiveRemainingTokens - tokens,
      remainingSchemaSlots: isDeepTier ? totals.remainingSchemaSlots - 1 : totals.remainingSchemaSlots,
      version,
    });
  }

  function allocate({
    capabilityId,
    kind = 'tool',
    tier,
    tokens,
    tokenStatus = 'estimated',
    estimator = 'utf8-quarter-byte-v1',
    scope = 'run',
    scopeRef = 'default',
    contextTokensUsed = 0,
    expectedVersion,
  } = {}) {
    if (expectedVersion !== undefined && expectedVersion !== version) {
      throw errConflict(
        `budget CAS version mismatch: expected ${expectedVersion}, actual ${version}`,
        { expectedVersion, actualVersion: version },
      );
    }
    if (!CAPABILITY_KINDS.includes(kind)) {
      throw errInvalid(`kind must be one of ${CAPABILITY_KINDS.join(', ')}`, { kind });
    }
    if (!TOKEN_PROVENANCE.includes(tokenStatus)) {
      throw errInvalid(`tokenStatus must be one of ${TOKEN_PROVENANCE.join(', ')}`, { tokenStatus });
    }

    const check = checkAllocation({
      capabilityId,
      tier,
      tokens,
      scope,
      scopeRef,
      contextTokensUsed,
    });

    const dedupeKey = `${scope}:${scopeRef}:${capabilityId}:${tier}`;
    if (check.alreadyAllocated) {
      return Object.freeze({
        allocation: allocations.get(dedupeKey),
        deduplicated: true,
        version,
      });
    }
    if (!check.allowed) {
      throw errExhausted(
        `capability budget exhausted for '${capabilityId}' at tier '${tier}' (${check.reason})`,
        {
          capabilityId,
          tier,
          requestedTokens: tokens,
          reason: check.reason,
          remainingTokens: check.remainingTokens,
          remainingSchemaSlots: check.remainingSchemaSlots,
          scope,
          scopeRef,
        },
      );
    }

    const record = Object.freeze({
      allocationId: `alloc-${nextAllocationSeq}`,
      capabilityId,
      kind,
      tier,
      tokens,
      tokenStatus,
      estimator: tokenStatus === 'reported' ? null : estimator,
      scope,
      scopeRef,
    });
    nextAllocationSeq += 1;
    allocations.set(dedupeKey, record);
    version += 1;

    return Object.freeze({
      allocation: record,
      deduplicated: false,
      version,
    });
  }

  function release({ allocationId, expectedVersion } = {}) {
    if (expectedVersion !== undefined && expectedVersion !== version) {
      throw errConflict(
        `budget CAS version mismatch: expected ${expectedVersion}, actual ${version}`,
        { expectedVersion, actualVersion: version },
      );
    }
    if (typeof allocationId !== 'string' || allocationId.length === 0) {
      throw errInvalid('allocationId must be a non-empty string');
    }
    for (const [key, entry] of allocations.entries()) {
      if (entry.allocationId === allocationId) {
        allocations.delete(key);
        version += 1;
        return Object.freeze({ released: true, allocation: entry, version });
      }
    }
    throw errNotFound(`allocation '${allocationId}' not found`, { allocationId });
  }

  function resetScope({ scope, scopeRef, expectedVersion } = {}) {
    if (expectedVersion !== undefined && expectedVersion !== version) {
      throw errConflict(
        `budget CAS version mismatch: expected ${expectedVersion}, actual ${version}`,
        { expectedVersion, actualVersion: version },
      );
    }
    validateScope(scope, scopeRef);
    let removed = 0;
    for (const [key, entry] of allocations.entries()) {
      if (entry.scope === scope && entry.scopeRef === scopeRef) {
        allocations.delete(key);
        removed += 1;
      }
    }
    if (removed > 0) version += 1;
    return Object.freeze({ removed, version });
  }

  function snapshot({ scope = 'run', scopeRef = 'default', contextTokensUsed = 0 } = {}) {
    validateScope(scope, scopeRef);
    const totals = computeTotals(scope, scopeRef, contextTokensUsed);
    return Object.freeze({
      contract: CAPABILITY_BUDGET_CONTRACT,
      scope,
      scopeRef,
      maxContextTokens,
      maxCapabilityBudgetTokens,
      maxLoadedSchemas,
      reserveResponseTokens,
      contextTokensUsed: validateContextTokensUsed(contextTokensUsed),
      allocatedTokens: totals.allocatedTokens,
      remainingCapabilityTokens: totals.remainingCapabilityTokens,
      availableContextForCapabilities: totals.availableContextForCapabilities,
      effectiveRemainingTokens: totals.effectiveRemainingTokens,
      loadedSchemaCount: totals.loadedSchemaCount,
      remainingSchemaSlots: totals.remainingSchemaSlots,
      byTier: totals.byTier,
      allocations: Object.freeze(totals.matching.slice()),
      version,
    });
  }

  return Object.freeze({
    checkAllocation,
    allocate,
    release,
    resetScope,
    snapshot,
    version: () => version,
  });
}

/* --------------------- Lazy Tool/Skill Discovery Catalog (P18-001..P18-003) */

const ALLOWED_REGISTRATION_KEYS = new Set([
  'id',
  'kind',
  'summary',
  'tags',
  'requiredCapabilities',
  'sideEffects',
  'availability',
  'priority',
  'summaryTokens',
  'schemaTokens',
  'procedureTokens',
  'providerId',
  'loadSchema',
  'loadProcedure',
  'cacheSchema',
]);

/**
 * Creates a lazy tool & skill discovery catalog with progressive disclosure
 * (`L0_INDEX` -> `L1_SUMMARY` -> `L2_SCHEMA` -> `L3_PROCEDURE`).
 *
 * @param {object} [options]
 * @param {number} [options.maxCatalogSize]
 * @param {number} [options.maxDiscoveryResults]
 * @param {number} [options.maxSchemaBytes]
 * @param {number} [options.maxSchemaTokensPerItem]
 * @param {number} [options.maxProcedureBytes]
 * @param {number} [options.maxProcedureTokensPerItem]
 */
export function createCapabilityDiscoveryCatalog(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw errInvalid('catalog options must be a plain object');
  }
  const limits = Object.freeze({
    maxCatalogSize: options.maxCatalogSize ?? CAPABILITY_BUDGET_LIMITS.maxCatalogSize,
    maxDiscoveryResults: options.maxDiscoveryResults ?? CAPABILITY_BUDGET_LIMITS.maxDiscoveryResults,
    maxSchemaBytes: options.maxSchemaBytes ?? CAPABILITY_BUDGET_LIMITS.maxSchemaBytes,
    maxSchemaTokensPerItem:
      options.maxSchemaTokensPerItem ?? CAPABILITY_BUDGET_LIMITS.maxSchemaTokensPerItem,
    maxProcedureBytes: options.maxProcedureBytes ?? CAPABILITY_BUDGET_LIMITS.maxProcedureBytes,
    maxProcedureTokensPerItem:
      options.maxProcedureTokensPerItem ?? CAPABILITY_BUDGET_LIMITS.maxProcedureTokensPerItem,
    maxSchemaProperties: CAPABILITY_BUDGET_LIMITS.maxSchemaProperties,
  });

  if (
    !Number.isInteger(limits.maxCatalogSize) ||
    limits.maxCatalogSize < 1 ||
    limits.maxCatalogSize > CAPABILITY_BUDGET_LIMITS.maxCatalogSize
  ) {
    throw errInvalid(
      `maxCatalogSize must be an integer in [1, ${CAPABILITY_BUDGET_LIMITS.maxCatalogSize}]`,
      { maxCatalogSize: limits.maxCatalogSize },
    );
  }
  if (
    !Number.isInteger(limits.maxDiscoveryResults) ||
    limits.maxDiscoveryResults < 1 ||
    limits.maxDiscoveryResults > CAPABILITY_BUDGET_LIMITS.maxDiscoveryResults
  ) {
    throw errInvalid(
      `maxDiscoveryResults must be an integer in [1, ${CAPABILITY_BUDGET_LIMITS.maxDiscoveryResults}]`,
      { maxDiscoveryResults: limits.maxDiscoveryResults },
    );
  }

  const entries = new Map();
  const loadStats = new Map();
  let totalSchemaLoads = 0;
  let totalProcedureLoads = 0;
  let totalDiscoveryCalls = 0;
  let totalRejectedLoads = 0;

  function register(declaration) {
    if (declaration === null || typeof declaration !== 'object' || Array.isArray(declaration)) {
      throw errInvalid('capability declaration must be a plain object');
    }
    for (const key of Object.keys(declaration)) {
      if (!ALLOWED_REGISTRATION_KEYS.has(key)) {
        throw errInvalid(`unknown field '${key}' in capability declaration`, { field: key });
      }
    }
    if (entries.size >= limits.maxCatalogSize) {
      throw errCatalogFull(
        `capability catalog reached maxCatalogSize (${limits.maxCatalogSize}); refusing silent eviction`,
        { maxCatalogSize: limits.maxCatalogSize },
      );
    }

    const id = assertValidId(declaration.id, 'id');
    if (entries.has(id)) {
      throw errConflict(`capability '${id}' is already registered`, { id });
    }
    const kind = declaration.kind;
    if (!CAPABILITY_KINDS.includes(kind)) {
      throw errInvalid(`kind must be one of ${CAPABILITY_KINDS.join(', ')}`, { id, kind });
    }
    if (
      typeof declaration.summary !== 'string' ||
      declaration.summary.trim().length === 0 ||
      declaration.summary.length > CAPABILITY_BUDGET_LIMITS.maxSummaryLength
    ) {
      throw errInvalid(
        `summary for '${id}' must be a non-empty string up to ${CAPABILITY_BUDGET_LIMITS.maxSummaryLength} chars`,
        { id },
      );
    }
    const sideEffects = declaration.sideEffects ?? (kind === 'skill' ? 'read-only' : null);
    if (!CAPABILITY_SIDE_EFFECTS.includes(sideEffects)) {
      throw errInvalid(
        `sideEffects for '${id}' must be explicitly declared in ${CAPABILITY_SIDE_EFFECTS.join(', ')}`,
        { id, sideEffects },
      );
    }
    const availability = declaration.availability ?? 'available';
    if (!CAPABILITY_AVAILABILITY.includes(availability)) {
      throw errInvalid(
        `availability for '${id}' must be one of ${CAPABILITY_AVAILABILITY.join(', ')}`,
        { id, availability },
      );
    }
    const priority = declaration.priority ?? 0;
    if (!Number.isInteger(priority) || priority < -1000 || priority > 1000) {
      throw errInvalid(`priority for '${id}' must be an integer in [-1000, 1000]`, { id, priority });
    }
    const providerId =
      declaration.providerId !== undefined ? assertValidId(declaration.providerId, 'providerId') : 'local';

    const rawTags = declaration.tags ?? [];
    if (!Array.isArray(rawTags) || rawTags.length > CAPABILITY_BUDGET_LIMITS.maxTagsPerCapability) {
      throw errInvalid(
        `tags for '${id}' must be an array of at most ${CAPABILITY_BUDGET_LIMITS.maxTagsPerCapability} items`,
        { id },
      );
    }
    const tags = Object.freeze(
      [...new Set(rawTags.map((t) => assertValidId(t, 'tag').toLowerCase()))].sort(),
    );

    const rawReqCaps = declaration.requiredCapabilities ?? [];
    if (
      !Array.isArray(rawReqCaps) ||
      rawReqCaps.length > CAPABILITY_BUDGET_LIMITS.maxRequiredCapabilities
    ) {
      throw errInvalid(
        `requiredCapabilities for '${id}' must be an array of at most ${CAPABILITY_BUDGET_LIMITS.maxRequiredCapabilities} items`,
        { id },
      );
    }
    const requiredCapabilities = Object.freeze(
      [...new Set(rawReqCaps.map((c) => assertValidId(c, 'requiredCapability')))].sort(),
    );

    if (typeof declaration.loadSchema !== 'function') {
      throw errInvalid(`capability '${id}' must provide a lazy loadSchema() function`, { id });
    }
    if (kind === 'skill' && declaration.loadProcedure !== undefined && typeof declaration.loadProcedure !== 'function') {
      throw errInvalid(`skill '${id}' loadProcedure must be a function when provided`, { id });
    }
    if (kind === 'tool' && declaration.loadProcedure !== undefined) {
      throw errInvalid(`tool '${id}' cannot declare loadProcedure (skills only)`, { id });
    }

    // Secret check on L0/L1 declaration metadata before accepting registration.
    assertNoSecretsInCapability(
      {
        id,
        kind,
        summary: declaration.summary,
        tags,
        requiredCapabilities,
        providerId,
      },
      `declaration(${id})`,
    );

    const summaryEstimate = estimateCapabilityTokens(
      { id, kind, summary: declaration.summary, tags, requiredCapabilities, sideEffects },
      declaration.summaryTokens,
    );
    const schemaHintEstimate =
      declaration.schemaTokens !== undefined
        ? estimateCapabilityTokens('schema-hint', declaration.schemaTokens)
        : Object.freeze({
            tokens: Math.max(16, summaryEstimate.tokens * 3),
            status: 'estimated',
            estimator: 'summary-multiplier-v1',
            bytes: summaryEstimate.bytes,
          });
    const procedureHintEstimate =
      kind === 'skill'
        ? declaration.procedureTokens !== undefined
          ? estimateCapabilityTokens('procedure-hint', declaration.procedureTokens)
          : Object.freeze({
              tokens: Math.max(32, summaryEstimate.tokens * 5),
              status: 'estimated',
              estimator: 'summary-multiplier-v1',
              bytes: summaryEstimate.bytes,
            })
        : null;

    const record = {
      id,
      kind,
      summary: declaration.summary.trim(),
      tags,
      requiredCapabilities,
      sideEffects,
      availability,
      priority,
      providerId,
      summaryTokens: summaryEstimate.tokens,
      summaryTokenStatus: summaryEstimate.status,
      schemaTokensHint: schemaHintEstimate.tokens,
      schemaTokenStatus: schemaHintEstimate.status,
      procedureTokensHint: procedureHintEstimate ? procedureHintEstimate.tokens : null,
      procedureTokenStatus: procedureHintEstimate ? procedureHintEstimate.status : null,
      loadSchema: declaration.loadSchema,
      loadProcedure: declaration.loadProcedure ?? null,
      cacheSchema: Boolean(declaration.cacheSchema),
      cachedSchema: null,
      cachedProcedure: null,
      version: 1,
    };

    entries.set(id, record);
    loadStats.set(id, { schemaLoads: 0, procedureLoads: 0 });

    return getIndexEntry(id);
  }

  function getRecordOrThrow(id) {
    assertValidId(id, 'id');
    const record = entries.get(id);
    if (!record) {
      throw errNotFound(`capability '${id}' is not registered`, { id });
    }
    return record;
  }

  function updateAvailability(id, availability, { expectedVersion } = {}) {
    const record = getRecordOrThrow(id);
    if (!CAPABILITY_AVAILABILITY.includes(availability)) {
      throw errInvalid(`availability must be one of ${CAPABILITY_AVAILABILITY.join(', ')}`, {
        id,
        availability,
      });
    }
    if (expectedVersion !== undefined && expectedVersion !== record.version) {
      throw errConflict(
        `capability '${id}' version mismatch: expected ${expectedVersion}, actual ${record.version}`,
        { id, expectedVersion, actualVersion: record.version },
      );
    }
    record.availability = availability;
    record.version += 1;
    return getIndexEntry(id);
  }

  function toIndexView(record) {
    const indexPayload = {
      id: record.id,
      kind: record.kind,
      availability: record.availability,
      sideEffects: record.sideEffects,
    };
    const rawIndexTokens = Math.max(
      1,
      Math.ceil(Buffer.byteLength(JSON.stringify(indexPayload), 'utf8') / 4),
    );
    const indexTokens = Math.min(record.summaryTokens, rawIndexTokens);
    return Object.freeze({
      id: record.id,
      kind: record.kind,
      tier: 'L0_INDEX',
      availability: record.availability,
      sideEffects: record.sideEffects,
      providerId: record.providerId,
      indexTokens,
      summaryTokens: record.summaryTokens,
      schemaTokensHint: record.schemaTokensHint,
      version: record.version,
    });
  }

  function toSummaryView(record, declaredSet, authorizedSet) {
    const auth = checkAuthority(record, declaredSet, authorizedSet, true);
    const decl = checkAuthority(record, declaredSet, null, false);
    return Object.freeze({
      id: record.id,
      kind: record.kind,
      tier: 'L1_SUMMARY',
      summary: record.summary,
      tags: record.tags,
      requiredCapabilities: record.requiredCapabilities,
      sideEffects: record.sideEffects,
      availability: record.availability,
      priority: record.priority,
      providerId: record.providerId,
      summaryTokens: record.summaryTokens,
      summaryTokenStatus: record.summaryTokenStatus,
      schemaTokensHint: record.schemaTokensHint,
      procedureTokensHint: record.procedureTokensHint,
      declared: decl.ok,
      authorized: auth.ok,
      schemaLoaded: false,
      version: record.version,
    });
  }

  function getIndexEntry(id) {
    const record = getRecordOrThrow(id);
    return toIndexView(record);
  }

  function describeSummary(id, { declaredCapabilities, authorizedCapabilities } = {}) {
    const record = getRecordOrThrow(id);
    const declaredSet = normalizeCapabilitySet(declaredCapabilities, 'declaredCapabilities');
    const authorizedSet = normalizeCapabilitySet(authorizedCapabilities, 'authorizedCapabilities');
    return toSummaryView(record, declaredSet, authorizedSet);
  }

  function scoreRecord(record, queryTerms, filterTags) {
    let score = record.priority;
    if (queryTerms.length > 0) {
      const hayId = record.id.toLowerCase();
      const haySummary = record.summary.toLowerCase();
      let matchedTerms = 0;
      for (const term of queryTerms) {
        let matchedThisTerm = false;
        if (hayId === term) {
          score += 50;
          matchedThisTerm = true;
        } else if (hayId.includes(term)) {
          score += 25;
          matchedThisTerm = true;
        }
        if (record.tags.some((t) => t === term || t.includes(term))) {
          score += 20;
          matchedThisTerm = true;
        }
        if (haySummary.includes(term)) {
          score += 10;
          matchedThisTerm = true;
        }
        if (matchedThisTerm) matchedTerms += 1;
      }
      if (matchedTerms === 0) return null;
    }
    if (filterTags.length > 0) {
      for (const tag of filterTags) {
        if (!record.tags.includes(tag)) return null;
      }
      score += filterTags.length * 15;
    }
    return score;
  }

  function discover({
    tier = 'L1_SUMMARY',
    query = '',
    tags = [],
    kinds = CAPABILITY_KINDS,
    includeUnavailable = false,
    limit = limits.maxDiscoveryResults,
    tokenBudget = CAPABILITY_BUDGET_LIMITS.maxCapabilityBudgetTokens,
    declaredCapabilities,
    authorizedCapabilities,
  } = {}) {
    totalDiscoveryCalls += 1;
    if (tier !== 'L0_INDEX' && tier !== 'L1_SUMMARY') {
      throw errInvalid(
        `discover() only supports progressive L0_INDEX or L1_SUMMARY tiers (received '${String(tier)}'); use loadSchema() or loadProcedure() for on-demand L2/L3 loading`,
        { tier },
      );
    }
    if (typeof query !== 'string' || query.length > 256) {
      throw errInvalid('query must be a string up to 256 characters');
    }
    if (!Array.isArray(tags)) {
      throw errInvalid('tags filter must be an array of strings');
    }
    if (!Array.isArray(kinds) || kinds.length === 0 || !kinds.every((k) => CAPABILITY_KINDS.includes(k))) {
      throw errInvalid(`kinds must be a non-empty subset of ${CAPABILITY_KINDS.join(', ')}`);
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > limits.maxDiscoveryResults) {
      throw errInvalid(`limit must be an integer in [1, ${limits.maxDiscoveryResults}]`, { limit });
    }
    if (!Number.isInteger(tokenBudget) || tokenBudget < 1) {
      throw errInvalid('tokenBudget must be a positive integer', { tokenBudget });
    }

    const declaredSet = normalizeCapabilitySet(declaredCapabilities, 'declaredCapabilities');
    const authorizedSet = normalizeCapabilitySet(authorizedCapabilities, 'authorizedCapabilities');
    const queryTerms = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const filterTags = tags.map((t) => assertValidId(t, 'tag').toLowerCase());
    const allowedKinds = new Set(kinds);

    const candidates = [];
    for (const record of entries.values()) {
      if (!allowedKinds.has(record.kind)) continue;
      if (!includeUnavailable && (record.availability === 'unavailable' || record.availability === 'disabled')) {
        continue;
      }
      const score = scoreRecord(record, queryTerms, filterTags);
      if (score === null) continue;
      candidates.push({ record, score });
    }

    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.record.summaryTokens !== b.record.summaryTokens) {
        return a.record.summaryTokens - b.record.summaryTokens;
      }
      return a.record.id.localeCompare(b.record.id);
    });

    const items = [];
    let consumedTokens = 0;
    let truncatedByBudget = false;
    let droppedCount = 0;

    for (const { record } of candidates) {
      if (items.length >= limit) {
        droppedCount += 1;
        continue;
      }
      const view =
        tier === 'L0_INDEX'
          ? toIndexView(record)
          : toSummaryView(record, declaredSet, authorizedSet);
      const itemTokens = tier === 'L0_INDEX' ? view.indexTokens : view.summaryTokens;
      if (consumedTokens + itemTokens > tokenBudget) {
        truncatedByBudget = true;
        droppedCount += 1;
        continue;
      }
      consumedTokens += itemTokens;
      items.push(view);
    }

    return Object.freeze({
      tier,
      items: Object.freeze(items),
      totalMatched: candidates.length,
      returnedCount: items.length,
      droppedCount,
      consumedTokens,
      tokenBudget,
      truncatedByBudget,
      authorityGranted: false,
    });
  }

  function loadSchema(
    id,
    {
      budget,
      scope = 'run',
      scopeRef = 'default',
      contextTokensUsed = 0,
      declaredCapabilities,
      authorizedCapabilities,
      requireAuthorization = true,
      degradeOnExhaustion = false,
      expectedBudgetVersion,
    } = {},
  ) {
    const record = getRecordOrThrow(id);
    if (record.availability === 'unavailable' || record.availability === 'disabled') {
      totalRejectedLoads += 1;
      throw errUnavailable(`capability '${id}' is currently ${record.availability}`, {
        id,
        availability: record.availability,
        providerId: record.providerId,
      });
    }

    const declaredSet = normalizeCapabilitySet(declaredCapabilities, 'declaredCapabilities');
    const authorizedSet = normalizeCapabilitySet(authorizedCapabilities, 'authorizedCapabilities');
    const authVerdict = checkAuthority(record, declaredSet, authorizedSet, requireAuthorization);
    if (!authVerdict.ok) {
      totalRejectedLoads += 1;
      if (authVerdict.code === CAPABILITY_ERROR_CODES.UNDECLARED) {
        throw errUndeclared(
          `capability '${id}' requires undeclared capabilities: ${authVerdict.missingDeclared.join(', ')}`,
          { id, missingDeclared: authVerdict.missingDeclared },
        );
      }
      throw errUnauthorized(
        `caller is not authorized to load schema for '${id}' (discovery is not authorization)`,
        { id, missingAuthorized: authVerdict.missingAuthorized },
      );
    }

    // Pre-check slot & reported/hint budget before invoking the lazy loader when possible.
    if (budget) {
      const preCheck = budget.checkAllocation({
        capabilityId: id,
        tier: 'L2_SCHEMA',
        tokens: record.schemaTokensHint,
        scope,
        scopeRef,
        contextTokensUsed,
      });
      if (
        !preCheck.allowed &&
        (preCheck.reason === 'max-loaded-schemas-exceeded' ||
          record.schemaTokenStatus === 'reported' ||
          degradeOnExhaustion)
      ) {
        if (degradeOnExhaustion) {
          const summaryView = toSummaryView(record, declaredSet, authorizedSet);
          return Object.freeze({
            id: record.id,
            kind: record.kind,
            tier: 'L1_SUMMARY',
            status: 'degraded',
            degradedReason: CAPABILITY_ERROR_CODES.EXHAUSTED,
            summary: summaryView,
            schema: null,
            tokens: summaryView.summaryTokens,
            tokenStatus: summaryView.summaryTokenStatus,
            allocation: null,
          });
        }
        totalRejectedLoads += 1;
        throw errExhausted(
          `capability budget exhausted before loading schema for '${id}' (${preCheck.reason})`,
          {
            capabilityId: id,
            tier: 'L2_SCHEMA',
            requestedTokens: record.schemaTokensHint,
            reason: preCheck.reason,
            remainingTokens: preCheck.remainingTokens,
            remainingSchemaSlots: preCheck.remainingSchemaSlots,
            scope,
            scopeRef,
          },
        );
      }
    }

    let validated = record.cachedSchema;
    if (!validated) {
      let rawSchema;
      try {
        rawSchema = record.loadSchema();
      } catch (err) {
        totalRejectedLoads += 1;
        if (err instanceof CapabilityBudgetError) throw err;
        throw errUnavailable(`schema loader for '${id}' failed: ${err?.message ?? String(err)}`, {
          id,
          providerId: record.providerId,
        });
      }
      const stat = loadStats.get(id);
      stat.schemaLoads += 1;
      totalSchemaLoads += 1;

      try {
        validated = validateLoadedSchema(rawSchema, id, limits);
      } catch (err) {
        totalRejectedLoads += 1;
        throw err;
      }
      if (record.cacheSchema) {
        record.cachedSchema = validated;
      }
    }

    const tokenCost =
      record.schemaTokenStatus === 'reported' ? record.schemaTokensHint : validated.estimate.tokens;
    const tokenStatus =
      record.schemaTokenStatus === 'reported' ? 'reported' : validated.estimate.status;
    const estimator = tokenStatus === 'reported' ? null : validated.estimate.estimator;

    let allocationResult = null;
    if (budget) {
      try {
        allocationResult = budget.allocate({
          capabilityId: id,
          kind: record.kind,
          tier: 'L2_SCHEMA',
          tokens: tokenCost,
          tokenStatus,
          estimator,
          scope,
          scopeRef,
          contextTokensUsed,
          expectedVersion: expectedBudgetVersion,
        });
      } catch (err) {
        if (err instanceof CapabilityBudgetError && err.code === CAPABILITY_ERROR_CODES.EXHAUSTED && degradeOnExhaustion) {
          const summaryView = toSummaryView(record, declaredSet, authorizedSet);
          return Object.freeze({
            id: record.id,
            kind: record.kind,
            tier: 'L1_SUMMARY',
            status: 'degraded',
            degradedReason: CAPABILITY_ERROR_CODES.EXHAUSTED,
            summary: summaryView,
            schema: null,
            tokens: summaryView.summaryTokens,
            tokenStatus: summaryView.summaryTokenStatus,
            allocation: null,
          });
        }
        totalRejectedLoads += 1;
        throw err;
      }
    }

    return Object.freeze({
      id: record.id,
      kind: record.kind,
      tier: 'L2_SCHEMA',
      status: 'loaded',
      degradedReason: null,
      summary: toSummaryView(record, declaredSet, authorizedSet),
      schema: validated.frozenSchema,
      tokens: tokenCost,
      tokenStatus,
      bytes: validated.estimate.bytes,
      allocation: allocationResult ? allocationResult.allocation : null,
      budgetVersion: allocationResult ? allocationResult.version : null,
    });
  }

  function loadProcedure(
    id,
    {
      budget,
      scope = 'run',
      scopeRef = 'default',
      contextTokensUsed = 0,
      declaredCapabilities,
      authorizedCapabilities,
      requireAuthorization = true,
      degradeOnExhaustion = false,
      expectedBudgetVersion,
    } = {},
  ) {
    const record = getRecordOrThrow(id);
    if (record.kind !== 'skill' || typeof record.loadProcedure !== 'function') {
      totalRejectedLoads += 1;
      throw errInvalid(`capability '${id}' does not support L3_PROCEDURE loading`, {
        id,
        kind: record.kind,
      });
    }
    if (record.availability === 'unavailable' || record.availability === 'disabled') {
      totalRejectedLoads += 1;
      throw errUnavailable(`skill '${id}' is currently ${record.availability}`, {
        id,
        availability: record.availability,
      });
    }

    const declaredSet = normalizeCapabilitySet(declaredCapabilities, 'declaredCapabilities');
    const authorizedSet = normalizeCapabilitySet(authorizedCapabilities, 'authorizedCapabilities');
    const authVerdict = checkAuthority(record, declaredSet, authorizedSet, requireAuthorization);
    if (!authVerdict.ok) {
      totalRejectedLoads += 1;
      if (authVerdict.code === CAPABILITY_ERROR_CODES.UNDECLARED) {
        throw errUndeclared(
          `skill '${id}' requires undeclared capabilities: ${authVerdict.missingDeclared.join(', ')}`,
          { id, missingDeclared: authVerdict.missingDeclared },
        );
      }
      throw errUnauthorized(
        `caller is not authorized to load procedure for skill '${id}'`,
        { id, missingAuthorized: authVerdict.missingAuthorized },
      );
    }

    if (budget && record.procedureTokensHint !== null) {
      const preCheck = budget.checkAllocation({
        capabilityId: id,
        tier: 'L3_PROCEDURE',
        tokens: record.procedureTokensHint,
        scope,
        scopeRef,
        contextTokensUsed,
      });
      if (
        !preCheck.allowed &&
        (preCheck.reason === 'max-loaded-schemas-exceeded' ||
          record.procedureTokenStatus === 'reported' ||
          degradeOnExhaustion)
      ) {
        if (degradeOnExhaustion) {
          const summaryView = toSummaryView(record, declaredSet, authorizedSet);
          return Object.freeze({
            id: record.id,
            kind: record.kind,
            tier: 'L1_SUMMARY',
            status: 'degraded',
            degradedReason: CAPABILITY_ERROR_CODES.EXHAUSTED,
            summary: summaryView,
            procedure: null,
            tokens: summaryView.summaryTokens,
            tokenStatus: summaryView.summaryTokenStatus,
            allocation: null,
          });
        }
        totalRejectedLoads += 1;
        throw errExhausted(
          `capability budget exhausted before loading procedure for '${id}' (${preCheck.reason})`,
          {
            capabilityId: id,
            tier: 'L3_PROCEDURE',
            requestedTokens: record.procedureTokensHint,
            reason: preCheck.reason,
            remainingTokens: preCheck.remainingTokens,
            remainingSchemaSlots: preCheck.remainingSchemaSlots,
            scope,
            scopeRef,
          },
        );
      }
    }

    let validated = record.cachedProcedure;
    if (!validated) {
      let rawProcedure;
      try {
        rawProcedure = record.loadProcedure();
      } catch (err) {
        totalRejectedLoads += 1;
        if (err instanceof CapabilityBudgetError) throw err;
        throw errUnavailable(`procedure loader for '${id}' failed: ${err?.message ?? String(err)}`, {
          id,
        });
      }
      const stat = loadStats.get(id);
      stat.procedureLoads += 1;
      totalProcedureLoads += 1;

      try {
        validated = validateLoadedProcedure(rawProcedure, id, limits);
      } catch (err) {
        totalRejectedLoads += 1;
        throw err;
      }
      if (record.cacheSchema) {
        record.cachedProcedure = validated;
      }
    }

    const tokenCost =
      record.procedureTokenStatus === 'reported'
        ? record.procedureTokensHint
        : validated.estimate.tokens;
    const tokenStatus =
      record.procedureTokenStatus === 'reported' ? 'reported' : validated.estimate.status;
    const estimator = tokenStatus === 'reported' ? null : validated.estimate.estimator;

    let allocationResult = null;
    if (budget) {
      try {
        allocationResult = budget.allocate({
          capabilityId: id,
          kind: record.kind,
          tier: 'L3_PROCEDURE',
          tokens: tokenCost,
          tokenStatus,
          estimator,
          scope,
          scopeRef,
          contextTokensUsed,
          expectedVersion: expectedBudgetVersion,
        });
      } catch (err) {
        if (err instanceof CapabilityBudgetError && err.code === CAPABILITY_ERROR_CODES.EXHAUSTED && degradeOnExhaustion) {
          const summaryView = toSummaryView(record, declaredSet, authorizedSet);
          return Object.freeze({
            id: record.id,
            kind: record.kind,
            tier: 'L1_SUMMARY',
            status: 'degraded',
            degradedReason: CAPABILITY_ERROR_CODES.EXHAUSTED,
            summary: summaryView,
            procedure: null,
            tokens: summaryView.summaryTokens,
            tokenStatus: summaryView.summaryTokenStatus,
            allocation: null,
          });
        }
        totalRejectedLoads += 1;
        throw err;
      }
    }

    return Object.freeze({
      id: record.id,
      kind: record.kind,
      tier: 'L3_PROCEDURE',
      status: 'loaded',
      degradedReason: null,
      summary: toSummaryView(record, declaredSet, authorizedSet),
      procedure: validated.frozenProcedure,
      tokens: tokenCost,
      tokenStatus,
      bytes: validated.estimate.bytes,
      allocation: allocationResult ? allocationResult.allocation : null,
      budgetVersion: allocationResult ? allocationResult.version : null,
    });
  }

  function stats() {
    const byCapability = {};
    for (const [capId, st] of loadStats.entries()) {
      byCapability[capId] = Object.freeze({ ...st });
    }
    return Object.freeze({
      registeredCount: entries.size,
      schemaLoadCalls: totalSchemaLoads,
      procedureLoadCalls: totalProcedureLoads,
      discoveryCalls: totalDiscoveryCalls,
      rejectedLoads: totalRejectedLoads,
      loadsByCapability: Object.freeze(byCapability),
    });
  }

  return Object.freeze({
    register,
    updateAvailability,
    getIndexEntry,
    describeSummary,
    discover,
    loadSchema,
    loadProcedure,
    stats,
    size: () => entries.size,
  });
}

/* ------------------------ Agent Runtime Workload Admission (P18-005 / #418) */

/**
 * Evaluates and admits an agent runtime workload against the lazy capability
 * catalog and token/context budget.
 *
 * Fail-closed order of checks:
 *   1. Workload structural validation (`CAPABILITY_BUDGET_INVALID`)
 *   2. Budget CAS version check (`CAPABILITY_BUDGET_CONFLICT`)
 *   3. Capability existence & availability (`NOT_FOUND` / `UNAVAILABLE`)
 *   4. P5 capability declaration & caller authorization (`UNDECLARED` / `UNAUTHORIZED`)
 *   5. Token & context budget admission (`reject` atomic rollback vs `degrade-to-lazy`)
 */
export function admitAgentWorkload({
  catalog,
  budget,
  workload,
  declaredCapabilities,
  authorizedCapabilities,
} = {}) {
  if (!catalog || typeof catalog.describeSummary !== 'function' || typeof catalog.loadSchema !== 'function') {
    throw errInvalid('admitAgentWorkload requires a valid capability discovery catalog');
  }
  if (!budget || typeof budget.allocate !== 'function' || typeof budget.snapshot !== 'function') {
    throw errInvalid('admitAgentWorkload requires a valid capability budget instance');
  }
  if (workload === null || typeof workload !== 'object' || Array.isArray(workload)) {
    throw errInvalid('workload must be a plain object');
  }

  const workloadId = assertValidId(workload.workloadId, 'workloadId');
  const scope = workload.scope ?? 'run';
  const scopeRef = workload.scopeRef ?? workloadId;
  if (!BUDGET_SCOPES.includes(scope)) {
    throw errInvalid(`workload.scope must be one of ${BUDGET_SCOPES.join(', ')}`, { scope });
  }
  assertValidId(scopeRef, 'scopeRef');

  const admissionPolicy = workload.admissionPolicy ?? 'reject';
  if (!ADMISSION_POLICIES.includes(admissionPolicy)) {
    throw errInvalid(
      `workload.admissionPolicy must be one of ${ADMISSION_POLICIES.join(', ')}`,
      { admissionPolicy },
    );
  }

  const contextTokensUsed = workload.contextTokensUsed ?? 0;
  if (!Number.isInteger(contextTokensUsed) || contextTokensUsed < 0) {
    throw errInvalid('workload.contextTokensUsed must be a non-negative integer', {
      contextTokensUsed,
    });
  }

  assertNoSecretsInCapability(workload, `workload(${workloadId})`);

  const requested = workload.requestedCapabilities;
  if (
    !Array.isArray(requested) ||
    requested.length === 0 ||
    requested.length > CAPABILITY_BUDGET_LIMITS.maxWorkloadCapabilities
  ) {
    throw errInvalid(
      `workload.requestedCapabilities must be a non-empty array of at most ${CAPABILITY_BUDGET_LIMITS.maxWorkloadCapabilities} items`,
      { workloadId },
    );
  }

  if (workload.expectedBudgetVersion !== undefined && workload.expectedBudgetVersion !== budget.version()) {
    throw errConflict(
      `workload '${workloadId}' budget version mismatch: expected ${workload.expectedBudgetVersion}, actual ${budget.version()}`,
      {
        workloadId,
        expectedBudgetVersion: workload.expectedBudgetVersion,
        actualBudgetVersion: budget.version(),
      },
    );
  }

  const declaredSet = normalizeCapabilitySet(declaredCapabilities, 'declaredCapabilities');
  const authorizedSet = normalizeCapabilitySet(authorizedCapabilities, 'authorizedCapabilities');
  if (authorizedSet === null) {
    throw errUnauthorized(
      `workload '${workloadId}' requires an explicit authorizedCapabilities grant from P5`,
      { workloadId },
    );
  }

  const seenIds = new Set();
  const normalizedRequests = [];
  for (const reqItem of requested) {
    if (reqItem === null || typeof reqItem !== 'object' || Array.isArray(reqItem)) {
      throw errInvalid('each requestedCapabilities item must be a plain object', { workloadId });
    }
    const id = assertValidId(reqItem.id, 'requestedCapability.id');
    if (seenIds.has(id)) {
      throw errInvalid(`duplicate capability '${id}' in workload '${workloadId}'`, {
        workloadId,
        id,
      });
    }
    seenIds.add(id);
    const requestedTier = reqItem.tier ?? 'L2_SCHEMA';
    if (!['L1_SUMMARY', 'L2_SCHEMA', 'L3_PROCEDURE'].includes(requestedTier)) {
      throw errInvalid(
        `requestedCapability.tier for '${id}' must be L1_SUMMARY, L2_SCHEMA, or L3_PROCEDURE`,
        { workloadId, id, tier: requestedTier },
      );
    }
    const priority = reqItem.priority ?? 0;
    if (!Number.isInteger(priority) || priority < -1000 || priority > 1000) {
      throw errInvalid(`requestedCapability.priority for '${id}' must be an integer in [-1000, 1000]`, {
        workloadId,
        id,
        priority,
      });
    }

    // L1 check without triggering any L2/L3 loader.
    const summary = catalog.describeSummary(id, {
      declaredCapabilities: declaredSet,
      authorizedCapabilities: authorizedSet,
    });
    if (summary.availability === 'unavailable' || summary.availability === 'disabled') {
      throw errUnavailable(
        `workload '${workloadId}' cannot admit '${id}' because its availability is '${summary.availability}'`,
        { workloadId, capabilityId: id, availability: summary.availability },
      );
    }
    if (!summary.declared) {
      throw errUndeclared(
        `workload '${workloadId}' capability '${id}' requires undeclared capabilities`,
        { workloadId, capabilityId: id, requiredCapabilities: summary.requiredCapabilities },
      );
    }
    if (!summary.authorized) {
      throw errUnauthorized(
        `workload '${workloadId}' caller is not authorized for '${id}' or its requiredCapabilities`,
        { workloadId, capabilityId: id, requiredCapabilities: summary.requiredCapabilities },
      );
    }

    normalizedRequests.push({
      id,
      requestedTier,
      priority,
      summary,
    });
  }

  // Deterministic ordering: highest priority first, then ASCII id.
  normalizedRequests.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.id.localeCompare(b.id);
  });

  const initialSnapshot = budget.snapshot({ scope, scopeRef, contextTokensUsed });
  if (initialSnapshot.availableContextForCapabilities <= 0) {
    return Object.freeze({
      admitted: false,
      decision: 'rejected',
      workloadId,
      scope,
      scopeRef,
      reason: CAPABILITY_ERROR_CODES.EXHAUSTED,
      admittedCapabilities: Object.freeze([]),
      degradedCapabilities: Object.freeze([]),
      rejectedCapabilities: Object.freeze(normalizedRequests.map((r) => r.id)),
      budgetSnapshot: initialSnapshot,
    });
  }

  const createdAllocations = [];
  const admittedCapabilities = [];
  const degradedCapabilities = [];
  const rejectedCapabilities = [];

  function rollbackAllocations() {
    for (let i = createdAllocations.length - 1; i >= 0; i -= 1) {
      try {
        budget.release({ allocationId: createdAllocations[i].allocationId });
      } catch {
        // Ignore if already released.
      }
    }
  }

  for (const item of normalizedRequests) {
    if (item.requestedTier === 'L1_SUMMARY') {
      const check = budget.checkAllocation({
        capabilityId: item.id,
        tier: 'L1_SUMMARY',
        tokens: item.summary.summaryTokens,
        scope,
        scopeRef,
        contextTokensUsed,
      });
      if (!check.allowed) {
        rollbackAllocations();
        return Object.freeze({
          admitted: false,
          decision: 'rejected',
          workloadId,
          scope,
          scopeRef,
          reason: CAPABILITY_ERROR_CODES.EXHAUSTED,
          admittedCapabilities: Object.freeze([]),
          degradedCapabilities: Object.freeze([]),
          rejectedCapabilities: Object.freeze(normalizedRequests.map((r) => r.id)),
          budgetSnapshot: budget.snapshot({ scope, scopeRef, contextTokensUsed }),
        });
      }
      const alloc = budget.allocate({
        capabilityId: item.id,
        kind: item.summary.kind,
        tier: 'L1_SUMMARY',
        tokens: item.summary.summaryTokens,
        tokenStatus: item.summary.summaryTokenStatus,
        scope,
        scopeRef,
        contextTokensUsed,
      });
      if (!alloc.deduplicated) createdAllocations.push(alloc.allocation);
      admittedCapabilities.push(
        Object.freeze({
          id: item.id,
          kind: item.summary.kind,
          requestedTier: 'L1_SUMMARY',
          admittedTier: 'L1_SUMMARY',
          status: 'admitted',
          tokens: item.summary.summaryTokens,
          schema: null,
          procedure: null,
          summary: item.summary,
        }),
      );
      continue;
    }

    const degradeOnExhaustion = admissionPolicy === 'degrade-to-lazy';
    try {
      const loaded =
        item.requestedTier === 'L3_PROCEDURE'
          ? catalog.loadProcedure(item.id, {
              budget,
              scope,
              scopeRef,
              contextTokensUsed,
              declaredCapabilities: declaredSet,
              authorizedCapabilities: authorizedSet,
              requireAuthorization: true,
              degradeOnExhaustion,
            })
          : catalog.loadSchema(item.id, {
              budget,
              scope,
              scopeRef,
              contextTokensUsed,
              declaredCapabilities: declaredSet,
              authorizedCapabilities: authorizedSet,
              requireAuthorization: true,
              degradeOnExhaustion,
            });

      if (loaded.status === 'degraded') {
        // Allocate the L1_SUMMARY fallback in the budget so even degraded items are honestly accounted.
        const summaryCheck = budget.checkAllocation({
          capabilityId: item.id,
          tier: 'L1_SUMMARY',
          tokens: item.summary.summaryTokens,
          scope,
          scopeRef,
          contextTokensUsed,
        });
        if (!summaryCheck.allowed) {
          rollbackAllocations();
          return Object.freeze({
            admitted: false,
            decision: 'rejected',
            workloadId,
            scope,
            scopeRef,
            reason: CAPABILITY_ERROR_CODES.EXHAUSTED,
            admittedCapabilities: Object.freeze([]),
            degradedCapabilities: Object.freeze([]),
            rejectedCapabilities: Object.freeze(normalizedRequests.map((r) => r.id)),
            budgetSnapshot: budget.snapshot({ scope, scopeRef, contextTokensUsed }),
          });
        }
        const summaryAlloc = budget.allocate({
          capabilityId: item.id,
          kind: item.summary.kind,
          tier: 'L1_SUMMARY',
          tokens: item.summary.summaryTokens,
          tokenStatus: item.summary.summaryTokenStatus,
          scope,
          scopeRef,
          contextTokensUsed,
        });
        if (!summaryAlloc.deduplicated) createdAllocations.push(summaryAlloc.allocation);

        const degradedEntry = Object.freeze({
          id: item.id,
          kind: item.summary.kind,
          requestedTier: item.requestedTier,
          admittedTier: 'L1_SUMMARY',
          status: 'degraded',
          tokens: item.summary.summaryTokens,
          schema: null,
          procedure: null,
          summary: item.summary,
        });
        admittedCapabilities.push(degradedEntry);
        degradedCapabilities.push(item.id);
      } else {
        if (loaded.allocation) {
          createdAllocations.push(loaded.allocation);
        }
        admittedCapabilities.push(
          Object.freeze({
            id: item.id,
            kind: item.summary.kind,
            requestedTier: item.requestedTier,
            admittedTier: loaded.tier,
            status: 'admitted',
            tokens: loaded.tokens,
            schema: loaded.schema ?? null,
            procedure: loaded.procedure ?? null,
            summary: item.summary,
          }),
        );
      }
    } catch (err) {
      rollbackAllocations();
      if (err instanceof CapabilityBudgetError && err.code === CAPABILITY_ERROR_CODES.EXHAUSTED) {
        rejectedCapabilities.push(item.id);
        return Object.freeze({
          admitted: false,
          decision: 'rejected',
          workloadId,
          scope,
          scopeRef,
          reason: CAPABILITY_ERROR_CODES.EXHAUSTED,
          admittedCapabilities: Object.freeze([]),
          degradedCapabilities: Object.freeze([]),
          rejectedCapabilities: Object.freeze(normalizedRequests.map((r) => r.id)),
          budgetSnapshot: budget.snapshot({ scope, scopeRef, contextTokensUsed }),
        });
      }
      throw err;
    }
  }

  const decision = degradedCapabilities.length > 0 ? 'degraded' : 'admitted';
  return Object.freeze({
    admitted: true,
    decision,
    workloadId,
    scope,
    scopeRef,
    reason: null,
    admittedCapabilities: Object.freeze(admittedCapabilities),
    degradedCapabilities: Object.freeze(degradedCapabilities),
    rejectedCapabilities: Object.freeze([]),
    budgetSnapshot: budget.snapshot({ scope, scopeRef, contextTokensUsed }),
  });
}
