/**
 * Alignment — the lock in `src/vocabulary.mjs` against the backend foundation modules
 * it quotes.
 *
 * The lock is data with provenance, so the honest check is a *comparison*: read the
 * declaration the lock says it read, and compare. The backend foundation (P2.6–P2.9,
 * `apps/n8n-lego/src/lego/**`) is owned by another agent and lands on this branch when
 * it is merged, so the comparison **skips with a stated reason** when those files are
 * not here — it never reports a pass it did not perform. The self-consistency half
 * always runs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PACKAGE_ROOT } from '../src/manifests.mjs';
import { QUOTED_FROM, VOCABULARIES, vocabularyDrift } from '../src/vocabulary.mjs';

const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
const BACKEND = join(REPO_ROOT, 'apps', 'n8n-lego', 'src', 'lego');
const CONTRACT_LOCK = join(BACKEND, 'contracts', 'contract-lock.json');
const backendPresent = existsSync(join(BACKEND, 'interaction.mjs'));
const why = `the backend foundation is not on this branch (read from ${QUOTED_FROM.branch} @ ${QUOTED_FROM.commit}) — the comparison runs after the merge`;

const shared = VOCABULARIES.filter((set) => set.provenance.contract !== null);
const pending = VOCABULARIES.filter((set) => set.provenance.contract === null);

/**
 * The comparison, separated from where the values came from, so the mechanism can be
 * exercised on a synthetic declaration even while the real one is not on the branch.
 */
const compareValues = (set, observed) => {
  const ours = [...set.values].sort();
  const theirs = [...observed].sort();
  return Object.freeze({
    id: set.id,
    ok: ours.length === theirs.length && ours.every((value, index) => value === theirs[index]),
    missing: ours.filter((value) => !theirs.includes(value)),
    unquoted: theirs.filter((value) => !ours.includes(value)),
  });
};

test('every shared vocabulary names the contract, the version, the owner, the file and the symbol it quoted', () => {
  assert.ok(shared.length >= 5, `${shared.length} quoted vocabularies`);
  for (const set of shared) {
    assert.equal(typeof set.provenance.contract.id, 'string', `${set.id} names a contract id`);
    assert.match(set.provenance.contract.version, /^\d+\.\d+\.\d+$/, `${set.id} names a contract version`);
    assert.equal(typeof set.provenance.contract.owner, 'string', `${set.id} names an owner`);
    assert.ok(set.provenance.file.length > 0, `${set.id} names the file the values were read from`);
    assert.ok(set.provenance.symbol.length > 0, `${set.id} names the symbol`);
    assert.ok(set.values.length > 0, `${set.id} carries the values`);
  }
  // A vocabulary with no published contract row must say so, instead of implying one.
  for (const set of pending) {
    assert.ok(set.publicationPending?.length > 20, `${set.id} declares that publication is pending`);
    assert.match(set.publicationPending, /agent-2|manager/, `${set.id} names who has to publish it`);
  }
  assert.equal(QUOTED_FROM.repository, 'Catzpro01/n8n-rust-v.4');
  assert.ok(QUOTED_FROM.commit.length >= 7, 'the quote names the commit it was read at');
});

test('the quoted values are the values the backend module declares', { skip: backendPresent ? false : why }, async () => {
  for (const set of shared) {
    const file = join(REPO_ROOT, set.provenance.file);
    assert.ok(existsSync(file), `${set.provenance.file} exists`);
    const module = await import(pathToFileURL(file).href);
    const declared = module[set.provenance.symbol];
    assert.ok(declared !== undefined, `${set.provenance.symbol} is exported by ${set.provenance.file}`);
    const observed = Array.isArray(declared) ? declared : Object.keys(declared);
    const comparison = compareValues(set, observed);
    assert.equal(comparison.ok, true, `${set.id} drifted from ${set.provenance.symbol}: missing ${comparison.missing}, unquoted ${comparison.unquoted}`);
  }
});

test('the quoted contract versions and owners are the ones the contract lock publishes', { skip: backendPresent ? false : why }, () => {
  const lock = JSON.parse(readFileSync(CONTRACT_LOCK, 'utf8'));
  const rows = Array.isArray(lock) ? lock : (lock.contracts ?? []);
  for (const set of shared) {
    const row = rows.find((entry) => (entry.id ?? entry.contract) === set.provenance.contract.id);
    assert.ok(row, `${set.provenance.contract.id} has a contract-lock row`);
    assert.equal(row.owner, set.provenance.contract.owner, `${set.id} quotes the owner from the lock`);
    if (row.version) assert.equal(row.version, set.provenance.contract.version, `${set.id} quotes the version from the lock`);
  }
});

test('the unlisted transport targets are still the manifest targets', { skip: backendPresent ? false : why }, () => {
  const foundation = JSON.parse(readFileSync(join(BACKEND, 'manifest', 'foundation.json'), 'utf8'));
  const targets = Object.keys(foundation.transport?.targets ?? {});
  const set = pending.find((entry) => entry.id === 'transportTarget');
  assert.deepEqual([...set.values].sort(), [...targets].sort(), 'transport targets are quoted, not invented');
});

test('the lock is self-consistent whether or not the backend is present', () => {
  // Comparing the lock against itself must be a no-op: if it is not, the comparison
  // would report drift that has nothing to do with the other side.
  const observed = Object.fromEntries(VOCABULARIES.map((set) => [set.id, [...set.values]]));
  const drift = vocabularyDrift(observed);
  assert.equal(drift.ok, true, JSON.stringify(drift));

  // And a value the other side does not have is reported, with the term named.
  const extra = vocabularyDrift({ degradation: [...VOCABULARIES.find((set) => set.id === 'degradation').values, 'not-a-state'] });
  assert.equal(extra.ok, false);
  assert.match(JSON.stringify(extra), /not-a-state/);
});

test('the comparison itself fails on drift, so a pass means something', () => {
  const changeKind = VOCABULARIES.find((set) => set.id === 'changeKind');
  assert.equal(compareValues(changeKind, changeKind.values).ok, true, 'the same list compares equal');
  const renamed = compareValues(changeKind, ['unchanged', 'compatible', 'migration-required', 'breaking', 'removed']);
  assert.equal(renamed.ok, false, 'a renamed term is drift');
  assert.deepEqual(renamed.missing, ['downgrade']);
  assert.deepEqual(renamed.unquoted, ['removed']);
  const extended = compareValues(changeKind, [...changeKind.values, 'invented']);
  assert.equal(extended.ok, false, 'an invented term is drift too — the lock does not follow the other side');
  assert.deepEqual(extended.unquoted, ['invented']);
});
