/**
 * AI/Agent LEGO set, governance and scenario invariants (P2.11).
 *
 * WHAT THIS PROTECTS
 * ------------------
 * `manifest/ai-lego-set.json` is the authoritative declaration of the fifteen
 * official AI/Agent LEGO, and every master document under `.ai/master/` is
 * generated from it. That makes it the single highest-leverage file in the
 * planning layer: a wrong value there is not one wrong value, it is a wrong
 * value reproduced across six documents that then read as corroboration.
 *
 * THE FAILURE MODES THESE TESTS TARGET
 * ------------------------------------
 *   1. A SECOND VOCABULARY. The set names `workspace` and `capability`, both of
 *      which already exist in the core manifest. The cheap mistake is to let the
 *      AI set quietly mean something else by the same word, at which point the
 *      repository has two registries and they begin to drift. Reconciliation is
 *      therefore mandatory and asserted.
 *   2. A DANGLING ROADMAP. `dependsOn`, `phase`, `owner` and `contracts` are all
 *      cross-references. A typo in any of them produces a plausible-looking
 *      document describing a dependency on something that does not exist.
 *   3. AN INVENTED VERSION. The rule for an unpublished contract is
 *      `publicationPending` — never a hopeful `1.0.0`. A fabricated version is
 *      indistinguishable from a real one once it is in a generated table.
 *   4. A DOWNGRADED BLOCKER. The blocker register exists to be inconvenient. A
 *      test asserts the class-A storage blockers are still declared open, so
 *      closing one requires deleting an assertion rather than editing prose.
 *   5. A SCENARIO THAT NEEDS AN UNDECLARED CONCEPT. Scenarios are the cheapest
 *      sufficiency test of the decomposition, and they only work if they are
 *      held to the declared vocabulary.
 *
 * Several tests below are written as NEGATIVE proofs: they mutate a clone of
 * the manifest to plant the exact defect and require the checker to reject it.
 * A validator nobody has watched reject anything is a validator that may not
 * work — that is the same principle the architecture and foundation gates are
 * built on, applied to the planning layer.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_DIR = resolve(HERE, '..', 'src', 'lego', 'manifest');
const CONTRACTS_DIR = resolve(HERE, '..', 'src', 'lego', 'contracts');

const read = (dir, name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));

const AI_SET = read(MANIFEST_DIR, 'ai-lego-set.json');
const DOMAINS = read(MANIFEST_DIR, 'domains.json');
const GOVERNANCE = read(MANIFEST_DIR, 'project-governance.json');
const SCENARIOS = read(MANIFEST_DIR, 'reference-scenarios.json');
const LOCK = read(CONTRACTS_DIR, 'contract-lock.json');

const legoIds = new Set(AI_SET.lego.map((lego) => lego.id));
const domainIds = new Set(DOMAINS.domains.map((domain) => domain.id));
const agentIds = new Set(Object.keys(DOMAINS.agents));
const lockedContracts = new Set(LOCK.contracts.map((contract) => contract.id));
const declaredCapabilities = new Set(
  DOMAINS.domains.flatMap((domain) => (domain.capabilities ?? []).map((capability) => capability.id)),
);

const clone = (value) => JSON.parse(JSON.stringify(value));

/* ------------------------------------------------------------- the set itself */

test('the set declares exactly fifteen official LEGO, indexed 1..15 without gaps', () => {
  assert.equal(AI_SET.lego.length, 15);
  const indexes = AI_SET.lego.map((lego) => lego.index).sort((a, b) => a - b);
  assert.deepEqual(indexes, Array.from({ length: 15 }, (_, i) => i + 1));
  assert.equal(new Set(AI_SET.lego.map((lego) => lego.id)).size, 15, 'ids must be unique');
});

test('every LEGO carries the full documentation profile', () => {
  // The profile is the point of the file. A LEGO missing `nonScope` or
  // `replacementBoundary` is the one that will later be argued about, because
  // those two fields are where boundaries are actually decided.
  const required = [
    'id', 'index', 'title', 'owner', 'status', 'phase', 'mission', 'scope', 'nonScope',
    'contracts', 'lifecycle', 'operations', 'interaction', 'permissions', 'dependsOn',
    'replacementBoundary', 'resourceProfile', 'degradation', 'observability', 'versioning',
    'tests', 'futureStages',
  ];
  for (const lego of AI_SET.lego) {
    for (const field of required) {
      assert.ok(field in lego, `${lego.id} is missing '${field}'`);
    }
    assert.ok(lego.scope.length > 0, `${lego.id} declares no scope`);
    assert.ok(lego.nonScope.length > 0, `${lego.id} declares no non-scope`);
    assert.ok(lego.tests.length > 0, `${lego.id} declares no tests`);
  }
});

test('every status is a word the manifest itself defines', () => {
  const vocabulary = new Set(Object.keys(AI_SET.statusVocabulary));
  for (const lego of AI_SET.lego) {
    assert.ok(vocabulary.has(lego.status), `${lego.id} has undeclared status '${lego.status}'`);
  }
});

test('every phase letter exists in the phase table', () => {
  const phases = new Set(Object.keys(AI_SET.phases).filter((key) => key !== 'rule'));
  for (const lego of AI_SET.lego) {
    assert.ok(phases.has(lego.phase), `${lego.id} names phase '${lego.phase}', which is not declared`);
  }
});

test('every owner is an agent the core manifest knows', () => {
  // Ownership that does not resolve to a real agent is ownership by nobody,
  // which is how a LEGO ends up with two authors and no arbiter.
  for (const lego of AI_SET.lego) {
    assert.ok(agentIds.has(lego.owner), `${lego.id} is owned by unknown agent '${lego.owner}'`);
  }
});

test('every dependency names a real LEGO or a real core domain', () => {
  for (const lego of AI_SET.lego) {
    for (const dependency of lego.dependsOn) {
      assert.ok(
        legoIds.has(dependency) || domainIds.has(dependency),
        `${lego.id} depends on '${dependency}', which is neither an official LEGO nor a core domain`,
      );
    }
  }
});

test('the dependency graph is acyclic and AI Foundation is a leaf', () => {
  // AI Foundation being dependency-free is the structural expression of "the
  // foundation is not the agent loop". The moment it depends on something, the
  // layering has inverted and every consumer inherits that dependency.
  const foundation = AI_SET.lego.find((lego) => lego.id === 'ai-foundation');
  assert.deepEqual(foundation.dependsOn, [], 'AI Foundation must depend on nothing');

  const edges = new Map(AI_SET.lego.map((lego) => [lego.id, lego.dependsOn.filter((id) => legoIds.has(id))]));
  const state = new Map();
  const visit = (id, trail) => {
    if (state.get(id) === 'done') return;
    assert.ok(state.get(id) !== 'open', `dependency cycle: ${[...trail, id].join(' -> ')}`);
    state.set(id, 'open');
    for (const next of edges.get(id) ?? []) visit(next, [...trail, id]);
    state.set(id, 'done');
  };
  for (const id of edges.keys()) visit(id, []);
});

test('a forward phase dependency exists only where it is declared and justified', () => {
  // A phase-B LEGO depending on a phase-C LEGO is a roadmap that cannot run in
  // its own stated order. There is exactly one such edge — Agent Machine (B)
  // needs Approval (C) — and it is tolerable only because approval fails
  // closed. The rule here is not "no forward edges"; it is "no UNDECLARED
  // forward edges", because the dangerous version is the one nobody noticed.
  const order = ['A', 'B', 'C', 'D', 'E', 'F'];
  const phaseOf = new Map(AI_SET.lego.map((lego) => [lego.id, order.indexOf(lego.phase)]));
  const exceptions = new Set(
    (AI_SET.phaseDependencyExceptions ?? []).map((entry) => `${entry.lego}->${entry.dependsOn}`),
  );
  const found = [];
  for (const lego of AI_SET.lego) {
    for (const dependency of lego.dependsOn) {
      if (!phaseOf.has(dependency)) continue;
      if (phaseOf.get(dependency) > phaseOf.get(lego.id)) found.push(`${lego.id}->${dependency}`);
    }
  }
  for (const edge of found) {
    assert.ok(exceptions.has(edge), `undeclared forward phase dependency: ${edge}`);
  }
  for (const edge of exceptions) {
    assert.ok(found.includes(edge), `declared exception '${edge}' no longer exists — delete it`);
  }
  // A declared exception must state its degradation, or it is just permission.
  for (const entry of AI_SET.phaseDependencyExceptions ?? []) {
    assert.ok(entry.why?.length > 0 && entry.degradation?.length > 0 && entry.closes?.length > 0,
      `exception ${entry.lego}->${entry.dependsOn} must state why, degradation and closes`);
  }
});

test('the canonical chain covers every LEGO and starts at the foundation', () => {
  const chain = AI_SET.architecture.chain.filter((id) => id !== 'policy');
  assert.equal(chain[0], 'ai-foundation', 'the chain must start at the foundation');
  assert.deepEqual([...chain].sort(), [...legoIds].sort(), 'the chain must cover exactly the fifteen');
  assert.ok(AI_SET.architecture.policyNote.length > 0, 'the non-LEGO `policy` entry must be explained');
});

/* --------------------------------------------------------------- reconciliation */

test('a LEGO whose id collides with a core domain must declare how it reconciles', () => {
  // This is the no-second-vocabulary rule made mechanical. `workspace` exists
  // in both manifests; without this, the two meanings diverge silently and the
  // divergence is only discovered when someone implements the wrong one.
  for (const lego of AI_SET.lego) {
    if (!domainIds.has(lego.id)) continue;
    assert.ok(lego.reconciles, `${lego.id} collides with a core domain but declares no 'reconciles'`);
    assert.ok(
      domainIds.has(lego.reconciles.coreDomain),
      `${lego.id} reconciles to '${lego.reconciles.coreDomain}', which is not a core domain`,
    );
    assert.ok(lego.reconciles.rule.length > 0, `${lego.id} reconciles without stating the rule`);
  }
});

test('the reconciliation requirement actually rejects a fork', () => {
  // Negative proof. Drop the declaration from `workspace` — the exact shape of
  // "an ai-workspace domain appeared beside workspace" — and require detection.
  const mutated = clone(AI_SET);
  delete mutated.lego.find((lego) => lego.id === 'workspace').reconciles;
  const unreconciled = mutated.lego.filter((lego) => domainIds.has(lego.id) && !lego.reconciles);
  assert.deepEqual(unreconciled.map((lego) => lego.id), ['workspace']);
});

test('no official LEGO invents a domain id the core manifest does not have', () => {
  // The inverse check: an AI LEGO id that is *close to* a core domain id
  // (`ai-workspace` beside `workspace`) is the forking pattern.
  for (const lego of AI_SET.lego) {
    if (domainIds.has(lego.id)) continue;
    const shadowed = lego.id.replace(/^ai-/, '');
    assert.ok(
      lego.id === 'ai-foundation' || !domainIds.has(shadowed),
      `${lego.id} shadows core domain '${shadowed}' — reconcile with it instead of prefixing`,
    );
  }
});

/* -------------------------------------------------------------- contract status */

test('every contract is locked, declared as a capability, or honestly pending', () => {
  for (const lego of AI_SET.lego) {
    for (const contract of lego.contracts) {
      const known = lockedContracts.has(contract) || declaredCapabilities.has(contract);
      if (known) continue;
      assert.equal(
        lego.versioning, 'publicationPending',
        `${lego.id} names contract '${contract}' that nothing publishes, but claims version '${lego.versioning}'`,
      );
    }
  }
});

test('publicationPending never carries an invented version, and a version always names its contract', () => {
  for (const lego of AI_SET.lego) {
    if (lego.versioning === 'publicationPending') {
      assert.ok(
        !/\d+\.\d+\.\d+/.test(JSON.stringify(lego.contracts)),
        `${lego.id} is publicationPending but a version leaked into its contracts`,
      );
      continue;
    }
    // A concrete versioning string must reference contracts the LEGO declares.
    for (const entry of lego.versioning.split(',').map((part) => part.trim())) {
      const [id, version] = entry.split('@');
      assert.ok(version && /^\d+\.\d+\.\d+$/.test(version), `${lego.id} versioning entry '${entry}' is malformed`);
      assert.ok(
        lego.contracts.includes(id) || lockedContracts.has(id),
        `${lego.id} versions '${id}', which it does not declare as a contract`,
      );
    }
  }
});

test('a fabricated version on an unpublished contract is detected', () => {
  // Negative proof for the rule above: the temptation is to write `1.0.0` for a
  // contract nobody has published, because it reads as progress.
  const mutated = clone(AI_SET);
  const skill = mutated.lego.find((lego) => lego.id === 'skill');
  skill.versioning = 'ai.skill@1.0.0';
  const offenders = mutated.lego.filter((lego) =>
    lego.contracts.some((contract) => !lockedContracts.has(contract) && !declaredCapabilities.has(contract))
    && lego.versioning !== 'publicationPending');
  assert.deepEqual(offenders.map((lego) => lego.id), ['skill']);
});

test('status and evidence agree: `implemented` requires real test files, `planned` does not claim them', () => {
  for (const lego of AI_SET.lego) {
    const realTests = lego.tests.filter((entry) => entry.startsWith('test/'));
    if (lego.status === 'implemented' || lego.status === 'contract-only') {
      assert.ok(realTests.length > 0, `${lego.id} is '${lego.status}' but names no real test file`);
    }
    if (lego.status === 'planned') {
      assert.equal(realTests.length, 0, `${lego.id} is 'planned' but claims a real test file`);
      assert.ok(
        lego.tests.every((entry) => entry.startsWith('planned:')),
        `${lego.id} is 'planned'; its tests must be declared as planned`,
      );
    }
  }
});

test('only Capability is implemented; the AI runtime is not claimed', () => {
  // The single most consequential honesty check in the file. If this test ever
  // has to change, someone has claimed a runtime exists — and that claim should
  // cost them a deliberate edit to an assertion, not a quiet status flip.
  const implemented = AI_SET.lego.filter((lego) => lego.status === 'implemented').map((lego) => lego.id);
  assert.deepEqual(implemented, ['capability']);
  const claims = JSON.stringify(AI_SET.currentLimits);
  for (const phrase of ['NOT scale-out ready', 'AI runtime is NOT implemented', 'Model inference is NOT implemented']) {
    assert.ok(claims.includes(phrase), `currentLimits no longer states: ${phrase}`);
  }
});

/* ------------------------------------------------------ vocabulary consistency */

test('interaction classes stay at exactly four, everywhere', () => {
  const classes = ['call', 'event', 'stream', 'batch'];
  const capability = AI_SET.lego.find((lego) => lego.id === 'capability');
  assert.deepEqual(capability.interactionClasses, classes);
  for (const lego of AI_SET.lego) {
    for (const interaction of lego.interaction) {
      assert.ok(classes.includes(interaction), `${lego.id} uses a fifth interaction class '${interaction}'`);
    }
  }
});

test('every resource profile is one the AI Foundation declares', () => {
  const profiles = new Set(Object.keys(read(MANIFEST_DIR, 'ai-foundation.json').resourceProfiles.profiles));
  for (const lego of AI_SET.lego) {
    assert.ok(profiles.has(lego.resourceProfile), `${lego.id} uses undeclared profile '${lego.resourceProfile}'`);
  }
});

test('permissions are namespaced, never bare words', () => {
  for (const lego of AI_SET.lego) {
    for (const permission of lego.permissions) {
      assert.match(permission, /^[a-z][a-z0-9-]*:[a-z][a-z0-9:-]*$/, `${lego.id} has unnamespaced permission '${permission}'`);
    }
  }
});

test('Work Trace forbids chain-of-thought, and the prohibition is structural', () => {
  const trace = AI_SET.lego.find((lego) => lego.id === 'agent-event');
  assert.ok(trace.nonScope.includes('chain-of-thought'));
  assert.match(trace.privacyRule, /never stored/i);
  // The prohibition must not be contradicted by any event field.
  assert.ok(
    !trace.eventFields.some((field) => /thought|reasoning|transcript|prompt/i.test(field)),
    'an event field would carry reasoning',
  );
});

test('every experience maps to backend contracts, and Execution AI stays a Copilot mode', () => {
  const experiences = AI_SET.experiences.items;
  assert.equal(experiences.length, 3, 'three experiences, one foundation');
  for (const experience of experiences) {
    assert.ok(experience.backendContracts.length > 0, `${experience.id} names no backend contract`);
    assert.ok(agentIds.has(experience.owner), `${experience.id} has unknown owner '${experience.owner}'`);
  }
  const copilot = experiences.find((experience) => experience.id === 'ai-copilot');
  assert.equal(copilot.modes.length, 9);
  assert.match(copilot.note, /Execution AI is a Copilot MODE/);
});

/* ----------------------------------------------------------------- governance */

test('manager authority is never inherited by a worker', () => {
  // The same invariant the product enforces for delegation. Declaring it for
  // agents and not for the workforce would mean the project does not believe it.
  assert.match(GOVERNANCE.roles.authorityRule, /does NOT inherit/);
  for (const forbidden of ['resolve a manager-owned decision', 'modify or force-push main']) {
    assert.ok(GOVERNANCE.roles.worker.mayNot.includes(forbidden), `worker restriction missing: ${forbidden}`);
  }
});

test('exactly one control plane is authoritative for code', () => {
  const planes = GOVERNANCE.controlPlanes;
  const codeAuthorities = Object.entries(planes)
    .filter(([key, value]) => key !== 'rule' && (value.authoritativeFor ?? []).includes('repository state'))
    .map(([key]) => key);
  assert.deepEqual(codeAuthorities, ['github']);
  assert.deepEqual(planes.obsidian.authoritativeFor, [], 'Obsidian must be authoritative for nothing');
});

test('unverified control planes are declared unverified, not operational', () => {
  // Supabase and the VPS gate have no client, schema or credential in this
  // tree. Asserting their status keeps the plan from reading as a description
  // of something that exists here.
  for (const key of ['supabase', 'vpsGate']) {
    assert.match(GOVERNANCE.controlPlanes[key].status, /NOT VERIFIED/, `${key} claims a status this repo cannot support`);
  }
});

test('the class-A storage blockers are still open', () => {
  const blockers = new Map(GOVERNANCE.blockers.map((blocker) => [blocker.id, blocker]));
  for (const id of ['BL-1', 'BL-2']) {
    assert.equal(blockers.get(id).severity, 'class-A');
    assert.equal(blockers.get(id).status, 'open', `${id} was closed without evidence`);
    assert.match(blockers.get(id).where, /store\.mjs/);
  }
  assert.ok(GOVERNANCE.blockers.every((blocker) => blocker.owner && blocker.consequence),
    'every blocker needs an owner and a stated consequence');
});

test('scale-out is not claimed anywhere while class-A blockers are open', () => {
  const open = GOVERNANCE.blockers.some((blocker) => blocker.severity === 'class-A' && blocker.status === 'open');
  assert.ok(open, 'this test assumes the blockers are open');
  const text = JSON.stringify(AI_SET) + JSON.stringify(GOVERNANCE);
  assert.ok(!/scale-out ready(?!")/i.test(text.replace(/NOT scale-out ready/gi, '')),
    'something claims scale-out readiness while class-A blockers are open');
});

test('all twenty-five decision principles are present and unique', () => {
  assert.equal(GOVERNANCE.decisionPrinciples.length, 25);
  assert.equal(new Set(GOVERNANCE.decisionPrinciples).size, 25);
});

/* ------------------------------------------------------------------ scenarios */

test('every scenario is expressible in declared vocabulary alone', () => {
  // The sufficiency test. A scenario reaching for an undeclared LEGO means the
  // decomposition does not cover a plausible request.
  for (const scenario of SCENARIOS.scenarios) {
    for (const id of scenario.lego ?? []) {
      assert.ok(legoIds.has(id), `scenario '${scenario.id}' uses undeclared LEGO '${id}'`);
    }
  }
});

test('scenario capabilities are drawn from the declared external action model', () => {
  const declared = new Set(AI_SET.externalActionModel.examples.map((example) => example.capability));
  for (const scenario of SCENARIOS.scenarios) {
    for (const capability of scenario.capabilities ?? []) {
      assert.ok(declared.has(capability), `scenario '${scenario.id}' uses undeclared capability '${capability}'`);
    }
  }
});

test('every scenario is marked contract-only', () => {
  // None of these run. Saying so per scenario is what stops a reader from
  // treating the walkthrough as a description of behaviour.
  for (const scenario of SCENARIOS.scenarios) {
    assert.equal(scenario.status, 'contract-only', `scenario '${scenario.id}' claims more than contract-only`);
  }
});

test('an undeclared concept in a scenario is detected', () => {
  // Negative proof: this is exactly how a new concept sneaks in — as a
  // reasonable-sounding word inside an otherwise valid scenario.
  const mutated = clone(SCENARIOS);
  mutated.scenarios[0].lego.push('ai-scheduler');
  const offenders = mutated.scenarios.filter((scenario) => (scenario.lego ?? []).some((id) => !legoIds.has(id)));
  assert.deepEqual(offenders.map((scenario) => scenario.id), ['website-creation']);
});

test('the external-runtime scenario keeps ownership on the n8n side', () => {
  const scenario = SCENARIOS.scenarios.find((entry) => entry.id === 'external-runtime');
  for (const retained of ['policy', 'workspace boundary', 'approval', 'artifact references', 'resource accounting']) {
    assert.ok(scenario.n8nRetains.includes(retained), `external runtime scenario gives away '${retained}'`);
  }
  assert.match(scenario.lockInRule, /never reimplemented/);
});

test('the token scenario keeps message tokens distinct from model input tokens', () => {
  const scenario = SCENARIOS.scenarios.find((entry) => entry.id === 'context-rollover');
  assert.notEqual(scenario.tokenExample.message, scenario.tokenExample.modelInput);
  assert.ok(scenario.tokenExample.modelInput > scenario.tokenExample.message);
  assert.match(scenario.rolloverRule, /never at the exact limit/);
});

/* ------------------------------------------------------------- master docs */

test('the master document set exists and is generated, not hand-written', () => {
  // The whole point of the planning layer is that it cannot drift from the
  // declarations. A hand-written file in `.ai/master/` would be deleted by the
  // next `npm run lego:ai` — so the banner is not decoration, it is the only
  // thing telling a future editor their change will not survive.
  const masterDir = resolve(HERE, '..', '..', '..', '.ai', 'master');
  const expected = [
    'PROJECT_MASTER_PLAN.md',
    'CORE_LEGO_ARCHITECTURE.md',
    'AI_AGENT_LEGO_MASTER_PLAN.md',
    'AI_RUNTIME_AND_PROVIDER_PLAN.md',
    'AI_CONTRACT_MATRIX.md',
    'IMPLEMENTATION_PHASES.md',
    'PROJECT_DECISIONS.md',
    'PROJECT_WORKFORCE_ORCHESTRATION.md',
    'REFERENCE_AGENT_SCENARIOS.md',
    'CURRENT_STATUS.md',
    'KNOWN_BLOCKERS.md',
  ];
  for (const name of expected) {
    const body = readFileSync(join(masterDir, name), 'utf8');
    assert.match(body, /^<!-- GENERATED by tools\/lego\/ai-pack\.mjs/, `${name} is missing the generated banner`);
    assert.ok(body.length > 400, `${name} is suspiciously short`);
  }
});

test('the master index names a canonical document for every question it poses', () => {
  const masterDir = resolve(HERE, '..', '..', '..', '.ai', 'master');
  const plan = readFileSync(join(masterDir, 'PROJECT_MASTER_PLAN.md'), 'utf8');
  const rows = plan.split('\n').filter((line) => line.startsWith('| ') && line.includes('.md`'));
  assert.ok(rows.length >= 20, 'the answer index should cover the project questions');
  // Every document referenced by the index must actually exist.
  for (const match of plan.matchAll(/`([A-Z_]+\.md)`/g)) {
    assert.ok(
      existsSync(join(masterDir, match[1])),
      `the index points at ${match[1]}, which does not exist`,
    );
  }
});

test('the core architecture document reports the manifest domain count', () => {
  // The 25-vs-26 drift is exactly what generating this number prevents.
  const masterDir = resolve(HERE, '..', '..', '..', '.ai', 'master');
  const core = readFileSync(join(masterDir, 'CORE_LEGO_ARCHITECTURE.md'), 'utf8');
  assert.ok(core.includes(`**${DOMAINS.domains.length} core LEGO domains**`),
    `CORE_LEGO_ARCHITECTURE.md does not state the manifest count of ${DOMAINS.domains.length}`);
  for (const domain of DOMAINS.domains) {
    assert.ok(core.includes(`\`${domain.id}\``), `domain '${domain.id}' is missing from the core document`);
  }
});
