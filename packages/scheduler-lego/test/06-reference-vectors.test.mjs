/**
 * OFFLINE A/B EVIDENCE — recorded reference vectors.
 *
 * `04-parity.test.mjs` diffs against the live reference runtime, which is
 * gitignored and excluded from workspace snapshots: a fresh session would have
 * no A/B evidence at all (agent-2 advisory, POOL-002-R1).
 *
 * These vectors were produced by the REAL n8n-core 2.9.1 and committed under
 * `fixtures/`, so the differential claim stays provable offline. Regenerate with
 * `node packages/scheduler-lego/tools/record-reference-vectors.mjs`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { ScheduledTaskManager } from '../src/scheduled-task-manager.mjs';
import {
	FakeCronJob,
	makeErrorReporter,
	makeInstanceSettings,
	makeLogger,
} from './helpers/fakes.mjs';

const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/reference-vectors.json');
const vectors = JSON.parse(readFileSync(FIXTURE, 'utf8'));

function makeManager() {
	const errorReporter = makeErrorReporter();
	const manager = new ScheduledTaskManager(
		makeInstanceSettings(),
		makeLogger(),
		{ activeInterval: 0 },
		errorReporter,
		{ CronJob: FakeCronJob },
	);
	return { manager, errorReporter };
}

test('the recorded vectors really came from the pinned reference build', () => {
	assert.equal(vectors.reference['n8n-core'], '2.9.1');
	assert.equal(vectors.reference['n8n-workflow'], '2.9.1');
	assert.ok(vectors.toCronKey.length >= 8);
});

test('toCronKey is byte-identical to the reference for every recorded context', () => {
	const { manager } = makeManager();
	for (const { label, context, key } of vectors.toCronKey) {
		assert.equal(manager.toCronKey(context), key, `toCronKey diverged for "${label}"`);
	}
});

test('S-10 (recorded): two inactive contexts differing only by intervalSize collide', () => {
	const collision = vectors.toCronKey.filter((entry) => entry.label.startsWith('S-10 collision'));
	assert.equal(collision.length, 2);
	assert.equal(
		collision[0].key,
		collision[1].key,
		'the reference must fold the interval fields in only when `activated` is truthy',
	);
	assert.equal(collision[0].context.recurrence.intervalSize, 2);
	assert.equal(collision[1].context.recurrence.intervalSize, 7);
});

test('registry semantics match the recorded reference behaviour (T-1)', () => {
	const { manager, errorReporter } = makeManager();
	const cron = {
		workflowId: 'wf-1',
		nodeId: 'schedule',
		expression: vectors.farFutureExpression,
		timezone: 'UTC',
	};

	manager.registerCron(cron, () => {});
	assert.equal(manager.cronsByWorkflow.get('wf-1').size, vectors.registry.afterFirst.size);
	assert.deepEqual(manager.loggableCrons, vectors.registry.afterFirst.loggableCrons);

	manager.registerCron(cron, () => {}); // duplicate
	assert.equal(manager.cronsByWorkflow.get('wf-1').size, vectors.registry.afterDuplicate.size);
	assert.equal(errorReporter.errors.length, vectors.registry.afterDuplicate.reports);
	assert.equal(errorReporter.errors[0][0], vectors.registry.afterDuplicate.firstMessage);
	assert.deepEqual(errorReporter.errors[0][1].tags, vectors.registry.afterDuplicate.tags);

	manager.deregisterCrons('wf-1');
	assert.equal(manager.cronsByWorkflow.size, vectors.registry.afterDeregister.size);
});

test('S-09 (recorded): an existing-but-empty map survives deregisterCrons', () => {
	const { manager } = makeManager();
	manager.cronsByWorkflow.set('wf-empty', new Map());
	manager.deregisterCrons('wf-empty');
	assert.equal(manager.cronsByWorkflow.has('wf-empty'), vectors.emptyEntrySurvives.present);
	assert.equal(manager.cronsByWorkflow.size, vectors.emptyEntrySurvives.size);
});
