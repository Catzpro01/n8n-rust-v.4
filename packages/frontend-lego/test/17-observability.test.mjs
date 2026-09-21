/**
 * Boundary observability: a small vocabulary, no telemetry framework.
 *
 * Events are how a future observability system (or a human reading the evidence)
 * learns what happened at the architecture boundary — a capability registered or
 * rejected, a lifecycle transition, an upgrade refused, an operation rejected.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EVENT_FIELDS,
  EVENT_NAMES,
  FRONTEND_EVENTS,
  ObservabilityError,
  createBufferSink,
  createObservability,
  describeObservability,
} from '../src/observability.mjs';
import { createFrontendLego } from '../src/lego.mjs';
import { defineLocalTransport, createOperationGateway } from '../src/transport.mjs';

test('the vocabulary is declared, stable and closed', () => {
  const required = [
    'CAPABILITY_REGISTERED', 'CAPABILITY_REJECTED', 'CAPABILITY_DEGRADED',
    'LIFECYCLE_TRANSITION', 'CONTRACT_MISMATCH',
    'UNIT_REGISTERED', 'UNIT_REJECTED', 'UPGRADE_APPLIED', 'UPGRADE_REJECTED', 'DOWNGRADE_REJECTED',
    'REPLACEMENT_APPLIED', 'REPLACEMENT_REJECTED',
    'OPERATION_COMPLETED', 'OPERATION_REJECTED', 'NEGOTIATION_DECIDED',
  ];
  for (const name of required) assert.ok(FRONTEND_EVENTS[name], `${name} is declared`);
  assert.equal(EVENT_NAMES.length, Object.keys(FRONTEND_EVENTS).length);
  for (const name of EVENT_NAMES) assert.match(name, /^frontend\.[a-z.-]+$/, `${name} is a semantic id`);
  assert.deepEqual(EVENT_FIELDS, ['id', 'at', 'sequence', 'lego', 'subLego', 'capability', 'operation', 'details']);
  assert.equal(describeObservability().events.length, EVENT_NAMES.length);
});

test('an undeclared event id is refused instead of polluting the stream', () => {
  const events = createObservability();
  assert.throws(() => events.emit('frontend.something.else'), (error) => {
    assert.ok(error instanceof ObservabilityError);
    assert.equal(error.code, 'frontend.observability.invalid-event');
    assert.match(error.message, /not a declared frontend event/);
    return true;
  });
  // The non-throwing variant exists for call sites that cannot afford to throw.
  assert.equal(events.tryEmit('frontend.something.else'), null);
  assert.equal(events.stats().emitted, 0);
});

test('session data never reaches an event: the sink receives identity, not payload', () => {
  const events = createObservability();
  for (const forbidden of ['payload', 'token', 'authorization', 'subject', 'scopes', 'cookie', 'content']) {
    assert.throws(
      () => events.emit(FRONTEND_EVENTS.OPERATION_COMPLETED, { capability: 'workflow', operation: 'workflow.list', [forbidden]: 'x' }),
      (error) => {
        assert.equal(error.code, 'frontend.observability.invalid-event');
        assert.match(error.message, /belong to the session, not to telemetry/);
        return true;
      },
    );
  }
  const event = events.emit(FRONTEND_EVENTS.OPERATION_COMPLETED, { capability: 'workflow', operation: 'workflow.list', transport: 'local:direct', outcome: 'ok' });
  assert.equal(event.lego, 'ui-frontend');
  assert.equal(event.capability, 'workflow');
  assert.equal(event.operation, 'workflow.list');
  assert.match(event.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(event.sequence, 1);
  assert.equal(JSON.stringify(event).includes('token'), false);
});

test('the buffer is bounded and a broken sink never breaks the caller', () => {
  const events = createObservability({ limit: 3 });
  for (let index = 0; index < 5; index += 1) {
    events.emit(FRONTEND_EVENTS.LIFECYCLE_TRANSITION, { subLego: 'settings.general', from: 'declared', to: 'available' });
  }
  assert.equal(events.events().length, 3, 'the buffer keeps the newest events');
  assert.deepEqual(events.stats(), { emitted: 5, kept: 3, dropped: 2, sinkErrors: 0, limit: 3 });
  assert.equal(events.counts()['frontend.lifecycle.transition'], 3);

  const exploding = createObservability({ sink: () => { throw new Error('consumer is down'); } });
  const event = exploding.emit(FRONTEND_EVENTS.UNIT_REGISTERED, { subLego: 'settings' });
  assert.ok(event, 'the emit still returns the event');
  assert.equal(exploding.stats().sinkErrors, 1, 'the failure is counted, not propagated');

  const buffer = createBufferSink();
  const wired = createObservability({ sink: buffer.sink });
  wired.emit(FRONTEND_EVENTS.UPGRADE_APPLIED, { subLego: 'settings.general', from: '1.0.0', to: '1.0.1' });
  assert.equal(buffer.events().length, 1);
  assert.equal(describeObservability().rules.length, 7);
  assert.equal(Object.keys(describeObservability().families).length, 6, 'the vocabulary is grouped by family');
  for (const family of Object.values(describeObservability().families)) {
    for (const id of family) assert.ok(EVENT_NAMES.includes(id), `${id} is a declared event`);
  }
  assert.deepEqual(Object.values(describeObservability().families).flat().sort(), [...EVENT_NAMES].sort(), 'every event belongs to exactly one family');
});

test('the registries emit as they actually work', () => {
  const events = createObservability();
  const frontend = createFrontendLego({ app: { name: 'n8n-lego', version: '0.1.0' }, observability: events });
  const counts = events.counts();
  assert.equal(counts['frontend.unit.registered'], 19, 'every declared unit announces itself');
  assert.equal(counts['frontend.lifecycle.transition'], 19, 'and its starting lifecycle state');
  assert.equal(counts['frontend.capability.registered'], undefined, 'no capability is registered at boot');

  frontend.register({
    id: 'search', lego: 'search', title: 'Search', status: 'declared',
    surfaces: ['node-picker'], contracts: ['contracts/frontend.contract.md'], tests: ['packages/search-lego/test/*.test.mjs'],
    criticality: 'optional', degradation: { fallback: 'native-behavior' },
  });
  assert.equal(events.counts()['frontend.capability.registered'], 1);
  assert.equal(events.counts()['frontend.capability.degraded'], 1, 'a declared fallback is an observable decision');

  assert.throws(() => frontend.register({ id: 'bad' }), /not registrable/);
  assert.equal(events.counts()['frontend.capability.rejected'], 1);

  frontend.subLegos.upgrade('settings.general', { version: '1.0.1' });
  assert.equal(events.counts()['frontend.upgrade.applied'], 1);
  assert.throws(() => frontend.subLegos.upgrade('settings.general', { version: '0.9.0' }), /blocked/);
  assert.equal(events.counts()['frontend.upgrade.downgrade-rejected'], 1, 'a downgrade is a distinct event');
  assert.throws(() => frontend.registerSubLego({ ...frontend.manifests.subLegos[0] }), /already registered/);
  assert.equal(events.counts()['frontend.unit.rejected'], 1);
});

test('an operation outcome is observable at the boundary and nowhere deeper', async () => {
  const events = createObservability();
  const gateway = createOperationGateway({
    transports: [defineLocalTransport({ handlers: { 'workflow.list': async () => ['a'] } })],
    observability: events,
  });
  await gateway.invoke({ capability: 'workflow', operation: 'workflow.list' });
  const completed = events.recent(1)[0];
  assert.equal(completed.id, FRONTEND_EVENTS.OPERATION_COMPLETED);
  assert.equal(completed.capability, 'workflow');
  assert.equal(completed.operation, 'workflow.list');
  assert.equal(completed.details.transport, 'local:direct');
  assert.equal(typeof completed.details.durationMs, 'number');
  assert.equal(JSON.stringify(completed).length < 400, true, 'a boundary event stays small');
});
