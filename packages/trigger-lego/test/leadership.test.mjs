import assert from 'node:assert/strict';
import test from 'node:test';
import { ActiveWorkflowCoordinator } from '../src/index.mjs';

const workflow = (id, extra = {}) => ({ id, name: `Workflow ${id}`, active: true, ...extra });
const setup = ({ leader = true, ids = ['1'], rows, activate } = {}) => {
  const calls = { removed: 0, retries: [], errors: [], activations: [] };
  const repository = {
    async getAllActiveIds() { return ids; },
    async findById(id) { return rows && Object.hasOwn(rows, id) ? rows[id] : workflow(id); },
  };
  const coordinator = new ActiveWorkflowCoordinator({
    workflowRepository: repository,
    activeWorkflows: { async removeAllTriggerAndPollerBasedWorkflows() { calls.removed++; } },
    instanceSettings: { isLeader: leader },
    activate: activate ?? (async (item, mode, options) => { calls.activations.push({ item, mode, options }); return { webhooks: true, triggersAndPollers: options.addTriggersAndPollers }; }),
    queueRetry: (mode, item) => calls.retries.push([mode, item.id]),
    onActivationError: async (error, item) => calls.errors.push([error.message, item]),
  });
  return { coordinator, calls, repository };
};

test('webhook and trigger permissions reproduce leader/follower activation modes', () => {
  const leader = setup({ leader: true }).coordinator;
  for (const mode of ['init', 'leadershipChange', 'update', 'activate']) assert.equal(leader.shouldAddWebhooks(mode), true);
  assert.equal(leader.shouldAddTriggersAndPollers(), true);
  const follower = setup({ leader: false }).coordinator;
  assert.equal(follower.shouldAddWebhooks('init'), true);
  assert.equal(follower.shouldAddWebhooks('leadershipChange'), true);
  assert.equal(follower.shouldAddWebhooks('update'), false);
  assert.equal(follower.shouldAddWebhooks('activate'), false);
  assert.equal(follower.shouldAddTriggersAndPollers(), false);
});

test('active workflow startup is processed in bounded sequential batches', async () => {
  let active = 0; let peak = 0; const order = [];
  const { coordinator } = setup({ ids: ['1', '2', '3', '4', '5'], activate: async (item) => { active++; peak = Math.max(peak, active); order.push(item.id); await Promise.resolve(); active--; return { webhooks: true }; } });
  coordinator.activationBatchSize = 2;
  const result = await coordinator.addActiveWorkflows('init');
  assert.equal(peak, 2);
  assert.deepEqual(order, ['1', '2', '3', '4', '5']);
  assert.equal(result.activated.length, 5);
});

test('concurrent activation sweep is rejected while the first owns the lock', async () => {
  let release; const pending = new Promise((resolve) => { release = resolve; }); let reads = 0;
  const { coordinator, repository } = setup();
  repository.getAllActiveIds = async () => { reads++; await pending; return []; };
  const first = coordinator.addActiveWorkflows('init');
  const second = await coordinator.addActiveWorkflows('leadershipChange');
  assert.deepEqual(second, { skipped: true, activated: [] });
  assert.equal(reads, 1);
  release(); await first;
});

test('follower startup populates webhooks but never in-memory triggers', async () => {
  const { coordinator, calls } = setup({ leader: false });
  await coordinator.addActiveWorkflows('init');
  assert.deepEqual(calls.activations[0].options, { addWebhooks: true, addTriggersAndPollers: false, shouldPublish: false });
});

test('inactive and missing workflow rows are skipped', async () => {
  const { coordinator, calls } = setup({ ids: ['missing', 'off'], rows: { missing: undefined, off: workflow('off', { active: false }) } });
  const result = await coordinator.addActiveWorkflows('init');
  assert.equal(calls.activations.length, 0);
  assert.deepEqual(result.activated, []);
});

test('activation failure reports active-version data and queues retry', async () => {
  const row = workflow('1', { nodes: ['draft'], connections: { draft: true }, activeVersion: { nodes: ['live'], connections: { live: true } } });
  const { coordinator, calls } = setup({ rows: { 1: row }, activate: async () => { throw new Error('temporary'); } });
  const result = await coordinator.addActiveWorkflows('init');
  assert.equal(result.activated[0].error.message, 'temporary');
  assert.deepEqual(calls.retries, [['init', '1']]);
  assert.deepEqual(calls.errors[0][1].nodes, ['live']);
  assert.deepEqual(calls.errors[0][1].connections, { live: true });
});

test('authorization activation failures are never retried', async () => {
  const { coordinator, calls } = setup({ activate: async () => { throw new Error('Authorization failed'); } });
  await coordinator.addActiveWorkflows('init');
  assert.deepEqual(calls.retries, []);
  assert.equal(calls.errors.length, 1);
});

test('leader takeover activates and stepdown/shutdown remove in-memory triggers', async () => {
  const { coordinator, calls } = setup();
  const result = await coordinator.onLeaderTakeover();
  assert.equal(result.activated.length, 1);
  assert.equal(calls.activations[0].mode, 'leadershipChange');
  await coordinator.onLeaderStepdown();
  await coordinator.onShutdown();
  assert.equal(calls.removed, 2);
});
