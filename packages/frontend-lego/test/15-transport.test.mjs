/**
 * Transport neutrality.
 *
 * A business contract names an operation; it never names a transport. These tests
 * pin the two properties that make that real: a same-process call is direct with no
 * serialization, and nothing is ever routed implicitly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  NoTransportError,
  SERIALIZATION,
  TRANSPORT_COSTS,
  TRANSPORT_KINDS,
  TransportError,
  createOperationGateway,
  declaredFutureTransports,
  defineLocalTransport,
  defineTransport,
  describeTransports,
} from '../src/transport.mjs';
import { PACKAGE_ROOT } from '../src/manifests.mjs';
import { createFrontendLego } from '../src/lego.mjs';

test('the transport vocabulary is declared, including the kinds not implemented yet', () => {
  assert.deepEqual(TRANSPORT_KINDS, ['local', 'rest', 'event', 'stream', 'ipc', 'remote']);
  assert.deepEqual(SERIALIZATION, ['none', 'json', 'binary', 'stream']);
  assert.equal(TRANSPORT_COSTS.local, 0, 'a same-process call is the cheapest possible');
  assert.ok(TRANSPORT_COSTS.remote > TRANSPORT_COSTS.rest);
  const futures = declaredFutureTransports();
  assert.equal(futures.length, 4);
  for (const transport of futures) {
    assert.equal(transport.implemented, false, 'a declared future transport is never usable');
    assert.equal(typeof transport.notes, 'string');
  }
  const model = describeTransports();
  assert.match(model.rules.join(' '), /never name a transport/);
  assert.match(model.rules.join(' '), /No HTTP between local modules/);
});

test('the cheapest capable transport wins, and the local one serializes nothing', async () => {
  const calls = [];
  const gateway = createOperationGateway({
    transports: [
      defineTransport({ id: 'rest:api', kind: 'rest', serialization: 'json', invoke: async () => { calls.push('rest'); return { via: 'rest' }; } }),
      defineLocalTransport({ handlers: { 'workflow.list': async () => { calls.push('local'); return { via: 'local' }; } } }),
    ],
  });
  const result = await gateway.invoke({ capability: 'workflow', operation: 'workflow.list' });
  assert.deepEqual(calls, ['local'], 'the same-process transport is chosen over REST');
  assert.equal(result.transport, 'local:direct');
  assert.equal(result.kind, 'local');
  assert.equal(result.serialization, 'none', 'no serialization for a local call');
  assert.deepEqual(result.context.toTransportHints(), { headers: {}, query: {} }, 'no envelope is serialized locally');
  assert.equal(result.record.outcome, 'ok');
  assert.equal(gateway.select({ capability: 'workflow', operation: 'workflow.list' }).options.length, 2, 'both were candidates');
});

test('each transport declares what it can carry; nothing is routed implicitly', async () => {
  const gateway = createOperationGateway({
    transports: [defineLocalTransport({ handlers: { 'workflow.list': async () => [] } })],
  });
  await assert.rejects(
    () => gateway.invoke({ capability: 'workflow', operation: 'workflow.delete' }),
    (error) => {
      // The local transport carries exactly the operations it has handlers for, so an
      // operation it cannot serve is refused rather than silently retried elsewhere.
      assert.ok(error instanceof NoTransportError);
      assert.equal(error.code, 'frontend.transport.unsupported');
      return true;
    },
  );

  const narrow = createOperationGateway({
    transports: [defineTransport({ id: 'rest:only-settings', kind: 'rest', operations: ['settings.update'], capabilities: ['settings'], invoke: async () => ({ ok: true }) })],
  });
  await assert.rejects(
    () => narrow.invoke({ capability: 'workflow', operation: 'workflow.list' }),
    (error) => {
      assert.ok(error instanceof NoTransportError, 'an operation no transport can carry is refused, not rerouted');
      assert.equal(error.code, 'frontend.transport.unsupported');
      assert.deepEqual(error.considered, ['rest:only-settings']);
      assert.match(error.message, /refused rather than routed somewhere slower/);
      return true;
    },
  );
  // A capability filter is respected too.
  await assert.rejects(() => narrow.invoke({ capability: 'settings', operation: 'workflow.list' }), NoTransportError);
  const fine = await narrow.invoke({ capability: 'settings', operation: 'settings.update', kind: 'command', idempotencyKey: 'k1' });
  assert.equal(fine.ok, true);
});

test('declaring a transport is validated: a kind, a serialization and a real invoke', () => {
  assert.throws(() => defineTransport({ id: 'x', kind: 'telepathy' }), /unknown kind/);
  assert.throws(() => defineTransport({ id: 'x', kind: 'rest', serialization: 'quantum' }), /unknown serialization/);
  assert.throws(() => defineTransport({ id: 'x', kind: 'rest' }), /implemented but has no invoke/);
  assert.throws(() => defineTransport({ id: '', kind: 'rest', invoke: () => {} }), /needs an id/);
  // A declared-but-unimplemented transport needs no invoke.
  const future = defineTransport({ id: 'future:thing', kind: 'event', implemented: false });
  assert.equal(future.implemented, false);
  assert.equal(future.canCarry('anything.at.all'), true);
});

test('fire-and-forget shapes are not selected for request/response operations', async () => {
  const gateway = createOperationGateway({
    transports: [
      defineTransport({ id: 'event:bus', kind: 'event', cost: 1, invoke: async () => ({ fired: true }) }),
      defineTransport({ id: 'rest:api', kind: 'rest', invoke: async () => ({ answered: true }) }),
    ],
  });
  const result = await gateway.invoke({ capability: 'workflow', operation: 'workflow.list' });
  assert.equal(result.transport, 'rest:api', 'a query is not delivered through a fire-and-forget shape');
  assert.equal(gateway.describe().implemented.length, 2);
  assert.equal(gateway.transportOf('event:bus').kind, 'event');
  assert.equal(gateway.transportOf('nope'), null);
});

test('a rejected operation is observable and the envelope still carries identity', async () => {
  const seen = [];
  const gateway = createOperationGateway({
    transports: [defineLocalTransport({ handlers: { '*': async () => { throw Object.assign(new Error('nope'), { code: 'workflow.not_found' }); } } })],
    observability: { emit: (id, fields) => seen.push({ id, fields }), tryEmit: () => null },
  });
  await assert.rejects(() => gateway.invoke({ capability: 'workflow', operation: 'workflow.get' }), /nope/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].id, 'frontend.operation.rejected');
  assert.equal(seen[0].fields.code, 'workflow.not_found');
  assert.equal(seen[0].fields.operation, 'workflow.get');
  assert.equal(JSON.stringify(seen[0]).includes('token'), false, 'no credential fields in a boundary event');
});

test('the assembly exposes delivery without exposing a transport assumption', async () => {
  const lego = createFrontendLego({ app: { name: 'n8n-lego', version: '0.1.0' } });
  assert.deepEqual(lego.describeTransports().implemented, ['local:direct']);
  assert.deepEqual(lego.describeTransports().declared, [], 'no future transport is registered by default');
  lego.registerOperation('settings.read', async (context) => ({ identity: context.identity }));
  const result = await lego.invoke({ capability: 'settings', operation: 'settings.read' });
  assert.equal(result.value.identity, 'settings:settings.read@1.0.0');
  assert.equal(result.serialization, 'none');
  assert.throws(() => lego.registerOperation('settings.read', 'not a function'), /needs a name and a function/);

  // The REST client that already exists is the compatibility boundary — not a
  // transport the LEGO imposes on local operations.
  const source = readFileSync(join(PACKAGE_ROOT, 'src', 'transport.mjs'), 'utf8');
  assert.equal(/fetch\(/.test(source), false, 'the transport layer performs no HTTP itself');
  assert.equal(/from 'node:/.test(source), false, 'and it stays browser-safe (no node:* import)');
  await assert.rejects(
    () => lego.invoke({ capability: 'settings', operation: 'settings.missing' }),
    /no transport can carry/,
  );
});
