/**
 * Interaction semantics: call, event, stream, batch.
 *
 * The class belongs to the operation declaration, not to the transport, and not to
 * the route, the menu entry or the file layout. These tests pin the four classes,
 * the transport capability table, and the two refusals that keep the boundary
 * honest: a transport that cannot carry a class is never selected, and a caller may
 * not reshape an operation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_INTERACTION,
  INTERACTIONS,
  INTERACTION_CLASSES,
  INTERACTION_TRANSPORTS,
  InteractionError,
  canCarry,
  defineInteraction,
  describeInteractions,
  interactionOf,
  isInteractionClass,
  normaliseInteraction,
  resolveInteraction,
  transportsFor,
} from '../src/interactions.mjs';
import { TRANSPORT_KINDS, createOperationGateway, defineLocalTransport, defineTransport } from '../src/transport.mjs';
import { createFrontendLego } from '../src/lego.mjs';

test('exactly four interaction classes, each with declared semantics', () => {
  assert.deepEqual(INTERACTION_CLASSES, ['call', 'event', 'stream', 'batch']);
  assert.equal(DEFAULT_INTERACTION, 'call', 'an operation that declares nothing is a call, not a guess');
  for (const interaction of INTERACTIONS) {
    assert.ok(isInteractionClass(interaction.id));
    assert.equal(typeof interaction.expectsResponse, 'boolean');
    assert.equal(typeof interaction.incremental, 'boolean');
    assert.ok(['one', 'many'].includes(interaction.fanOut));
    assert.ok(interaction.envelopeFields.length > 0, `${interaction.id} names the envelope fields it uses`);
    assert.ok(interaction.example.length > 10, `${interaction.id} has an example from this repo`);
    assert.ok(interaction.failure.length > 10, `${interaction.id} declares what failure looks like`);
    assert.equal(interactionOf(interaction.id), interaction);
  }
  assert.equal(interactionOf('polling'), null);
  assert.equal(isInteractionClass('polling'), false);
  assert.equal(describeInteractions().classes, INTERACTION_CLASSES);
  assert.match(describeInteractions().rules.join(' '), /A caller may not reshape an operation/);
});

test('the transport table says what can carry what, and never by accident', () => {
  // A single request/response cannot carry an incremental sequence, and a
  // fire-and-forget shape cannot carry a call that waits for an answer.
  assert.equal(canCarry('call', 'rest'), true);
  assert.equal(canCarry('call', 'event'), false);
  assert.equal(canCarry('stream', 'rest'), false);
  assert.equal(canCarry('stream', 'stream'), true);
  assert.equal(canCarry('event', 'event'), true);
  assert.equal(canCarry('event', 'stream'), false);
  assert.equal(canCarry('batch', 'rest'), true);
  for (const interaction of INTERACTION_CLASSES) {
    assert.equal(canCarry(interaction, 'local'), true, `the direct call carries ${interaction}`);
    assert.equal(canCarry(interaction, 'ipc'), true, `declared future ipc carries ${interaction}`);
    for (const kind of INTERACTION_TRANSPORTS[interaction]) assert.ok(TRANSPORT_KINDS.includes(kind));
  }
  assert.equal(canCarry('call', 'telepathy'), false);
  assert.equal(canCarry('telepathy', 'rest'), false);
  assert.deepEqual(transportsFor('stream'), ['local', 'stream', 'ipc', 'remote']);
  assert.throws(() => transportsFor('telepathy'), /unknown interaction class/);
});

test('an operation declaration is validated, in both spellings', () => {
  assert.deepEqual(normaliseInteraction('workflow.list'), { operation: 'workflow.list', interaction: 'call' });
  assert.deepEqual(normaliseInteraction({ name: 'execution.watch', interaction: 'stream' }), { operation: 'execution.watch', interaction: 'stream' });
  assert.deepEqual(defineInteraction('workflow.list'), { operation: 'workflow.list', interaction: 'call' });
  assert.throws(() => defineInteraction('workflow.list', 'polling'), InteractionError);
  assert.throws(() => defineInteraction('workflow.list', 'polling'), /is not one of call, event, stream, batch/);
  assert.throws(() => normaliseInteraction(42), /must be an operation name/);
  assert.throws(() => normaliseInteraction(null), /must be an operation name/);
});

test('the declared class wins: a caller cannot reshape an operation', () => {
  assert.equal(resolveInteraction({ declared: null, requested: null, operation: 'x.y' }), 'call');
  assert.equal(resolveInteraction({ declared: 'stream', requested: null, operation: 'x.y' }), 'stream');
  assert.equal(resolveInteraction({ declared: 'stream', requested: 'stream', operation: 'x.y' }), 'stream');
  assert.throws(
    () => resolveInteraction({ declared: 'event', requested: 'call', operation: 'workflow.watch' }),
    (error) => {
      assert.equal(error.code, 'frontend.interaction.declaration-wins');
      assert.match(error.message, /a caller does not decide an operation's interaction class/);
      return true;
    },
  );
  assert.throws(() => resolveInteraction({ declared: 'nonsense' }), /unknown interaction class/);
  assert.throws(() => resolveInteraction({ declared: 'call', requested: 'nonsense' }), /was invoked as "nonsense"/);
});

test('the gateway never selects a transport that cannot carry the class', async () => {
  const eventBus = defineTransport({ id: 'event:bus', kind: 'event', cost: 0, invoke: async () => ({ fired: true }) });
  const rest = defineTransport({ id: 'rest:api', kind: 'rest', invoke: async () => ({ answered: true }) });
  const gateway = createOperationGateway({ transports: [eventBus, rest] });

  // A call waits for an answer: the (cheaper) event bus is not a candidate.
  const call = await gateway.invoke({ capability: 'workflow', operation: 'workflow.list', interaction: 'call' });
  assert.equal(call.transport, 'rest:api');
  assert.equal(call.interaction, 'call');
  assert.deepEqual(gateway.select({ capability: 'workflow', operation: 'workflow.list', interaction: 'call' }).options.map((t) => t.id), ['rest:api']);

  // An event does not wait: the bus may carry it, and it is cheaper.
  const event = await gateway.invoke({ capability: 'workflow', operation: 'workflow.watch', interaction: 'event' });
  assert.equal(event.transport, 'event:bus');
  assert.equal(event.interaction, 'event');

  // A stream has no candidate at all here, and that is reported, not worked around.
  await assert.rejects(
    () => gateway.invoke({ capability: 'execution', operation: 'execution.watch', interaction: 'stream' }),
    (error) => {
      assert.equal(error.code, 'frontend.transport.unsupported');
      assert.match(error.message, /as a "stream"/, 'the refusal names the class it could not carry');
      return true;
    },
  );
  // An unknown class is refused before any transport is considered.
  await assert.rejects(
    () => gateway.invoke({ capability: 'workflow', operation: 'workflow.list', interaction: 'polling' }),
    (error) => {
      assert.equal(error.code, 'frontend.transport.unknown-interaction');
      return true;
    },
  );
  // Pinning a transport that cannot carry the class is refused too.
  await assert.rejects(
    () => gateway.invoke({ capability: 'workflow', operation: 'workflow.list', interaction: 'call', transportId: 'event:bus' }),
    (error) => {
      assert.equal(error.code, 'frontend.transport.incompatible-interaction');
      return true;
    },
  );
});

test('an assembly reads the class from the registry and refuses to reshape it', async () => {
  const frontend = createFrontendLego({ app: { name: 'n8n-lego', version: '0.1.0' } });
  frontend.register({
    id: 'execution-view', lego: 'execution', title: 'Execution view', status: 'available',
    surfaces: ['executions'], contracts: ['contracts/frontend.contract.md'], tests: ['packages/execution-lego/test/*.test.mjs'],
    // Both spellings of the same declaration, plus a batch.
    operations: [{ name: 'execution.watch', interaction: 'stream' }, 'workflow.list'],
    interactions: { 'workflow.list': 'batch' },
  });
  frontend.registerOperation('execution.watch', async () => 'frames');

  assert.deepEqual(frontend.interactionOf('execution-view', 'execution.watch'), { capability: 'execution-view', operation: 'execution.watch', interaction: 'stream', declared: true, known: true });
  assert.deepEqual(frontend.interactionOf('execution-view', 'workflow.list'), { capability: 'execution-view', operation: 'workflow.list', interaction: 'batch', declared: true, known: true });
  assert.deepEqual(frontend.interactionOf('execution-view', 'workflow.missing'), { capability: 'execution-view', operation: 'workflow.missing', interaction: 'call', declared: false, known: false });
  assert.equal(frontend.interactionOf('not-a-capability', 'workflow.list').known, false);

  const result = await frontend.invoke({ capability: 'execution-view', operation: 'execution.watch' });
  assert.equal(result.interaction, 'stream', 'the declared class travels with the result');
  assert.equal(result.transport, 'local:direct');

  // The caller may restate the declared class, but never change it.
  await frontend.invoke({ capability: 'execution-view', operation: 'execution.watch', interaction: 'stream' });
  await assert.rejects(
    () => frontend.invoke({ capability: 'execution-view', operation: 'execution.watch', interaction: 'call' }),
    (error) => {
      assert.equal(error.code, 'frontend.interaction.declaration-wins');
      return true;
    },
  );
});

test('a contradictory declaration is refused at registration, not resolved silently', () => {
  const frontend = createFrontendLego({ app: { name: 'n8n-lego', version: '0.1.0' } });
  assert.throws(
    () => frontend.register({
      id: 'contradiction', lego: 'execution', title: 'Contradiction', status: 'available',
      surfaces: ['executions'], contracts: ['contracts/frontend.contract.md'], tests: ['packages/execution-lego/test/*.test.mjs'],
      operations: [{ name: 'execution.watch', interaction: 'stream' }],
      interactions: { 'execution.watch': 'call' },
    }),
    (error) => {
      assert.equal(error.code, 'frontend.registry.invalid-capability');
      assert.match(error.message, /not registrable/);
      assert.match(error.message, /is declared as "stream" inline and as "call" in "interactions" — one class per operation/);
      return true;
    },
  );
  // And an interaction class nobody defined is refused as well.
  assert.throws(
    () => frontend.register({
      id: 'unknown-class', lego: 'execution', title: 'Unknown class', status: 'available',
      surfaces: ['executions'], contracts: ['contracts/frontend.contract.md'], tests: ['packages/execution-lego/test/*.test.mjs'],
      operations: ['execution.watch'], interactions: { 'execution.watch': 'polling' },
    }),
    /declares interaction "polling"/,
  );
  // An operation declaration may not carry anything but a name and a class.
  assert.throws(
    () => frontend.register({
      id: 'smuggler', lego: 'execution', title: 'Smuggler', status: 'available',
      surfaces: ['executions'], contracts: ['contracts/frontend.contract.md'], tests: ['packages/execution-lego/test/*.test.mjs'],
      operations: [{ name: 'execution.watch', handler: () => {} }],
    }),
    /may declare only "name" and "interaction"/,
  );
});

test('the local transport carries every class without serializing anything', async () => {
  const seen = [];
  const gateway = createOperationGateway({
    transports: [defineLocalTransport({ handlers: { '*': async (context) => { seen.push(context.operation); return { operation: context.operation }; } } })],
  });
  for (const interaction of INTERACTION_CLASSES) {
    const result = await gateway.invoke({ capability: 'workflow', operation: `workflow.${interaction}`, interaction });
    assert.equal(result.interaction, interaction);
    assert.equal(result.serialization, 'none');
    assert.deepEqual(result.context.toTransportHints(), { headers: {}, query: {} });
  }
  assert.deepEqual(seen, INTERACTION_CLASSES.map((interaction) => `workflow.${interaction}`));
});
