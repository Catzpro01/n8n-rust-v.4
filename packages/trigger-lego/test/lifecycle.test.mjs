import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ActiveWorkflows,
  ScheduledTaskManager,
  TriggerCloseError,
  WorkflowActivationError,
  WorkflowDeactivationError,
} from '../src/index.mjs';

function workflow({ id = 'wf', triggers = [], polls = [], types = {} } = {}) {
  return {
    id, name: id, timezone: 'UTC',
    nodeTypes: { getByNameAndVersion: (type) => types[type] },
    getTriggerNodes: () => triggers,
    getPollNodes: () => polls,
  };
}

const triggerFunctions = (emitted = []) => () => ({
  emit: (data) => emitted.push(data), emitError() {}, saveFailedExecution() {},
});
const pollFunctions = (pollTimes, emitted = [], errors = []) => () => ({
  getNodeParameter: () => pollTimes,
  __emit: (data) => emitted.push(data),
  __emitError: (error) => errors.push(error),
});

test('registers, emits, closes, and removes a trigger workflow', async () => {
  const events = [];
  const emitted = [];
  let context;
  const node = { id: 't1', name: 'Trigger', type: 'trigger' };
  const wf = workflow({ triggers: [node], types: { trigger: {
    async trigger() { context = this; events.push('open'); return { closeFunction: async () => events.push('close') }; },
  } } });
  const active = new ActiveWorkflows();

  await active.add(wf.id, wf, {}, 'trigger', 'activate', triggerFunctions(emitted), () => ({}));
  assert.equal(active.isActive('wf'), true);
  assert.deepEqual(active.allActiveWorkflows(), ['wf']);
  context.emit([[{ json: { fired: true } }]]);
  assert.equal(emitted[0][0][0].json.fired, true);
  assert.equal(await active.remove('wf'), true);
  assert.deepEqual(events, ['open', 'close']);
  assert.equal(await active.remove('wf'), false);
});

test('wraps activation failures with the exact reference message and node', async () => {
  const node = { id: 'bad', name: 'Bad', type: 'bad' };
  const wf = workflow({ triggers: [node], types: { bad: { async trigger() { throw new Error('boom'); } } } });
  const active = new ActiveWorkflows();
  await assert.rejects(
    () => active.add('wf', wf, {}, 'trigger', 'activate', triggerFunctions(), () => ({})),
    (error) => error instanceof WorkflowActivationError &&
      error.message === 'There was a problem activating the workflow: "boom"' && error.node === node,
  );
  assert.equal(active.isActive('wf'), false);
});

test('reports a missing trigger function through activation error', async () => {
  const node = { id: 'plain', name: 'Plain', type: 'plain' };
  const wf = workflow({ triggers: [node], types: { plain: {} } });
  const active = new ActiveWorkflows();
  await assert.rejects(
    () => active.add('wf', wf, {}, 'trigger', 'activate', triggerFunctions(), () => ({})),
    /There was a problem activating the workflow: "Node type does not have a trigger function defined"/,
  );
});

test('manual activation resolves on first emit and wires response hooks', async () => {
  let context;
  const handlers = new Map();
  const node = { id: 't', name: 'T', type: 'trigger' };
  const wf = workflow({ triggers: [node], types: { trigger: {
    async trigger() { context = this; return {}; },
  } } });
  const active = new ActiveWorkflows();
  await active.add('wf', wf, { hooks: { addHandler: (name, fn) => handlers.set(name, fn) } }, 'manual', 'manual', triggerFunctions(), () => ({}));
  const response = active.get('wf').triggerResponses[0].manualTriggerResponse;
  const responsePromise = { resolve() {} };
  context.emit([[{ json: { manual: true } }]], responsePromise);
  assert.equal((await response)[0][0].json.manual, true);
  assert.equal(typeof handlers.get('sendResponse'), 'function');
});

test('poll activation executes immediately, emits data, and registers cron', async () => {
  const emitted = [];
  let polls = 0;
  const node = { id: 'p', name: 'Poll', type: 'poll' };
  const wf = workflow({ polls: [node], types: { poll: {
    async poll() { polls += 1; return [[{ json: { poll: polls } }]]; },
  } } });
  const scheduled = new ScheduledTaskManager();
  const active = new ActiveWorkflows({ scheduledTaskManager: scheduled });
  await active.add('wf', wf, {}, 'trigger', 'activate', triggerFunctions(), pollFunctions({ item: [{ mode: 'everyHour', minute: 5 }] }, emitted));
  assert.equal(polls, 1);
  assert.equal(emitted[0][0][0].json.poll, 1);
  assert.equal(scheduled.cronsByWorkflow.get('wf').size, 1);
  await active.remove('wf');
  assert.equal(scheduled.cronsByWorkflow.has('wf'), false);
});

test('rejects sub-minute polling and removes poll-only workflow registration', async () => {
  const node = { id: 'p', name: 'Poll', type: 'poll' };
  const wf = workflow({ polls: [node], types: { poll: { async poll() { return null; } } } });
  const active = new ActiveWorkflows();
  await assert.rejects(
    () => active.add('wf', wf, {}, 'trigger', 'activate', triggerFunctions(), pollFunctions({ item: [{ mode: 'custom', cronExpression: '* * * * * *' }] })),
    /The polling interval is too short\. It has to be at least a minute\./,
  );
  assert.equal(active.isActive('wf'), false);
});

test('scheduled ticks run only while the host is leader and duplicates are ignored', async () => {
  let leader = false;
  let tick;
  let duplicate = 0;
  let calls = 0;
  const manager = new ScheduledTaskManager({
    isLeader: () => leader,
    registerJob: (_ctx, fn) => { tick = fn; return { stop() {} }; },
    onDuplicate: () => duplicate++,
  });
  const context = { workflowId: 'wf', nodeId: 'n', expression: '0 * * * * *', timezone: 'UTC' };
  assert.equal(manager.registerCron(context, () => calls++), true);
  assert.equal(manager.registerCron(context, () => calls++), false);
  tick();
  leader = true;
  tick();
  assert.equal(calls, 1);
  assert.equal(duplicate, 1);
});

test('close errors follow hard and soft deactivation paths', async () => {
  const node = { id: 't', name: 'T', type: 'trigger' };
  const hard = workflow({ triggers: [node], types: { trigger: { async trigger() {
    return { closeFunction: async () => { throw new Error('close failed'); } };
  } } } });
  const active = new ActiveWorkflows();
  await active.add('wf', hard, {}, 'trigger', 'activate', triggerFunctions(), () => ({}));
  await assert.rejects(() => active.remove('wf'), WorkflowDeactivationError);

  const reports = [];
  const soft = workflow({ id: 'soft', triggers: [node], types: { trigger: { async trigger() {
    return { closeFunction: async () => { throw new TriggerCloseError('soft', { node }); } };
  } } } });
  const activeSoft = new ActiveWorkflows({ errorReporter: { error: (...args) => reports.push(args) } });
  await activeSoft.add('soft', soft, {}, 'trigger', 'activate', triggerFunctions(), () => ({}));
  assert.equal(await activeSoft.remove('soft'), true);
  assert.equal(reports.length, 1);
});

test('disabled trigger and poll nodes are never registered', async () => {
  const disabledTrigger = { id: 't', name: 'T', type: 'trigger', disabled: true };
  const disabledPoll = { id: 'p', name: 'P', type: 'poll', disabled: true };
  const wf = workflow({ triggers: [disabledTrigger], polls: [disabledPoll], types: {
    trigger: { async trigger() { throw new Error('must not run'); } },
    poll: { async poll() { throw new Error('must not run'); } },
  } });
  const active = new ActiveWorkflows();
  await active.add('wf', wf, {}, 'trigger', 'activate', triggerFunctions(), pollFunctions({ item: [] }));
  assert.equal(active.isActive('wf'), true);
  assert.deepEqual(active.get('wf').triggerResponses, []);
});
