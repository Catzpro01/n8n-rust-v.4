/**
 * The seam — what the frontend is allowed to consume, and the one identity shape
 * it projects a capability into.
 *
 * The frontend and the backend LEGO are separate owners that must be replaceable
 * independently, so the *only* things that may cross between them are declarations:
 * an id, a version, an operation list, permissions, a lifecycle state, an
 * availability answer, a degradation state, an interaction class, a transport
 * binding, an error code, the locale set and boundary telemetry. This module makes
 * that list closed and explicit:
 *
 *   1. An input that is not declared here is **refused by name**, never guessed
 *      (`consumeInput` → `frontend.seam.unknown-input`).
 *   2. A declaration may be consumed from the sources declared for it — a manifest,
 *      an advertisement, the compatibility layer — and from nothing else. An
 *      implementation file, a route table, a port or a credential store is refused
 *      even for an input that exists (`frontend.seam.forbidden-source`).
 *   3. Both sides project a capability into the **same sixteen fields**
 *      (`CAPABILITY_IDENTITY_FIELDS`). A field nobody declared is `null`, not absent
 *      and not inherited; a capability the caller was not granted is not described at
 *      all. There is no second identity shape.
 *
 * Nothing here reads disk, executes anything or knows a transport: it is data plus
 * three pure functions, so a reviewer (or a test) can ask "may the frontend consume
 * this, and from where?" without reading either implementation.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */
import { CAPABILITY_ORIGINS } from './negotiation.mjs';
import { normaliseCapabilityId, vocabularyOf } from './vocabulary.mjs';

/** Where a declaration may legitimately come from. */
export const SEAM_SOURCES = Object.freeze([
  Object.freeze({ id: 'manifest', meaning: 'a catalog shipped with a LEGO (`manifest/*.json`)' }),
  Object.freeze({ id: 'declaration', meaning: 'a capability, unit or runtime declaration made at registration' }),
  Object.freeze({ id: 'advertisement', meaning: 'what an instance advertises about itself (status, lifecycle, version)' }),
  Object.freeze({ id: 'compatibility-layer', meaning: 'the `compatibility` domain: the 501 feature map and the error taxonomy' }),
  Object.freeze({ id: 'boot-payload', meaning: 'the versioned descriptor the UI was booted with' }),
  Object.freeze({ id: 'observability', meaning: 'boundary events emitted by this LEGO (payload-free)' }),
  Object.freeze({ id: 'locale-registry', meaning: 'the authoritative locale set and its direction metadata' }),
]);

/** Where a declaration may *never* be read from, and why. */
export const SEAM_FORBIDDEN = Object.freeze([
  Object.freeze({ id: 'implementation-file', why: 'reading a backend module makes the two sides inseparable and version-locked' }),
  Object.freeze({ id: 'module-path', why: 'a path is not a contract; the module behind it may be replaced' }),
  Object.freeze({ id: 'route-table', why: 'an endpoint is an implementation detail — the frontend negotiates operations, not URLs' }),
  Object.freeze({ id: 'port', why: 'a listening port is transport, and the frontend may not assume a transport' }),
  Object.freeze({ id: 'credential-store', why: 'credential material is not a declaration; the frontend holds none of it' }),
  Object.freeze({ id: 'model-output', why: 'a provider answer is content, not a contract — it belongs to a capability, not to the seam' }),
  Object.freeze({ id: 'screen', why: 'never infer a capability from rendered text: the UI is a consumer, not a source' }),
]);

/**
 * The closed input list. `sources` is exhaustive: an input consumed from a source it
 * does not declare is refused. `vocabulary` names the lock entry that fixes the words
 * the input uses, so a value can be checked instead of trusted.
 */
export const SEAM_INPUTS = Object.freeze([
  Object.freeze({
    id: 'capability-id',
    question: 'Which capability is this about?',
    sources: Object.freeze(['manifest', 'declaration', 'advertisement']),
    vocabulary: null,
    contract: Object.freeze({ id: 'lego.domain-registry', owner: 'manager' }),
    use: 'identify a capability — never as a lookup key into a module',
  }),
  Object.freeze({
    id: 'capability-status',
    question: 'How far has it been implemented?',
    sources: Object.freeze(['manifest', 'declaration', 'advertisement']),
    vocabulary: 'capabilityStatus',
    contract: Object.freeze({ id: 'lego.domain-registry', owner: 'manager' }),
    use: 'render an instance-backed capability state',
  }),
  Object.freeze({
    id: 'version',
    question: 'Which version is declared, and is it the one required?',
    sources: Object.freeze(['manifest', 'declaration', 'advertisement']),
    vocabulary: 'changeKind',
    contract: Object.freeze({ id: 'lego.contract-compat', owner: 'manager' }),
    use: 'classify a version move; the frontend never invents a compatibility rule',
  }),
  Object.freeze({
    id: 'operations',
    question: 'Which named operations does the provider publish?',
    sources: Object.freeze(['manifest', 'declaration', 'advertisement']),
    vocabulary: 'operationOutcome',
    contract: null,
    use: 'negotiate an operation; until a provider publishes a list, an operation is unpublished and fails closed',
  }),
  Object.freeze({
    id: 'permissions',
    question: 'What must a caller be allowed to do before it asks?',
    sources: Object.freeze(['manifest', 'declaration', 'advertisement']),
    vocabulary: null,
    contract: null,
    use: 'report required permissions as names — never credential material of any kind',
  }),
  Object.freeze({
    id: 'lifecycle',
    question: 'Which lifecycle state is the LEGO or capability in?',
    sources: Object.freeze(['manifest', 'declaration', 'advertisement']),
    vocabulary: 'lifecycle',
    contract: Object.freeze({ id: 'lego.negotiation', owner: 'agent-2' }),
    use: 'decide whether something could run at all',
  }),
  Object.freeze({
    id: 'availability',
    question: 'May this capability serve a caller here?',
    sources: Object.freeze(['declaration', 'advertisement', 'compatibility-layer']),
    vocabulary: 'degradation',
    contract: Object.freeze({ id: 'lego.interaction', owner: 'agent-2' }),
    use: 'answer with a canonical degradation state and the declared action',
  }),
  Object.freeze({
    id: 'degradation',
    question: 'And what must the consumer do instead?',
    sources: Object.freeze(['declaration', 'compatibility-layer']),
    vocabulary: 'degradation',
    contract: Object.freeze({ id: 'lego.interaction', owner: 'agent-2' }),
    use: 'render the declared fallback verbatim; a fallback nobody declared is not invented',
  }),
  Object.freeze({
    id: 'interaction-class',
    question: 'What kind of operation is this — call, event, stream or batch?',
    sources: Object.freeze(['manifest', 'declaration']),
    vocabulary: 'interaction',
    contract: Object.freeze({ id: 'lego.interaction', owner: 'agent-2' }),
    use: 'choose a transport that can carry the class',
  }),
  Object.freeze({
    id: 'transport-capability',
    question: 'Which bindings may carry that class on this host?',
    sources: Object.freeze(['manifest', 'boot-payload']),
    vocabulary: 'transportTarget',
    contract: null,
    use: 'rank capable transports; transport internals never reach a business contract',
  }),
  Object.freeze({
    id: 'error-code',
    question: 'What does this failure mean, identity-wise?',
    sources: Object.freeze(['compatibility-layer', 'manifest']),
    vocabulary: null,
    contract: Object.freeze({ id: 'lego.error-contract', owner: 'manager' }),
    use: 'map a stable code to presentation; the sentence is never the identity',
  }),
  Object.freeze({
    id: 'locale-set',
    question: 'Which locales and directions exist?',
    sources: Object.freeze(['locale-registry']),
    vocabulary: null,
    contract: Object.freeze({ id: 'localization.contract', owner: 'agent-9' }),
    use: 'render direction and pick a fallback locale; dictionaries stay outside this LEGO',
  }),
  Object.freeze({
    id: 'observability-metadata',
    question: 'What boundary facts may the browser hold?',
    sources: Object.freeze(['observability']),
    vocabulary: null,
    contract: Object.freeze({ id: 'frontend.contract', owner: 'agent-1' }),
    use: 'emit and buffer boundary events — bounded, payload-free, never a transcript',
  }),
]);

const SOURCE_BY_ID = new Map(SEAM_SOURCES.map((source) => [source.id, source]));
const INPUT_BY_ID = new Map(SEAM_INPUTS.map((input) => [input.id, input]));
const FORBIDDEN_BY_ID = new Map(SEAM_FORBIDDEN.map((entry) => [entry.id, entry]));

export class SeamError extends Error {
  constructor(message, { code = 'frontend.seam.refused', input = null, source = null } = {}) {
    super(message);
    this.name = 'SeamError';
    this.code = code;
    this.input = input;
    this.source = source;
  }
}

/**
 * The sixteen fields a capability identity has, whichever side declares it.
 * `null` means "nobody declared it" — never "inherit it from somewhere else".
 */
export const CAPABILITY_IDENTITY_FIELDS = Object.freeze([
  'id',
  'lego',
  'owner',
  'contractVersion',
  'operations',
  'permissions',
  'lifecycle',
  'status',
  'availability',
  'criticality',
  'trust',
  'interaction',
  'migration',
  'degradation',
  'surfaces',
  'requirements',
]);

/** Where an identity came from. Provenance is recorded *next to* the identity, not inside it. */
export const IDENTITY_PROVENANCE_FIELDS = Object.freeze(['origin']);

/**
 * May the frontend consume this input, from this source?
 *
 * Fail-closed in three steps: an undeclared input is refused, a source that may never
 * be read is refused, and a declared input from a source it does not declare is refused.
 *
 * @returns {{ input: string, source: string, allowed: boolean, reason: string, vocabulary: string|null }}
 */
export function consumeInput({ input, source } = {}) {
  const answer = (allowed, reason) => Object.freeze({
    input: input ?? null,
    source: source ?? null,
    allowed,
    reason,
    vocabulary: INPUT_BY_ID.get(input)?.vocabulary ?? null,
  });

  const declared = INPUT_BY_ID.get(input);
  if (!declared) {
    const forbidden = FORBIDDEN_BY_ID.get(input);
    return answer(false, forbidden
      ? `"${input}" may never be consumed: ${forbidden.why}`
      : `"${input}" is not a declared seam input — an undeclared input is refused, not guessed`);
  }
  const forbidden = FORBIDDEN_BY_ID.get(source);
  if (forbidden) return answer(false, `"${input}" may not be consumed from "${source}": ${forbidden.why}`);
  if (!SOURCE_BY_ID.has(source)) return answer(false, `"${source}" is not a declared seam source`);
  if (!declared.sources.includes(source)) {
    return answer(false, `"${input}" is declared, but not from "${source}" (declared sources: ${declared.sources.join(', ')})`);
  }
  return answer(true, `"${input}" is consumed from "${source}", in the words of ${declared.vocabulary ?? 'its own contract'}`);
}

/** The same check, as a refusal. Used where a caller must not continue. */
export function requireInput({ input, source } = {}) {
  const verdict = consumeInput({ input, source });
  if (!verdict.allowed) {
    throw new SeamError(verdict.reason, {
      code: FORBIDDEN_BY_ID.has(input) || FORBIDDEN_BY_ID.has(source) ? 'frontend.seam.forbidden-source' : 'frontend.seam.unknown-input',
      input: input ?? null,
      source: source ?? null,
    });
  }
  return verdict;
}

const listOf = (value) => {
  if (value === undefined || value === null) return null;
  const items = Array.isArray(value) ? value : [value];
  const cleaned = [...new Set(items.filter((item) => typeof item === 'string' && item.length > 0))].sort();
  return cleaned.length > 0 ? Object.freeze(cleaned) : null;
};

/**
 * Projects a capability — declared by the frontend, advertised by an instance or
 * registered at runtime — into the one identity shape.
 *
 * Deliberately total and boring: every field is either declared by the source or
 * `null`. Nothing is inferred from a neighbour, and `availability` is only filled when
 * the caller passed a negotiated answer, because availability is a verdict, not a
 * property of a declaration.
 *
 * @param {object} entry the declaration (either side)
 * @param {{ origin?: string, support?: object|null }} context
 */
export function capabilityIdentity(entry = {}, { origin = null, support = null } = {}) {
  const raw = entry.id ?? null;
  let id = null;
  try {
    // Normalisation is declared and narrow (trim + lowercase); anything else is refused.
    id = normaliseCapabilityId(raw);
  } catch (error) {
    throw new SeamError(`"${raw}" is not a capability id (expected <domain>.<name> in lower kebab case)`, { code: 'frontend.seam.invalid-capability-id', input: raw });
  }
  if (origin !== null && !CAPABILITY_ORIGINS.includes(origin)) {
    throw new SeamError(`"${origin}" is not a declared capability origin (one of ${CAPABILITY_ORIGINS.join(', ')})`, { code: 'frontend.seam.unknown-origin', input: raw });
  }

  const operations = listOf(entry.operations);
  const interactions = entry.interactions && typeof entry.interactions === 'object' ? entry.interactions : {};
  const identity = {
    id,
    lego: entry.lego ?? null,
    owner: entry.owner ?? null,
    // Declared or nothing: the frontend never invents a version, and a catalog that
    // names several contracts does not get one picked for it.
    contractVersion: entry.contractVersion ?? entry.version ?? null,
    operations,
    permissions: listOf(entry.permissions),
    lifecycle: entry.lifecycle ?? null,
    status: entry.status ?? null,
    availability: support ? Object.freeze({
      state: support.state ?? null,
      usable: support.usable ?? null,
      source: support.source ?? null,
    }) : null,
    criticality: entry.criticality ?? null,
    trust: entry.trust ?? null,
    interaction: Object.freeze({ ...interactions }),
    migration: entry.migration ?? null,
    degradation: entry.degradation ?? null,
    surfaces: listOf(entry.surfaces),
    requirements: entry.requirements ? Object.freeze({ ...entry.requirements }) : null,
  };
  return Object.freeze({ ...identity, origin });
}

/** The seam as data (docs, `.ai/` cards, tests, conformance). */
export function describeSeam() {
  return Object.freeze({
    sources: SEAM_SOURCES,
    inputs: SEAM_INPUTS,
    forbidden: SEAM_FORBIDDEN,
    identityFields: CAPABILITY_IDENTITY_FIELDS,
    provenanceFields: IDENTITY_PROVENANCE_FIELDS,
    origins: CAPABILITY_ORIGINS,
    vocabulary: Object.freeze({
      degradation: vocabularyOf('degradation').values,
      lifecycle: vocabularyOf('lifecycle').values,
      interaction: vocabularyOf('interaction').values,
    }),
    rules: Object.freeze([
      'The frontend consumes declared inputs only: an id, a version, an operation list, permissions, a lifecycle state, an availability answer, a degradation state, an interaction class, a transport binding, an error code, the locale set or boundary telemetry.',
      'Never from an implementation file, a module path, a route table, a port or a credential store — the seam is a contract, not a filesystem.',
      'An input the seam does not declare is refused by name; a value outside its declared vocabulary is refused too.',
      'Both sides project the same sixteen-field identity: an undeclared field is null, and a capability the caller was not granted is not described at all.',
    ]),
  });
}
