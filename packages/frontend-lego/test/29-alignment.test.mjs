/**
 * Alignment — the lock in `src/vocabulary.mjs` against the backend foundation it quotes.
 *
 * The lock is data with provenance, so the honest check is a *comparison*: read the
 * declaration the lock says it read, and compare. The backend foundation (P2.6–P2.10,
 * `apps/n8n-lego/src/lego/**`) is owned by another agent and lands on this branch when
 * it is merged, so the comparison **skips with a stated reason** when those files are
 * not here — it never reports a pass it did not perform. The self-consistency half
 * always runs.
 *
 * Before the merge the comparison can still be exercised for real: unpack the other
 * agent's tree somewhere and point `N8N_BACKEND_LEGO_ROOT` at its `.../src/lego`
 * (for example `git archive origin/a2 | tar -x -C /tmp/a2`). With the override set, a
 * missing file is a **failure**, never a skip — the comparison only skips when the
 * backend is simply not on this branch and nobody asked for it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PACKAGE_ROOT } from '../src/manifests.mjs';
import { QUOTED_FROM, VOCABULARIES, vocabularyDrift, vocabularyOf } from '../src/vocabulary.mjs';

const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
const DEFAULT_BACKEND = join(REPO_ROOT, 'apps', 'n8n-lego', 'src', 'lego');
const BACKEND = process.env.N8N_BACKEND_LEGO_ROOT ?? DEFAULT_BACKEND;
const overridden = process.env.N8N_BACKEND_LEGO_ROOT !== undefined;
const CONTRACT_LOCK = join(BACKEND, 'contracts', 'contract-lock.json');
const DECISIONS = JSON.parse(readFileSync(join(REPO_ROOT, 'docs', 'n8n-lego', 'decisions', 'cross-agent-decisions.json'), 'utf8'));
const backendPresent = existsSync(join(BACKEND, 'interaction.mjs'));
const why = overridden
  ? `N8N_BACKEND_LEGO_ROOT is set but ${BACKEND} has no backend foundation`
  : `the backend foundation is not on this branch (read from ${QUOTED_FROM.branch} @ ${QUOTED_FROM.commit}) — the comparison runs after the merge`;
const skip = backendPresent ? false : why;

const shared = VOCABULARIES.filter((set) => set.provenance.contract !== null);
const pending = VOCABULARIES.filter((set) => set.provenance.contract === null);

/** The declaration a set says it quoted: the exported symbol, or the JSON path. */
const declarationOf = (set) => `${set.provenance.file}#${set.provenance.symbol ?? set.provenance.path}`;

/**
 * Walks a declared JSON path. `[]` maps and flattens an array, `[id=x]` selects one
 * entry, a bare segment maps over an array or reads a key. Kept deliberately small:
 * a path that does not resolve must fail, not return something plausible.
 */
const projection = (expression, document) => {
  // `a.b.required+optional` means "all of these", never a new declaration.
  if (expression.includes('+')) {
    const head = expression.slice(0, expression.lastIndexOf('.') + 1);
    return expression.slice(head.length).split('+').flatMap((part) => projection(head + part, document));
  }
  let cursor = document;
  for (const raw of expression.split('.')) {
    if (raw.endsWith('[]')) {
      const key = raw.slice(0, -2);
      if (!Array.isArray(cursor)) {
        cursor = cursor[key];
        continue;
      }
      cursor = cursor.flatMap((item) => (Array.isArray(item[key]) ? item[key] : [item[key]]));
    } else if (raw.includes('#id=')) {
      const [key, want] = raw.split('#id=');
      cursor = cursor[key].find((item) => item.id === want);
      assert.ok(cursor, `no ${key} with id "${want}"`);
    } else if (raw.includes('[')) {
      const [key, condition] = raw.split('[');
      const want = condition.replace(/\]$/, '').replace(/^id=/, '');
      cursor = cursor[key].find((item) => item.id === want);
      assert.ok(cursor, `no ${key} with id "${want}"`);
    } else if (Array.isArray(cursor)) {
      cursor = cursor.map((item) => item[raw]);
    } else {
      cursor = cursor[raw];
    }
    assert.notEqual(cursor, undefined, `"${expression}" does not resolve`);
  }
  return cursor;
};

/** The values a declaration holds, in the mode the lock's provenance names. */
const observedFrom = (declared, read) => {
  if (Array.isArray(declared)) return read === 'unique' ? [...new Set(declared)] : [...declared];
  if (read === 'keys') return Object.keys(declared);
  if (read === 'unique') return [...new Set(Object.values(declared))];
  if (read === 'values') return Object.values(declared);
  return Object.keys(declared);
};

/** Reads the backend file a set quotes and extracts the declaration from it. */
const readDeclaration = async (set) => {
  const relative = set.provenance.file.replace(/^apps\/n8n-lego\/src\/lego\//, '');
  const file = join(BACKEND, relative);
  assert.ok(existsSync(file), `${set.id}: ${set.provenance.file} exists in the backend tree`);
  if (set.provenance.kind === 'module') {
    const module = await import(pathToFileURL(file).href);
    const declared = module[set.provenance.symbol];
    assert.notEqual(declared, undefined, `${set.id}: ${set.provenance.symbol} is exported by ${set.provenance.file}`);
    return observedFrom(declared, set.provenance.read);
  }
  const document = JSON.parse(readFileSync(file, 'utf8'));
  const projected = projection(set.provenance.path, document);
  if (set.provenance.read === 'id') return projected.map((entry) => entry.id);
  if (Array.isArray(projected)) return set.provenance.read === 'unique' ? [...new Set(projected)] : projected;
  return observedFrom(projected, set.provenance.read);
};

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

test('every shared vocabulary names the contract, the version, the owner and the declaration it quoted', () => {
  assert.ok(shared.length >= 5, `${shared.length} contract-pinned vocabularies`);
  for (const set of shared) {
    assert.equal(typeof set.provenance.contract.id, 'string', `${set.id} names a contract id`);
    assert.match(set.provenance.contract.version, /^\d+\.\d+\.\d+$/, `${set.id} names a contract version`);
    assert.equal(typeof set.provenance.contract.owner, 'string', `${set.id} names an owner`);
    assert.ok(set.provenance.file.length > 0, `${set.id} names the file the values were read from`);
    assert.ok((set.provenance.symbol ?? set.provenance.path).length > 0, `${set.id} names the declaration it read`);
    assert.ok(set.values.length > 0, `${set.id} carries the values`);
    assert.equal(set.publicationPending, undefined, `${set.id} is published, so it has nothing pending`);
  }
  // A vocabulary with no published contract row must say so, and must ask for one.
  assert.ok(pending.length >= 1, `${pending.length} vocabularies whose publication is pending`);
  const decisions = new Set(DECISIONS.decisions.map((decision) => decision.id));
  for (const set of pending) {
    const record = set.publicationPending;
    assert.equal(typeof record, 'object', `${set.id} declares a structured publication record`);
    assert.equal(typeof record.owner, 'string', `${set.id} names the owner who must publish it`);
    assert.equal(typeof record.domain, 'string', `${set.id} names the domain that declares the file`);
    assert.ok(record.what.length > 40, `${set.id} says exactly what is unpublished`);
    assert.ok(decisions.has(record.decision), `${set.id} points at a recorded decision (${record.decision})`);
    assert.equal(set.provenance.contract, null, `${set.id} does not claim a contract it has not found`);
  }
  assert.equal(QUOTED_FROM.repository, 'Catzpro01/n8n-rust-v.4');
  assert.ok(QUOTED_FROM.commit.length >= 7, 'the quote names the commit it was read at');
});

/**
 * Differences that are *registered* rather than resolved.
 *
 * The frontend may quote only what a declaration publishes, and it may not pretend a
 * difference is not there. When the backend moves first (it owns the manifests), the
 * difference is reported and recorded as an open arbitration row: this table says which
 * difference is expected, and the test still requires the register to carry it as an open
 * decision. A difference that is **not** in this table fails, so this is not a bypass — it
 * is the same rule the Skill surface applies, checked against the alignment gate.
 */
const REGISTERED_DRIFT = Object.freeze({
  aiFoundationCapability: Object.freeze({ unquoted: Object.freeze(['ai.skill']), decision: 'XA-19' }),
  aiPermission: Object.freeze({ unquoted: Object.freeze(['ai:skill:read', 'ai:skill:select']), decision: 'XA-19' }),
  skillOperation: Object.freeze({
    unquoted: Object.freeze(['resolve', 'validate-selection']),
    missing: Object.freeze(['load', 'register', 'release', 'select']),
    decision: 'XA-19',
  }),
});

test('every quoted value is the value the backend declares, in the backend tree that was quoted', { skip }, async () => {
  const registered = new Set(DECISIONS.decisions.map((decision) => decision.id));
  for (const set of VOCABULARIES) {
    const observed = await readDeclaration(set);
    const comparison = compareValues(set, observed);
    const allowance = comparison.ok ? null : REGISTERED_DRIFT[set.id] ?? null;
    if (allowance !== null) {
      // The difference must be exactly the registered one, in both directions.
      assert.deepEqual(comparison.unquoted, [...allowance.unquoted], `${set.id}: the unquoted values are the registered ones`);
      assert.deepEqual(comparison.missing, [...(allowance.missing ?? [])], `${set.id}: the values the declaration dropped are the registered ones — the quote moves only by reconciliation`);
      const row = DECISIONS.decisions.find((decision) => decision.id === allowance.decision);
      assert.ok(row, `${set.id}: ${allowance.decision} is recorded`);
      assert.equal(row.status.startsWith('open'), true, `${set.id}: ${allowance.decision} is still open — the frontend does not resolve it`);
      assert.match(row.question + row.finding, new RegExp(set.id), `${set.id}: the open row names this vocabulary`);
      continue;
    }
    assert.equal(
      comparison.ok,
      true,
      `${set.id} drifted from ${declarationOf(set)}: missing ${JSON.stringify(comparison.missing)}, unquoted ${JSON.stringify(comparison.unquoted)}`
      + (registered.size > 0 ? ' — a new difference must be registered before it is accepted' : ''),
    );
  }
});

test('the quoted semantics — not only the words — are the ones the backend declares', { skip }, async () => {
  const interaction = await import(pathToFileURL(join(BACKEND, 'interaction.mjs')).href);
  const degradation = vocabularyOf('degradation');
  const states = interaction.DEGRADATION_STATES;
  assert.deepEqual(Object.keys(degradation.actions).sort(), Object.keys(states).sort(), 'every degradation state has its quoted action');
  for (const [state, entry] of Object.entries(states)) {
    assert.equal(degradation.actions[state], entry.action, `the action of "${state}" is quoted, not softened`);
  }
  assert.deepEqual(
    Object.keys(states).filter((state) => states[state].usable).sort(),
    Object.keys(degradation.usable).sort(),
    'exactly the usable states are marked usable',
  );

  const negotiation = await import(pathToFileURL(join(BACKEND, 'negotiation.mjs')).href);
  const callable = Object.entries(negotiation.LIFECYCLE_STATES).filter(([, entry]) => entry.callable).map(([state]) => state);
  assert.deepEqual([...vocabularyOf('lifecycle').callable].sort(), callable.sort(), 'the callable lifecycle states are quoted');
});

test('the quoted contract versions and owners are the ones the contract lock publishes', { skip }, () => {
  const lock = JSON.parse(readFileSync(CONTRACT_LOCK, 'utf8'));
  const rows = Array.isArray(lock) ? lock : (lock.contracts ?? []);
  for (const set of shared) {
    const row = rows.find((entry) => (entry.id ?? entry.contract) === set.provenance.contract.id);
    assert.ok(row, `${set.provenance.contract.id} has a contract-lock row`);
    assert.equal(row.owner, set.provenance.contract.owner, `${set.id} quotes the owner from the lock`);
    if (row.version) assert.equal(row.version, set.provenance.contract.version, `${set.id} quotes the version from the lock`);
  }
});

test('the unlisted transport targets are still the manifest targets', { skip }, () => {
  const foundation = JSON.parse(readFileSync(join(BACKEND, 'manifest', 'foundation.json'), 'utf8'));
  const targets = Array.isArray(foundation.transport?.targets)
    ? foundation.transport.targets
    : Object.keys(foundation.transport?.targets ?? {});
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
