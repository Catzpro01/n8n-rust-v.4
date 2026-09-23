/**
 * The shared vocabulary lock (Task 4, 5, 24).
 *
 * The frontend and the backend foundation must not grow two dialects for one
 * concept. These tests check the lock itself (provenance, total mappings, declared
 * extras), the two functions that use it (normalisation, collision reporting), and
 * the cross-agent decision record that documents every question the lock could not
 * answer on its own.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  CAPABILITY_ID_PATTERN,
  LOCAL_VOCABULARIES,
  QUOTED_FROM,
  VOCABULARIES,
  VocabularyError,
  assertTerm,
  compareVocabulary,
  describeVocabulary,
  detectCollisions,
  isDeclaredTerm,
  normaliseCapabilityId,
  vocabularyConflicts,
  vocabularyDrift,
  vocabularyOf,
} from '../src/vocabulary.mjs';
import { AVAILABILITY_STATES, OPERATION_STATES } from '../src/negotiation.mjs';
import { CHANGE_KINDS, COMPATIBILITY } from '../src/versions.mjs';
import { CAPABILITY_STATUSES } from '../src/registry.mjs';
import { SUB_LEGO_STATUSES } from '../src/sublegos.mjs';
import { INTERACTION_CLASSES } from '../src/interactions.mjs';
import { PACKAGE_ROOT, loadManifests } from '../src/manifests.mjs';

const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
const read = (relative) => readFileSync(join(REPO_ROOT, relative), 'utf8');
const DECISIONS = JSON.parse(read('docs/n8n-lego/decisions/cross-agent-decisions.json'));

test('every shared vocabulary is quoted with provenance, not re-invented', () => {
  assert.ok(VOCABULARIES.length >= 6, `${VOCABULARIES.length} shared vocabularies`);
  assert.match(QUOTED_FROM.branch, /^(main|arena\/)/, 'the lock names the branch it read');
  assert.match(QUOTED_FROM.commit, /^[0-9a-f]{8}$/, 'and the commit');
  for (const set of VOCABULARIES) {
    assert.ok(set.values.length > 0, `${set.id} declares values`);
    assert.ok(set.question.length > 20, `${set.id} says which question it answers`);
    assert.ok(set.provenance.file.startsWith('apps/n8n-lego/src/lego/'), `${set.id} quotes the backend foundation`);
    assert.ok((set.provenance.symbol ?? set.provenance.path).length > 0, `${set.id} names the declaration it read`);
    assert.equal(new Set(set.values).size, set.values.length, `${set.id} has no duplicate term`);
  }
  // A vocabulary whose file no contract publishes must say so, and must ask for one:
  // no invented contract id, no silent assumption that the closest-sounding row owns it.
  const decisions = new Set(DECISIONS.decisions.map((decision) => decision.id));
  const pending = VOCABULARIES.filter((set) => set.provenance.contract === null);
  assert.ok(pending.length >= 1, `${pending.length} vocabularies whose publication is pending`);
  for (const set of pending) {
    const record = set.publicationPending;
    assert.ok(record && typeof record === 'object', `${set.id} carries a structured publication record`);
    assert.ok(record.owner.length > 0 && record.domain.length > 0, `${set.id} names the owner and the domain`);
    assert.ok(record.what.length > 40, `${set.id} says exactly what is unpublished`);
    assert.ok(decisions.has(record.decision), `${set.id} points at a recorded decision (${record.decision})`);
  }
  // The lock is data a reader can check without opening either implementation.
  const described = describeVocabulary();
  assert.equal(described.canonical.length, VOCABULARIES.length);
  assert.equal(described.local.length, LOCAL_VOCABULARIES.length);
  assert.match(described.rules.join(' '), /quoted/);
});

test('the frontend runtime uses the quoted degradation states verbatim', () => {
  assert.deepEqual(AVAILABILITY_STATES, vocabularyOf('degradation').values);
  assert.equal(vocabularyOf('degradation').provenance.contract.id, 'lego.interaction');
  assert.equal(vocabularyOf('degradation').provenance.contract.owner, 'agent-2');
  // A verdict is answered with the canonical instruction, not a paraphrase.
  assert.equal(vocabularyOf('degradation').actions['migration-required'], 'fail with lego.migration_required and name the migration');
  assert.deepEqual(vocabularyOf('degradation').usable, { available: true, degraded: true });
});

test('the operation outcomes are declared, and four of them answer a question the canonical set does not ask', () => {
  const operation = vocabularyOf('operationOutcome');
  assert.deepEqual(OPERATION_STATES, operation.values);
  const canonical = vocabularyOf('degradation').values;
  for (const value of operation.values) {
    const target = operation.mirror[value];
    if (canonical.includes(value)) assert.equal(target, value, `${value} mirrors itself`);
    else assert.equal(target, null, `${value} has no canonical equivalent and says so`);
  }
  // Every extra carries its reason: an unexplained word is the thing this lock refuses.
  assert.deepEqual(operation.extra.map((entry) => entry.value).sort(), ['operation-denied', 'operation-unpublished', 'permission-missing', 'permission-unknown']);
  for (const entry of operation.extra) assert.ok(entry.reason.length > 40, `${entry.value} explains itself`);
});

test('a local vocabulary maps totally into the shared one it speaks about', () => {
  const conflicts = vocabularyConflicts();
  assert.equal(conflicts.ok, true, JSON.stringify(conflicts.conflicts));
  assert.ok(conflicts.checked >= 13, `${conflicts.checked} vocabularies audited`);

  for (const set of LOCAL_VOCABULARIES) {
    if (set.mapsTo === null) continue;
    const canonical = vocabularyOf(set.mapsTo);
    assert.ok(canonical, `${set.id} points at a declared vocabulary`);
    for (const value of set.values) {
      assert.ok(value in set.mirror, `${set.id}.${value} declares a mapping`);
    }
  }
  // The frontend's own words are the ones the code actually uses.
  assert.deepEqual(vocabularyOf('frontendCapabilityDeclaration').values, CAPABILITY_STATUSES);
  assert.deepEqual(vocabularyOf('unitStatus').values, SUB_LEGO_STATUSES);
  assert.deepEqual(vocabularyOf('versionFit').values, COMPATIBILITY);
  assert.deepEqual(vocabularyOf('changeKind').values, CHANGE_KINDS);
  assert.deepEqual(vocabularyOf('interaction').values, INTERACTION_CLASSES);
});

test('a renamed-for-style vocabulary is declared rather than silently changed', () => {
  // `unitStatus` rides in the pinned boot payload; renaming it would change a browser
  // contract for a naming reason. The lock records the mapping instead.
  const unit = vocabularyOf('unitStatus');
  // `declared` maps to `contract-only`, not to `planned`: P2.10 gave the backend the exact
  // word for "the contract is fixed and gate-checked, only the implementation is missing",
  // which is what a declared unit is.
  assert.deepEqual(unit.mirror, { declared: 'contract-only', available: 'implemented', partial: 'partial', unsupported: 'unsupported' });
  assert.equal(unit.extra.length, 2, 'both extra spellings carry a reason');
  for (const entry of unit.extra) assert.match(entry.reason, /canonical `(contract-only|implemented)`/);
});

test('an undeclared term is refused, and an unknown vocabulary is never skipped', () => {
  assert.equal(isDeclaredTerm('degradation', 'degraded'), true);
  assert.equal(isDeclaredTerm('degradation', 'degradation'), false, 'a near-miss is not a term');
  assert.throws(() => assertTerm('degradation', 'broken'), (error) => {
    assert.ok(error instanceof VocabularyError);
    assert.equal(error.code, 'frontend.vocabulary.unknown-term');
    assert.match(error.message, /not a declared degradation/);
    return true;
  });
  assert.throws(() => isDeclaredTerm('no-such-vocabulary', 'x'), /is not a declared vocabulary/);

  const drift = vocabularyDrift({ degradation: vocabularyOf('degradation').values, 'no-such-vocabulary': [] });
  assert.equal(drift.ok, false, 'a comparison that checks nothing is not a pass');
  assert.equal(drift.reports.length, 2);
  assert.equal(drift.reports[1].ok, false);
  assert.deepEqual(compareVocabulary('degradation', ['available', 'broken']).extra, ['broken']);
  assert.equal(compareVocabulary('degradation', vocabularyOf('degradation').values).detail, '8 terms match');
});

test('capability identity is normalised once, explicitly, and never two spellings', () => {
  assert.equal(normaliseCapabilityId('  Workflow.Editor  '), 'workflow.editor');
  assert.match('workflow.editor', CAPABILITY_ID_PATTERN);
  for (const bad of ['workflow', 'Workflow Editor', 'workflow..editor', '-workflow', 'workflow.', '', 'workflow/editor']) {
    if (bad === 'workflow') continue; // a single-segment id is legal for a frontend capability
    assert.throws(() => normaliseCapabilityId(bad), VocabularyError, `"${bad}" is refused`);
  }
  assert.throws(() => normaliseCapabilityId(42), /must be a string/);
});

test('two origins sharing an id are reported, never merged', () => {
  const collision = detectCollisions([
    { id: 'workflow', origin: 'backend-advertised' },
    { id: 'workflow', origin: 'frontend-declared' },
    { id: 'settings', origin: 'backend-advertised' },
  ]);
  assert.equal(collision.ok, false);
  assert.deepEqual(collision.collisions, [{ id: 'workflow', origins: ['backend-advertised', 'frontend-declared'] }]);
  assert.match(collision.detail, /workflow: backend-advertised \+ frontend-declared/);

  const clean = detectCollisions([{ id: 'workflow', origin: 'backend-advertised' }, { id: 'settings', origin: 'backend-advertised' }]);
  assert.equal(clean.ok, true);
  assert.equal(detectCollisions([{ id: 'WORKFLOW', origin: 'a' }, { id: 'workflow', origin: 'b' }]).ok, false, 'normalisation happens before comparison');
});

test('the frontend never imports the backend implementation to stay in sync', () => {
  const manifests = loadManifests();
  for (const set of VOCABULARIES) {
    assert.equal(set.provenance.file.includes('packages/frontend-lego'), false, `${set.id} quotes the backend, not itself`);
  }
  const negotiator = read('packages/frontend-lego/src/negotiation.mjs');
  assert.equal(/from '.*apps\/n8n-lego/.test(negotiator), false, 'the frontend quotes names; it does not import backend modules');
  assert.equal(/^import .*node:/m.test(read('packages/frontend-lego/src/vocabulary.mjs')), false, 'and the lock stays browser-safe');
  assert.ok(manifests.capabilities.length >= 1);
});

test('every cross-agent question has a machine-readable record', () => {
  assert.ok(DECISIONS.decisions.length >= 4, `${DECISIONS.decisions.length} decisions recorded`);
  const statuses = new Set(['resolved', 'open-for-agent-2', 'open-for-manager']);
  assert.ok(existsSync(join(REPO_ROOT, 'docs/n8n-lego/decisions/cross-agent-decisions.json')));
  for (const decision of DECISIONS.decisions) {
    assert.match(decision.id, /^XA-\d+$/);
    assert.ok(statuses.has(decision.status), `${decision.id} has a known status (${decision.status})`);
    assert.ok(decision.question.endsWith('?'), `${decision.id} asks a question`);
    assert.ok((decision.evidence ?? []).length >= 2, `${decision.id} cites evidence`);
    if (decision.status === 'resolved') {
      assert.ok(decision.resolution.length > 40, `${decision.id} says how it was resolved`);
      assert.equal(decision.arbiter, null, 'a resolved question needs no arbiter');
    } else {
      assert.ok(decision.arbiter && decision.arbiter.length > 10, `${decision.id} names its arbiter`);
      assert.ok(decision.blocks.length > 0, `${decision.id} says what is blocked`);
      assert.equal(decision.resolution, null, 'an open question has no resolution yet');
    }
  }
  // The four questions this phase was asked to settle are all in the record.
  for (const id of ['XA-1', 'XA-2', 'XA-3', 'XA-4']) {
    assert.ok(DECISIONS.decisions.some((decision) => decision.id === id), `${id} is recorded`);
  }
  // The two naming questions are resolved by declaration, not by preference.
  const executions = DECISIONS.decisions.find((decision) => decision.id === 'XA-1');
  assert.equal(executions.status, 'resolved');
  assert.match(executions.resolution, /canonical backend identity/);
  // The record names how it is checked, and that check exists.
  assert.ok(DECISIONS.alignment?.test, 'the record says how it is verified');
  assert.ok(existsSync(join(REPO_ROOT, DECISIONS.alignment.test)), `${DECISIONS.alignment.test} exists`);
  assert.match(DECISIONS.alignment.how, /skips with a stated reason/);
});

test('the P2.22 node portability quotes are complete (classes, capabilities, permissions)', () => {
  const classes = vocabularyOf('nodePortabilityClass');
  assert.equal(classes.values.length, 7, 'seven canonical portability classes');
  assert.deepEqual([...classes.values], [
    'PURE', 'API', 'NETWORK', 'FILESYSTEM',
    'NATIVE_PROCESS', 'ENVIRONMENT_SPECIFIC', 'REMOTE_BRIDGE',
  ], 'exact class vocabulary — no competing synonyms');
  const capabilities = vocabularyOf('nodeRegistryCapability');
  assert.equal(capabilities.values.length, 5, 'the node-registry domain publishes five capabilities after P2.22');
  assert.ok(capabilities.values.includes('node-registry.portability'), 'and the portability foundation is one of them');
  const permissions = vocabularyOf('nodeRegistryPermission');
  assert.equal(permissions.values.length, 3, 'node:read plus the P2.22 validator pair');
  assert.ok(permissions.values.includes('node:portability:validate'));
  assert.ok(permissions.values.includes('node:portability:select'));
  for (const id of ['nodePortabilityClass', 'nodeRegistryCapability', 'nodeRegistryPermission']) {
    const set = vocabularyOf(id);
    assert.ok(set.provenance.file.startsWith('apps/n8n-lego/src/lego/'), `${id} quotes the backend foundation`);
    assert.ok(set.provenance.contract && set.provenance.contract.id, `${id} names its contract`);
  }
});
