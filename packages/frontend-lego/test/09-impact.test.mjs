/**
 * Impact graph, selective test map and the dry-run plan model.
 *
 * "If this changes, what must be tested?" must be answerable from declaration
 * data — cheaply, and before anything is edited.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ImpactError, TEST_TIERS, TIER_SUITES, createImpactGraph, describeTestMap } from '../src/impact.mjs';
import { createSubLegoRegistry } from '../src/sublegos.mjs';
import { createFrontendRegistry } from '../src/registry.mjs';
import { loadManifests } from '../src/manifests.mjs';

const manifests = loadManifests();
const subLegos = createSubLegoRegistry({
  subLegos: manifests.subLegos,
  owners: manifests.owners,
  surfaces: manifests.surfaces,
  extensionPoints: manifests.extensionPoints,
});
const capabilities = createFrontendRegistry({
  surfaces: manifests.surfaces,
  extensionPoints: manifests.extensionPoints,
  capabilities: [{
    id: 'translation',
    lego: 'translation',
    title: 'Translation',
    status: 'declared',
    surfaces: ['settings', 'error-surfaces', 'navigation'],
    contracts: ['contracts/frontend.contract.md', 'contracts/localization.contract.md'],
    extensionPoints: ['ui:message:catalog', 'ui:locale:switch'],
    criticality: 'optional',
    trust: 'feature',
    activation: 'lazy',
    entry: './features/translation/index.mjs',
    tests: ['packages/translation-lego/test/*.test.mjs'],
  }],
});

const graph = createImpactGraph({
  subLegos,
  capabilities,
  surfaces: manifests.surfaces,
  // Foreign contracts are derived from the surface catalog; only the ones a
  // not-yet-existing LEGO would own are declared by hand.
  foreignContracts: ['contracts/localization.contract.md'],
  contractOwners: { 'contracts/localization.contract.md': 'translation' },
});

test('a leaf change with no dependents stays low risk and cheap to test', () => {
  const impact = graph.impactOf('workflow-editor.canvas');
  assert.equal(impact.kind, 'unit');
  assert.deepEqual(impact.dependents, ['workflow-editor.execution-panel'], 'the execution panel consumes canvas selection');
  assert.equal(impact.risk, 'high', 'a dependent makes a change non-private, whatever the size');
  assert.equal(impact.escalateToFull, true);
  assert.ok(impact.recommendedTests.full.length > 0);
  assert.ok(impact.recommendedTests['fast-contract'].includes('packages/frontend-lego/test/06-sublegos.test.mjs'));
  assert.ok(impact.recommendedTests.browser.length > 0, 'the unit lives on a surface the browser gate covers');
});

test('risk is about blast radius, not about how small the edit looks', () => {
  // Nobody depends on the general settings page yet, and it speaks only the
  // frontend contract — but it sits inside a domain, so it is not a private edit.
  const nested = graph.impactOf('settings.general');
  assert.deepEqual(nested.dependents, [], 'nothing depends on it yet');
  assert.deepEqual(nested.foreignContracts, [], 'its contract belongs to this LEGO');
  assert.deepEqual(nested.ancestors, ['settings']);
  assert.equal(nested.risk, 'medium', 'a nested unit is not a private change');
  assert.equal(nested.recommendedTests.integration.length, 0, 'medium risk does not drag in the integration tier');
  assert.equal(nested.recommendedTests.full.length, 0);
  assert.ok(nested.recommendedTests['fast-contract'].includes('packages/frontend-lego/test/06-sublegos.test.mjs'));

  // A root unit speaking only its own contract and consumed by nobody is the
  // cheapest possible change: the smallest valid set, no escalation at all.
  const privateChange = graph.impactOf('node-picker');
  assert.deepEqual(privateChange.ancestors, []);
  assert.deepEqual(privateChange.dependents, []);
  assert.equal(privateChange.risk, 'low');
  assert.equal(privateChange.escalateToFull, false);
  assert.deepEqual(privateChange.recommendedTests.full, []);
  assert.deepEqual(privateChange.recommendedTests.integration, []);

  // Declaring a contract another LEGO owns is enough to make it high risk, even
  // with no dependents: the RTL resolver speaks the localization contract.
  const shared = graph.impactOf('settings.localization.rtl');
  assert.deepEqual(shared.dependents, []);
  assert.deepEqual(shared.foreignContracts, [{ contract: 'contracts/localization.contract.md', owner: 'translation' }]);
  assert.equal(shared.risk, 'high', 'it declares a contract owned by the future Translation LEGO');
});

test('a change to a contract owned by another LEGO is high risk and names the owner', () => {
  const impact = graph.impactOf('settings', { kind: 'surface' });
  assert.equal(impact.kind, 'surface');
  assert.ok(impact.contracts.includes('contracts/settings.contract.md'));
  assert.deepEqual(impact.foreignContracts, [{ contract: 'contracts/settings.contract.md', owner: 'settings' }]);
  assert.equal(impact.risk, 'high', 'the settings backend LEGO has to agree before this moves');
  assert.ok(impact.recommendedTests.full.length > 0);

  // A contract owned by the frontend LEGO itself is not foreign: every unit
  // declares it, and treating it as foreign would make every change "high".
  const own = graph.impactOf('notifications');
  assert.deepEqual(own.foreignContracts, [], 'its surface talks to no backend capability of its own');
  assert.equal(graph.foreignContracts.includes('contracts/frontend.contract.md'), false);
  assert.ok(graph.foreignContracts.includes('contracts/workflow.contract.md'));
});

test('capability impact maps through surfaces to the units that host them', () => {
  const impact = graph.impactOf('translation', { kind: 'capability' });
  assert.equal(impact.kind, 'capability');
  assert.ok(impact.surfaces.includes('settings'));
  assert.ok(impact.surfaces.includes('navigation'));
  const hostingUnits = graph.unitsForCapability('translation');
  assert.ok(hostingUnits.includes('settings'));
  assert.ok(hostingUnits.includes('settings.localization'), 'the nested localization unit is reachable from the capability');
  assert.equal(impact.risk, 'high', 'the capability declares a trust level that requires a wider test set');
});

test('unknown targets are refused instead of silently returning nothing to test', () => {
  assert.throws(() => graph.impactOf('does.not.exist'), (error) => {
    assert.ok(error instanceof ImpactError);
    assert.equal(error.code, 'frontend.impact.unknown-target');
    return true;
  });
  assert.throws(() => graph.impactOf('translation', { kind: 'sublego' }), /unknown target kind/);
  assert.throws(() => graph.impactOf('nope', { kind: 'capability' }), /unknown capability/);
  assert.throws(() => graph.impactOf('nope', { kind: 'surface' }), /unknown surface/);
});

test('the dry-run plan states the target, files, contracts, test impact and risk', () => {
  const plan = graph.planChange({ target: 'settings.localization', description: 'add the RTL resolver contract' });
  assert.equal(plan.lego, 'ui-frontend');
  assert.equal(plan.target, 'settings.localization');
  assert.equal(plan.kind, 'unit');
  assert.equal(plan.owner, 'agent-01');
  assert.equal(plan.subLego.version, '1.0.0');
  assert.equal(plan.subLego.capability, 'settings');
  assert.deepEqual(plan.subLego.ports, ['ui:settings:localization:pack-list', 'ui:locale:direction']);
  assert.ok(plan.files.includes('src/sub-legos/settings/localization/**'), 'the private area is where the work happens');
  assert.ok(plan.files.includes('packages/frontend-lego/manifest/sub-legos.json'), 'a unit change is also a declaration change');
  assert.ok(plan.files.includes('packages/frontend-lego/test/06-sublegos.test.mjs'));
  assert.ok(plan.contractsAffected.includes('contracts/localization.contract.md'));
  assert.equal(plan.requiresArbitration, true, 'it declares a contract another LEGO owns');
  assert.deepEqual(plan.arbitrationWith, ['translation'], 'the future Translation LEGO owns that contract');
  assert.deepEqual(Object.keys(plan.testImpact), TEST_TIERS);
  // The plan is data: it must survive JSON round-tripping for a tool or an
  // assistant that has to show it before touching anything.
  assert.deepEqual(JSON.parse(JSON.stringify(plan)).target, 'settings.localization');
});

test('adding a unit always requires arbitration, even when nothing depends on it', () => {
  const plan = graph.planChange({ target: 'dashboard', addUnit: true });
  assert.equal(plan.addUnit, true);
  assert.equal(plan.risk, 'low', 'risk is blast radius: nobody depends on a unit that does not exist yet');
  assert.equal(plan.requiresArbitration, true, 'arbitration is consent, and a new unit needs the Manager');
  assert.deepEqual(plan.arbitrationWith, ['manager']);
});

test('the selective test map is published as data', () => {
  const map = describeTestMap();
  assert.deepEqual(map.tiers, TEST_TIERS);
  assert.deepEqual(TIER_SUITES['fast-contract'], ['packages/frontend-lego/test/01-contract.test.mjs']);
  assert.match(map.rule, /escalate/);
  assert.deepEqual(graph.describe(), { units: subLegos.list().length, capabilities: 1, surfaces: manifests.surfaces.length, tiers: TEST_TIERS });
});
