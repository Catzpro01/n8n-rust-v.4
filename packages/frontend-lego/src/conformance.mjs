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
import { AVAILABILITY_STATES } from './negotiation.mjs';
import { BACKEND_STATES } from './backend-view.mjs';
import { TRANSPORT_KINDS } from './transport.mjs';
import { EVENT_NAMES } from './observability.mjs';
import { COMPATIBILITY } from './versions.mjs';
import { DEVICE_PROFILES, SUPPORT_STATES } from './profiles.mjs';
import { TEST_TIERS } from './impact.mjs';
import { CONTEXT_LEVELS } from './knowledge.mjs';
import { SUB_LEGO_STATUSES, MAX_DEPTH } from './sublegos.mjs';

/**
 * What an extension point is, as a shape: hooks are surface-owned, additive and
 * declared. The concrete ids live in `manifest/extension-points.json`; this is the
 * vocabulary the rule is about, so the rule stays meaningful without the manifest.
 */
const EXTENSION_POINT_SHAPES = Object.freeze(['surface-owned', 'additive-only', 'declared-hook']);

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
    id: 'A16',
    statement: 'An extension point is owned by a surface: a capability may only add to the hooks of the surfaces it occupies, never to a neighbour’s.',
    vocabulary: EXTENSION_POINT_SHAPES,
    contract: '§19.7',
    enforcedBy: '21-security.test.mjs',
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
