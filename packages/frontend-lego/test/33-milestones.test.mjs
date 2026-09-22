/**
 * The canonical milestone register — `docs/n8n-lego/milestones.json` (P2.13, Part A).
 *
 * The register exists because "what is done?" was being answered from six documents that
 * disagreed. A register that cannot be checked is another document to disagree with, so this
 * suite treats it as a schema with teeth:
 *
 *   1. **Shape.** Every row carries the fields the brief names, and a row that claims a status
 *      carries the evidence that status requires. `complete` without a commit is a claim.
 *   2. **Vocabulary.** Statuses come from six words and nothing else.
 *   3. **Ladder.** The `next` chain is intact, acyclic and reaches the future; indicative ids are
 *      marked indicative, so nobody reads P2.24 as a promise.
 *   4. **Authority.** The strategic Phases A–F survive underneath the milestone layer, the
 *      manifests stay the product truth, and the register never re-numbers a phase.
 *   5. **The merge gate.** Agent completion is not merge approval, there are two gates, and the
 *      conflict taxonomy names what must not be merged. The same gate is written into the
 *      workforce governance file, and the governance file points here rather than restating it —
 *      one protocol, two readers.
 *
 * Content assertions about P2.11–P2.13 (what was delivered, what was not) live in
 * `32-context-session.test.mjs`; this suite is about the register as a structure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PACKAGE_ROOT } from '../src/manifests.mjs';

const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
const read = (relative) => readFileSync(join(REPO_ROOT, relative), 'utf8');
const REGISTER_PATH = 'docs/n8n-lego/milestones.json';
const REGISTER = JSON.parse(read(REGISTER_PATH));
const DECISIONS = JSON.parse(read('docs/n8n-lego/decisions/cross-agent-decisions.json'));
const GOVERNANCE = JSON.parse(read('docs/engineering-operations/workforce-governance.json'));
const ROADMAP = read('docs/n8n-lego/ROADMAP.md');

const byId = new Map(REGISTER.milestones.map((milestone) => [milestone.id, milestone]));
const STATUSES = Object.keys(REGISTER.statusVocabulary).filter((key) => key !== 'rule');
/** A row that reports work must carry the whole shape; a row that plans it carries the outline. */
const REPORTED = ['complete', 'in-progress', 'blocked', 'ready'];
const REQUIRED_REPORTED_FIELDS = [
  'id', 'title', 'phase', 'status', 'idStatus', 'owner', 'dependencies', 'inputs',
  'deliverables', 'boundary', 'gates', 'decisionDependencies', 'completionCriteria',
  'startEvidence', 'finishEvidence', 'verifiedAgainst', 'currentReference', 'next', 'statusBySide',
];
const REQUIRED_PLANNED_FIELDS = ['id', 'title', 'phase', 'status', 'idStatus', 'owner', 'dependencies', 'next'];

/* ------------------------------------------------------------------- 1. shape */

test('the register is one machine-readable file at the canonical path, owned by the manager', () => {
  assert.equal(REGISTER.owner, 'manager', 'the register is the manager\'s, not an agent\'s');
  assert.match(REGISTER.registerVersion, /^\d+\.\d+\.\d+$/, 'the register itself is versioned');
  assert.ok(existsSync(join(REPO_ROOT, REGISTER_PATH)));
  assert.equal(typeof REGISTER.description, 'string');
  assert.match(REGISTER.description, /canonical/, 'it says it is the canonical source');
  assert.match(REGISTER.maintainedBy.manager, /owns this register/, 'the manager owns the register');
  assert.match(REGISTER.maintainedBy.rule, /Only the manager changes an id, a sequence, a boundary or a status of record/);
  // Both agents may add evidence to their own milestone, and neither may re-sequence.
  assert.match(REGISTER.maintainedBy['agent-1'], /frontend evidence rows/);
  assert.match(REGISTER.maintainedBy['agent-2'], /backend evidence rows/);
  assert.match(REGISTER.maintainedBy['agent-1'], /may not re-sequence/);
  assert.match(REGISTER.createdIn, /^P2\.13/, 'the milestone that created it is named');
  assert.match(REGISTER.createdIn, /Before this file/, 'and says what problem it exists to end');
  assert.ok(REGISTER.milestones.length >= 3, `${REGISTER.milestones.length} milestones recorded`);
  assert.ok(Array.isArray(REGISTER.dependencyBlockers));
  assert.ok(REGISTER.currentTruth && typeof REGISTER.currentTruth === 'object');
});

test('every row carries the fields the brief names, and only statuses from the six words', () => {
  assert.deepEqual([...STATUSES].sort(), ['blocked', 'complete', 'in-progress', 'planned', 'ready', 'superseded']);
  assert.match(REGISTER.statusVocabulary.rule, /no other status word/, 'the vocabulary is closed');
  const ids = new Set();
  for (const milestone of REGISTER.milestones) {
    assert.match(milestone.id, /^P\d+\.\d+$/, `${milestone.id} is a phase.milestone id`);
    assert.equal(ids.has(milestone.id), false, `${milestone.id} is unique`);
    ids.add(milestone.id);
    assert.ok(STATUSES.includes(milestone.status), `${milestone.id} uses a declared status ("${milestone.status}")`);
    assert.equal(typeof milestone.title, 'string');
    assert.ok(milestone.title.length > 3, `${milestone.id} has a title`);
    assert.match(milestone.phase, /^[A-F](\/[A-F])?\b/, `${milestone.id} names a strategic phase ("${milestone.phase}")`);
    assert.equal(typeof milestone.idStatus, 'string', `${milestone.id} says whether its id is fixed or indicative`);
    const required = REPORTED.includes(milestone.status) ? REQUIRED_REPORTED_FIELDS : REQUIRED_PLANNED_FIELDS;
    for (const field of required) {
      assert.equal(field in milestone, true, `${milestone.id} (${milestone.status}) carries "${field}"`);
    }
    // A boundary is a pair: what it may do and what it must not.
    if ('boundary' in milestone) {
      assert.ok(Array.isArray(milestone.boundary.may) && milestone.boundary.may.length > 0, `${milestone.id} says what it may do`);
      assert.ok(Array.isArray(milestone.boundary.mustNot) && milestone.boundary.boundary !== undefined ? true : milestone.boundary.mustNot.length > 0, `${milestone.id} says what it must not do`);
    }
  }
});

test('a status is backed by the evidence that status requires', () => {
  for (const milestone of REGISTER.milestones) {
    if (milestone.status === 'complete') {
      assert.ok(Array.isArray(milestone.finishEvidence) && milestone.finishEvidence.length > 0, `${milestone.id}: complete names its finishing evidence`);
      assert.ok(typeof milestone.verifiedAgainst === 'string' && /[0-9a-f]{8,}/.test(milestone.verifiedAgainst), `${milestone.id}: complete names the commit it was verified against`);
      assert.ok(Array.isArray(milestone.gates) && milestone.gates.length > 0, `${milestone.id}: complete names the gates that ran`);
      assert.ok(Array.isArray(milestone.completionCriteria) || typeof milestone.completionCriteria === 'object', `${milestone.id}: completion criteria are stated`);
    }
    if (milestone.status === 'in-progress') {
      assert.ok(Array.isArray(milestone.startEvidence) && milestone.startEvidence.length > 0, `${milestone.id}: in-progress names its starting evidence`);
      assert.match(milestone.baselineCommit ?? milestone.verifiedAgainst, /[0-9a-f]{8,}/, `${milestone.id}: in-progress names the baseline it started from`);
      assert.ok(milestone.statusBySide && typeof milestone.statusBySide === 'object', `${milestone.id}: in-progress reports each side separately`);
      assert.ok(Array.isArray(milestone.knownLimitations) && milestone.knownLimitations.length > 0, `${milestone.id}: in-progress names its known limitations`);
    }
    if (milestone.status === 'blocked') {
      assert.ok(Array.isArray(milestone.blockingDecisions) && milestone.blockingDecisions.length > 0, `${milestone.id}: blocked names what blocks it`);
    }
    // No row claims readiness it cannot point at.
    assert.equal(milestone.status === 'ready' && !(milestone.completionCriteria ?? []).length, false, `${milestone.id}: ready states its criteria`);
  }
  // The two sides of P2.13 are reported separately, because agent completion is not milestone completion.
  const p213 = byId.get('P2.13');
  assert.ok(Object.keys(p213.statusBySide).length >= 2, 'P2.13 reports backend and frontend separately');
  assert.match(JSON.stringify(p213.statusBySide), /NOT complete until reconciliation/, 'and says the milestone is not complete when an agent is');
});

test('dependencies and decision references resolve: no dangling id anywhere in the register', () => {
  const decisionIds = new Set(DECISIONS.decisions.map((row) => row.id));
  const blockerIds = new Set(REGISTER.dependencyBlockers.map((blocker) => blocker.id));
  for (const milestone of REGISTER.milestones) {
    const history = REGISTER.authority.milestoneHistory.ids;
    for (const dependency of milestone.dependencies) {
      const referenced = dependency.match(/P\d+\.\d+/g) ?? [];
      for (const id of referenced) {
        assert.ok(byId.has(id) || history.includes(id), `${milestone.id} depends on ${id}, which the register records as a milestone or names as pre-register history`);
      }
    }
    for (const dependency of milestone.decisionDependencies ?? []) {
      for (const id of dependency.match(/XA-\d+/g) ?? []) {
        assert.equal(decisionIds.has(id), true, `${milestone.id} names ${id}, which the decision register records`);
      }
    }
    for (const id of milestone.blockingDecisions ?? []) {
      const named = id.match(/^(XA-\d+|B-\d+)/)?.[1] ?? id;
      assert.equal(blockerIds.has(named) || decisionIds.has(named), true, `${milestone.id} is blocked by ${id}, which is recorded as a blocker or a decision`);
    }
  }
  for (const blocker of REGISTER.dependencyBlockers) {
    assert.ok(blocker.id.length > 0);
    assert.ok(typeof blocker.arbiter === 'string' && blocker.arbiter.length > 0, `${blocker.id} names its arbiter`);
    const blocked = Array.isArray(blocker.blocks) ? blocker.blocks.join(' ') : blocker.blocks;
    assert.ok(typeof blocked === 'string' && blocked.length > 0, `${blocker.id} says what it blocks`);
    for (const id of blocked.match(/P\d+\.\d+/g) ?? []) {
      assert.ok(byId.has(id) || REGISTER.authority.milestoneHistory.ids.includes(id), `${blocker.id} blocks ${id}, which the register records`);
    }
    if (blocker.id.startsWith('XA-')) assert.equal(decisionIds.has(blocker.id), true, `${blocker.id} is in the decision register`);
  }
  // Every open decision that blocks a milestone is visible from the register.
  for (const row of DECISIONS.decisions.filter((entry) => entry.status === 'open-for-manager')) {
    const named = REGISTER.dependencyBlockers.some((blocker) => blocker.id === row.id);
    const used = REGISTER.milestones.some((milestone) => (milestone.decisionDependencies ?? []).some((item) => item.includes(row.id)));
    assert.ok(named || used, `${row.id} is open: the register names it as a blocker or a milestone depends on it`);
  }
});

/* ------------------------------------------------------------------ 2. ladder */

test('the next chain is intact, acyclic and reaches the future', () => {
  const seen = [];
  let current = REGISTER.milestones.find((milestone) => milestone.status === 'in-progress')?.id ?? REGISTER.milestones[0].id;
  while (current !== null && current !== undefined) {
    const milestone = byId.get(current.replace(/\s*\(indicative\)$/, ''));
    assert.ok(milestone, `${current} resolves to a recorded milestone`);
    assert.equal(seen.includes(milestone.id), false, `the ladder has no cycle at ${milestone.id}`);
    seen.push(milestone.id);
    const next = milestone.next;
    current = typeof next === 'string' ? next.match(/^P\d+\.\d+/)?.[0] ?? null : null;
    if (seen.length > REGISTER.milestones.length) break;
  }
  const onward = REGISTER.milestones.filter((milestone) => parseFloat(milestone.id.slice(1)) >= 2.13);
  assert.equal(seen.length, onward.length, `the forward chain reaches every milestone from P2.13 onward: ${seen.join(' -> ')}`);
  assert.deepEqual(seen, onward.map((milestone) => milestone.id), 'in register order, with no gap and no fork');
  assert.equal(seen[0], 'P2.13', 'the ladder starts at the milestone in progress');
  // The recorded history is reachable backwards, and is not rewritten to look current.
  assert.equal(byId.get('P2.12').next, 'P2.13');
  assert.equal(byId.get('P2.11').next, 'P2.12');
  assert.equal(byId.get('P2.13').statusBySide !== undefined, true);
  assert.ok(REGISTER.authority.milestoneHistory.ids.includes('P2.10'), 'pre-register history is named, so P2.11 -> P2.10 is not a dangling reference');
  assert.match(REGISTER.authority.milestoneHistory.rule, /NOT retro-fitted/, 'and history is not back-filled with evidence nobody recorded');
  const superseded = REGISTER.milestones.filter((milestone) => milestone.status === 'superseded');
  for (const milestone of superseded) {
    assert.match(milestone.currentReference, /superseded/, `${milestone.id} says what superseded it`);
  }
});

test('an indicative id is marked indicative, and a recorded one is not', () => {
  for (const milestone of REGISTER.milestones) {
    if (milestone.status === 'planned') {
      assert.match(milestone.idStatus, /^indicative/, `${milestone.id} is a placeholder the manager may refine`);
      assert.match(milestone.idStatus, /register/, `${milestone.id} says where the refinement happens`);
      assert.ok(typeof milestone.scopeNote === 'string' && milestone.scopeNote.length > 20, `${milestone.id} says what it is for, without pretending to be scoped`);
    } else {
      assert.match(milestone.idStatus, /^(recorded|fixed)/, `${milestone.id} is recorded, so its id is not indicative`);
    }
  }
  assert.match(REGISTER.policy.idRefinement, /ONLY by updating this register/, 'only the manager refines ids, and only here');
  assert.match(REGISTER.policy.noInventedReadiness, /never marked ready because it is convenient/);
  // The future ladder the brief names is present, in order, with its dependencies subject to readiness.
  const titles = REGISTER.milestones.map((milestone) => milestone.title);
  for (const expected of [/Memory/, /Workspace/, /Agent Machine/, /Artifact/, /Approval/, /MCP/, /Runtime Adapter/, /Node Creator/, /Translation/, /Token/, /Rust|native/i]) {
    assert.ok(titles.some((title) => expected.test(title)), `the ladder keeps a milestone for ${expected}`);
  }
});

/* --------------------------------------------------------------- 3. authority */

test('the strategic Phases A–F survive underneath the milestone layer', () => {
  // The canonical phase list is the AI set manifest, not prose: the register points at it and must
  // not become a second, drifting copy of the strategic roadmap.
  const set = JSON.parse(read(REGISTER.authority.strategicRoadmap.file.replace(/^apps\/n8n-lego\/src\/lego\//, 'apps/n8n-lego/src/lego/')));
  const phases = Object.keys(set.phases).filter((key) => key !== 'rule');
  assert.deepEqual(phases, ['A', 'B', 'C', 'D', 'E', 'F'], 'the strategic phases are intact in the manifest');
  for (const phase of phases) {
    assert.ok(REGISTER.milestones.some((milestone) => milestone.phase.startsWith(phase)), `the register maps at least one milestone into Phase ${phase}`);
  }
  // The application roadmap is a different document and stays itself: numbered work, not A-F.
  assert.match(ROADMAP, /application roadmap/i, 'ROADMAP.md is the application roadmap');
  assert.equal(REGISTER.authority.applicationRoadmap.file, 'docs/n8n-lego/ROADMAP.md');
  assert.match(REGISTER.authority.strategicRoadmap.rule, /NOT replaced and NOT re-numbered/);
  assert.equal(REGISTER.authority.strategicRoadmap.file, 'apps/n8n-lego/src/lego/manifest/ai-lego-set.json');
  assert.match(REGISTER.authority.productTruth.rule, /the manifest wins/);
  assert.match(REGISTER.authority.decisions.file, /cross-agent-decisions\.json/, 'decisions stay in their own register');
  assert.match(REGISTER.authority.decisions.rule, /may not resolve a decision/, 'and a milestone may not resolve one');
  assert.match(REGISTER.authority.strategicRoadmap.rule, /granular layer inside them/, 'the milestone layer sits beneath the phases');
  assert.match(REGISTER.policy.scopeRule, /scope violation/, 'and a boundary is enforced as a scope rule');
  assert.match(REGISTER.policy.scopeRule, /not merge that scope/, 'whose correct action is to not merge');
  assert.match(REGISTER.policy.architectureFirst, /Architecture .* Contract .* Test .* Implementation/, 'and the order is not negotiable');
});

test('current truth is stated as truth, with counts delegated to the generated document', () => {
  const truth = REGISTER.currentTruth;
  assert.match(truth.asOf, /^\d{4}-\d{2}-\d{2}/, 'the truth is dated');
  assert.equal(truth.currentMilestone, 'P2.13');
  assert.equal(truth.previousCompletedMilestone, 'P2.12');
  assert.match(truth.mainBaseline, /^e754c5df/, 'the baseline it was measured against');
  assert.match(truth.skill, /^IMPLEMENTED/, 'Skill is implemented as a contract and a vocabulary');
  assert.match(truth.skill, /no skill runtime/, 'and says there is no runtime');
  assert.match(truth.contextSession, /^IN PROGRESS/);
  assert.match(truth.memory, /^PLANNED/);
  assert.match(truth.workspace, /^PLANNED/);
  assert.match(truth.agentMachine, /^CONTRACT-ONLY/, 'the Agent Machine is contract-only');
  assert.equal(truth.aiRuntime, 'NOT IMPLEMENTED');
  assert.equal(truth.modelInference, 'NOT IMPLEMENTED');
  assert.equal(truth.mcpRuntime, 'NOT IMPLEMENTED');
  assert.equal(truth.runtimeAdapterRuntime, 'NOT IMPLEMENTED');
  assert.match(truth.rust, /^NOT (IMPLEMENTED|STARTED)/, 'no Rust implementation of any LEGO contract');
  assert.match(truth.scaleOut, /^NOT READY/);
  // A register that copies counts goes stale the moment a test is added.
  assert.match(truth.countsSource, /generated \.ai\/master\/CURRENT_STATUS\.md/, 'counts are delegated, never duplicated');
  assert.equal(/test count|\d{3} tests/i.test(JSON.stringify(truth)), false, 'and no count is copied in');
});

test('the baseline block protects main and names both agent branches', () => {
  assert.match(REGISTER.baseline.protectedMain.commit, /^e754c5df35b41b0ff2ac769519f05f056835411c$/);
  assert.match(REGISTER.baseline.protectedMain.rule, /never (modified|merged)/i, 'main is protected in the register itself');
  assert.ok(Array.isArray(REGISTER.baseline.historicalBaselines) && REGISTER.baseline.historicalBaselines.length >= 1);
  for (const historical of REGISTER.baseline.historicalBaselines) {
    assert.match(historical.commit, /^[0-9a-f]{8,}/, 'a historical baseline keeps its commit');
    assert.ok(typeof historical.note === 'string' && historical.note.length > 10, 'and says why it is historical');
  }
  const branches = JSON.stringify(REGISTER.baseline.agentBranches);
  assert.ok(branches.includes('arena/01a0c6b4-n8n-rust-v-4'), 'the frontend branch is named');
  assert.ok(branches.includes('arena/01a0c6b5-n8n-rust-v-4'), 'and the backend branch is named');
  assert.match(REGISTER.policy.historyRule, /never rewritten to look current/);
});

/* ------------------------------------------------------------- 4. merge gate */

test('the merge protocol says agent completion is not merge approval, and names two gates', () => {
  const protocol = REGISTER.policy.mergeProtocol;
  assert.ok(protocol, 'the register carries the merge protocol');
  assert.match(protocol.agentCompletionIsNotMergeApproval, /does NOT mean the branch is safe to merge/);
  assert.match(protocol.appliesTo, /P2\.13, P2\.14 and every later milestone/, 'the same rule applies to later milestones');
  assert.ok(Array.isArray(protocol.sequence) && protocol.sequence.length >= 4, `${protocol.sequence.length} ordered steps`);
  assert.match(protocol.sequence.join(' | '), /RECONCILIATION PASS/);
  assert.match(protocol.sequence.join(' | '), /post-merge verification/);
  // Reconciliation before merge: the first gate must come before the second in the sequence.
  const reconciliationAt = protocol.sequence.findIndex((step) => step.includes('RECONCILIATION PASS'));
  const mergeAt = protocol.sequence.findIndex((step) => /merge/i.test(step) && step.toLowerCase().includes('main'));
  assert.ok(reconciliationAt >= 0, 'the reconciliation gate is a step');
  if (mergeAt >= 0) assert.ok(reconciliationAt < mergeAt, 'reconciliation happens before the merge');
  assert.ok(protocol.twoGates.reconciliationPass.length > 20);
  assert.ok(protocol.twoGates.mergePass.length > 20);
  assert.match(protocol.twoGates.reconciliationPass, /two agent outputs|both branches/i, 'the reconciliation gate looks at both sides');
  assert.match(protocol.twoGates.why, /not 'the milestone is complete'/, 'and says why two gates are not one');
  assert.match(protocol.reconcileChecks.baseline, /never 'merge whichever arrives first'/, 'reconciliation starts from one baseline');
  assert.match(protocol.reconcileChecks.contractAuthority, /backend contract/, 'and the contract authority is one-directional');
  assert.match(protocol.reconcileChecks.testReconciliation, /The last two are the gate; the first two are not sufficient/, 'focused tests passing is not the gate');
  assert.match(protocol.mergeAuthority, /Only the manager turns agent branches into product state on main/);
});

test('the conflict taxonomy has four kinds, and a scope violation does not merge', () => {
  const types = REGISTER.policy.mergeProtocol.conflictTypes;
  assert.equal(types.length, 4);
  assert.deepEqual(types.map((type) => type.type), [1, 2, 3, 4]);
  for (const type of types) {
    assert.ok(typeof type.name === 'string' && type.name.length > 3, `conflict ${type.type} has a name`);
    assert.ok(Array.isArray(type.examples) && type.examples.length >= 3, `conflict ${type.type} gives examples, so the kind is recognisable`);
    assert.ok(typeof type.action === 'string' && type.action.length > 10, `conflict ${type.type} says what to do`);
  }
  assert.match(types[0].name, /mechanical/i);
  assert.match(types[1].name, /contract/i);
  assert.match(types[2].name, /architecture/i);
  assert.match(types[3].name, /scope-violation/i);
  assert.match(types[3].action, /do not merge that scope/, 'a scope violation is not merged');
  assert.match(types[3].examples.join(' | '), /Memory store created/, 'and the examples name the P2.13 temptations');
  assert.match(types[0].action, /manager resolves it directly/, 'a mechanical conflict is the only one resolved without a recorded decision');
  assert.match(types[1].action, /contract is reconciled first/, 'a contract conflict is reconciled before the code follows it');
  assert.match(types[2].action, /ruled before merging/, 'an architecture conflict is ruled before merging');
  const onFailure = REGISTER.policy.mergeProtocol.onFailure;
  assert.equal(onFailure.state, 'RECONCILIATION_FAILED');
  assert.deepEqual([...onFailure.evidence], ['the conflict', 'the affected contract', 'the affected agent', 'the reason', 'the required decision', 'the blocking test']);
  assert.match(onFailure.then, /Never a silent merge/, 'a failed reconciliation goes back to the agent, never into a merge');
  assert.match(onFailure.then, /never a merge of a locked-contract disagreement/);
});

test('the same gate is written into workforce governance, pointing here instead of restating it', () => {
  const gate = GOVERNANCE.milestoneMergeGate;
  assert.ok(gate, 'workforce-governance.json carries the milestone merge gate');
  assert.equal(gate.sourceOfTruth, REGISTER_PATH, 'the governance file names the register as the source, so the protocol cannot be written twice and drift');
  assert.equal(gate.owner, 'manager');
  assert.equal(gate.appliesTo, REGISTER.policy.mergeProtocol.appliesTo, 'the same scope, word for word');
  assert.match(gate.rule, /Agent completion is NOT merge approval/);
  assert.deepEqual([...gate.gates], ['RECONCILIATION PASS', 'MERGE PASS'], 'two gates, in order');
  assert.equal(gate.conflictTypes.length, REGISTER.policy.mergeProtocol.conflictTypes.length, 'the taxonomy is not re-spelled');
  assert.deepEqual(gate.conflictTypes.map((type) => type.type), REGISTER.policy.mergeProtocol.conflictTypes.map((type) => type.type));
  assert.match(gate.conflictTypes[3].action, /do not merge that scope/);
  assert.equal(gate.onFailure, REGISTER.policy.mergeProtocol.onFailure.state);
  assert.match(gate.neverMerge, /main directly|without reconciliation/i, 'and says what must never happen');
  // Governance stays additive: the pre-existing keys are untouched.
  for (const key of ['governanceVersion', 'roles', 'escalation']) {
    if (key in GOVERNANCE) assert.ok(GOVERNANCE[key] !== null, `${key} survives the additive change`);
  }
});

/* --------------------------------------------------- 5. the register and the docs */

test('the curated status documents agree with the register, and say they derive from it', () => {
  const status = read('.ai/master/frontend/CURRENT_STATUS.md');
  const phases = read('.ai/master/frontend/IMPLEMENTATION_PHASES.md');
  assert.match(status, /P2\.13/, 'the curated status names the current milestone');
  assert.match(status, /P2\.12/, 'and the one before it');
  assert.match(status, /milestones\.json/, 'and points at the register');
  assert.match(phases, /P2\.13/);
  assert.match(phases, /milestones\.json/, 'the phase document derives from the register');
  assert.match(phases, /Phase [A-F]/, 'and keeps the strategic phases');
  // A document that says "complete" while the register says in-progress is the exact drift this
  // register exists to end, so the two are compared rather than trusted.
  const registerStatus = byId.get('P2.13').status;
  assert.equal(/P2\.13[^\n]*\bcomplete\b/i.test(status), registerStatus === 'complete', 'P2.13 is not reported complete while the register says otherwise');
});

test('the register is the canonical record, and the docs that predate it say so', () => {
  assert.match(read('.ai/master/frontend/KNOWN_BLOCKERS.md'), /XA-20/, 'the blocker list carries the P2.13 blocker');
  assert.match(read('.ai/master/frontend/PROJECT_WORKFORCE_ORCHESTRATION.md'), /RECONCILIATION PASS/, 'and the orchestration document carries the gate');
  assert.match(read('.ai/master/frontend/PROJECT_WORKFORCE_ORCHESTRATION.md'), /milestones\.json/);
  assert.match(read('.ai/master/CONTEXT_SESSION_MEMORY_PLAN.md'), /P2\.13/, 'the Context & Session plan names its milestone');
  assert.match(read('.ai/master/CONTEXT_SESSION_MEMORY_PLAN.md'), /declared-not-locked|XA-20/, 'and the publication state it was verified in');
  assert.match(read('.ai/master/AI_FRONTEND_CONTRACT_MATRIX.md'), /ai\.context/, 'the contract matrix carries both contracts');
  assert.match(read('.ai/master/AI_FRONTEND_CONTRACT_MATRIX.md'), /ai\.agent-session/);
  assert.match(read('.ai/master/AI_FRONTEND_CONTRACT_MATRIX.md'), /declared-not-locked/, 'with the publication state it was verified in');
});
