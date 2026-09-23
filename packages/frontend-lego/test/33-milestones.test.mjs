/**
 * The canonical milestone register — `docs/n8n-lego/milestones.json` (P2.13 Part A).
 *
 * Reconciled for P2.14 against protected main @ 67e638ef83028bbc69876e2e768181415c7554fa: P2.13
 * (Context & Session) is complete on protected main through PR #45 and PR #46, and P2.14 (Memory) is
 * the row in progress. The expectations below follow the register rather than pinning the state the
 * reconciliation replaced — the milestone moves, the suite reads what it says.
 *
 * The register exists because "what is done?" was being answered from six documents that
 * disagreed. A register that cannot be checked is another document to disagree with, so this
 * suite treats it as a schema with teeth:
 *
 *   1. **Shape.** Every row carries the canonical fields, and a row that claims a status
 *      carries the evidence that status requires. `complete` without evidence is a claim.
 *   2. **Vocabulary.** Statuses come from six words and nothing else.
 *   3. **Ladder.** The `nextMilestone` chain is intact, acyclic and reaches the future ladder.
 *   4. **Authority.** The strategic Phases A–F survive underneath the milestone layer, the
 *      manifests stay the product truth, and the register never re-numbers a phase.
 *   5. **The merge gate.** Agent completion is not merge approval, there are two/three gates, and the
 *      conflict taxonomy names what must not be merged. The same gate is written into the
 *      workforce governance file, and the governance file points here rather than restating it —
 *      one protocol, two readers.
 *   6. **Proposal evidence.** Agent 1's granular future ladder rows (P2.17+ decomposition) are
 *      preserved as proposal evidence in docs/n8n-lego/evidence/P2.13-agent-1-milestone-register-proposal.json.
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
const PROPOSAL_PATH = 'docs/n8n-lego/evidence/P2.13-agent-1-milestone-register-proposal.json';
const PROPOSAL = existsSync(join(REPO_ROOT, PROPOSAL_PATH)) ? JSON.parse(read(PROPOSAL_PATH)) : null;
const DECISIONS = JSON.parse(read('docs/n8n-lego/decisions/cross-agent-decisions.json'));
const GOVERNANCE = JSON.parse(read('docs/engineering-operations/workforce-governance.json'));
const ROADMAP = read('docs/n8n-lego/ROADMAP.md');

const byId = new Map(REGISTER.milestones.map((milestone) => [milestone.id, milestone]));
const ALLOWED_STATUSES = ['blocked', 'complete', 'in-progress', 'planned', 'ready', 'superseded'];
const REQUIRED_CANONICAL_FIELDS = [
  'id', 'title', 'phase', 'status', 'owner', 'backendOwner', 'frontendOwner', 'dependencies', 'inputs',
  'deliverables', 'implementationBoundary', 'testsGates', 'decisionDependencies', 'completionCriteria',
  'startEvidence', 'finishEvidence', 'currentCommitReference', 'nextMilestone',
];

/* ------------------------------------------------------------------- 1. shape */

test('the register is one machine-readable file at the canonical path, owned by the manager', () => {
  assert.equal(REGISTER.owner, 'manager', 'the register is the manager\'s, not an agent\'s');
  assert.match(REGISTER.registerVersion, /^\d+\.\d+\.\d+$/, 'the register itself is versioned');
  assert.ok(existsSync(join(REPO_ROOT, REGISTER_PATH)));
  assert.equal(REGISTER.canonical, true);
  assert.equal(typeof REGISTER.purpose, 'string');
  assert.match(REGISTER.purpose, /Granular milestone truth/i);
  assert.equal(REGISTER.protectedBranch, 'main');
  // The baseline is the final protected-main commit; P2.15's own historical start baseline
  // (0d9466f1) stays on the P2.15 row, and P2.13's (e754c5df) stays on its row, instead of being
  // overwritten here.
  assert.match(REGISTER.mainBaseline, /^c40b7889/);
  assert.equal(REGISTER.currentMilestone, 'P2.21');
  assert.equal(REGISTER.previousCompletedMilestone, 'P2.20');
  assert.ok(REGISTER.milestones.length >= 7, `${REGISTER.milestones.length} milestones recorded`);
  assert.ok(REGISTER.agentBranches && typeof REGISTER.agentBranches === 'object');
  assert.ok(REGISTER.strategicRoadmap && typeof REGISTER.strategicRoadmap === 'object');
  assert.ok(REGISTER.mergeProtocol && typeof REGISTER.mergeProtocol === 'object');
});

test('every row carries the canonical fields, and only statuses from the six words', () => {
  const ids = new Set();
  for (const milestone of REGISTER.milestones) {
    assert.match(milestone.id, /^P\d+\.\d+(\+)?$/, `${milestone.id} is a phase.milestone id`);
    assert.equal(ids.has(milestone.id), false, `${milestone.id} is unique`);
    ids.add(milestone.id);
    assert.ok(ALLOWED_STATUSES.includes(milestone.status), `${milestone.id} uses an allowed status ("${milestone.status}")`);
    assert.equal(typeof milestone.title, 'string');
    assert.ok(milestone.title.length > 3, `${milestone.id} has a title`);
    assert.match(milestone.phase, /^[A-F](\/[A-F]|-F)?\b/, `${milestone.id} names a strategic phase ("${milestone.phase}")`);
    for (const field of REQUIRED_CANONICAL_FIELDS) {
      assert.equal(field in milestone, true, `${milestone.id} (${milestone.status}) carries "${field}"`);
    }
    assert.ok(typeof milestone.implementationBoundary === 'string' && milestone.implementationBoundary.length > 10, `${milestone.id} states boundary`);
    assert.ok(Array.isArray(milestone.deliverables) && milestone.deliverables.length > 0, `${milestone.id} states deliverables`);
    assert.ok(Array.isArray(milestone.dependencies), `${milestone.id} states dependencies`);
    assert.ok(Array.isArray(milestone.testsGates), `${milestone.id} states testsGates`);
  }
});

test('a status is backed by the evidence that status requires', () => {
  for (const milestone of REGISTER.milestones) {
    if (milestone.status === 'complete') {
      assert.ok(milestone.finishEvidence, `${milestone.id}: complete names its finishing evidence`);
      assert.ok(milestone.startEvidence, `${milestone.id}: complete names its start evidence`);
      assert.ok(milestone.currentCommitReference, `${milestone.id}: complete names its commit reference`);
      assert.ok(Array.isArray(milestone.completionCriteria) && milestone.completionCriteria.length > 0, `${milestone.id}: completion criteria are stated`);
    }
    if (milestone.status === 'in-progress') {
      assert.ok(milestone.startEvidence, `${milestone.id}: in-progress names its starting evidence`);
      assert.ok(milestone.currentCommitReference, `${milestone.id}: in-progress names its commit reference`);
      assert.ok(Array.isArray(milestone.nonScope) && milestone.nonScope.length > 0, `${milestone.id}: in-progress names nonScope`);
      assert.ok(milestone.reconciliation && typeof milestone.reconciliation === 'object', `${milestone.id}: in-progress carries reconciliation block`);
      assert.ok(milestone.verificationEvidence && typeof milestone.verificationEvidence === 'object', `${milestone.id}: in-progress carries verificationEvidence`);
    }
  }
  // A finished milestone may not carry an ACTIVE reconciliation verdict: the pre-merge
  // RECONCILIATION_REQUIRED record is kept, but it is marked as history and names its resolution.
  for (const milestone of REGISTER.milestones) {
    if (milestone.status !== 'complete' || !milestone.reconciliation) continue;
    assert.equal(milestone.reconciliation.historical, true, `${milestone.id} is complete, so its reconciliation block is history`);
  }
  // P2.13 in the canonical register: closed on protected main, with its reconciliation history kept.
  const p213 = byId.get('P2.13');
  assert.equal(p213.status, 'complete');
  assert.equal(p213.finishEvidence.protectedMain, '67e638ef83028bbc69876e2e768181415c7554fa');
  assert.equal(p213.currentCommitReference, '67e638ef83028bbc69876e2e768181415c7554fa');
  assert.match(p213.finishEvidence.mergeEvidence, /PR #45/, 'the merge evidence names the backend PR');
  assert.match(p213.finishEvidence.mergeEvidence, /PR #46/, 'and the frontend PR');
  assert.match(p213.reconciliation.resolution.note, /stay on this row/, 'the historical baseline and branches stay on the completed row');
  assert.equal(p213.reconciliation.verdict, 'RECONCILIATION_REQUIRED', 'the pre-merge verdict is preserved, not rewritten');
  assert.equal(p213.reconciliation.baseline, 'e754c5df35b41b0ff2ac769519f05f056835411c');
  // P2.15/P2.16/P2.17 are closed on protected main; P2.18 is the in-progress transport kernel.
  const p215 = byId.get('P2.15');
  assert.equal(p215.status, 'complete');
  assert.ok(p215.finishEvidence, 'P2.15 carries protected-main finish evidence');
  assert.equal(p215.finishEvidence.protectedMain, 'ce65851bd5b5194555baa635feb4c8aeae3f16eb');
  const p216 = byId.get('P2.16');
  assert.equal(p216.status, 'complete');
  assert.ok(p216.finishEvidence, 'P2.16 carries protected-main finish evidence');
  assert.equal(p216.finishEvidence.protectedMain, 'f21882233c1f4efc5bfb8f3e1b5e1ad4db781d7d');
  assert.match(p216.finishEvidence.mergeEvidence, /PR #52/, 'the merge evidence names the backend PR');
  const p217 = byId.get('P2.17');
  assert.equal(p217.status, 'complete', 'P2.17 closed on protected main via PR #53');
  assert.equal(p217.finishEvidence.protectedMain, '8da4d00c7e1bca7fc69a4f8d36f59c453f96ee02');
  assert.equal(p217.finishEvidence.pr, 53, 'the finish evidence names the PR');
  const p218 = byId.get('P2.18');
  assert.equal(p218.status, 'complete', 'P2.18 closed on protected main via PR #54');
  assert.equal(p218.finishEvidence.protectedMain, 'b3bdaab907142fa8ee2753badcb615c0b305d9fa');
  assert.equal(p218.finishEvidence.pr, 54, 'the finish evidence names the PR');
  const p219 = byId.get('P2.19');
  assert.equal(p219.status, 'complete', 'P2.19 closed on protected main via PR #56');
  assert.equal(p219.finishEvidence.protectedMain, '393622e3d2b0b070884d7cb74502908b64a6e252');
  assert.equal(p219.finishEvidence.pr, 56, 'the finish evidence names the PR');
  const p220 = byId.get('P2.20');
  assert.equal(p220.status, 'complete', 'P2.20 closed on protected main via PR #58');
  assert.equal(p220.finishEvidence.protectedMain, '84337490a061a2774bdcf5743b13972c2c82903b');
  assert.equal(p220.finishEvidence.pr, 58, 'the finish evidence names the PR');
  const p221 = byId.get('P2.21');
  assert.equal(p221.status, 'in-progress', 'P2.21 is the current runtime adapter & harness stack');
});

test('dependencies and decision references resolve: no dangling id anywhere in the register', () => {
  const decisionIds = new Set(DECISIONS.decisions.map((row) => row.id));
  for (const milestone of REGISTER.milestones) {
    for (const dependency of milestone.dependencies) {
      const referenced = dependency.match(/P\d+\.\d+/g) ?? [];
      for (const id of referenced) {
        assert.ok(byId.has(id) || id === 'P2.10', `${milestone.id} depends on ${id}, which the register records as a milestone or pre-register history`);
      }
    }
    for (const dependency of milestone.decisionDependencies ?? []) {
      for (const id of dependency.match(/XA-\d+/g) ?? []) {
        assert.equal(decisionIds.has(id), true, `${milestone.id} names ${id}, which the decision register records`);
      }
    }
  }
});

/* ------------------------------------------------------------------ 2. ladder */

test('the nextMilestone chain is intact, acyclic and reaches the future ladder', () => {
  const seen = [];
  let current = 'P2.11';
  while (current !== null && current !== undefined) {
    // An explicitly-named future milestone without its own row yet resolves to
    // the later-ladder row instead of dangling — canonical rows are never
    // faked with P2.17+ (the row lands when its Master Prompt lands).
    const milestone = byId.get(current)
      ?? (current.startsWith('P2.') ? byId.get('P2.17+') : undefined);
    assert.ok(milestone, `${current} resolves to a recorded milestone`);
    assert.equal(seen.includes(milestone.id), false, `the ladder has no cycle at ${milestone.id}`);
    seen.push(milestone.id);
    current = milestone.nextMilestone;
    if (seen.length > REGISTER.milestones.length) break;
  }
  assert.deepEqual(seen, ['P2.11', 'P2.12', 'P2.13', 'P2.14', 'P2.15', 'P2.16', 'P2.17', 'P2.18', 'P2.19', 'P2.20', 'P2.21', 'P2.17+']);
  assert.equal(byId.get('P2.17+').nextMilestone, null, 'P2.17+ terminates the canonical top ladder');
});

test('the ladder keeps planned milestones for future capabilities', () => {
  const titles = REGISTER.milestones.map((milestone) => milestone.title);
  for (const expected of [/Memory/, /Workspace/, /Agent Machine/]) {
    assert.ok(titles.some((title) => expected.test(title)), `the ladder keeps a milestone for ${expected}`);
  }
  const p217 = byId.get('P2.17+');
  assert.ok(p217, 'P2.17+ is the later capability ladder');
  assert.match(p217.implementationBoundary, /Future ladder only/);
  assert.match(p217.implementationBoundary, /Manager.*updating this canonical register/);
});

/* --------------------------------------------------------------- 3. authority */

test('the strategic Phases A–F survive underneath the milestone layer', () => {
  assert.deepEqual(REGISTER.strategicRoadmap.preservePhases, ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.match(REGISTER.strategicRoadmap.rule, /Phase A-F remains the strategic roadmap/);
  assert.equal(REGISTER.strategicRoadmap.source, 'apps/n8n-lego/src/lego/manifest/ai-lego-set.json');
  // ROADMAP.md is application roadmap:
  assert.match(ROADMAP, /application roadmap/i, 'ROADMAP.md is the application roadmap');
});

test('the proposal artifact preserves Agent 1 granular ladder proposal as non-canonical evidence', () => {
  assert.ok(PROPOSAL, 'proposal artifact exists at docs/n8n-lego/evidence/P2.13-agent-1-milestone-register-proposal.json');
  assert.equal(PROPOSAL.canonical, false);
  assert.equal(PROPOSAL.canonicalRegister, REGISTER_PATH);
  assert.equal(PROPOSAL.canonicalRegisterOwner, 'manager');
  assert.match(PROPOSAL.status, /proposal/i);
  assert.ok(PROPOSAL.contents.granularFutureLadder.rows.length >= 10, '10 granular future ladder rows preserved');
  assert.ok(PROPOSAL.contents.currentTruth, 'currentTruth preserved');
  assert.ok(PROPOSAL.contents.authority, 'authority preserved');
});

test('the baseline block protects main and names the branches of the current milestone', () => {
  assert.equal(REGISTER.protectedBranch, 'main');
  // The main baseline is the final protected-main commit; a completed milestone's start baseline
  // stays preserved history on its own row, so moving the top-level block on never rewrites it.
  const p215 = byId.get('P2.15');
  assert.equal(p215.startEvidence.commit, '0d9466f19a149f6e30bdee559086b7a28b080cb3', 'P2.15 start evidence stays preserved history');
  assert.equal(REGISTER.mainBaseline, 'c40b788966d2a43df66d53405a72e1230c9c0fc3', 'the main baseline is the final protected-main commit');
  assert.match(REGISTER.mainBaseline, /^[0-9a-f]{40}$/);
  assert.equal(REGISTER.agentBranches.agent1, 'arena/01a0c9d3-n8n-rust-v-4');
  assert.equal(REGISTER.agentBranches.agent2, 'arena/01a0c90d-n8n-rust-v-4');
  // Moving the top-level block on did not lose P2.13: its baseline and both agent branches stay on
  // the P2.13 row, which is where a historical milestone's coordinates belong.
  const p213 = byId.get('P2.13');
  assert.equal(p213.startEvidence.commit, 'e754c5df35b41b0ff2ac769519f05f056835411c');
  assert.equal(p213.startEvidence.branch, 'arena/01a0c6b5-n8n-rust-v-4');
  assert.match(p213.reconciliation.resolution.mergeEvidence, /arena\/01a0c6b4-n8n-rust-v-4/, 'the frontend branch P2.13 shipped from is recorded');
});

/* ------------------------------------------------------------- 4. merge gate */

test('the merge protocol makes agent completion the merge execution, and names the sequence', () => {
  const protocol = REGISTER.mergeProtocol;
  assert.ok(protocol, 'the register carries the merge protocol');
  assert.equal(protocol.owner, 'agent-1', 'Agent 1 executes merges under the current policy');
  assert.equal(protocol.managerRole, 'architecture-and-milestone-authority');
  assert.equal(protocol.agentCompletionIsMergeExecution, true);
  assert.equal(protocol.agentCompletionIsNotMergeApproval, undefined, 'the obsolete flag is gone');
  assert.ok(Array.isArray(protocol.sequence) && protocol.sequence.length >= 5);
  assert.ok(protocol.sequence.some((step) => step.includes('reconcil')));
  assert.ok(protocol.sequence.some((step) => step.includes('merge')));
  assert.equal(protocol.failureState, 'RECONCILIATION_FAILED');
  assert.match(protocol.completionRule, /merged and post-merge verification passes on protected main/);
});

test('the same gate is written into workforce governance, pointing here instead of restating it', () => {
  const protocol = GOVERNANCE.milestoneMergeProtocol;
  assert.ok(protocol, 'workforce-governance.json carries milestoneMergeProtocol');
  assert.equal(protocol.canonicalRegister, REGISTER_PATH, 'the governance file names the register as the source');
  assert.equal(protocol.owner, 'manager');
  assert.match(protocol.rule, /Agent branch completion is not merge approval/);
  assert.ok(protocol.gates.some((g) => g.id === 'RECONCILIATION PASS'));
  assert.ok(protocol.gates.some((g) => g.id === 'MERGE PASS'));
  assert.ok(protocol.gates.some((g) => g.id === 'POST-MERGE VERIFICATION PASS'));
  assert.equal(protocol.failureState, 'RECONCILIATION_FAILED');
  assert.ok(protocol.conflictClasses.mechanical);
  assert.ok(protocol.conflictClasses.contract);
  assert.ok(protocol.conflictClasses.architecture);
  assert.ok(protocol.conflictClasses.scope);
  assert.match(protocol.conflictClasses.scope, /Do not merge out-of-scope/);
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
  // A document that disagrees with the register about whether a milestone is finished is the exact
  // drift this register exists to end, so the two are compared rather than trusted. The register now
  // says P2.13 closed on protected main, so the curated view has to say so — while its own header
  // keeps naming the baseline it was measured at.
  const registerStatus = byId.get('P2.13').status;
  assert.equal(/P2\.13[^\n]*\bcomplete\b/i.test(status), registerStatus === 'complete', 'the curated status and the register agree about P2.13');
});

test('the register is the canonical record, and the docs that predate it say so', () => {
  assert.match(read('.ai/master/frontend/KNOWN_BLOCKERS.md'), /XA-20/, 'the blocker list carries the P2.13 blocker');
  assert.match(read('.ai/master/frontend/PROJECT_WORKFORCE_ORCHESTRATION.md'), /RECONCILIATION PASS/, 'and the orchestration document carries the gate');
  assert.match(read('.ai/master/frontend/PROJECT_WORKFORCE_ORCHESTRATION.md'), /milestones\.json/);
  assert.match(read('.ai/master/CONTEXT_SESSION_MEMORY_PLAN.md'), /P2\.13/, 'the Context & Session plan names its milestone');
  assert.match(read('.ai/master/AI_FRONTEND_CONTRACT_MATRIX.md'), /ai\.context/, 'the contract matrix carries both contracts');
  assert.match(read('.ai/master/AI_FRONTEND_CONTRACT_MATRIX.md'), /ai\.agent-session/);
});
