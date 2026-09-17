import assert from 'node:assert/strict';
import test from 'node:test';
import { ActiveWorkflowPubSubRouter } from '../src/index.mjs';

const setup = ({ activate = async () => {}, clearWebhooks = async () => {} } = {}) => {
  const calls = { commands: [], pushes: [], removed: [], inactive: [], errors: [], activationErrors: [] };
  const router = new ActiveWorkflowPubSubRouter({
    publisher: { async publishCommand(command) { calls.commands.push(command); } },
    activate,
    clearWebhooks,
    async removeTriggersAndPollers(id) { calls.removed.push(id); },
    async updateInactive(id, patch) { calls.inactive.push([id, patch]); },
    async removeActivationError(id) { calls.activationErrors.push(id); },
    push: { broadcast(message) { calls.pushes.push(message); } },
    errorReporter: { error(error) { calls.errors.push(error); } },
  });
  return { router, calls };
};

test('activation request requires and publishes the persisted active version', async () => {
  const { router, calls } = setup();
  await assert.rejects(() => router.requestActivation({ id: '1' }), /Active version ID not found/);
  assert.deepEqual(await router.requestActivation({ id: '1', activeVersionId: 'v2' }), { webhooks: false, triggersAndPollers: false });
  assert.deepEqual(calls.commands[0], { command: 'add-webhooks-triggers-and-pollers', payload: { workflowId: '1', activeVersionId: 'v2' } });
});

test('leader activation suppresses republishing and broadcasts success to every main', async () => {
  const activations = []; const { router, calls } = setup({ activate: async (...args) => activations.push(args) });
  assert.deepEqual(await router.handleAddWebhooksTriggersAndPollers({ workflowId: '1', activeVersionId: 'v2' }), { activated: true });
  assert.deepEqual(activations, [['1', 'activate', { shouldPublish: false }]]);
  assert.deepEqual(calls.pushes[0], { type: 'workflowActivated', data: { workflowId: '1', activeVersionId: 'v2' } });
  assert.equal(calls.commands[0].command, 'display-workflow-activation');
});

test('leader activation failure makes workflow inactive and broadcasts the error', async () => {
  const { router, calls } = setup({ activate: async () => { throw new Error('cannot start'); } });
  const result = await router.handleAddWebhooksTriggersAndPollers({ workflowId: '1', activeVersionId: 'v2' });
  assert.equal(result.activated, false); assert.equal(result.error.message, 'cannot start');
  assert.deepEqual(calls.inactive, [['1', { active: false, activeVersionId: null }]]);
  assert.deepEqual(calls.pushes[0], { type: 'workflowFailedToActivate', data: { workflowId: '1', errorMessage: 'cannot start' } });
  assert.equal(calls.commands[0].command, 'display-workflow-activation-error');
});

test('deactivation clears local webhooks then delegates leader teardown and follower display', async () => {
  const cleared = []; const { router, calls } = setup({ clearWebhooks: async (id) => cleared.push(id) });
  await router.requestDeactivation('1');
  assert.deepEqual(cleared, ['1']); assert.equal(calls.commands[0].command, 'remove-triggers-and-pollers');
  await router.handleRemoveTriggersAndPollers({ workflowId: '1' });
  assert.deepEqual(calls.activationErrors, ['1']); assert.deepEqual(calls.removed, ['1']);
  assert.deepEqual(calls.pushes[0], { type: 'workflowDeactivated', data: { workflowId: '1' } });
  assert.equal(calls.commands[1].command, 'display-workflow-deactivation');
});

test('deactivation still publishes when local webhook cleanup fails', async () => {
  const failure = new Error('cleanup failed'); const { router, calls } = setup({ clearWebhooks: async () => { throw failure; } });
  await router.requestDeactivation('1');
  assert.deepEqual(calls.errors, [failure]); assert.equal(calls.commands[0].command, 'remove-triggers-and-pollers');
});

test('router descriptors keep mutations leader-only and displays on all mains', () => {
  const names = setup().router.getHandlers();
  assert.equal(names.length, 5);
  assert.deepEqual(names.slice(0, 2).map(({ filter }) => filter), [
    { instanceType: 'main', instanceRole: 'leader' },
    { instanceType: 'main', instanceRole: 'leader' },
  ]);
  assert.ok(names.slice(2).every(({ filter }) => filter.instanceType === 'main' && !filter.instanceRole));
});
