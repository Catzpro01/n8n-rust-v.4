/**
 * POOL-003 — error & retry handling.
 * Pinned to workflow-execute.ts L1597-1865 (retry + continue-on-error) and
 * L2463-2570 (handleNodeErrorOutput), plus packages/workflow/src/errors/*.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	ApplicationError,
	NodeApiError,
	NodeOperationError,
	errorPassThrough,
	isSoftFailure,
	mergeErrorInformation,
	resolveErrorStrategy,
	resolveRetryPolicy,
	toExecutionError,
	withRetry,
} from '../src/index.mjs';
import { createWorkflow, executeWorkflow, itemsOf, node, taskOf, typeDefinition } from './helpers.mjs';

const MANUAL_TRIGGER = 'n8n-nodes-base.manualTrigger';
const FLAKY = 'n8n-nodes-base.flaky';
const AFTER = 'n8n-nodes-base.set';

function triggerType(items = [{ input: 'data' }]) {
	return typeDefinition(MANUAL_TRIGGER, {
		group: ['trigger'],
		execute: async () => [items.map((json) => ({ json }))],
	});
}

function flakyType(execute, outputs) {
	return typeDefinition(FLAKY, { execute, outputs });
}

function chainToFlaky(flakyNodeExtra = {}) {
	return createWorkflow({
		nodes: [node('Manual Trigger', MANUAL_TRIGGER), node('Flaky', FLAKY, {}, flakyNodeExtra), node('After', AFTER)],
		connections: {
			'Manual Trigger': { main: [[{ node: 'Flaky', type: 'main', index: 0 }]] },
			Flaky: { main: [[{ node: 'After', type: 'main', index: 0 }]] },
		},
		nodeTypes: {
			[MANUAL_TRIGGER]: triggerType(),
			[AFTER]: typeDefinition(AFTER, { execute: async function () { return [this.getInputData()]; } }),
		},
	});
}

test('resolveRetryPolicy clamps exactly like the reference source', () => {
	assert.deepEqual(resolveRetryPolicy({}), { maxTries: 1, waitBetweenTries: 0, retryOnFail: false });
	assert.deepEqual(resolveRetryPolicy({ retryOnFail: true }), {
		retryOnFail: true,
		maxTries: 3,
		waitBetweenTries: 1000,
	});
	assert.equal(resolveRetryPolicy({ retryOnFail: true, maxTries: 10 }).maxTries, 5, 'above the maximum');
	assert.equal(resolveRetryPolicy({ retryOnFail: true, maxTries: 1 }).maxTries, 2, 'below the minimum');
	assert.equal(resolveRetryPolicy({ retryOnFail: true, maxTries: 0 }).maxTries, 3, '|| falls back to the default');
	assert.equal(resolveRetryPolicy({ retryOnFail: true, waitBetweenTries: 9000 }).waitBetweenTries, 5000);
	assert.equal(resolveRetryPolicy({ retryOnFail: true, waitBetweenTries: 0 }).waitBetweenTries, 1000);
});

test('retryOnFail re-runs a throwing node until it succeeds', async () => {
	let attempts = 0;
	const workflow = chainToFlaky({ retryOnFail: true, maxTries: 3, waitBetweenTries: 1 });
	workflow.nodeTypes.register(FLAKY, 1, flakyType(async function () {
		attempts++;
		if (attempts < 3) throw new Error(`fail-${attempts}`);
		return [this.getInputData().map((item) => ({ json: { ...item.json, ok: true } }))];
	}));

	const { run } = await executeWorkflow(workflow);

	assert.equal(attempts, 3);
	assert.equal(run.status, 'success');
	assert.equal(run.data.resultData.runData.Flaky.length, 1, 'retries are not separate runs');
	assert.equal(run.data.resultData.runData.Flaky[0].executionStatus, 'success');
	assert.equal(itemsOf(run, 'Flaky')[0].json.ok, true);
	assert.equal(itemsOf(run, 'After').length, 1);
});

test('a returned { json: { error } } item is retried as a soft failure', async () => {
	let attempts = 0;
	const workflow = chainToFlaky({ retryOnFail: true, maxTries: 3, waitBetweenTries: 1 });
	workflow.nodeTypes.register(FLAKY, 1, flakyType(async function () {
		attempts++;
		if (attempts === 1) return [[{ json: { error: 'soft-failure' } }]];
		return [this.getInputData().map((item) => ({ json: { ...item.json, retried: true } }))];
	}));

	const { run } = await executeWorkflow(workflow);

	assert.equal(attempts, 2);
	assert.equal(run.status, 'success');
	assert.equal(itemsOf(run, 'Flaky')[0].json.retried, true);
});

test('an unrecovered soft failure is kept as a successful task holding the error (pinned quirk)', async () => {
	let attempts = 0;
	const workflow = chainToFlaky({ retryOnFail: true, maxTries: 3, waitBetweenTries: 1 });
	workflow.nodeTypes.register(FLAKY, 1, flakyType(async () => {
		attempts++;
		return [[{ json: { error: 'still-broken' } }]];
	}));

	const { run } = await executeWorkflow(workflow);

	assert.equal(attempts, 3, 'maxTries attempts in total');
	assert.equal(run.status, 'success', 'upstream records no executionError for soft failures');
	assert.equal(taskOf(run, 'Flaky').executionStatus, 'success');
	assert.deepEqual(itemsOf(run, 'Flaky')[0].json, { error: 'still-broken' });
	assert.equal(itemsOf(run, 'After')[0].json.error, 'still-broken');
});

test('exhausted retries with the default strategy stop the workflow at that node', async () => {
	let attempts = 0;
	const workflow = chainToFlaky({ retryOnFail: true, maxTries: 3, waitBetweenTries: 1 });
	workflow.nodeTypes.register(FLAKY, 1, flakyType(async () => {
		attempts++;
		throw new Error(`always-fails-${attempts}`);
	}));

	const { run } = await executeWorkflow(workflow);
	const task = taskOf(run, 'Flaky');

	assert.equal(attempts, 3);
	assert.equal(run.status, 'error');
	assert.equal(run.data.resultData.error.message, 'always-fails-3');
	assert.equal(run.data.resultData.error.name, 'Error');
	assert.equal(task.executionStatus, 'error');
	assert.equal(task.error.message, 'always-fails-3');
	assert.equal(run.data.resultData.runData.After, undefined, 'downstream nodes do not run');
	assert.equal(run.data.resultData.lastNodeExecuted, 'Flaky');
	assert.equal(run.data.executionData.nodeExecutionStack.length, 1, 'the failed entry stays for a restart');
	assert.equal(run.data.executionData.nodeExecutionStack[0].node.name, 'Flaky');
});

test("onError 'continueRegularOutput' passes the input data through and keeps running", async () => {
	let attempts = 0;
	const workflow = chainToFlaky({ retryOnFail: true, maxTries: 2, waitBetweenTries: 1, onError: 'continueRegularOutput' });
	workflow.nodeTypes.register(FLAKY, 1, flakyType(async () => {
		attempts++;
		throw new Error('continue-me');
	}));

	const { run } = await executeWorkflow(workflow);

	assert.equal(attempts, 2);
	assert.equal(run.status, 'success');
	assert.equal(taskOf(run, 'Flaky').executionStatus, 'error');
	assert.equal(taskOf(run, 'Flaky').error.message, 'continue-me');
	assert.deepEqual(itemsOf(run, 'Flaky')[0].json, { input: 'data' }, 'input items pass through');
	assert.equal(itemsOf(run, 'After').length, 1);
});

test('legacy continueOnFail behaves like continueRegularOutput', async () => {
	const workflow = chainToFlaky({ continueOnFail: true });
	workflow.nodeTypes.register(FLAKY, 1, flakyType(async () => {
		throw new Error('legacy');
	}));

	const { run } = await executeWorkflow(workflow);

	assert.equal(run.status, 'success');
	assert.equal(taskOf(run, 'Flaky').executionStatus, 'error');
	assert.equal(itemsOf(run, 'After').length, 1);
});

test("onError 'continueErrorOutput' moves error items to the last output", async () => {
	const workflow = createWorkflow({
		nodes: [
			node('Manual Trigger', MANUAL_TRIGGER),
			node('Splitter', FLAKY, {}, { onError: 'continueErrorOutput' }),
			node('OkBranch', AFTER),
			node('ErrorBranch', AFTER),
		],
		connections: {
			'Manual Trigger': { main: [[{ node: 'Splitter', type: 'main', index: 0 }]] },
			Splitter: {
				main: [
					[{ node: 'OkBranch', type: 'main', index: 0 }],
					[{ node: 'ErrorBranch', type: 'main', index: 0 }],
				],
			},
		},
		nodeTypes: {
			[MANUAL_TRIGGER]: triggerType([{ source: 'trigger' }]),
			[FLAKY]: flakyType(async function () {
				const [item] = this.getInputData();
				return [
					[
						{ ...item, json: { ok: true, source: item.json.source } },
						{ ...item, json: { error: 'item-level-failure' } },
					],
				];
			}, ['main', 'main']),
			[AFTER]: typeDefinition(AFTER, { execute: async function () { return [this.getInputData()]; } }),
		},
	});

	const { run } = await executeWorkflow(workflow);

	assert.equal(itemsOf(run, 'OkBranch').length, 1);
	assert.equal(itemsOf(run, 'OkBranch')[0].json.ok, true);
	assert.equal(itemsOf(run, 'ErrorBranch').length, 1);
	// The error item's json is merged onto the resolved paired item's json
	assert.deepEqual(itemsOf(run, 'ErrorBranch')[0].json, { source: 'trigger', error: 'item-level-failure' });
	assert.equal(itemsOf(run, 'Splitter', 0, 0).length, 1);
	assert.equal(itemsOf(run, 'Splitter', 0, 1).length, 1);
});

test('items carrying an error object are normalised to { json: { error } }', async () => {
	const workflow = chainToFlaky();
	workflow.nodeTypes.register(FLAKY, 1, flakyType(async () => [
		[{ json: { value: 1 }, error: new Error('node-level-error') }],
	]));

	const { run } = await executeWorkflow(workflow);
	const item = itemsOf(run, 'Flaky')[0];

	assert.deepEqual(item.json, { error: 'node-level-error' });
	assert.equal(item.error.message, 'node-level-error');
	assert.equal(run.status, 'success');
});

test('error policy helpers are pure and testable in isolation', async () => {
	assert.equal(resolveErrorStrategy({}).strategy, 'stopWorkflow');
	assert.equal(resolveErrorStrategy({ continueOnFail: true }).strategy, 'continueRegularOutput');
	assert.equal(resolveErrorStrategy({ onError: 'continueErrorOutput' }).strategy, 'continueErrorOutput');
	assert.equal(resolveErrorStrategy({ continueOnFail: true, onError: 'stopWorkflow' }).source, 'continueOnFail');

	assert.deepEqual(errorPassThrough({ data: { main: [[{ json: { a: 1 } }]] } }), [[{ json: { a: 1 } }]]);
	assert.equal(errorPassThrough({ data: { main: [null] } }), null);
	assert.equal(errorPassThrough({ data: {} }), null);

	assert.equal(isSoftFailure([[{ json: { error: 'x' } }]]), true);
	assert.equal(isSoftFailure([[{ json: {} }]]), false);
	assert.equal(isSoftFailure(null), false);

	const data = [[{ json: { keep: 1 } }, { json: { $error: new Error('wrapped'), $json: { keep: 2 } } }]];
	mergeErrorInformation(data);
	assert.deepEqual(data[0][0].json, { keep: 1 });
	assert.deepEqual(data[0][1].json, { error: 'wrapped' });
	assert.equal(data[0][1].error.message, 'wrapped');

	let attempts = 0;
	const failed = await withRetry({ retryOnFail: true, maxTries: 2, waitBetweenTries: 1 }, async () => {
		attempts++;
		throw new Error('nope');
	});
	assert.equal(attempts, 2);
	assert.equal(failed.exhausted, true);
	assert.equal(failed.error.message, 'nope');

	const succeeded = await withRetry({ retryOnFail: true, maxTries: 3, waitBetweenTries: 1 }, async (tryIndex) => {
		if (tryIndex < 2) throw new Error('again');
		return 'done';
	});
	assert.equal(succeeded.result, 'done');
	assert.equal(succeeded.attempts, 3);
});

test('error classes keep the fields run data needs', () => {
	const nodeRef = { name: 'Flaky', type: FLAKY, typeVersion: 1 };

	const operationError = new NodeOperationError(nodeRef, new Error('operation failed'), {
		description: 'human readable',
	});
	assert.equal(operationError.name, 'NodeOperationError');
	assert.equal(operationError.message, 'operation failed');
	assert.equal(operationError.description, 'human readable');
	assert.equal(operationError.tags.node, FLAKY);

	const apiError = new NodeApiError(nodeRef, { message: 'API failed', response: { status: 418, data: 'teapot' } });
	assert.equal(apiError.name, 'NodeApiError');
	assert.equal(apiError.httpCode, 418);
	assert.equal(apiError.errorResponse.status, 418);
	assert.equal(apiError.errorResponse.body, 'teapot');

	const serialised = toExecutionError(operationError);
	assert.equal(serialised.name, 'NodeOperationError');
	assert.equal(serialised.message, 'operation failed');
	assert.equal(serialised.description, 'human readable');
	assert.equal(typeof serialised.stack, 'string');
	assert.equal(toExecutionError(undefined), undefined);

	assert.equal(new ApplicationError('plain').level, 'error');
});
