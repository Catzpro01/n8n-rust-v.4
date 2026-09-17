#!/usr/bin/env node
/**
 * Trigger LEGO — Phase 5 differential gate (`ActiveWorkflows` + activation validation).
 *
 * The oracle is the pinned runtime: `n8n-core`'s `ActiveWorkflows` (the in-memory trigger registry)
 * and `n8n-workflow`'s `validateWorkflowHasTriggerLikeNode` / `toCronExpression`. Every scenario is
 * executed twice — once through the reference class and once through
 * `packages/reconstructed-engine/src/trigger-engine.ts` — over the same inputs (the *same* real
 * `Workflow` objects), with stub logger/pollers/crons so calls and ordering are observable.
 *
 *   T01 declared surface   — the port exports the reference members
 *   T02 state machine      — add / duplicate add / no-trigger add / get / isActive / ordering / remove
 *   T03 failure semantics  — activation error, close error, deactivation error, after-state
 *   T04 validation         — `validateWorkflowHasTriggerLikeNode` over node maps x node types
 *   T05 cron helper        — `toCronExpression` shapes (seconds field randomised by design)
 *   T06 unit suite         — packages/trigger-lego/test/*.test.mjs
 *
 * usage: node tools/trigger-isolation-gate.mjs [--quiet]
 * evidence: docs/isolation/evidence/trigger-lego-gate.json
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = process.cwd();
const args = process.argv.slice(2);
const EVIDENCE = join(REPO, 'docs/isolation/evidence/trigger-lego-gate.json');
const TRIGGER_PKG = join(REPO, 'packages/trigger-lego');

/* ---------------------------------------------------------------- */
/* reference runtime                                                 */
/* ---------------------------------------------------------------- */
function findRuntime() {
	for (const dir of [process.env.LEGO_LIVE_RUNTIME, join(REPO, '.runtime/node_modules'), '/home/user/.n8n-live/node_modules']) {
		if (dir && existsSync(join(dir, 'n8n-core/package.json'))) return dir;
	}
	return null;
}
const runtimeDir = findRuntime();
if (!runtimeDir) {
	console.error('reference runtime not found — run scripts/setup-reference-runtime.sh (or set LEGO_LIVE_RUNTIME)');
	process.exit(2);
}
const corePackage = join(runtimeDir, 'n8n-core');
const workflowPackage = join(runtimeDir, 'n8n-workflow');
const reqCore = createRequire(join(corePackage, 'package.json'));
const reqWorkflow = createRequire(join(workflowPackage, 'package.json'));
const { ActiveWorkflows } = reqCore(corePackage);
const {
	Workflow,
	WorkflowActivationError,
	TriggerCloseError,
	validateWorkflowHasTriggerLikeNode,
	toCronExpression,
} = reqWorkflow(workflowPackage);

const candidate = await import(pathToFileURL(join(REPO, 'packages/reconstructed-engine/src/trigger-engine.ts')).href);

/* ---------------------------------------------------------------- */
/* helpers                                                           */
/* ---------------------------------------------------------------- */
const norm = (value) => {
	if (value === undefined) return '<undefined>';
	if (value instanceof Map) {
		return [...value.entries()].map(([key, val]) => [key, norm(val)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
	}
	if (value instanceof Set) return [...value].map(norm).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
	if (Array.isArray(value)) return value.map(norm);
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.keys(value).sort().map((key) => [key, norm(value[key])]));
	}
	return value;
};
const show = (value, max = 220) => {
	const text = JSON.stringify(norm(value)) ?? 'undefined';
	return text.length > max ? `${text.slice(0, max)}…` : text;
};

const differences = [];
const comparisons = { total: 0, byCheck: {} };
function compare(check, scenario, call, referenceValue, candidateValue) {
	comparisons.total++;
	comparisons.byCheck[check] = (comparisons.byCheck[check] ?? 0) + 1;
	const a = JSON.stringify(norm(referenceValue));
	const b = JSON.stringify(norm(candidateValue));
	if (a === b) return;
	differences.push({ check, scenario, call, reference: show(referenceValue), candidate: show(candidateValue) });
}

const calls = [];
const record = (...argsList) => calls.push(argsList.map((value) => (typeof value === 'object' ? show(value) : String(value))).join(':'));
const silentLogger = {
	debug: (...argsList) => record('debug', argsList[0]),
	warn: (...argsList) => record('warn', argsList[0]),
	error: (...argsList) => record('error', argsList[0]),
};

const nodeTypeDefinitions = {
	plain: { description: { name: 'plain', properties: [], version: 1 } },
	trigger: { description: { name: 'trigger', properties: [], version: 1 }, trigger: async () => ({ closeFunction: async () => {} }) },
	poll: { description: { name: 'poll', properties: [], version: 1 }, poll: async () => ({}) },
	webhook: { description: { name: 'webhook', properties: [], version: 1 }, webhook: async () => ({}) },
};
const nodeTypesFor = (definition) => ({
	getByNameAndVersion: () => definition,
	getByName: () => definition,
	getByNameAndVersionOrFail: () => definition,
});

function makeWorkflow(id, nodeSpecs, { timezone = 'UTC', connections = {} } = {}) {
	const nodes = nodeSpecs.map(([name, definition]) => ({
		name,
		type: definition === nodeTypeDefinitions.trigger ? 'n8n-nodes-base.trigger' : `n8n-nodes-base.${definition.description.name}`,
		typeVersion: 1,
		position: [0, 0],
		parameters: {},
	}));
	const definitionsByName = Object.fromEntries(nodeSpecs.map(([name, definition]) => [`n8n-nodes-base.${definition === nodeTypeDefinitions.trigger ? 'trigger' : definition.description.name}`, definition]));
	return new Workflow({
		id,
		name: id,
		timezone,
		nodes,
		connections,
		active: false,
		nodeTypes: { getByNameAndVersion: (type) => definitionsByName[type] ?? nodeTypeDefinitions.plain, getByName: () => nodeTypeDefinitions.plain },
	});
}

/** Reference registry + candidate registry wired to the SAME observable call sinks. */
function makeEngines({ runTrigger, closeBehaviour, registerCronFailure } = {}) {
	const referenceCalls = [];
	const candidateCalls = [];
	const triggersAndPollers = (sink, context) => ({
		runTrigger: async (workflow, triggerNode, context) => {
			sink.push(`runTrigger:${triggerNode.name}`);
			return runTrigger ? await runTrigger(workflow, triggerNode, context) : { closeFunction: async () => sink.push(`close:${triggerNode.name}`) };
		},
	});
	const scheduledTaskManager = (sink) => ({
		registerCron: (ctx) => {
			sink.push(`registerCron:${ctx.workflowId}:${ctx.nodeId}:${ctx.expression}`);
			if (registerCronFailure) throw new Error(registerCronFailure);
		},
		deregisterCrons: (workflowId) => sink.push(`deregisterCrons:${workflowId}`),
	});
	const logger = (sink) => ({
		debug: (message) => sink.push(`debug:${message}`),
		warn: (message) => sink.push(`warn:${message}`),
		error: (message) => sink.push(`error:${message}`),
	});
	const errorReporter = (sink) => ({ error: (error) => sink.push(`reporter:${error.name}:${error.node?.name}`) });

	const referenceContext = { TriggerCloseError };
	const candidateContext = { TriggerCloseError: candidate.TriggerCloseError };

	const reference = new ActiveWorkflows(
		logger(referenceCalls),
		scheduledTaskManager(referenceCalls),
		triggersAndPollers(referenceCalls, referenceContext),
		errorReporter(referenceCalls),
		{ startSpan: async (_options, fn) => fn({}), pickWorkflowAttributes: () => ({}), pickNodeAttributes: () => ({}) },
	);
	const candidateEngine = new candidate.TriggerEngine({
		logger: logger(candidateCalls),
		scheduledTaskManager: scheduledTaskManager(candidateCalls),
		triggersAndPollers: triggersAndPollers(candidateCalls, candidateContext),
		errorReporter: errorReporter(candidateCalls),
	});
	return { reference, candidateEngine, referenceCalls, candidateCalls };
}

/** Runs the same async scenario against both engines and compares every observable step. */
async function runBoth(scenario, fn) {
	const engines = makeEngines(scenario.options ?? {});
	const context = { TriggerCloseError };
	const outputs = { reference: [], candidate: [] };
	const errors = { reference: null, candidate: null };

	for (const [side, engine] of [
		['reference', engines.reference],
		['candidate', engines.candidateEngine],
	]) {
		errors[side] = null;
		try {
			outputs[side] = await fn(engine, side, context);
		} catch (error) {
			errors[side] = {
				name: error?.name,
				message: error?.message,
				node: error?.node?.name ?? null,
				workflowId: error?.workflowId ?? null,
				level: error?.level ?? null,
				cause: error?.cause?.message ?? null,
			};
		}
	}

	compare('T02', scenario.id, 'returned values', outputs.reference, outputs.candidate);
	compare('T02', scenario.id, 'thrown error', errors.reference, errors.candidate);
	compare('T02', scenario.id, 'calls', engines.referenceCalls, engines.candidateCalls);
}

/* ---------------------------------------------------------------- */
/* scenarios                                                         */
/* ---------------------------------------------------------------- */
const triggerWorkflow = () => makeWorkflow('trigger-wf', [['Trigger', nodeTypeDefinitions.trigger], ['Plain', nodeTypeDefinitions.plain]]);
const plainWorkflow = () => makeWorkflow('plain-wf', [['Plain A', nodeTypeDefinitions.plain], ['Plain B', nodeTypeDefinitions.plain]]);

const SCENARIOS = [
	{
		id: 'T02-a-add-and-inspect',
		run: async (engine) => [
			await engine.add('wf-1', triggerWorkflow(), {}, 'trigger', 'activate', () => ({}), () => ({})),
			engine.isActive('wf-1'),
			engine.allActiveWorkflows(),
			Object.keys(engine.get('wf-1') ?? {}),
			(engine.get('wf-1')?.triggerResponses ?? []).length,
			engine.isActive('nope'),
			engine.get('nope') ?? null,
		],
	},
	{
		id: 'T02-b-duplicate-add',
		run: async (engine) => {
			await engine.add('wf-1', triggerWorkflow(), {}, 'trigger', 'activate', () => ({}), () => ({}));
			await engine.add('wf-1', triggerWorkflow(), {}, 'trigger', 'activate', () => ({}), () => ({}));
			return [engine.allActiveWorkflows(), (engine.get('wf-1')?.triggerResponses ?? []).length];
		},
	},
	{
		id: 'T02-c-workflow-without-triggers',
		run: async (engine) => {
			await engine.add('no-trigger', plainWorkflow(), {}, 'trigger', 'activate', () => ({}), () => ({}));
			return [engine.isActive('no-trigger'), engine.allActiveWorkflows(), (engine.get('no-trigger')?.triggerResponses ?? []).length];
		},
	},
	{
		id: 'T02-d-ordering-of-ids',
		run: async (engine) => {
			for (const id of ['wf-2', '10', '2', 'wf-1']) {
				await engine.add(id, triggerWorkflow(), {}, 'trigger', 'activate', () => ({}), () => ({}));
			}
			return engine.allActiveWorkflows();
		},
	},
	{
		id: 'T02-e-remove-once-and-twice',
		run: async (engine) => {
			await engine.add('wf-1', triggerWorkflow(), {}, 'trigger', 'activate', () => ({}), () => ({}));
			await engine.add('wf-2', triggerWorkflow(), {}, 'trigger', 'activate', () => ({}), () => ({}));
			const first = await engine.remove('wf-1');
			const second = await engine.remove('wf-1');
			return [first, second, engine.allActiveWorkflows()];
		},
	},
	{
		id: 'T02-f-remove-all',
		run: async (engine) => {
			await engine.add('wf-1', triggerWorkflow(), {}, 'trigger', 'activate', () => ({}), () => ({}));
			await engine.add('wf-2', triggerWorkflow(), {}, 'trigger', 'activate', () => ({}), () => ({}));
			await engine.removeAllTriggerAndPollerBasedWorkflows();
			await engine.removeAllTriggerAndPollerBasedWorkflows();
			return engine.allActiveWorkflows();
		},
	},
	{
		id: 'T03-a-trigger-throws',
		options: { runTrigger: async () => { throw new Error('boom'); } },
		run: async (engine) => {
			await engine.add('bad', triggerWorkflow(), {}, 'trigger', 'activate', () => ({}), () => ({}));
			return [engine.isActive('bad'), engine.allActiveWorkflows()];
		},
	},
	{
		id: 'T03-b-close-throws',
		options: { runTrigger: async () => ({ closeFunction: async () => { throw new Error('close failed'); } }) },
		run: async (engine) => {
			await engine.add('wf-1', triggerWorkflow(), {}, 'trigger', 'activate', () => ({}), () => ({}));
			await engine.remove('wf-1');
			return [engine.isActive('wf-1'), engine.allActiveWorkflows()];
		},
	},
	{
		id: 'T03-c-trigger-close-error-is-reported',
		options: {
			runTrigger: async (workflow, node, context) => ({
				closeFunction: async () => {
					throw new context.TriggerCloseError({ name: 'Trigger', type: 'n8n-nodes-base.trigger' }, { cause: new Error('close cause'), level: 'error' });
				},
			}),
		},
		run: async (engine) => {
			await engine.add('wf-1', triggerWorkflow(), {}, 'trigger', 'activate', () => ({}), () => ({}));
			await engine.remove('wf-1');
			return [engine.isActive('wf-1'), engine.allActiveWorkflows()];
		},
	},
];

/* ---------------------------------------------------------------- */
/* checks                                                            */
/* ---------------------------------------------------------------- */
const checks = [];
const gate = async (id, title, fn) => {
	let status = 'PASS';
	let detail = '';
	try {
		detail = (await fn()) ?? '';
	} catch (error) {
		status = 'FAIL';
		detail = error?.message ?? String(error);
	}
	checks.push({ id, title, status, detail: String(detail).trim().slice(0, 900) });
	console.log(`[${status}] ${id} ${title}${detail ? ` — ${String(detail).split('\n')[0]}` : ''}`);
};

await gate('T01', 'the port exports the reference surface', () => {
	const expected = ['TriggerEngine', 'WorkflowActivationError', 'WorkflowDeactivationError', 'TriggerCloseError', 'validateWorkflowHasTriggerLikeNode', 'toCronExpression', 'STARTING_NODES'];
	const missing = expected.filter((name) => candidate[name] === undefined);
	if (missing.length) throw new Error(`missing exports: ${missing.join(', ')}`);
	const methods = ['isActive', 'allActiveWorkflows', 'get', 'add', 'remove', 'removeAllTriggerAndPollerBasedWorkflows'];
	const prototype = candidate.TriggerEngine.prototype;
	const missingMethods = methods.filter((name) => typeof prototype[name] !== 'function');
	if (missingMethods.length) throw new Error(`missing methods: ${missingMethods.join(', ')}`);
	return `${expected.length} exports, ${methods.length} registry methods (reference ActiveWorkflows: ${Object.getOwnPropertyNames(ActiveWorkflows.prototype).filter((n) => n !== 'constructor').length} members)`;
});

await gate('T02', 'state machine differential: add / duplicate / no-trigger / ordering / remove', async () => {
	for (const scenario of SCENARIOS) {
		if (scenario.id.startsWith('T03')) continue;
		await runBoth(scenario, scenario.run);
	}
	const failed = differences.filter((diff) => diff.check === 'T02');
	if (failed.length) {
		throw new Error(
			`${failed.length}/${comparisons.byCheck.T02} registry calls diverge; first: ${failed[0].scenario} ${failed[0].call}\n  reference: ${failed[0].reference}\n  candidate: ${failed[0].candidate}`,
		);
	}
	return `${comparisons.byCheck.T02} registry calls identical over ${SCENARIOS.filter((s) => !s.id.startsWith('T03')).length} scenarios`;
});

await gate('T03', 'failure semantics differential: activation, close and deactivation errors', async () => {
	for (const scenario of SCENARIOS) {
		if (!scenario.id.startsWith('T03')) continue;
		await runBoth(scenario, scenario.run);
	}
	const failed = differences.filter((diff) => diff.check === 'T02' && diff.scenario.startsWith('T03'));
	if (failed.length) {
		throw new Error(
			`${failed.length} failure-semantics calls diverge; first: ${failed[0].scenario} ${failed[0].call}\n  reference: ${failed[0].reference}\n  candidate: ${failed[0].candidate}`,
		);
	}
	return 'activation error name/message/node, close-error wrapping and post-state identical';
});

await gate('T04', 'activation validation differential: validateWorkflowHasTriggerLikeNode', () => {
	const definitions = { plain: {}, trigger: { trigger: async () => ({}) }, poll: { poll: async () => ({}) }, webhook: { webhook: async () => ({}) }, unknown: undefined };
	const nodeSets = [
		{ 'Plain': { name: 'Plain', type: 'plain' } },
		{ 'Trigger': { name: 'Trigger', type: 'trigger' } },
		{ 'Poll': { name: 'Poll', type: 'poll' } },
		{ 'Webhook': { name: 'Webhook', type: 'webhook' } },
		{ 'Unknown': { name: 'Unknown', type: 'unknown' } },
		{ 'Disabled trigger': { name: 'Disabled trigger', type: 'trigger', disabled: true } },
		{ 'Disabled trigger': { name: 'Disabled trigger', type: 'trigger', disabled: true }, 'Poll': { name: 'Poll', type: 'poll' } },
		{ 'Manual': { name: 'Manual', type: 'n8n-nodes-base.manualTrigger' } },
		{ 'Manual + trigger': { name: 'Manual', type: 'n8n-nodes-base.manualTrigger' }, 'T': { name: 'T', type: 'trigger' } },
	];
	const ignoreSets = [undefined, [], ['n8n-nodes-base.manualTrigger']];
	for (const nodes of nodeSets) {
		for (const ignore of ignoreSets) {
			const nodeTypes = { getByNameAndVersion: (type) => definitions[type] };
			const referenceValue = validateWorkflowHasTriggerLikeNode(nodes, nodeTypes, ignore);
			const candidateValue = candidate.validateWorkflowHasTriggerLikeNode(nodes, nodeTypes, ignore);
			compare('T04', 'validation', `nodes=${Object.keys(nodes).join('+')} ignore=${JSON.stringify(ignore)}`, referenceValue, candidateValue);
		}
	}
	const failed = differences.filter((diff) => diff.check === 'T04');
	if (failed.length) {
		throw new Error(`${failed.length} validation calls diverge; first: ${failed[0].call}\n  reference: ${failed[0].reference}\n  candidate: ${failed[0].candidate}`);
	}
	return `${comparisons.byCheck.T04} validation calls identical (${nodeSets.length} node maps x ${ignoreSets.length} ignore lists)`;
});

await gate('T05', 'cron helper differential: toCronExpression shapes', () => {
	const items = [
		{ mode: 'everyMinute' },
		{ mode: 'everyHour', minute: 15 },
		{ mode: 'everyX', unit: 'minutes', value: 5 },
		{ mode: 'everyX', unit: 'hours', value: 3 },
		{ mode: 'everyDay', minute: 30, hour: 4 },
		{ mode: 'everyWeek', minute: 0, hour: 9, weekday: 1 },
		{ mode: 'everyMonth', minute: 5, hour: 6, dayOfMonth: 12 },
		{ mode: 'custom', cronExpression: '  7 7 * * *  ' },
	];
	// Both implementations randomise fields with `Math.random()` (seconds, and a minute for
	// `everyX`/hours). Freezing it makes the comparison exact instead of "shape-equal".
	// Both implementations draw their random fields from `crypto.getRandomValues` (the reference
	// `randomInt` is crypto based, not `Math.random`) — freezing it makes the comparison exact.
	const withFrozenRandom = (value) => (fn) => {
		const original = globalThis.crypto.getRandomValues;
		globalThis.crypto.getRandomValues = (array) => {
			array[0] = value;
			return array;
		};
		try {
			return fn();
		} finally {
			globalThis.crypto.getRandomValues = original;
		}
	};
	for (const item of items) {
		for (const random of [0, 17, 12345]) {
			const referenceExpression = withFrozenRandom(random)(() => toCronExpression({ ...item }));
			const candidateExpression = withFrozenRandom(random)(() => candidate.toCronExpression({ ...item }));
			compare('T05', item.mode, `toCronExpression(${JSON.stringify(item)}) random=${random}`, referenceExpression, candidateExpression);
		}
	}
	const failed = differences.filter((diff) => diff.check === 'T05');
	if (failed.length) {
		throw new Error(`${failed.length} cron shapes diverge; first: ${failed[0].call}\n  reference: ${failed[0].reference}\n  candidate: ${failed[0].candidate}`);
	}
	return `${comparisons.byCheck.T05} cron expressions identical (crypto randomness frozen per call: the reference randomises seconds, and a minute for everyX/hours)`;
});

await gate('T06', 'Trigger LEGO unit suite PASS (packages/trigger-lego/test)', () => {
	const result = spawnSync(process.execPath, ['--test', 'test/*.test.mjs'], { cwd: TRIGGER_PKG, encoding: 'utf8', timeout: 300_000 });
	const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
	const pass = Number(/(?:^|\n)# pass (\d+)/.exec(output)?.[1] ?? 0);
	const fail = Number(/(^|\n)# fail (\d+)/.exec(output)?.[2] ?? 0);
	if (result.status !== 0 || fail !== 0 || pass === 0) throw new Error(`suite exited ${result.status} (${pass} pass / ${fail} fail)\n${output.slice(-700)}`);
	return `node --test test/*.test.mjs → ${pass}/${pass + fail} PASS`;
});

/* ---------------------------------------------------------------- */
/* evidence                                                          */
/* ---------------------------------------------------------------- */
const failedChecks = checks.filter((check) => check.status === 'FAIL');
const evidence = {
	generatedAt: new Date().toISOString(),
	phase: 'phase-5-trigger',
	lego: 'trigger',
	ports: ['P-TRIGGER-REGISTRY', 'P-TRIGGER-VALIDATION'],
	oracle: {
		core: `${corePackage}`,
		workflow: `${workflowPackage}`,
		version: reqCore(join(corePackage, 'package.json')).version,
	},
	scenarios: SCENARIOS.map((scenario) => scenario.id),
	comparisons,
	differences: differences.slice(0, 40),
	checks,
	verdict: failedChecks.length === 0 ? 'PASS' : 'FAIL',
};
mkdirSync(join(REPO, 'docs/isolation/evidence'), { recursive: true });
writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
void readFileSync;
void WorkflowActivationError;

if (!args.includes('--quiet')) {
	console.log(`\ntrigger lego: ${evidence.verdict} (${checks.length - failedChecks.length}/${checks.length} checks · ${comparisons.total} differential calls)`);
	if (differences.length) console.log(`first divergences: ${differences.slice(0, 3).map((diff) => `${diff.scenario} ${diff.call}`).join(' | ')}`);
	console.log('evidence: docs/isolation/evidence/trigger-lego-gate.json');
}
process.exit(failedChecks.length === 0 ? 0 : 1);
