/**
 * GOLDEN CONFORMANCE — `tests/reference/agent-4/golden/trigger-scheduler.golden.json`.
 *
 * That golden was recorded against a LIVE n8n 2.9.4 instance (HTTP activation,
 * a real cron tick, a real execution row), so it cannot be replayed offline.
 * What CAN be checked offline is that the reconstructed registry reproduces
 * every scheduler-owned transition the golden records — most importantly the
 * `activateAlreadyActive` case, which is exactly the duplicate-registration
 * rule (T-1).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { ScheduledTaskManager } from '../src/scheduled-task-manager.mjs';
import {
	FakeCronJob,
	FAR_FUTURE,
	makeErrorReporter,
	makeInstanceSettings,
	makeLogger,
	tickOf,
} from './helpers/fakes.mjs';

const GOLDEN = path.resolve(
	import.meta.dirname,
	'../../../tests/reference/agent-4/golden/trigger-scheduler.golden.json',
);
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));

test('golden is a pinned n8n 2.9.4 recording with the documented cases', () => {
	assert.equal(golden.reference, 'n8n 2.9.4');
	for (const key of [
		'activate',
		'activeWorkflowsList',
		'activateAlreadyActive',
		'scheduledExecution',
		'deactivate',
	]) {
		assert.ok(golden.cases?.[key], `golden is missing the "${key}" case`);
	}
	assert.equal(golden.cases.activate.expected.status, 200);
	assert.equal(golden.cases.activate.expected.triggerCount, 1);
});

test('replay: activation registers exactly one cron (golden triggerCount = 1)', () => {
	const manager = new ScheduledTaskManager(
		makeInstanceSettings(),
		makeLogger(),
		{ activeInterval: 0 },
		makeErrorReporter(),
		{ CronJob: FakeCronJob },
	);

	// Schedule Trigger, every 30s — the workflow the golden activates
	manager.registerCron(
		{ workflowId: 'wf-1', nodeId: 'schedule', expression: '*/30 * * * * *', timezone: 'UTC' },
		() => {},
	);

	assert.equal(manager.cronsByWorkflow.get('wf-1').size, 1, 'golden: triggerCount 1');
	assert.deepEqual(manager.loggableCrons, { 'workflowId-wf-1': ['*/30 * * * * *'] });
});

test('replay: activateAlreadyActive stays at ONE cron — this is rule T-1', () => {
	const errorReporter = makeErrorReporter();
	const manager = new ScheduledTaskManager(
		makeInstanceSettings(),
		makeLogger(),
		{ activeInterval: 0 },
		errorReporter,
		{ CronJob: FakeCronJob },
	);

	let ticks = 0;
	const onTick = () => {
		ticks += 1;
	};
	const cron = { workflowId: 'wf-1', nodeId: 'schedule', expression: '*/30 * * * * *', timezone: 'UTC' };

	manager.registerCron(cron, onTick); // POST /activate
	manager.registerCron(cron, onTick); // POST /activate again

	assert.equal(manager.cronsByWorkflow.get('wf-1').size, 1, 'golden: no double registration');
	assert.equal(
		errorReporter.errors.length,
		1,
		'the second activation is reported, not thrown — activation still returns 200',
	);
	assert.equal(errorReporter.errors[0][0], 'Skipped registration for already registered cron');

	// …and therefore a single tick can only ever fire one execution
	tickOf([...manager.cronsByWorkflow.get('wf-1').values()][0].job)();
	assert.equal(ticks, 1);
});

test('replay: deactivate removes every cron, so no further execution is recorded', () => {
	const manager = new ScheduledTaskManager(
		makeInstanceSettings(),
		makeLogger(),
		{ activeInterval: 0 },
		makeErrorReporter(),
		{ CronJob: FakeCronJob },
	);

	let ticks = 0;
	const onTick = () => {
		ticks += 1;
	};
	manager.registerCron(
		{ workflowId: 'wf-1', nodeId: 'schedule', expression: '*/30 * * * * *', timezone: 'UTC' },
		onTick,
	);
	manager.registerCron(
		{ workflowId: 'wf-1', nodeId: 'schedule-2', expression: FAR_FUTURE, timezone: 'UTC' },
		onTick,
	);

	const jobs = [...manager.cronsByWorkflow.get('wf-1').values()].map((cron) => cron.job);
	jobs.forEach((job) => tickOf(job)());
	assert.equal(ticks, 2, 'both crons fire while active');

	manager.deregisterCrons('wf-1'); // POST /deactivate

	assert.equal(manager.cronsByWorkflow.size, 0, 'golden: active false');
	assert.deepEqual(jobs.map((job) => job.stopped), [true, true]);

	jobs.forEach((job) => tickOf(job)());
	assert.equal(ticks, 2, 'a stopped job cannot record another execution');
});

test('the golden execution row (mode "trigger", status "success") is OUT of scope', () => {
	// golden.cases.scheduledExecution.expected -> { recorded: true, mode: 'trigger', status: 'success' }
	// That row is produced by the Trigger LEGO calling `emit` and the execution
	// engine persisting it. contracts/scheduler.contract.md §5: the scheduler
	// "does not start executions". Recorded here so nobody adds it to this LEGO.
	assert.equal(golden.cases.scheduledExecution.expected.mode, 'trigger');
	assert.equal(
		typeof ScheduledTaskManager.prototype.registerCron,
		'function',
		'the scheduler surface stays a pure registry',
	);
	assert.equal(
		'run' in ScheduledTaskManager.prototype || 'emit' in ScheduledTaskManager.prototype,
		false,
		'the scheduler must not grow an execution/emit entry point',
	);
});
