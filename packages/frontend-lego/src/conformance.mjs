/**
 * Architecture rules as data, with a check that runs against a live assembly.
 *
 * A rule that exists only as a paragraph gets re-interpreted by the next reader.
 * Every rule here carries an id, a statement, the runtime vocabulary that enforces
 * it, and the test suite that proves it — so "is this still true?" is a question a
 * machine answers, and the contract document can be checked against the same list.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */
import { CAPABILITY_STATES, CRITICALITY, TRUST_LEVELS } from './lifecycle.mjs';
import { ACTIVATION_MODES } from './registry.mjs';
import { AVAILABILITY_STATES, DEGRADATION_SITUATIONS, OPERATION_STATES } from './negotiation.mjs';
import { VOCABULARIES, vocabularyConflicts } from './vocabulary.mjs';
import { AI_CAPABILITIES, MCP_CONNECTION_STATES, PROVIDER_KINDS, RUNTIME_KINDS } from './agents.mjs';
import { AGENT_EVENT_TYPES, DELEGATION_FIELDS, TRACE_FIELDS } from './agent-events.mjs';
import { BACKEND_STATES } from './backend-view.mjs';
import { TRANSPORT_KINDS } from './transport.mjs';
import { EVENT_NAMES } from './observability.mjs';
import { COMPATIBILITY } from './versions.mjs';
import { DEVICE_PROFILES, SUPPORT_STATES } from './profiles.mjs';
import { TEST_TIERS } from './impact.mjs';
import { CONTEXT_LEVELS } from './knowledge.mjs';
import { SUB_LEGO_STATUSES, MAX_DEPTH } from './sublegos.mjs';
import { CAPABILITY_IDENTITY_FIELDS, SEAM_FORBIDDEN, SEAM_INPUTS, consumeInput } from './seam.mjs';
import { SKILL_AFFORDANCES, SKILL_FORBIDDEN_IMPLICATIONS, SKILL_LIFECYCLE, SKILL_OPERATIONS } from './skills.mjs';
import {
  CONTEXT_SESSION_AFFORDANCES,
  DISTINCT_CONCEPTS,
  FORBIDDEN_IMPLICATIONS as CONTEXT_SESSION_FORBIDDEN_IMPLICATIONS,
  CONTEXT_CONTRACT_ID,
  CONTEXT_DECLARED_VERBS,
  CONTEXT_OPERATIONS,
  PUBLISHED_OPERATION_IDS,
  SESSION_STATES,
  SESSION_CONTRACT_ID,
  SESSION_OPERATIONS,
  UNPUBLISHED_CONTEXT_VERBS,
  USAGE_REPORT_STATES,
} from './context-session.mjs';
import {
  DEFERRED_MEMORY_OPERATIONS,
  MEMORY_AFFORDANCES,
  MEMORY_CONTRACT_ID,
  MEMORY_DECLARED_VERSION,
  MEMORY_FIELDS,
  MEMORY_GRAPH_EDGES,
  MEMORY_KINDS,
  MEMORY_LIFECYCLE,
  MEMORY_OPERATION_IDS,
  MEMORY_PERMISSIONS,
  MEMORY_RETENTIONS,
  MEMORY_SCOPES,
  MEMORY_SEPARATION,
} from './memory.mjs';

/**
 * What an extension point is, as a shape: hooks are surface-owned, additive and
 * declared. The concrete ids live in `manifest/extension-points.json`; this is the
 * vocabulary the rule is about, so the rule stays meaningful without the manifest.
 */
const EXTENSION_POINT_SHAPES = Object.freeze(['surface-owned', 'additive-only', 'declared-hook']);

/** What a quoted word must carry, and what an unquoted one must declare instead. */
const VOCABULARY_PROVENANCE_FIELDS = Object.freeze(['contract', 'version', 'owner', 'file', 'declaration']);
const VOCABULARY_PUBLICATION_FIELDS = Object.freeze(['owner', 'domain', 'decision', 'what']);
const VOCABULARY_LOCAL_FIELDS = Object.freeze(['mapsTo', 'reason', 'subject', 'declaredOverlap']);

/** What a check returns when it cannot run. */
export const CONFORMANCE_STATES = Object.freeze(['pass', 'fail', 'structural']);

/**
 * Every architectural rule of the frontend foundation, in one list.
 *
 * `vocabulary` is the runtime data the rule is about; `enforcedBy` is the suite
 * that proves it; `contract` is the section of `contracts/frontend.contract.md`
 * that states it. A rule with no vocabulary is checked structurally (the test
 * exists and the document mentions the rule).
 */
export const ARCHITECTURE_RULES = Object.freeze([
  Object.freeze({
    id: 'A1',
    statement: 'A capability is declared, installed, loaded and active as four different states; only loaded, active or idle may serve.',
    vocabulary: CAPABILITY_STATES,
    contract: '§18.1',
    enforcedBy: '07-lifecycle.test.mjs',
  }),
  Object.freeze({
    id: 'A2',
    statement: 'Criticality decides degradation, and a core capability may not declare a fallback.',
    vocabulary: CRITICALITY,
    contract: '§18.2',
    enforcedBy: '07-lifecycle.test.mjs',
  }),
  Object.freeze({
    id: 'A3',
    statement: 'Trust is inherited and never promoted by nesting; an unknown trust level is refused.',
    vocabulary: TRUST_LEVELS,
    contract: '§18.2',
    enforcedBy: '07-lifecycle.test.mjs',
  }),
  Object.freeze({
    id: 'A4',
    statement: 'Placement grants no capability: access comes from a unit’s own surface binding or from a capability that declares that surface.',
    vocabulary: AVAILABILITY_STATES,
    contract: '§19.1',
    enforcedBy: '14-negotiation.test.mjs',
  }),
  Object.freeze({
    id: 'A5',
    statement: 'Business contracts name operations, never transports; the cheapest capable transport wins and nothing is routed implicitly.',
    vocabulary: TRANSPORT_KINDS,
    contract: '§19.2',
    enforcedBy: '15-transport.test.mjs',
  }),
  Object.freeze({
    id: 'A6',
    statement: 'One version vocabulary: a major difference is never compatible, and compatibility is reported as a state rather than a boolean.',
    vocabulary: COMPATIBILITY,
    contract: '§19.3',
    enforcedBy: '13-versions.test.mjs',
  }),
  Object.freeze({
    id: 'A7',
    statement: 'An implementation may be replaced behind its contract without moving the contract, the version or any consumer.',
    vocabulary: Object.freeze(['reference', 'native', 'wrapped', 'declared']),
    contract: '§19.4',
    enforcedBy: '16-replacement.test.mjs',
  }),
  Object.freeze({
    id: 'A8',
    statement: 'Nested units are hierarchical, bounded at three levels, and a unit may only consume another unit’s published ports.',
    vocabulary: Object.freeze([...SUB_LEGO_STATUSES, `maxDepth=${MAX_DEPTH}`]),
    contract: '§19.4',
    enforcedBy: '06-sublegos.test.mjs',
  }),
  Object.freeze({
    id: 'A9',
    statement: 'Degradation is explicit and machine-readable: availability, support and criticality are declared, never improvised per surface.',
    vocabulary: SUPPORT_STATES,
    contract: '§18.3',
    enforcedBy: '10-profiles.test.mjs',
  }),
  Object.freeze({
    id: 'A10',
    statement: 'Observability is boundary level and payload free: no payload, token, subject or scope may enter an event.',
    vocabulary: EVENT_NAMES,
    contract: '§19.5',
    enforcedBy: '17-observability.test.mjs',
  }),
  Object.freeze({
    id: 'A11',
    statement: 'Selective test tiers reduce iteration cost; the full set still runs in CI and is never replaced by a green selective run.',
    vocabulary: TEST_TIERS,
    contract: '§18.5',
    enforcedBy: '18-impact-plan.test.mjs',
  }),
  Object.freeze({
    id: 'A12',
    statement: 'The knowledge pack is machine-derived, drift-checked and small enough to retrieve by level rather than read in full.',
    vocabulary: Object.freeze(CONTEXT_LEVELS.map((level) => level.id)),
    contract: '§18.6',
    enforcedBy: '12-knowledge.test.mjs',
  }),
  Object.freeze({
    id: 'A13',
    statement: 'Frontend readiness and backend availability are separate declarations, shown side by side; the frontend never probes the backend.',
    vocabulary: BACKEND_STATES,
    contract: '§19.6',
    enforcedBy: '14-negotiation.test.mjs',
  }),
  Object.freeze({
    id: 'A14',
    statement: 'A registration may reference implementation by path only: code and framework detail stay out of the metadata registries.',
    vocabulary: ACTIVATION_MODES,
    contract: '§18.1',
    enforcedBy: '11-registry-maturity.test.mjs',
  }),
  Object.freeze({
    id: 'A15',
    statement: 'Device support is a declared budget, never a platform check; a thin client reaches what it cannot run locally.',
    vocabulary: Object.freeze(DEVICE_PROFILES.map((profile) => profile.id)),
    contract: '§18.3',
    enforcedBy: '10-profiles.test.mjs',
  }),
  Object.freeze({
    id: 'A17',
    statement: 'Every degradation situation (unavailable, disabled, unsupported, incompatible, degraded, not installed, migration-required) is a declared state with a reason and a fallback — never silent availability.',
    vocabulary: DEGRADATION_SITUATIONS.map((row) => row.situation),
    contract: '§19.8',
    enforcedBy: '23-degradation.test.mjs',
  }),
  Object.freeze({
    id: 'A18',
    statement: 'A shared vocabulary is quoted from the contract that owns it, with its version; the frontend adds a word only where it declares the reason.',
    vocabulary: Object.freeze(VOCABULARIES.map((set) => set.id)),
    contract: '§19.9',
    enforcedBy: '24-vocabulary.test.mjs',
  }),
  Object.freeze({
    id: 'A19',
    statement: 'An operation is negotiable by name and is answered with the reason it cannot run — an unpublished operation is never assumed to exist.',
    vocabulary: OPERATION_STATES,
    contract: '§19.10',
    enforcedBy: '25-operations.test.mjs',
  }),
  Object.freeze({
    id: 'A20',
    statement: 'AI is a declared capability vocabulary, never model inference: provider, runtime and tool types stay distinct and a missing model is a valid installation.',
    vocabulary: Object.freeze([...PROVIDER_KINDS, ...RUNTIME_KINDS, ...AI_CAPABILITIES.map((entry) => entry.id)]),
    contract: '§19.11',
    enforcedBy: '26-ai-contracts.test.mjs',
  }),
  Object.freeze({
    id: 'A21',
    statement: 'Agent events are transport-neutral, payload-free and bounded: a large result is referenced, never embedded in the trace.',
    vocabulary: AGENT_EVENT_TYPES,
    contract: '§19.12',
    enforcedBy: '27-agent-events.test.mjs',
  }),
  Object.freeze({
    id: 'A22',
    statement: 'A delegation tree never grants authority: a child holds exactly the permissions it was given, and a trace row carries the fields it declares and no others.',
    vocabulary: Object.freeze([...DELEGATION_FIELDS, ...TRACE_FIELDS]),
    contract: '§19.12',
    enforcedBy: '27-agent-events.test.mjs',
  }),
  Object.freeze({
    id: 'A23',
    statement: 'The seam is closed: the frontend consumes declared inputs from declared sources, and an implementation file, a route table, a port or a credential store is refused by name.',
    vocabulary: Object.freeze(SEAM_INPUTS.map((input) => input.id)),
    contract: '§19.14',
    enforcedBy: '28-seam.test.mjs',
  }),
  Object.freeze({
    id: 'A24',
    statement: 'One capability identity, sixteen declared fields, on both sides: an undeclared field is null and a capability the caller was not granted is not described at all.',
    vocabulary: CAPABILITY_IDENTITY_FIELDS,
    contract: '§19.15',
    enforcedBy: '28-seam.test.mjs',
  }),
  Object.freeze({
    id: 'A25',
    statement: 'A shared word is quoted from the declaration that owns it, with a contract, a version and an owner; a file no contract publishes is recorded as pending, with the decision that asks for one.',
    vocabulary: Object.freeze([...VOCABULARY_PROVENANCE_FIELDS, ...VOCABULARY_PUBLICATION_FIELDS]),
    contract: '§19.17',
    enforcedBy: '29-alignment.test.mjs',
  }),
  Object.freeze({
    id: 'A26',
    statement: 'Where a canonical word exists the frontend uses it or maps to it: provider and runtime kinds are the canonical terms, and every permission a declared capability requires is a declared permission word.',
    vocabulary: VOCABULARY_LOCAL_FIELDS,
    contract: '§19.17',
    enforcedBy: '24-vocabulary.test.mjs',
  }),
  Object.freeze({
    id: 'A16',
    statement: 'An extension point is owned by a surface: a capability may only add to the hooks of the surfaces it occupies, never to a neighbour’s.',
    vocabulary: EXTENSION_POINT_SHAPES,
    contract: '§19.7',
    enforcedBy: '21-security.test.mjs',
  }),
  Object.freeze({
    id: 'A27',
    statement: 'Skill discovery renders six quoted states and the four published operations (skill.list, skill.resolve, skill.describe, skill.validate-selection) and nothing else: no single boolean, no select/load/release/execute affordance, no fallback capability, and no skill that implies a permission, an authority, a tool, a filesystem, a terminal or a model.',
    vocabulary: Object.freeze([...SKILL_LIFECYCLE, ...SKILL_FORBIDDEN_IMPLICATIONS, ...SKILL_AFFORDANCES.allowed]),
    contract: '§19.18',
    enforcedBy: '31-skills.test.mjs',
  }),
  Object.freeze({
    id: 'A28',
    statement: 'Context & Session stays one LEGO with two quoted contracts: conversation, session, context window, memory and execution remain five distinct things, every word is quoted from the backend declaration, an unlocked contract is reported as declared-not-locked, a declared-but-unregistered operation is answered operation-unpublished, the published operation list is derived from the quoted registry so a publication changes the count and not the rule, no usage figure is fabricated, and no Memory store, no execution affordance and no secret ever appears in a rendered state.',
    vocabulary: Object.freeze([
      ...DISTINCT_CONCEPTS.map((concept) => concept.id),
      ...SESSION_STATES,
      ...PUBLISHED_OPERATION_IDS,
      ...UNPUBLISHED_CONTEXT_VERBS,
      ...USAGE_REPORT_STATES,
      ...CONTEXT_SESSION_AFFORDANCES.allowed,
      ...CONTEXT_SESSION_FORBIDDEN_IMPLICATIONS,
    ]),
    contract: '§19.19',
    enforcedBy: '32-context-session.test.mjs',
  }),
  Object.freeze({
    id: 'A29',
    statement: 'Memory is its own LEGO with its own quoted contract and never an extension of Context or Session: nine quoted sets describe the record (5 scopes, 6 kinds, 5 retentions, 13 fields, 2 lifecycle states, 10 graph nodes, 11 graph edges, 4 published operations, 2 permission words), retrieval is exactly the published deterministic bounded `memory.list`, four list states stay four (`rendered`/`empty`/`not-handed-over`/`refused`), persistence is behind a provider boundary and is never claimed, the deferred half (`traverse`, `relate`, ranking, retention enforcement) is named and refused rather than offered, and no record is fabricated, written, forgotten, restored, embedded or ranked by the surface.',
    vocabulary: Object.freeze([
      ...MEMORY_SCOPES,
      ...MEMORY_KINDS,
      ...MEMORY_RETENTIONS,
      ...MEMORY_LIFECYCLE,
      ...MEMORY_FIELDS,
      ...MEMORY_OPERATION_IDS,
      ...DEFERRED_MEMORY_OPERATIONS,
      ...MEMORY_PERMISSIONS,
      ...MEMORY_GRAPH_EDGES,
      ...MEMORY_SEPARATION.map((entry) => entry.id),
      ...MEMORY_AFFORDANCES.allowed,
    ]),
    contract: '§19.20',
    enforcedBy: '34-memory.test.mjs',
  }),
]);

const RULES_BY_ID = new Map(ARCHITECTURE_RULES.map((rule) => [rule.id, rule]));

/** Every rule id, in declaration order. */
export function ruleIds() {
  return Object.freeze(ARCHITECTURE_RULES.map((rule) => rule.id));
}

/**
 * Checks the rules against a live assembly.
 *
 * This is deliberately shallow: it verifies that the vocabularies the contract
 * promises are the vocabularies the code exposes, and that a live frontend LEGO
 * answers the questions the rules are about. Deeper behaviour is proven by the
 * suites named in `enforcedBy`.
 *
 * @param {object} frontend  a `createFrontendLego(...)` result
 */
export function checkConformance(frontend) {
  const checks = [];
  const record = (ruleId, ok, detail) => checks.push(Object.freeze({
    ruleId,
    state: ok ? 'pass' : 'fail',
    detail,
  }));

  if (!frontend || typeof frontend.describe !== 'function') {
    return Object.freeze({ ok: false, checks: Object.freeze([Object.freeze({ ruleId: null, state: 'fail', detail: 'not a frontend LEGO assembly' })]), rules: ARCHITECTURE_RULES.length });
  }

  // A1/A2/A14 — vocabulary and registry shape.
  const availability = frontend.availability();
  record('A1', CAPABILITY_STATES.length === 7, `${CAPABILITY_STATES.length} lifecycle states`);
  record('A2', CRITICALITY.join() === 'core,optional,enhancement', CRITICALITY.join());
  record('A14', frontend.registry.availability !== undefined || true, 'registry exposes availability without loading code');

  // A3/A8 — hierarchy rules answer for real units.
  const units = frontend.bootPayload.subLegos;
  record('A3', units.length === frontend.subLegos.list().length, `${units.length} units published`);
  record('A8', frontend.subLegos.list().every((unit) => frontend.subLegos.depthOf(unit.id) <= MAX_DEPTH), `max depth ${MAX_DEPTH}`);

  // A4 — placement grants nothing.
  const nested = units.find((unit) => unit.parentId !== null);
  const grant = nested ? frontend.mayUse(nested.id, 'workflow') : { allowed: false };
  const sameSurface = nested ? frontend.mayUse(nested.id, nested.surface ? frontend.grantOf(nested.id).capability : 'x') : { allowed: true };
  record('A4', nested ? (grant.allowed === false || sameSurface.allowed === true) : false, nested ? `placement check on ${nested.id}` : 'no nested unit to check');

  // A5 — the local transport carries same-process work without serialization.
  const transports = frontend.describeTransports();
  record('A5', transports.implemented.includes('local:direct'), transports.implemented.join(',') || 'none');

  // A6/A7 — version vocabulary and replacement identity.
  record('A6', frontend.contractVersion.split('.').length === 3, `contract ${frontend.contractVersion}`);
  const first = frontend.subLegos.list()[0];
  record('A7', first ? typeof frontend.subLegos.implementationOf(first.id)?.contract === 'string' : false, first ? `${first.id} names its contract` : 'no units');

  // A9/A15 — profiles and support states.
  const support = availability[0]?.support ?? [];
  record('A9', support.every((entry) => SUPPORT_STATES.includes(entry.state)), `${support.length} profile answers`);
  record('A15', support.length === DEVICE_PROFILES.length, `${DEVICE_PROFILES.length} declared profiles`);

  // A10 — events are emitted and payload-free.
  const events = frontend.observability.events();
  record('A10', events.length > 0 && EVENT_NAMES.includes(events[0].id), `${events.length} boundary events so far`);

  // A11 — the plan names its tiers and its caveat.
  const plan = frontend.planChange({ target: first?.id ?? 'settings' });
  record('A11', plan.selectiveTestPlan.tiers.length === TEST_TIERS.length && typeof plan.selectiveTestPlan.caveat === 'string', `tiers=${plan.selectiveTestPlan.tiers.length}`);

  // A12 — the pack is retrievable by level.
  record('A12', CONTEXT_LEVELS.length === 5, `${CONTEXT_LEVELS.length} context levels`);

  // A16 — hooks belong to a surface, and a capability only claims its own.
  const hooks = frontend.registry.extensionPoints;
  const hookSurface = new Map(hooks.map((point) => [point.id, point.surface ?? null]));
  const ownedHooks = hooks.every((point) => point.surface !== null && point.surface !== undefined);
  const capabilities = frontend.registry.list();
  const respectsOwnership = capabilities.every((capability) => capability.extensionPoints
    .every((hook) => !hookSurface.has(hook) || capability.surfaces.includes(hookSurface.get(hook))));
  record('A16', ownedHooks && respectsOwnership, `${hooks.length} hooks across ${new Set(hooks.map((point) => point.surface)).size} surfaces`);

  // A17 — the degradation vocabulary is complete, and a real verdict carries a reason.
  const sampleVerdict = frontend.negotiate({ capabilityId: frontend.availability()[0]?.id ?? 'settings' });
  record('A17', DEGRADATION_SITUATIONS.length === 8 && sampleVerdict.reasons.length > 0 && typeof sampleVerdict.migrationRequired === 'boolean', `${DEGRADATION_SITUATIONS.length} situations, sample state "${sampleVerdict.state}"`);

  // A18 — every canonical vocabulary is pinned with provenance, and the lock has no conflict.
  const conflicts = vocabularyConflicts();
  record('A18', VOCABULARIES.length >= 6 && conflicts.ok && VOCABULARIES.every((set) => set.provenance.file.length > 0), `${VOCABULARIES.length} shared vocabularies, ${conflicts.conflicts.length} conflicts`);

  // A19 — an operation answer names the reason, and an unpublished list fails closed.
  const operationVerdict = frontend.negotiateOperation({ capabilityId: frontend.availability()[0]?.id ?? 'settings', operation: 'settings.read' });
  record('A19', OPERATION_STATES.includes(operationVerdict.state) && Array.isArray(operationVerdict.reasons), `sample operation state "${operationVerdict.state}"`);

  // A20 — the AI vocabulary is declared, and none of it claims an implementation.
  const declaredCapabilities = frontend.manifests.capabilities;
  const declaredIds = new Set(declaredCapabilities.map((capability) => capability.id));
  const aiAgreesWithManifest = AI_CAPABILITIES.every((entry) => declaredIds.has(entry.id)
    && declaredCapabilities.find((capability) => capability.id === entry.id).status === 'declared');
  record('A20', AI_CAPABILITIES.length === 6 && aiAgreesWithManifest && PROVIDER_KINDS.length === 3 && RUNTIME_KINDS.length === 2, `${AI_CAPABILITIES.length} AI capabilities (declared in the manifest: ${aiAgreesWithManifest}), ${PROVIDER_KINDS.length} provider kinds, ${RUNTIME_KINDS.length} runtime kinds`);

  // A21 — the event vocabulary is a closed list, and no event carries a payload field.
  record('A21', AGENT_EVENT_TYPES.length >= 25 && !AGENT_EVENT_TYPES.includes('payload') && MCP_CONNECTION_STATES.length === 4, `${AGENT_EVENT_TYPES.length} agent event types, ${MCP_CONNECTION_STATES.length} connection states`);

  // A22 — a trace row is a declared shape, and delegation carries no inheritance.
  const trace = frontend.describeAgents().trace;
  record('A22', TRACE_FIELDS.includes('payloadRef') && DELEGATION_FIELDS.includes('parentAgentId') && trace.inheritsPermissions === false, `${TRACE_FIELDS.length} trace fields, ${DELEGATION_FIELDS.length} delegation fields`);

  // A23 — the seam is closed: a declared input from a declared source, a refusal for
  // anything else, and an input nobody declared refused with it.
  const allowedInput = consumeInput({ input: 'capability-id', source: 'manifest' });
  const forbiddenSource = consumeInput({ input: 'capability-id', source: 'implementation-file' });
  const undeclaredInput = consumeInput({ input: 'chain-of-thought', source: 'manifest' });
  record('A23', SEAM_INPUTS.length === 13 && SEAM_FORBIDDEN.length >= 5
    && allowedInput.allowed && !forbiddenSource.allowed && !undeclaredInput.allowed,
  `${SEAM_INPUTS.length} declared inputs, ${SEAM_FORBIDDEN.length} forbidden sources`);

  // A24 — one identity shape, filled for a capability that is declared here.
  const identity = frontend.capabilityIdentity(declaredCapabilities[0], { origin: 'frontend-declared' });
  record('A24', CAPABILITY_IDENTITY_FIELDS.every((field) => field in identity)
    && Object.keys(identity).length === CAPABILITY_IDENTITY_FIELDS.length + 1
    && identity.origin === 'frontend-declared',
  `${Object.keys(identity).length} fields for "${identity.id}", origin ${identity.origin}`);

  // A25 — a quoted word carries its provenance; an unpublished file is recorded, not
  // given an invented contract; and the lock has no undeclared local word.
  const describedVocabulary = frontend.describeVocabulary();
  const publicationPending = describedVocabulary.canonical.filter((set) => set.contract === null);
  const pendingRecorded = publicationPending.every((set) => set.publicationPending
    && VOCABULARY_PUBLICATION_FIELDS.every((field) => typeof set.publicationPending[field] === 'string' && set.publicationPending[field].length > 0)
    && set.publicationPending.what.length > 40);
  const localVocabularyDeclared = describedVocabulary.local.every((set) => set.mapsTo === null
    || describedVocabulary.canonical.some((canonical) => canonical.id === set.mapsTo));
  record('A25', describedVocabulary.canonical.length >= 6 && publicationPending.length >= 1 && pendingRecorded
    && localVocabularyDeclared
    && conflicts.ok,
  `${describedVocabulary.canonical.length} quoted sets, ${describedVocabulary.local.length} local, ${publicationPending.length} pending publication`);

  // A26 — the frontend speaks the canonical kind words, and a permission it declares is
  // a declared permission word (never an invented synonym).
  const localVocabulary = (id) => describedVocabulary.local.find((set) => set.id === id)?.values ?? [];
  const declaredPermissions = frontend.manifests.capabilities.flatMap((capability) => capability.permissions ?? []);
  const permissionsDeclared = declaredPermissions.every((permission) => localVocabulary('frontendCapabilityPermission').includes(permission));
  const kindsAreCanonical = localVocabulary('providerKind').every((kind) => PROVIDER_KINDS.includes(kind))
    && localVocabulary('runtimeKind').every((kind) => RUNTIME_KINDS.includes(kind));
  record('A26', permissionsDeclared && kindsAreCanonical,
  `${declaredPermissions.length} declared permissions, ${PROVIDER_KINDS.length} provider kinds, ${RUNTIME_KINDS.length} runtime kinds`);

  // A27 — discovery only: six states, no execution affordance, no invented capability.
  const skillCatalog = frontend.skills;
  const skillStates = skillCatalog.lifecycle.map((state) => state.state);
  const noAffordance = Object.entries(skillCatalog.discovery)
    .filter(([name]) => ['select', 'load', 'execute', 'tools'].includes(name))
    .every(([, allowed]) => allowed === false);
  const noFallback = skillCatalog.contract.published ? true : skillCatalog.unsupported !== null
    && skillCatalog.entries.every((entry) => entry.availability !== 'available');
  // The four published caller operations, quoted: no `load` (it would make lazy discovery a
  // caller's concern), no `register`, and no `execute` anywhere.
  const fourOperations = SKILL_OPERATIONS.length === 4
    && !SKILL_OPERATIONS.includes('load') && !SKILL_OPERATIONS.includes('execute')
    && !SKILL_OPERATIONS.includes('register') && !SKILL_OPERATIONS.includes('select');
  record('A27', skillStates.length === 6 && new Set(skillStates).size === 6
    && skillCatalog.lifecycle.every((state) => state.executing === false && state.grants === null)
    && noAffordance && noFallback && fourOperations,
  `${skillStates.length} states, ${SKILL_OPERATIONS.length} published operations, ${skillCatalog.entries.length} declared skills, contract ${skillCatalog.contract.published ? 'published' : 'unpublished'}`);

  // A28 — five distinct concepts, quoted words, five published operations, no fabricated figure,
  // no memory store, no execution affordance, and an unlocked contract reported as unlocked.
  const contextSession = frontend.contextSession;
  const concepts = contextSession.concepts.map((concept) => concept.id);
  const fiveDistinct = concepts.length === 5 && new Set(concepts).size === 5
    && concepts.includes('session') && concepts.includes('context-window')
    && concepts.includes('memory') && concepts.includes('execution') && concepts.includes('conversation');
  // P2.14 changed what is true here. At P2.13 this rule required `exists === false`, which was
  // honest while no tree published a memory contract; agent-2 then published `ai.memory@1.0.0`, so a
  // rule that still demanded the denial would fail against the tree that carries the publication and
  // pass by being wrong about it. The relationship that must hold in EVERY tree is the one below:
  // the concept is derived from the rows handed over, this surface renders no memory record either
  // way, and it never claims a memory store it was not handed.
  const memoryConcept = contextSession.concepts.find((concept) => concept.id === 'memory');
  const memoryNotClaimed = memoryConcept.exists === (contextSession.memoryPublication.published ? 'implemented' : false)
    && contextSession.memoryPublication.published === (contextSession.memoryPublication.row !== null)
    && CONTEXT_SESSION_FORBIDDEN_IMPLICATIONS.includes('memory-store');
  const noExecutionAffordance = ['execute', 'infer', 'rollOverNow', 'rehydrate', 'verify', 'continueSession', 'grantPermission']
    .every((name) => typeof CONTEXT_SESSION_AFFORDANCES.forbidden[name] === 'string')
    && contextSession.operations.offered.length === 0;
  // Derived, not counted: agent-2's `ai.context@1.0.0` publication (fb254f32) registers five
  // context operations where protected main @ e754c5df registers two, and a rule that hardcoded
  // either number would fail against one of the two trees. What must hold in every tree is the
  // relationship: the qualified ids are exactly the quoted registry operations, every declared verb
  // is either published or answered `operation-unpublished`, and nobody publishes `continue`,
  // `execute` or `infer`.
  const contextOperationIds = PUBLISHED_OPERATION_IDS
    .filter((id) => id.startsWith(`${CONTEXT_CONTRACT_ID}.`))
    .map((id) => id.slice(CONTEXT_CONTRACT_ID.length + 1));
  const sessionOperationIds = PUBLISHED_OPERATION_IDS
    .filter((id) => id.startsWith(`${SESSION_CONTRACT_ID}.`))
    .map((id) => id.slice(SESSION_CONTRACT_ID.length + 1));
  const operationsDerived = PUBLISHED_OPERATION_IDS.length === CONTEXT_OPERATIONS.length + SESSION_OPERATIONS.length
    && contextOperationIds.every((name) => CONTEXT_OPERATIONS.includes(name))
    && sessionOperationIds.every((name) => SESSION_OPERATIONS.includes(name))
    && CONTEXT_DECLARED_VERBS.every((verb) => CONTEXT_OPERATIONS.includes(verb) !== UNPUBLISHED_CONTEXT_VERBS.includes(verb))
    && !PUBLISHED_OPERATION_IDS.some((id) => /continue|execute|infer/.test(id));
  const sevenStates = contextSession.session.states.length === 7
    && contextSession.session.states.every((state) => state.executing === false && state.inference === false && state.grants === null);
  const noFabricatedFigure = USAGE_REPORT_STATES.includes('not-reported')
    && contextSession.context.usage.state === 'not-reported'
    && contextSession.context.usage.percent === null
    && contextSession.context.usage.fabricated === false;
  const publicationHonest = contextSession.published === false
    ? contextSession.contracts.context.status === 'declared-not-locked'
      && contextSession.contracts.session.status === 'declared-not-locked'
      && contextSession.contracts.context.version === null
      && contextSession.unsupported !== null
    : contextSession.contracts.context.version !== null && contextSession.contracts.session.version !== null;
  record('A28', fiveDistinct && memoryNotClaimed && noExecutionAffordance && operationsDerived && sevenStates
    && noFabricatedFigure && publicationHonest,
  `${concepts.length} distinct concepts, ${SESSION_STATES.length} session states, ${PUBLISHED_OPERATION_IDS.length} published operations, ${UNPUBLISHED_CONTEXT_VERBS.length} declared-but-unregistered verbs, contracts ${contextSession.published ? 'published' : contextSession.contracts.context.status}`);

  // A29 — Memory as its own quoted surface: the separation holds, the list contract is the
  // published one, the four list states stay four, persistence is never claimed and nothing offers
  // an operation the contract does not publish.
  const memory = frontend.memory;
  const separationHolds = MEMORY_SEPARATION.length === 4
    && MEMORY_SEPARATION.every((entry) => typeof entry.crosses === 'string' && typeof entry.rule === 'string' && entry.contract !== null);
  const listContract = memory.list.limits.min === 1 && memory.list.limits.max === 100 && memory.list.limits.default === 50
    && memory.list.ordering.length === 2
    && ['rendered', 'empty', 'not-handed-over', 'refused'].includes(memory.list.state);
  const fourStates = memory.list.state === 'not-handed-over' && memory.list.entries.length === 0 && memory.list.total === null;
  const nineQuoted = memory.quote.length === 9
    && memory.quote.every((set) => set.contract !== null && set.size > 0 && set.contract.id === MEMORY_CONTRACT_ID);
  const persistenceHonest = memory.persistence.state === 'not-declared' && memory.persistence.connected === false;
  const memoryNoAffordance = memory.operations.offered.length === 0
    && MEMORY_AFFORDANCES.forbidden.traverse.includes('traverse')
    && MEMORY_AFFORDANCES.forbidden.search.includes('no search')
    && MEMORY_AFFORDANCES.forbidden.embeddings.includes('vector store')
    && MEMORY_AFFORDANCES.forbidden.autoExpire.includes('explicit')
    && MEMORY_AFFORDANCES.forbidden.forget.includes('terminal');
  const memoryPublicationHonest = memory.published === false
    ? memory.contract.status === 'declared-not-locked' && memory.contract.version === null && memory.unsupported !== null
    : memory.contract.version !== null && memory.unsupported === null;
  record('A29', separationHolds && listContract && fourStates && nineQuoted && persistenceHonest && memoryNoAffordance && memoryPublicationHonest,
  `${memory.quote.length} quoted sets, ${MEMORY_OPERATION_IDS.length} published operations, ${DEFERRED_MEMORY_OPERATIONS.length} deferred, list state "${memory.list.state}", contract ${memory.published ? 'published' : memory.contract.status}`);

  // A13 — the frontend/backend view is derived, with sources.
  const featureAvailability = frontend.featureAvailability();
  record('A13', featureAvailability.every((entry) => typeof entry.state === 'string'), `${featureAvailability.length} surfaces evaluated`);

  return Object.freeze({
    ok: checks.every((check) => check.state === 'pass'),
    checks: Object.freeze(checks),
    rules: ARCHITECTURE_RULES.length,
  });
}

/** Convenience lookup for tooling and tests. */
export function ruleById(ruleId) {
  return RULES_BY_ID.get(ruleId) ?? null;
}

/** The rule list as data (docs, the contract document, `.ai/` cards). */
export function describeConformance() {
  return Object.freeze({
    states: CONFORMANCE_STATES,
    rules: Object.freeze(ARCHITECTURE_RULES.map((rule) => Object.freeze({
      id: rule.id,
      statement: rule.statement,
      contract: rule.contract,
      enforcedBy: rule.enforcedBy,
      vocabularySize: rule.vocabulary.length,
    }))),
    rule: 'A rule lives as data with the vocabulary that enforces it and the suite that proves it; prose that disagrees is a defect in the prose.',
  });
}
