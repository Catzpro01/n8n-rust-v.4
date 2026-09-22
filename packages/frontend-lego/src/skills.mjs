/**
 * The Skill surface — discovery and state presentation, and nothing else (P2.12).
 *
 * A Skill is *how* a task is done: knowledge, rules, a procedure and a capability map. It
 * is not a capability (*what* can be done) and not an agent (*who* does it). The backend
 * owns the vocabulary — `manifest/ai-lego-set.json` declares the Skill LEGO with its six
 * lifecycle states, its operations, the permissions those operations require, its
 * disclosure levels and its status — and this module is the frontend's consumer of it.
 *
 * Three rules carry the design:
 *
 *   1. **Six states, never a boolean.** `registered`, `available`, `selected`, `loaded`,
 *      `active` and `released` are six different facts. Collapsing them into "enabled" is
 *      how a UI promises that a skill is running when it is only known, or that it is
 *      loaded when it has merely been chosen.
 *   2. **The vocabulary is quoted, not re-declared.** Every word below comes from the
 *      vocabulary lock (`src/vocabulary.mjs`), which quotes the backend declaration and
 *      records that `ai.skill` has no contract-lock row yet (`XA-11`). There is no
 *      `frontend.skill.*` namespace and no seventh state.
 *   3. **Discovery never executes.** Listing, search, filter and detail read declarations.
 *      Nothing here selects, loads, releases or executes a skill, reaches a tool, a
 *      filesystem, a terminal or a model, and nothing grants a permission. Where the
 *      contract is unpublished the surface answers with the canonical unsupported state
 *      instead of inventing a fallback.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import, no backend
 * import. The declaration itself is handed over by the application (or by a test) — this
 * package never reads the backend tree.
 */
import { vocabularyOf } from './vocabulary.mjs';
import { compatibilityOf } from './versions.mjs';

/**
 * One quoted set, as data: where it was read from and which contract publishes it (null when
 * the declaration is unpublished, which is the state the lock records for the Skill file).
 */
function quotedSet(id) {
  const set = vocabularyOf(id);
  return Object.freeze({
    id,
    contract: set.provenance.contract,
    declaredIn: `${set.provenance.file}#${set.provenance.symbol ?? set.provenance.path}`,
    publicationPending: set.publicationPending ?? null,
  });
}

/** The contract this surface consumes. Declared by the backend, published by nobody yet. */
export const SKILL_CONTRACT_ID = 'ai.skill';

/**
 * The decision under which a difference between this package's quoted vocabulary and a
 * declaration handed over by the application is arbitrated. Recorded in the frontend
 * register (`docs/n8n-lego/decisions/cross-agent-decisions.json`); this package never
 * resolves one itself.
 */
export const SKILL_ALIGNMENT_DECISION = 'XA-19';

/** Where the quoted declaration lives and who owes the contract. Provenance, not a copy. */
export const SKILL_DECLARATION_SOURCE = Object.freeze({
  file: 'apps/n8n-lego/src/lego/manifest/ai-lego-set.json',
  path: 'lego#id=skill',
  owner: 'manager',
  contract: SKILL_CONTRACT_ID,
  decision: 'XA-11',
});

// The lock quotes the backend; the surface has no vocabulary of its own.
const LIFECYCLE_SET = vocabularyOf('skillLifecycle');
const OPERATION_SET = vocabularyOf('skillOperation');
const DISCLOSURE_SET = vocabularyOf('skillDisclosureLevel');
const PERMISSION_SET = vocabularyOf('skillPermission');
const STATUS_SET = vocabularyOf('aiLegoStatus');
const TRUST_SET = vocabularyOf('trustLevel');
const DEGRADATION_SET = vocabularyOf('degradation');

/** The six lifecycle states, quoted from the backend declaration. Never collapsed. */
export const SKILL_LIFECYCLE = LIFECYCLE_SET.values;

/** The declared operations. The UI may *name* them; it may not call them. */
export const SKILL_OPERATIONS = OPERATION_SET.values;

/** The disclosure levels: identity, card, procedure, deep knowledge. */
export const SKILL_DISCLOSURE_LEVELS = DISCLOSURE_SET.values;

/**
 * The permissions the declared operations require — requirements of a backend operation,
 * never a grant a skill holds and never a control a UI offers.
 */
export const SKILL_PERMISSIONS = PERMISSION_SET.values;

/** How mature the Skill LEGO is (`planned` today), quoted from the AI set's own vocabulary. */
export const SKILL_STATUSES = STATUS_SET.values;

/** The canonical degradation states, quoted: what a surface may report and do about it. */
export const SKILL_DEGRADATION_STATES = DEGRADATION_SET.values;

/** The canonical trust levels, quoted (`manifest/foundation.json#trust.levels`, `XA-9`). */
export const SKILL_TRUST_LEVELS = TRUST_SET.values;

/** Everything this surface quotes, so a reviewer can see there is no local vocabulary. */
export const SKILL_QUOTED_VOCABULARIES = Object.freeze([
  LIFECYCLE_SET.id,
  OPERATION_SET.id,
  DISCLOSURE_SET.id,
  PERMISSION_SET.id,
  STATUS_SET.id,
  TRUST_SET.id,
  DEGRADATION_SET.id,
]);

/**
 * The fields one Skill identity is rendered from. These are *presentation* field names —
 * what the UI shows and what it calls the row — not a second vocabulary about the backend.
 */
export const SKILL_IDENTITY_FIELDS = Object.freeze([
  'skillId',
  'title',
  'owner',
  'status',
  'lifecycle',
  'trust',
  'availability',
  'requiredCapabilities',
  'contractVersion',
  'compatibility',
  'degradation',
  'validation',
]);

/** Fields a quoted LEGO-level declaration may carry. Anything else is refused. */
export const SKILL_DECLARATION_FIELDS = Object.freeze([
  'id', 'title', 'owner', 'status', 'phase', 'mission', 'definition', 'scope', 'nonScope',
  'entities', 'contracts', 'lifecycle', 'disclosureLevels', 'disclosureRule', 'operations',
  'interaction', 'permissions', 'dependsOn', 'replacementBoundary', 'resourceProfile',
  'degradation', 'observability', 'versioning', 'versioningNote', 'futureStages', 'tests', 'index',
]);

/** Fields one Skill entry may carry. A skill carries no permission and no authority. */
export const SKILL_INSTANCE_FIELDS = Object.freeze([
  'skillId', 'title', 'owner', 'status', 'lifecycle', 'trust', 'contractVersion',
  'requiredCapabilities', 'degradation',
]);

/**
 * Keys that would turn a skill into something it is not. Each one is an entitlement claim:
 * a skill that carries a permission or a tool has stopped being procedural knowledge and
 * become a privilege. Refused by name, with the reason.
 */
export const SKILL_FORBIDDEN_FIELDS = Object.freeze({
  permissions: 'a skill operation requires a permission; a skill never holds one',
  grants: 'a skill grants nothing to anybody',
  authority: 'authority comes from a role or an approval, never from a procedure',
  tools: 'tool access belongs to a capability contract, never to a skill',
  filesystem: 'no filesystem access follows from a skill',
  terminal: 'no terminal access follows from a skill',
  model: 'no model inference follows from a skill',
  entry: 'a skill carries no code path; metadata that names an implementation is a capability',
  load: 'loading is a backend operation of ai.skill, not a field of a skill',
  execute: 'a skill describes and prepares knowledge; it does not run',
});

/**
 * What the UI must never imply about a skill. The list is the safety contract of this
 * module: each entry is a relationship a reader could otherwise infer from a skill card.
 */
export const SKILL_FORBIDDEN_IMPLICATIONS = Object.freeze([
  'permission',
  'authority',
  'tool-execution',
  'filesystem-access',
  'terminal-access',
  'model-inference',
]);

/** What discovery may do, and what is forbidden — with the reason for each refusal. */
export const SKILL_AFFORDANCES = Object.freeze({
  allowed: Object.freeze(['list', 'search', 'filter', 'detail']),
  forbidden: Object.freeze({
    select: 'selecting a skill is an operation of ai.skill; discovery never selects',
    load: 'loading a procedure needs a published contract and a context budget this surface does not own',
    release: 'releasing is a backend state change, not a UI action',
    execute: 'a skill never executes; it describes and prepares procedural knowledge',
    tools: 'tool access belongs to the capability contract behind the skill, not to the skill',
    filesystem: 'no filesystem access follows from a skill',
    terminal: 'no terminal access follows from a skill',
    inference: 'no model inference follows from a skill',
  }),
});

/** Raised for a declaration this surface refuses to render. */
export class SkillDeclarationError extends Error {
  constructor(message, { skillId = null, findings = [] } = {}) {
    super(message);
    this.name = 'SkillDeclarationError';
    this.code = 'frontend.skill.invalid-declaration';
    this.skillId = skillId;
    this.findings = Object.freeze([...(findings ?? [])]);
  }
}

const asArray = (value) => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);

/**
 * What one lifecycle state means *to the UI*.
 *
 * Six rows, one per declared state. Every row is explicit that the state is not an
 * execution state and that it grants nothing: `loaded` means material is in context,
 * `active` means the skill is in use — neither means that anything ran.
 */
export function skillState(state) {
  if (!SKILL_LIFECYCLE.includes(state)) {
    return Object.freeze({
      state,
      known: false,
      discoverable: false,
      loaded: false,
      active: false,
      executing: false,
      grants: null,
      detail: `"${state}" is not one of the six declared skill lifecycle states (${SKILL_LIFECYCLE.join(', ')})`,
    });
  }
  const table = {
    registered: { discoverable: true, loaded: false, active: false, detail: 'known to the registry; nothing is loaded and nothing is running' },
    available: { discoverable: true, loaded: false, active: false, detail: 'offered for selection; one step before selection, still nothing loaded' },
    selected: { discoverable: true, loaded: false, active: false, detail: 'chosen for the current task; selection is not loading' },
    loaded: { discoverable: true, loaded: true, active: false, detail: 'its material is in context; loading is not executing' },
    active: { discoverable: true, loaded: true, active: true, detail: 'in use by the current task; the skill itself still executes nothing' },
    released: { discoverable: true, loaded: false, active: false, detail: 'let go for this task; it returns to available and disappears from context' },
  }[state];
  return Object.freeze({ state, known: true, executing: false, grants: null, ...table });
}

/** Every lifecycle state with its rendering rule — the table above, as data. */
export function skillLifecycle() {
  return Object.freeze(SKILL_LIFECYCLE.map((state) => skillState(state)));
}

/**
 * The canonical unsupported answer for a surface that must respond about skills while no
 * Skill contract is published. A verdict, not an empty object: a state word, the error the
 * backend vocabulary names, the reason, and the decision that owes the contract.
 */
export function skillUnsupported(reason = 'no Skill contract is published', { declaredVersion = null } = {}) {
  return Object.freeze({
    state: 'capability-unavailable',
    error: 'lego.capability_unavailable',
    reason,
    decision: SKILL_DECLARATION_SOURCE.decision,
    contract: Object.freeze({ id: SKILL_CONTRACT_ID, version: null, declaredVersion, published: false }),
    detail: 'no fallback capability, no execution control and no tool access is rendered in this state',
  });
}

/** Validates a quoted LEGO-level declaration. Unknown fields are refused, not ignored. */
export function validateSkillDeclaration(declaration = {}) {
  const findings = [];
  if (declaration === null || typeof declaration !== 'object' || Array.isArray(declaration)) {
    return Object.freeze({ ok: false, findings: Object.freeze(['a declaration must be an object']) });
  }
  const known = new Set(SKILL_DECLARATION_FIELDS);
  for (const key of Object.keys(declaration)) {
    if (!known.has(key)) findings.push(`unknown field "${key}" (the declaration vocabulary is closed)`);
  }
  if (typeof declaration.id !== 'string' || declaration.id.length === 0) findings.push('"id" must name the declared unit');
  if (declaration.status !== undefined && !SKILL_STATUSES.includes(declaration.status)) {
    findings.push(`"status" must be one of ${SKILL_STATUSES.join(', ')}`);
  }
  for (const state of asArray(declaration.lifecycle)) {
    if (!SKILL_LIFECYCLE.includes(state)) findings.push(`unknown lifecycle state "${state}"`);
  }
  for (const operation of asArray(declaration.operations)) {
    if (!SKILL_OPERATIONS.includes(operation)) findings.push(`unknown operation "${operation}"`);
  }
  for (const permission of asArray(declaration.permissions)) {
    if (!SKILL_PERMISSIONS.includes(permission)) {
      findings.push(`unknown permission "${permission}" — the surface renders the declared permission words and coins none`);
    }
  }
  for (const state of asArray(declaration.degradation)) {
    if (!SKILL_DEGRADATION_STATES.includes(state)) findings.push(`unknown degradation state "${state}"`);
  }
  if (declaration.disclosureLevels !== undefined) {
    const levels = Object.keys(declaration.disclosureLevels ?? {});
    for (const level of levels) {
      if (!SKILL_DISCLOSURE_LEVELS.includes(level)) findings.push(`unknown disclosure level "${level}"`);
    }
  }
  const contracts = asArray(declaration.contracts);
  if (contracts.length > 0 && !contracts.includes(SKILL_CONTRACT_ID)) {
    findings.push(`"contracts" must name ${SKILL_CONTRACT_ID} when it names any contract`);
  }
  return Object.freeze({ ok: findings.length === 0, findings: Object.freeze(findings) });
}

/** Validates one Skill entry. A skill carries no permission, no tool and no authority. */
export function validateSkillInstance(instance = {}) {
  const findings = [];
  if (instance === null || typeof instance !== 'object' || Array.isArray(instance)) {
    return Object.freeze({ ok: false, findings: Object.freeze(['a skill entry must be an object']), skillId: null });
  }
  const skillId = instance.skillId ?? null;
  const known = new Set(SKILL_INSTANCE_FIELDS);
  for (const key of Object.keys(instance)) {
    if (key in SKILL_FORBIDDEN_FIELDS) {
      findings.push(`"${key}" is refused by name: ${SKILL_FORBIDDEN_FIELDS[key]}`);
      continue;
    }
    if (!known.has(key)) findings.push(`unknown field "${key}" (a skill carries the declared identity fields only)`);
  }
  if (typeof instance.skillId !== 'string' || instance.skillId.length === 0) findings.push('"skillId" must name the skill');
  if (instance.status !== undefined && !SKILL_STATUSES.includes(instance.status)) {
    findings.push(`"status" must be one of ${SKILL_STATUSES.join(', ')}`);
  }
  for (const state of asArray(instance.lifecycle)) {
    if (!SKILL_LIFECYCLE.includes(state)) findings.push(`unknown lifecycle state "${state}"`);
  }
  for (const state of asArray(instance.degradation)) {
    if (!SKILL_DEGRADATION_STATES.includes(state)) findings.push(`unknown degradation state "${state}"`);
  }
  for (const capability of asArray(instance.requiredCapabilities)) {
    if (typeof capability !== 'string' || !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/.test(capability)) {
      findings.push(`required capability "${capability}" must be a capability id (<domain>.<name>)`);
    }
  }
  if (instance.trust !== undefined && instance.trust !== null && !SKILL_TRUST_LEVELS.includes(instance.trust)) {
    findings.push(`unknown trust level "${instance.trust}" — the quoted set is ${SKILL_TRUST_LEVELS.join(', ')}`);
  }
  if (instance.contractVersion !== undefined && instance.contractVersion !== null
    && !/^\d+\.\d+\.\d+$/.test(instance.contractVersion)) {
    findings.push('"contractVersion" must be MAJOR.MINOR.PATCH when it is published');
  }
  return Object.freeze({ ok: findings.length === 0, findings: Object.freeze(findings), skillId });
}

/**
 * A version *claim*, read from the declaration's own `versioning` field.
 *
 * The field carries either the honest word `publicationPending` or a claim of the form
 * `<contract-id>@<major>.<minor>.<patch>`. A claim is a declaration, not a publication: it is
 * reported as `declaredVersion` and it never makes the contract comparable, because a consumer
 * binds to a contract-lock row and not to a string in a manifest. Reporting the claim matters
 * anyway — a frontend that showed nothing would hide the difference, and one that showed the
 * version as published would promise a contract nobody locked.
 */
export function declaredVersionOf(versioning) {
  if (typeof versioning !== 'string') return null;
  const match = /^(?<contract>[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*)@(?<version>\d+\.\d+\.\d+)$/.exec(versioning.trim());
  if (match === null) return null;
  return Object.freeze({ contract: match.groups.contract, version: match.groups.version });
}

/** A published contract row, or the honest record of one that does not exist yet. */
function contractStateOf(contract, surface, declaration) {
  const claim = declaredVersionOf(declaration?.versioning);
  if (contract !== null && contract !== undefined) {
    const version = typeof contract.version === 'string' ? contract.version : null;
    return Object.freeze({
      id: contract.id ?? SKILL_CONTRACT_ID,
      version,
      declaredVersion: claim?.version ?? null,
      owner: contract.owner ?? 'unknown',
      published: true,
      status: 'published',
      decision: null,
      detail: `published by ${contract.owner ?? 'an unnamed owner'}${version === null ? ' without a version' : ` at ${version}`}`,
      /** A row without a version cannot be compared, and an uncomparable contract is reported as such. */
      comparable: version !== null,
    });
  }
  const pending = surface?.publicationPending ?? null;
  const claimDetail = claim === null
    ? null
    : `the declaration claims ${claim.contract}@${claim.version}, but a version claim is not a published contract: the lock still has no ${claim.contract} row`;
  return Object.freeze({
    id: surface?.contract ?? claim?.contract ?? SKILL_CONTRACT_ID,
    version: null,
    declaredVersion: claim?.version ?? null,
    owner: pending?.owner ?? SKILL_DECLARATION_SOURCE.owner,
    published: false,
    // `publicationPending` when the file says so, `declared-not-locked` when the file claims a
    // version nobody published. Two different facts, never one.
    status: claim === null ? (declaration?.versioning ?? 'publicationPending') : 'declared-not-locked',
    decision: pending?.decision ?? SKILL_DECLARATION_SOURCE.decision,
    detail: claimDetail ?? pending?.what ?? declaration?.versioningNote ?? 'no Skill contract is published; the contract lock has no ai.skill row',
    comparable: false,
  });
}

/**
 * What a skill entry may report, in canonical degradation words. Most specific first:
 * what an entry or its capability map already knows, then the contract, then the version.
 */
function availabilityOf({ entry, contractState, declaration, requiredVersion, declaredCapabilities, unavailableCapabilities, migrations }) {
  /**
   * The compatibility verdict, as its own record: what a consumer required, what was offered,
   * whether the two could be compared at all, and whether the requirement is met. A state word
   * alone would make "we did not check" and "the check passed" look the same.
   */
  const uncomparable = (detail) => Object.freeze({
    state: 'uncomparable', required: requiredVersion ?? null, offered: null, satisfied: false, detail,
  });
  if (!contractState.published) {
    return Object.freeze({
      availability: 'capability-unavailable',
      detail: contractState.detail,
      compatibility: uncomparable(contractState.detail),
    });
  }
  if (!contractState.comparable) {
    return Object.freeze({
      availability: 'feature-unsupported',
      detail: 'the published contract carries no version, so no claim of compatibility is made',
      compatibility: uncomparable('the published contract carries no version'),
    });
  }
  if (requiredVersion === null || requiredVersion === undefined) {
    const compatibility = Object.freeze({
      state: 'not-required', required: null, offered: contractState.version, satisfied: true,
      detail: `no version is required by this consumer; the published contract is ${contractState.version}`,
    });
    return availabilityFromCapabilities({ entry, declaredCapabilities, unavailableCapabilities, compatibility });
  }
  const verdict = compatibilityOf(requiredVersion, contractState.version, { migrations });
  const compatibility = Object.freeze({
    state: verdict.comparable ? verdict.kind : 'uncomparable',
    required: requiredVersion,
    offered: contractState.version,
    satisfied: verdict.comparable ? verdict.satisfied : false,
    detail: verdict.detail,
  });
  if (!verdict.comparable) {
    return Object.freeze({ availability: 'feature-unsupported', detail: `required ${requiredVersion} is not comparable with the published ${contractState.version}`, compatibility });
  }
  if (verdict.kind === 'migration-required') {
    return Object.freeze({ availability: 'migration-required', detail: verdict.detail, compatibility });
  }
  if (!verdict.satisfied) {
    return Object.freeze({ availability: 'version-incompatible', detail: verdict.detail, compatibility });
  }
  return availabilityFromCapabilities({ entry, declaredCapabilities, unavailableCapabilities, compatibility });
}

/**
 * The capability half of availability, carrying the compatibility verdict with it. A missing
 * requirement degrades the skill; a requirement declared but not serviceable here disables it;
 * neither is silently satisfied and neither substitutes a capability.
 */
function availabilityFromCapabilities({ entry, declaredCapabilities, unavailableCapabilities, compatibility }) {
  const required = asArray(entry?.requiredCapabilities);
  const missing = required.find((capability) => !declaredCapabilities.includes(capability));
  if (missing !== undefined) {
    return Object.freeze({ availability: 'capability-unavailable', detail: `required capability "${missing}" is not declared by this frontend`, compatibility });
  }
  const disabled = required.find((capability) => unavailableCapabilities.includes(capability));
  if (disabled !== undefined) {
    return Object.freeze({ availability: 'dependency-disabled', detail: `required capability "${disabled}" is declared but not serviceable here`, compatibility });
  }
  return Object.freeze({ availability: 'available', detail: 'discovery may show it; nothing is loaded by showing it', compatibility });
}

/**
 * The vocabulary-bearing fields of a declaration, and the quoted set each one is compared
 * with. A field that is not listed here is not a vocabulary, and is validated instead.
 */
const DRIFT_FIELDS = Object.freeze([
  Object.freeze({ field: 'lifecycle', set: 'skillLifecycle' }),
  Object.freeze({ field: 'operations', set: 'skillOperation' }),
  Object.freeze({ field: 'permissions', set: 'skillPermission' }),
  Object.freeze({ field: 'disclosureLevels', set: 'skillDisclosureLevel', read: 'keys' }),
  Object.freeze({ field: 'trustLevels', set: 'trustLevel' }),
]);

const driftOf = (field, quoted, declared) => {
  const added = declared.filter((value) => !quoted.includes(value));
  const removed = quoted.filter((value) => !declared.includes(value));
  if (added.length === 0 && removed.length === 0) return null;
  return Object.freeze({ field, quoted: Object.freeze([...quoted]), declared: Object.freeze([...declared]), added: Object.freeze(added), removed: Object.freeze(removed) });
};

/**
 * Compares a declaration handed over by the application with the vocabulary this package
 * quotes, and reports the difference instead of resolving it.
 *
 * The frontend may not adopt a word the backend has not published *and* it may not pretend
 * the word is not there: a backend that moves first is the normal case (agent-2 owns the
 * declaration), and the honest rendering of "my quote is behind the file I was handed" is a
 * named difference with an owner and the decision that reconciles it. The route back is a
 * reconciliation, not a synonym.
 *
 * `in-sync` — every vocabulary field agrees. `drift` — at least one differs; the differences
 * name both spellings. `not-declared` — nothing was handed over, so nothing can be compared.
 * `uncomparable` names the fields this package cannot compare (a quoted contract without a
 * version), so silence is never mistaken for agreement.
 *
 * @param {{ declaration?: object|null, surface?: object|null, contract?: object|null }} input
 *   the handed-over declaration, this package's surface declaration, and the published
 *   contract row when one exists (its `version` is what the quote is compared against).
 */
export function declarationDrift({ declaration = null, surface = null, contract = null } = {}) {
  const owner = declaration?.owner ?? surface?.declarationSource?.owner ?? SKILL_DECLARATION_SOURCE.owner;
  const decision = surface?.publicationPending?.decision ?? SKILL_DECLARATION_SOURCE.decision;
  const alignmentDecision = surface?.alignment?.decision ?? SKILL_ALIGNMENT_DECISION;
  const rule = 'A difference is reported and registered, never resolved locally: the surface keeps rendering the words it quotes, names the words it was handed, and the reconciliation decides which set is canonical.';
  // What this package quotes for the version: the published row when there is one, and the
  // documented `publicationPending` otherwise. `null` means the quote cannot be compared —
  // which is reported as uncomparable rather than as agreement.
  const quotedVersioning = contract === null
    ? 'publicationPending'
    : typeof contract.version === 'string' ? contract.version : null;
  if (declaration === null || declaration === undefined) {
    return Object.freeze({ state: 'not-declared', differences: Object.freeze([]), uncomparable: Object.freeze(quotedVersioning === null ? ['versioning'] : []), owner, decision, alignmentDecision, rule });
  }
  const differences = [];
  for (const { field, set, read } of DRIFT_FIELDS) {
    const quoted = vocabularyOf(set).values;
    const raw = declaration[field];
    // Absence is not a move: a declaration that does not carry the field at all says nothing
    // about the vocabulary, and reporting that as drift would train a reader to ignore it.
    if (raw === undefined) continue;
    const declared = raw === null ? [] : read === 'keys' ? Object.keys(raw) : asArray(raw);
    const difference = driftOf(field, quoted, declared);
    if (difference !== null) differences.push(difference);
  }
  // The version claim: the file may carry `ai.skill@1.0.0` while this package quotes a
  // declaration nobody published (or the other way round: a locked version against a file
  // that has fallen back to `publicationPending`).
  const uncomparable = [];
  if (quotedVersioning === null) {
    uncomparable.push('versioning');
  } else if (typeof declaration.versioning === 'string' && declaration.versioning.trim() !== quotedVersioning) {
    differences.push(Object.freeze({
      field: 'versioning',
      quoted: Object.freeze([quotedVersioning]),
      declared: Object.freeze([declaration.versioning]),
      added: Object.freeze([declaration.versioning]),
      removed: Object.freeze([quotedVersioning]),
    }));
  }
  return Object.freeze({
    state: differences.length === 0 ? 'in-sync' : 'drift',
    differences: Object.freeze(differences),
    uncomparable: Object.freeze(uncomparable),
    owner,
    decision,
    alignmentDecision,
    rule,
  });
}

/**
 * Builds the catalog the UI renders. Discovery only: nothing here selects, loads or
 * executes, and every entry's availability is a canonical degradation word.
 *
 * @param {{
 *   surface?: object|null,               the frontend's Skill surface declaration (manifest/skills.json)
 *   declaration?: object|null,           the quoted backend Skill declaration, handed over by the application
 *   contract?: { id?: string, version?: string|null, owner?: string }|null,  a published contract row, if one exists
 *   skills?: Array<object>|null,         skill entries (defaults to the ones the surface declares)
 *   requiredVersion?: string|null,       the version this consumer needs, when it has one
 *   declaredCapabilities?: string[],     capability ids this frontend declares
 *   unavailableCapabilities?: string[],  capability ids declared but known not to serve here
 *   migrations?: string[],                versions a declared migration can move between
 * }} input
 */
export function createSkillCatalog({
  surface = null,
  declaration = null,
  contract = null,
  skills = null,
  requiredVersion = null,
  declaredCapabilities = [],
  unavailableCapabilities = [],
  migrations = [],
} = {}) {
  const declarationValidation = declaration === null
    ? Object.freeze({ ok: true, findings: Object.freeze([]) })
    : validateSkillDeclaration(declaration);
  const contractState = contractStateOf(contract, surface, declaration);
  const entries = (skills ?? surface?.skills ?? []).map((instance) => {
    const validation = validateSkillInstance(instance);
    const { availability, detail, compatibility } = availabilityOf({
      entry: instance,
      contractState,
      declaration,
      requiredVersion,
      declaredCapabilities,
      unavailableCapabilities,
      migrations,
    });
    const withheld = [];
    const value = (field) => {
      if (instance[field] === undefined || instance[field] === null) {
        withheld.push(field);
        return null;
      }
      return instance[field];
    };
    const lifecycle = asArray(instance.lifecycle ?? declaration?.lifecycle);
    return Object.freeze({
      skillId: instance.skillId ?? null,
      title: value('title') ?? instance.skillId ?? null,
      owner: value('owner') ?? declaration?.owner ?? null,
      status: value('status') ?? declaration?.status ?? null,
      lifecycle: Object.freeze(lifecycle),
      trust: value('trust'),
      availability,
      availabilityDetail: detail,
      compatibility,
      requiredCapabilities: instance.requiredCapabilities === undefined ? null : Object.freeze(asArray(instance.requiredCapabilities)),
      contractVersion: contractState.version,
      degradation: Object.freeze(asArray(instance.degradation ?? declaration?.degradation)),
      validation,
      /** The identity fields the declaration does not carry. Rendered as "not published", never guessed. */
      withheld: Object.freeze([...new Set(withheld)]),
      /** One row per declared state — the six facts, never a boolean. */
      states: Object.freeze(lifecycle.map(skillState)),
    });
  });

  const surfaceAvailability = contractState.published
    ? Object.freeze({ availability: 'available', detail: 'the contract is published; discovery may list skills' })
    : Object.freeze({ availability: 'optional-absent', detail: `${contractState.detail} — an empty skill list is not an error` });

  const drift = declarationDrift({ declaration, surface, contract });
  return Object.freeze({
    contract: contractState,
    availability: surfaceAvailability.availability,
    availabilityDetail: surfaceAvailability.detail,
    unsupported: contractState.published ? null : skillUnsupported(contractState.detail, { declaredVersion: contractState.declaredVersion }),
    /** Quoted declaration vs handed-over declaration: named differences, never resolved here. */
    drift,
    discovery: Object.freeze({
      listing: true,
      search: true,
      filter: true,
      detail: true,
      select: false,
      load: false,
      execute: false,
      tools: false,
    }),
    declaration,
    declarationSource: SKILL_DECLARATION_SOURCE,
    declarationValidation,
    quote: Object.freeze(SKILL_QUOTED_VOCABULARIES.map(quotedSet)),
    lifecycle: skillLifecycle(),
    entries: Object.freeze(entries),
    affordances: SKILL_AFFORDANCES,
    rule: 'Discovery reads declarations. It never selects, loads, releases or executes a skill, and no skill carries a permission, an authority or a tool.',
  });
}

/** Search and filter over the catalog. Pure data: no lookup reaches a backend. */
export function searchSkills(catalog, {
  query = '',
  lifecycle = null,
  availability = null,
  owner = null,
  status = null,
  capability = null,
  validOnly = false,
} = {}) {
  const needle = String(query ?? '').trim().toLowerCase();
  return Object.freeze((catalog?.entries ?? []).filter((entry) => {
    if (needle.length > 0 && !`${entry.skillId} ${entry.title} ${entry.owner ?? ''}`.toLowerCase().includes(needle)) return false;
    if (lifecycle !== null && !entry.lifecycle.includes(lifecycle)) return false;
    if (availability !== null && entry.availability !== availability) return false;
    if (owner !== null && entry.owner !== owner) return false;
    if (status !== null && entry.status !== status) return false;
    if (capability !== null && !(entry.requiredCapabilities ?? []).includes(capability)) return false;
    if (validOnly && !entry.validation.ok) return false;
    return true;
  }));
}

/**
 * Progressive disclosure for one skill: `basic` is name, status and availability; `advanced`
 * adds lifecycle, required capabilities, contract version, trust, degradation, owner and the
 * fields the declaration does not carry. A skill that is not declared — or a request made
 * while no contract is published — is answered with the canonical unsupported state rather
 * than an empty object a caller could mistake for a skill.
 */
export function skillDetail(catalog, skillId, { level = 'basic' } = {}) {
  if (catalog?.unsupported) {
    return Object.freeze({ ...catalog.unsupported, level, skillId, known: false });
  }
  const entry = (catalog?.entries ?? []).find((candidate) => candidate.skillId === skillId) ?? null;
  if (entry === null) {
    return Object.freeze({ ...skillUnsupported(`no declared skill "${skillId}"`), level, skillId, known: false });
  }
  const basic = Object.freeze({
    level: 'basic',
    known: true,
    skillId: entry.skillId,
    title: entry.title,
    status: entry.status,
    availability: entry.availability,
  });
  if (level !== 'advanced') return basic;
  return Object.freeze({
    ...basic,
    level: 'advanced',
    owner: entry.owner,
    lifecycle: entry.lifecycle,
    contractVersion: entry.contractVersion,
    trust: entry.trust,
    degradation: entry.degradation,
    requiredCapabilities: entry.requiredCapabilities,
    compatibility: entry.compatibility,
    availabilityDetail: entry.availabilityDetail,
    validation: entry.validation,
    withheld: entry.withheld,
    /** Even at the deepest level every declared operation is offered by nobody here. */
    operations: Object.freeze(SKILL_OPERATIONS.map((operation) => Object.freeze({ operation, offered: false }))),
  });
}

/** The surface as data: what it may do, over which quoted words, and with which provenance. */
export function describeSkills() {
  return Object.freeze({
    lifecycle: SKILL_LIFECYCLE,
    operations: SKILL_OPERATIONS,
    permissions: SKILL_PERMISSIONS,
    disclosureLevels: SKILL_DISCLOSURE_LEVELS,
    statuses: SKILL_STATUSES,
    trustLevels: SKILL_TRUST_LEVELS,
    degradation: SKILL_DEGRADATION_STATES,
    identityFields: SKILL_IDENTITY_FIELDS,
    forbiddenFields: SKILL_FORBIDDEN_FIELDS,
    forbiddenImplications: SKILL_FORBIDDEN_IMPLICATIONS,
    affordances: SKILL_AFFORDANCES,
    driftFields: Object.freeze(DRIFT_FIELDS.map((entry) => entry.field)),
    source: SKILL_DECLARATION_SOURCE,
    quoted: SKILL_QUOTED_VOCABULARIES,
    rule: 'A skill is procedural knowledge. It never implies a permission, an authority, a tool, a filesystem, a terminal or a model, and discovery never loads or executes one.',
  });
}
