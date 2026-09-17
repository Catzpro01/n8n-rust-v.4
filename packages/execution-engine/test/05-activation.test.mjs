/**
 * ACTIVATION-01 — ActiveWorkflows / TriggersAndPollers / TriggerContext.
 *
 * Oracle: the two reference test files, ported case by case:
 *   reference/n8n/packages/core/src/execution-engine/__tests__/triggers-and-pollers.test.ts
 *   reference/n8n/packages/core/src/execution-engine/__tests__/active-workflows.test.ts
 * Every assertion cites the reference line range it pins; pinned quirks are marked.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	ActiveWorkflows,
	ApplicationError,
	ExecutionLifecycleHooks,
	NodeTypesRegistry,
	ReconstructedWorkflow,
	ScheduledTaskManager,
	TriggerCloseError,
	TriggerContext,
	TriggersAndPollers,
	UserError,
	WorkflowActivationError,
	WorkflowDeactivationError,
	createDeferredPromise,
	toCronExpression,
} from '../src/index.mjs';

// --- fixtures ----------------------------------------------------------------
const node = (name, type, extra = {}) => ({ id: `id-${name}`, name, type, typeVersion: 1, parameters: {}, ...extra });

function buildWorkflow(nodes, types) {
	const registry = new NodeTypesRegistry();
	for (const [type, definition] of Object.entries(types)) registry.register(type, 1, definition);
	return new ReconstructedWorkflow({
		id: 'wf-1',
		name: 'activation test',
		settings: { timezone: 'Europe/Berlin' },
		nodes,
		connections: {},
		nodeTypes: registry,
	});
}

const throwingLogger = () => ({ debug() {}, info() {}, warn() {}, error() {} });

// --- TriggersAndPollers ------------------------------------------------------
test('runTrigger throws an ApplicationError when the node type has no trigger (oracle: "should throw error if node type does not have trigger function")', async () => {
	const workflow = buildWorkflow([node('Trigger', 'no-trigger')], {
		'no-trigger': { description: { name: 'no-trigger', properties: {}, inputs: [], outputs: [] }, execute: async () => [] },
	});
	const triggersAndPollers = new TriggersAndPollers();

	await assert.rejects(
		() => triggersAndPollers.runTrigger(workflow, node('Trigger', 'no-trigger'), () => ({}), {}, 'trigger', 'init'),
		(error) => {
			assert.ok(error instanceof ApplicationError);
			assert.equal(error.message, 'Node type does not have a trigger function defined');
			assert.deepEqual(error.extra, { nodeName: 'Trigger' });
			assert.deepEqual(error.tags, { nodeType: 'no-trigger' });
			return true;
		},
	);
});

test('runTrigger calls the trigger function in non-manual mode and returns its response (oracle: "should call trigger function in regular mode")', async () => {
	let received = null;
	const workflow = buildWorkflow([node('Trigger', 'webhook-ish')], {
		'webhook-ish': {
			description: { name: 'webhook-ish', properties: {}, inputs: [], outputs: [] },
			trigger: async function () { received = this; return { test: true }; },
		},
	});
	const triggersAndPollers = new TriggersAndPollers();

	const result = await triggersAndPollers.runTrigger(workflow, node('Trigger', 'webhook-ish'), () => ({ marker: 1 }), {}, 'trigger', 'init');

	assert.deepEqual(result, { test: true });
	assert.equal(result.manualTriggerResponse, undefined, 'no manualTriggerResponse outside manual mode');
	assert.deepEqual(received, { marker: 1 }, 'trigger runs with `this` bound to the functions object');
});

test('manual mode: emit() resolves manualTriggerResponse and binds sendResponse/workflowExecuteAfter to the caller’s deferred promises (oracle: manual-mode block)', async () => {
	const emitted = [[{ json: { data: 'test' } }]];
	let triggerFunctions = null;
	const workflow = buildWorkflow([node('Trigger', 'manual-ish')], {
		'manual-ish': {
			description: { name: 'manual-ish', properties: {}, inputs: [], outputs: [] },
			trigger: async function () { triggerFunctions = this; return { workflowId: '123' }; },
		},
	});
	const hooks = new ExecutionLifecycleHooks('manual', 'exec-1', { id: 'wf-1' });
	const triggersAndPollers = new TriggersAndPollers();

	const response = await triggersAndPollers.runTrigger(
		workflow, node('Trigger', 'manual-ish'), () => triggerFunctions ?? {}, { hooks }, 'manual', 'init',
	);

	assert.ok(response.manualTriggerResponse instanceof Promise);

	const responsePromise = createDeferredPromise();
	const donePromise = createDeferredPromise();
	triggerFunctions.emit(emitted, responsePromise, donePromise);

	assert.deepEqual(await response.manualTriggerResponse, emitted, 'emit resolves the manual response with its data');

	const completion = { data: { resultData: { runData: {} } } };
	await hooks.runHook('sendResponse', [{ testResponse: true }]);
	await hooks.runHook('workflowExecuteAfter', [completion, {}]);

	assert.deepEqual(await responsePromise.promise, { testResponse: true });
	assert.equal(await donePromise.promise, completion);
});

test('manual mode: emitError() rejects manualTriggerResponse (oracle: "should handle error emission")', async () => {
	const testError = new Error('Test error');
	let triggerFunctions = null;
	const workflow = buildWorkflow([node('Trigger', 'manual-ish')], {
		'manual-ish': {
			description: { name: 'manual-ish', properties: {}, inputs: [], outputs: [] },
			trigger: async function () { triggerFunctions = this; return { workflowId: '123' }; },
		},
	});
	const hooks = new ExecutionLifecycleHooks('manual', 'exec-1', {});
	const triggersAndPollers = new TriggersAndPollers();

	const response = await triggersAndPollers.runTrigger(
		workflow, node('Trigger', 'manual-ish'), () => triggerFunctions ?? {}, { hooks }, 'manual', 'init',
	);
	triggerFunctions.emitError(testError, { resolve() {}, reject() {} });

	await assert.rejects(() => response.manualTriggerResponse, /Test error/);
});

test('manual mode: saveFailedExecution rejects the manual response (pinned: the reference maps it to reject, triggers-and-pollers.ts L84-86)', async () => {
	let triggerFunctions = null;
	const workflow = buildWorkflow([node('Trigger', 'manual-ish')], {
		'manual-ish': {
			description: { name: 'manual-ish', properties: {}, inputs: [], outputs: [] },
			trigger: async function () { triggerFunctions = this; return {}; },
		},
	});
	const triggersAndPollers = new TriggersAndPollers();

	const response = await triggersAndPollers.runTrigger(
		workflow, node('Trigger', 'manual-ish'), () => triggerFunctions ?? {}, { hooks: new ExecutionLifecycleHooks('manual', 'e', {}) }, 'manual', 'init',
	);
	triggerFunctions.saveFailedExecution(new Error('failed to save'));

	await assert.rejects(() => response.manualTriggerResponse, /failed to save/);
});

test('manual mode without lifecycle hooks rejects the manual response like the reference assert (triggers-and-pollers.ts L50)', async () => {
	const workflow = buildWorkflow([node('Trigger', 'manual-ish')], {
		'manual-ish': {
			description: { name: 'manual-ish', properties: {}, inputs: [], outputs: [] },
			trigger: async () => ({ workflowId: '123' }),
		},
	});
	const triggersAndPollers = new TriggersAndPollers();

	// The reference `assert.ok(hooks, ...)` runs inside the Promise executor, so the
	// failure surfaces as a rejected manualTriggerResponse (not as a thrown runTrigger)
	// and the emit/emitError overrides are never applied.
	const response = await triggersAndPollers.runTrigger(
		workflow, node('Trigger', 'manual-ish'), () => ({ emit() {}, emitError() {}, saveFailedExecution() {} }), {}, 'manual', 'init',
	);
	await assert.rejects(() => response.manualTriggerResponse, /Execution lifecycle hooks are not defined/);
});

test('runPoll throws without a poll function, returns the poll result verbatim (null included) and propagates errors (oracle: runPoll block)', async () => {
	const triggersAndPollers = new TriggersAndPollers();

	const noPoll = buildWorkflow([node('Poller', 'no-poll')], {
		'no-poll': { description: { name: 'no-poll', properties: {}, inputs: [], outputs: [] }, execute: async () => [] },
	});
	await assert.rejects(
		() => triggersAndPollers.runPoll(noPoll, node('Poller', 'no-poll'), {}),
		(error) => error instanceof ApplicationError && error.message === 'Node type does not have a poll function defined',
	);

	let result = [[{ json: { data: 'test' } }]];
	const poller = buildWorkflow([node('Poller', 'poll')], {
		'poll': { description: { name: 'poll', properties: {}, inputs: [], outputs: [] }, poll: async () => result },
	});
	assert.equal(await triggersAndPollers.runPoll(poller, node('Poller', 'poll'), {}), result);

	const nullPoller = buildWorkflow([node('Poller', 'poll')], {
		'poll': { description: { name: 'poll', properties: {}, inputs: [], outputs: [] }, poll: async () => null },
	});
	assert.equal(await triggersAndPollers.runPoll(nullPoller, node('Poller', 'poll'), {}), null);

	const failing = buildWorkflow([node('Poller', 'poll')], {
		'poll': { description: { name: 'poll', properties: {}, inputs: [], outputs: [] }, poll: async () => { throw new Error('Poll function failed'); } },
	});
	await assert.rejects(() => triggersAndPollers.runPoll(failing, node('Poller', 'poll'), {}), /Poll function failed/);
});

// --- ActiveWorkflows ---------------------------------------------------------
function activationHarness({ nodes, types, pollTimes = null, pollResults = [null], registerCron, triggerResponses = [{}] }) {
	const workflow = buildWorkflow(nodes, types);
	const registered = [];
	const emitted = [];
	const emittedErrors = [];
	const logger = { debug() {}, info() {}, warn() {}, error() {}, errors: [] };

	let pollIndex = 0;
	const scheduledTaskManager = {
		registerCron(ctx, onTick) {
			registered.push({ ctx, onTick });
			registerCron?.(ctx, onTick);
		},
		deregisterCrons(workflowId) { registered.push({ deregistered: workflowId }); },
	};

	const pollFunctions = {
		getNodeParameter: (name) => (name === 'pollTimes' ? pollTimes : undefined),
		__emit: (data) => emitted.push(data),
		__emitError: (error) => emittedErrors.push(error),
	};

	const activeWorkflows = new ActiveWorkflows({
		logger,
		scheduledTaskManager,
		triggersAndPollers: new TriggersAndPollers(),
		errorReporter: { error() {} },
		randomInt: (max) => 0,
	});
	return { workflow, activeWorkflows, registered, emitted, emittedErrors, logger, pollFunctions, nextPollResult: () => pollResults[pollIndex++] ?? null };
}

test('add() activates trigger nodes and reports the workflow as active (oracle: "should activate workflow with trigger nodes")', async () => {
	const harness = activationHarness({
		nodes: [node('Trigger', 'trigger')],
		types: { trigger: { description: { name: 'trigger', properties: {}, inputs: [], outputs: [] }, trigger: async () => ({ closeFunction: async () => {} }) } },
	});

	await harness.activeWorkflows.add('wf-1', harness.workflow, {}, 'trigger', 'init', () => ({}), () => ({}));

	assert.equal(harness.activeWorkflows.isActive('wf-1'), true);
	assert.deepEqual(harness.activeWorkflows.allActiveWorkflows(), ['wf-1']);
	assert.equal(harness.activeWorkflows.get('wf-1').triggerResponses.length, 1);
});

test('add() runs the initial poll test, then registers one cron per trigger time (oracle: "with polling nodes" + "should handle polling errors")', async () => {
	const calls = [];
	const harness = activationHarness({
		nodes: [node('Poller', 'poll')],
		types: {
			poll: {
				description: { name: 'poll', properties: {}, inputs: [], outputs: [] },
				poll: async () => { calls.push('poll'); return null; },
			},
		},
		pollTimes: { item: [{ mode: 'everyMinute' }, { mode: 'everyDay', hour: 3, minute: 30 }] },
	});

	await harness.activeWorkflows.add('wf-1', harness.workflow, {}, 'trigger', 'init', () => ({}), () => harness.pollFunctions);

	assert.deepEqual(calls, ['poll'], 'the poll function runs once during activation (testingTrigger)');
	assert.equal(harness.registered.length, 2);
	assert.deepEqual(harness.registered.map((entry) => entry.ctx), [
		{ workflowId: 'wf-1', timezone: 'Europe/Berlin', nodeId: 'id-Poller', expression: '0 * * * * *' },
		{ workflowId: 'wf-1', timezone: 'Europe/Berlin', nodeId: 'id-Poller', expression: '0 30 3 * * *' },
	]);
	assert.equal(harness.activeWorkflows.isActive('wf-1'), true);
});

test('poll response is emitted, null is not, and a later failure emits an error instead of throwing (oracle: "should emit error when poll fails during regular polling")', async () => {
	let mode = 'data';
	const emitted = [];
	const emittedErrors = [];
	const harness = activationHarness({
		nodes: [node('Poller', 'poll')],
		types: {
			poll: {
				description: { name: 'poll', properties: {}, inputs: [], outputs: [] },
				poll: async () => {
					if (mode === 'error') throw new Error('poll broke');
					if (mode === 'null') return null;
					return [[{ json: { v: 1 } }]];
				},
			},
		},
		pollTimes: { item: [{ mode: 'everyMinute' }] },
	});
	harness.pollFunctions.__emit = (data) => emitted.push(data);
	harness.pollFunctions.__emitError = (error) => emittedErrors.push(error);

	await harness.activeWorkflows.add('wf-1', harness.workflow, {}, 'trigger', 'init', () => ({}), () => harness.pollFunctions);
	assert.deepEqual(emitted, [[[ { json: { v: 1 } } ]]]);

	mode = 'null';
	await harness.registered[0].onTick();
	assert.equal(emitted.length, 1, 'null poll results are not emitted');

	mode = 'error';
	await harness.registered[0].onTick();
	assert.equal(emittedErrors.length, 1);
	assert.match(emittedErrors[0].message, /poll broke/);
	assert.equal(harness.activeWorkflows.isActive('wf-1'), true, 'a failed poll does not deactivate the workflow');
});

test('a failing initial poll test rejects add() with WorkflowActivationError and activates nothing (oracle: "should throw error when poll fails during initial testing")', async () => {
	const harness = activationHarness({
		nodes: [node('Poller', 'poll')],
		types: {
			poll: { description: { name: 'poll', properties: {}, inputs: [], outputs: [] }, poll: async () => { throw new Error('nope'); } },
		},
		pollTimes: { item: [{ mode: 'everyMinute' }] },
	});

	await assert.rejects(
		() => harness.activeWorkflows.add('wf-1', harness.workflow, {}, 'trigger', 'init', () => ({}), () => harness.pollFunctions),
		(error) => {
			assert.ok(error instanceof WorkflowActivationError);
			assert.match(error.message, /There was a problem activating the workflow: "nope"/);
			assert.equal(error.node.name, 'Poller');
			return true;
		},
	);
	assert.equal(harness.activeWorkflows.isActive('wf-1'), false);
	assert.equal(harness.registered.length, 0);
});

test('a too-short polling interval raises UserError and rolls the activation back when no trigger response exists (oracle: "if the polling interval is too short")', async () => {
	const harness = activationHarness({
		nodes: [node('Poller', 'poll')],
		types: {
			poll: { description: { name: 'poll', properties: {}, inputs: [], outputs: [] }, poll: async () => null },
		},
		pollTimes: { item: [{ mode: 'cronExpression', cronExpression: '* * * * * *' }] },
	});

	await assert.rejects(
		() => harness.activeWorkflows.add('wf-1', harness.workflow, {}, 'trigger', 'init', () => ({}), () => harness.pollFunctions),
		(error) => {
			// add() wraps every polling failure (UserError included) in WorkflowActivationError
			// — the oracle asserts on the message. Pinned quirk (workflow-activation.error.ts
			// L19-27): an ApplicationError cause is copied into a *plain* Error that keeps the
			// name/message/stack, so `cause` is not the original instance.
			assert.ok(error instanceof WorkflowActivationError);
			assert.match(error.message, /The polling interval is too short\. It has to be at least a minute\./);
			assert.equal(error.cause instanceof UserError, false);
			assert.equal(error.cause.name, 'UserError');
			assert.match(error.cause.message, /polling interval is too short/);
			return true;
		},
	);
	assert.equal(harness.activeWorkflows.isActive('wf-1'), false);
	assert.equal(harness.registered.length, 0, 'the invalid interval is detected before any cron registration');
});

test('remove() deregisters crons, closes triggers and returns false for an inactive workflow', async () => {
	let closed = 0;
	const harness = activationHarness({
		nodes: [node('Trigger', 'trigger')],
		types: {
			trigger: {
				description: { name: 'trigger', properties: {}, inputs: [], outputs: [] },
				trigger: async () => ({ closeFunction: async () => { closed++; } }),
			},
		},
	});

	await harness.activeWorkflows.add('wf-1', harness.workflow, {}, 'trigger', 'init', () => ({}), () => ({}));
	assert.equal(await harness.activeWorkflows.remove('wf-1'), true);
	assert.equal(closed, 1);
	assert.equal(harness.activeWorkflows.isActive('wf-1'), false);
	assert.equal(await harness.activeWorkflows.remove('wf-1'), false, 'already inactive → false + warn');
});

test('closeFunction errors: TriggerCloseError is logged and reported, everything else becomes WorkflowDeactivationError (active-workflows.ts L224-249)', async () => {
	const reported = [];
	const closeError = new TriggerCloseError({ name: 'Trigger', type: 'trigger' }, { level: 'error' });
	const harness = (closeFn) => {
		const workflow = buildWorkflow([node('Trigger', 'trigger')], {
			trigger: { description: { name: 'trigger', properties: {}, inputs: [], outputs: [] }, trigger: async () => ({ closeFunction: closeFn }) },
		});
		const activeWorkflows = new ActiveWorkflows({
			logger: throwingLogger(),
			scheduledTaskManager: { registerCron() {}, deregisterCrons() {} },
			triggersAndPollers: new TriggersAndPollers(),
			errorReporter: { error: (e, meta) => reported.push({ e, meta }) },
		});
		return { workflow, activeWorkflows };
	};

	const first = harness(async () => { throw closeError; });
	await first.activeWorkflows.add('wf-1', first.workflow, {}, 'trigger', 'init', () => ({}), () => ({}));
	assert.equal(await first.activeWorkflows.remove('wf-1'), true, 'a TriggerCloseError does not fail the deactivation');
	assert.equal(reported.length, 1);
	assert.equal(reported[0].meta.extra.workflowId, 'wf-1');

	const second = harness(async () => { throw new Error('socket stuck'); });
	await second.activeWorkflows.add('wf-1', second.workflow, {}, 'trigger', 'init', () => ({}), () => ({}));
	await assert.rejects(
		() => second.activeWorkflows.remove('wf-1'),
		error => error instanceof WorkflowDeactivationError
			&& /Failed to deactivate trigger of workflow ID "wf-1": "socket stuck"/.test(error.message)
			&& error.workflowId === 'wf-1',
	);
});

test('removeAllTriggerAndPollerBasedWorkflows() removes everything it holds', async () => {
	const harness = activationHarness({
		nodes: [node('Trigger', 'trigger')],
		types: { trigger: { description: { name: 'trigger', properties: {}, inputs: [], outputs: [] }, trigger: async () => ({}) } },
	});
	await harness.activeWorkflows.add('wf-1', harness.workflow, {}, 'trigger', 'init', () => ({}), () => ({}));
	await harness.activeWorkflows.add('wf-2', harness.workflow, {}, 'trigger', 'init', () => ({}), () => ({}));
	await harness.activeWorkflows.removeAllTriggerAndPollerBasedWorkflows();
	assert.deepEqual(harness.activeWorkflows.allActiveWorkflows(), []);
});

// --- workflow model surface --------------------------------------------------
test('getTriggerNodes()/getPollNodes() skip disabled nodes and keep declaration order (workflow.ts L254-295)', () => {
	const workflow = buildWorkflow(
		[
			node('PollA', 'poll'),
			node('TriggerA', 'trigger'),
			node('DisabledTrigger', 'trigger', { disabled: true }),
			node('TriggerB', 'trigger'),
			node('Nothing', 'plain'),
		],
		{
			poll: { description: { name: 'poll', properties: {}, inputs: [], outputs: [] }, poll: async () => null },
			trigger: { description: { name: 'trigger', properties: {}, inputs: [], outputs: [] }, trigger: async () => ({}) },
			plain: { description: { name: 'plain', properties: {}, inputs: [], outputs: [] }, execute: async () => [] },
		},
	);

	assert.deepEqual(workflow.getTriggerNodes().map((entry) => entry.name), ['TriggerA', 'TriggerB']);
	assert.deepEqual(workflow.getPollNodes().map((entry) => entry.name), ['PollA']);
	assert.deepEqual(workflow.queryNodes((type) => !type.trigger && !type.poll).map((entry) => entry.name), ['Nothing']);
});

// --- ExecutionLifecycleHooks -------------------------------------------------
test('ExecutionLifecycleHooks runs handlers in registration order with `this` bound, and rejects unknown hook names (execution-lifecycle-hooks.ts L109-134)', async () => {
	const hooks = new ExecutionLifecycleHooks('manual', 'exec-1', { id: 'wf-1' });
	const order = [];
	hooks.addHandler('nodeExecuteAfter', async function (name) { order.push(`first:${name}:${this.executionId}`); });
	hooks.addHandler('nodeExecuteAfter', async (name) => { order.push(`second:${name}`); });

	await hooks.runHook('nodeExecuteAfter', ['Node1', {}, {}]);
	assert.deepEqual(order, ['first:Node1:exec-1', 'second:Node1']);

	assert.equal(Object.keys(hooks.handlers).length, 8);
	assert.throws(() => hooks.addHandler('nope', () => {}), /Unknown hook name "nope"/);
	await assert.rejects(() => hooks.runHook('nope', []), /Unknown hook name "nope"/);

	const failing = new ExecutionLifecycleHooks('manual', 'exec-1', {});
	const reached = [];
	failing.addHandler('sendResponse', async () => { throw new Error('handler broke'); });
	failing.addHandler('sendResponse', async () => { reached.push('after'); });
	await assert.rejects(() => failing.runHook('sendResponse', [{}]), /handler broke/);
	assert.deepEqual(reached, [], 'a throwing handler stops the remaining ones');
});

// --- TriggerContext ----------------------------------------------------------
test('TriggerContext: emit/emitError/saveFailedExecution throw until overwritten, getActivationMode/getCredentials behave (trigger-context.ts L14-56)', async () => {
	const workflow = buildWorkflow([node('Trigger', 'trigger')], {
		trigger: { description: { name: 'trigger', properties: {}, inputs: [], outputs: [] }, trigger: async () => ({}) },
	});
	const context = new TriggerContext({ workflow, node: node('Trigger', 'trigger'), mode: 'trigger', activation: 'init' });

	assert.throws(() => context.emit([[{ json: {} }]]), /Overwrite TriggerContext.emit function/);
	assert.throws(() => context.emitError(new Error('x')), /Overwrite TriggerContext.emitError function/);
	assert.throws(() => context.saveFailedExecution(new Error('x')), /Overwrite TriggerContext.saveFailedExecution function/);
	assert.equal(context.getActivationMode(), 'init');
	assert.equal(typeof context.helpers.createDeferredPromise, 'function');
	assert.equal(typeof context.helpers.returnJsonArray, 'function');
	await assert.rejects(() => context.getCredentials('httpBasicAuth'), /credentials LEGO/);

	const deferred = context.helpers.createDeferredPromise();
	deferred.resolve('later');
	assert.equal(await deferred.promise, 'later');

	const withAdapter = new TriggerContext({
		workflow,
		node: node('Trigger', 'trigger'),
		_getCredentials: async (type) => ({ type, user: 'u' }),
	});
	assert.deepEqual(await withAdapter.getCredentials('httpBasicAuth'), { type: 'httpBasicAuth', user: 'u' });

	const overwritten = new TriggerContext({ workflow, node: node('Trigger', 'trigger'), emit: (data) => data });
	assert.deepEqual(overwritten.emit('payload'), 'payload');
});

// --- cron helpers ------------------------------------------------------------
test('toCronExpression maps every trigger-time mode with the random second/minute (cron.ts L52-72)', () => {
	const fixed = (max) => (max === 60 ? 7 : 0);
	assert.equal(toCronExpression({ mode: 'everyMinute' }, fixed), '7 * * * * *');
	assert.equal(toCronExpression({ mode: 'everyHour', minute: 30 }, fixed), '7 30 * * * *');
	assert.equal(toCronExpression({ mode: 'everyX', unit: 'minutes', value: 5 }, fixed), '7 */5 * * * *');
	assert.equal(toCronExpression({ mode: 'everyX', unit: 'hours', value: 2 }, fixed), '7 7 */2 * * *');
	assert.equal(toCronExpression({ mode: 'everyDay', hour: 3, minute: 30 }, fixed), '7 30 3 * * *');
	assert.equal(toCronExpression({ mode: 'everyWeek', hour: 3, minute: 30, weekday: 1 }, fixed), '7 30 3 * * 1');
	assert.equal(toCronExpression({ mode: 'everyMonth', hour: 3, minute: 30, dayOfMonth: 15 }, fixed), '7 30 3 15 * *');
	assert.equal(toCronExpression({ mode: 'cronExpression', cronExpression: ' 0 5 * * * ' }, fixed), '0 5 * * *');
});

test('ScheduledTaskManager keys crons like the reference (sorted JSON), skips duplicates and deregisters per workflow', () => {
	const reported = [];
	const manager = new ScheduledTaskManager({ errorReporter: { error: (message) => reported.push(message) } });
	const ctx = { workflowId: 'wf-1', timezone: 'UTC', nodeId: 'n1', expression: '0 5 * * * *' };

	assert.equal(manager.toCronKey(ctx), JSON.stringify({ expression: '0 5 * * * *', nodeId: 'n1', timezone: 'UTC', workflowId: 'wf-1' }));

	manager.registerCron(ctx, () => {});
	manager.registerCron({ ...ctx }, () => {});
	assert.equal(manager.cronsByWorkflow.get('wf-1').size, 1, 'the duplicate is not scheduled twice');
	assert.deepEqual(reported, ['Skipped registration for already registered cron']);

	manager.registerCron({ ...ctx, expression: '0 6 * * * *' }, () => {});
	assert.equal(manager.cronsByWorkflow.get('wf-1').size, 2);

	const stopped = [];
	manager.cronsByWorkflow.get('wf-1').forEach((cron) => { cron.job.stop = () => stopped.push(cron.summary); });
	manager.deregisterCrons('wf-1');
	assert.equal(manager.cronsByWorkflow.has('wf-1'), false);
	assert.deepEqual(stopped, ['0 5 * * * *', '0 6 * * * *']);
});
