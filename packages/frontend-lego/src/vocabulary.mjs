/**
 * The shared vocabulary lock — one word, one meaning, on both sides of the seam.
 *
 * The frontend and the backend LEGO foundation are separate packages with separate
 * owners, and they speak about the same things: why a capability cannot serve, what
 * lifecycle it is in, what kind of version move happened, which interaction class an
 * operation is. Two dialects for those questions is exactly the failure this phase
 * exists to prevent, so this module **pins** the vocabulary the backend foundation
 * already publishes, with provenance, and refuses anything that is not in it.
 *
 * Three rules, machine-checkable:
 *
 *   1. A **shared** concept is quoted, never re-invented. `VOCABULARIES` records the
 *      contract that owns it, its version and the file the values were read from, so
 *      a reviewer can check the quote instead of trusting it.
 *   2. A **frontend-local** concept is declared as such (`canonical: null`) and, when
 *      it says something about a shared concept, it must map *totally* into it. A
 *      local word that duplicates a shared one is a conflict, not a synonym.
 *   3. An extra word is **declared with its reason** (`extra`). A vocabulary that
 *      quietly grows an undeclared term fails `vocabularyConflicts()`.
 *
 * Nothing here executes, reads disk or knows a transport. It is data plus three pure
 * functions, so an agent (or a test) can answer "is this still the same vocabulary?"
 * without reading either implementation.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */

/** The backend foundation this lock quotes, so a drift report can say where to look. */
export const QUOTED_FROM = Object.freeze({
  repository: 'Catzpro01/n8n-rust-v.4',
  branch: 'arena/01a0c521-n8n-rust-v-4',
  commit: 'aef6b606',
  phase: 'P2.9',
  readOn: '2026-09-22',
});

/**
 * The canonical vocabularies. `values` is the complete set; `provenance` names the
 * contract (id/version/owner) and the declaration the values were read from.
 * `owner: null` means the frontend owns the concept and the backend has no
 * counterpart — those are listed separately, in `LOCAL_VOCABULARIES`.
 */
export const VOCABULARIES = Object.freeze([
  Object.freeze({
    id: 'degradation',
    question: 'May this capability serve a caller here, and if not, what must the consumer do instead?',
    values: Object.freeze([
      'available',
      'degraded',
      'capability-unavailable',
      'optional-absent',
      'version-incompatible',
      'dependency-disabled',
      'migration-required',
      'feature-unsupported',
    ]),
    /** What each value instructs a consumer to do — quoted, so the frontend cannot soften it. */
    actions: Object.freeze({
      available: 'proceed',
      degraded: 'proceed with reduced guarantees; the provider declares what is reduced',
      'capability-unavailable': 'fail with lego.capability_unavailable',
      'optional-absent': 'skip the optional path; this is not an error',
      'version-incompatible': 'fail with lego.version_incompatible — never silently adapt',
      'dependency-disabled': 'fail with lego.dependency_disabled',
      'migration-required': 'fail with lego.migration_required and name the migration',
      'feature-unsupported': 'answer 501 through the compatibility layer',
    }),
    usable: Object.freeze({ available: true, degraded: true }),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.interaction', version: '1.0.0', owner: 'agent-2' }),
      file: 'apps/n8n-lego/src/lego/interaction.mjs',
      symbol: 'DEGRADATION_STATES',
    }),
  }),
  Object.freeze({
    id: 'lifecycle',
    question: 'What lifecycle state is this LEGO or capability in, and may it be called?',
    values: Object.freeze([
      'declared',
      'available',
      'installed',
      'loaded',
      'active',
      'idle',
      'degraded',
      'disabled',
      'failed',
      'unloaded',
      'deprecated',
    ]),
    callable: Object.freeze(['active', 'idle', 'degraded', 'deprecated']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.negotiation', version: '1.0.0', owner: 'agent-2' }),
      file: 'apps/n8n-lego/src/lego/negotiation.mjs',
      symbol: 'LIFECYCLE_STATES',
    }),
  }),
  Object.freeze({
    id: 'changeKind',
    question: 'What kind of move is A → B for a contract or unit version?',
    values: Object.freeze(['unchanged', 'compatible', 'migration-required', 'breaking', 'downgrade']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.contract-compat', version: '1.0.0', owner: 'manager' }),
      file: 'apps/n8n-lego/src/lego/compat.mjs',
      symbol: 'CHANGE_KINDS',
    }),
  }),
  Object.freeze({
    id: 'interaction',
    question: 'What does an operation mean, independent of any transport?',
    values: Object.freeze(['call', 'event', 'stream', 'batch']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.interaction', version: '1.0.0', owner: 'agent-2' }),
      file: 'apps/n8n-lego/src/lego/interaction.mjs',
      symbol: 'INTERACTION_CLASSES',
    }),
  }),
  Object.freeze({
    id: 'capabilityStatus',
    question: 'How far has this capability been implemented?',
    values: Object.freeze(['implemented', 'partial', 'planned', 'legacy', 'unsupported', 'deferred', 'template']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.domain-registry', version: '1.1.0', owner: 'manager' }),
      file: 'apps/n8n-lego/src/lego/registry.mjs',
      symbol: 'DOMAIN_STATUS',
    }),
  }),
  Object.freeze({
    id: 'transportTarget',
    question: 'Where may the same logical contract be bound, without changing it?',
    values: Object.freeze(['in-process-js', 'in-process-rust', 'wasm', 'worker', 'remote-api']),
    provenance: Object.freeze({
      // No lock row yet: quoted from the foundation manifest, publication pending.
      contract: null,
      file: 'apps/n8n-lego/src/lego/manifest/foundation.json',
      symbol: 'transport.targets',
    }),
    publicationPending: 'the backend foundation manifest declares these targets but no contract-lock row names them yet — recorded for agent-2',
  }),
]);

/**
 * Concepts the frontend owns. `mapsTo` names the canonical vocabulary they speak
 * about, `extra` declares any value that canonical set does not have (with the
 * reason it exists), and `mirrors` declares the total mapping so a reviewer can see
 * that a local word is not a competing meaning.
 */
export const LOCAL_VOCABULARIES = Object.freeze([
  Object.freeze({
    id: 'surfaceStatus',
    question: 'How ready is this UI surface?',
    values: Object.freeze(['present', 'partial', 'unsupported']),
    mapsTo: null,
    provenance: Object.freeze({ file: 'packages/frontend-lego/manifest/surfaces.json', symbol: 'surfaces[].status' }),
    why: 'A surface is a UI area, not a capability: the backend has no counterpart to be right or wrong about.',
  }),
  Object.freeze({
    id: 'unitStatus',
    question: 'How far has this nested unit been implemented?',
    values: Object.freeze(['declared', 'available', 'partial', 'unsupported']),
    mapsTo: 'capabilityStatus',
    extra: Object.freeze([
      Object.freeze({
        value: 'declared',
        reason: 'the unit exists in the manifest and nothing more — canonical `planned`',
      }),
      Object.freeze({
        value: 'available',
        reason: 'an implementation exists for the unit — canonical `implemented`; the spelling travels in the boot payload pinned to the P2.5 baseline, so it is mapped rather than renamed',
      }),
    ]),
    mirror: Object.freeze({ declared: 'planned', available: 'implemented', partial: 'partial', unsupported: 'unsupported' }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/manifest/sub-legos.json', symbol: 'subLegos[].status' }),
  }),
  Object.freeze({
    id: 'instanceImplementation',
    question: 'How much of this capability does THIS instance implement?',
    values: Object.freeze(['implemented', 'partial', 'unsupported', 'unknown']),
    mapsTo: 'capabilityStatus',
    extra: Object.freeze([
      Object.freeze({
        value: 'unknown',
        reason: 'the app handed over no usable status; the frontend reports that instead of guessing "implemented"',
      }),
    ]),
    mirror: Object.freeze({ implemented: 'implemented', partial: 'partial', unsupported: 'unsupported', unknown: null }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/backend-view.mjs', symbol: 'BACKEND_STATES' }),
  }),
  Object.freeze({
    id: 'frontendCapabilityDeclaration',
    question: 'What has this frontend declared about a capability of its own?',
    values: Object.freeze(['declared', 'available', 'partial', 'unsupported']),
    mapsTo: 'capabilityStatus',
    extra: Object.freeze([
      Object.freeze({ value: 'declared', reason: 'a catalog entry with no implementation: canonical `planned`' }),
      Object.freeze({ value: 'available', reason: 'the capability is offered here: canonical `implemented`' }),
    ]),
    mirror: Object.freeze({ declared: 'planned', available: 'implemented', partial: 'partial', unsupported: 'unsupported' }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/registry.mjs', symbol: 'CAPABILITY_STATUSES' }),
  }),
  Object.freeze({
    id: 'capabilityLifecycle',
    question: 'Which lifecycle states does the frontend capability registry use?',
    values: Object.freeze(['available', 'installed', 'loaded', 'active', 'idle', 'unloaded', 'disabled']),
    mapsTo: 'lifecycle',
    extra: Object.freeze([]),
    mirror: Object.freeze({
      available: 'declared',
      installed: 'installed',
      loaded: 'loaded',
      active: 'active',
      idle: 'idle',
      unloaded: 'unloaded',
      disabled: 'disabled',
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/lifecycle.mjs', symbol: 'CAPABILITY_STATES' }),
    why: 'Seven of the eleven canonical lifecycle states; `available` here means "in the catalog, nothing resolved", which the canonical vocabulary calls `declared`. Four canonical states (failed, deprecated, and the two the frontend never reaches) are unused rather than renamed.',
  }),
  Object.freeze({
    id: 'versionFit',
    question: 'Does what a provider offers satisfy what a consumer requires?',
    values: Object.freeze(['unchanged', 'compatible', 'migration-required', 'breaking', 'downgrade', 'invalid']),
    mapsTo: 'changeKind',
    extra: Object.freeze([
      Object.freeze({ value: 'invalid', reason: 'the two values are not versions, so no question about a change can be answered — the frontend reports that instead of a false compatibility' }),
    ]),
    mirror: Object.freeze({ unchanged: 'unchanged', compatible: 'compatible', 'migration-required': 'migration-required', breaking: 'breaking', downgrade: 'downgrade', invalid: null }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/versions.mjs', symbol: 'COMPATIBILITY' }),
  }),
  Object.freeze({
    id: 'operationOutcome',
    question: 'Can this operation be executed, and if not, why not?',
    values: Object.freeze([
      'available',
      'degraded',
      'capability-unavailable',
      'optional-absent',
      'version-incompatible',
      'dependency-disabled',
      'migration-required',
      'feature-unsupported',
      'operation-denied',
      'operation-unpublished',
      'permission-missing',
      'permission-unknown',
    ]),
    mapsTo: 'degradation',
    extra: Object.freeze([
      Object.freeze({ value: 'operation-denied', reason: 'the caller is not granted the capability on its surface, so it is refused at the operation level without learning anything about the capability — placement never grants an operation' }),
      Object.freeze({ value: 'operation-unpublished', reason: 'the provider publishes no operation list, so the frontend cannot verify that the operation exists: fail closed rather than assume' }),
      Object.freeze({ value: 'permission-missing', reason: 'the capability declares a required permission the caller does not hold' }),
      Object.freeze({ value: 'permission-unknown', reason: 'the caller requires a permission the capability never declared' }),
    ]),
    /** The first eight are the canonical degradation states verbatim; the last four answer a question canonical degradation does not ask. */
    mirror: Object.freeze({
      available: 'available',
      degraded: 'degraded',
      'capability-unavailable': 'capability-unavailable',
      'optional-absent': 'optional-absent',
      'version-incompatible': 'version-incompatible',
      'dependency-disabled': 'dependency-disabled',
      'migration-required': 'migration-required',
      'feature-unsupported': 'feature-unsupported',
      'operation-denied': null,
      'operation-unpublished': null,
      'permission-missing': null,
      'permission-unknown': null,
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/negotiation.mjs', symbol: 'OPERATION_STATES' }),
  }),
]);

const BY_ID = new Map([...VOCABULARIES, ...LOCAL_VOCABULARIES].map((set) => [set.id, set]));

export class VocabularyError extends Error {
  constructor(message, { vocabulary = null, value = null } = {}) {
    super(message);
    this.name = 'VocabularyError';
    this.code = 'frontend.vocabulary.unknown-term';
    this.vocabulary = vocabulary;
    this.value = value;
  }
}

/** A vocabulary set by id, or null. */
export function vocabularyOf(id) {
  return BY_ID.get(id) ?? null;
}

/** Is `value` one of the declared terms of `id`? Fail-closed for an unknown set id. */
export function isDeclaredTerm(id, value) {
  const set = BY_ID.get(id);
  if (!set) throw new VocabularyError(`"${id}" is not a declared vocabulary`, { vocabulary: id, value });
  return set.values.includes(value);
}

/** `assertVocabulary`, as a throw: an undeclared term is never a synonym for a declared one. */
export function assertTerm(id, value) {
  if (!isDeclaredTerm(id, value)) {
    const set = BY_ID.get(id);
    throw new VocabularyError(`"${value}" is not a declared ${id} (one of ${set.values.join(', ')})`, { vocabulary: id, value });
  }
  return value;
}

/**
 * Compares an observed vocabulary (values read from a live module, a manifest or a
 * provider declaration) against the lock.
 *
 * @returns {{ id: string, ok: boolean, missing: string[], extra: string[], detail: string }}
 */
export function compareVocabulary(id, observed) {
  const set = BY_ID.get(id);
  if (!set) {
    return Object.freeze({ id, ok: false, missing: [], extra: [], detail: `"${id}" is not a declared vocabulary` });
  }
  const seen = new Set(observed ?? []);
  const missing = set.values.filter((value) => !seen.has(value));
  const extra = [...seen].filter((value) => !set.values.includes(value)).sort();
  return Object.freeze({
    id,
    ok: missing.length === 0 && extra.length === 0,
    missing: Object.freeze(missing),
    extra: Object.freeze(extra),
    detail: missing.length === 0 && extra.length === 0
      ? `${set.values.length} terms match`
      : `missing: [${missing.join(', ')}]; undeclared: [${extra.join(', ')}]`,
  });
}

/**
 * A drift report over several vocabularies at once, e.g. everything read from the
 * backend foundation in one pass. Unknown ids are reported, never skipped: a
 * comparison that silently checks nothing is worse than no comparison.
 */
export function vocabularyDrift(observed = {}) {
  const reports = Object.keys(observed)
    .sort()
    .map((id) => compareVocabulary(id, observed[id]));
  return Object.freeze({
    ok: reports.every((report) => report.ok),
    reports: Object.freeze(reports),
    summary: reports.map((report) => `${report.id}: ${report.ok ? 'ok' : report.detail}`).join('; '),
  });
}

/**
 * Self-audit of the lock itself — the check that keeps a vocabulary from quietly
 * growing a second meaning.
 *
 * * classes of conflict: a local set that names a canonical vocabulary must map every
 *   value into it, and every value it adds must be declared with a reason;
 * * a value may not appear in two canonical vocabularies with different meanings
 *   unless the overlap is intentional and declared (`sharedTerms`).
 */
export function vocabularyConflicts({ sharedTerms = { degradation: ['available', 'degraded', 'migration-required'] } } = {}) {
  const conflicts = [];

  for (const set of LOCAL_VOCABULARIES) {
    if (set.mapsTo === null) {
      if (set.extra !== undefined && set.extra.length > 0) {
        conflicts.push(`${set.id} declares extra values but maps to no canonical vocabulary`);
      }
      continue;
    }
    const canonical = BY_ID.get(set.mapsTo);
    if (!canonical) {
      conflicts.push(`${set.id} maps to unknown vocabulary "${set.mapsTo}"`);
      continue;
    }
    const mirrored = new Set(Object.keys(set.mirror ?? {}));
    for (const value of set.values) {
      if (!mirrored.has(value)) conflicts.push(`${set.id} value "${value}" has no declared mapping into ${set.mapsTo}`);
      const target = set.mirror?.[value] ?? null;
      if (target !== null && !canonical.values.includes(target)) {
        conflicts.push(`${set.id} maps "${value}" to "${target}", which ${set.mapsTo} does not declare`);
      }
    }
    for (const [value, target] of Object.entries(set.mirror ?? {})) {
      const needsReason = !canonical.values.includes(value);
      const declared = (set.extra ?? []).find((entry) => entry.value === value);
      if (needsReason && !declared) {
        conflicts.push(`${set.id} value "${value}" is not a ${set.mapsTo} term and carries no declared reason`);
      }
    }
    for (const declared of set.extra ?? []) {
      if (!set.values.includes(declared.value)) {
        conflicts.push(`${set.id} declares a reason for "${declared.value}", which is not one of its values`);
      }
    }
  }

  // A term shared between two canonical vocabularies is allowed only where declared:
  // `available`, `degraded` and `migration-required` name a lifecycle state in one
  // vocabulary and an availability in another, which is intended, not drift.
  for (const set of VOCABULARIES) {
    for (const other of VOCABULARIES) {
      if (set.id >= other.id) continue;
      const overlap = set.values.filter((value) => other.values.includes(value));
      for (const value of overlap) {
        if (!(sharedTerms[set.id]?.includes(value) || sharedTerms[other.id]?.includes(value))) {
          conflicts.push(`"${value}" is declared by both ${set.id} and ${other.id} without a declared overlap`);
        }
      }
    }
  }

  return Object.freeze({
    ok: conflicts.length === 0,
    conflicts: Object.freeze(conflicts),
    checked: VOCABULARIES.length + LOCAL_VOCABULARIES.length,
  });
}

/**
 * Capability identity, normalised once and explicitly.
 *
 * A capability id is `<domain>.<name>` in lower kebab case — the same grammar the
 * operation names use. Normalisation is *not* a reformatting service: it lowercases
 * and trims only, and anything else is refused, so two spellings can never both be
 * "the" capability. Whether two ids collide is a separate question (`detectCollisions`).
 */
export const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;

export function normaliseCapabilityId(value) {
  if (typeof value !== 'string') {
    throw new VocabularyError(`a capability id must be a string, got ${typeof value}`, { vocabulary: 'capabilityId', value });
  }
  const trimmed = value.trim().toLowerCase();
  if (!CAPABILITY_ID_PATTERN.test(trimmed)) {
    throw new VocabularyError(`"${value}" is not a capability id (expected <domain>.<name> in lower kebab case)`, { vocabulary: 'capabilityId', value });
  }
  return trimmed;
}

/**
 * Where a name is used twice, with the origins kept apart.
 *
 * A frontend capability and a backend-advertised capability that share an id are not
 * synonyms: the frontend reports the collision and both origins, and never merges the
 * two. This is the machine-readable half of "no second semantic identity".
 *
 * @param {Array<{ id: string, origin: string }>} entries
 */
export function detectCollisions(entries = []) {
  const byId = new Map();
  for (const entry of entries) {
    const id = normaliseCapabilityId(entry.id);
    if (!byId.has(id)) byId.set(id, new Set());
    byId.get(id).add(entry.origin);
  }
  const collisions = [...byId.entries()]
    .filter(([, origins]) => origins.size > 1)
    .map(([id, origins]) => Object.freeze({ id, origins: Object.freeze([...origins].sort()) }));
  return Object.freeze({
    collisions: Object.freeze(collisions),
    ok: collisions.length === 0,
    detail: collisions.length === 0
      ? `${byId.size} capability ids, each with exactly one origin`
      : collisions.map((entry) => `${entry.id}: ${entry.origins.join(' + ')}`).join('; '),
  });
}

/** The lock as data, for docs, `.ai/` cards, the contract document and tests. */
export function describeVocabulary() {
  return Object.freeze({
    quotedFrom: QUOTED_FROM,
    canonical: Object.freeze(VOCABULARIES.map((set) => Object.freeze({
      id: set.id,
      question: set.question,
      size: set.values.length,
      values: set.values,
      contract: set.provenance.contract,
      declaredIn: `${set.provenance.file}#${set.provenance.symbol}`,
    }))),
    local: Object.freeze(LOCAL_VOCABULARIES.map((set) => Object.freeze({
      id: set.id,
      question: set.question,
      values: set.values,
      mapsTo: set.mapsTo,
      extra: Object.freeze((set.extra ?? []).map((entry) => entry.value)),
      declaredIn: `${set.provenance.file}#${set.provenance.symbol}`,
    }))),
    rules: Object.freeze([
      'A shared word is quoted from the contract that owns it, with its version — never re-invented here.',
      'A frontend-local word declares what it maps to; a word with no mapping carries its reason.',
      'An undeclared term is refused (fail closed), never treated as a synonym.',
      'Capability ids are normalised once (trim, lowercase, <domain>.<name>); two spellings never both name one capability.',
      'Two origins sharing an id are a reported collision, not a merge.',
    ]),
  });
}
