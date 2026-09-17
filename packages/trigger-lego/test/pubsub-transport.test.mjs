import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PubSubEventBus,
  PubSubPublisher,
  PubSubRegistry,
  PubSubSubscriber,
} from '../src/index.mjs';

class FakeClient {
  constructor() { this.calls = []; this.listeners = new Map(); this.disconnected = false; }
  on(event, handler) { this.listeners.set(event, handler); }
  async publish(...args) { this.calls.push(['publish', ...args]); }
  async subscribe(...args) { this.calls.push(['subscribe', ...args]); args.at(-1)?.(); }
  disconnect() { this.disconnected = true; }
  message(channel, value) { this.listeners.get('message')?.(channel, value); }
}
const factory = () => { const client = new FakeClient(); return { client, create: () => client }; };
const command = (overrides = {}) => JSON.stringify({ command: 'reload-license', senderId: 'remote', debounce: false, ...overrides });

test('publisher uses deployment prefix and reference command metadata', async () => {
  const { client, create } = factory();
  const publisher = new PubSubPublisher({ clientFactory: create, hostId: 'main-a', prefix: 'tenant' });
  await publisher.publishCommand({ command: 'reload-license' });
  assert.equal(client.calls[0][1], 'tenant:n8n.commands');
  assert.deepEqual(JSON.parse(client.calls[0][2]), { command: 'reload-license', senderId: 'main-a', selfSend: false, debounce: true });
});

test('activation and deactivation commands self-send without debounce', async () => {
  const { client, create } = factory();
  const publisher = new PubSubPublisher({ clientFactory: create, hostId: 'main-a' });
  for (const name of ['add-webhooks-triggers-and-pollers', 'remove-triggers-and-pollers']) await publisher.publishCommand({ command: name, payload: { workflowId: '1' } });
  for (const call of client.calls) assert.deepEqual(Object.fromEntries(Object.entries(JSON.parse(call[2])).filter(([key]) => ['selfSend', 'debounce'].includes(key))), { selfSend: true, debounce: false });
});

test('regular mode creates no client and publishing is a no-op', async () => {
  let creates = 0;
  const publisher = new PubSubPublisher({ clientFactory: () => { creates++; }, hostId: 'main-a', mode: 'regular' });
  await publisher.publishCommand({ command: 'reload-license' });
  assert.equal(creates, 0);
  assert.equal(publisher.getClient(), undefined);
});

test('subscriber applies prefix, routes immediate payloads, and disconnects', async () => {
  const { client, create } = factory(); const bus = new PubSubEventBus(); const received = [];
  bus.on('remove-triggers-and-pollers', (payload) => received.push(payload));
  const subscriber = new PubSubSubscriber({ clientFactory: create, eventBus: bus, hostId: 'main-a', prefix: 'tenant' });
  await subscriber.subscribe();
  client.message('tenant:n8n.commands', command({ command: 'remove-triggers-and-pollers', selfSend: true, payload: { workflowId: '1' } }));
  assert.equal(client.calls[0][1], 'tenant:n8n.commands');
  assert.deepEqual(received, [{ workflowId: '1' }]);
  subscriber.shutdown(); assert.equal(client.disconnected, true);
});

test('subscriber rejects malformed, same-sender, and non-targeted commands', () => {
  const { client, create } = factory(); const bus = new PubSubEventBus(); let received = 0;
  bus.on('reload-license', () => received++);
  new PubSubSubscriber({ clientFactory: create, eventBus: bus, hostId: 'main-a' });
  client.message('n8n:n8n.commands', '{');
  client.message('n8n:n8n.commands', command({ senderId: 'main-a' }));
  client.message('n8n:n8n.commands', command({ targets: ['main-b'] }));
  assert.equal(received, 0);
});

test('self-send and explicitly targeted commands pass subscriber filters', () => {
  const { client, create } = factory(); const bus = new PubSubEventBus(); const received = [];
  bus.on('reload-license', (payload) => received.push(payload));
  new PubSubSubscriber({ clientFactory: create, eventBus: bus, hostId: 'main-a' });
  client.message('n8n:n8n.commands', command({ senderId: 'main-a', selfSend: true, payload: 1 }));
  client.message('n8n:n8n.commands', command({ targets: ['main-a'], payload: 2 }));
  assert.deepEqual(received, [1, 2]);
});

test('subscriber coalesces debounced bursts to the latest command', async () => {
  const { client, create } = factory(); const bus = new PubSubEventBus(); const received = [];
  bus.on('reload-license', (payload) => received.push(payload));
  new PubSubSubscriber({ clientFactory: create, eventBus: bus, hostId: 'main-a', debounceMs: 5 });
  client.message('n8n:n8n.commands', command({ debounce: true, payload: 1 }));
  client.message('n8n:n8n.commands', command({ debounce: true, payload: 2 }));
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(received, [2]);
});

test('registry filters instance type, follows dynamic roles, and reinitializes without duplicates', async () => {
  const bus = new PubSubEventBus(); const settings = { instanceType: 'main', instanceRole: 'follower' }; let leaderCalls = 0; let allCalls = 0;
  const registry = new PubSubRegistry({ eventBus: bus, instanceSettings: settings, handlers: [
    { eventName: 'activate', filter: { instanceType: 'main', instanceRole: 'leader' }, handler: async () => { leaderCalls++; } },
    { eventName: 'display', filter: { instanceType: 'main' }, handler: async () => { allCalls++; } },
    { eventName: 'worker-only', filter: { instanceType: 'worker' }, handler: async () => { throw new Error('must not register'); } },
  ] });
  registry.init(); registry.init();
  bus.emit('activate'); bus.emit('display'); await Promise.resolve();
  assert.deepEqual([leaderCalls, allCalls], [0, 1]);
  settings.instanceRole = 'leader'; bus.emit('activate'); await Promise.resolve();
  assert.equal(leaderCalls, 1);
  registry.shutdown(); bus.emit('display'); await Promise.resolve();
  assert.equal(allCalls, 1);
});
