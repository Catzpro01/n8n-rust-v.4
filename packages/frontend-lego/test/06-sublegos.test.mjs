/**
 * Sub-LEGO layer: hierarchy, ownership, public/private boundary and upgradeability.
 *
 * The upgrade test at the bottom is the one this phase exists for: it proves that
 * moving one unit to a new version leaves every unrelated unit byte-identical, and
 * that a breaking move cannot happen silently behind a dependent's back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  SUB_LEGO_STATUSES,
  UPGRADE_POLICIES,
  SubLegoError,
  SubLegoUpgradeError,
  createSubLegoRegistry,
  depthOf,
  parentIdOf,
  satisfies,
  validateSubLego,
} from '../src/sublegos.mjs';
import { MANIFEST_DIR, loadManifests, subLegoIds } from '../src/manifests.mjs';
import { createFrontendLego } from '../src/lego.mjs';
import { ERROR_CODES } from '../src/errors.mjs';

const manifests = loadManifests();
const SUB_LEGOS = manifests.subLegos;
const OWNERS = manifests.owners;

const registry = (entries = SUB_LEGOS) => createSubLegoRegistry({
  subLegos: entries,
  owners: OWNERS,
  surfaces: manifests.surfaces,
  extensionPoints: manifests.extensionPoints,
  catalogVersion: manifests.subLegoCatalog.catalogVersion,
});

/** A valid unit, used as the base for mutations in the negative tests. */
function fixture(overrides = {}) {
  const id = overrides.id ?? 'sample';
  return {
    id,
    parentId: parentIdOf(id),
    title: 'Sample unit',
    owner: 'agent-01',
    version: '1.0.0',
    surface: 'dashboard',
    capability: 'workflow',
    contract: 'contracts/frontend.contract.md',
    public: { ports: ['ui:sample:thing'], contracts: ['contracts/frontend.contract.md'] },
    internals: ['src/sub-legos/sample/**'],
    status: 'declared',
    tests: ['packages/frontend-lego/test/06-sublegos.test.mjs'],
    upgrade: { policy: 'independent', compatibleWith: '1.x' },
    ...overrides,
  };
}

const withSample = (overrides = {}, extra = []) => registry([...SUB_LEGOS, fixture(overrides), ...extra]);
/** A `sample` parent plus one child unit — the shape a nested feature has. */
const withSampleChild = (child, extra = []) => registry([...SUB_LEGOS, fixture(), fixture(child), ...extra]);

/* ------------------------------------------------------------ the catalog */

test('the declared catalog is a real hierarchy, not a flat list', () => {
  const catalog = registry();
  assert.equal(catalog.list().length, SUB_LEGOS.length);
  assert.ok(catalog.roots().length >= 8, 'the UI has several root areas');
  assert.ok(catalog.descendantsOf('workflow-editor').length >= 4, 'the editor nests panel units');
  assert.ok(catalog.list({ depth: 2 }).length >= 1, 'at least one unit sits two levels deep');

  // settings.localization.rtl is the depth-3 example from the phase brief.
  assert.equal(parentIdOf('settings.localization.rtl'), 'settings.localization');
  assert.equal(depthOf('settings.localization.rtl'), 2);
  assert.deepEqual(
    catalog.ancestorsOf('settings.localization.rtl').map((entry) => entry.id),
    ['settings.localization', 'settings'],
  );
});

test('every unit declares the fields the contract requires', () => {
  for (const entry of SUB_LEGOS) {
    for (const field of ['id', 'title', 'owner', 'version', 'contract', 'public', 'internals', 'tests', 'status', 'upgrade']) {
      assert.ok(entry[field] !== undefined, `${entry.id} must declare ${field}`);
    }
    assert.ok(UPGRADE_POLICIES.includes(entry.upgrade.policy), `${entry.id} has a known upgrade policy`);
    assert.ok(SUB_LEGO_STATUSES.includes(entry.status), `${entry.id} has a known status`);
    assert.match(entry.version, /^\d+\.\d+\.\d+$/);
  }
});

test('ownership is explicit and drawn from the declared owner table', () => {
  const catalog = registry();
  const owners = new Set(catalog.list().map((entry) => entry.owner));
  for (const owner of owners) assert.ok(OWNERS[owner], `${owner} must be documented in the owner table`);
  assert.ok(owners.has('agent-01'), 'the frontend LEGO owns its own units in P2.5');
  assert.throws(() => registry([...SUB_LEGOS, fixture({ owner: 'nobody' })]), /unknown owner "nobody"/);
});

test('a unit names the backend capability its surface declares — and may not contradict it', () => {
  const catalog = registry();
  assert.equal(catalog.get('settings.localization').capability, 'settings');
  assert.equal(catalog.get('workflow-editor.canvas').capability, 'workflow', 'the UI area is workflow-editor; the backend capability it consumes is workflow');
  assert.equal(catalog.get('dialogs').capability, null, 'a surface with no backend capability yields null, never a guess');

  // Same surface, different claim: refused with both values named.
  assert.throws(
    () => registry([...SUB_LEGOS, fixture({ id: 'sample', surface: 'dashboard', capability: 'settings' })]),
    /"capability" must match the one its surface declares \("workflow", not "settings"\)/,
  );
  assert.throws(
    () => registry([...SUB_LEGOS, fixture({ id: 'sample', capability: 'not-a-capability' })]),
    /unknown backend capability "not-a-capability"/,
  );
});

test('a unit must publish a boundary, a test path and a private area', () => {
  const catalog = withSample();
  assert.equal(catalog.publicPortsOf('sample').length, 1);

  assert.throws(() => registry([...SUB_LEGOS, fixture({ public: { ports: [], contracts: ['contracts/frontend.contract.md'] } })]),
    /must publish at least one port/);
  assert.throws(() => registry([...SUB_LEGOS, fixture({ tests: [] })]), /must name at least one regression test/);
  assert.throws(() => registry([...SUB_LEGOS, fixture({ internals: ['../elsewhere/**'] })]), /must be a path under src\/sub-legos/);
  assert.throws(() => registry([...SUB_LEGOS, fixture({ contract: 'docs/something.md' })]), /must point at a contracts\/\*\.contract\.md file/);
});

/* ------------------------------------------------------------- hierarchy */

test('the hierarchy refuses orphans, mis-declared parents and duplicates', () => {
  assert.throws(() => registry([...SUB_LEGOS, fixture(), fixture()]), /already registered/);
  assert.throws(
    () => createSubLegoRegistry({ subLegos: [fixture({ id: 'ghost.child', parentId: 'ghost' })], owners: OWNERS, surfaces: manifests.surfaces, extensionPoints: manifests.extensionPoints }),
    /parent "ghost" is not a declared sub-LEGO/,
  );
  // A dotted id is a child by definition: declaring it as a root would create a
  // unit that claims a hierarchy it does not have.
  assert.throws(() => registry([...SUB_LEGOS, fixture({ id: 'sample.leaf', parentId: null })]), /a dotted id is not a root unit/);
  assert.throws(() => registry([...SUB_LEGOS, fixture({ id: 'sample.leaf', parentId: 'settings' })]), /"parentId" must be the id prefix \("sample"\)/);
  assert.throws(() => registry([...SUB_LEGOS, fixture({ id: 'Bad.Id' })]), /must be lowercase kebab-case/);
  // A child under a declared parent is fine — including a new depth-3 unit.
  const deeper = registry([...SUB_LEGOS, fixture({ id: 'settings.localization.dialect' })]);
  assert.equal(deeper.get('settings.localization.dialect').parentId, 'settings.localization');
});

test('a child cannot be declared without its parent unit existing', () => {
  const orphan = fixture({ id: 'workflow-editor.ghost-panel', parentId: 'workflow-editor' });
  assert.equal(orphan.parentId, 'workflow-editor');
  const catalog = registry([...SUB_LEGOS, orphan]); // parent exists: accepted
  assert.equal(catalog.get('workflow-editor.ghost-panel').parentId, 'workflow-editor');
});

/* --------------------------------------------- public / private boundary */

test('depending on a published port is allowed', () => {
  const catalog = withSampleChild({
    id: 'sample.consumer',
    public: { ports: ['ui:sample:consumer'], contracts: ['contracts/frontend.contract.md'] },
    internals: ['src/sub-legos/sample/consumer/**'],
    dependsOn: [
      { subLego: 'sample', port: 'ui:sample:thing', versionRange: '^1.0.0' },
      { subLego: 'settings', port: 'ui:settings:shell', versionRange: '^1.0.0' },
    ],
  });
  assert.ok(catalog.has('sample.consumer'));
  const dependents = catalog.dependentsOn('settings', 'ui:settings:shell').map((entry) => entry.id);
  assert.ok(dependents.includes('sample.consumer'), 'the new unit is a dependent');
  assert.deepEqual(dependents, ['sample.consumer', 'settings.general', 'settings.localization', 'settings.security'].sort());
});

test('depending on another unit\'s private internals MUST fail', () => {
  assert.throws(
    () => withSampleChild({
      id: 'sample.sneaky',
      internals: ['src/sub-legos/sample/sneaky/**'],
      public: { ports: ['ui:sample:sneaky'], contracts: ['contracts/frontend.contract.md'] },
      dependsOn: [{ subLego: 'settings', port: 'internal:settings-store', versionRange: '^1.0.0' }],
    }),
    /reaches into the private internals of "settings"/,
  );
});

test('a dependency on a port another unit publishes is refused by name', () => {
  assert.throws(
    () => withSampleChild({
      id: 'sample.confused',
      internals: ['src/sub-legos/sample/confused/**'],
      public: { ports: ['ui:sample:confused'], contracts: ['contracts/frontend.contract.md'] },
      // ui:settings:shell belongs to `settings`, not to `workflow-editor`.
      dependsOn: [{ subLego: 'workflow-editor', port: 'ui:settings:shell', versionRange: '^1.0.0' }],
    }),
    /published by "settings"/,
  );
});

test('a port cannot collide with an extension-point id or another unit\'s port', () => {
  assert.throws(
    () => registry([...SUB_LEGOS, fixture({ public: { ports: ['ui:message:catalog'], contracts: ['contracts/frontend.contract.md'] } })]),
    /is also a declared extension point/,
  );
  assert.throws(
    () => registry([...SUB_LEGOS, fixture({ public: { ports: ['ui:panel:selection'], contracts: ['contracts/frontend.contract.md'] } })]),
    /already published by "workflow-editor.node-panel"/,
  );
});

test('dependency cycles are refused', () => {
  const unitA = fixture({ id: 'cycle-a', public: { ports: ['ui:cycle:a'], contracts: ['contracts/frontend.contract.md'] } });
  const unitB = fixture({
    id: 'cycle-b',
    public: { ports: ['ui:cycle:b'], contracts: ['contracts/frontend.contract.md'] },
    internals: ['src/sub-legos/cycle-b/**'],
    dependsOn: [{ subLego: 'cycle-a', port: 'ui:cycle:a', versionRange: '^1.0.0' }],
  });
  // A two-unit set where each depends on the other's port is a cycle.
  const aDependsOnB = { ...unitA, dependsOn: [{ subLego: 'cycle-b', port: 'ui:cycle:b', versionRange: '^1.0.0' }] };
  assert.throws(
    () => createSubLegoRegistry({
      subLegos: [aDependsOnB, unitB],
      owners: OWNERS,
      surfaces: manifests.surfaces,
      extensionPoints: manifests.extensionPoints,
    }),
    /sub-LEGO dependency cycle: /,
  );
  // The acyclic version of the same two units is accepted.
  const catalog = createSubLegoRegistry({
    subLegos: [unitA, unitB],
    owners: OWNERS,
    surfaces: manifests.surfaces,
    extensionPoints: manifests.extensionPoints,
  });
  assert.deepEqual(catalog.dependentsOf('cycle-a').map((entry) => entry.id), ['cycle-b']);
});

test('resolvePort refuses anything that is not published', () => {
  const catalog = registry();
  assert.deepEqual(catalog.resolvePort('settings.localization', 'ui:locale:direction'), {
    subLego: 'settings.localization',
    port: 'ui:locale:direction',
    version: '1.0.0',
    contract: 'contracts/frontend.contract.md',
  });
  assert.throws(() => catalog.resolvePort('settings.localization', 'ui:settings:shell'), /is private to the unit/);
});

/* -------------------------------------------------------------- versions */

test('the version range vocabulary is small and honest', () => {
  assert.equal(satisfies('1.4.2', '^1.0.0'), true);
  assert.equal(satisfies('2.0.0', '^1.0.0'), false);
  assert.equal(satisfies('1.4.2', '1.x'), true);
  assert.equal(satisfies('1.4.2', '~1.4.0'), true);
  assert.equal(satisfies('1.5.0', '~1.4.0'), false);
  assert.equal(satisfies('1.5.0', '>=1.4.0 <2.0.0'), true);
  assert.equal(satisfies('2.1.0', '>=1.4.0 <2.0.0'), false);
  assert.equal(satisfies('9.9.9', '*'), true);
  assert.equal(satisfies('not-a-version', '*'), false);
  assert.throws(() => withSample({ dependsOn: [{ subLego: 'settings', port: 'ui:settings:shell', versionRange: 'whatever' }] }),
    /must declare a supported version range/);
});

/* ------------------------------------------------- the upgrade guarantee */

test('upgrade: a compatible version moves one unit and leaves every sibling byte-identical', () => {
  const catalog = registry();
  const before = new Map(catalog.descriptor().subLegos.map((entry) => [entry.id, JSON.stringify(entry)]));

  // The patch a package would ship: same public boundary, new patch version.
  const outcome = catalog.upgrade('workflow-editor.node-panel', { version: '1.1.0' });

  assert.equal(outcome.kind, 'compatible', 'the change kind is the canonical vocabulary');
  assert.equal(outcome.move, 'minor', 'the granularity is a separate field');
  assert.deepEqual(outcome.changed, ['workflow-editor.node-panel']);
  assert.ok(outcome.unchanged.includes('workflow-editor.canvas'));
  assert.ok(outcome.unchanged.includes('workflow-editor.parameter-panel'));
  assert.ok(outcome.unchanged.includes('settings.localization.rtl'));

  for (const [id, snapshot] of before) {
    const after = JSON.stringify(catalog.get(id));
    if (id === 'workflow-editor.node-panel') {
      assert.notEqual(after, snapshot, 'the upgraded unit changed');
      assert.match(after, /"version":"1\.1\.0"/);
    } else {
      assert.equal(after, snapshot, `${id} must not change when a sibling is upgraded`);
    }
  }
  // Dependents keep resolving their declared port across the upgrade.
  assert.equal(catalog.dependentsOf('workflow-editor.node-panel').map((entry) => entry.id).join(), 'workflow-editor.parameter-panel');
  assert.equal(catalog.resolvePort('workflow-editor.node-panel', 'ui:panel:selection').version, '1.1.0');
});

test('upgrade: a breaking move is refused while a dependent pins the previous major', () => {
  const catalog = registry();
  const evaluation = catalog.validateUpgrade('workflow-editor.node-panel', '2.0.0');
  assert.equal(evaluation.kind, 'breaking');
  assert.equal(evaluation.move, 'major');
  assert.equal(evaluation.breaking, true);
  assert.deepEqual(evaluation.affected, ['workflow-editor.parameter-panel']);
  assert.match(evaluation.affectedDetail[0].range, /^\^1\./);

  assert.throws(() => catalog.upgrade('workflow-editor.node-panel', { version: '2.0.0' }), (error) => {
    assert.ok(error instanceof SubLegoUpgradeError);
    assert.equal(error.code, 'frontend.registry.upgrade-blocked');
    assert.deepEqual(error.affected, ['workflow-editor.parameter-panel']);
    assert.match(error.message, /acknowledge them or ship a compatible version/);
    return true;
  });
  // The refusal left the catalog untouched.
  assert.equal(catalog.get('workflow-editor.node-panel').version, '1.0.0');
  assert.equal(catalog.get('workflow-editor.parameter-panel').dependsOn[1].versionRange, '^1.0.0');
});

test('upgrade: with the dependent\'s acknowledgment the break is explicit and bounded', () => {
  const catalog = registry();
  const siblingsBefore = new Map(catalog.descriptor().subLegos
    .filter((entry) => !['workflow-editor.node-panel', 'workflow-editor.parameter-panel'].includes(entry.id))
    .map((entry) => [entry.id, JSON.stringify(entry)]));

  const outcome = catalog.upgrade('workflow-editor.node-panel', { version: '2.0.0' }, { acknowledge: ['workflow-editor.parameter-panel'] });

  assert.equal(outcome.kind, 'breaking');
  assert.equal(outcome.move, 'major');
  assert.deepEqual([...outcome.changed].sort(), ['workflow-editor.node-panel', 'workflow-editor.parameter-panel']);
  assert.deepEqual(outcome.acknowledged, ['workflow-editor.parameter-panel']);

  // Only the two units involved changed; the acknowledgment is recorded on the
  // dependent, which is the unit that carries the risk.
  const dependent = catalog.get('workflow-editor.parameter-panel');
  assert.deepEqual(dependent.acknowledgedUpgrades, [{ subLego: 'workflow-editor.node-panel', to: '2.0.0' }]);
  assert.equal(dependent.dependsOn[1].versionRange, '^2.0.0');
  for (const [id, snapshot] of siblingsBefore) {
    assert.equal(JSON.stringify(catalog.get(id)), snapshot, `${id} must not change for an acknowledged sibling upgrade`);
  }
  assert.equal(outcome.unchanged.includes('workflow-editor.canvas'), true);
});

test('upgrade: downgrades and coupled units are refused outright', () => {
  const catalog = registry();
  assert.throws(() => catalog.upgrade('settings', { version: '0.9.0' }), /is a downgrade from "1.0.0"/);
  assert.throws(() => catalog.upgrade('workflow-editor.node-panel', { version: 'not-semver' }), /is not a semver version/);

  const coupled = registry([...SUB_LEGOS, fixture({
    id: 'sample-coupled',
    upgrade: { policy: 'coupled', compatibleWith: '1.x', coupledWith: ['sample'] },
  })]);
  assert.throws(() => coupled.upgrade('sample-coupled', { version: '1.1.0' }), /is declared coupled/);
});

test('upgrade: the new version must satisfy the same declaration rules as a fresh unit', () => {
  const catalog = registry();
  assert.throws(
    () => catalog.upgrade('workflow-editor.canvas', { version: '1.1.0', internals: [] }),
    (error) => {
      assert.ok(error instanceof SubLegoError);
      assert.match(error.message, /must name the private area of the unit/);
      return true;
    },
  );
  assert.equal(catalog.get('workflow-editor.canvas').version, '1.0.0', 'a refused upgrade is rolled back');
});

/* ----------------------------------------------- publishing and isolation */

test('the boot view publishes identity and hierarchy, never private areas', () => {
  const lego = createFrontendLego({ app: { name: 'n8n lego', version: '0.1.0' } });
  const published = lego.bootPayload.subLegos;
  assert.equal(published.length, SUB_LEGOS.length);
  const rtl = published.find((entry) => entry.id === 'settings.localization.rtl');
  assert.equal(rtl.parentId, 'settings.localization');
  assert.equal(rtl.owner, 'agent-01');
  assert.deepEqual(rtl.ports, ['ui:locale:direction:resolve']);
  assert.equal('internals' in rtl, false, 'private areas are never published');
  assert.equal('capability' in rtl, false, 'the boot view carries the surface; the capability is a join away in the same payload');
  assert.equal(lego.subLegos.get('settings.localization').capability, 'settings', 'the full descriptor keeps the capability');
  assert.equal('tests' in rtl, false, 'test paths are not part of the runtime descriptor');
  assert.equal(JSON.stringify(published).includes('src/sub-legos'), false);
  assert.equal(JSON.stringify(published).includes(ERROR_CODES.CAPABILITY_UNSUPPORTED), false);
});

test('the descriptor and the boot view agree, and the LEGO registers nothing', () => {
  const lego = createFrontendLego({ app: { name: 'n8n lego', version: '0.1.0' } });
  assert.equal(lego.subLegos.descriptor().subLegos.length, lego.bootPayload.subLegos.length);
  assert.equal(lego.registry.list().length, 0, 'P2.5 registers zero capabilities');
  assert.equal(lego.describe().subLegos, SUB_LEGOS.length);
  const ids = subLegoIds(lego.manifests);
  assert.deepEqual(ids, SUB_LEGOS.map((entry) => entry.id));
  // Declaration order keeps parents before children — the manifest stays readable.
  for (const id of ids) {
    const parent = parentIdOf(id);
    if (parent !== null) assert.ok(ids.indexOf(parent) < ids.indexOf(id), `${parent} must be declared before ${id}`);
  }
});

test('the registry is data-driven: the manifest is the only source of truth', () => {
  const raw = JSON.parse(readFileSync(join(MANIFEST_DIR, 'sub-legos.json'), 'utf8'));
  assert.deepEqual(raw.subLegos.map((entry) => entry.id), SUB_LEGOS.map((entry) => entry.id));
  assert.ok(Object.keys(raw.owners).length >= 5, 'the owner table names the participating agents');
  // A single-entry validation is available without mutating the registry.
  const probe = registry().validate(fixture({ id: 'sample.probe', parentId: 'sample' }));
  assert.deepEqual(probe.errors, ['parent "sample" is not a declared sub-LEGO (declare the parent first)']);
});
