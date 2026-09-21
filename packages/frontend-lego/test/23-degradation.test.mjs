/**
 * The degradation matrix (Task F) and required permissions (Task E).
 *
 * Every way a capability can be missing, disabled, incomplete, incompatible or
 * gated must produce an explicit, machine-readable verdict — never a silent
 * "available". This suite walks the declared situation table and asserts each row
 * against a real assembly, so the table cannot drift from the behaviour.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AVAILABILITY_STATES,
  DEGRADATION_SITUATIONS,
  createCapabilityNegotiator,
} from '../src/negotiation.mjs';
import { backendAvailabilityFrom } from '../src/backend-view.mjs';
import { createFrontendRegistry } from '../src/registry.mjs';
import { createSubLegoRegistry } from '../src/sublegos.mjs';
import { loadManifests } from '../src/manifests.mjs';
import { createFrontendLego } from '../src/lego.mjs';

const manifests = loadManifests();
const TEST_REF = 'packages/frontend-lego/test/23-degradation.test.mjs';

function assembly({ capabilities = [], overrides = {}, declared = manifests.capabilities } = {}) {
  const registry = createFrontendRegistry({
    surfaces: manifests.surfaces,
    extensionPoints: manifests.extensionPoints,
    owners: manifests.owners,
    capabilities,
  });
  const subLegos = createSubLegoRegistry({
    subLegos: manifests.subLegos,
    owners: manifests.owners,
    surfaces: manifests.surfaces,
    extensionPoints: manifests.extensionPoints,
  });
  return {
    registry,
    negotiator: createCapabilityNegotiator({
      registry,
      subLegos,
      surfaces: manifests.surfaces,
      declared,
      backend: backendAvailabilityFrom({ surfaces: manifests.surfaces, overrides }),
      contractVersion: '1.0.0',
      locales: ['id', 'en', 'ar', 'zh', 'ru', 'jv'],
    }),
  };
}

test('every degradation situation is a declared row with a state and a fallback', () => {
  const situations = DEGRADATION_SITUATIONS.map((row) => row.situation);
  assert.deepEqual(situations, ['unavailable', 'disabled', 'unsupported', 'incompatible', 'degraded', 'not-installed', 'migration-required']);
  for (const row of DEGRADATION_SITUATIONS) {
    assert.ok(AVAILABILITY_STATES.includes(row.state), `${row.situation} maps to a declared state`);
    assert.ok(row.trigger.length > 20, `${row.situation} says what triggers it`);
  }
});

test('unavailable: a capability nobody declares is reported, not assumed', () => {
  const { negotiator } = assembly();
  const verdict = negotiator.negotiate({ capabilityId: 'no-such-capability' });
  assert.equal(verdict.state, 'unavailable');
  assert.equal(verdict.ok, false);
  assert.equal(verdict.capability, null);
  assert.match(verdict.reasons.join(' '), /is not declared by this frontend/);
  assert.deepEqual(verdict.degradation, { behavior: 'fallback', fallback: 'native-behavior' });
});

test('disabled: an administrative switch is a state, not an empty result set', () => {
  const { negotiator } = assembly({
    declared: [{ id: 'search', lego: 'search', title: 'Search', status: 'available', lifecycle: 'disabled', surfaces: ['node-picker'], contracts: ['contracts/frontend.contract.md'], tests: [TEST_REF] }],
  });
  const verdict = negotiator.negotiate({ capabilityId: 'search' });
  assert.equal(verdict.state, 'disabled');
  assert.equal(verdict.ok, false);
  assert.equal(verdict.degradation.fallback, 'native-behavior');
  assert.match(verdict.reasons.join(' '), /administratively disabled/);
  // And the surface view says the same thing for a capability a surface actually
  // binds, so the two answers cannot disagree.
  const bound = assembly({
    declared: [{ id: 'settings', lego: 'settings', title: 'Settings', status: 'available', lifecycle: 'disabled', surfaces: ['navigation', 'settings'], contracts: ['contracts/frontend.contract.md'], tests: [TEST_REF] }],
  });
  const surface = bound.negotiator.featureAvailability().find((entry) => entry.capability === 'settings');
  assert.equal(surface.state, 'disabled');
  assert.match(surface.reasons.join(' '), /disabled/);
  assert.equal(bound.negotiator.negotiate({ capabilityId: 'settings' }).state, 'disabled');
});

test('unsupported: the instance does not implement it, and the UI is told to fall back', () => {
  const { negotiator } = assembly({ overrides: { workflow: { status: 'unsupported', owner: 'workflow' } } });
  const verdict = negotiator.negotiate({ capabilityId: 'workflow', unitId: 'workflow-editor.canvas' });
  assert.equal(verdict.state, 'unavailable');
  assert.match(verdict.reasons.join(' '), /does not implement "workflow"/);
  assert.equal(verdict.degradation.behavior, 'fallback');
  const surface = negotiator.featureAvailability().find((entry) => entry.capability === 'workflow');
  assert.equal(surface.state, 'unsupported');
  assert.equal(surface.source, 'override', 'and the view says where the fact came from');
});

test('incompatible: a major difference is named, with the compatibility state attached', () => {
  const { negotiator } = assembly({ overrides: { settings: { status: 'available', contractVersion: '2.0.0', owner: 'settings' } } });
  const verdict = negotiator.negotiate({ capabilityId: 'settings', requireVersion: '1.0.0' });
  assert.equal(verdict.state, 'version-mismatch');
  assert.equal(verdict.ok, false);
  assert.equal(verdict.compatibility.state, 'major-mismatch');
  assert.match(verdict.reasons.join(' '), /different major version/);
  assert.equal(verdict.degradation.fallback, 'native-behavior');
});

test('degraded: a partial backend, or a missing required operation, is not available', () => {
  const partial = assembly({ overrides: { settings: { status: 'partial', owner: 'settings' } } });
  const partialVerdict = partial.negotiator.negotiate({ capabilityId: 'settings' });
  assert.equal(partialVerdict.state, 'degraded');
  assert.equal(partialVerdict.ok, true, 'degraded still lets the UI proceed with the declared fallback');
  assert.deepEqual(partialVerdict.degradation, { behavior: 'degrade', fallback: 'declared-behaviour' });

  const withOperations = assembly({
    capabilities: [{
      id: 'search', lego: 'search', title: 'Search', status: 'available', surfaces: ['node-picker'],
      contracts: ['contracts/frontend.contract.md'], tests: [TEST_REF],
      operations: ['search.nodes'], activation: 'lazy', entry: './features/search/index.mjs',
    }],
  });
  const missing = withOperations.negotiator.negotiate({ capabilityId: 'search', requireOperations: ['search.nodes', 'search.workflows'] });
  assert.equal(missing.state, 'degraded');
  assert.deepEqual(missing.grantedOperations, ['search.nodes']);
  assert.deepEqual(missing.missingOperations, ['search.workflows']);
  assert.match(missing.reasons.join(' '), /operations not offered: search\.workflows/);
});

test('not-installed: a declared capability degrades instead of pretending to exist', () => {
  const { negotiator } = assembly();
  const verdict = negotiator.negotiate({ capabilityId: 'translation' });
  assert.equal(verdict.state, 'degraded');
  assert.match(verdict.reasons.join(' '), /declared but not installed/);
  assert.equal(verdict.capability.installed, false);
  // The readiness answer names it too, so a surface does not have to guess.
  assert.equal(negotiator.localeReadiness({ supported: ['id', 'en'], fallback: 'en' }).capability, 'declared-not-installed');
});

test('migration-required: present, gated, and never reported as available', () => {
  const { negotiator } = assembly({
    overrides: { workflow: { status: 'available', owner: 'workflow', migration: { required: true, from: 'v1', to: 'v2', detail: 'run the workflow migration' } } },
  });
  const verdict = negotiator.negotiate({ capabilityId: 'workflow', unitId: 'workflow-editor.canvas' });
  assert.equal(verdict.state, 'migration-required');
  assert.equal(verdict.ok, false);
  assert.equal(verdict.migrationRequired, true);
  assert.match(verdict.reasons.join(' '), /requires a migration/);
  assert.match(verdict.reasons.join(' '), /run the workflow migration/);
  assert.deepEqual(verdict.degradation, { behavior: 'fallback', fallback: 'native-behavior' });

  const surface = negotiator.featureAvailability().find((entry) => entry.capability === 'workflow');
  assert.equal(surface.state, 'migration-required');
  assert.match(surface.reasons.join(' '), /requires a migration/);
});

test('a migration gate is declared data: a capability may declare it, and a bad one is refused', () => {
  const frontend = createFrontendLego({ app: { name: 'n8n-lego', version: '0.1.0' } });
  const registered = frontend.register({
    id: 'migrating', lego: 'settings', title: 'Migrating', status: 'available', surfaces: ['settings'],
    contracts: ['contracts/frontend.contract.md'], tests: [TEST_REF],
    migration: { required: true, from: '0.9', to: '1.0' },
  });
  assert.equal(registered.migration.required, true);
  assert.equal(frontend.negotiate({ capabilityId: 'migrating' }).state, 'migration-required');

  assert.throws(
    () => frontend.register({
      id: 'bad-migration', lego: 'settings', title: 'Bad', status: 'declared', surfaces: ['settings'],
      contracts: ['contracts/frontend.contract.md'], tests: [TEST_REF],
      migration: { required: 'yes' },
    }),
    /"migration\.required" must be a boolean/,
  );
});

test('required permissions are declared data, reported to the consumer, never inferred', () => {
  const frontend = createFrontendLego({ app: { name: 'n8n-lego', version: '0.1.0' } });
  frontend.register({
    id: 'audit-log', lego: 'settings', title: 'Audit log', status: 'available', surfaces: ['settings'],
    contracts: ['contracts/frontend.contract.md'], tests: [TEST_REF],
    operations: ['audit.list'],
    permissions: ['audit:read'],
    activation: 'lazy', entry: './features/audit/index.mjs',
  });
  const described = frontend.describeCapability('audit-log');
  assert.deepEqual(described.permissions, ['audit:read']);
  const verdict = frontend.negotiate({ capabilityId: 'audit-log' });
  assert.deepEqual(verdict.requiredPermissions, ['audit:read'], 'the verdict carries what the consumer must be allowed to do');
  // A capability that requires nothing says so, rather than implying a permission.
  assert.deepEqual(frontend.negotiate({ capabilityId: 'translation' }).requiredPermissions, []);

  for (const permissions of [['read'], ['audit:read:all'], ['audit:'], 'audit:read', ['audit:read', 'audit:read']]) {
    assert.throws(
      () => frontend.register({
        id: 'bad-permissions', lego: 'settings', title: 'Bad', status: 'declared', surfaces: ['settings'],
        contracts: ['contracts/frontend.contract.md'], tests: [TEST_REF], permissions,
      }),
      /permissions|permission/,
      `"${JSON.stringify(permissions)}" is refused`,
    );
  }
});

test('no situation silently reports availability: every non-available verdict explains itself', () => {
  const frontend = createFrontendLego({ app: { name: 'n8n-lego', version: '0.1.0' } });
  const cases = [
    { capabilityId: 'no-such-capability' },
    { capabilityId: 'translation' },
    { capabilityId: 'workflow', unitId: 'settings.localization.rtl' },
  ];
  for (const request of cases) {
    const verdict = frontend.negotiate(request);
    assert.notEqual(verdict.state, 'available');
    assert.ok(verdict.reasons.length > 0, `${JSON.stringify(request)} carries a reason`);
    assert.ok(['fallback', 'degrade'].includes(verdict.degradation.behavior));
    assert.match(verdict.degradation.fallback, /native-behavior|declared-behaviour/);
  }
  // And the frontend's own declared fallbacks are the ones the lifecycle module decided.
  const declared = frontend.availability()[0];
  assert.equal(typeof declared.degradation.fallback, 'string');
  assert.ok(declared.degradation.detail.length > 20, 'a fallback without an explanation is not a contract');
});
