/**
 * I2/I3 — capability registration is fail-closed and deterministic.
 *
 * The registry is the mechanism a future feature LEGO uses to declare itself.
 * These tests are the specification of what "declaring a capability" means, and
 * they prove that an incomplete declaration is refused instead of silently
 * becoming an unowned surface.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RegistryError, createFrontendRegistry, validateCapability } from '../src/registry.mjs';
import { createFrontendLego } from '../src/lego.mjs';
import { loadManifests } from '../src/manifests.mjs';

const manifests = loadManifests();

function registry() {
  return createFrontendRegistry({ surfaces: manifests.surfaces, extensionPoints: manifests.extensionPoints });
}

/** A correct declaration, used as the baseline every negative case mutates. */
function translationCapability(overrides = {}) {
  return {
    id: 'translation',
    lego: 'translation',
    title: 'Translation',
    status: 'declared',
    surfaces: ['navigation', 'settings', 'error-surfaces'],
    contracts: ['contracts/frontend.contract.md', 'contracts/localization.contract.md'],
    extensionPoints: ['ui:message:catalog', 'ui:locale:switch'],
    backendCapabilities: ['settings'],
    messages: 'translation',
    tests: ['packages/frontend-lego/test/02-registry.test.mjs'],
    ...overrides,
  };
}

test('a well-formed capability registers and is listed deterministically', () => {
  const value = registry();
  const registered = value.register(translationCapability());
  assert.equal(registered.id, 'translation');
  assert.deepEqual(registered.surfaces, ['navigation', 'settings', 'error-surfaces']);
  // Same hook set, so the same surfaces: a capability may only extend its own surfaces' hooks.
  value.register(translationCapability({ id: 'accessibility', messages: 'accessibility' }));
  assert.deepEqual(value.list().map((capability) => capability.id), ['accessibility', 'translation'], 'sorted by id');
  assert.equal(value.get('translation').title, 'Translation');
  assert.equal(value.has('nope'), false);
  assert.equal(value.get('nope'), null);
});

test('an unknown surface is refused with a precise error', () => {
  const value = registry();
  assert.throws(() => value.register(translationCapability({ surfaces: ['sidebar-of-doom'] })), (error) => {
    assert.ok(error instanceof RegistryError);
    assert.equal(error.code, 'frontend.registry.invalid-capability');
    assert.equal(error.capabilityId, 'translation');
    assert.match(error.errors.join('\n'), /unknown surface "sidebar-of-doom"/);
    return true;
  });
  assert.equal(value.list().length, 0, 'a refused capability must not be half-registered');
});

test('an undeclared extension point is refused', () => {
  const value = registry();
  assert.throws(() => value.register(translationCapability({ extensionPoints: ['ui:magic:everything'] })), /unknown extension point "ui:magic:everything"/);
});

test('a capability without a contract reference or a test is refused', () => {
  const value = registry();
  assert.throws(() => value.register(translationCapability({ contracts: [] })), /"contracts" must name the contract/);
  assert.throws(() => value.register(translationCapability({ tests: [] })), /a capability without a test has no boundary/);
  assert.throws(() => value.register(translationCapability({ surfaces: [] })), /"surfaces" must name at least one declared surface/);
  assert.throws(() => value.register(translationCapability({ id: 'Translation LEGO' })), /"id" must be kebab-case/);
  assert.throws(() => value.register(translationCapability({ status: 'shipped' })), /"status" must be one of/);
});

test('duplicate ids and duplicate message namespaces are refused', () => {
  const value = registry();
  value.register(translationCapability());
  assert.throws(() => value.register(translationCapability()), /already registered/);
  assert.throws(
    () => value.register(translationCapability({ id: 'translation-two', lego: 'translation-two' })),
    /message namespace "translation" is already owned by another capability/,
  );
});

test('registration never mutates the descriptor it was given', () => {
  const value = registry();
  const capability = translationCapability();
  const snapshot = JSON.stringify(capability);
  value.register(capability);
  assert.equal(JSON.stringify(capability), snapshot);
});

test('the descriptor is data-only, ordered and serialisable', () => {
  const value = registry();
  value.register(translationCapability());
  const descriptor = value.descriptor();
  assert.ok(Object.isFrozen(descriptor));
  assert.equal(JSON.stringify(descriptor), JSON.stringify(JSON.parse(JSON.stringify(descriptor))), 'no functions in the payload');
  assert.deepEqual(descriptor.surfaces.map((surface) => surface.id), manifests.surfaces.map((surface) => surface.id), 'catalog order preserved');
  assert.equal(descriptor.capabilities[0].id, 'translation');
  assert.equal(descriptor.extensionPoints.length, manifests.extensionPoints.length);
});

test('routes resolve to their owning capabilities', () => {
  const value = registry();
  value.register(translationCapability({ routes: ['/settings/translation'] }));
  assert.deepEqual(value.resolveRoute('/settings/translation').map((capability) => capability.id), ['translation']);
  assert.deepEqual(value.resolveRoute('/settings/translation/languages').map((capability) => capability.id), ['translation']);
  assert.deepEqual(value.resolveRoute('/workflow/1'), []);
});

test('an empty catalog is rejected: the registry needs a vocabulary', () => {
  assert.throws(() => createFrontendRegistry({ surfaces: [], extensionPoints: [] }), /surface catalog is empty/);
});

test('a surface referencing an undeclared hook is rejected at construction', () => {
  assert.throws(
    () =>
      createFrontendRegistry({
        surfaces: [{ id: 'fake', title: 'Fake', kind: 'page', routes: [], status: 'present', backend: { capability: 'none' }, messageSlots: ['navigation'], extensionPoints: ['ui:not:declared'] }],
        extensionPoints: manifests.extensionPoints,
      }),
    /surface catalog references undeclared extension points/,
  );
});

test('validateCapability answers instead of throwing, so callers can render the problems', () => {
  const catalog = { surfaces: manifests.surfaces, extensionPoints: manifests.extensionPoints, knownNamespaces: [] };
  const ok = validateCapability(translationCapability(), catalog);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.errors, []);
  const bad = validateCapability({ id: 'x' }, catalog);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.length >= 5, `expected several problems, got: ${bad.errors.join(' | ')}`);
});

test('the assembly exposes the registry and the registration hook', () => {
  const lego = createFrontendLego({ app: { name: 'n8n lego', version: '0.1.0' }, ui: {} });
  assert.equal(lego.registry.list().length, 0, 'P2.5 registers nothing by default');
  lego.register(translationCapability());
  assert.equal(lego.registry.list().length, 1);
  assert.equal(lego.describe().capabilities, 1);
  assert.equal(lego.describe().adapter, 'vue');
  assert.equal(lego.describe().backendUntouched, true);
});

test('the assembly reports a message slot that no surface owns', () => {
  const lego = createFrontendLego({
    app: { name: 'n8n lego', version: '0.1.0' },
    capabilities: [],
  });
  assert.deepEqual(lego.warnings, [], 'the shipped catalogs must map every slot');
});
