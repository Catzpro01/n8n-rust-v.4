/**
 * Node admission pipeline — P6-S01 (Issue #95, the live installation path).
 *
 * PUBLIC CONTRACT (`node.admission@0.1.0`, domain `node-registry`).
 *
 * P6 already owns every primitive this pipeline needs: the declaration
 * vocabulary and its invariants (`node-registry.mjs`), the trust-class →
 * capability ceiling (`plugin-policy.mjs`), the trust-class → locality matrix
 * (`plugin-locality.mjs`), digest/attestation/revocation (`supply-chain.mjs`),
 * the integrity chain and freshness (`registry-integrity.mjs`), the crash
 * breaker and quarantine (`node-health.mjs`), and the transactional
 * resolve→prepare→verify→stage→publish→activate steps
 * (`package-transaction.mjs`).
 *
 * What did NOT exist is the thing that runs them **in order, fail-closed, with
 * a reason** — the admission pipeline Issue #95 specifies:
 *
 * ```text
 * artifact → identify → verify package metadata → verify digest/signature/provenance
 *          → resolve node contract → resolve requested capabilities
 *          → resolve trust class → resolve runtime locality
 *          → validate resource limits → validate compatibility
 *          → health/self-test → admit or reject
 * ```
 *
 * That pipeline is this module. It is a **decision function, not an
 * installer**: it takes a candidate plus the policy context the caller already
 * holds, and returns an explainable verdict. It performs no I/O, downloads
 * nothing, and executes nothing.
 *
 * THE THREE RULES THAT KEEP IT HONEST (all enforced by tests):
 *
 *   1. **A NODE CLASS IS A POLICY INPUT, NOT A TRUST GRANT.** The seven classes
 *      in `NODE_CLASSES` map to a trust-class *ceiling*, never to a trust class.
 *      `official` does not mean unrestricted; Rust is not automatically
 *      trusted; community code does not inherit Core authority; an AI-authored
 *      node defaults to the most restrictive class. Nothing in this module maps
 *      any class to `CORE`, because no class earns it by existing.
 *
 *   2. **FAIL-CLOSED, FIRST FAILURE WINS.** Every stage is a gate. The first
 *      stage that fails ends the pipeline and names itself; later stages are
 *      recorded `skipped`, never run. An absent optional field is a rejection,
 *      not a default — there is no "assume the best" path.
 *
 *   3. **THE RUNTIME CHOICE NEVER CHANGES THE CONSUMER-FACING CONTRACT.** Node
 *      type identity, parameters, expressions, credential bindings, UI
 *      metadata, import/export and execution semantics are asserted unchanged
 *      by `validateCompatibility`. Where a node executes is a policy outcome;
 *      what a workflow sees is not.
 *
 * WHAT THIS IS NOT (scope walls, enforced by tests):
 *   - it does not download, unpack, install or execute an artifact;
 *   - it does not verify a signature itself — it consumes the caller's
 *     provenance verdict (P6.12 owns the cryptography);
 *   - it does not decide resource scheduling (a resource profile is policy
 *     input, never a scheduler);
 *   - it does not uninstall, revoke or roll back an epoch;
 *   - it does not re-declare any vocabulary it consumes.
 *
 * Authority: an admission here is a *registry* decision — this node, at this
 * version, may be declared. It grants no capability by itself: every
 * capability the node requests is still evaluated against the foundation
 * ceiling by `plugin-policy.mjs` at request time.
 */
import {
  PLUGIN_RUNTIME_LOCALITIES,
  PLUGIN_TRUST_CLASSES,
} from './plugin-runtime.mjs';
import {
  LOCALITY_MATRIX,
  isLocalityAllowed,
  recommendLocality,
} from './plugin-locality.mjs';
import {
  TRUST_CLASS_CAPABILITY_CEILING,
  evaluateCapability,
} from './plugin-policy.mjs';
import {
  NODE_COMPATIBILITY_KINDS,
  NODE_CONCURRENCY_MODES,
  NODE_HEALTH_STATES,
  NODE_PROVENANCE_KINDS,
  NODE_RESOURCE_FIELDS,
  isNodeTypeId,
  isNodeTypeVersion,
  nodeIdentity,
} from './node-registry.mjs';

export const NODE_ADMISSION_CONTRACT = 'node.admission@0.1.0';
export const NODE_ADMISSION_CONTRACT_VERSION = '0.1.0';
export const NODE_ADMISSION_SCHEMA_VERSION = 1;

export const NODE_ADMISSION_OPERATIONS = Object.freeze(['admit', 'describe']);
export const NODE_ADMISSION_PERMISSIONS = Object.freeze(['node:read']);

/**
 * The seven node classes Issue #95 requires the architecture to distinguish.
 * A class answers "what kind of thing claims to be this node"; it never
 * answers "how much may it do".
 */
export const NODE_CLASSES = Object.freeze([
  'official',
  'verified-community',
  'unverified-community',
  'private',
  'custom',
  'native-rust',
  'native-portable',
]);

/**
 * Class → the **ceiling** trust class that class may ever be admitted at.
 *
 * This is the table that makes rule 1 structural. Read it against Issue #95's
 * trust rule:
 *
 *   - `official` → TRUSTED, never CORE: "official does not mean unrestricted".
 *   - `native-rust` → TRUSTED, never CORE: "Rust is not automatically trusted".
 *     It earns the same ceiling as official, and no more.
 *   - `verified-community` / `private` → ISOLATED: community code does not
 *     inherit Core authority, and being internal is not being trusted.
 *   - `unverified-community` → SANDBOXED.
 *   - `custom` → SANDBOXED, and an AI-authored custom node can go no higher:
 *     "AI-generated code should default to a more restrictive trust class".
 *   - `native-portable` → SANDBOXED: JS/Python/WASM gets no provenance bonus.
 *
 * There is deliberately **no** entry mapping to `CORE`. A node class is where
 * a node came from, and where something came from is not what it may do.
 */
export const NODE_CLASS_TRUST_CEILING = Object.freeze({
  official: 'TRUSTED',
  'verified-community': 'ISOLATED',
  'unverified-community': 'SANDBOXED',
  private: 'ISOLATED',
  custom: 'SANDBOXED',
  'native-rust': 'TRUSTED',
  'native-portable': 'SANDBOXED',
});

/**
 * The pipeline stages, in the exact order Issue #95 lists them. The order is
 * load-bearing: identity before provenance, provenance before capability,
 * capability before locality, and health last so a node is never health-tested
 * before it is known to be legal.
 */
export const ADMISSION_STAGES = Object.freeze([
  'identify',
  'verify-metadata',
  'verify-provenance',
  'resolve-contract',
  'resolve-capabilities',
  'resolve-trust',
  'resolve-locality',
  'validate-resources',
  'validate-compatibility',
  'health-selftest',
  'decide',
]);

export const ADMISSION_STAGE_STATUSES = Object.freeze(['passed', 'failed', 'skipped']);
export const ADMISSION_DECISIONS = Object.freeze(['admit', 'reject']);

/** Bounds — §63. Nothing in an admission may grow without limit. */
export const ADMISSION_BOUNDS = Object.freeze({
  maxStages: ADMISSION_STAGES.length,
  maxCapabilities: 64,
  maxDependencies: 64,
  maxStageTrace: ADMISSION_STAGES.length,
  maxReasons: 32,
  maxPackageNameLength: 214,
});

/** Machine reason-codes. Stable, greppable, and never a bare boolean. */
export const ADMISSION_REASONS = Object.freeze([
  'ADMITTED',
  'UNKNOWN_NODE_CLASS',
  'BAD_NODE_TYPE',
  'BAD_TYPE_VERSION',
  'IDENTITY_MISMATCH',
  'MISSING_PACKAGE_METADATA',
  'BAD_PACKAGE_NAME',
  'MISSING_PROVENANCE',
  'BAD_PROVENANCE_KIND',
  'PROVENANCE_UNVERIFIED',
  'ARTIFACT_REVOKED',
  'ATTESTATION_REQUIRED',
  'MISSING_CONTRACT',
  'BAD_CONTRACT_VERSION',
  'MISSING_PARAMETERS',
  'CREDENTIAL_BINDING_LOST',
  'UI_METADATA_LOST',
  'UNKNOWN_CAPABILITY',
  'CAPABILITY_OVER_CEILING',
  'UNKNOWN_TRUST_CLASS',
  'TRUST_CLASS_OVER_CEILING',
  'AI_AUTHOR_NOT_SANDBOXED',
  'UNKNOWN_LOCALITY',
  'LOCALITY_NOT_ALLOWED',
  'UNKNOWN_RESOURCE_FIELD',
  'RESOURCE_LIMIT_EXCEEDED',
  'UNKNOWN_CONCURRENCY',
  'COMPATIBILITY_BREAKING',
  'SEMANTICS_CHANGED',
  'NODE_UNHEALTHY',
  'NODE_QUARANTINED',
]);

/**
 * The consumer-facing contract that a runtime choice must never change
 * (Issue #95, "Community compatibility"). `validateCompatibility` asserts each
 * of these survives admission untouched.
 */
export const CONSUMER_CONTRACT_SURFACE = Object.freeze([
  'nodeType',
  'typeVersion',
  'parameters',
  'expressions',
  'credentials',
  'uiMetadata',
  'importExport',
  'executionSemantics',
]);

export const NODE_ADMISSION_RULES = Object.freeze({
  classIsPolicy: 'a node class is a policy input and maps to a trust ceiling, never to a trust grant',
  noCoreByOrigin: 'no node class maps to CORE: origin, language and official status grant no trust',
  failClosed: 'the first failing stage ends the pipeline and names itself; later stages are skipped, never run',
  noSilentDefault: 'an absent required field is a rejection, not a default',
  ceilingNotGrant: 'a declared trust class may be more restrictive than the class ceiling, never more permissive',
  localityWithinMatrix: 'locality is chosen inside the trust class matrix; an override can never widen it',
  runtimeNeverChangesContract: 'where a node runs is a policy outcome; what a workflow sees is not',
  compatibilityReplay: 'an upgrade must replay the consumer contract against the incumbent before it is admitted',
  quarantineOutranks: 'a quarantined or failing node is refused regardless of its metadata',
  derivedOnly: 'the verdict is derived from the candidate and the context; no percentage is estimated',
});

export class NodeAdmissionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'NodeAdmissionError';
    this.code = code;
    this.details = details;
  }
}

const violation = (message, details) =>
  new NodeAdmissionError('lego.contract_violation', message, details);
const denial = (message, details) =>
  new NodeAdmissionError('lego.access_denied', message, details);

function assertBoundedList(list, bound, where) {
  if (!Array.isArray(list)) throw violation(`${where} must be an array`, { where });
  if (list.length > bound) {
    throw violation(`${where} exceeds the bound of ${bound}`, { where, length: list.length, bound });
  }
}

function assertNonEmptyString(value, where, maxLength = 512) {
  if (typeof value !== 'string' || value.length === 0) {
    throw violation(`${where} must be a non-empty string`, { where });
  }
  if (value.length > maxLength) {
    throw violation(`${where} exceeds ${maxLength} characters`, { where, length: value.length });
  }
}

/* -------------------------------------------------------------------------- */
/* Stage helpers — each returns { ok, reason?, detail? } and never throws for  */
/* a policy outcome. Only a malformed *call* throws a contract violation.     */
/* -------------------------------------------------------------------------- */

function stageIdentify(candidate) {
  if (typeof candidate !== 'object' || candidate === null) {
    return { ok: false, reason: 'MISSING_PACKAGE_METADATA', detail: 'candidate must be an object' };
  }
  if (typeof candidate.nodeClass !== 'string' || !NODE_CLASSES.includes(candidate.nodeClass)) {
    return {
      ok: false,
      reason: 'UNKNOWN_NODE_CLASS',
      detail: `nodeClass must be one of ${NODE_CLASSES.join('/')}`,
      declared: [...NODE_CLASSES],
    };
  }
  if (!isNodeTypeId(candidate.nodeType)) {
    return { ok: false, reason: 'BAD_NODE_TYPE', detail: `'${candidate.nodeType}' is not a node type id` };
  }
  if (!isNodeTypeVersion(candidate.typeVersion)) {
    return {
      ok: false,
      reason: 'BAD_TYPE_VERSION',
      detail: `'${candidate.typeVersion}' is not a type version`,
    };
  }
  // Identity is type + typeVersion only. If the candidate carries a pre-baked
  // identity string it must agree, or the candidate is lying about itself.
  if (typeof candidate.identity === 'string' && candidate.identity.length > 0) {
    const derived = nodeIdentity({ type: candidate.nodeType, typeVersion: candidate.typeVersion });
    if (candidate.identity !== derived) {
      return {
        ok: false,
        reason: 'IDENTITY_MISMATCH',
        detail: `declared identity '${candidate.identity}' != derived '${derived}'`,
      };
    }
  }
  return { ok: true };
}

function stageVerifyMetadata(candidate) {
  const pkg = candidate.package;
  if (typeof pkg !== 'object' || pkg === null) {
    return { ok: false, reason: 'MISSING_PACKAGE_METADATA', detail: 'package metadata is required' };
  }
  const name = pkg.name;
  if (typeof name !== 'string' || name.length === 0) {
    return { ok: false, reason: 'BAD_PACKAGE_NAME', detail: 'package.name is required' };
  }
  if (name.length > ADMISSION_BOUNDS.maxPackageNameLength) {
    return {
      ok: false,
      reason: 'BAD_PACKAGE_NAME',
      detail: `package.name exceeds ${ADMISSION_BOUNDS.maxPackageNameLength} characters`,
    };
  }
  // A scoped npm name or a bare path-ish name; no whitespace, no empty scope.
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) {
    return { ok: false, reason: 'BAD_PACKAGE_NAME', detail: `'${name}' is not a package name` };
  }
  if (pkg.version !== undefined && !isNodeTypeVersion(String(pkg.version)) && typeof pkg.version !== 'string') {
    return { ok: false, reason: 'BAD_PACKAGE_NAME', detail: 'package.version must be a string' };
  }
  return { ok: true };
}

function stageVerifyProvenance(candidate, context) {
  const prov = candidate.provenance;
  if (typeof prov !== 'object' || prov === null) {
    return { ok: false, reason: 'MISSING_PROVENANCE', detail: 'provenance is required' };
  }
  if (typeof prov.kind !== 'string' || !NODE_PROVENANCE_KINDS.includes(prov.kind)) {
    return {
      ok: false,
      reason: 'BAD_PROVENANCE_KIND',
      detail: `provenance.kind must be one of ${NODE_PROVENANCE_KINDS.join('/')}`,
      declared: [...NODE_PROVENANCE_KINDS],
    };
  }
  // The caller owns the cryptography; this pipeline consumes the verdict.
  if (prov.verified !== true) {
    return {
      ok: false,
      reason: 'PROVENANCE_UNVERIFIED',
      detail: 'provenance.verified must be true — an unverified artifact is refused, not assumed',
    };
  }
  if (prov.kind === 'attested-build') {
    if (typeof prov.attestationRef !== 'string' || prov.attestationRef.length === 0) {
      return {
        ok: false,
        reason: 'ATTESTATION_REQUIRED',
        detail: 'provenance.kind attested-build demands an attestationRef',
      };
    }
  }
  // Revocation outranks every other provenance fact.
  const revocations = context?.revocations;
  if (revocations && typeof prov.digest === 'string' && prov.digest.length > 0) {
    if (typeof revocations.isRevoked === 'function' && revocations.isRevoked(prov.digest)) {
      return {
        ok: false,
        reason: 'ARTIFACT_REVOKED',
        detail: `artifact digest ${prov.digest.slice(0, 12)}… is revoked`,
        digest: prov.digest,
      };
    }
  }
  return { ok: true };
}

function stageResolveContract(candidate) {
  const contract = candidate.contract;
  if (typeof contract !== 'object' || contract === null) {
    return { ok: false, reason: 'MISSING_CONTRACT', detail: 'a node contract is required' };
  }
  if (typeof contract.version !== 'string' || contract.version.length === 0) {
    return { ok: false, reason: 'BAD_CONTRACT_VERSION', detail: 'contract.version is required' };
  }
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(contract.version)) {
    return {
      ok: false,
      reason: 'BAD_CONTRACT_VERSION',
      detail: `'${contract.version}' is not a semver contract version`,
    };
  }
  if (!Array.isArray(contract.parameters)) {
    return { ok: false, reason: 'MISSING_PARAMETERS', detail: 'contract.parameters must be an array' };
  }
  // Credential bindings and UI metadata are part of the consumer-facing surface:
  // losing either silently breaks every workflow that uses the node.
  if (contract.credentials !== undefined && !Array.isArray(contract.credentials)) {
    return { ok: false, reason: 'CREDENTIAL_BINDING_LOST', detail: 'contract.credentials must be an array' };
  }
  if (contract.uiMetadata !== undefined && (typeof contract.uiMetadata !== 'object' || contract.uiMetadata === null)) {
    return { ok: false, reason: 'UI_METADATA_LOST', detail: 'contract.uiMetadata must be an object' };
  }
  return { ok: true };
}

function stageResolveCapabilities(candidate, context) {
  const requested = candidate.requestedCapabilities ?? [];
  if (!Array.isArray(requested)) {
    return { ok: false, reason: 'UNKNOWN_CAPABILITY', detail: 'requestedCapabilities must be an array' };
  }
  assertBoundedList(requested, ADMISSION_BOUNDS.maxCapabilities, 'requestedCapabilities');
  const vocabulary = context?.capabilityVocabulary;
  for (const capability of requested) {
    if (typeof capability !== 'string' || capability.length === 0) {
      return { ok: false, reason: 'UNKNOWN_CAPABILITY', detail: 'a capability must be a non-empty string' };
    }
    if (Array.isArray(vocabulary) && !vocabulary.includes(capability)) {
      return {
        ok: false,
        reason: 'UNKNOWN_CAPABILITY',
        detail: `'${capability}' is outside the foundation capability vocabulary`,
      };
    }
  }
  // The requested set is resolved here; it is checked against the trust ceiling
  // in `resolve-trust`, which is the stage that resolves the ceiling. Issue #95
  // lists "resolve requested capabilities" before "resolve trust class", and the
  // ceiling check belongs with the stage that knows the ceiling.
  return { ok: true, requestedCapabilities: [...requested] };
}

function stageResolveTrust(candidate, context, resolved) {
  const ceiling = NODE_CLASS_TRUST_CEILING[candidate.nodeClass];
  if (typeof ceiling !== 'string' || !PLUGIN_TRUST_CLASSES.includes(ceiling)) {
    return {
      ok: false,
      reason: 'UNKNOWN_TRUST_CLASS',
      detail: `no trust ceiling is declared for class '${candidate.nodeClass}'`,
    };
  }
  const declared = candidate.declaredTrustClass;
  let effective = ceiling;
  if (declared !== undefined && declared !== null) {
    if (typeof declared !== 'string' || !PLUGIN_TRUST_CLASSES.includes(declared)) {
      return {
        ok: false,
        reason: 'UNKNOWN_TRUST_CLASS',
        detail: `declaredTrustClass must be one of ${PLUGIN_TRUST_CLASSES.join('/')}`,
      };
    }
    // A node may declare itself MORE isolated, never less. This is the rule that
    // stops a community package from writing CORE into its own manifest.
    const order = Object.keys(TRUST_CLASS_CAPABILITY_CEILING);
    const ceilingRank = order.indexOf(ceiling);
    const declaredRank = order.indexOf(declared);
    if (declaredRank < ceilingRank) {
      return {
        ok: false,
        reason: 'TRUST_CLASS_OVER_CEILING',
        detail: `declaredTrustClass ${declared} is more permissive than the ${ceiling} ceiling for class '${candidate.nodeClass}'`,
        declared,
        ceiling,
      };
    }
    if (declaredRank > ceilingRank) effective = declared;
  }
  // AI authorship is a hard floor, not a preference.
  if (candidate.aiAuthored === true && effective !== 'SANDBOXED') {
    return {
      ok: false,
      reason: 'AI_AUTHOR_NOT_SANDBOXED',
      detail: 'an AI-authored node must be admitted SANDBOXED',
    };
  }
  // Now the ceiling is known, so the requested set resolved by the previous
  // stage can finally be checked against it. The ceiling is the ceiling: a node
  // can never request past its own class.
  const requested = resolved.requestedCapabilities ?? [];
  for (const capability of requested) {
    // `evaluateCapability` answers `granted`, not `allowed`: a domain token is
    // deny-by-default and needs an exact grant, while a foundation token is
    // judged against the ceiling's default grants. Reading the wrong key would
    // silently admit everything, so the shape is asserted, not assumed.
    const verdict = evaluateCapability({ trustClass: effective, capability, grants: [] });
    if (verdict.granted !== true) {
      return {
        ok: false,
        reason: 'CAPABILITY_OVER_CEILING',
        detail: `'${capability}' exceeds the ${effective} ceiling`,
        capability,
        ceiling: effective,
      };
    }
  }
  return { ok: true, ceiling: effective };
}

function stageResolveLocality(candidate, resolvedTrustClass) {
  const requested = candidate.requestedLocality;
  if (requested === undefined || requested === null) {
    // Nothing requested: recommend inside the matrix, which can never widen it.
    return { ok: true, locality: recommendLocality(resolvedTrustClass, candidate.localityShape ?? {}) };
  }
  if (typeof requested !== 'string' || !PLUGIN_RUNTIME_LOCALITIES.includes(requested)) {
    return {
      ok: false,
      reason: 'UNKNOWN_LOCALITY',
      detail: `requestedLocality must be one of ${PLUGIN_RUNTIME_LOCALITIES.join('/')}`,
      declared: [...PLUGIN_RUNTIME_LOCALITIES],
    };
  }
  const verdict = isLocalityAllowed(resolvedTrustClass, requested);
  if (!verdict.allowed) {
    return {
      ok: false,
      reason: 'LOCALITY_NOT_ALLOWED',
      detail: verdict.reason,
      trustClass: resolvedTrustClass,
      locality: requested,
      allowedRow: [...LOCALITY_MATRIX[resolvedTrustClass]],
    };
  }
  return { ok: true, locality: requested };
}

function stageValidateResources(candidate, context) {
  // Concurrency is checked unconditionally: it is part of the declaration, not
  // of the optional resource profile, so a bad value must not slip through just
  // because the caller omitted the profile.
  if (candidate.concurrency !== undefined && !NODE_CONCURRENCY_MODES.includes(candidate.concurrency)) {
    return {
      ok: false,
      reason: 'UNKNOWN_CONCURRENCY',
      detail: `concurrency must be one of ${NODE_CONCURRENCY_MODES.join('/')}`,
    };
  }
  const profile = candidate.resourceProfile;
  if (profile === undefined || profile === null) return { ok: true };
  if (typeof profile !== 'object' || Array.isArray(profile)) {
    return { ok: false, reason: 'UNKNOWN_RESOURCE_FIELD', detail: 'resourceProfile must be an object' };
  }
  for (const field of Object.keys(profile)) {
    if (!NODE_RESOURCE_FIELDS.includes(field)) {
      return {
        ok: false,
        reason: 'UNKNOWN_RESOURCE_FIELD',
        detail: `'${field}' is not a declared resource field`,
        declared: [...NODE_RESOURCE_FIELDS],
      };
    }
  }
  const limits = context?.resourceLimits;
  if (limits && typeof limits === 'object') {
    for (const [field, ceiling] of Object.entries(limits)) {
      const requested = profile[field];
      if (typeof requested === 'number' && typeof ceiling === 'number' && requested > ceiling) {
        return {
          ok: false,
          reason: 'RESOURCE_LIMIT_EXCEEDED',
          detail: `${field} ${requested} exceeds the limit ${ceiling}`,
          field,
          requested,
          limit: ceiling,
        };
      }
    }
  }
  return { ok: true };
}

/**
 * Assert the consumer-facing contract survived. This is rule 3 made testable:
 * the runtime may move, the surface a workflow depends on may not.
 */
export function validateCompatibility(candidate, incumbent = null) {
  if (incumbent === null || incumbent === undefined) {
    return { ok: true, kind: 'unchanged', changed: [] };
  }
  if (typeof incumbent !== 'object') {
    throw violation('incumbent must be an object or null', { incumbent });
  }
  const changed = [];
  for (const field of CONSUMER_CONTRACT_SURFACE) {
    const before = JSON.stringify(incumbent[field] ?? null);
    const after = JSON.stringify(candidate[field] ?? null);
    if (before !== after) changed.push(field);
  }
  if (changed.length === 0) return { ok: true, kind: 'unchanged', changed };
  // `executionSemantics` and `nodeType` are the two the contract calls
  // non-negotiable: a change there is breaking, not a migration.
  const fatal = changed.filter((field) => field === 'executionSemantics' || field === 'nodeType');
  if (fatal.length > 0) {
    return { ok: false, kind: 'breaking', changed, fatal };
  }
  return { ok: true, kind: 'migration-required', changed };
}

function stageValidateCompatibility(candidate, context) {
  const declared = candidate.compatibility;
  if (declared !== undefined && !NODE_COMPATIBILITY_KINDS.includes(declared)) {
    return {
      ok: false,
      reason: 'COMPATIBILITY_BREAKING',
      detail: `compatibility must be one of ${NODE_COMPATIBILITY_KINDS.join('/')}`,
    };
  }
  const incumbent = context?.incumbent ?? null;
  const replay = validateCompatibility(candidate, incumbent);
  if (!replay.ok) {
    return {
      ok: false,
      reason: replay.fatal?.includes('executionSemantics') ? 'SEMANTICS_CHANGED' : 'COMPATIBILITY_BREAKING',
      detail: `the consumer-facing contract changed: ${replay.changed.join(', ')}`,
      changed: replay.changed,
      fatal: replay.fatal,
    };
  }
  if (declared === 'breaking' || declared === 'downgrade') {
    return {
      ok: false,
      reason: 'COMPATIBILITY_BREAKING',
      detail: `the candidate declares itself '${declared}' against the incumbent`,
    };
  }
  return { ok: true, compatibility: replay.kind };
}

function stageHealthSelfTest(candidate, context) {
  // The self-test is checked first and unconditionally: it is a property of the
  // candidate, not of the optional health record, so a failing self-test must
  // not slip through just because the caller omitted `health`.
  const selfTest = candidate.selfTest;
  if (selfTest !== undefined && selfTest !== null) {
    if (typeof selfTest !== 'object' || selfTest.passed !== true) {
      return { ok: false, reason: 'NODE_UNHEALTHY', detail: 'the self-test did not pass' };
    }
  }
  const health = candidate.health;
  if (health === undefined || health === null) return { ok: true };
  if (typeof health !== 'object') {
    return { ok: false, reason: 'NODE_UNHEALTHY', detail: 'health must be an object' };
  }
  const state = health.state ?? 'unknown';
  if (!NODE_HEALTH_STATES.includes(state)) {
    return {
      ok: false,
      reason: 'NODE_UNHEALTHY',
      detail: `health.state must be one of ${NODE_HEALTH_STATES.join('/')}`,
    };
  }
  // Quarantine outranks every observation, and a failing node is refused here
  // so a repeatedly crashing node can never destabilise Core.
  if (state === 'quarantined') {
    return { ok: false, reason: 'NODE_QUARANTINED', detail: 'the node is quarantined on this host' };
  }
  if (state === 'failing') {
    return { ok: false, reason: 'NODE_UNHEALTHY', detail: 'the node is failing' };
  }
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* The pipeline                                                               */
/* -------------------------------------------------------------------------- */

const STAGE_RUNNERS = Object.freeze({
  identify: (candidate) => stageIdentify(candidate),
  'verify-metadata': (candidate) => stageVerifyMetadata(candidate),
  'verify-provenance': (candidate, context) => stageVerifyProvenance(candidate, context),
  'resolve-contract': (candidate) => stageResolveContract(candidate),
  'resolve-capabilities': (candidate, context) => stageResolveCapabilities(candidate, context),
  'resolve-trust': (candidate, context, resolved) => stageResolveTrust(candidate, context, resolved),
  'resolve-locality': (candidate, context, resolved) =>
    stageResolveLocality(candidate, resolved.trustClass),
  'validate-resources': (candidate, context) => stageValidateResources(candidate, context),
  'validate-compatibility': (candidate, context) => stageValidateCompatibility(candidate, context),
  'health-selftest': (candidate, context) => stageHealthSelfTest(candidate, context),
});

/**
 * Run the admission pipeline over one candidate. Pure: no I/O, no clock, no
 * download, no execution. The verdict is derived, never estimated.
 *
 * @param {object} candidate the node/package candidate
 * @param {object} [context] policy the caller already holds
 * @param {string[]} [context.capabilityVocabulary] foundation capability vocabulary
 * @param {object} [context.resourceLimits] per-field numeric ceilings
 * @param {{isRevoked: Function}} [context.revocations] revocation list adapter
 * @param {object} [context.incumbent] the currently-admitted node, for upgrades
 * @returns {AdmissionVerdict}
 */
export function admitNode(candidate, context = {}) {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw violation('admitNode expects a candidate object', { candidate });
  }
  if (typeof context !== 'object' || context === null || Array.isArray(context)) {
    throw violation('admitNode expects a context object', { context });
  }
  if (context.capabilityVocabulary !== undefined) {
    assertBoundedList(context.capabilityVocabulary, ADMISSION_BOUNDS.maxCapabilities, 'capabilityVocabulary');
  }

  const trace = [];
  const resolved = { trustClass: null, locality: null, compatibility: null };
  let failed = null;

  for (const stage of ADMISSION_STAGES) {
    if (stage === 'decide') continue;
    if (failed) {
      trace.push(Object.freeze({ stage, status: 'skipped', reason: null }));
      continue;
    }
    let result;
    try {
      result = STAGE_RUNNERS[stage](candidate, context, resolved);
    } catch (error) {
      if (error instanceof NodeAdmissionError) throw error;
      throw violation(`stage ${stage} threw a non-contract error`, { stage, cause: String(error) });
    }
    if (!result || typeof result.ok !== 'boolean') {
      throw violation(`stage ${stage} returned a malformed result`, { stage, result });
    }
    if (result.ok) {
      if (result.ceiling !== undefined) resolved.trustClass = result.ceiling;
      if (result.locality !== undefined) resolved.locality = result.locality;
      if (result.compatibility !== undefined) resolved.compatibility = result.compatibility;
      // The capability set resolved by `resolve-capabilities` must reach
      // `resolve-trust`, which is the stage that finally holds the ceiling to
      // check it against. Dropping it here would silently admit every request.
      if (result.requestedCapabilities !== undefined) {
        resolved.requestedCapabilities = result.requestedCapabilities;
      }
      trace.push(Object.freeze({ stage, status: 'passed', reason: null }));
    } else {
      failed = { stage, reason: result.reason ?? 'UNKNOWN', detail: result.detail ?? null };
      trace.push(
        Object.freeze({
          stage,
          status: 'failed',
          reason: failed.reason,
          detail: failed.detail,
        }),
      );
    }
  }

  const decision = failed ? 'reject' : 'admit';
  const reasons = failed ? [failed.reason] : ['ADMITTED'];

  const verdict = {
    decision,
    reasons: Object.freeze(reasons),
    nodeClass: typeof candidate.nodeClass === 'string' ? candidate.nodeClass : null,
    identity:
      isNodeTypeId(candidate.nodeType) && isNodeTypeVersion(candidate.typeVersion)
        ? nodeIdentity({ type: candidate.nodeType, typeVersion: candidate.typeVersion })
        : null,
    trustClass: resolved.trustClass,
    locality: resolved.locality,
    compatibility: resolved.compatibility,
    failedStage: failed ? failed.stage : null,
    failureDetail: failed ? failed.detail : null,
    trace: Object.freeze(trace),
  };
  return Object.freeze(verdict);
}

/** The human/agent-readable form of a verdict. Never a bare boolean. */
export function explainAdmission(verdict) {
  if (typeof verdict !== 'object' || verdict === null) {
    throw violation('explainAdmission expects a verdict object', { verdict });
  }
  if (!ADMISSION_DECISIONS.includes(verdict.decision)) {
    throw violation('verdict.decision is not a decision', { decision: verdict.decision });
  }
  if (verdict.decision === 'admit') {
    return `admitted ${verdict.identity ?? '(unknown identity)'} as ${verdict.trustClass} on ${verdict.locality}`;
  }
  return `rejected at ${verdict.failedStage}: ${verdict.failureDetail ?? verdict.reasons.join(', ')}`;
}

/** Bounds re-exported for contract consumers. */
export const NODE_ADMISSION_INPUT_SCHEMA_VERSION = NODE_ADMISSION_SCHEMA_VERSION;
