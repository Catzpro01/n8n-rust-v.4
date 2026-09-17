import assert from 'node:assert/strict';
import test from 'node:test';

import { ScheduledTaskManager } from '../src/scheduled-task-manager.mjs';
import {
	FakeCronJob,
	FAR_FUTURE,
	makeErrorReporter,
	makeInstanceSettings,
	makeLogger,
	snapshot,
	tickOf,
} from './helpers/fakes.mjs';

function makeManager({ isLeader = true, activeInterval = 0 } = {}) {
	return {
		instanceSettings: makeInstanceSettings({ isLeader }),
		logger: makeLogger(),
		errorReporter: makeErrorReporter(),
		manager: new ScheduledTaskManager(
			makeInstanceSettings({ isLeader }),
			makeLogger(),
			{ activeInterval },
			makeErrorReporter(),
			{ CronJob: FakeCronJob },
		),
	};
}

// The fakes above are re-created inside makeManager; this helper keeps the
// same instances so assertions can inspect them.
function rig({ isLeader = true, activeInterval = 0 } = {}) {
	const instanceSettings = makeInstanceSettings({ isLeader });
	const logger = makeLogger();
	const errorReporter = makeErrorReporter();
	const manager = new ScheduledTaskManager(instanceSettings, logger, { activeInterval }, errorReporter, {
		CronJob: FakeCronJob,
	});
	return { instanceSettings, logger, errorReporter, manager };
}

const ctx = (over = {}) => ({
	workflowId: 'wf-1',
	nodeId: 'node-1',
	expression: FAR_FUTURE,
	timezone: 'Europe/Berlin',
	...over,
});

test('registerCron stores one entry keyed by the normalised cron key', () => {
	const { manager } = rig();
	manager.registerCron(ctx(), () => {});

	const crons = manager.cronsByWorkflow.get('wf-1');
	assert.equal(crons.size, 1);

	const [key, cron] = [...crons.entries()][0];
	assert.equal(
		key,
		JSON.stringify({
			expression: FAR_FUTURE,
			nodeId: 'node-1',
			timezone: 'Europe/Berlin',
			workflowId: 'wf-1',
		}),
		'S-10: keys are sorted, so the ctx literal order is irrelevant',
	);
	assert.equal(cron.summary, FAR_FUTURE);
	assert.deepEqual(cron.ctx, ctx());
});

test('T-1: a duplicate registration is a silent no-op that reports once', () => {
	const { manager, errorReporter } = rig();
	let ticks = 0;
	const onTick = () => {
		ticks += 1;
	};

	manager.registerCron(ctx(), onTick);
	manager.registerCron(ctx(), onTick);

	assert.equal(manager.cronsByWorkflow.get('wf-1').size, 1);
	assert.equal(errorReporter.errors.length, 1);

	const [message, options] = errorReporter.errors[0];
	assert.equal(message, 'Skipped registration for already registered cron');
	assert.deepEqual(options.tags, { cron: 'duplicate' });
	assert.equal(options.extra.workflowId, 'wf-1');
	assert.equal(options.extra.nodeId, 'node-1');
	assert.equal(options.extra.expression, FAR_FUTURE);
	assert.equal(options.extra.recurrence, undefined);
	assert.equal(options.extra.instanceRole, 'leader');
});

test('an activated recurrence changes the summary AND the key', () => {
	const { manager } = rig();
	const on = ctx({ recurrence: { activated: true, index: 2, intervalSize: 3, typeInterval: 'weeks' } });
	manager.registerCron(on, () => {});

	const [key, cron] = [...manager.cronsByWorkflow.get('wf-1').entries()][0];
	assert.equal(cron.summary, `${FAR_FUTURE} (every 3 weeks)`);
	assert.deepEqual(JSON.parse(key), {
		expression: FAR_FUTURE,
		nodeId: 'node-1',
		recurrenceActivated: true,
		recurrenceIndex: 2,
		recurrenceIntervalSize: 3,
		recurrenceTypeInterval: 'weeks',
		timezone: 'Europe/Berlin',
		workflowId: 'wf-1',
	});
});

test('S-10: an INACTIVE recurrence keeps recurrenceActivated but drops index/interval', () => {
	const { manager } = rig();
	manager.registerCron(
		ctx({ recurrence: { activated: false, index: 9, intervalSize: 4, typeInterval: 'days' } }),
		() => {},
	);
	const [key, cron] = [...manager.cronsByWorkflow.get('wf-1').entries()][0];

	assert.equal(cron.summary, FAR_FUTURE, 'inactive recurrence does not decorate the summary');
	assert.deepEqual(JSON.parse(key), {
		expression: FAR_FUTURE,
		nodeId: 'node-1',
		recurrenceActivated: false,
		timezone: 'Europe/Berlin',
		workflowId: 'wf-1',
	});
});

test('S-10: two contexts differing only by recurrence.intervalSize collide when inactive', () => {
	const { manager, errorReporter } = rig();
	manager.registerCron(ctx({ recurrence: { activated: false, intervalSize: 2 } }), () => {});
	manager.registerCron(ctx({ recurrence: { activated: false, intervalSize: 7 } }), () => {});

	assert.equal(manager.cronsByWorkflow.get('wf-1').size, 1);
	assert.equal(errorReporter.errors.length, 1);
});

test('multiple nodes and multiple workflows are tracked independently', () => {
	const { manager } = rig();
	manager.registerCron(ctx(), () => {});
	manager.registerCron(ctx({ nodeId: 'node-2' }), () => {});
	manager.registerCron(ctx({ workflowId: 'wf-2' }), () => {});

	assert.equal(manager.cronsByWorkflow.get('wf-1').size, 2);
	assert.equal(manager.cronsByWorkflow.get('wf-2').size, 1);
	assert.equal(snapshot(manager).length, 2);
});

test('T-2: a leader fires the callback, a follower does not', () => {
	const leader = rig({ isLeader: true });
	let leaderTicks = 0;
	leader.manager.registerCron(ctx(), () => {
		leaderTicks += 1;
	});
	tickOf([...leader.manager.cronsByWorkflow.get('wf-1').values()][0].job)();
	assert.equal(leaderTicks, 1);

	const follower = rig({ isLeader: false });
	let followerTicks = 0;
	follower.manager.registerCron(ctx(), () => {
		followerTicks += 1;
	});
	tickOf([...follower.manager.cronsByWorkflow.get('wf-1').values()][0].job)();
	assert.equal(followerTicks, 0, 'follower keeps the registration but stays silent');
	assert.equal(follower.manager.cronsByWorkflow.get('wf-1').size, 1);

	// …and starts firing the moment it becomes leader
	follower.instanceSettings.isLeader = true;
	tickOf([...follower.manager.cronsByWorkflow.get('wf-1').values()][0].job)();
	assert.equal(followerTicks, 1);
});

test('deregisterCrons stops every job of the workflow and deletes the entry', () => {
	const { manager, logger } = rig();
	manager.registerCron(ctx(), () => {});
	manager.registerCron(ctx({ nodeId: 'node-2', expression: '5 4 1 1 *' }), () => {});

	const jobs = [...manager.cronsByWorkflow.get('wf-1').values()].map((cron) => cron.job);
	assert.deepEqual(jobs.map((job) => job.stopped), [false, false]);

	manager.deregisterCrons('wf-1');

	assert.deepEqual(jobs.map((job) => job.stopped), [true, true]);
	assert.equal(manager.cronsByWorkflow.has('wf-1'), false);
	assert.deepEqual(logger.calls.at(-1), [
		'info',
		'Deregistered all crons for workflow',
		{ workflowId: 'wf-1', crons: [FAR_FUTURE, '5 4 1 1 *'], instanceRole: 'leader' },
	]);
});

test('deregisterCrons on an unknown workflow is a logged no-op', () => {
	const { manager, logger } = rig();
	manager.deregisterCrons('does-not-exist');
	assert.equal(logger.calls.length, 0, 'constructor logging only — no info line');
});

test('S-09: an existing but EMPTY entry is never deleted', () => {
	const { manager, logger } = rig();
	manager.cronsByWorkflow.set('wf-empty', new Map());

	manager.deregisterCrons('wf-empty');

	assert.equal(manager.cronsByWorkflow.has('wf-empty'), true, 'empty Map survives');
	assert.equal(logger.calls.length, 0);
});

test('deregisterAllCrons empties the registry and clears the debug interval', () => {
	const { manager } = rig({ activeInterval: 5 });
	assert.notEqual(manager.logInterval, undefined);

	manager.registerCron(ctx(), () => {});
	manager.registerCron(ctx({ workflowId: 'wf-2' }), () => {});

	manager.deregisterAllCrons();

	assert.equal(manager.cronsByWorkflow.size, 0);
	assert.equal(manager.logInterval, undefined);
});

test('loggableCrons is keyed "workflowId-<id>" and lists summaries', () => {
	const { manager } = rig();
	manager.registerCron(ctx(), () => {});
	manager.registerCron(ctx({ nodeId: 'node-2', expression: '5 4 1 1 *' }), () => {});
	manager.registerCron(ctx({ workflowId: 'wf-2' }), () => {});

	assert.deepEqual(manager.loggableCrons, {
		'workflowId-wf-1': [FAR_FUTURE, '5 4 1 1 *'],
		'workflowId-wf-2': [FAR_FUTURE],
	});
});

test('S-07: only the literal 0 disables the debug interval', () => {
	assert.equal(rig({ activeInterval: 0 }).manager.logInterval, undefined);

	const on = rig({ activeInterval: 1 });
	assert.ok(on.manager.logInterval, 'activeInterval 1 starts an interval');
	on.manager.deregisterAllCrons();

	// undefined / negative also start one — the guard is `=== 0`.
	// Built directly (not via `rig`) because `rig` defaults `activeInterval` to 0.
	for (const activeInterval of [undefined, null, -1]) {
		const m = new ScheduledTaskManager(
			makeInstanceSettings(),
			makeLogger(),
			{ activeInterval },
			makeErrorReporter(),
			{ CronJob: FakeCronJob },
		);
		assert.ok(m.logInterval, `activeInterval ${String(activeInterval)} starts an interval`);
		m.deregisterAllCrons();
		assert.equal(m.logInterval, undefined);
	}
});

test('the logger is re-bound to the "cron" scope', () => {
	const { manager, logger } = rig();
	assert.equal(logger.scope, 'cron');
	assert.equal(manager.logger, logger);
});

test('registerCron without an injected CronJob fails loudly at the boundary', () => {
	const manager = new ScheduledTaskManager(
		makeInstanceSettings(),
		makeLogger(),
		{ activeInterval: 0 },
		makeErrorReporter(),
	);
	assert.throws(() => manager.registerCron(ctx(), () => {}), /requires a CronJob implementation/);
});
