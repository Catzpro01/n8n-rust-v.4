/**
 * Registry maturity: activation vs availability, criticality, trust, degradation
 * and translation coverage — all as declaration data, none of it loading code.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ACTIVATION_MODES, CAPABILITY_SCHEMA, createFrontendRegistry } from '../src/registry.mjs';
import { loadManifests } from '../src/manifests.mjs';
import { translationCoverage } from '../src/i18n.mjs';
import { degradationFor } from '../src/lifecycle.mjs';

const manifests = loadManifests();

function base(overrides = {}) {
  return {
    id: 'translation',
    lego: 'translation',
    title: 'Translation',
    status: 'declared',
    surfaces: ['settings'],
    contracts: ['contracts/frontend.contract.md'],
    tests: ['packages/translation-lego/test/*.test.mjs'],
    ...overrides,
  };
}

function registryFor(capabilities) {
  return createFrontendRegistry({ surfaces: manifests.surfaces, extensionPoints: manifests.extensionPoints, capabilities });
}

test('the schema names the maturity fields and refuses code smuggled into metadata', () => {
  for (const field of ['activation', 'entry', 'criticality', 'trust', 'requirements', 'lifecycle', 'degradation']) {
    assert.ok(CAPABILITY_SCHEMA.optional.includes(field), `${field} is a declared optional field`);
  }
  assert.deepEqual(ACTIVATION_MODES, ['eager', 'lazy', 'manual']);
  for (const key of ['load', 'render', 'mount', 'component']) {
    assert.throws(() => registryFor([base({ [key]: () => {} })]), (error) => {
      assert.equal(error.code, 'frontend.registry.invalid-capability');
      assert.match(error.message, /carries implementation into the registry/);
      return true;
    }, `"${key}" must not be carried inline`);
  }
});

test('a lazy capability declares where its code lives once it is installable', () => {
  const eager = registryFor([base()]);
  assert.equal(eager.get('translation').activation, 'eager');
  assert.equal(eager.get('translation').entry, null);

  const lazy = registryFor([base({ activation: 'lazy', entry: './features/translation/index.mjs' })]);
  assert.equal(lazy.get('translation').entry, './features/translation/index.mjs');

  // Declared means "no code exists yet", so a lazy declaration owes no entry…
  const declared = registryFor([base({ status: 'declared', activation: 'lazy' })]);
  assert.equal(declared.get('translation').entry, null);
  assert.equal(declared.get('translation').activation, 'lazy', 'the intent to load lazily survives the absence of code');

  // …but the moment it is installable, the runtime must know where to find it.
  for (const activation of ['lazy', 'manual']) {
    assert.throws(
      () => registryFor([base({ status: 'available', activation })]),
      /needs an "entry" module path/,
      `${activation} without an entry is refused once the capability is installable`,
    );
  }
  assert.throws(() => registryFor([base({ activation: 'someday' })]), /"activation" must be one of eager, lazy, manual/);
  assert.throws(() => registryFor([base({ activation: 'lazy', entry: './features/x/' })]), /"entry" must be a module path/);
});

test('availability is reported without activating anything', () => {
  const registry = registryFor([
    base({ activation: 'lazy', entry: './features/translation/index.mjs', criticality: 'enhancement' }),
    base({ id: 'search', title: 'Search', lego: 'search', activation: 'manual', entry: './features/search/index.mjs', criticality: 'optional', degradation: { fallback: 'native-behavior' } }),
  ]);
  const availability = registry.availability();
  assert.equal(availability.length, 2);
  // Sorted, stable and derived from the catalog order — a registry says what
  // exists, not the order somebody happened to construct it in.
  assert.deepEqual(availability.map((entry) => entry.id), ['search', 'translation']);
  assert.deepEqual(availability.map((entry) => entry.activation), ['manual', 'lazy']);
  for (const entry of availability) {
    assert.equal(entry.lifecycle, 'available', 'declared is not installed, and certainly not active');
    assert.equal('load' in entry, false, 'the projection is metadata only');
    assert.ok(entry.degradation.behavior);
  }
  const byId = new Map(availability.map((entry) => [entry.id, entry]));
  assert.equal(byId.get('translation').degradation.behavior, 'continue', 'an enhancement needs no notice');
  assert.equal(byId.get('search').degradation.behavior, 'fallback');
  assert.equal(registry.degradationOf('search').fallback, 'native-behavior');
  assert.equal(registry.degradationOf('nothing-here'), null);
});

test('criticality is declared, defaults safely, and core may not hide a fallback', () => {
  const registry = registryFor([base()]);
  assert.equal(registry.get('translation').criticality, 'optional', 'the default is optional, but it is declared, never inferred by the reader');

  assert.throws(
    () => registryFor([base({ criticality: 'core', degradation: { fallback: 'native-behavior' } })]),
    /may not declare a fallback/,
  );
  const core = registryFor([base({ criticality: 'core' })]).get('translation');
  assert.equal(degradationFor(core).behavior, 'fail-loud');
  assert.throws(() => registryFor([base({ criticality: 'critical' })]), /"criticality" must be one of core, optional, enhancement/);
});

test('trust and lifecycle states are validated against the shared vocabulary', () => {
  assert.equal(registryFor([base()]).get('translation').trust, 'feature');
  assert.equal(registryFor([base({ trust: 'untrusted' })]).get('translation').trust, 'untrusted');
  assert.throws(() => registryFor([base({ trust: 'vibes' })]), /"trust" must be one of core, feature, extension, untrusted/);

  assert.equal(registryFor([base()]).get('translation').lifecycle, 'available');
  assert.throws(() => registryFor([base({ lifecycle: 'running' })]), /"lifecycle" must be a capability state/);
});

test('device requirements are declared with a known vocabulary and honest numbers', () => {
  const registry = registryFor([base({ requirements: { memoryMb: 64, heavy: true, requiresNetwork: true } })]);
  assert.deepEqual(registry.get('translation').requirements, { memoryMb: 64, heavy: true, requiresNetwork: true });

  assert.throws(() => registryFor([base({ requirements: { gpuFlops: 10 } })]), /unknown requirement "gpuFlops"/);
  assert.throws(() => registryFor([base({ requirements: { memoryMb: -4 } })]), /requirement "memoryMb" must be a positive number/);
  assert.throws(() => registryFor([base({ requirements: 'lots' })]), /"requirements" must be an object/);
});

test('the declared catalog stays within the maturity vocabulary', () => {
  const registry = createFrontendRegistry({ surfaces: manifests.surfaces, extensionPoints: manifests.extensionPoints });
  for (const capability of registry.list()) {
    assert.ok(ACTIVATION_MODES.includes(capability.activation), `${capability.id} activation`);
    assert.ok(['core', 'optional', 'enhancement'].includes(capability.criticality), `${capability.id} criticality`);
    assert.ok(['core', 'feature', 'extension', 'untrusted'].includes(capability.trust), `${capability.id} trust`);
    assert.equal(capability.lifecycle, 'available', `${capability.id} starts available, never active`);
    if (capability.activation !== 'eager') assert.equal(typeof capability.entry, 'string', `${capability.id} declares an entry`);
    // A registry that requires loading code to know what exists is not a registry.
    assert.equal(JSON.stringify(capability.availability ?? {}).includes('function'), false);
  }
});

test('translation coverage says which surfaces the catalog can reach', () => {
  const coverage = translationCoverage(manifests.surfaces);
  assert.equal(coverage.surfaces.length, manifests.surfaces.length);
  assert.ok(coverage.slots.length >= 13, 'the declared slot vocabulary is unchanged');
  assert.deepEqual(coverage.uncoveredSurfaces, [], 'every declared surface owns at least one message slot');
  for (const entry of coverage.surfaces) {
    assert.equal(entry.covered, true, `${entry.id} is translatable`);
    assert.ok(entry.slots.length > 0);
  }
  // Surfaces the brief lists for the future Translation LEGO must be reachable
  // through slots, not through string literals in components.
  const byId = new Map(coverage.surfaces.map((entry) => [entry.id, entry]));
  for (const surface of ['navigation', 'dashboard', 'settings', 'workflow-editor', 'node-picker', 'dialogs', 'notifications', 'error-surfaces']) {
    assert.ok(byId.get(surface).slots.length > 0, `${surface} is in the coverage report`);
  }
  assert.deepEqual(coverage.orphanSlots, [], 'no slot is declared without a surface to render it');
});
