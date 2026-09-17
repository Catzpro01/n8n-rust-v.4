import assert from 'node:assert/strict';
import test from 'node:test';
import { CronTimerAdapter, ScheduledTaskManager, createCronTimerJob, matchesCron, parseCronExpression } from '../src/index.mjs';

test('parser accepts five/six fields, steps, lists, ranges, and aliases', () => {
  assert.equal(parseCronExpression('*/15 9-17 * jan,mar mon-fri').length, 6);
  assert.equal(parseCronExpression('5 */10 * * * *')[0].values.has(5), true);
  assert.equal(parseCronExpression('0 0 1 * *')[0].values.has(0), true);
});

test('matchesCron evaluates generated six-field expressions in UTC', () => {
  const date = new Date('2026-09-18T10:15:05.000Z');
  assert.equal(matchesCron('5 15 10 * * *', date, 'UTC'), true);
  assert.equal(matchesCron('6 15 10 * * *', date, 'UTC'), false);
  assert.equal(matchesCron('5 */5 10 * * *', date, 'UTC'), true);
});

test('timezone projection is applied before field matching', () => {
  const date = new Date('2026-09-18T03:15:05.000Z');
  assert.equal(matchesCron('5 15 10 * * *', date, 'Asia/Novosibirsk'), true);
  assert.equal(matchesCron('5 15 3 * * *', date, 'UTC'), true);
});

test('day-of-month and weekday use cron OR semantics when both constrained', () => {
  const friday18 = new Date('2026-09-18T10:00:00Z');
  assert.equal(matchesCron('0 0 10 1 * fri', friday18, 'UTC'), true);
  assert.equal(matchesCron('0 0 10 1 * mon', friday18, 'UTC'), false);
});

test('invalid expression, range, step, and timezone fail synchronously', () => {
  assert.throws(() => parseCronExpression('* * *'), /5 or 6 fields/);
  assert.throws(() => parseCronExpression('0 99 * * * *'), /out of range/);
  assert.throws(() => parseCronExpression('0 *\/0 * * * *'), /Invalid cron step/);
  assert.throws(() => new CronTimerAdapter().createJob({ expression: '* * * * * *', timezone: 'Nowhere/Invalid' }, () => {}), /Invalid time zone/);
});

test('native adapter drives ScheduledTaskManager and preserves leader gating', () => {
  let callback; let cleared; let ticks = 0;
  let now = new Date('2026-09-18T10:15:04.100Z');
  const adapter = new CronTimerAdapter({
    now: () => now,
    setTimer: (fn) => { callback = fn; return 7; },
    clearTimer: (id) => { cleared = id; },
  });
  let leader = false;
  const manager = new ScheduledTaskManager({ isLeader: () => leader, createJob: createCronTimerJob(adapter) });
  manager.registerCron({ workflowId: 'wf', nodeId: 'n', timezone: 'UTC', expression: '5 15 10 * * *' }, () => { ticks++; });
  now = new Date('2026-09-18T10:15:05.000Z');
  callback();
  assert.equal(ticks, 0);
  leader = true;
  // Advance to another matching day because duplicate suppression is per absolute second.
  now = new Date('2026-09-19T10:15:05.000Z');
  callback();
  assert.equal(ticks, 1);
  manager.deregisterCrons('wf');
  assert.equal(cleared, 7);
});

test('adapter never emits the same absolute second twice', () => {
  let callback; let ticks = 0;
  const now = new Date('2026-09-18T10:15:05Z');
  const job = new CronTimerAdapter({ now: () => now, setTimer: (fn) => { callback = fn; return 1; } })
    .createJob({ expression: '* * * * * *', timezone: 'UTC' }, () => { ticks++; });
  callback(); callback();
  assert.equal(ticks, 1);
  job.stop();
});
