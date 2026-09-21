/**
 * Security and trust at the frontend boundary.
 *
 * Every rule here is a "no" that has to hold while the system is being extended:
 * trust cannot be raised by nesting, private internals cannot leak into what the
 * browser receives, a sibling cannot reach a private port, a capability cannot claim
 * a neighbour's extension point, and no credential ever enters an envelope.
 *
 * Fail closed is the default: an invalid declaration is refused, never repaired.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFrontendLego } from '../src/lego.mjs';
import { createFrontendRegistry } from '../src/registry.mjs';
import { createSubLegoRegistry, parentIdOf } from '../src/sublegos.mjs';
import { loadManifests } from '../src/manifests.mjs';
import { EnvelopeError } from '../src/envelope.mjs';
import { CapabilityNotGrantedError } from '../src/negotiation.mjs';

const manifests = loadManifests();
const TEST_REF = 'packages/frontend-lego/test/21-security.test.mjs';

function lego(extra = {}) {
  return createFrontendLego({ app: { name: 'n8n-lego', version: '0.1.0' }, ...extra });
}

function unit(overrides = {}) {
  const id = overrides.id ?? 'sample';
  return {
    id,
    parentId: parentIdOf(id),
    title: 'Sample unit',
    owner: 'agent-01',
    version: '1.0.0',
    surface: 'settings',
    contract: 'contracts/frontend.contract.md',
    // Ports are shared vocabulary: the fixture publishes one port named after itself.
    public: { ports: [`ui:${id.replace(/\./g, '-')}:thing`], contracts: ['contracts/frontend.contract.md'] },
    internals: [`src/sub-legos/${id}/**`],
    status: 'declared',
    tests: [TEST_REF],
    upgrade: { policy: 'independent', compatibleWith: '1.x' },
    ...overrides,
  };
}

test('trust cannot be raised by nesting — a child may be less trusted, never more', () => {
  const frontend = lego();
  const parent = frontend.subLegos.get('settings');
  // The parent is a declared unit; a nested child that claims a higher level is refused.
  assert.throws(
    () => frontend.subLegos.register(unit({ id: 'settings.privileged', trust: 'core' })),
    (error) => {
      assert.match(error.message, /may not be promoted by nesting|more trusted than its parent/);
      return true;
    },
  );
  // Declaring nothing inherits the parent's level — never a default, never higher.
  const child = frontend.subLegos.register(unit({ id: 'settings.inherited' }));
  assert.equal(child.trust, parent.trust);
  assert.equal(frontend.subLegos.trustOf('settings.inherited'), parent.trust);
  // And a lower level is accepted: less trusted than the parent is always allowed.
  frontend.subLegos.register(unit({ id: 'settings.lower', trust: 'extension' }));
  assert.equal(frontend.subLegos.trustOf('settings.lower'), 'extension');
  // A level nobody declared is refused rather than interpreted.
  assert.throws(() => frontend.subLegos.register(unit({ id: 'settings.odd', trust: 'adapter' })), /"trust" must be one of/);
});

test('private internals never reach the browser: the boot descriptor is a whitelist', () => {
  const frontend = lego();
  const boot = JSON.parse(JSON.stringify(frontend.bootPayload));
  const allowed = ['id', 'owner', 'parentId', 'ports', 'status', 'surface', 'version'];
  for (const entry of boot.subLegos) {
    assert.deepEqual(Object.keys(entry).sort(), allowed, `${entry.id} publishes only the boot keys`);
  }
  const serialized = JSON.stringify(boot);
  // No file path, no module reference, no internals field: the payload names units, not code.
  for (const pattern of [/\bsrc\//, /\.mjs\b/, /sub-legos/, /"internals"/, /"implementation"/, /"entry"/]) {
    assert.equal(pattern.test(serialized), false, `the boot payload does not match ${pattern}`);
  }
  // The full descriptor keeps them — they exist, they are simply not shipped.
  const descriptor = JSON.stringify(frontend.subLegos.descriptor());
  assert.ok(descriptor.includes('internals'), 'the catalog still holds the internals');
});

test('a sibling cannot reach a private port, and a port nobody publishes is not a boundary', () => {
  const frontend = lego();
  const owner = frontend.subLegos.get('workflow-editor.node-panel');
  // The publisher itself may resolve its published port...
  assert.equal(frontend.subLegos.resolvePort('workflow-editor.node-panel', 'ui:panel:selection').subLego, 'workflow-editor.node-panel');
  // ...a unit that does not publish it may not.
  assert.throws(
    () => frontend.subLegos.resolvePort('workflow-editor.parameter-panel', 'ui:panel:selection'),
    /does not publish "ui:panel:selection" — it is private to the unit/,
  );
  assert.ok(owner.public.ports.includes('ui:panel:selection'));
  // Declaring a dependency on a port that is not published is refused at registration.
  assert.throws(
    () => frontend.subLegos.register(unit({
      id: 'settings.consumer',
      dependsOn: [{ subLego: 'workflow-editor.node-panel', port: 'ui:panel:not-a-port', versionRange: '^1.0.0' }],
    })),
    /reaches into the private internals of "workflow-editor.node-panel".*"ui:panel:not-a-port" is not a published port/,
  );
});

test('extension points are surface-owned: a capability may only reach its own hooks', () => {
  const frontend = lego();
  const foreign = frontend.registry.extensionPoints.find((point) => point.surface !== 'settings'); // eslint-disable-line
  assert.ok(foreign, 'there is a hook on another surface to try');
  const own = frontend.registry.extensionPoints.find((point) => point.surface === 'settings');
  const base = {
    id: 'extension-fixture', lego: 'settings', title: 'Extension fixture', status: 'declared',
    contracts: ['contracts/frontend.contract.md'], tests: [TEST_REF],
  };
  assert.throws(
    () => frontend.register({ ...base, surfaces: ['settings'], extensionPoints: [foreign.id] }),
    (error) => {
      assert.match(error.message, new RegExp(`extension point "${foreign.id}" belongs to surface "${foreign.surface}"`));
      assert.match(error.message, /an extension may only add to its own surface's hooks/);
      return true;
    },
  );
  // Its own surface's hook is fine.
  const registered = frontend.register({ ...base, surfaces: ['settings'], extensionPoints: [own.id] });
  assert.deepEqual(registered.extensionPoints, [own.id]);
  // And a hook nobody declared is not a boundary either (a fresh id, so the refusal
  // is about the hook and not about a duplicate registration).
  assert.throws(
    () => frontend.register({ ...base, id: 'extension-unknown-hook', surfaces: ['settings'], extensionPoints: ['ui:magic:everything'] }),
    /unknown extension point "ui:magic:everything"/,
  );
});

test('a capability is declared, not discovered: unknown use fails closed', () => {
  const frontend = lego();
  const declared = frontend.availability()[0];
  // Granted: a unit that occupies a surface the capability declares.
  const granted = frontend.requireUse(declared.surfaces[0], declared.id);
  assert.equal(granted.capabilityId, declared.id);
  assert.ok(['surface-binding', 'declared-surface'].includes(granted.basis));

  // A capability that declares one surface is not granted to a unit on another.
  frontend.register({
    id: 'settings-only', lego: 'settings', title: 'Settings only', status: 'declared',
    surfaces: ['settings'], contracts: ['contracts/frontend.contract.md'], tests: [TEST_REF],
  });
  assert.throws(
    () => frontend.requireUse('workflow-editor.canvas', 'settings-only'),
    (error) => {
      assert.ok(error instanceof CapabilityNotGrantedError);
      assert.equal(error.capabilityId, 'settings-only');
      assert.match(error.message, /placement never grants a capability/);
      return true;
    },
  );
  const verdict = frontend.negotiate({ capabilityId: 'settings-only', unitId: 'workflow-editor.canvas' });
  assert.equal(verdict.capability, null, 'an ungranted consumer is not told what the capability is');
  assert.equal(verdict.contractVersion, null);
  assert.equal(verdict.state, 'unavailable');
  assert.equal(verdict.degradation.fallback, 'native-behavior', 'and the UI is told what to do instead');

  // A capability nobody declared is unavailable for everyone, including a declared unit.
  assert.equal(frontend.describeCapability('no-such-capability'), null, 'discovery answers null for the unknown');
  assert.equal(frontend.negotiate({ capabilityId: 'no-such-capability', unitId: 'settings' }).state, 'unavailable');
});

test('an unsupported feature is refused by the backend map, and never silently served', () => {
  // The compatibility layer reports 501s by endpoint; the view turns them into state.
  const frontend = lego({
    backend: {
      unsupportedFeatures: [{ prefix: '/rest/sso', owner: 'auth', code: 'backend.rest.unsupported' }],
    },
  });
  const partial = frontend.featureAvailability().filter((entry) => entry.state !== 'available');
  assert.ok(partial.length > 0, 'the unsupported feature shows up in the availability view');
  assert.ok(partial.every((entry) => entry.reasons.length > 0), 'every non-available surface explains itself');
  // And an explicit override is visible as an override, not as a measurement.
  const overridden = lego({ backend: { capabilities: { workflow: { status: 'unsupported', owner: 'workflow' } } } });
  assert.equal(overridden.describe().backendCapabilities, 1);
  const verdict = overridden.negotiate({ capabilityId: 'workflow', unitId: 'workflow-editor.canvas' });
  assert.equal(verdict.state, 'unavailable', 'the frontend reports what it can actually use');
  assert.match(verdict.reasons.join(' '), /does not implement "workflow"/);
  assert.equal(verdict.degradation.fallback, 'native-behavior');
});

test('no credential material enters an envelope, and none reaches a transport', async () => {
  const frontend = lego();
  frontend.registerOperation('workflow.list', async (context) => context.identity);

  for (const credential of [
    { subject: 'user-1', token: 'x' },
    { subject: 'user-1', scopes: ['workflow:read'], authorization: 'Bearer x' },
    { subject: 'user-1', cookie: 'n8n-auth=1' },
    { subject: 'user-1', apiKey: 'k' },
  ]) {
    await assert.rejects(
      () => frontend.invoke({ capability: 'workflow', operation: 'workflow.list', authorization: credential }),
      (error) => {
        assert.ok(error instanceof EnvelopeError);
        assert.match(error.message, /authorization context, never a credential/);
        return true;
      },
    );
  }

  // A context is what travels: subject and scopes, and nothing else.
  const result = await frontend.invoke({
    capability: 'workflow',
    operation: 'workflow.list',
    authorization: { subject: 'user-1', scopes: ['workflow:read'] },
  });
  assert.equal(result.value, 'workflow:workflow.list@1.0.0');
  assert.deepEqual(result.context.authorization, { subject: 'user-1', scopes: ['workflow:read'] });
  const hints = JSON.stringify(result.context.toTransportHints());
  for (const secret of ['token', 'Bearer', 'cookie', 'apiKey', 'password']) {
    assert.equal(hints.includes(secret), false, `"${secret}" is not serialized into transport hints`);
  }
});

test('the registry refuses a declaration that carries code, and keeps ownership visible', () => {
  const registry = createFrontendRegistry({
    surfaces: manifests.surfaces,
    extensionPoints: manifests.extensionPoints,
    owners: manifests.owners,
  });
  assert.throws(
    () => registry.register({
      id: 'sneaky', lego: 'settings', title: 'Sneaky', status: 'declared',
      surfaces: ['settings'], contracts: ['contracts/frontend.contract.md'], tests: [TEST_REF],
      handler: () => {},
    }),
    /carries implementation into the registry/,
  );
  // Ownership is data, and it is read from the manifests rather than restated.
  const owners = Object.keys(manifests.owners);
  assert.ok(owners.length > 0);
  const settingsUnit = lego().subLegos.get('settings.general');
  assert.ok(owners.includes(settingsUnit.owner), `"${settingsUnit.owner}" is a declared owner`);
  assert.ok(owners.includes(lego().availability()[0].owner), 'the declared capability names a real owner');
  // A capability that claims a foreign owner is refused: ownership is not a free-text note.
  assert.throws(
    () => registry.register({
      id: 'claimed', lego: 'settings', title: 'Claimed', status: 'declared',
      surfaces: ['settings'], contracts: ['contracts/frontend.contract.md'], tests: [TEST_REF],
      owner: 'agent-99',
    }),
    /unknown owner "agent-99"/,
  );
  assert.throws(
    () => registry.register({
      id: 'unowned', lego: 'settings', title: 'Unowned', status: 'declared',
      surfaces: ['settings'], contracts: ['contracts/frontend.contract.md'], tests: [TEST_REF],
      owned_by: 'agent-01',
    }),
    /unknown field "owned_by"/,
  );
});
