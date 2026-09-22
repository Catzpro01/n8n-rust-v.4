/**
 * Implementation replacement: A and B behind the same contract.
 *
 * This is the operation the whole architecture exists for — a JS implementation
 * becoming a Rust one, or any other swap, without the consumer noticing. The tests
 * pin what must *not* change (contract, version, consumers) and what must be
 * refused (contract change, version move, port removal, no-op).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFrontendLego } from '../src/lego.mjs';
import { SubLegoError, SubLegoReplacementError, satisfies } from '../src/sublegos.mjs';
import { createObservability } from '../src/observability.mjs';

function lego(extra = {}) {
  return createFrontendLego({ app: { name: 'n8n-lego', version: '0.1.0' }, ...extra });
}

test('every unit states what implements it, derived when nothing is declared', () => {
  const frontend = lego();
  const implementation = frontend.subLegos.implementationOf('settings.general');
  assert.deepEqual(implementation, {
    id: 'settings.general',
    kind: 'reference',
    contract: 'contracts/frontend.contract.md',
    status: 'declared',
    language: null,
    notes: null,
  });
  assert.equal(frontend.subLegos.implementationOf('nothing-here'), null);
  // The full descriptor carries it; the boot view does not (it is not runtime data).
  const described = frontend.subLegos.descriptor().subLegos.find((unit) => unit.id === 'settings.general');
  assert.equal(described.implementation.kind, 'reference');
  assert.equal('implementation' in frontend.bootPayload.subLegos[0], false);
});

test('a replacement keeps the contract, the version and every consumer', () => {
  const frontend = lego();
  const before = frontend.subLegos.descriptor().subLegos;
  const beforeBytes = JSON.stringify(before);

  const result = frontend.subLegos.replace('workflow-editor.node-panel', { id: 'workflow-editor.node-panel.rust', kind: 'native', language: 'rust' });

  assert.equal(result.kind, 'replacement');
  assert.equal(result.unit, 'workflow-editor.node-panel');
  assert.equal(result.from.id, 'workflow-editor.node-panel');
  assert.equal(result.to.id, 'workflow-editor.node-panel.rust');
  assert.equal(result.to.kind, 'native');
  assert.equal(result.version, '1.0.0', 'a replacement does not move the version');
  assert.equal(result.contract, 'contracts/frontend.contract.md', 'the contract outlives the implementation');
  assert.deepEqual(result.consumers, ['workflow-editor.parameter-panel'], 'the dependent is reported, not disturbed');
  assert.ok(result.unchanged.includes('workflow-editor.parameter-panel'));

  const after = frontend.subLegos.descriptor().subLegos;
  const changed = after.filter((unit, index) => JSON.stringify(unit) !== JSON.stringify(before[index]));
  assert.equal(changed.length, 1, 'only the replaced unit changed');
  assert.equal(changed[0].id, 'workflow-editor.node-panel');
  // The consumer's declaration is byte-identical: it depends on a port, not an implementation.
  const consumerBefore = before.find((unit) => unit.id === 'workflow-editor.parameter-panel');
  const consumerAfter = after.find((unit) => unit.id === 'workflow-editor.parameter-panel');
  assert.equal(JSON.stringify(consumerAfter), JSON.stringify(consumerBefore));
  assert.notEqual(JSON.stringify(after), beforeBytes);
});

test('the replaced unit still publishes the same ports, so consumers keep working', () => {
  const frontend = lego();
  const ports = frontend.subLegos.get('workflow-editor.node-panel').public.ports;
  frontend.subLegos.replace('workflow-editor.node-panel', { id: 'node-panel-native', kind: 'native' });
  assert.deepEqual(frontend.subLegos.get('workflow-editor.node-panel').public.ports, ports);
  // The publisher still publishes the port the consumer depends on, at the same version.
  const resolved = frontend.subLegos.resolvePort('workflow-editor.node-panel', 'ui:panel:selection');
  assert.equal(resolved.subLego, 'workflow-editor.node-panel');
  assert.equal(resolved.version, '1.0.0');
  const consumer = frontend.subLegos.get('workflow-editor.parameter-panel');
  const dependency = consumer.dependsOn.find((entry) => entry.port === 'ui:panel:selection');
  assert.equal(dependency.subLego, 'workflow-editor.node-panel');
  assert.equal(satisfies(resolved.version, dependency.versionRange), true, 'the consumer range still holds');
});

test('a replacement that would change public surface or the version is refused', () => {
  const frontend = lego();
  const before = JSON.stringify(frontend.subLegos.descriptor().subLegos);

  assert.throws(
    () => frontend.subLegos.replace('settings.general', { id: 'settings.general.native', kind: 'native', version: '1.1.0' }),
    (error) => {
      assert.ok(error instanceof SubLegoReplacementError);
      assert.equal(error.code, 'frontend.registry.replacement-blocked');
      assert.match(error.message, /must not change the version/);
      return true;
    },
  );
  // Same implementation twice is a no-op, and a no-op is a mistake worth naming.
  assert.throws(
    () => frontend.subLegos.replace('settings.general', { id: 'settings.general', kind: 'reference' }),
    /is already implemented by settings\.general/,
  );
  assert.throws(() => frontend.subLegos.replace('nothing.here', { id: 'x', kind: 'native' }), SubLegoError);
  assert.throws(() => frontend.subLegos.replace('settings.general', { id: 'x', kind: 'quantum' }), /replacement is refused|replacement/);

  assert.equal(JSON.stringify(frontend.subLegos.descriptor().subLegos), before, 'every refusal left the catalog untouched');
});

test('a declaration that answers to a different contract is refused at registration', () => {
  const frontend = lego();
  const unit = frontend.manifests.subLegos.find((entry) => entry.id === 'settings.general');
  assert.throws(
    () => frontend.subLegos.register({
      ...unit,
      id: 'settings.other',
      implementation: { id: 'x', kind: 'native', contract: 'contracts/other.contract.md' },
    }),
    /must be the unit's own contract/,
  );
});

test('replacement and upgrade stay distinct, and both are observable', () => {
  const events = createObservability();
  const frontend = lego({ observability: events });

  frontend.subLegos.replace('settings.general', { id: 'settings.general.native', kind: 'native', language: 'rust' });
  assert.equal(events.counts()['frontend.replacement.applied'], 1);

  frontend.subLegos.upgrade('settings.general', { version: '1.0.1' });
  assert.equal(events.counts()['frontend.upgrade.applied'], 1);
  // The replacement survived the upgrade: the two operations are independent.
  assert.equal(frontend.subLegos.implementationOf('settings.general').id, 'settings.general.native');
  assert.equal(frontend.subLegos.get('settings.general').version, '1.0.1');

  assert.throws(() => frontend.subLegos.replace('settings.general', { id: 'x', kind: 'native', version: '9.9.9' }), /must not change the version/);
  assert.equal(events.counts()['frontend.replacement.rejected'], 1);
});

test('nested replacement works at any depth, and the hierarchy stays intact', () => {
  const frontend = lego();
  const result = frontend.subLegos.replace('settings.localization.rtl', { id: 'rtl-native', kind: 'native', language: 'rust' });
  assert.equal(result.to.kind, 'native');
  assert.deepEqual(frontend.subLegos.ancestorsOf('settings.localization.rtl').map((unit) => unit.id), ['settings.localization', 'settings']);
  assert.deepEqual(frontend.subLegos.childrenOf('settings.localization').map((unit) => unit.id), ['settings.localization.rtl']);
  assert.equal(frontend.subLegos.list().length, 19, 'no unit appeared or disappeared');
  assert.equal(frontend.subLegos.depthOf('settings.localization.rtl'), 2);
});
