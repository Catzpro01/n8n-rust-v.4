/**
 * A/B PARITY SUITE — Scheduler LEGO vs the pinned reference runtime.
 *
 * Diffs this reconstruction against the REAL n8n packages
 * (`n8n-workflow@2.9.1`'s `toCronExpression`, `n8n-core@2.9.1`'s
 * `ScheduledTaskManager` loaded by dist subpath, and `cron@4.4.0`) instead of
 * against hand-written expectations.
 *
 * SKIPS loudly when the runtime is absent — never a false green.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ALLOW_NO_REFERENCE, SKIP_REASON, loadReference, paritySkip } from './helpers/reference.mjs';
import {
	FakeCronJob,
	FAR_FUTURE,
	makeErrorReporter,
	makeInstanceSettings,
	makeLogger,
	snapshot,
	tickOf,
} from './helpers/fakes.mjs';
import { ScheduledTaskManager } from '../src/scheduled-task-manager.mjs';
import { toCronExpression } from '../src/cron-expression.mjs';
import { randomInt } from '../src/random.mjs';

const ref = loadReference();
const skip = paritySkip(ref);

test('parity: A/B evidence requires the pinned reference runtime', () => {
	if (!ref) {
		if (ALLOW_NO_REFERENCE) return; // explicit opt-out: no A/B evidence, and no green claim
		assert.fail(
			`${SKIP_REASON}\n` +
				'A fully skipped parity suite exits 0 while running ZERO differential checks ' +
				'(.runtime is gitignored and excluded from workspace snapshots). Install the ' +
				'runtime, or opt out explicitly with LEGO_ALLOW_NO_REFERENCE=1.',
		);
	}
	assert.equal(ref.versions['n8n-workflow'], '2.9.1', 'n8n-workflow is not the pinned version');
	assert.equal(ref.versions['n8n-core'], '2.9.1', 'n8n-core is not the pinned version');
	assert.equal(ref.versions.cron, '4.4.0', 'cron is not the pinned version');
});

/**
 * Signature of a cron expression's VARIANCE: sample the same input many times
 * and mark each field R (varies → random) or its literal value.
 * This is what makes a randomised function comparable across implementations.
 */
function varianceSignature(sample) {
	const columns = sample.map((expression) => expression.split(' '));
	const width = columns[0].length;
	return Array.from({ length: width }, (_unused, field) => {
		const values = new Set(columns.map((parts) => parts[field]));
		return values.size > 1 ? 'R' : [...values][0];
	});
}

const SIGNATURE_CASES = [
	['everyMinute', { mode: 'everyMinute' }],
	['everyHour', { mode: 'everyHour', minute: 42 }],
	['everyX/minutes', { mode: 'everyX', unit: 'minutes', value: 5 }],
	['everyX/hours', { mode: 'everyX', unit: 'hours', value: 3 }],
	['everyDay', { mode: 'everyDay', hour: 7, minute: 15 }],
	['everyWeek', { mode: 'everyWeek', hour: 7, minute: 15, weekday: 3 }],
	['everyMonth', { mode: 'everyMonth', hour: 7, minute: 15, dayOfMonth: 28 }],
	['custom', { mode: 'custom', cronExpression: '  */30 * * * * *  ' }],
];

test('parity: toCronExpression variance signature (which fields are random)', { skip }, () => {
	for (const [label, item] of SIGNATURE_CASES) {
		const mine = varianceSignature(
			Array.from({ length: 40 }, () => toCronExpression({ ...item })),
		);
		const theirs = varianceSignature(
			Array.from({ length: 40 }, () => ref.workflow.toCronExpression({ ...item })),
		);
		assert.deepEqual(mine, theirs, `${label}: variance signature`);
	}
});

test('parity: toCronExpression random fields stay inside [0,60)', { skip }, () => {
	for (const [label, item] of SIGNATURE_CASES) {
		const signature = varianceSignature(
			Array.from({ length: 40 }, () => toCronExpression({ ...item })),
		);
		for (let sample = 0; sample < 40; sample++) {
			const parts = toCronExpression({ ...item }).split(' ');
			parts.forEach((value, field) => {
				if (signature[field] !== 'R') return;
				const number = Number(value);
				assert.ok(
					Number.isInteger(number) && number >= 0 && number < 60,
					`${label}: random field ${field} out of range: ${value}`,
				);
			});
		}
	}
});

test('parity: toCronExpression throws on the same inputs', { skip }, () => {
	const bad = { mode: 'everyX', unit: 'fortnights', value: 2 };
	assert.throws(() => toCronExpression(bad), TypeError);
	assert.throws(() => ref.workflow.toCronExpression(bad), TypeError);
});

test('parity: randomInt range matches the reference distribution bounds', { skip }, () => {
	// randomInt is not exported by n8n-workflow's public surface in 2.9.1, so
	// the range is pinned against the contract instead: 0..59 for cron seconds.
	for (let i = 0; i < 400; i++) {
		const value = randomInt(60);
		assert.ok(Number.isInteger(value) && value >= 0 && value < 60);
	}
	assert.equal(randomInt(7, 8), 7);
});

/** Builds both managers with identical fakes and the REAL cron@4 timer. */
function both({ isLeader = true, activeInterval = 0 } = {}) {
	const fakes = () => ({
		instanceSettings: makeInstanceSettings({ isLeader }),
		logger: makeLogger(),
		errorReporter: makeErrorReporter(),
	});

	const mineFakes = fakes();
	const refFakes = fakes();

	const mine = new ScheduledTaskManager(
		mineFakes.instanceSettings,
		mineFakes.logger,
		{ activeInterval },
		mineFakes.errorReporter,
		{ CronJob: ref.cron.CronJob },
	);

	const RefScheduledTaskManager = ref.coreModule('execution-engine/scheduled-task-manager').ScheduledTaskManager;
	const theirs = new RefScheduledTaskManager(
		refFakes.instanceSettings,
		refFakes.logger,
		{ activeInterval },
		refFakes.errorReporter,
	);

	const cleanup = () => {
		// Real cron@4 jobs hold the event loop open — always stop them, otherwise
		// `node --test` never exits.
		mine.deregisterAllCrons();
		theirs.deregisterAllCrons();
	};

	return { mine, theirs, mineFakes, refFakes, cleanup };
}

const ctx = (over = {}) => ({
	workflowId: 'wf-1',
	nodeId: 'node-1',
	expression: FAR_FUTURE,
	timezone: 'Europe/Berlin',
	...over,
});

test('parity: ScheduledTaskManager registry semantics (real cron timer injected)', { skip }, (t) => {
	const { mine, theirs, mineFakes, refFakes, cleanup } = both();
	t.after(cleanup);

	const script = [
		ctx(),
		ctx({ nodeId: 'node-2', expression: '5 4 1 1 *' }),
		ctx({ workflowId: 'wf-2' }),
		ctx({ recurrence: { activated: true, index: 2, intervalSize: 3, typeInterval: 'weeks' } }),
		ctx({ recurrence: { activated: false, index: 9, intervalSize: 4, typeInterval: 'days' } }),
		ctx(), // duplicate of #1
	];

	for (const item of script) {
		mine.registerCron(item, () => {});
		theirs.registerCron(item, () => {});
	}

	assert.deepEqual(snapshot(mine), snapshot(theirs), 'registry snapshot (keys + summaries + ctx)');
	assert.deepEqual(mine.loggableCrons, theirs.loggableCrons, 'loggableCrons');
	assert.deepEqual(mineFakes.logger.calls, refFakes.logger.calls, 'logger calls');
	assert.deepEqual(mineFakes.errorReporter.errors, refFakes.errorReporter.errors, 'duplicate reports');
	assert.equal(mineFakes.errorReporter.errors.length, 1);
});

test('parity: leadership gating — leader fires, follower stays silent', { skip }, (t) => {
	const leader = both({ isLeader: true });
	const follower = both({ isLeader: false });
	t.after(() => {
		leader.cleanup();
		follower.cleanup();
	});

	const results = [];
	for (const [label, pair] of [
		['leader', leader],
		['follower', follower],
	]) {
		const fired = { mine: 0, theirs: 0 };
		pair.mine.registerCron(ctx(), () => {
			fired.mine += 1;
		});
		pair.theirs.registerCron(ctx(), () => {
			fired.theirs += 1;
		});

		tickOf([...pair.mine.cronsByWorkflow.get('wf-1').values()][0].job)();
		tickOf([...pair.theirs.cronsByWorkflow.get('wf-1').values()][0].job)();

		assert.equal(fired.mine, fired.theirs, `${label}: both sides fire identically`);
		results.push([label, fired.mine]);
	}

	assert.deepEqual(results, [
		['leader', 1],
		['follower', 0],
	]);
});

test('parity: deregistration stops jobs and clears the registry', { skip }, (t) => {
	const { mine, theirs, mineFakes, refFakes, cleanup } = both();
	t.after(cleanup);

	mine.registerCron(ctx(), () => {});
	theirs.registerCron(ctx(), () => {});
	mine.registerCron(ctx({ nodeId: 'node-2', expression: '5 4 1 1 *' }), () => {});
	theirs.registerCron(ctx({ nodeId: 'node-2', expression: '5 4 1 1 *' }), () => {});
	mine.registerCron(ctx({ workflowId: 'wf-2' }), () => {});
	theirs.registerCron(ctx({ workflowId: 'wf-2' }), () => {});

	mine.deregisterCrons('wf-1');
	theirs.deregisterCrons('wf-1');

	assert.deepEqual(snapshot(mine), snapshot(theirs), 'after deregisterCrons');
	assert.deepEqual(mineFakes.logger.calls, refFakes.logger.calls, 'logger calls');

	mine.deregisterAllCrons();
	theirs.deregisterAllCrons();

	assert.deepEqual(snapshot(mine), snapshot(theirs), 'after deregisterAllCrons');
	assert.equal(mine.cronsByWorkflow.size, 0);
	assert.equal(theirs.cronsByWorkflow.size, 0);
});

test('parity: S-09 — an empty registry entry survives deregisterCrons on both sides', { skip }, (t) => {
	const { mine, theirs, cleanup } = both();
	t.after(cleanup);
	mine.cronsByWorkflow.set('wf-empty', new Map());
	theirs.cronsByWorkflow.set('wf-empty', new Map());

	mine.deregisterCrons('wf-empty');
	theirs.deregisterCrons('wf-empty');

	assert.equal(mine.cronsByWorkflow.has('wf-empty'), theirs.cronsByWorkflow.has('wf-empty'));
	assert.equal(mine.cronsByWorkflow.has('wf-empty'), true);
});

test('parity: toCronKey output is byte-identical for tricky contexts', { skip }, (t) => {
	const { mine, theirs, cleanup } = both();
	t.after(cleanup);
	const contexts = [
		ctx(),
		ctx({ recurrence: { activated: true, index: 0, intervalSize: 2, typeInterval: 'hours' } }),
		ctx({ recurrence: { activated: false, index: 5, intervalSize: 8, typeInterval: 'months' } }),
		ctx({ timezone: 'UTC', expression: '*/30 * * * * *' }),
	];

	for (const item of contexts) {
		assert.equal(
			mine.toCronKey(item),
			theirs.toCronKey(item),
			`toCronKey(${JSON.stringify(item)})`,
		);
	}
});
