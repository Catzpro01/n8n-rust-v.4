/**
 * The Skill surface — discovery and state presentation, and nothing beyond it (P2.12).
 *
 * A skill is procedural knowledge: how a task is done. It is not a capability, not an
 * agent, and not a permission. These tests hold the surface to that: the six states stay
 * six facts, discovery renders declarations and never executes, and where the backend
 * contract is unpublished the canonical unsupported answer is rendered instead of an
 * invented fallback.
 *
 * The backend (`manifest/ai-lego-set.json`, owned by agent-2) is on this branch, so the
 * vocabulary comparison runs for real; if it is ever absent, that comparison **skips with
 * a stated reason** — it never reports a pass it did not perform. `N8N_BACKEND_LEGO_ROOT`
 * points at another checkout's `.../src/lego`, and then a missing file is a **failure**:
 * a skip would report agreement with a declaration nobody read.
 *
 * Two further comparisons are gated on what the pointed-at tree publishes: a declaration
 * that claims a version nobody locked, and a declaration that has *moved* past the words
 * this package quotes. Both are reported as data (`declarationDrift`) and registered in
 * `docs/n8n-lego/decisions/cross-agent-decisions.json` — a difference between the two sides
 * is never resolved inside this package.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PACKAGE_ROOT, skillSurface } from '../src/manifests.mjs';
import { createFrontendLego } from '../src/lego.mjs';
import { isDeclaredTerm, vocabularyOf } from '../src/vocabulary.mjs';
import {
  SKILL_ALIGNMENT_DECISION,
  SKILL_CONTRACT_ID,
  SKILL_CONTRACT_VERSION,
  SKILL_DECLARATION_SOURCE,
  SKILL_DEGRADATION_STATES,
  SKILL_DISCLOSURE_LEVELS,
  SKILL_FORBIDDEN_FIELDS,
  SKILL_FORBIDDEN_IMPLICATIONS,
  SKILL_LIFECYCLE,
  SKILL_OPERATIONS,
  SKILL_OPERATION_NAMES,
  SKILL_PERMISSIONS,
  SKILL_QUOTED_VOCABULARIES,
  SKILL_STATUSES,
  SKILL_TRUST_LEVELS,
  SkillDeclarationError,
  createSkillCatalog,
  declarationDrift,
  declaredVersionOf,
  describeSkills,
  searchSkills,
  skillDetail,
  skillLifecycle,
  skillState,
  skillUnsupported,
  validateSkillDeclaration,
  validateSkillInstance,
} from '../src/skills.mjs';

const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
const read = (relative) => readFileSync(join(REPO_ROOT, relative), 'utf8');

const DEFAULT_BACKEND = join(REPO_ROOT, 'apps', 'n8n-lego', 'src', 'lego');
const BACKEND = process.env.N8N_BACKEND_LEGO_ROOT ?? DEFAULT_BACKEND;
const overridden = process.env.N8N_BACKEND_LEGO_ROOT !== undefined;
const BACKEND_SET = join(BACKEND, 'manifest', 'ai-lego-set.json');
const CONTRACT_LOCK = join(BACKEND, 'contracts', 'contract-lock.json');
const backendPresent = existsSync(join(BACKEND, 'interaction.mjs'));
const SKILL_MANIFEST = join(BACKEND, 'manifest', 'skill.json');
const LEGO_SET = join(BACKEND, 'manifest', 'ai-lego-set.json');

/**
 * A gated test that was *told* where the backend tree is must find it. Skipping when
 * `N8N_BACKEND_LEGO_ROOT` points at an empty directory would report agreement with a
 * declaration nobody read, which is the one failure this suite exists to prevent.
 */
const requireBackend = () => {
  assert.ok(backendPresent, `N8N_BACKEND_LEGO_ROOT is set but ${BACKEND} has no backend foundation`);
};
const skip = backendPresent || overridden
  ? false
  : 'the backend foundation is not on this branch — the comparison runs when it is';

/**
 * A moved declaration can only be compared against a tree that publishes one: `manifest/skill.json`
 * is agent-2's P2.12 artefact. Pointed at this branch, the comparison has nothing to read and
 * says so; pointed at that tree (`N8N_BACKEND_LEGO_ROOT`), it runs for real.
 */
const driftSkip = existsSync(SKILL_MANIFEST) || overridden
  ? false
  : 'the pointed-at backend tree publishes no manifest/skill.json yet (ai.skill landed in agent-2 P2.12) — the comparison runs when it does';

/**
 * The P2.12 finalize published `ai.skill@1.0.0` in the contract lock (`XA-19` resolved). This
 * branch's own copy of the backend tree can predate that — agent-2 lands the lock on its own
 * branch — so the Skill comparisons are gated on the pointed-at tree publishing the row: they
 * run for real, or they state why they cannot. They never report a pass they did not perform,
 * and when `N8N_BACKEND_LEGO_ROOT` is set, a missing row is a **failure** instead of a skip.
 */
const lockRowsOf = () => {
  if (!existsSync(CONTRACT_LOCK)) return [];
  const lock = JSON.parse(readFileSync(CONTRACT_LOCK, 'utf8'));
  return Array.isArray(lock) ? lock : (lock.contracts ?? []);
};
const skillLockRow = () => lockRowsOf().find((row) => (row.id ?? row.contract) === SKILL_CONTRACT_ID) ?? null;
const finalizedSkip = skillLockRow() !== null || overridden
  ? false
  : `the pointed-at backend tree predates the P2.12 finalize (${CONTRACT_LOCK} publishes no ai.skill row) — the comparison runs against the tree that publishes it`;

const DECISIONS = JSON.parse(read('docs/n8n-lego/decisions/cross-agent-decisions.json'));
const SURFACE = skillSurface();

/**
 * The pre-finalize surface shape: no publication row, so the contract is unpublished and the
 * canonical unsupported answer is rendered. Kept as a fixture because those paths still have
 * to work — a consumer of an unpublished contract is a real state, not a historical one.
 */
const UNPUBLISHED_SURFACE = Object.freeze({
  ...SURFACE,
  publication: undefined,
  publicationPending: Object.freeze({
    owner: 'manager',
    domain: 'ai-lego-set',
    decision: 'XA-11',
    what: 'manifest/ai-lego-set.json has no contract-lock row publishing ai.skill, so the frontend has no contract version to bind to',
  }),
});

/** The backend's skill declaration, as the other agent publishes it. */
const backendSkill = () => JSON.parse(readFileSync(BACKEND_SET, 'utf8')).lego.find((entry) => entry.id === 'skill');

/** A skill entry as a published contract would carry it. */
const entry = (overrides = {}) => Object.freeze({
  skillId: 'invoice-reconciliation',
  title: 'Reconcile invoices',
  owner: 'manager',
  status: 'planned',
  lifecycle: ['registered', 'available', 'selected'],
  trust: 'verified',
  contractVersion: '1.0.0',
  requiredCapabilities: ['ai.context'],
  degradation: ['available', 'optional-absent'],
  ...overrides,
});

const published = (overrides = {}) => createSkillCatalog({
  surface: SURFACE,
  declaration: { id: 'skill', status: 'planned', lifecycle: [...SKILL_LIFECYCLE], contracts: [SKILL_CONTRACT_ID], versioning: 'ai.skill@1.0.0' },
  contract: { id: SKILL_CONTRACT_ID, version: '1.0.0', owner: 'manager' },
  skills: [entry()],
  requiredVersion: '1.0.0',
  declaredCapabilities: ['ai.context'],
  ...overrides,
});

test('discovery renders a skill: name, status and availability first, the rest on request', () => {
  const catalog = published();
  const basic = skillDetail(catalog, 'invoice-reconciliation');
  assert.equal(basic.level, 'basic');
  assert.equal(basic.skillId, 'invoice-reconciliation');
  assert.equal(basic.title, 'Reconcile invoices');
  assert.equal(basic.status, 'planned');
  assert.equal(basic.availability, 'available');
  for (const field of ['lifecycle', 'trust', 'contractVersion', 'requiredCapabilities', 'degradation', 'owner']) {
    assert.equal(field in basic, false, `${field} is progressive disclosure, not the basic view`);
  }

  const advanced = skillDetail(catalog, 'invoice-reconciliation', { level: 'advanced' });
  assert.deepEqual(advanced.lifecycle, ['registered', 'available', 'selected']);
  assert.equal(advanced.contractVersion, '1.0.0');
  assert.equal(advanced.trust, 'verified');
  assert.deepEqual(advanced.requiredCapabilities, ['ai.context']);
  assert.equal(advanced.owner, 'manager');

  // Search and filter read the same declarations; they never reach a backend.
  assert.equal(searchSkills(catalog, { query: 'invoice' }).length, 1);
  assert.equal(searchSkills(catalog, { query: 'nothing-like-this' }).length, 0);
  assert.equal(searchSkills(catalog, { lifecycle: 'selected' }).length, 1);
  assert.equal(searchSkills(catalog, { lifecycle: 'released' }).length, 0);
  assert.equal(searchSkills(catalog, { capability: 'ai.context' }).length, 1);
  assert.equal(searchSkills(catalog, { capability: 'ai.memory' }).length, 0);

  // Discovery is what it says it is: four reads allowed, four affordances refused.
  assert.deepEqual(Object.keys(catalog.discovery).sort(), ['detail', 'execute', 'filter', 'listing', 'load', 'search', 'select', 'tools']);
  for (const allowed of ['listing', 'search', 'filter', 'detail']) assert.equal(catalog.discovery[allowed], true, allowed);
  for (const refused of ['select', 'load', 'execute', 'tools']) assert.equal(catalog.discovery[refused], false, refused);
});

test('the six lifecycle states are six facts, never one boolean', () => {
  assert.deepEqual(SKILL_LIFECYCLE, ['registered', 'available', 'selected', 'loaded', 'active', 'released']);
  assert.equal(new Set(SKILL_LIFECYCLE).size, 6);
  const rows = skillLifecycle();
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.map((row) => row.state), [...SKILL_LIFECYCLE]);

  // Each state differs from the others in at least one fact: a boolean would have to
  // collapse `selected` into `loaded`, and `loaded` into `active`.
  const signatures = rows.map((row) => `${row.discoverable}/${row.loaded}/${row.active}`);
  assert.equal(new Set(signatures).size >= 3, true, `states must not collapse: ${signatures.join(' ')}`);
  assert.deepEqual(signatures.slice(0, 3), ['true/false/false', 'true/false/false', 'true/false/false']);
  assert.deepEqual(signatures.slice(3), ['true/true/false', 'true/true/true', 'true/false/false']);
  for (const row of rows) {
    assert.equal(row.executing, false, `${row.state} is not an execution state`);
    assert.equal(row.grants, null, `${row.state} grants nothing`);
    assert.ok(row.detail.length > 20, `${row.state} explains itself`);
  }
  assert.equal(skillState('enabled').known, false, 'a word the backend does not declare is refused');
  assert.equal(skillState('enabled').executing, false);
  assert.equal(skillState('rolling').detail.includes('six declared skill lifecycle states'), true);
});

test('the surface quotes the published contract, and an empty skill list is not an error', () => {
  const catalog = createSkillCatalog({ surface: SURFACE });
  assert.equal(catalog.contract.published, true, 'the surface quotes the row it was verified against');
  assert.equal(catalog.contract.version, SKILL_CONTRACT_VERSION, 'the locked version, not a claim from a file');
  assert.equal(catalog.contract.comparable, true, 'a published version is comparable');
  assert.equal(catalog.contract.decision, SKILL_ALIGNMENT_DECISION, 'and the decision that reconciled it is named');
  assert.match(catalog.contract.detail, /locked in apps\/n8n-lego\/src\/lego\/contracts\/contract-lock\.json/);
  assert.equal(catalog.availability, 'available', 'the published contract is available; an empty list is not an error');
  assert.equal(catalog.unsupported, null, 'a published contract needs no unsupported answer');

  const detail = skillDetail(catalog, 'invoice-reconciliation');
  assert.equal(detail.state, 'capability-unavailable', 'and an unknown skill still answers canonically');
  assert.equal(detail.known, false);
  assert.match(detail.reason, /no declared skill "invoice-reconciliation"/);
  assert.deepEqual(searchSkills(catalog, {}), []);
});

test('with no publication row the surface answers with the canonical unsupported state', () => {
  const catalog = createSkillCatalog({ surface: UNPUBLISHED_SURFACE });
  assert.equal(catalog.contract.published, false);
  assert.equal(catalog.contract.version, null, 'an unpublished contract has no version to quote');
  assert.equal(catalog.contract.decision, 'XA-11');
  assert.equal(catalog.availability, 'optional-absent', 'an empty skill list is not an error');
  assert.equal(catalog.unsupported.state, 'capability-unavailable');
  assert.equal(catalog.unsupported.error, 'lego.capability_unavailable');

  const detail = skillDetail(catalog, 'invoice-reconciliation');
  assert.equal(detail.state, 'capability-unavailable');
  assert.equal(detail.known, false);
  assert.equal(detail.decision, 'XA-11');
  assert.match(detail.detail, /no fallback capability, no execution control and no tool access/);

  // A verdict, not an empty object: every field a caller might branch on is present.
  assert.deepEqual(Object.keys(skillUnsupported('why')).sort(), ['contract', 'decision', 'detail', 'error', 'reason', 'state']);

  // No declaration, no fallback: an entry supplied while the contract is unpublished is
  // never rendered as available.
  const withEntries = createSkillCatalog({ surface: UNPUBLISHED_SURFACE, skills: [entry()] });
  assert.equal(withEntries.entries.length, 1);
  assert.equal(withEntries.entries[0].availability, 'capability-unavailable');
  assert.equal(withEntries.entries[0].contractVersion, null);
  assert.equal(searchSkills(withEntries, { availability: 'available' }).length, 0);
});

test('a version mismatch is reported as version-incompatible, never silently adapted', () => {
  const newer = published({ requiredVersion: '2.0.0' });
  assert.equal(newer.entries[0].availability, 'version-incompatible');
  assert.match(newer.entries[0].availabilityDetail, /required 2\.0\.0, offered 1\.0\.0/);

  // A migration is its own canonical state — not a silent upgrade and not a failure.
  const migrating = published({
    requiredVersion: '1.0.0',
    contract: { id: SKILL_CONTRACT_ID, version: '1.1.0', owner: 'manager' },
    migrations: ['1.1.0'],
  });
  assert.equal(migrating.entries[0].availability, 'migration-required');
  assert.match(migrating.entries[0].availabilityDetail, /crosses declared migration point/);

  // A requirement nobody can compare is refused, not assumed satisfied.
  const uncomparable = published({ requiredVersion: '1.x' });
  assert.equal(uncomparable.entries[0].availability, 'feature-unsupported');

  // A published row without a version cannot make a compatibility claim either.
  const versionless = published({ contract: { id: SKILL_CONTRACT_ID, owner: 'manager' } });
  assert.equal(versionless.contract.published, true);
  assert.equal(versionless.contract.comparable, false);
  assert.equal(versionless.entries[0].availability, 'feature-unsupported');
});

test('an unsupported capability requirement degrades the skill instead of inventing one', () => {
  const missing = published({ declaredCapabilities: ['ai.model-gateway'], skills: [entry({ requiredCapabilities: ['ai.context'] })] });
  assert.equal(missing.entries[0].availability, 'capability-unavailable');
  assert.match(missing.entries[0].availabilityDetail, /required capability "ai\.context" is not declared by this frontend/);

  const disabled = published({ declaredCapabilities: ['ai.context'], unavailableCapabilities: ['ai.context'] });
  assert.equal(disabled.entries[0].availability, 'dependency-disabled');
  assert.match(disabled.entries[0].availabilityDetail, /declared but not serviceable here/);

  // Degrading a skill must not remove it from discovery silently: the row stays, with
  // the canonical reason, and no substitute capability is offered in its place.
  assert.equal(searchSkills(disabled, {}).length, 1);
  assert.equal(skillDetail(disabled, 'invoice-reconciliation').availability, 'dependency-disabled');
  assert.equal(Object.keys(disabled.entries[0]).includes('fallback'), false);
  for (const state of [missing.entries[0].availability, disabled.entries[0].availability]) {
    assert.ok(SKILL_DEGRADATION_STATES.includes(state), `${state} is a canonical degradation word`);
  }
});

test('a missing skill declaration renders the unsupported state, not an empty skill', () => {
  const nothing = createSkillCatalog({});
  assert.equal(nothing.availability, 'optional-absent');
  assert.equal(nothing.unsupported.state, 'capability-unavailable');
  assert.deepEqual(Object.keys(skillDetail(nothing, 'anything')).includes('known'), true);
  assert.equal(skillDetail(nothing, 'anything').known, false);

  const unknownSkill = skillDetail(published(), 'no-such-skill');
  assert.equal(unknownSkill.state, 'capability-unavailable');
  assert.match(unknownSkill.reason, /no declared skill "no-such-skill"/);

  // A declaration with an invented field is refused by name rather than half-rendered.
  const invented = validateSkillDeclaration({ id: 'skill', lifecycle: [...SKILL_LIFECYCLE], maximumPowerLevel: 9 });
  assert.equal(invented.ok, false);
  assert.match(invented.findings.join(' '), /unknown field "maximumPowerLevel"/);
  const badState = validateSkillDeclaration({ id: 'skill', lifecycle: ['registered', 'enabled'] });
  assert.equal(badState.ok, false);
  assert.match(badState.findings.join(' '), /unknown lifecycle state "enabled"/);
  assert.equal(validateSkillDeclaration({ id: 'skill', lifecycle: [...SKILL_LIFECYCLE] }).ok, true);
});

test('no invented permission: the surface renders declared permission words and coins none', () => {
  assert.deepEqual(SKILL_PERMISSIONS, vocabularyOf('skillPermission').values);
  assert.deepEqual(SKILL_PERMISSIONS, ['ai:skill:read', 'ai:skill:select']);
  assert.equal(isDeclaredTerm('skillPermission', 'frontend.skill.read'), false, 'a parallel namespace is not a term');
  // The two words appear in two places on purpose: `skillPermission` is what the Skill contract
  // requires of its own operations, `aiPermission` is the AI foundation's list of published
  // operation permissions. Same words, one vocabulary — and neither list has an execute word.
  assert.equal(isDeclaredTerm('aiPermission', 'ai:skill:read'), true, 'the AI foundation publishes the same two words');
  assert.equal(isDeclaredTerm('aiPermission', 'ai:skill:execute'), false, 'no execute permission exists in either set');

  // A skill that claims an entitlement is refused by name, each with its reason.
  for (const forbidden of ['permissions', 'grants', 'authority', 'tools', 'filesystem', 'terminal', 'model', 'entry', 'execute']) {
    const refused = validateSkillInstance({ skillId: 'x', [forbidden]: true });
    assert.equal(refused.ok, false, `${forbidden} is refused`);
    assert.match(refused.findings.join(' '), new RegExp(`"${forbidden}" is refused by name`));
    assert.ok(SKILL_FORBIDDEN_FIELDS[forbidden].length > 20, `${forbidden} carries a reason`);
  }
  for (const term of SKILL_FORBIDDEN_IMPLICATIONS) {
    assert.equal(describeSkills().forbiddenImplications.includes(term), true, `${term} must never be implied`);
  }

  // An unknown field is refused too — a second vocabulary starts as an extra key.
  assert.equal(validateSkillInstance({ skillId: 'x', permissionsGranted: [] }).ok, false);
  assert.equal(validateSkillInstance(entry()).ok, true);
});

test('no execution affordance exists while the skill is unsupported', () => {
  const catalog = createSkillCatalog({ surface: SURFACE, skills: [entry()] });
  assert.equal(catalog.discovery.select, false);
  assert.equal(catalog.discovery.load, false);
  assert.equal(catalog.discovery.execute, false);
  assert.equal(catalog.discovery.tools, false);

  const advanced = skillDetail(published(), 'invoice-reconciliation', { level: 'advanced' });
  assert.equal(advanced.operations.length, SKILL_OPERATIONS.length);
  for (const operation of advanced.operations) {
    assert.equal(operation.offered, false, `${operation.operation} is named but never offered`);
  }
  for (const verb of ['select', 'load', 'release', 'execute', 'tools', 'filesystem', 'terminal', 'inference']) {
    assert.ok(Object.keys(catalog.affordances.forbidden).includes(verb), `${verb} is refused with a reason`);
    assert.ok(catalog.affordances.forbidden[verb].length > 20);
  }

  // Nothing in the catalog answers "true" to an execution-shaped question. The lifecycle
  // legend is excluded on purpose: `loaded: true` there is a *state fact* about a skill,
  // asserted by its own test, not an affordance the UI may offer.
  const truthy = (value, path = '') => {
    if (value === null || typeof value !== 'object') return [];
    return Object.entries(value).flatMap(([key, child]) => {
      const here = `${path}.${key}`;
      if (/select|load|release|execute|infer|tool/.test(key) && child === true) return [here];
      return truthy(child, here);
    });
  };
  const affordanceSurface = {
    discovery: catalog.discovery,
    affordances: catalog.affordances.allowed,
    entries: catalog.entries.map(({ states, lifecycle, ...rest }) => rest),
  };
  assert.deepEqual(truthy(affordanceSurface), [], 'no execution affordance is reachable from an unavailable catalog');
});

/**
 * The two words that must never appear in the quoted Skill vocabulary, in either direction:
 * an operation that executes a procedure, and a permission that would authorise one. The
 * vocabulary is quoted, so this is a claim about the backend as much as about the surface —
 * a backend that published `ai:skill:execute` would fail here before a UI could offer it.
 */
test('no quoted operation and no quoted permission executes anything', () => {
  const executing = ['execute', 'exec', 'run', 'invoke', 'call', 'apply', 'trigger'];
  for (const operation of SKILL_OPERATIONS) {
    const word = operation.toLowerCase();
    assert.equal(executing.some((verb) => word.includes(verb)), false, `"${operation}" reads as an execution operation`);
  }
  assert.equal(SKILL_OPERATIONS.includes('execute'), false);
  for (const permission of SKILL_PERMISSIONS) {
    assert.match(permission, /^ai:skill:[a-z-]+$/, `"${permission}" stays in the skill namespace`);
    assert.equal(/execute|exec|run|invoke|admin/.test(permission), false, `"${permission}" reads as an execution or administration grant`);
  }
  assert.equal(SKILL_PERMISSIONS.includes('ai:skill:execute'), false, 'there is no ai:skill:execute permission to quote');
});

/**
 * Discovery reads declarations and stops there. A published skill may point at a procedure —
 * that pointer is a loader, and no listing, search, filter, detail or validation path may
 * follow it. The probe is non-enumerable so the only thing that can move it is code that
 * *reaches for* the body rather than code that merely enumerates the fields.
 */
test('discovery never calls a body loader, and offers no operation that would', () => {
  let bodyLoads = 0;
  const skill = { ...entry(), lifecycle: ['registered', 'available'] };
  Object.defineProperty(skill, 'body', {
    enumerable: false,
    get() {
      bodyLoads += 1;
      return 'the procedure the skill describes';
    },
  });
  Object.defineProperty(skill, 'load', {
    enumerable: false,
    value() {
      bodyLoads += 1;
      return 'the procedure the skill describes';
    },
  });

  const catalog = published({ skills: [skill] });
  assert.equal(bodyLoads, 0, 'building the catalog reads no body');
  searchSkills(catalog, { query: 'invoice' });
  searchSkills(catalog, { status: 'planned' });
  skillDetail(catalog, 'invoice-reconciliation');
  const advanced = skillDetail(catalog, 'invoice-reconciliation', { level: 'advanced' });
  describeSkills(catalog);
  assert.equal(bodyLoads, 0, 'no discovery path reads a body — loading stays an internal backend concern');
  assert.ok(advanced.operations.length > 0, 'the operations are still named');
  for (const operation of advanced.operations) {
    assert.equal(operation.offered, false, `${operation.operation} is named and never offered`);
  }
  const loaded = catalog.lifecycle.find((entry) => entry.state === 'loaded');
  assert.ok(loaded, '`loaded` stays a state a skill can be in');
  assert.equal(loaded.executing, false, 'and being loaded is not something this UI did — a state fact, never an action');
});

test('the frontend quotes the backend skill vocabulary, and re-declares none of it', { skip }, () => {
  requireBackend();
  const declared = backendSkill();
  assert.ok(declared, 'the backend declares the Skill LEGO');

  /**
   * Every vocabulary field is either quoted exactly, or the difference is *registered*:
   * reported by `declarationDrift` and recorded as an open row in the frontend register.
   * A silent difference — one the surface neither quotes nor registers — fails here, and
   * so does adopting the newer spelling.
   */
  const catalog = createSkillCatalog({ surface: SURFACE, declaration: declared });
  const drifted = new Map(catalog.drift.differences.map((difference) => [difference.field, difference]));
  const registered = DECISIONS.decisions.find((row) => row.id === SKILL_ALIGNMENT_DECISION);
  assert.ok(registered, `${SKILL_ALIGNMENT_DECISION} is recorded`);
  assert.equal(registered.status, 'resolved', 'the finalize adopted the implemented shape');
  /**
   * Every vocabulary field is either quoted exactly, or the difference is the *historical* one
   * the now-closed row describes — reported by `declarationDrift` until the pointed-at tree
   * carries the published row, and never adopted silently. Once the tree publishes the row,
   * there is nothing left to cover: a difference is a failure.
   */
  const covered = (field, quoted, declaredValues) => {
    if (JSON.stringify(quoted) === JSON.stringify(declaredValues)) return true;
    assert.equal(skillLockRow(), null, `${field} differs from the published tree (${quoted.join(', ')} quoted / ${declaredValues.join(', ')} declared) — XA-19 is resolved, so nothing covers it`);
    const difference = drifted.get(field);
    assert.ok(difference, `${field} differs (${quoted.join(', ')} quoted / ${declaredValues.join(', ')} declared) and no difference is reported`);
    assert.deepEqual(difference.declared, declaredValues, `${field}: the reported difference names the declared values`);
    assert.match(`${registered.historicalFinding ?? ''} ${registered.resolution}`, new RegExp(field), `${field}: the resolved row names the field that differed`);
    return true;
  };

  assert.deepEqual(SKILL_LIFECYCLE, declared.lifecycle, 'the six states are quoted, not invented');
  if (skillLockRow() === null) {
    assert.equal(overridden, false, `N8N_BACKEND_LEGO_ROOT is set but ${CONTRACT_LOCK} publishes no ai.skill row`);
    assert.equal(declared.versioning, 'publicationPending', 'the pointed-at tree predates the finalize');
  } else {
    // The published tree spells the same four as this package: the LEGO block as verbs, the
    // lock qualified, and neither of them carries the four internal lifecycle methods.
    assert.deepEqual(SKILL_OPERATIONS, declared.operations, 'the four published operations are quoted, not invented');
    assert.ok(declaredVersionOf(declared.versioning) !== null, 'the declaration claims the published version');
  }
  assert.deepEqual(SKILL_PERMISSIONS, declared.permissions, 'the declared operation permissions are quoted');
  assert.deepEqual(SKILL_DISCLOSURE_LEVELS, Object.keys(declared.disclosureLevels), 'the disclosure levels are quoted');
  assert.deepEqual(SKILL_STATUSES, Object.keys(JSON.parse(readFileSync(BACKEND_SET, 'utf8')).statusVocabulary), 'the status words are quoted');
  assert.deepEqual(declared.degradation, ['available', 'optional-absent']);
  for (const state of declared.degradation) {
    assert.ok(SKILL_DEGRADATION_STATES.includes(state), `${state} is a canonical degradation word`);
  }

  // The declaration states its publication state, and every quoted set records that honestly.
  // `publicationPending` and `<contract>@<version>` are both honest claims: the first says no
  // version exists, the second says one is declared while the lock still has no row. The test
  // accepts both and the drift comparison reports which one the tree carries.
  assert.ok(declared.versioning === 'publicationPending' || declaredVersionOf(declared.versioning) !== null,
    `unrecognised versioning claim "${declared.versioning}"`);
  assert.equal(declared.contracts.includes(SKILL_CONTRACT_ID), true);
  // Every quoted set says where it came from and which recorded decision owes it a contract.
  // Two files carry these words: the Skill declaration itself, and the foundation manifest the
  // trust levels come from (`XA-9`) — the surface quotes both, and re-declares neither.
  const QUOTED_FROM = {
    'apps/n8n-lego/src/lego/manifest/ai-lego-set.json': { decision: SKILL_DECLARATION_SOURCE.decision, path: /^lego#id=skill\.|^statusVocabulary$/ },
    'apps/n8n-lego/src/lego/manifest/foundation.json': { decision: 'XA-9', path: /^trust\.levels$/ },
  };
  // Four sets are published by the locked Skill contract; the AI set's maturity words are still
  // published by no row, and the trust words still wait on `XA-9`. A set either quotes a pinned
  // contract (id + version + owner) or carries a pending record naming a recorded decision.
  for (const id of SKILL_QUOTED_VOCABULARIES.filter((value) => value !== 'degradation')) {
    const set = vocabularyOf(id);
    const source = QUOTED_FROM[set.provenance.file];
    assert.ok(source, `${id} is quoted from a declared file (${set.provenance.file})`);
    assert.match(set.provenance.path, source.path, `${id} names the declaration inside that file`);
    if (id === 'aiLegoStatus' || set.provenance.file.endsWith('foundation.json')) {
      assert.equal(set.provenance.contract, null, `${id} claims no contract it has not found`);
      assert.equal(set.publicationPending.decision, source.decision, `${id} names the decision that owes it a contract`);
      assert.ok(DECISIONS.decisions.some((row) => row.id === set.publicationPending.decision), `${id}: ${set.publicationPending.decision} is recorded`);
      continue;
    }
    assert.equal(set.provenance.contract.id, SKILL_CONTRACT_ID, `${id} is published by the locked contract`);
    assert.equal(set.provenance.contract.version, SKILL_CONTRACT_VERSION, `${id} quotes the locked version`);
    assert.equal(set.provenance.contract.owner, 'manager', `${id} quotes the locked owner`);
    assert.equal(set.provenance.contract.decision, undefined, `${id} carries no stale decision on a published contract`);
    assert.equal(set.publicationPending ?? null, null, `${id} is published — no pending record outlives the lock`);
  }
  assert.deepEqual(SKILL_TRUST_LEVELS, vocabularyOf('trustLevel').values, 'the trust words are quoted from the foundation manifest');
  assert.equal(SKILL_DECLARATION_SOURCE.file.endsWith('manifest/ai-lego-set.json'), true);
  assert.equal(SKILL_DECLARATION_SOURCE.path, 'lego#id=skill');

  // No parallel vocabulary: the surface declares none of its own. Every skill word is a
  // backend value, and nothing in the quoted sets is a frontend-coined term.
  assert.equal(vocabularyOf('skillLifecycle').provenance.file.includes('frontend-lego'), false);
  for (const id of SKILL_QUOTED_VOCABULARIES) {
    for (const value of vocabularyOf(id).values) {
      assert.equal(value.startsWith('frontend.'), false, `${id}.${value} would be a frontend-coined vocabulary term`);
    }
  }
  assert.equal(isDeclaredTerm('skillLifecycle', 'frontend.skill.read'), false);
  // A frontend *error code* is a different thing from a vocabulary term: it names a refusal
  // this package raises, in the same `frontend.<area>.*` family the other modules use.
  assert.equal(new SkillDeclarationError('refused').code, 'frontend.skill.invalid-declaration');
  assert.match(new SkillDeclarationError('refused').code, /^frontend\.[a-z]+\./);
  assert.match(read('packages/frontend-lego/src/skills.mjs'), /from '\.\/vocabulary\.mjs'/);
  assert.equal(/from '.*apps\/n8n-lego/.test(read('packages/frontend-lego/src/skills.mjs')), false, 'the surface quotes names; it never imports the backend');
  assert.equal(/^import .*node:/m.test(read('packages/frontend-lego/src/skills.mjs')), false, 'and stays browser-safe');
});

test('the contract lock publishes ai.skill@1.0.0, and this consumer quotes that row', { skip: finalizedSkip }, () => {
  requireBackend();
  const row = skillLockRow();
  assert.ok(row, `${CONTRACT_LOCK} publishes ${SKILL_CONTRACT_ID}`);
  assert.equal(row.version, SKILL_CONTRACT_VERSION, 'the consumed version is the published one');
  assert.equal(row.owner, 'manager');
  assert.equal(row.status, 'implemented');
  assert.equal(row.domain, 'ai-foundation', 'on the existing domain — no new top-level domain was created');
  assert.deepEqual(row.operations, [...SKILL_OPERATION_NAMES], 'four published caller operations, in the lock spelling');
  assert.deepEqual(row.permissions, [...SKILL_PERMISSIONS]);

  // The declaration and the lock spell the same four. Nothing is published that is not consumed,
  // and nothing is consumed that is not published — in either direction.
  const declared = backendSkill();
  assert.deepEqual(SKILL_OPERATIONS, declared.operations, 'the LEGO block spells the four as verbs');
  assert.deepEqual(SKILL_OPERATION_NAMES.map((name) => name.replace(/^skill\./, '')), [...SKILL_OPERATIONS], 'same four, same order');
  for (const internal of ['register', 'select', 'load', 'release', 'execute']) {
    assert.equal(SKILL_OPERATIONS.includes(internal), false, `"${internal}" is not a published caller operation`);
    assert.equal(SKILL_OPERATION_NAMES.includes(`skill.${internal}`), false, `"skill.${internal}" is not published`);
    assert.equal(JSON.stringify(row).includes(`"skill.${internal}"`), false, `the lock does not publish "skill.${internal}"`);
  }
  // No layer publishes an execute word — checked on the *lists*, not on the prose: the lock's
  // own notes explain at length that no such permission exists, and a text search would fail on
  // the sentence that documents the invariant.
  const contractManifest = JSON.parse(readFileSync(SKILL_MANIFEST, 'utf8'));
  for (const [label, list] of [['the lock', row.permissions], ['the LEGO block', declared.permissions], ['the contract manifest', contractManifest.permissions]]) {
    assert.ok(Array.isArray(list) && list.length > 0, `${label} publishes a permission list`);
    for (const permission of list) {
      assert.equal(/execute/.test(permission), false, `${label}: "${permission}" reads as an execution grant`);
    }
  }
  for (const [label, list] of [['the lock', row.operations], ['the LEGO block', declared.operations]]) {
    const verbs = list.map((operation) => operation.replace(/^skill\./, ''));
    for (const internal of ['register', 'select', 'load', 'release', 'execute']) {
      assert.equal(verbs.includes(internal), false, `${label} publishes no "${internal}" operation`);
    }
  }

  // The decision this vocabulary was reconciled under is closed, and the modelling question it
  // was tangled up with is not.
  const resolved = DECISIONS.decisions.find((decision) => decision.id === SKILL_ALIGNMENT_DECISION);
  assert.equal(resolved.status, 'resolved', `${SKILL_ALIGNMENT_DECISION} is resolved by the finalize`);
  assert.equal(resolved.canonical.contract, `${SKILL_CONTRACT_ID}@${SKILL_CONTRACT_VERSION}`);
  assert.deepEqual(resolved.canonical.operations, [...SKILL_OPERATION_NAMES]);
  assert.deepEqual(resolved.canonical.notPublished, ['skill.register', 'skill.select', 'skill.load', 'skill.release']);
  const modelling = DECISIONS.decisions.find((decision) => decision.id === SKILL_DECLARATION_SOURCE.decision);
  assert.equal(modelling.status, 'open-for-manager', 'XA-11 stays open: the lock does not settle where Skill is modelled');
});

test('a stale decision or status is caught instead of rendered as truth', { skip }, () => {
  requireBackend();
  const publishedRow = skillLockRow();
  const alignment = DECISIONS.decisions.find((row) => row.id === SKILL_ALIGNMENT_DECISION);
  assert.ok(alignment, `${SKILL_ALIGNMENT_DECISION} is recorded`);
  assert.equal(alignment.status, 'resolved', 'the decision that reconciled this vocabulary is closed');
  assert.equal(SURFACE.alignment.decision, alignment.id, 'the manifest and the module cite one decision');
  assert.equal(SURFACE.alignment.status, 'resolved', 'and the manifest says so');
  assert.equal(vocabularyOf('skillLifecycle').provenance.contract.id, SKILL_CONTRACT_ID, 'the quoted sets name the published contract');
  // No stale pending claim survives anywhere in the manifest: the surface used to say its own
  // publication was open, and a resolved decision next to that sentence is exactly the rot this
  // test is for.
  assert.equal(JSON.stringify(SURFACE).includes('publicationPending'), false, 'no stale pending claim survives');
  assert.equal(JSON.stringify(SURFACE).includes('"planned"'), false, 'and no stale maturity claim does either');
  const modelling = DECISIONS.decisions.find((row) => row.id === SKILL_DECLARATION_SOURCE.decision);
  assert.equal(modelling.status, 'open-for-manager', 'the modelling question is still open');

  // The two records must agree: a published contract with a different version, owner or
  // operation set than the manifest quotes is a contradiction, not a difference of opinion.
  if (publishedRow !== null) {
    assert.equal(SURFACE.publication.version, publishedRow.version, `${SKILL_CONTRACT_ID} is published at ${publishedRow.version}`);
    assert.equal(SURFACE.publication.owner, publishedRow.owner);
    assert.deepEqual([...SURFACE.publication.operations], [...publishedRow.operations]);
  } else {
    assert.equal(overridden, false, `N8N_BACKEND_LEGO_ROOT is set but ${CONTRACT_LOCK} publishes no ai.skill row`);
  }

  // A version claimed by a file, against a surface with no publication row, is still not a
  // publication: it is reported as a claim and the contract stays uncomparable.
  const claimOnly = createSkillCatalog({
    surface: UNPUBLISHED_SURFACE,
    declaration: { id: 'skill', versioning: 'ai.skill@1.0.0', lifecycle: [...SKILL_LIFECYCLE] },
  });
  assert.equal(claimOnly.contract.published, false);
  assert.equal(claimOnly.contract.declaredVersion, '1.0.0');
  assert.equal(claimOnly.contract.status, 'declared-not-locked');
  assert.match(claimOnly.contract.detail, /a version claim is not a published contract/);

  // And the rendering follows the contract it is given, not a hardcoded "unpublished":
  // the moment a contract row exists the support state changes with it.
  const withContract = published();
  assert.equal(withContract.unsupported, null);
  assert.equal(withContract.availability, 'available');
  assert.equal(createSkillCatalog({ surface: SURFACE }).availability, 'available', 'a published contract with nothing to list is available, not absent');
  assert.equal(createSkillCatalog({ surface: UNPUBLISHED_SURFACE }).availability, 'optional-absent');

  // The declared status is quoted from the backend, so a status change is caught by the
  // comparison rather than by a reader noticing.
  assert.equal(skillDetail(published(), 'invoice-reconciliation').status, 'planned');
  const renamed = published({ skills: [entry({ status: 'shipping' })] });
  assert.equal(renamed.entries[0].validation.ok, false);
  assert.match(renamed.entries[0].validation.findings.join(' '), /"status" must be one of/);
});

test('compatibility is its own verdict: required, offered, comparable, satisfied', () => {
  const simple = entry({ skillId: 's', requiredCapabilities: ['ai.context'] });
  const available = published({ skills: [simple] });
  assert.equal(available.entries[0].availability, 'available');
  assert.deepEqual(
    { state: available.entries[0].compatibility.state, required: available.entries[0].compatibility.required, offered: available.entries[0].compatibility.offered, satisfied: available.entries[0].compatibility.satisfied },
    { state: 'unchanged', required: '1.0.0', offered: '1.0.0', satisfied: true },
  );

  // A requirement the consumer cannot satisfy, and a requirement nobody asked for: two
  // different verdicts, neither of them "available".
  const newer = published({ requiredVersion: '2.0.0' });
  assert.equal(newer.entries[0].compatibility.satisfied, false);
  assert.equal(newer.entries[0].compatibility.state, 'downgrade');
  assert.equal(newer.entries[0].compatibility.required, '2.0.0');
  assert.equal(newer.entries[0].compatibility.offered, '1.0.0');

  const unrequired = published({ requiredVersion: null });
  assert.equal(unrequired.entries[0].compatibility.state, 'not-required');
  assert.equal(unrequired.entries[0].compatibility.offered, '1.0.0');
  assert.equal(unrequired.entries[0].availability, 'available');

  // An unpublished contract cannot be compared, and the verdict says so instead of passing.
  const nothing = createSkillCatalog({ surface: UNPUBLISHED_SURFACE, skills: [simple] });
  assert.equal(nothing.entries[0].compatibility.state, 'uncomparable');
  assert.equal(nothing.entries[0].compatibility.satisfied, false);
  assert.equal(nothing.entries[0].compatibility.offered, null);
  assert.match(nothing.entries[0].compatibility.detail, /no contract-lock row publishing ai\.skill/);

  // With the contract published, an entry that requires no version is not "uncomparable" —
  // it is a different verdict, and the two must not be confused.
  const publishedNoRequirement = createSkillCatalog({ surface: SURFACE, declaration: null, skills: [simple] });
  assert.equal(publishedNoRequirement.entries[0].compatibility.state, 'not-required');
  assert.equal(publishedNoRequirement.entries[0].compatibility.offered, SKILL_CONTRACT_VERSION);

  // The verdict is rendered in the detail at the advanced level, with the required capability
  // list — and it carries no execution affordance.
  const detail = skillDetail(available, 's', { level: 'advanced' });
  assert.equal(detail.compatibility.state, 'unchanged');
  assert.deepEqual(detail.requiredCapabilities, ['ai.context']);
  assert.equal(detail.operations.every((operation) => operation.offered === false), true);
});

test('a trust level is a quoted word, and an invented one is refused', () => {
  assert.deepEqual(SKILL_TRUST_LEVELS, ['core', 'verified', 'community', 'untrusted']);
  assert.deepEqual(describeSkills().trustLevels, SKILL_TRUST_LEVELS);
  assert.equal(validateSkillInstance(entry({ trust: 'verified' })).ok, true);
  for (const level of SKILL_TRUST_LEVELS) {
    assert.equal(validateSkillInstance(entry({ trust: level })).ok, true, `${level} is a declared trust level`);
  }
  const invented = validateSkillInstance(entry({ trust: 'god-mode' }));
  assert.equal(invented.ok, false);
  assert.match(invented.findings.join(' '), /unknown trust level "god-mode"/);
  // The quoted set is compared with the declaration when the tree is present (the drift test),
  // and a declaration that carries neither the field nor the words is in sync by absence.
  assert.equal(declarationDrift({ declaration: { id: 'skill' } }).differences.length, 0);
  assert.deepEqual(declarationDrift({ declaration: { id: 'skill', trustLevels: [] } }).differences.map((difference) => difference.field), ['trustLevels']);
});

test('the surface is wired into the assembly, and the rule that guards it cites this suite', () => {
  const contract = read('contracts/frontend.contract.md');
  const block = contract.split('```json').map((part) => part.split('```')[0]).find((part) => part.includes('"A1"'));
  const rules = JSON.parse(block.slice(block.indexOf('[')));
  const rule = rules.find((entry) => entry.id === 'A27');
  assert.ok(rule, 'A27 is declared in the contract rule block');
  assert.equal(rule.enforcedBy, '31-skills.test.mjs');
  assert.equal(rule.contract, '§19.18');
  assert.match(rule.statement, /six quoted states/);
  assert.match(contract, /### 19\.18 The Skill surface/);

  // The assembly exposes the surface with the same discipline as the module: the published
  // contract is quoted, six states, four operations, and nothing to select or execute. With no
  // skills handed over there is no unsupported *answer* — a surface with nothing to show is not
  // an error state, and the canonical unsupported answer belongs to an unpublished contract
  // (covered above, against the pre-finalize surface shape).
  const frontend = createFrontendLego({ app: { name: 'n8n-lego', version: '0.1.0' } });
  assert.equal(frontend.skills.contract.published, true);
  assert.equal(frontend.skills.contract.version, SKILL_CONTRACT_VERSION);
  assert.equal(frontend.skills.contract.decision, SKILL_ALIGNMENT_DECISION);
  assert.equal(frontend.skills.unsupported, null);
  assert.deepEqual(frontend.searchSkills({}), []);
  assert.equal(frontend.skillDetail('invoice-reconciliation').state, 'capability-unavailable');
  assert.equal(frontend.skillDetail('invoice-reconciliation').reason.startsWith('no declared skill'), true);
  assert.equal(frontend.describeSkills().lifecycle.length, 6);
  assert.deepEqual(frontend.describeSkills().contractOperations, [...SKILL_OPERATION_NAMES]);
  assert.equal(frontend.describe().skillStates, 6);
  assert.equal(frontend.describe().skillsDeclared, 0);
  assert.equal(frontend.conformance().checks.find((check) => check.ruleId === 'A27').state, 'pass');
});

test('a declared version is reported without pretending the contract is published', () => {
  // The backend may move to `<contract>@<version>` in the file before the contract lock has
  // a row. The surface reports exactly that: the claim, the owner, and the missing lock.
  const claim = declaredVersionOf('ai.skill@1.0.0');
  assert.deepEqual(claim, { contract: 'ai.skill', version: '1.0.0' });
  assert.equal(declaredVersionOf('publicationPending'), null);
  assert.equal(declaredVersionOf('ai.skill@1.0'), null, 'a partial version is not a version');
  assert.equal(declaredVersionOf(undefined), null);

  const declared = {
    id: 'skill',
    owner: 'manager',
    status: 'implemented',
    lifecycle: [...SKILL_LIFECYCLE],
    operations: [...SKILL_OPERATIONS],
    permissions: [...SKILL_PERMISSIONS],
    disclosureLevels: Object.fromEntries(SKILL_DISCLOSURE_LEVELS.map((level) => [level, 'declared'])),
    versioning: 'ai.skill@1.0.0',
  };
  const unlocked = createSkillCatalog({ surface: UNPUBLISHED_SURFACE, declaration: declared, skills: [entry()] });
  assert.equal(unlocked.contract.published, false, 'a claim in a file is not a published contract');
  assert.equal(unlocked.contract.version, null, 'nothing is locked, so there is no version to bind to');
  assert.equal(unlocked.contract.declaredVersion, '1.0.0', 'but the claim is reported');
  assert.equal(unlocked.contract.status, 'declared-not-locked');
  assert.match(unlocked.contract.detail, /a version claim is not a published contract/);
  assert.equal(unlocked.unsupported.contract.declaredVersion, '1.0.0');
  assert.equal(unlocked.availability, 'optional-absent');

  const locked = createSkillCatalog({
    surface: SURFACE,
    declaration: declared,
    contract: { id: SKILL_CONTRACT_ID, version: '1.0.0', owner: 'manager' },
    skills: [entry()],
    requiredVersion: '1.0.0',
    declaredCapabilities: ['ai.context'],
  });
  assert.equal(locked.contract.published, true);
  assert.equal(locked.contract.version, '1.0.0');
  assert.equal(locked.contract.declaredVersion, '1.0.0');
  assert.equal(locked.contract.comparable, true);
  assert.equal(locked.unsupported, null);
  assert.equal(locked.availability, 'available');
  assert.equal(locked.entries[0].availability, 'available');
  // And a locked contract still decides compatibility by its own version, not by the claim.
  const newer = createSkillCatalog({
    surface: SURFACE,
    declaration: declared,
    contract: { id: SKILL_CONTRACT_ID, version: '0.9.0', owner: 'manager' },
    skills: [entry()],
    requiredVersion: '1.0.0',
    declaredCapabilities: ['ai.context'],
  });
  assert.equal(newer.entries[0].availability, 'version-incompatible');
});

test('a declaration that moved is reported as drift, never adopted silently', { skip: driftSkip }, () => {
  requireBackend();
  assert.ok(existsSync(SKILL_MANIFEST), `${SKILL_MANIFEST} does not exist — the pointed-at tree publishes no Skill manifest`);
  assert.ok(existsSync(LEGO_SET), `${LEGO_SET} does not exist`);
  const publishedSkill = JSON.parse(readFileSync(SKILL_MANIFEST, 'utf8'));
  const legos = backendSkill();
  const lockRows = (() => {
    const lock = JSON.parse(readFileSync(CONTRACT_LOCK, 'utf8'));
    return Array.isArray(lock) ? lock : (lock.contracts ?? []);
  })();
  const lockedRow = lockRows.find((row) => (row.id ?? row.contract) === SKILL_CONTRACT_ID) ?? null;

  // 1. The vocabulary a published Skill contract fixes agrees with the words this package
  //    quotes: the six states, the four disclosure levels, the two permission words and the
  //    contract identity. If any of those disagreed, the frontend would be quoting a
  //    different contract and no amount of drift reporting would make that safe.
  assert.equal(publishedSkill.contract, SKILL_CONTRACT_ID);
  assert.deepEqual(publishedSkill.lifecycle.states, SKILL_LIFECYCLE, 'the six states agree');
  assert.deepEqual(Object.keys(publishedSkill.disclosure.levels), SKILL_DISCLOSURE_LEVELS, 'the disclosure levels agree');
  assert.deepEqual(publishedSkill.permissions, SKILL_PERMISSIONS, 'the permission words agree');
  assert.ok(publishedSkill.isNot.join(' ').match(/tool executor|permission grant/), 'the contract says what a skill is not');

  /**
   * The contract manifest spells the same vocabulary in its own schema: `lifecycle.states`,
   * `operations[].name` (qualified), `disclosure.levels`, `trustLevels` as a map. Projecting it
   * onto the field names the comparison reads is not paraphrase — every value is carried over
   * unchanged — and it is what makes "the manifest agrees" a checkable statement rather than an
   * impression.
   */
  const asDeclaredFields = (manifest) => ({
    id: 'skill',
    lifecycle: manifest.lifecycle.states,
    operations: manifest.operations.map((operation) => operation.name.replace(/^skill\./, '')),
    permissions: manifest.permissions,
    disclosureLevels: manifest.disclosure.levels,
    trustLevels: Object.keys(manifest.trustLevels),
    versioning: `${manifest.contract}@${manifest.version}`,
  });

  // 2. The declaration handed over as data is compared, and the difference is named — in both
  //    directions (the LEGO-level block, and the contract manifest projected onto the same fields).
  for (const [label, declaration] of [['ai-lego-set.json#id=skill', legos], ['manifest/skill.json', asDeclaredFields(publishedSkill)]]) {
    const catalog = createSkillCatalog({ surface: SURFACE, declaration, contract: lockedRow, skills: [entry()] });
    const fields = catalog.drift.differences.map((difference) => difference.field);
    if (skillLockRow() === null) {
      // The pointed-at tree predates the finalize: the difference is the historical one XA-19
      // was opened for — reported as data, never adopted.
      assert.ok(catalog.drift.differences.every((difference) => difference.quoted.length > 0 || difference.declared.length > 0), `${label}: a difference names both sides`);
      assert.ok(catalog.drift.rule.includes('never resolved locally'), `${label}: the rule is stated`);
    } else {
      // XA-19 is resolved: the declaration and the quote agree, exactly and in both directions.
      assert.deepEqual(fields, [], `${label}: a difference is reported although the published declaration agrees`);
      assert.equal(catalog.drift.state, 'in-sync', `${label}: the quoted vocabulary is the published one`);
    }
    // Whatever moved, the rendering follows the lock and nothing else.
    assert.equal(catalog.contract.published, lockedRow !== null, `${label}: publication follows the lock, not the file`);
    assert.equal(catalog.discovery.select, false);
    assert.equal(catalog.discovery.load, false);
    assert.equal(catalog.discovery.execute, false);
    assert.equal(catalog.discovery.tools, false);
    for (const offered of skillDetail(catalog, 'invoice-reconciliation').operations ?? []) {
      assert.equal(offered.offered, false, `${label}: no operation is offered by the UI`);
    }
  }

  // 3. Every difference the comparison can produce is registered, so a drift cannot be
  //    discovered only by a reader of the test output.
  const row = DECISIONS.decisions.find((decision) => decision.id === 'XA-19');
  assert.ok(row, 'the cross-agent alignment finding is recorded');
  assert.equal(row.status, 'resolved', 'and it is resolved by the finalize');
  assert.match(`${row.historicalFinding ?? ''} ${row.resolution}`, /operations/, 'the row names the field that differed');
  assert.match(JSON.stringify(row), /31-skills\.test\.mjs|vocabulary\.mjs/, 'and cites the frontend side it was reconciled with');
  assert.ok((row.canonical?.operations ?? []).length === 4, 'the resolution names the canonical four');
  assert.equal(SKILL_ALIGNMENT_DECISION, row.id);
  assert.equal(SURFACE.alignment?.decision ?? null, row.id, 'the surface declaration names the same row');
  assert.equal(SURFACE.alignment?.status ?? null, 'resolved', 'and carries its resolved state');
  assert.match(SURFACE.alignment?.openQuestion ?? '', /XA-11/, 'while naming the question the finalize did not settle');
});
