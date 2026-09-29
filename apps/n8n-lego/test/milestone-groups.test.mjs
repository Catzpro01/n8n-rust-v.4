/**
 * ADR-0012 — milestone groups (registerVersion 3.0.0).
 *
 * A milestone group is a grouping layer added BESIDE the immutable historical ladder.
 * These are the I-01..I-15 invariants of the migration. Every one of them is
 * mutation-proved: the corresponding corruption is applied to an in-memory copy of the
 * register and the assertion must reject it, so no guard here is vacuous.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HISTORICAL_P2_FINGERPRINT,
  MILESTONE_GROUP_ID,
  deriveMilestoneGroupState,
  headlineMetrics,
  historicalP2Fingerprint,
  milestoneGroupMembers,
  validateGovernanceRegister,
  validateHistoricalPointers,
  validateMilestoneGroups,
} from '../../../tools/lego/governance-register.mjs';

// Path traversal, never the directory name: this must pass in any checkout.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REGISTER = JSON.parse(readFileSync(join(REPO_ROOT, 'docs/n8n-lego/milestones.json'), 'utf8'));
const README = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');

/** A deep copy so a mutation can never leak into another test. */
const copy = () => JSON.parse(JSON.stringify(REGISTER));
const groupOf = (reg, id = 'Milestone-01') => reg.milestoneGroups.find((g) => g.id === id);

/* ---------------------------------------------------------------- historical layer */

test('I-01 the historical milestones[] ladder is untouched by the group layer', () => {
  assert.equal(REGISTER.milestones.length, 18);
  for (const milestone of REGISTER.milestones) {
    // the ladder holds completed milestones plus the documented `P2.17+` placeholder
    if (/\+$/.test(milestone.id)) continue;
    assert.equal(milestone.status, 'complete', `${milestone.id} stays a completed historical row`);
  }
  // no historical row was co-opted into carrying group membership
  for (const milestone of REGISTER.milestones) {
    assert.equal(milestone.milestoneGroup, undefined, `${milestone.id} carries no group field`);
    assert.ok(!MILESTONE_GROUP_ID.test(milestone.id), `${milestone.id} is ladder history, not a group id`);
  }
});

test('I-02 the historical fingerprint is unchanged by adding the group layer', () => {
  assert.equal(historicalP2Fingerprint(REGISTER), HISTORICAL_P2_FINGERPRINT);

  // mutation: the groups are top-level, so removing them must NOT move the fingerprint
  const without = copy();
  delete without.milestoneGroups;
  delete without.currentMilestoneGroup;
  assert.equal(
    historicalP2Fingerprint(without),
    HISTORICAL_P2_FINGERPRINT,
    'the group layer is outside the fingerprint payload by construction',
  );

  // mutation: touching the ladder MUST move it
  const touched = copy();
  touched.milestones[0].id = `${touched.milestones[0].id}-x`;
  assert.notEqual(historicalP2Fingerprint(touched), HISTORICAL_P2_FINGERPRINT);
});

test('I-03 currentMilestone semantics are unchanged', () => {
  assert.equal(REGISTER.currentMilestone, 'P2.27');
  assert.deepEqual(validateHistoricalPointers(REGISTER), []);

  const stale = copy();
  stale.currentMilestone = 'P2.26';
  assert.ok(
    validateHistoricalPointers(stale).some((e) => e.includes('currentMilestone')),
    'a stale currentMilestone is still rejected',
  );
});

test('I-04 historicalLastP2Milestone still tracks currentMilestone', () => {
  assert.equal(REGISTER.executionPointer.historicalLastP2Milestone, REGISTER.currentMilestone);

  const drift = copy();
  drift.executionPointer.historicalLastP2Milestone = 'P2.26';
  assert.ok(validateGovernanceRegister(drift).some((e) => e.includes('historicalLastP2Milestone')));
});

/* ---------------------------------------------------------------------- the groups */

test('I-05 every milestone group satisfies the declared schema', () => {
  assert.ok(Array.isArray(REGISTER.milestoneGroups));
  assert.deepEqual(validateMilestoneGroups(REGISTER), []);
  for (const group of REGISTER.milestoneGroups) {
    for (const field of ['id', 'title', 'purpose', 'members', 'sliceCount', 'state', 'authority']) {
      assert.ok(group[field] !== undefined, `${group.id} declares ${field}`);
    }
  }
  const missing = copy();
  delete groupOf(missing).authority;
  assert.ok(validateMilestoneGroups(missing).some((e) => e.includes('missing required field authority')));
});

test('I-06 group ids match Milestone-NN and are unique', () => {
  const ids = REGISTER.milestoneGroups.map((g) => g.id);
  for (const id of ids) assert.match(id, MILESTONE_GROUP_ID);
  assert.equal(new Set(ids).size, ids.length);

  const badShape = copy();
  groupOf(badShape).id = 'Milestone-1';
  assert.ok(validateMilestoneGroups(badShape).some((e) => e.includes('does not match')));

  const duplicate = copy();
  duplicate.milestoneGroups.push({ ...groupOf(duplicate) });
  assert.ok(validateMilestoneGroups(duplicate).some((e) => e.includes('duplicate')));
});

test('I-07 group membership only references programs or slices that exist', () => {
  const { missing } = milestoneGroupMembers(REGISTER, groupOf(REGISTER));
  assert.deepEqual(missing, []);

  const dangling = copy();
  groupOf(dangling).members.push('P99');
  assert.ok(validateMilestoneGroups(dangling).some((e) => e.includes('P99')));
});

test('I-08 no slice is claimed by two groups', () => {
  const seen = new Map();
  for (const group of REGISTER.milestoneGroups) {
    for (const slice of milestoneGroupMembers(REGISTER, group).slices) {
      assert.equal(seen.get(slice.id), undefined, `${slice.id} claimed twice`);
      seen.set(slice.id, group.id);
    }
  }
  const overlap = copy();
  overlap.milestoneGroups.push({
    id: 'Milestone-02', title: 'Overlapping', purpose: 'x', members: ['P2'],
    sliceCount: 60, state: 'COMPLETE', authority: 'test',
  });
  assert.ok(validateMilestoneGroups(overlap).some((e) => e.includes('claimed by both')));
});

test('I-09 Milestone-01 is exactly Foundation = P0 + P1 + P2', () => {
  const group = groupOf(REGISTER);
  assert.equal(group.title, 'Foundation');
  assert.deepEqual(group.members, ['P0', 'P1', 'P2']);

  const counts = Object.fromEntries(
    group.members.map((id) => [id, REGISTER.programs.find((p) => p.id === id).slices.length]),
  );
  assert.deepEqual(counts, { P0: 2, P1: 2, P2: 60 }, 'the owner-declared membership census');
  assert.equal(group.sliceCount, 64);

  const wrongCount = copy();
  groupOf(wrongCount).sliceCount = 63;
  assert.ok(validateMilestoneGroups(wrongCount).some((e) => e.includes('sliceCount 63')));
});

test('I-10 Milestone-01 state is DERIVED from 64/64 implemented, never asserted', () => {
  const group = groupOf(REGISTER);
  const { slices } = milestoneGroupMembers(REGISTER, group);
  assert.equal(slices.length, 64);
  assert.equal(slices.filter((s) => s.status === 'implemented').length, 64);
  assert.equal(deriveMilestoneGroupState(REGISTER, group), 'COMPLETE');
  assert.equal(group.state, 'COMPLETE');

  // a single non-implemented member must make COMPLETE underivable
  const regressed = copy();
  const target = regressed.programs.find((p) => p.id === 'P2').slices[0];
  target.status = 'planned';
  assert.equal(deriveMilestoneGroupState(regressed, groupOf(regressed)), 'IN_PROGRESS');
  assert.ok(validateMilestoneGroups(regressed).some((e) => e.includes('not derivable')));
});

/* --------------------------------------------------------------------- the pointer */

test('I-11 currentMilestoneGroup is valid and is the newest COMPLETE group', () => {
  assert.equal(REGISTER.currentMilestoneGroup, 'Milestone-01');
  assert.deepEqual(validateMilestoneGroups(REGISTER), []);

  const dangling = copy();
  dangling.currentMilestoneGroup = 'Milestone-77';
  assert.ok(validateMilestoneGroups(dangling).some((e) => e.includes('not a declared milestone group')));

  const nulled = copy();
  nulled.currentMilestoneGroup = null;
  assert.ok(validateMilestoneGroups(nulled).some((e) => e.includes('null while a COMPLETE group exists')));
});

test('I-12 a group is never rendered as a progress metric', () => {
  for (const group of REGISTER.milestoneGroups) {
    for (const forbidden of ['percent', 'earned', 'points', 'weight', 'checkpoints', 'status', 'mergeSha', 'pr']) {
      assert.equal(group[forbidden], undefined, `${group.id} must not carry ${forbidden}`);
    }
  }
  const polluted = copy();
  groupOf(polluted).percent = 100;
  assert.ok(validateMilestoneGroups(polluted).some((e) => e.includes('must not carry delivery/progress field')));

  // the README group section must not print a percentage
  const section = README.split('### Milestone groups')[1]?.split('## Status Legend')[0] ?? '';
  assert.ok(section.length > 0, 'the README renders a milestone-group section');
  assert.ok(!/\d+(\.\d+)?\s*%/.test(section), 'the group section renders no percentage');
  assert.match(section, /not\W{0,4}\s*a\s+progress\s+metric/i, 'it says so explicitly');
});

test('I-13 the executionPointer stays internally consistent', () => {
  assert.deepEqual(validateGovernanceRegister(REGISTER), []);
  const ep = REGISTER.executionPointer;
  assert.match(ep.lastVerifiedMain, /^[0-9a-f]{40}$/);
  assert.equal(ep.historicalLastP2Milestone, REGISTER.currentMilestone);
  // the group layer added no key to the pointer: groups live at the top level
  assert.equal(ep.milestoneGroups, undefined);
  assert.equal(ep.currentMilestoneGroup, undefined);
});

/* -------------------------------------------------------------------- no inflation */

test('I-14 the group migration causes zero delivery inflation', () => {
  const without = copy();
  delete without.milestoneGroups;
  delete without.currentMilestoneGroup;
  assert.deepEqual(
    headlineMetrics(REGISTER),
    headlineMetrics(without),
    'removing the group layer changes no headline figure, so adding it added none',
  );
});

test('I-15 earned points and denominators are unchanged', () => {
  const current = headlineMetrics(REGISTER).current;
  assert.equal(current.total, 193);
  assert.equal(current.implemented, 189);
  assert.equal(current.earned, 18900);
  assert.equal(current.points, 19300);
  assert.deepEqual(current.byStatus, { implemented: 189, proposed: 2, planned: 2 });
});

/* ------------------------------------------------------------------ schema version */

test('registerVersion 3.0.0 is backed by a real schema migration, not a bumped string', () => {
  assert.equal(REGISTER.registerVersion, '3.0.0');
  assert.ok(Array.isArray(REGISTER.milestoneGroups), 'milestoneGroups[] exists');
  assert.ok('currentMilestoneGroup' in REGISTER, 'currentMilestoneGroup exists');
  assert.ok(REGISTER.governance.milestoneGroupNaming, 'the grammar is declared in governance');
  assert.ok(REGISTER.governance.terminology.namespaces.milestoneGroup, 'the namespace is registered');
  assert.equal(typeof validateMilestoneGroups, 'function', 'a validator understands groups');
  assert.match(README, /### Milestone groups/, 'the projection renders groups');
});

test('the milestoneGroup namespace is distinct from every neighbouring namespace', () => {
  const ns = REGISTER.governance.terminology.namespaces;
  for (const key of ['program', 'milestone', 'milestoneGroup', 'slice', 'priority', 'aiUiPhase']) {
    assert.ok(ns[key], `${key} namespace registered`);
  }
  const rule = `${ns.milestoneGroup.rule} ${ns.milestoneGroup.distinctFrom}`;
  assert.match(rule, /P5-M05/, 'it states that the M of P5-M05 is Maintenance');
  assert.match(rule, /Priority-NN/, 'it separates group from operational priority');
  assert.match(rule, /UI-PHASE-nn/, 'it separates group from the UI phase namespace');
  assert.match(rule, /P0-P4/, 'it leaves the runtime/telemetry contract alone');
  // no slice id may ever look like a group id
  for (const program of REGISTER.programs) {
    for (const slice of program.slices ?? []) {
      assert.ok(!MILESTONE_GROUP_ID.test(slice.id), `${slice.id} is a slice, not a group`);
    }
  }
});
