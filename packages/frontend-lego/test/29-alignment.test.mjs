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
// A test that was *told* where the backend tree is must find it: pointing at a tree that is not
// there fails the comparison instead of skipping it.
const skip = backendPresent || overridden ? false : why;

const shared = VOCABULARIES.filter((set) => set.provenance.contract !== null);
const pending = VOCABULARIES.filter((set) => set.provenance.contract === null);

/** The lock rows the pointed-at tree publishes, or an empty list when it publishes none. */
const lockRows = () => {
  if (!existsSync(CONTRACT_LOCK)) return [];
  const lock = JSON.parse(readFileSync(CONTRACT_LOCK, 'utf8'));
  return Array.isArray(lock) ? lock : (lock.contracts ?? []);
};
const skillContractRow = () => lockRows().find((row) => (row.id ?? row.contract) === 'ai.skill') ?? null;

/**
 * The sets whose *published* values the P2.12 finalize moved: `ai.skill` joined the
 * `ai-foundation` capability list, its two permission words joined the published operations, and
 * the Skill operation set became the four caller operations. This branch's own backend copy can
 * predate that (agent-2 lands the lock on its own branch), and a comparison against a tree that
 * predates the published row would report the finalize itself as drift. So those three sets are
 * compared when — and only when — the pointed-at tree publishes `ai.skill`; otherwise the test
 * says so instead of reporting a pass it did not perform.
 */
const MOVED_BY_FINALIZE = Object.freeze(['aiFoundationCapability', 'aiPermission', 'skillOperation']);
const finalized = skillContractRow() !== null;
const awaitingFinalize = new Set(finalized ? [] : MOVED_BY_FINALIZE);
const FINALIZE_SETS = new Set(MOVED_BY_FINALIZE);

/**
 * The P2.13 publication moved five more sets — and it is **GitHub-visible but not on this branch**.
 *
 * Agent-2 published `ai.context@1.0.0` and `ai.agent-session@1.0.0` on
 * `arena/01a0c6b5-n8n-rust-v-4` @ `fb254f32`: two contract-lock rows (15 -> 17), five registry
 * operations instead of two, a sixth AI-set maturity word, the published continuation-field
 * spelling, and the `CONTEXT_MANAGER_STATES` / `CONTINUATION_VERIFICATION` enumerations that this
 * lock had recorded as pending. The lock quotes that publication, because a peer's published change
 * is not an assumption this branch may keep ignoring — but this branch's own backend copy is still
 * `e754c5df`, which carries none of it. So the five sets are compared **only** against a tree that
 * publishes the row (point `N8N_BACKEND_LEGO_ROOT` at the peer tree, or run after the merge), and
 * the test says out loud that it did not compare them otherwise.
 */
const MOVED_BY_P213_PUBLICATION = Object.freeze([
  'aiLegoStatus', 'contextOperation', 'continuationSection', 'contextRolloverPhase', 'continuationVerification',
]);
const contextLockRow = () => lockRows().find((row) => (row.id ?? row.contract) === 'ai.context') ?? null;
const sessionLockRow = () => lockRows().find((row) => (row.id ?? row.contract) === 'ai.agent-session') ?? null;
const published213 = contextLockRow() !== null && sessionLockRow() !== null;
const awaiting213 = new Set(published213 ? [] : MOVED_BY_P213_PUBLICATION);
const P213_SETS = new Set(MOVED_BY_P213_PUBLICATION);

/**
 * The P2.14 publication moved a third group: agent-2 published `ai.memory@1.0.0` on
 * `arena/01a0c90d-n8n-rust-v-4` @ `f11aee01`, which added nine quoted sets and *also* moved two sets
 * an earlier publication had already moved — `aiFoundationCapability` (`ai.memory` joined the
 * capability list) and `aiPermission` (the two `ai:memory:*` words). So `aiFoundationCapability` and
 * `aiPermission` are now moved by BOTH the P2.12 finalize and the P2.14 publication, and a set is
 * awaited when **any** publication that moved it is absent from the pointed-at tree. The
 * bookkeeping below is the shape of that fact rather than three independent flags, because three
 * flags is how one of them ends up checking a tree it never saw.
 */
const MOVED_BY_P214_PUBLICATION = Object.freeze([
  'memoryScope', 'memoryKind', 'memoryRetention', 'memoryField', 'memoryLifecycle',
  'memoryOperation', 'memoryPermission', 'memoryGraphNode', 'memoryGraphEdge',
  'aiFoundationCapability', 'aiPermission',
]);
const memoryLockRow = () => lockRows().find((row) => (row.id ?? row.contract) === 'ai.memory') ?? null;
const published214 = memoryLockRow() !== null;
const P214_SETS = new Set(MOVED_BY_P214_PUBLICATION);

/**
 * Which publications moved a set. A set with two owners is listed twice, once per publication, and
 * the comparison waits for both. Anything not listed here is compared against every tree — which is
 * the normal case and the one that catches an unnoticed backend move.
 */
const PUBLICATIONS = Object.freeze([
  Object.freeze({ id: 'P2.12 finalize', published: finalized, sets: MOVED_BY_FINALIZE, row: () => skillContractRow(), rowId: 'ai.skill' }),
  Object.freeze({ id: 'P2.13 Context & Session', published: published213, sets: MOVED_BY_P213_PUBLICATION, row: () => contextLockRow(), rowId: 'ai.context' }),
  Object.freeze({ id: 'P2.14 Memory', published: published214, sets: MOVED_BY_P214_PUBLICATION, row: () => memoryLockRow(), rowId: 'ai.memory' }),
]);
/** The publications whose words a set was quoted from and which the pointed-at tree does not carry. */
const awaitingFor = (setId) => PUBLICATIONS.filter((publication) => !publication.published && publication.sets.includes(setId));
/** Every `setId@publicationId` pair the tree cannot vouch for, so the bound is exact in both directions. */
const awaitingPairs = () => PUBLICATIONS.flatMap((publication) => (publication.published ? [] : publication.sets.map((setId) => `${setId}@${publication.id}`))).sort();

/** The declaration a set says it quoted: the exported symbol, or the JSON path. */
const declarationOf = (set) => `${set.provenance.file}#${set.provenance.symbol ?? set.provenance.path}`;

/**
 * Splits a declared path into segments on `.`, **ignoring dots inside a selector**.
 *
 * P2.13 needs this: the two Context & Session capabilities are registry entries whose ids contain
 * a dot (`capabilities[id=ai.context]`), and a naive `split('.')` turned that selector into
 * `capabilities[id=ai` + `context]` — which reported "no capabilities with id \"ai\"" instead of
 * reading the declaration. Bracket depth is tracked so a dotted id can be selected; nothing else
 * about the path grammar changes.
 */
const segments = (expression) => {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const character of expression) {
    if (character === '[') depth += 1;
    else if (character === ']') depth -= 1;
    if (character === '.' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts;
};

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
  for (const raw of segments(expression)) {
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
  }
  // A vocabulary with no published contract row must say so, and must ask for one.
  assert.ok(pending.length >= 1, `${pending.length} vocabularies whose publication is pending`);
  const decisions = new Set(DECISIONS.decisions.map((decision) => decision.id));
  // A vocabulary whose publication is *deferred in part* carries an open-decision record instead of a
  // pending publication: the contract is locked, and what stays open is a named half of it. The two
  // keys are different on purpose — `publicationPending` means "no row exists", `openDecision` means
  // "the row exists and this part of it does not".
  for (const set of shared) {
    assert.equal(set.publicationPending, undefined, `${set.id} is published, so it has nothing pending`);
    if (set.openDecision !== undefined) {
      assert.equal(typeof set.openDecision, 'object', `${set.id} declares a structured open-decision record`);
      assert.ok(set.openDecision.what.length > 40, `${set.id} says exactly what stays open`);
      assert.ok(decisions.has(set.openDecision.decision), `${set.id} points at a recorded decision (${set.openDecision.decision})`);
    }
  }
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
  // Empty on purpose: `XA-19` was resolved in the P2.12 finalize by adopting the implemented
  // shape, so no difference between this package's quoted Skill vocabulary and the published
  // declaration is tolerated any more. The table and its machinery stay because *tolerating* a
  // difference is a thing this gate can do — but only for an open registered decision that
  // names the vocabulary, and there is none.
});

/**
 * The table above may not outlive the decision that justified it. Every entry must name a
 * decision that is **recorded**, **still open** and **about this vocabulary** — so an entry
 * cannot keep tolerating a difference after the arbitration closed, and a stale entry is a
 * failure rather than a comment.
 */
test('every tolerated difference is backed by an open registered decision that names it', () => {
  for (const [setId, allowance] of Object.entries(REGISTERED_DRIFT)) {
    const row = DECISIONS.decisions.find((decision) => decision.id === allowance.decision);
    assert.ok(row, `${setId}: ${allowance.decision} is recorded in the register`);
    assert.equal(row.status.startsWith('open'), true, `${setId}: ${allowance.decision} is still open — a resolved decision tolerates nothing`);
    assert.match(
      `${row.question} ${row.finding} ${row.currentInterpretation ?? ''}`,
      new RegExp(setId),
      `${setId}: the open row names this vocabulary`,
    );
  }
});

test('every quoted value is the value the backend declares, in the backend tree that was quoted', { skip }, async (t) => {
  const registered = new Set(DECISIONS.decisions.map((decision) => decision.id));
  const awaited = [];
  const awaitedPublication = [];
  const awaitedMemory = [];
  const awaitedByPublication = Object.fromEntries(PUBLICATIONS.map((publication) => [publication.id, []]));
  for (const publication of PUBLICATIONS) {
    if (!publication.published) {
      t.diagnostic(`the pointed-at backend tree predates ${publication.id} (${CONTRACT_LOCK} publishes no ${publication.rowId} row): ${publication.sets.join(', ')} are quoted from that publication and are not compared against this tree — run with N8N_BACKEND_LEGO_ROOT pointed at the tree that publishes ${publication.rowId}`);
    }
  }
  for (const set of VOCABULARIES) {
    const awaiting = awaitingFor(set.id);
    if (awaiting.length > 0) {
      // The pointed-at tree predates a publication whose words this set quotes, so comparing would
      // probe the publication instead of the quote. Not a pass — an announced, bounded
      // non-comparison, and a set moved by two publications waits for both.
      for (const publication of awaiting) awaitedByPublication[publication.id].push(set.id);
      if (awaiting.some((publication) => publication.id === 'P2.12 finalize')) awaited.push(set.id);
      if (awaiting.some((publication) => publication.id === 'P2.13 Context & Session')) awaitedPublication.push(set.id);
      if (awaiting.some((publication) => publication.id === 'P2.14 Memory')) awaitedMemory.push(set.id);
      continue;
    }
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
  // The skip is not silent and not open-ended: it happens only for the sets a publication moved,
  // and only while the pointed-at lock publishes no row for that publication. The moment it does,
  // every one of its sets is compared. Each bound is asserted in BOTH directions — the awaited set is
  // exactly the published list, and nothing else is quietly skipped.
  if (!published213) {
    assert.deepEqual([...awaitedPublication].sort(), [...MOVED_BY_P213_PUBLICATION].sort(), 'the sets awaiting the P2.13 publication are the five it moved');
    assert.equal(contextLockRow(), null, 'the pointed-at lock publishes no ai.context row');
    assert.equal(existsSync(join(BACKEND, 'context-session.mjs')), false,
      'and the pointed-at tree carries no Context & Session contract surface — the comparison runs against the tree that does');
  } else {
    assert.deepEqual([...awaitedPublication], [], 'nothing is awaited once the pointed-at tree publishes ai.context');
    assert.equal(contextLockRow().version, vocabularyOf('contextRolloverPhase').provenance.contract.version, 'the promoted phase machine quotes the published version');
    assert.equal(sessionLockRow().version, vocabularyOf('agentSessionState').provenance.contract.version, 'and the session sets quote theirs');
  }
  if (!finalized) {
    assert.deepEqual([...awaitingFinalize].sort(), [...MOVED_BY_FINALIZE].sort(), 'the awaited sets are the three the finalize moved');
    assert.equal(skillContractRow(), null, 'the pointed-at lock publishes no ai.skill row');
    assert.equal(existsSync(join(BACKEND, 'manifest', 'skill.json')), false,
      'and the pointed-at tree carries no published Skill manifest — the comparison runs against the tree that does');
  } else {
    assert.deepEqual([...awaitingFinalize], [], 'nothing is awaited once the pointed-at tree publishes ai.skill');
    assert.equal(skillContractRow().version, vocabularyOf('skillLifecycle').provenance.contract.version, 'the quoted version is the published one');
  }
  // The P2.14 bound, and the reason the bookkeeping is a table rather than a flag: two of the sets
  // `ai.memory@1.0.0` moved had already been moved by the P2.12 finalize, so they wait for both
  // publications. A tree carrying `ai.memory` compares all eleven; protected main @ 67e638ef carries
  // neither the row nor the manifest, and the non-comparison is exactly those eleven.
  if (!published214) {
    assert.deepEqual([...awaitedMemory].sort(), [...MOVED_BY_P214_PUBLICATION].sort(), 'the sets awaiting the P2.14 publication are the eleven it moved');
    assert.equal(memoryLockRow(), null, 'the pointed-at lock publishes no ai.memory row');
    assert.equal(existsSync(join(BACKEND, 'manifest', 'memory.json')), false,
      'and the pointed-at tree carries no Memory contract manifest — the comparison runs against the tree that does');
  } else {
    assert.deepEqual([...awaitedMemory], [], 'nothing is awaited once the pointed-at tree publishes ai.memory');
    assert.equal(memoryLockRow().version, vocabularyOf('memoryScope').provenance.contract.version, 'the memory sets quote the published version');
    assert.equal(memoryLockRow().owner, vocabularyOf('memoryField').provenance.contract.owner, 'and the published owner');
  }
  // Whatever the tree carries, the awaited pairs are exactly the pairs this file declares — so a
  // publication nobody recorded cannot silently become a non-comparison.
  assert.deepEqual(Object.entries(awaitedByPublication).flatMap(([id, sets]) => sets.map((setId) => `${setId}@${id}`)).sort(), awaitingPairs(),
    'the non-comparisons are exactly the declared set/publication pairs');
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
  const rows = lockRows();
  for (const set of shared) {
    if (set.provenance.contract.id === 'ai.skill' && !finalized) {
      // Same rule as above: a tree that predates the published row cannot vouch for the quote.
      assert.equal(skillContractRow(), null);
      continue;
    }
    if (set.provenance.contract.id === 'ai.context' && !published213) {
      // The P2.13 publication is on the peer branch: this tree cannot vouch for the quote yet.
      assert.equal(contextLockRow(), null);
      continue;
    }
    if (set.provenance.contract.id === 'ai.memory' && !published214) {
      // Same rule for the P2.14 publication: agent-2 locked `ai.memory@1.0.0` on
      // `arena/01a0c90d-n8n-rust-v-4` @ `f11aee01` and this tree publishes no such row, so it cannot
      // vouch for the quote — and the comparison is announced rather than reported as agreement.
      assert.equal(memoryLockRow(), null);
      continue;
    }
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
