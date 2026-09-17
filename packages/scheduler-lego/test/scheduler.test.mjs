import assert from 'node:assert/strict';
import test from 'node:test';
import { getSchedulingFunctions, ScheduledTaskManager, toCronExpression, toCronKey } from '../src/index.mjs';

const ctx = (overrides = {}) => ({ workflowId: 'wf', nodeId: 'node', timezone: 'UTC', expression: '0 * * * * *', ...overrides });

test('converts every TriggerTime mode with injectable random fields', () => {
  const random = () => 7;
  assert.equal(toCronExpression({ mode: 'everyMinute' }, random), '7 * * * * *');
  assert.equal(toCronExpression({ mode: 'everyHour', minute: 5 }, random), '7 5 * * * *');
  assert.equal(toCronExpression({ mode: 'everyX', unit: 'minutes', value: 10 }, random), '7 */10 * * * *');
  assert.equal(toCronExpression({ mode: 'everyX', unit: 'hours', value: 2 }, random), '7 7 */2 * * *');
  assert.equal(toCronExpression({ mode: 'everyDay', hour: 14, minute: 30 }, random), '7 30 14 * * *');
  assert.equal(toCronExpression({ mode: 'everyWeek', hour: 1, minute: 2, weekday: 3 }, random), '7 2 1 * * 3');
  assert.equal(toCronExpression({ mode: 'everyMonth', hour: 1, minute: 2, dayOfMonth: 15 }, random), '7 2 1 15 * *');
  assert.equal(toCronExpression({ mode: 'custom', cronExpression: ' 0 * * * * ' }, random), '0 * * * *');
});

test('cron key is stable across property order and flattens active recurrence', () => {
  const a = ctx({ recurrence: { activated: true, index: 1, intervalSize: 2, typeInterval: 'weeks' } });
  const b = { expression: a.expression, recurrence: a.recurrence, timezone: 'UTC', nodeId: 'node', workflowId: 'wf' };
  assert.equal(toCronKey(a), toCronKey(b));
  assert.match(toCronKey(a), /recurrenceIntervalSize/);
  assert.doesNotMatch(toCronKey(a), /"recurrence":/);
});

test('registers a job, fires only as leader, and preserves timezone context', () => {
  let leader = false;
  let tick;
  let calls = 0;
  let receivedContext;
  const manager = new ScheduledTaskManager({
    isLeader: () => leader,
    createJob: (context, callback) => { receivedContext = context; tick = callback; return { stop() {} }; },
  });
  manager.registerCron(ctx(), () => calls++);
  assert.equal(receivedContext.timezone, 'UTC');
  tick(); leader = true; tick();
  assert.equal(calls, 1);
});

test('duplicate context is skipped and reported with cron tag', () => {
  const reports = [];
  const manager = new ScheduledTaskManager({ errorReporter: { error: (...args) => reports.push(args) } });
  assert.equal(manager.registerCron(ctx(), () => {}), true);
  assert.equal(manager.registerCron(ctx(), () => {}), false);
  assert.equal(manager.cronsByWorkflow.get('wf').size, 1);
  assert.equal(reports[0][0], 'Skipped registration for already registered cron');
  assert.deepEqual(reports[0][1].tags, { cron: 'duplicate' });
});

test('different node or expression creates independent registrations', () => {
  const manager = new ScheduledTaskManager();
  manager.registerCron(ctx(), () => {});
  manager.registerCron(ctx({ nodeId: 'other' }), () => {});
  manager.registerCron(ctx({ expression: '1 * * * * *' }), () => {});
  assert.equal(manager.cronsByWorkflow.get('wf').size, 3);
});

test('deregister stops every workflow job and unknown workflow is a no-op', () => {
  let stopped = 0;
  const manager = new ScheduledTaskManager({ createJob: () => ({ stop: () => stopped++ }) });
  manager.registerCron(ctx(), () => {});
  manager.registerCron(ctx({ nodeId: 'other' }), () => {});
  assert.equal(manager.deregisterCrons('missing'), false);
  assert.equal(manager.deregisterCrons('wf'), true);
  assert.equal(stopped, 2);
  assert.equal(manager.cronsByWorkflow.has('wf'), false);
});

test('deregisterAll clears all workflow registrations', () => {
  const manager = new ScheduledTaskManager();
  manager.registerCron(ctx({ workflowId: 'a' }), () => {});
  manager.registerCron(ctx({ workflowId: 'b' }), () => {});
  manager.deregisterAllCrons();
  assert.equal(manager.cronsByWorkflow.size, 0);
});

test('invalid expression errors from host job factory propagate without registration', () => {
  const manager = new ScheduledTaskManager({ createJob: () => { throw new Error('invalid cron'); } });
  assert.throws(() => manager.registerCron(ctx(), () => {}), /invalid cron/);
  assert.equal(manager.cronsByWorkflow.has('wf'), false);
});

test('scheduling function binds workflow, timezone, and node identity', () => {
  let registered;
  const manager = { registerCron: (context, callback) => { registered = { context, callback }; } };
  const scheduling = getSchedulingFunctions(manager, 'wf', 'Asia/Novosibirsk', 'node');
  const callback = () => {};
  scheduling.registerCron({ expression: '0 * * * * *', recurrence: { activated: false } }, callback);
  assert.deepEqual(registered.context, {
    workflowId: 'wf', timezone: 'Asia/Novosibirsk', nodeId: 'node',
    expression: '0 * * * * *', recurrence: { activated: false },
  });
  assert.equal(registered.callback, callback);
});
