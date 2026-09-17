/**
 * Records reference-produced vectors for the Scheduler LEGO so the A/B evidence
 * survives a fresh session, where `.runtime/` is absent (gitignored, excluded
 * from workspace snapshots).
 *
 * Everything captured here comes from the REAL n8n 2.9.1 dependency set — never
 * from this port — so `test/06-reference-vectors.test.mjs` can diff the port
 * against it offline.
 *
 * Run: node packages/scheduler-lego/tools/record-reference-vectors.mjs
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { loadReference } from '../test/helpers/reference.mjs';
import {
	FakeCronJob,
	FAR_FUTURE,
	makeErrorReporter,
	makeInstanceSettings,
	makeLogger,
} from '../test/helpers/fakes.mjs';

const ref = loadReference();
if (!ref) throw new Error('reference runtime not installed — run: bash scripts/setup-reference-runtime.sh');

const RefScheduledTaskManager = ref.coreModule('execution-engine/scheduled-task-manager')
	.ScheduledTaskManager;

function makeManager({ isLeader = true } = {}) {
	const errorReporter = makeErrorReporter();
	const manager = new RefScheduledTaskManager(
		makeInstanceSettings({ isLeader }),
		makeLogger(),
		{ activeInterval: 0 },
		errorReporter,
	);
	return { manager, errorReporter };
}

// --- toCronKey vectors ----------------------------------------------------
const contexts = [
	{ label: 'minimal', context: { workflowId: 'wf-1', nodeId: 'n1', timezone: 'UTC' } },
	{
		label: 'recurrence activated (minutes)',
		context: {
			workflowId: 'wf-2',
			nodeId: 'n2',
			timezone: 'Europe/Berlin',
			recurrence: { activated: true, index: 0, intervalSize: 5, typeInterval: 'minutes' },
		},
	},
	{
		label: 'S-10 collision: inactive with intervalSize 2',
		context: {
			workflowId: 'wf-3',
			nodeId: 'n3',
			timezone: 'UTC',
			recurrence: { activated: false, index: 1, intervalSize: 2, typeInterval: 'hours' },
		},
	},
	{
		label: 'S-10 collision: inactive with intervalSize 7',
		context: {
			workflowId: 'wf-3',
			nodeId: 'n3',
			timezone: 'UTC',
			recurrence: { activated: false, index: 1, intervalSize: 7, typeInterval: 'hours' },
		},
	},
	{ label: 'missing workflowId', context: { nodeId: 'n4', timezone: 'UTC' } },
	{ label: 'missing nodeId', context: { workflowId: 'wf-5', timezone: 'UTC' } },
	{ label: 'missing timezone', context: { workflowId: 'wf-6', nodeId: 'n6' } },
	{ label: 'empty context', context: {} },
];

const { manager } = makeManager();
const toCronKey = contexts.map(({ label, context }) => ({
	label,
	context,
	key: manager.toCronKey(context),
}));

// --- registry semantics (T-1 duplicate registration) ----------------------
const registry = (() => {
	const { manager, errorReporter } = makeManager();
	const cron = { workflowId: 'wf-1', nodeId: 'schedule', expression: FAR_FUTURE, timezone: 'UTC' };

	manager.registerCron(cron, () => {});
	const afterFirst = {
		size: manager.cronsByWorkflow.get('wf-1').size,
		loggableCrons: JSON.parse(JSON.stringify(manager.loggableCrons)),
	};

	manager.registerCron(cron, () => {}); // duplicate
	const afterDuplicate = {
		size: manager.cronsByWorkflow.get('wf-1').size,
		reports: errorReporter.errors.length,
		firstMessage: errorReporter.errors[0]?.[0],
		tags: errorReporter.errors[0]?.[1]?.tags,
	};

	manager.deregisterCrons('wf-1');
	const afterDeregister = { size: manager.cronsByWorkflow.size };

	return { afterFirst, afterDuplicate, afterDeregister };
})();

// --- S-09: an existing-but-empty map survives deregisterCrons -------------
const emptyEntrySurvives = (() => {
	const { manager } = makeManager();
	manager.cronsByWorkflow.set('wf-empty', new Map());
	manager.deregisterCrons('wf-empty');
	return { present: manager.cronsByWorkflow.has('wf-empty'), size: manager.cronsByWorkflow.size };
})();

const corePkg = JSON.parse(readFileSync(path.join(ref.dir, 'n8n-core/package.json'), 'utf8'));
const workflowPkg = JSON.parse(readFileSync(path.join(ref.dir, 'n8n-workflow/package.json'), 'utf8'));

const fixture = {
	$comment:
		'Recorded from the real n8n 2.9.4 dependency set (n8n-core 2.9.1 / n8n-workflow 2.9.1). Regenerate with: node packages/scheduler-lego/tools/record-reference-vectors.mjs',
	recordedAt: new Date().toISOString(),
	reference: { 'n8n-core': corePkg.version, 'n8n-workflow': workflowPkg.version, node: process.versions.node },
	toCronKey,
	registry,
	emptyEntrySurvives,
	farFutureExpression: FAR_FUTURE,
};

const outPath = path.resolve(import.meta.dirname, '../fixtures/reference-vectors.json');
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${outPath}`);
console.log(`  toCronKey vectors: ${toCronKey.length}`);
