/**
 * Reference-equivalence check — reconstructed engine vs the REAL n8n execution engine.
 *
 * The unit suite in `engine.test.mjs` asserts the reconstruction against the reference *source*.
 * This file asserts it against the reference *runtime*: the same workflow JSON is executed by
 * `WorkflowExecute` from the pinned n8n-core 2.9.1 (the dependency set of n8n 2.9.4) and by
 * `WorkflowExecutionEngine`, and the two are compared.
 *
 * What is compared (engine orchestration, which is what this package reconstructs):
 *   - the order in which nodes are executed (`ITaskData.executionIndex`, interfaces.ts:2677)
 *   - how many times each node runs (`runData[name].length`)
 *   - how many items each node emits (`runData[name][i].data.main[0].length`)
 *   - whether the run ended in error (`resultData.error`)
 *
 * What is NOT compared: node *implementations*. The reconstruction takes node logic from
 * registered handlers by design, so both sides are given behaviourally identical stubs
 * (manualTrigger → 1 item, set → 1 item, noOp → passthrough). Comparing node logic belongs to
 * the Node LEGO (packages/nodes-base), not to this engine.
 *
 * `engine:test` skips when the runtime is absent; `engine:test:strict` fails instead and is the
 * integration/merge path. Install with `scripts/setup-reference-runtime.sh`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WorkflowExecutionEngine } from '../runner.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const RUNTIME = process.env.LEGO_LIVE_RUNTIME ?? join(REPO, '.runtime', 'node_modules');
const runtimeReady =
	existsSync(join(RUNTIME, 'n8n-workflow', 'package.json')) &&
	existsSync(join(RUNTIME, 'n8n-core', 'package.json')) &&
	existsSync(join(RUNTIME, 'n8n-nodes-base', 'package.json'));

const missingRuntimeMessage =
	`pinned reference runtime not installed at ${RUNTIME} (run scripts/setup-reference-runtime.sh)`;
if (!runtimeReady && process.env.REQUIRE_REFERENCE_RUNTIME === '1') {
	throw new Error(missingRuntimeMessage);
}
const skipReason = runtimeReady ? false : missingRuntimeMessage;

/* ---------- reference side: real n8n-core WorkflowExecute ------------- */
let referenceApi = null;
async function loadReference() {
	if (referenceApi) return referenceApi;
	// n8n 2.x runs Code nodes out of process; the harness in tools/live disables the broker.
	process.env.N8N_RUNNERS_ENABLED ??= 'false';
	process.env.N8N_RUNNERS_TASK_BROKER_URI ??= '';

	const req = createRequire(join(RUNTIME, 'package.json'));
	const core = req('n8n-core');
	const wf = req('n8n-workflow');

	const loader = new core.PackageDirectoryLoader(join(RUNTIME, 'n8n-nodes-base'));
	await loader.loadAll();
	const byShortName = loader.nodeTypes;
	const known = loader.known?.nodes ?? {};

	const resolveEntry = (type) => {
		if (known[type]) {
			const { className } = known[type];
			if (className && byShortName[className]) return byShortName[className];
		}
		const short = type.includes('.') ? type.split('.').slice(1).join('.') : type;
		return byShortName[short] ?? byShortName[short.charAt(0).toLowerCase() + short.slice(1)] ?? null;
	};

	const additionalData = new Proxy(
		{
			credentialsHelper: {
				getDecrypted: async () => ({}),
				getCredentialsProperties: () => [],
				getParentTypes: () => [],
				authenticate: async () => ({}),
			},
			executeWorkflow: async () => {
				throw new Error('sub-workflow execution is out of scope');
			},
			getRunExecutionData: async () => undefined,
			hooks: { runHook: async () => undefined },
			httpRequest: async () => ({}),
			externalHooks: {},
			executionId: '1',
			instanceBaseUrl: 'http://127.0.0.1:5678/',
			restApiUrl: 'http://127.0.0.1:5678/rest',
			mode: 'manual',
			workflowSettings: {},
			staticData: undefined,
			isTest: false,
		},
		{
			get(target, prop) {
				if (prop in target) return target[prop];
				if (typeof prop === 'string' && /^get|^run|^send|^save|^update|^log|^is[A-Z]/.test(prop)) {
					return async () => undefined;
				}
				return undefined;
			},
		},
	);

	referenceApi = {
		async run(json, { additionalData: addExtra = {} } = {}) {
			const registry = {
				getByNameAndVersion(type, version) {
					const entry = resolveEntry(type);
					if (!entry) return undefined;
					return wf.NodeHelpers.getVersionedNodeType(entry.type, version);
				},
			};
			const workflow = new wf.Workflow({
				id: json.id ?? 'equivalence',
				name: json.name ?? 'equivalence',
				nodes: JSON.parse(JSON.stringify(json.nodes ?? [])),
				connections: JSON.parse(JSON.stringify(json.connections ?? {})),
				active: true,
				nodeTypes: registry,
				settings: json.settings ?? { executionOrder: 'v1' },
			});
			const execute = new core.WorkflowExecute({ ...additionalData, ...addExtra }, 'manual');
			// pinData belongs on run(), not on the Workflow (workflow-execute.ts:123-130, :182)
			const run = await execute.run({
				workflow,
				startNode: workflow.getStartNode(),
				pinData: json.pinData,
			});
			return { resultData: run.data.resultData, status: run.status };
		},
	};
	return referenceApi;
}

/* ---------- reconstructed side: identical node behaviour -------------- */
function reconstructedRun(json, { options = {} } = {}) {
	const engine = new WorkflowExecutionEngine(json);
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [{ json: {} }]);
	// Set v3.4 in `manual` mode with `includeOtherFields: false`: one item per input item, built
	// from the assignment list, with `pairedItem` stamped by the node itself. The fixtures only
	// use constant values, so no expression evaluation is needed to match the real node.
	engine.registerNodeType(
		'n8n-nodes-base.set',
		async (node, items) => {
			const json = {};
			for (const assignment of node.parameters?.assignments?.assignments ?? []) {
				json[assignment.name] =
					assignment.type === 'object'
						? JSON.parse(assignment.value)
						: assignment.type === 'number'
							? Number(assignment.value)
							: assignment.value;
			}
			return (items.length ? items : [{ json: {} }]).map((input, index) => ({
				json: { ...json },
				pairedItem: { item: index },
			}));
		},
		{ inputs: ['main'], outputs: ['main'] }, // the real Set node declares one main output
	);
	engine.registerNodeType('n8n-nodes-base.noOp', async (_n, items) => items);
	// Stop and Error v1 throws the configured message and declares `outputs: []`.
	engine.registerNodeType(
		'n8n-nodes-base.stopAndError',
		async (node) => {
			throw new Error(node.parameters?.errorMessage ?? 'An error occurred!');
		},
		{ inputs: ['main'], outputs: [] },
	);
	// Limit v1 keeps the first `maxItems` items — the fixture uses maxItems: 0 to produce an
	// empty output deterministically, which is what the alwaysOutputData case needs.
	engine.registerNodeType('n8n-nodes-base.limit', async (_n, items) =>
		items.slice(0, Number(_n.parameters?.maxItems ?? items.length)),
	);
	return engine.runWorkflow(null, [{}], options);
}

/** Payload-only view — both engines decorate items with pairedItem (:1736). */
const payloadOf = (resultData, node, runIndex = 0) =>
	(resultData.runData?.[node]?.[runIndex]?.data?.main?.[0] ?? []).map((i) => i.json);

/** Flatten both engines into the same comparable shape. */
function shape(resultData) {
	const runData = resultData.runData ?? {};
	const ordered = Object.entries(runData)
		.flatMap(([name, runs]) => runs.map((run, i) => ({ name, runIndex: i, run })))
		.sort((a, b) => a.run.executionIndex - b.run.executionIndex);
	return {
		order: ordered.map((e) => e.name),
		runsPerNode: Object.fromEntries(ordered.map((e) => [e.name, runData[e.name].length])),
		itemCounts: Object.fromEntries(
			ordered.map((e) => [e.name, e.run.data?.main?.[0]?.length ?? 0]),
		),
		failed: Boolean(resultData.error),
	};
}

const manualTrigger = (id, name, position) => ({
	id,
	name,
	type: 'n8n-nodes-base.manualTrigger',
	typeVersion: 1,
	position,
	parameters: {},
});
const setNode = (id, name, position) => ({
	id,
	name,
	type: 'n8n-nodes-base.set',
	typeVersion: 3.4,
	position,
	parameters: {
		mode: 'manual',
		includeOtherFields: false,
		assignments: {
			assignments: [
				{ id: `${id}a`, name: 'status', value: 'ok', type: 'string' },
				{ id: `${id}b`, name: 'count', value: 42, type: 'number' },
			],
		},
		options: {},
	},
});
const noOp = (id, name, position) => ({
	id,
	name,
	type: 'n8n-nodes-base.noOp',
	typeVersion: 1,
	position,
	parameters: {},
});
const edge = (node, index = 0) => ({ node, type: 'main', index });

const LINEAR = {
	id: 'eq-linear',
	name: 'Equivalence — linear',
	nodes: [manualTrigger('t', 'Manual Trigger', [0, 0]), setNode('s', 'Set', [200, 0]), noOp('n', 'NoOp', [400, 0])],
	connections: {
		'Manual Trigger': { main: [[edge('Set')]] },
		Set: { main: [[edge('NoOp')]] },
	},
};

const FANOUT = {
	id: 'eq-fanout',
	name: 'Equivalence — fan-out',
	nodes: [
		manualTrigger('t', 'Manual Trigger', [0, 0]),
		setNode('a', 'Lower', [200, 200]), // lower on the canvas
		setNode('b', 'Upper', [200, -200]), // higher on the canvas
		noOp('na', 'NoOp Lower', [400, 200]),
		noOp('nb', 'NoOp Upper', [400, -200]),
	],
	connections: {
		'Manual Trigger': { main: [[edge('Lower'), edge('Upper')]] },
		Lower: { main: [[edge('NoOp Lower')]] },
		Upper: { main: [[edge('NoOp Upper')]] },
	},
};

test('EQUIVALENCE linear: Manual Trigger → Set → NoOp matches the reference engine', { timeout: 120000, skip: skipReason }, async () => {
	const reference = shape((await (await loadReference()).run(LINEAR)).resultData);
	const reconstructed = shape((await reconstructedRun(LINEAR)).resultData);

	assert.deepEqual(reconstructed.order, reference.order);
	assert.deepEqual(reconstructed.runsPerNode, reference.runsPerNode);
	assert.deepEqual(reconstructed.itemCounts, reference.itemCounts);
	assert.equal(reconstructed.failed, reference.failed);
	assert.deepEqual(reconstructed.order, ['Manual Trigger', 'Set', 'NoOp']);
});

test('EQUIVALENCE fan-out (v1): top-left-first ordering matches the reference engine', { timeout: 120000, skip: skipReason }, async () => {
	const reference = shape((await (await loadReference()).run(FANOUT)).resultData);
	const reconstructed = shape((await reconstructedRun(FANOUT)).resultData);

	assert.deepEqual(
		reconstructed.order,
		reference.order,
		'workflow-execute.ts:2041-2055 sorts the nodes to add by canvas position',
	);
	assert.deepEqual(reconstructed.itemCounts, reference.itemCounts);
	assert.equal(reconstructed.failed, reference.failed);
});

test('EQUIVALENCE fan-out (v0): FIFO ordering matches the reference engine', { timeout: 120000, skip: skipReason }, async () => {
	const json = { ...FANOUT, id: 'eq-fanout-v0', settings: { executionOrder: 'v0' } };
	const reference = shape((await (await loadReference()).run(json)).resultData);
	const reconstructed = shape((await reconstructedRun(json)).resultData);

	assert.deepEqual(reconstructed.order, reference.order, 'workflow-execute.ts:417 — v0 pushes (FIFO)');
	assert.deepEqual(reconstructed.itemCounts, reference.itemCounts);
	assert.notDeepEqual(reference.order, shape((await (await loadReference()).run(FANOUT)).resultData).order, 'v0 and v1 really do differ, so the comparison is meaningful');
});

test('EQUIVALENCE start selection: manual trigger wins even when an ordinary node is first', { timeout: 120000, skip: skipReason }, async () => {
	const json = {
		id: 'eq-start-order',
		name: 'Equivalence — start-node order',
		nodes: [noOp('n', 'Ordinary First', [200, 0]), manualTrigger('t', 'Manual Trigger', [0, 0])],
		connections: { 'Manual Trigger': { main: [[edge('Ordinary First')]] } },
	};
	const reference = shape((await (await loadReference()).run(json)).resultData);
	const reconstructed = shape((await reconstructedRun(json)).resultData);

	assert.deepEqual(reference.order, ['Manual Trigger', 'Ordinary First']);
	assert.deepEqual(reconstructed.order, reference.order);
});

/* ------------------------------------------------------------------ *
 * disabled nodes, pin data, alwaysOutputData, timeout, pairedItem — real engine
 * ------------------------------------------------------------------ */

const PINNED = {
	id: 'eq-pin',
	name: 'Equivalence — pin data',
	nodes: [manualTrigger('t', 'Manual Trigger', [0, 0]), setNode('s', 'Set', [200, 0]), noOp('n', 'After', [400, 0])],
	connections: {
		'Manual Trigger': { main: [[edge('Set')]] },
		Set: { main: [[edge('After')]] },
	},
	pinData: { Set: [{ json: { pinned: true } }] },
};

const DISABLED_WITH_PIN = {
	...PINNED,
	id: 'eq-disabled-pin',
	name: 'Equivalence — disabled node ignores pin data',
	nodes: PINNED.nodes.map((node) =>
		node.name === 'Set' ? { ...node, disabled: true } : node,
	),
};

test('EQUIVALENCE disabled node: first input passes through and pin data is ignored', { timeout: 120000, skip: skipReason }, async () => {
	const api = await loadReference();
	const reference = (await api.run(DISABLED_WITH_PIN)).resultData;
	const reconstructed = (await reconstructedRun(DISABLED_WITH_PIN)).resultData;

	assert.deepEqual(payloadOf(reference, 'Set'), [{}], 'sanity: reference ignored the pinned Set output');
	assert.deepEqual(
		reconstructed.runData.Set[0].data.main[0],
		reference.runData.Set[0].data.main[0],
		'disabled passthrough preserves the same item metadata',
	);
	assert.deepEqual(payloadOf(reconstructed, 'After'), payloadOf(reference, 'After'));
	assert.deepEqual(shape(reconstructed), shape(reference));
});

test('EQUIVALENCE pinData: the pinned node is not executed and its pinned output flows on', { timeout: 120000, skip: skipReason }, async () => {
	const api = await loadReference();
	const reference = (await api.run(PINNED)).resultData;
	const reconstructed = (await reconstructedRun(PINNED)).resultData;

	assert.deepEqual(payloadOf(reference, 'Set'), [{ pinned: true }], 'sanity: the reference really used the pin');
	assert.deepEqual(payloadOf(reconstructed, 'Set'), payloadOf(reference, 'Set'));
	assert.deepEqual(payloadOf(reconstructed, 'After'), payloadOf(reference, 'After'));
	assert.deepEqual(shape(reconstructed).order, shape(reference).order);
	assert.equal(reconstructed.runData.Set[0].executionStatus, 'success');
	assert.equal(reference.runData.Set[0].executionStatus, 'success');
});

const ALWAYS_OUTPUT = (alwaysOutputData) => ({
	id: 'eq-always',
	name: 'Equivalence — alwaysOutputData',
	nodes: [
		manualTrigger('t', 'Manual Trigger', [0, 0]),
		{
			id: 'l',
			name: 'Lim',
			type: 'n8n-nodes-base.limit',
			typeVersion: 1,
			position: [200, 0],
			parameters: { maxItems: 0 }, // deterministic empty output
			...(alwaysOutputData ? { alwaysOutputData: true } : {}),
		},
		setNode('a', 'After', [400, 0]),
	],
	connections: {
		'Manual Trigger': { main: [[edge('Lim')]] },
		Lim: { main: [[edge('After')]] },
	},
});

test('EQUIVALENCE alwaysOutputData: empty output emits one empty paired item and the branch continues', { timeout: 120000, skip: skipReason }, async () => {
	const api = await loadReference();
	const withFlag = ALWAYS_OUTPUT(true);

	const refRun = await api.run(withFlag);
	const myRun = await reconstructedRun(withFlag);

	assert.deepEqual(shape(myRun.resultData).order, shape(refRun.resultData).order);
	assert.deepEqual(shape(myRun.resultData).order, ['Manual Trigger', 'Lim', 'After']);
	// the reference emits exactly [{ json: {}, pairedItem: [{ item: 0, input: 0 }] }]
	assert.deepEqual(myRun.resultData.runData.Lim[0].data.main[0], refRun.resultData.runData.Lim[0].data.main[0]);

	const withoutFlag = ALWAYS_OUTPUT(false);
	const refNo = await api.run(withoutFlag);
	const myNo = await reconstructedRun(withoutFlag);
	assert.deepEqual(shape(myNo.resultData).order, shape(refNo.resultData).order);
	assert.deepEqual(shape(myNo.resultData).order, ['Manual Trigger', 'Lim'], 'without the flag the branch ends');
});

test('EQUIVALENCE timeout: an elapsed executionTimeoutTimestamp cancels the run with no node executed', { timeout: 120000, skip: skipReason }, async () => {
	const api = await loadReference();
	const deadline = { executionTimeoutTimestamp: Date.now() - 1 };

	const refRun = await api.run(LINEAR, { additionalData: deadline });
	const myRun = await reconstructedRun(LINEAR, { options: deadline });

	assert.equal(refRun.status, 'canceled');
	assert.equal(myRun.status, refRun.status);
	assert.equal(myRun.timedOut, true);
	assert.deepEqual(Object.keys(myRun.resultData.runData), Object.keys(refRun.resultData.runData));
	assert.deepEqual(shape(myRun.resultData).order, shape(refRun.resultData).order);
});

test('EQUIVALENCE pairedItem: output items are decorated the same way as the reference', { timeout: 120000, skip: skipReason }, async () => {
	const api = await loadReference();
	const refRun = (await api.run(LINEAR)).resultData;
	const myRun = (await reconstructedRun(LINEAR)).resultData;

	for (const node of ['Manual Trigger', 'Set', 'NoOp']) {
		assert.deepEqual(
			(myRun.runData[node][0].data.main[0] ?? []).map((i) => i.pairedItem),
			(refRun.runData[node][0].data.main[0] ?? []).map((i) => i.pairedItem),
			`pairedItem differs on "${node}"`,
		);
	}
});

/* ------------------------------------------------------------------ *
 * node error handling — vs the real engine
 * ------------------------------------------------------------------ */

const stopAndError = (name, extra = {}) => ({
	id: name,
	name,
	type: 'n8n-nodes-base.stopAndError',
	typeVersion: 1,
	position: [200, 0],
	parameters: { errorType: 'errorMessage', errorMessage: 'kaboom' },
	...extra,
});

const setWith = (id, name, position, assignments, extra = {}) => ({
	id,
	name,
	type: 'n8n-nodes-base.set',
	typeVersion: 3.4,
	position,
	parameters: {
		mode: 'manual',
		includeOtherFields: false,
		options: {},
		assignments: { assignments: assignments.map((a, i) => ({ id: `${id}${i}`, ...a })) },
	},
	...extra,
});

/** Outputs of one run of one node, payload-only, one entry per output index. */
const outputsOf = (resultData, node, runIndex = 0) =>
	(resultData.runData?.[node]?.[runIndex]?.data?.main ?? []).map((output) =>
		(output ?? []).map((i) => i.json),
	);

const RETRY = {
	id: 'eq-retry',
	name: 'Equivalence — retryOnFail',
	nodes: [
		manualTrigger('t', 'Manual Trigger', [0, 0]),
		stopAndError('Boom', { retryOnFail: true, maxTries: 3, waitBetweenTries: 200 }),
		noOp('n', 'After', [400, 0]),
	],
	connections: {
		'Manual Trigger': { main: [[edge('Boom')]] },
		Boom: { main: [[edge('After')]] },
	},
};

test('EQUIVALENCE retryOnFail: the same retry budget, the same wait, the same failure', { timeout: 120000, skip: skipReason }, async () => {
	const api = await loadReference();

	const refStarted = Date.now();
	const reference = await api.run(RETRY);
	const refMs = Date.now() - refStarted;

	const recStarted = Date.now();
	const reconstructed = await reconstructedRun(RETRY);
	const recMs = Date.now() - recStarted;

	assert.equal(reference.status, 'error', 'sanity: the reference really failed');
	assert.equal(reconstructed.status, reference.status);
	assert.equal(reconstructed.resultData.error.message, reference.resultData.error.message);
	assert.deepEqual(shape(reconstructed.resultData).order, shape(reference.resultData).order);
	assert.equal(reconstructed.resultData.runData.After, undefined, 'nothing runs after the failure');

	// maxTries 3 means 3 attempts and 2 waits of 200 ms on BOTH sides (:1600-1613). The elapsed
	// time is the observable proof that the retry loop ran the same number of times.
	assert.ok(refMs >= 380, `reference waited twice, took ${refMs} ms`);
	assert.ok(recMs >= 380, `reconstruction waited twice, took ${recMs} ms`);
	assert.ok(
		Math.abs(recMs - refMs) < 250,
		`reconstruction ${recMs} ms vs reference ${refMs} ms — the wait budget must match`,
	);
});

const CONTINUE_REGULAR = {
	...RETRY,
	id: 'eq-continue-regular',
	name: 'Equivalence — continueRegularOutput',
	nodes: [
		manualTrigger('t', 'Manual Trigger', [0, 0]),
		stopAndError('Boom', { onError: 'continueRegularOutput' }),
		noOp('n', 'After', [400, 0]),
	],
};

test('EQUIVALENCE onError=continueRegularOutput: the input passes through and the run succeeds', { timeout: 120000, skip: skipReason }, async () => {
	const api = await loadReference();
	const reference = await api.run(CONTINUE_REGULAR);
	const reconstructed = await reconstructedRun(CONTINUE_REGULAR);

	assert.equal(reference.status, 'success', 'sanity: the reference kept going');
	assert.equal(reconstructed.status, reference.status);
	assert.equal(reconstructed.resultData.error, reference.resultData.error ?? undefined);
	assert.deepEqual(shape(reconstructed.resultData).order, shape(reference.resultData).order);
	assert.equal(reconstructed.resultData.runData.Boom[0].executionStatus, 'error');
	assert.equal(
		reconstructed.resultData.runData.Boom[0].error.message,
		reference.resultData.runData.Boom[0].error.message,
	);
	assert.deepEqual(payloadOf(reconstructed.resultData, 'After'), payloadOf(reference.resultData, 'After'));
});

const ERROR_OUTPUT = {
	id: 'eq-error-output',
	name: 'Equivalence — continueErrorOutput',
	nodes: [
		manualTrigger('t', 'Manual Trigger', [0, 0]),
		setWith('s', 'Splitter', [200, 0], [{ name: 'error', value: 'soft-boom', type: 'string' }], {
			onError: 'continueErrorOutput',
		}),
		noOp('ok', 'Ok', [400, -100]),
		noOp('err', 'Err', [400, 100]),
	],
	connections: {
		'Manual Trigger': { main: [[edge('Splitter')]] },
		Splitter: { main: [[edge('Ok')], [edge('Err')]] },
	},
};

test('EQUIVALENCE onError=continueErrorOutput: failed items are routed to the error output', { timeout: 120000, skip: skipReason }, async () => {
	const api = await loadReference();
	const reference = await api.run(ERROR_OUTPUT);
	const reconstructed = await reconstructedRun(ERROR_OUTPUT);

	assert.deepEqual(outputsOf(reference.resultData, 'Splitter'), [[], [{ error: 'soft-boom' }]], 'sanity: the reference routed the item');
	assert.deepEqual(outputsOf(reconstructed.resultData, 'Splitter'), outputsOf(reference.resultData, 'Splitter'));
	assert.deepEqual(shape(reconstructed.resultData).order, shape(reference.resultData).order);
	assert.deepEqual(payloadOf(reconstructed.resultData, 'Err'), payloadOf(reference.resultData, 'Err'));
	assert.equal(reconstructed.resultData.runData.Ok, undefined, 'the success output stayed empty');
});

const DOLLAR_ERROR = {
	id: 'eq-dollar-error',
	name: 'Equivalence — inline $error',
	nodes: [
		manualTrigger('t', 'Manual Trigger', [0, 0]),
		setWith('d', 'Dollar', [200, 0], [
			{ name: '$error', value: '{"message":"dollar-boom"}', type: 'object' },
			{ name: '$json', value: '{"a":1}', type: 'object' },
		]),
	],
	connections: { 'Manual Trigger': { main: [[edge('Dollar')]] } },
};

test('EQUIVALENCE inline $error/$json collapses into item.error on both engines', { timeout: 120000, skip: skipReason }, async () => {
	const api = await loadReference();
	const reference = await api.run(DOLLAR_ERROR);
	const reconstructed = await reconstructedRun(DOLLAR_ERROR);

	assert.deepEqual(payloadOf(reference.resultData, 'Dollar'), [{ error: 'dollar-boom' }], 'sanity: the reference collapsed it');
	assert.deepEqual(payloadOf(reconstructed.resultData, 'Dollar'), payloadOf(reference.resultData, 'Dollar'));
	assert.equal(
		reconstructed.resultData.runData.Dollar[0].data.main[0][0].error.message,
		reference.resultData.runData.Dollar[0].data.main[0][0].error.message,
	);
	assert.equal(reconstructed.status, reference.status);
});
