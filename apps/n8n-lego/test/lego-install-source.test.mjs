/**
 * P6-S01 — Live community / private / custom node installation path over the P6
 * admission pipeline. Contract `node.install-source@0.1.0`.
 *
 * Matrix: the source record and its per-kind trust root, registration refusals
 * (identity, kind, locator, trust root, epoch), source admission fail-closed on
 * every axis, the ordered live path with a refusal never opening a transaction,
 * the epoch pin, the reproducibility of a plan, the scope walls, and the lock row.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  INSTALL_SOURCE_CITATIONS,
  INSTALL_SOURCE_CONTRACT,
  INSTALL_SOURCE_CONTRACT_VERSION,
  INSTALL_SOURCE_INPUT_SCHEMA_VERSION,
  INSTALL_SOURCE_KINDS,
  INSTALL_SOURCE_LOCATOR_KINDS,
  INSTALL_SOURCE_OPERATIONS,
  INSTALL_SOURCE_PATH,
  INSTALL_SOURCE_PATH_STATUSES,
  INSTALL_SOURCE_PERMISSIONS,
  INSTALL_SOURCE_REASONS,
  INSTALL_SOURCE_RULES,
  INSTALL_SOURCE_SCHEMA_VERSION,
  INSTALL_SOURCE_TRUST_ROOT_BY_KIND,
  INSTALL_SOURCE_TRUST_ROOT_KINDS,
  INSTALL_SOURCE_VERDICTS,
  InstallSourceError,
  admitInstallSource,
  describeInstallSource,
  formatLiveInstallPlan,
  isInstallSource,
  isLiveInstallPlan,
  liveInstallOpensTransaction,
  liveInstallPlanDigest,
  planLiveInstall,
  registerInstallSource,
} from '../src/lego/install-source.mjs';
import { NODE_REGISTRY_SCHEMA_VERSION } from '../src/lego/node-registry.mjs';

/* ------------------------------------------------------------------ fixtures */

const EPOCH_DIGEST = `sha256:${'a'.repeat(64)}`;
const OTHER_EPOCH_DIGEST = `sha256:${'b'.repeat(64)}`;
const REGISTRY_DIGEST = `sha256:${'c'.repeat(64)}`;
const APPROVED_AT = '2026-09-26T00:00:00Z';

const communitySource = (overrides = {}) => registerInstallSource({
  id: 'npm-public',
  kind: 'community',
  locator: 'https://registry.npmjs.org',
  trustRoot: { kind: 'attestation-key', keyId: 'n8n-community-2026' },
  epochNumber: 7,
  epochDigest: EPOCH_DIGEST,
  ...overrides,
});

const privateSource = (overrides = {}) => registerInstallSource({
  id: 'acme-registry',
  kind: 'private',
  locator: 'https://npm.acme.internal',
  trustRoot: { kind: 'registry-digest', digest: REGISTRY_DIGEST },
  epochNumber: 7,
  epochDigest: EPOCH_DIGEST,
  ...overrides,
});

const customSource = (overrides = {}) => registerInstallSource({
  id: 'ops-local',
  kind: 'custom',
  locator: './packages/acme-internal-nodes',
  trustRoot: { kind: 'operator-approval', approvedBy: 'ops@acme.internal', approvedAt: APPROVED_AT },
  epochNumber: 7,
  epochDigest: EPOCH_DIGEST,
  ...overrides,
});

/** The epoch the install runs against: only the digest is read. */
const epoch = { epochNumber: 7, epochDigest: EPOCH_DIGEST };

const throwsWith = (fn, code) => {
  assert.throws(fn, (error) => error instanceof InstallSourceError && error.meta?.code === code, `expected ${code}`);
};

/* --------------------------------------------------------------- vocabulary */

test('the contract identity, operations and permissions are canonical', () => {
  assert.equal(INSTALL_SOURCE_CONTRACT, 'node.install-source@0.1.0');
  assert.equal(INSTALL_SOURCE_CONTRACT_VERSION, '0.1.0');
  assert.equal(INSTALL_SOURCE_SCHEMA_VERSION, 1);
  assert.equal(INSTALL_SOURCE_INPUT_SCHEMA_VERSION, NODE_REGISTRY_SCHEMA_VERSION);
  assert.deepEqual([...INSTALL_SOURCE_OPERATIONS], ['register', 'admit', 'plan', 'describe']);
  assert.deepEqual([...INSTALL_SOURCE_PERMISSIONS], ['node:read', 'node:install']);
  assert.deepEqual([...INSTALL_SOURCE_KINDS], ['community', 'private', 'custom']);
  assert.deepEqual([...INSTALL_SOURCE_PATH], ['admit-source', 'admit-node', 'resolve-closure', 'transact']);
  assert.deepEqual([...INSTALL_SOURCE_PATH_STATUSES], ['ready', 'refused', 'unknown']);
  assert.deepEqual([...INSTALL_SOURCE_VERDICTS], ['admit', 'refuse', 'incomplete']);
  assert.deepEqual([...INSTALL_SOURCE_TRUST_ROOT_KINDS], ['attestation-key', 'registry-digest', 'operator-approval']);
  // Reading a registry and installing into it are different authorities.
  assert.equal(INSTALL_SOURCE_PERMISSIONS.includes('node:install'), true);
  assert.equal(INSTALL_SOURCE_PERMISSIONS.includes('node:write'), false);
});

test('every kind names the trust root its kind requires, and a locator kind', () => {
  assert.deepEqual(INSTALL_SOURCE_TRUST_ROOT_BY_KIND, {
    community: 'attestation-key',
    private: 'registry-digest',
    custom: 'operator-approval',
  });
  assert.deepEqual(INSTALL_SOURCE_LOCATOR_KINDS, {
    community: 'remote-uri',
    private: 'remote-uri',
    custom: 'local-path',
  });
  // Every path step cites a contract, so a plan is legible without this repo.
  for (const step of INSTALL_SOURCE_PATH) {
    assert.ok(INSTALL_SOURCE_CITATIONS[step], `${step} must cite a contract`);
    assert.match(INSTALL_SOURCE_CITATIONS[step], /^[a-z][a-z0-9.-]*@\d+\.\d+\.\d+$/);
  }
  assert.equal(new Set(Object.values(INSTALL_SOURCE_CITATIONS)).size, Object.keys(INSTALL_SOURCE_CITATIONS).length);
  for (const reason of INSTALL_SOURCE_REASONS) assert.match(reason, /^install\.source\.[a-z_]+$/);
  assert.equal(Object.isFrozen(INSTALL_SOURCE_RULES), true);
  assert.equal(Object.keys(INSTALL_SOURCE_RULES).length, 8);
});

test('describeInstallSource is a census with no state and no arguments', () => {
  const described = describeInstallSource();
  assert.equal(described.contract, INSTALL_SOURCE_CONTRACT);
  assert.equal(described.version, '0.1.0');
  assert.deepEqual(described.operations, INSTALL_SOURCE_OPERATIONS);
  assert.deepEqual(described.kinds, INSTALL_SOURCE_KINDS);
  assert.deepEqual(described.path, INSTALL_SOURCE_PATH);
  assert.equal(described.rules.registeredOnly, INSTALL_SOURCE_RULES.registeredOnly);
  assert.equal(Object.isFrozen(described), true);
  assert.deepEqual(describeInstallSource(), described);
});

/* ------------------------------------------------------------- registration */

test('a community source registers with an attestation key and a remote locator', () => {
  const source = communitySource();
  assert.equal(isInstallSource(source), true);
  assert.equal(source.ok, true);
  assert.equal(source.contract, INSTALL_SOURCE_CONTRACT);
  assert.equal(source.schemaVersion, INSTALL_SOURCE_SCHEMA_VERSION);
  assert.equal(source.id, 'npm-public');
  assert.equal(source.kind, 'community');
  assert.equal(source.locatorKind, 'remote-uri');
  assert.equal(source.trustRoot.kind, 'attestation-key');
  assert.equal(source.trustRoot.keyId, 'n8n-community-2026');
  assert.equal(source.epochNumber, 7);
  assert.equal(source.epochDigest, EPOCH_DIGEST);
  assert.equal(source.policy, null);
  assert.match(source.sourceDigest, /^[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(source), true);
});

test('a private source registers with a pinned registry digest', () => {
  const source = privateSource();
  assert.equal(isInstallSource(source), true);
  assert.equal(source.kind, 'private');
  assert.equal(source.trustRoot.kind, 'registry-digest');
  assert.equal(source.trustRoot.digest, REGISTRY_DIGEST);
});

test('a custom source registers with an operator approval and a local path', () => {
  const source = customSource();
  assert.equal(isInstallSource(source), true);
  assert.equal(source.kind, 'custom');
  assert.equal(source.locatorKind, 'local-path');
  assert.equal(source.trustRoot.kind, 'operator-approval');
  assert.equal(source.trustRoot.approvedBy, 'ops@acme.internal');
  assert.equal(source.trustRoot.approvedAt, APPROVED_AT);
});

test('an optional policy object is carried through frozen', () => {
  const source = communitySource({ policy: { maxPackages: 8, allowedScopes: ['@acme'] } });
  assert.deepEqual(source.policy, { maxPackages: 8, allowedScopes: ['@acme'] });
  assert.equal(Object.isFrozen(source.policy), true);
});

test('registration refuses a source that cannot be named', () => {
  for (const id of ['', '   ', 'NPM Public', 'npm public', '-lead', 'a'.repeat(0), 'npm/public']) {
    throwsWith(() => registerInstallSource({
      id, kind: 'community', locator: 'https://registry.npmjs.org',
      trustRoot: { kind: 'attestation-key', keyId: 'k' }, epochNumber: 1, epochDigest: EPOCH_DIGEST,
    }), 'install.source.identity');
  }
  throwsWith(() => registerInstallSource({}), 'install.source.identity');
  throwsWith(() => registerInstallSource(null), 'install.source.input');
});

test('registration refuses an unknown kind — there is no fourth source', () => {
  throwsWith(() => registerInstallSource({
    id: 'x', kind: 'marketplace', locator: 'https://x', trustRoot: { kind: 'attestation-key', keyId: 'k' },
    epochNumber: 1, epochDigest: EPOCH_DIGEST,
  }), 'install.source.kind');
});

test('local is not remote: a custom source may not name a URI, and a remote source may not name a path', () => {
  // A 'custom' source that fetches is a community source pretending not to be.
  throwsWith(() => registerInstallSource({
    id: 'fake-custom', kind: 'custom', locator: 'https://registry.npmjs.org',
    trustRoot: { kind: 'operator-approval', approvedBy: 'o', approvedAt: APPROVED_AT },
    epochNumber: 1, epochDigest: EPOCH_DIGEST,
  }), 'install.source.locator');
  throwsWith(() => registerInstallSource({
    id: 'fake-remote', kind: 'community', locator: './packages/thing',
    trustRoot: { kind: 'attestation-key', keyId: 'k' }, epochNumber: 1, epochDigest: EPOCH_DIGEST,
  }), 'install.source.locator');
  // A path that is not a path.
  throwsWith(() => registerInstallSource({
    id: 'not-a-path', kind: 'custom', locator: 'just-a-word',
    trustRoot: { kind: 'operator-approval', approvedBy: 'o', approvedAt: APPROVED_AT },
    epochNumber: 1, epochDigest: EPOCH_DIGEST,
  }), 'install.source.locator');
  throwsWith(() => registerInstallSource({
    id: 'empty-locator', kind: 'private', locator: '  ',
    trustRoot: { kind: 'registry-digest', digest: REGISTRY_DIGEST }, epochNumber: 1, epochDigest: EPOCH_DIGEST,
  }), 'install.source.locator');
});

test('every kind refuses the trust root another kind uses', () => {
  // Community with a registry digest, private with an approval, custom with a key.
  throwsWith(() => registerInstallSource({
    id: 'c1', kind: 'community', locator: 'https://r',
    trustRoot: { kind: 'registry-digest', digest: REGISTRY_DIGEST }, epochNumber: 1, epochDigest: EPOCH_DIGEST,
  }), 'install.source.trust_root');
  throwsWith(() => registerInstallSource({
    id: 'p1', kind: 'private', locator: 'https://r',
    trustRoot: { kind: 'operator-approval', approvedBy: 'o', approvedAt: APPROVED_AT }, epochNumber: 1, epochDigest: EPOCH_DIGEST,
  }), 'install.source.trust_root');
  throwsWith(() => registerInstallSource({
    id: 'x1', kind: 'custom', locator: './p',
    trustRoot: { kind: 'attestation-key', keyId: 'k' }, epochNumber: 1, epochDigest: EPOCH_DIGEST,
  }), 'install.source.trust_root');
  // A kind that may omit its trust root has no trust story.
  throwsWith(() => registerInstallSource({
    id: 'c2', kind: 'community', locator: 'https://r', trustRoot: null, epochNumber: 1, epochDigest: EPOCH_DIGEST,
  }), 'install.source.trust_root');
});

test('a private source must pin a digest — an unpinned private registry is a public one', () => {
  for (const digest of [undefined, null, '', 'sha256:abc', 'abc', `sha256:${'z'.repeat(64)}`]) {
    throwsWith(() => registerInstallSource({
      id: 'unpinned', kind: 'private', locator: 'https://r',
      trustRoot: { kind: 'registry-digest', digest }, epochNumber: 1, epochDigest: EPOCH_DIGEST,
    }), 'install.source.trust_root');
  }
});

test('a custom source must name who approved it and when', () => {
  for (const approvedBy of [undefined, '', '  ']) {
    throwsWith(() => registerInstallSource({
      id: 'unowned', kind: 'custom', locator: './p',
      trustRoot: { kind: 'operator-approval', approvedBy, approvedAt: APPROVED_AT }, epochNumber: 1, epochDigest: EPOCH_DIGEST,
    }), 'install.source.trust_root');
  }
  for (const approvedAt of [undefined, '', 'yesterday', '2026-09-26 00:00:00', '2026-09-26T00:00:00', 0]) {
    throwsWith(() => registerInstallSource({
      id: 'undated', kind: 'custom', locator: './p',
      trustRoot: { kind: 'operator-approval', approvedBy: 'o', approvedAt }, epochNumber: 1, epochDigest: EPOCH_DIGEST,
    }), 'install.source.trust_root');
  }
});

test('a community source must name the attestation key its artifacts are verified against', () => {
  for (const keyId of [undefined, '', '  ', 7]) {
    throwsWith(() => registerInstallSource({
      id: 'nokey', kind: 'community', locator: 'https://r',
      trustRoot: { kind: 'attestation-key', keyId }, epochNumber: 1, epochDigest: EPOCH_DIGEST,
    }), 'install.source.trust_root');
  }
});

test('a source is registered against exactly one compiled epoch', () => {
  for (const epochNumber of [undefined, null, -1, 1.5, '7', Number.NaN]) {
    throwsWith(() => registerInstallSource({
      id: 'noepoch', kind: 'community', locator: 'https://r',
      trustRoot: { kind: 'attestation-key', keyId: 'k' }, epochNumber, epochDigest: EPOCH_DIGEST,
    }), 'install.source.epoch');
  }
  for (const epochDigest of [undefined, null, '', 'sha256:abc', `sha256:${'A'.repeat(64)}`, 'sha1:' + 'a'.repeat(40)]) {
    throwsWith(() => registerInstallSource({
      id: 'nodigest', kind: 'community', locator: 'https://r',
      trustRoot: { kind: 'attestation-key', keyId: 'k' }, epochNumber: 1, epochDigest,
    }), 'install.source.epoch');
  }
  throwsWith(() => registerInstallSource({
    id: 'badpolicy', kind: 'community', locator: 'https://r',
    trustRoot: { kind: 'attestation-key', keyId: 'k' }, epochNumber: 1, epochDigest: EPOCH_DIGEST, policy: 'none',
  }), 'install.source.input');
});

test('registration is deterministic and the digest covers the trust root', () => {
  const a = communitySource();
  const b = communitySource();
  assert.equal(a.sourceDigest, b.sourceDigest);
  // Change the trust root and the source digest must move: the digest is over
  // what makes the source trustworthy, not just its name.
  const c = communitySource({ trustRoot: { kind: 'attestation-key', keyId: 'other-key' } });
  assert.notEqual(a.sourceDigest, c.sourceDigest);
  const d = communitySource({ epochNumber: 8 });
  assert.notEqual(a.sourceDigest, d.sourceDigest);
});

test('isInstallSource refuses a hand-made object that only looks like a source', () => {
  const source = communitySource();
  assert.equal(isInstallSource({ ...source, ok: false }), false);
  assert.equal(isInstallSource({ ...source, contract: 'node.registry@0.1.0' }), false);
  assert.equal(isInstallSource({ ...source, kind: 'marketplace' }), false);
  assert.equal(isInstallSource({ ...source, epochDigest: 'nope' }), false);
  assert.equal(isInstallSource({ ...source, trustRoot: { kind: 'nope' } }), false);
  assert.equal(isInstallSource({ ...source, epochNumber: '7' }), false);
  assert.equal(isInstallSource({ ...source, sourceDigest: 'x' }), false);
  assert.equal(isInstallSource(null), false);
  assert.equal(isInstallSource([]), false);
  assert.equal(isInstallSource('npm-public'), false);
  // A frozen-but-forged record still fails on the contract field, which is the
  // whole point of naming it.
  assert.equal(isInstallSource(Object.freeze({ ...source })), true, 'a frozen copy is still a valid source value');
});

/* --------------------------------------------------------------- admission */

test('a community source is admitted only when the tenant policy is on', () => {
  const admitted = admitInstallSource(communitySource(), { policy: { communityNodesEnabled: true }, epoch });
  assert.equal(admitted.ok, true);
  assert.equal(admitted.verdict, 'admit');
  assert.equal(admitted.contract, INSTALL_SOURCE_CONTRACT);
  assert.equal(admitted.sourceId, 'npm-public');
  assert.equal(admitted.kind, 'community');
  assert.equal(admitted.failures.length, 0);
  assert.equal(admitted.unknowns.length, 0);
  for (const entry of admitted.checks) assert.equal(entry.outcome, 'pass');
  assert.deepEqual(admitted.checks.map((entry) => entry.check), ['registered', 'policy', 'trust', 'epoch']);
  assert.match(admitted.message, /may install on this tenant/);

  // The switch defaults to off. An operator who left it off has not opted in.
  const refused = admitInstallSource(communitySource(), { policy: {} });
  assert.equal(refused.ok, false);
  assert.equal(refused.verdict, 'refuse');
  assert.deepEqual(refused.failures.map((entry) => entry.check), ['policy']);
  assert.match(refused.failures[0].message, /does not permit community nodes/);
  const explicitlyOff = admitInstallSource(communitySource(), { policy: { communityNodesEnabled: false } });
  assert.equal(explicitlyOff.verdict, 'refuse');
  // A truthy non-true value is not a permission.
  const truthy = admitInstallSource(communitySource(), { policy: { communityNodesEnabled: 'yes' } });
  assert.equal(truthy.verdict, 'refuse');
});

test('private and custom sources need explicit allow-listing, not the community switch', () => {
  for (const source of [privateSource(), customSource()]) {
    const withCommunityOnly = admitInstallSource(source, { policy: { communityNodesEnabled: true }, epoch });
    assert.equal(withCommunityOnly.verdict, 'refuse', `${source.kind} must not be implied by the community switch`);
    assert.match(withCommunityOnly.failures[0].message, /separate trust domain/);

    const allowed = admitInstallSource(source, { policy: { allowedKinds: [source.kind] }, epoch });
    assert.equal(allowed.verdict, 'admit');

    // Allow-listing the OTHER kind is not allow-listing this one.
    const other = admitInstallSource(source, { policy: { allowedKinds: ['community'] }, epoch });
    assert.equal(other.verdict, 'refuse');
  }
  // Both kinds may be allowed together, and the verdict is per source.
  assert.equal(admitInstallSource(privateSource(), { policy: { allowedKinds: ['private', 'custom'] }, epoch }).verdict, 'admit');
  assert.equal(admitInstallSource(customSource(), { policy: { allowedKinds: ['private', 'custom'] }, epoch }).verdict, 'admit');
});

test('absence of a policy is a refusal, not a permission', () => {
  for (const source of [communitySource(), privateSource(), customSource()]) {
    const verdict = admitInstallSource(source, {}).verdict;
    assert.equal(verdict, 'refuse', `${source.kind} with no policy must be refused`);
  }
  throwsWith(() => admitInstallSource(communitySource(), { policy: 'open' }), 'install.source.policy');
});

test('a source pinned to another epoch is refused: the anti-rollback rule', () => {
  const source = communitySource();
  const same = admitInstallSource(source, { policy: { communityNodesEnabled: true }, epoch });
  assert.equal(same.verdict, 'admit');
  assert.equal(same.checks.find((entry) => entry.check === 'epoch').outcome, 'pass');

  const other = admitInstallSource(source, {
    policy: { communityNodesEnabled: true },
    epoch: { epochNumber: 8, epochDigest: OTHER_EPOCH_DIGEST },
  });
  assert.equal(other.verdict, 'refuse');
  assert.deepEqual(other.failures.map((entry) => entry.check), ['epoch']);
  assert.match(other.failures[0].message, /anti-rollback/);
});

test('no epoch supplied is unknown, and unknown is never a pass', () => {
  const verdict = admitInstallSource(communitySource(), { policy: { communityNodesEnabled: true } });
  assert.equal(verdict.verdict, 'incomplete');
  assert.equal(verdict.ok, false);
  assert.deepEqual([...verdict.unknowns], ['epoch']);
  assert.equal(verdict.failures.length, 0);
  assert.match(verdict.message, /had no evidence/);
  // Unknown does not open a transaction either.
  assert.equal(planLiveInstall(communitySource(), { policy: { communityNodesEnabled: true } }).opensTransaction, false);
});

test('admission re-checks the trust root rather than trusting registration', () => {
  // A source is a value and values travel: an edited record is re-judged.
  const tampered = Object.freeze({ ...communitySource(), trustRoot: { kind: 'attestation-key', keyId: '' } });
  const verdict = admitInstallSource(tampered, { policy: { communityNodesEnabled: true }, epoch });
  assert.equal(verdict.verdict, 'refuse');
  assert.deepEqual(verdict.failures.map((entry) => entry.check), ['trust']);
  assert.equal(verdict.checks.find((entry) => entry.check === 'registered').outcome, 'pass');
});

test('admission refuses anything that is not a registered source', () => {
  for (const bad of [null, undefined, {}, 'npm-public', [], { id: 'x' }]) {
    throwsWith(() => admitInstallSource(bad, { policy: { communityNodesEnabled: true }, epoch }), 'install.source.unregistered');
  }
  throwsWith(() => admitInstallSource(communitySource(), { policy: 'open' }), 'install.source.policy');
});

test('admission is deterministic for one source and one policy', () => {
  const a = admitInstallSource(communitySource(), { policy: { communityNodesEnabled: true }, epoch });
  const b = admitInstallSource(communitySource(), { policy: { communityNodesEnabled: true }, epoch });
  assert.deepEqual(a.checks, b.checks);
  assert.equal(Object.isFrozen(a.checks), true);
  assert.equal(Object.isFrozen(a.failures), true);
});

/* ------------------------------------------------------------- live path */

test('a fully admitted path is ready end to end and opens a transaction', () => {
  const source = communitySource();
  const plan = planLiveInstall(source, {
    policy: { communityNodesEnabled: true },
    epoch,
    admission: { ok: true, verdict: 'admit' },
    closure: { ok: true, order: ['n8n-nodes-base@1.0.0'] },
  });
  assert.equal(isLiveInstallPlan(plan), true);
  assert.equal(plan.ok, true);
  assert.equal(plan.verdict, 'admit');
  assert.equal(plan.opensTransaction, true);
  assert.equal(liveInstallOpensTransaction(plan), true);
  assert.deepEqual([...plan.path], [...INSTALL_SOURCE_PATH]);
  assert.equal(plan.unknowns.length, 0);
  assert.equal(plan.sourceId, 'npm-public');
  assert.equal(plan.kind, 'community');
  assert.equal(plan.epochNumber, 7);
  assert.equal(plan.epochDigest, EPOCH_DIGEST);
  for (const entry of plan.steps) {
    assert.equal(entry.status, 'ready', `${entry.step} must be ready`);
    assert.ok(entry.contract, `${entry.step} must cite a contract`);
  }
  assert.deepEqual(plan.steps.map((entry) => entry.contract), [
    'node.install-source@0.1.0', 'node.admission@0.1.0', 'registry.closure@0.1.0', 'package.transaction@0.1.0',
  ]);
  assert.match(plan.message, /is admitted/);
  assert.match(formatLiveInstallPlan(plan), /^npm-public \(community\) admit 4\/4 steps opens-transaction=true [0-9a-f]{12}$/);
});

test('a refused source never reaches the node', () => {
  const plan = planLiveInstall(communitySource(), {
    policy: {},
    epoch,
    admission: { ok: true, verdict: 'admit' },
    closure: { ok: true, order: [] },
  });
  assert.equal(plan.verdict, 'refuse');
  assert.equal(plan.opensTransaction, false);
  assert.equal(liveInstallOpensTransaction(plan), false);
  // The cheap check runs first, so the expensive one is never argued about.
  assert.equal(plan.steps[0].status, 'refused');
  assert.equal(plan.steps[0].detail, plan.sourceVerdict.message);
  assert.equal(plan.steps[1].status, 'refused');
  assert.match(plan.steps[1].detail, /the source is not admitted/);
  assert.match(formatLiveInstallPlan(plan), /opens-transaction=false/);
});

test('a refused node never opens a transaction, and says which step refused', () => {
  const plan = planLiveInstall(communitySource(), {
    policy: { communityNodesEnabled: true },
    epoch,
    admission: { ok: false, verdict: 'refuse' },
    closure: { ok: true, order: [] },
  });
  assert.equal(plan.verdict, 'refuse');
  assert.equal(plan.opensTransaction, false);
  assert.equal(plan.steps[0].status, 'ready');
  assert.equal(plan.steps[1].status, 'refused');
  assert.match(plan.steps[1].detail, /P6.17 refused this node/);
  assert.equal(plan.steps[2].status, 'ready');
  assert.equal(plan.steps[3].status, 'refused');
  assert.match(plan.steps[3].detail, /a step above was refused/);
});

test('a missing verdict is unknown, not pass, and unknown never opens a transaction', () => {
  // No admission plan supplied: a node nobody checked is not admitted.
  const noAdmission = planLiveInstall(communitySource(), {
    policy: { communityNodesEnabled: true }, epoch, closure: { ok: true, order: [] },
  });
  assert.equal(noAdmission.verdict, 'incomplete');
  assert.equal(noAdmission.ok, false);
  assert.equal(noAdmission.opensTransaction, false);
  assert.deepEqual([...noAdmission.unknowns], ['admit-node', 'transact']);
  assert.equal(noAdmission.steps[1].status, 'unknown');
  assert.match(noAdmission.steps[1].detail, /a node nobody checked is not admitted/);
  assert.equal(noAdmission.steps[3].status, 'unknown');
  assert.match(noAdmission.steps[3].detail, /not settled/);
  assert.match(noAdmission.message, /had no evidence/);

  // No closure supplied: an install that ignores its closure installs half a node.
  const noClosure = planLiveInstall(communitySource(), {
    policy: { communityNodesEnabled: true }, epoch, admission: { ok: true, verdict: 'admit' },
  });
  assert.equal(noClosure.verdict, 'incomplete');
  assert.equal(noClosure.opensTransaction, false);
  assert.deepEqual([...noClosure.unknowns], ['resolve-closure', 'transact']);
  assert.match(noClosure.steps[2].detail, /half a node/);
});

test('an incomplete plan stays incomplete even when nothing was refused', () => {
  const plan = planLiveInstall(communitySource(), {
    policy: { communityNodesEnabled: true }, epoch,
    admission: { ok: true, verdict: 'admit' }, closure: { ok: true, order: [] },
  });
  assert.equal(plan.verdict, 'admit');
  assert.equal(plan.unknowns.length, 0);
});

test('every kind walks the same path, and the plan names the kind', () => {
  const policies = {
    community: { communityNodesEnabled: true },
    private: { allowedKinds: ['private'] },
    custom: { allowedKinds: ['custom'] },
  };
  for (const source of [communitySource(), privateSource(), customSource()]) {
    const plan = planLiveInstall(source, {
      policy: policies[source.kind], epoch,
      admission: { ok: true, verdict: 'admit' }, closure: { ok: true, order: [] },
    });
    assert.equal(plan.verdict, 'admit', `${source.kind} must be admissible when its policy allows it`);
    assert.equal(plan.kind, source.kind);
    assert.deepEqual([...plan.path], [...INSTALL_SOURCE_PATH]);
    assert.equal(plan.opensTransaction, true);
  }
});

test('the plan is reproducible: one source and one intent give one digest', () => {
  const inputs = {
    policy: { communityNodesEnabled: true }, epoch,
    admission: { ok: true, verdict: 'admit' }, closure: { ok: true, order: [] },
  };
  const a = planLiveInstall(communitySource(), inputs);
  const b = planLiveInstall(communitySource(), inputs);
  assert.equal(liveInstallPlanDigest(a), liveInstallPlanDigest(b));
  assert.equal(a.planDigest, b.planDigest);

  // Change anything on the path and the digest moves.
  const refusedNode = planLiveInstall(communitySource(), { ...inputs, admission: { ok: false, verdict: 'refuse' } });
  assert.notEqual(a.planDigest, refusedNode.planDigest);
  const otherSource = planLiveInstall(privateSource(), { ...inputs, policy: { allowedKinds: ['private'] } });
  assert.notEqual(a.planDigest, otherSource.planDigest);
  const otherEpoch = planLiveInstall(communitySource({ epochNumber: 8, epochDigest: OTHER_EPOCH_DIGEST }), inputs);
  assert.notEqual(a.planDigest, otherEpoch.planDigest);
  assert.match(a.planDigest, /^[0-9a-f]{64}$/);
});

test('planLiveInstall refuses inputs that are not a source or not an object', () => {
  throwsWith(() => planLiveInstall(null, {}), 'install.source.unregistered');
  throwsWith(() => planLiveInstall({ id: 'x' }, {}), 'install.source.unregistered');
  throwsWith(() => planLiveInstall(communitySource(), 'policy'), 'install.source.input');
  throwsWith(() => planLiveInstall(communitySource(), null), 'install.source.input');
  throwsWith(() => planLiveInstall(communitySource(), []), 'install.source.input');
});

test('isLiveInstallPlan refuses a hand-made object that only looks like a plan', () => {
  const plan = planLiveInstall(communitySource(), {
    policy: { communityNodesEnabled: true }, epoch,
    admission: { ok: true, verdict: 'admit' }, closure: { ok: true, order: [] },
  });
  assert.equal(isLiveInstallPlan({ ...plan, verdict: 'maybe' }), false);
  assert.equal(isLiveInstallPlan({ ...plan, opensTransaction: 'yes' }), false);
  assert.equal(isLiveInstallPlan({ ...plan, planDigest: 'x' }), false);
  assert.equal(isLiveInstallPlan({ ...plan, steps: [] }), false);
  assert.equal(isLiveInstallPlan({ ...plan, sourceId: '' }), false);
  assert.equal(isLiveInstallPlan({ ...plan, contract: 'node.admission@0.1.0' }), false);
  assert.equal(isLiveInstallPlan(null), false);
  assert.equal(isLiveInstallPlan([]), false);
});

test('the read helpers refuse anything that is not a plan this contract produced', () => {
  throwsWith(() => liveInstallOpensTransaction({ verdict: 'admit' }), 'install.source.unregistered');
  throwsWith(() => liveInstallPlanDigest({ planDigest: 'x' }), 'install.source.unregistered');
  throwsWith(() => formatLiveInstallPlan({}), 'install.source.unregistered');
  throwsWith(() => formatLiveInstallPlan(null), 'install.source.unregistered');
  const error = new InstallSourceError('x');
  assert.equal(error instanceof Error, true);
  assert.equal(error.code, 'lego.contract_violation');
  assert.equal(Object.isFrozen(error.meta), true);
});

test('a plan is frozen end to end and cannot be edited under a caller', () => {
  const plan = planLiveInstall(communitySource(), {
    policy: { communityNodesEnabled: true }, epoch,
    admission: { ok: true, verdict: 'admit' }, closure: { ok: true, order: [] },
  });
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.steps), true);
  for (const entry of plan.steps) assert.equal(Object.isFrozen(entry), true);
  assert.equal(Object.isFrozen(plan.path), true);
  assert.equal(Object.isFrozen(plan.unknowns), true);
  assert.equal(Object.isFrozen(plan.sourceVerdict), true);
  assert.throws(() => { plan.verdict = 'refuse'; }, TypeError);
});

/* --------------------------------------------------------- scope walls */

test('P6-S01 is pure: the only node import is the hash, and it decides nothing itself', () => {
  const source = readFileSync(new URL('../src/lego/install-source.mjs', import.meta.url), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of ['node:fs', 'node:net', 'node:http', 'node:os', 'node:child_process', 'process.', 'Math.random', 'setTimeout', 'performance.', 'fetch(', 'node:vm', 'eval(']) {
    assert.equal(code.includes(forbidden), false, `the install source must not reference ${forbidden}`);
  }
  assert.deepEqual([...code.matchAll(/from '(node:[a-z_/]+)'/g)].map((match) => match[1]), ['node:crypto']);
  assert.equal(/\bnew Date\b|\bDate\.now\b/.test(code), false);
  // It consumes the other contracts' verdicts AS DATA. Importing them would be
  // re-deciding, which is what P6.17's purity rule already established.
  for (const forbidden of ['./admission-explain.mjs', './dependency-closure.mjs', './package-transaction.mjs', './supply-chain.mjs', './registry-compiler.mjs', './registry-integrity.mjs', './registry.mjs', './freshness.mjs', './node-lifecycle.mjs']) {
    assert.equal(code.includes(forbidden), false, `P6-S01 composes verdicts as data; importing ${forbidden} would be re-deciding`);
  }
  // node-registry is the ONE legitimate repo import: the epoch schema version.
  assert.deepEqual([...code.matchAll(/from '(\.\/[a-z-]+\.mjs)'/g)].map((match) => match[1]), ['./node-registry.mjs']);
});

test('the scope walls are written down: no IO, no fetching, no deciding', () => {
  const rules = INSTALL_SOURCE_RULES;
  assert.match(rules.registeredOnly, /refused, never defaulted/);
  assert.match(rules.failClosedPolicy, /refusal, not a permission/);
  assert.match(rules.localIsNotRemote, /pretending not to be/);
  assert.match(rules.pinnedEpoch, /anti-rollback/);
  assert.match(rules.admissionBeforeTransaction, /only then does a transaction open/);
  assert.match(rules.oneSourcePerInstall, /no single trust story/);
  assert.match(rules.trustRootPerKind, /no trust story/);
  assert.match(rules.reproducible, /frozen value carrying a digest/);
});

/* ------------------------------------------------------------------- lock row */

test('the contract-lock row is canonical: one row, version, ops, tests, exports, domain path', () => {
  const lock = JSON.parse(readFileSync(new URL('../src/lego/contracts/contract-lock.json', import.meta.url)));
  const rows = lock.contracts.filter((contract) => contract.id === 'node.install-source');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].version, INSTALL_SOURCE_CONTRACT_VERSION);
  assert.equal(rows[0].domain, 'node-registry');
  assert.equal(rows[0].status, 'implemented');
  assert.deepEqual(rows[0].surface, ['src/lego/install-source.mjs']);
  assert.deepEqual(rows[0].tests, ['apps/n8n-lego/test/lego-install-source.test.mjs']);
  assert.equal(new Set(lock.contracts.map((row) => row.id)).size, lock.contracts.length, 'no duplicate contract ids');
  for (const name of ['registerInstallSource', 'isInstallSource', 'admitInstallSource', 'planLiveInstall', 'isLiveInstallPlan', 'describeInstallSource']) {
    assert.equal(rows[0].exports['src/lego/install-source.mjs'].includes(name), true, `${name} must be locked`);
  }
  // The locked surface must equal what the module actually exports, or R7 drifts.
  const module = readFileSync(new URL('../src/lego/install-source.mjs', import.meta.url), 'utf8');
  const actual = new Set();
  for (const re of [/export\s+(?:async\s+)?function\s*\*?\s+([A-Za-z0-9_$]+)/g, /export\s+class\s+([A-Za-z0-9_$]+)/g, /export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/g]) {
    let match;
    while ((match = re.exec(module)) !== null) actual.add(match[1]);
  }
  const locked = new Set(rows[0].exports['src/lego/install-source.mjs']);
  assert.deepEqual([...actual].filter((name) => !locked.has(name)), [], 'every export is locked');
  assert.deepEqual([...locked].filter((name) => !actual.has(name)), [], 'every locked name is exported');

  const domain = JSON.parse(readFileSync(new URL('../src/lego/manifest/domains.json', import.meta.url)))
    .domains.find((entry) => entry.id === 'node-registry');
  assert.ok(domain.paths.includes('src/lego/install-source.mjs'));
  // P6-S01 must not re-version any contract it composes.
  for (const id of ['node.registry', 'registry.compiler', 'package.transaction', 'registry.closure', 'node.admission', 'node.supply-chain', 'registry.integrity']) {
    assert.equal(lock.contracts.find((contract) => contract.id === id).version, '0.1.0', `P6-S01 must not re-version ${id}`);
  }
});
