/**
 * Capability negotiation: discovery, access, availability and degradation.
 *
 * The rule this file exists to protect: **placement grants nothing**. A unit nested
 * under a capable parent reaches only what its own surface binds or what a
 * capability explicitly declares for that surface.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AVAILABILITY_STATES,
  CapabilityNotGrantedError,
  NegotiationError,
  createCapabilityNegotiator,
} from '../src/negotiation.mjs';
import { backendAvailabilityFrom, describeBackendView } from '../src/backend-view.mjs';
import { createFrontendRegistry } from '../src/registry.mjs';
import { createSubLegoRegistry } from '../src/sublegos.mjs';
import { capabilityOf, backendCapabilitiesOf, surfacesOfCapability } from '../src/surface-capability.mjs';
import { loadManifests } from '../src/manifests.mjs';

const manifests = loadManifests();

function assembly({ capabilities = [], backendOverrides = {}, unsupportedFeatures = [] } = {}) {
  const registry = createFrontendRegistry({
    surfaces: manifests.surfaces,
    extensionPoints: manifests.extensionPoints,
    capabilities,
  });
  const subLegos = createSubLegoRegistry({
    subLegos: manifests.subLegos,
    owners: manifests.owners,
    surfaces: manifests.surfaces,
    extensionPoints: manifests.extensionPoints,
  });
  const backend = backendAvailabilityFrom({ surfaces: manifests.surfaces, unsupportedFeatures, overrides: backendOverrides });
  const negotiator = createCapabilityNegotiator({
    registry,
    subLegos,
    surfaces: manifests.surfaces,
    declared: manifests.capabilities,
    backend,
    contractVersion: '1.0.0',
    locales: ['id', 'en', 'ar'],
  });
  return { registry, subLegos, backend, negotiator };
}

const translation = assembly();

test('the surface join is one function, and it normalises the `none` sentinel', () => {
  assert.equal(capabilityOf({ backend: { capability: 'settings' } }), 'settings');
  assert.equal(capabilityOf({ backend: { capability: 'none' } }), null);
  assert.equal(capabilityOf({ backend: {} }), null);
  assert.equal(capabilityOf({}), null);
  const bound = backendCapabilitiesOf(manifests.surfaces);
  assert.ok(bound.includes('settings'));
  assert.ok(bound.includes('workflow'));
  assert.equal(bound.includes('none'), false, 'the sentinel never becomes a capability');
  assert.deepEqual(surfacesOfCapability(manifests.surfaces, 'settings'), ['navigation', 'settings']);
});

test('a consumer can discover identity, version, operations and origin', () => {
  const described = translation.negotiator.describe('translation');
  assert.equal(described.id, 'translation');
  assert.equal(described.origin, 'frontend-declared', 'frontend capability: this LEGO adds it');
  assert.equal(described.criticality, 'optional');
  assert.equal(described.trust, 'feature');
  assert.equal(described.activation, 'lazy');
  assert.equal(described.installed, false, 'declared is not installed');
  assert.deepEqual(described.operations, [], 'no operation contract is published yet');
  assert.equal(described.contracts.length, 2);

  const backendCapability = translation.negotiator.describe('settings');
  assert.equal(backendCapability.origin, 'backend-advertised');
  assert.equal(backendCapability.owner, 'settings');
  assert.deepEqual(backendCapability.surfaces, ['navigation', 'settings']);
  assert.throws(() => translation.negotiator.describe('nothing-here'), (error) => {
    assert.ok(error instanceof NegotiationError);
    assert.equal(error.code, 'frontend.capability.unknown');
    return true;
  });
});

test('placement grants nothing: access comes from the surface or an explicit declaration', () => {
  const { negotiator } = translation;
  // Own-surface binding: the settings surface carries the settings capability.
  assert.deepEqual(negotiator.mayUse('settings.general', 'settings'), { allowed: true, unitId: 'settings.general', capabilityId: 'settings', basis: 'surface-binding', reason: null });
  // Explicit declaration: the translation capability names the settings surface.
  assert.equal(negotiator.mayUse('settings.localization.rtl', 'translation').basis, 'declared-surface');
  // Nested under settings, the unit is *not* magically granted the workflow capability.
  const escalated = negotiator.mayUse('settings.localization.rtl', 'workflow');
  assert.equal(escalated.allowed, false);
  assert.match(escalated.reason, /placement never grants/);
  // requireUse refuses instead of returning a decision.
  assert.throws(() => negotiator.requireUse('settings.localization.rtl', 'workflow'), (error) => {
    assert.ok(error instanceof CapabilityNotGrantedError);
    assert.equal(error.code, 'frontend.capability.not-granted');
    assert.equal(error.unitId, 'settings.localization.rtl');
    return true;
  });
  // A unit on a frontend-only surface (dialogs) has no surface binding at all.
  const dialogs = negotiator.mayUse('dialogs', 'workflow');
  assert.equal(dialogs.allowed, false);
  assert.match(dialogs.reason, /carries no backend capability/);
});

test('negotiation returns a verdict, never a bare boolean', () => {
  const { negotiator } = translation;
  const verdict = negotiator.negotiate({ capabilityId: 'translation' });
  assert.equal(verdict.state, 'degraded', 'declared but not installed is a degradation, not availability');
  assert.equal(verdict.ok, true, 'degraded still means the UI may proceed with the declared fallback');
  assert.equal(verdict.degraded, true);
  assert.equal(verdict.identity, 'translation@1.0.0');
  assert.equal(verdict.origin, 'frontend-declared');
  assert.match(verdict.reasons.join(' '), /declared but not installed/);
  assert.deepEqual(verdict.degradation, { behavior: 'degrade', fallback: 'declared-behaviour' });
  assert.deepEqual(AVAILABILITY_STATES, ['available', 'degraded', 'version-mismatch', 'unavailable', 'unsupported', 'disabled']);
});

test('an ungranted consumer is not told whether the capability would have worked', () => {
  const { negotiator } = translation;
  const verdict = negotiator.negotiate({ capabilityId: 'workflow', unitId: 'settings.localization.rtl' });
  assert.equal(verdict.state, 'unavailable');
  assert.equal(verdict.ok, false);
  assert.equal(verdict.capability, null, 'no metadata leaks to a consumer that may not use it');
  assert.equal(verdict.identity, null);
  assert.match(verdict.reasons[0], /placement never grants/);
});

test('operations are negotiated by name, and a missing operation degrades', () => {
  const withOperations = assembly({
    capabilities: [{
      id: 'search',
      lego: 'search',
      title: 'Search',
      status: 'available',
      surfaces: ['node-picker'],
      contracts: ['contracts/frontend.contract.md'],
      tests: ['packages/search-lego/test/*.test.mjs'],
      operations: ['search.nodes', 'search.workflows'],
      activation: 'lazy',
      entry: './features/search/index.mjs',
    }],
  });
  const granted = withOperations.negotiator.negotiate({ capabilityId: 'search', requireOperations: ['search.nodes'] });
  assert.deepEqual(granted.missingOperations, []);
  assert.equal(granted.state, 'available');

  const partial = withOperations.negotiator.negotiate({ capabilityId: 'search', requireOperations: ['search.nodes', 'search.credentials'] });
  assert.deepEqual(partial.grantedOperations, ['search.nodes']);
  assert.deepEqual(partial.missingOperations, ['search.credentials']);
  assert.equal(partial.state, 'degraded');
  assert.match(partial.reasons.join(' '), /operations not offered: search.credentials/);

  // The operation grammar is the envelope's — no second spelling.
  const registry = createFrontendRegistry({ surfaces: manifests.surfaces, extensionPoints: manifests.extensionPoints });
  assert.throws(
    () => registry.register({
      id: 'bad', lego: 'bad', title: 'Bad', status: 'declared',
      surfaces: ['settings'], contracts: ['contracts/frontend.contract.md'], tests: ['x'], operations: ['searchNodes'],
    }),
    /must look like "<domain>\.<name>"/,
  );
});

test('a version mismatch is named, not swallowed', () => {
  const mismatched = assembly({ backendOverrides: { settings: { status: 'available', contractVersion: '2.0.0', owner: 'settings' } } });
  const verdict = mismatched.negotiator.negotiate({ capabilityId: 'settings', requireVersion: '1.0.0' });
  assert.equal(verdict.state, 'version-mismatch');
  assert.equal(verdict.ok, false);
  assert.equal(verdict.compatibility.state, 'major-mismatch');
  assert.match(verdict.reasons.join(' '), /different major version/);

  const additive = assembly({ backendOverrides: { settings: { status: 'available', contractVersion: '1.4.0', owner: 'settings' } } });
  const fine = additive.negotiator.negotiate({ capabilityId: 'settings', requireVersion: '1.0.0' });
  assert.equal(fine.state, 'available');
  assert.equal(fine.compatibility.state, 'compatible');
});

test('feature availability shows the frontend declaration beside the backend reality', () => {
  const { negotiator } = assembly({ unsupportedFeatures: [{ prefix: '/rest/sso', feature: 'sso', label: 'SSO', owner: 'auth', phase: 'deferred' }] });
  const availability = negotiator.featureAvailability();
  assert.equal(availability.length, manifests.surfaces.length);
  const auth = availability.find((entry) => entry.surface === 'auth');
  assert.equal(auth.state, 'degraded', 'one endpoint answered 501 makes the capability partial, not available');
  assert.match(auth.reasons.join(' '), /partially/);
  assert.equal(auth.contract, 'contracts/api.contract.md');
  const dialogs = availability.find((entry) => entry.surface === 'dialogs');
  assert.equal(dialogs.capability, null, 'a frontend-only surface has nothing to negotiate');
  assert.equal(dialogs.state, 'available');
  const workflow = availability.find((entry) => entry.surface === 'workflow-editor');
  assert.equal(workflow.state, 'available');
  assert.equal(workflow.capability, 'workflow');

  // Overrides are keyed by capability id (the surface's backend binding), not by surface id.
  const disabled = assembly({ backendOverrides: { execution: { status: 'unsupported', owner: 'execution' } } });
  const executions = disabled.negotiator.featureAvailability().find((entry) => entry.surface === 'executions');
  assert.equal(executions.state, 'unsupported');
  assert.match(executions.reasons.join(' '), /does not implement/);
});

test('the backend view states where each fact came from, and never probes', () => {
  const view = backendAvailabilityFrom({
    surfaces: manifests.surfaces,
    unsupportedFeatures: [{ prefix: '/rest/community-packages', feature: 'community-packages', label: 'Community nodes', owner: 'node-registry', phase: 'P6' }],
  });
  const nodeRegistry = view.capabilities['node-registry'];
  assert.equal(nodeRegistry.status, 'partial');
  assert.equal(nodeRegistry.source, 'compat-unsupported-map');
  assert.deepEqual(nodeRegistry.endpoints, ['/rest/community-packages']);
  const workflow = view.capabilities.workflow;
  assert.equal(workflow.source, 'surface-catalog');
  assert.deepEqual(workflow.endpoints, [], 'nothing is probed: an empty list is the honest answer');
  const model = describeBackendView();
  assert.match(model.rules.join(' '), /never probed|Nothing is probed/);
  assert.deepEqual(model.states, ['available', 'partial', 'unsupported', 'unknown']);
});

test('locale readiness is declared readiness, not a translation implementation', () => {
  const { negotiator } = translation;
  const readiness = negotiator.localeReadiness({ supported: ['id', 'en', 'ar', 'zh', 'ru', 'jv'], fallback: 'en' });
  assert.deepEqual(readiness.supported, ['id', 'en', 'ar']);
  assert.equal(readiness.complete, false);
  assert.deepEqual(readiness.missing, ['zh', 'ru', 'jv']);
  assert.equal(readiness.capability, 'declared-not-installed');
  const model = negotiator.describeModel();
  assert.match(model.rules.join(' '), /Placement grants nothing/);
});
