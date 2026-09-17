/**
 * Trigger LEGO — registry + activation validation behaviour.
 *
 * Every expectation below was read off the pinned runtime first (`n8n-core`'s `ActiveWorkflows` and
 * `n8n-workflow`'s `validateWorkflowHasTriggerLikeNode` / `toCronExpression`, both at 2.9.1) and is
 * re-proved on every run by `npm run trigger:check` (`tools/trigger-isolation-gate.mjs`, T01-T06).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(fileURLToPath(import.meta.url), '..', '..');
const REPO = join(PKG, '..', '..');
const engine = await import(join(REPO, 'packages/reconstructed-engine/src/trigger-engine.ts'));
const {
	TriggerEngine,
	WorkflowActivationError,
	WorkflowDeactivationError,
	TriggerCloseError,
	TriggerUserError,
	STARTING_NODES,
	toCronExpression,
	validateWorkflowHasTriggerLikeNode,
} = engine;

const calls = [];
const makeEngine = (options = {}) => {
	calls.length = 0;
	return new TriggerEngine({
		logger: {
			debug: (message) => calls.push(`debug:${message}`),
			warn: (message) => calls.push(`warn:${message}`),
			error: (message) => calls.push(`error:${message}`),
		},
		scheduledTaskManager: {
			registerCron: (ctx) => calls.push(`registerCron:${ctx.workflowId}`),
			deregisterCrons: (workflowId) => calls.push(`deregisterCrons:${workflowId}`),
		},
		...options,
	});
};

const workflowLike = (triggerNodes = [], { id = 'wf', pollNodes = [] } = {}) => ({
	id,
	name: id,
	timezone: 'UTC',
	getTriggerNodes: () => triggerNodes,
	getPollNodes: () => pollNodes,
});

const response = (name) => ({ closeFunction: async () => calls.push(`close:${name}`) });

test('a fresh registry is empty and `get` returns undefined', () => {
	const registry = makeEngine();
	assert.equal(registry.isActive('wf'), false);
	assert.deepEqual(registry.allActiveWorkflows(), []);
	assert.equal(registry.get('wf'), undefined);
});

test('add stores the trigger responses and repeated adds overwrite the entry', async () => {
	const registry = makeEngine({ triggersAndPollers: { runTrigger: async (workflow, triggerNode) => response(triggerNode.name) } });
	const workflow = workflowLike([{ name: 'T1', type: 'n8n-nodes-base.trigger' }]);

	await registry.add('wf', workflow, {}, 'trigger', 'activate');
	assert.equal(registry.isActive('wf'), true);
	assert.deepEqual(Object.keys(registry.get('wf')), ['triggerResponses']);
	assert.equal(registry.get('wf').triggerResponses.length, 1);

	// The reference does NOT reject a duplicate: the triggers run again and the entry is replaced.
	await registry.add('wf', workflow, {}, 'trigger', 'activate');
	assert.deepEqual(registry.allActiveWorkflows(), ['wf']);
	assert.equal(registry.get('wf').triggerResponses.length, 1);
});

test('a workflow without trigger nodes is accepted with an empty response list', async () => {
	const registry = makeEngine();
	await registry.add('plain', workflowLike([]), {}, 'trigger', 'activate');
	assert.equal(registry.isActive('plain'), true);
	assert.deepEqual(registry.get('plain').triggerResponses, []);
});

test('allActiveWorkflows uses Object.keys ordering, so integer-like ids come first', async () => {
	const registry = makeEngine({ triggersAndPollers: { runTrigger: async () => undefined } });
	for (const id of ['wf-2', '10', '2', 'wf-1']) {
		await registry.add(id, workflowLike([{ name: 'T', type: 'n8n-nodes-base.trigger' }]), {}, 'trigger', 'activate');
	}
	assert.deepEqual(registry.allActiveWorkflows(), ['2', '10', 'wf-2', 'wf-1']);
});

test('remove deregisters crons, closes the responses and reports unknown ids', async () => {
	const registry = makeEngine({ triggersAndPollers: { runTrigger: async (workflow, triggerNode) => response(triggerNode.name) } });
	await registry.add('wf', workflowLike([{ name: 'T1', type: 'n8n-nodes-base.trigger' }, { name: 'T2', type: 'n8n-nodes-base.trigger' }]), {}, 'trigger', 'activate');

	assert.equal(await registry.remove('wf'), true);
	assert.equal(await registry.remove('wf'), false, 'the second remove is a no-op');
	assert.deepEqual(calls.filter((call) => call.startsWith('deregisterCrons')), ['deregisterCrons:wf']);
	assert.deepEqual(calls.filter((call) => call.startsWith('close:')), ['close:T1', 'close:T2']);
	assert.equal(calls.some((call) => call.startsWith('warn:')), true, 'the reference logs a warning');
});

test('removeAllTriggerAndPollerBasedWorkflows drains the registry and is idempotent', async () => {
	const registry = makeEngine({ triggersAndPollers: { runTrigger: async () => undefined } });
	for (const id of ['a', 'b']) await registry.add(id, workflowLike([{ name: 'T', type: 'n8n-nodes-base.trigger' }]), {}, 'trigger', 'activate');
	await registry.removeAllTriggerAndPollerBasedWorkflows();
	assert.deepEqual(registry.allActiveWorkflows(), []);
	await registry.removeAllTriggerAndPollerBasedWorkflows();
	assert.deepEqual(registry.allActiveWorkflows(), []);
});

test('a failing trigger raises WorkflowActivationError and leaves nothing active', async () => {
	const registry = makeEngine({ triggersAndPollers: { runTrigger: async () => { throw new Error('boom'); } } });
	await assert.rejects(
		() => registry.add('bad', workflowLike([{ name: 'T', type: 'n8n-nodes-base.trigger' }]), {}, 'trigger', 'activate'),
		(error) => {
			assert.equal(error.name, 'WorkflowActivationError');
			assert.equal(error.message, 'There was a problem activating the workflow: "boom"');
			assert.equal(error.node.name, 'T');
			assert.equal(error.level, 'error');
			assert.equal(error.cause, undefined, 'the reference does not expose the cause');
			return true;
		},
	);
	assert.equal(registry.isActive('bad'), false);
});

test('a failing closeFunction raises WorkflowDeactivationError, a TriggerCloseError is only reported', async () => {
	const failing = makeEngine({ triggersAndPollers: { runTrigger: async () => ({ closeFunction: async () => { throw new Error('close failed'); } }) } });
	await failing.add('wf', workflowLike([{ name: 'T', type: 'n8n-nodes-base.trigger' }]), {}, 'trigger', 'activate');
	await assert.rejects(
		() => failing.remove('wf'),
		(error) => {
			assert.equal(error.name, 'WorkflowDeactivationError');
			assert.equal(error.message, 'Failed to deactivate trigger of workflow ID "wf": "close failed"');
			assert.equal(error.workflowId, 'wf');
			return true;
		},
	);

	const reported = [];
	const withReporter = makeEngine({
		triggersAndPollers: {
			runTrigger: async (workflow, node) => ({
				closeFunction: async () => {
					throw new TriggerCloseError(node, { cause: new Error('cause'), level: 'error' });
				},
			}),
		},
		errorReporter: { error: (error) => reported.push(error.name) },
	});
	await withReporter.add('wf', workflowLike([{ name: 'T', type: 'n8n-nodes-base.trigger' }]), {}, 'trigger', 'activate');
	assert.equal(await withReporter.remove('wf'), true, 'a TriggerCloseError does not abort deactivation');
	assert.deepEqual(reported, ['Error'], 'the reference class keeps the default Error name');
	assert.equal(calls.some((call) => call.startsWith('error:')), true);
});

test('validateWorkflowHasTriggerLikeNode mirrors the reference rules', () => {
	const definitions = { plain: {}, trigger: { trigger: async () => ({}) }, poll: { poll: async () => ({}) }, webhook: { webhook: async () => ({}) } };
	const nodeTypes = { getByNameAndVersion: (type) => definitions[type] };

	assert.deepEqual(validateWorkflowHasTriggerLikeNode({ P: { name: 'P', type: 'plain' } }, nodeTypes), {
		isValid: false,
		error: 'Workflow cannot be activated because it has no trigger node. At least one trigger, webhook, or polling node is required.',
	});
	for (const type of ['trigger', 'poll', 'webhook']) {
		assert.deepEqual(validateWorkflowHasTriggerLikeNode({ N: { name: 'N', type } }, nodeTypes), { isValid: true });
	}
	const unknownType = validateWorkflowHasTriggerLikeNode({ N: { name: 'N', type: 'unknown' } }, nodeTypes);
	assert.equal(unknownType.isValid, false, 'unknown node types are skipped, not accepted');
	assert.equal(validateWorkflowHasTriggerLikeNode({ N: { name: 'N', type: 'trigger', disabled: true } }, nodeTypes).isValid, false, 'disabled nodes are skipped');
	assert.equal(
		validateWorkflowHasTriggerLikeNode({ T: { name: 'T', type: 'n8n-nodes-base.manualTrigger' } }, { getByNameAndVersion: () => ({ trigger: async () => ({}) }) }, STARTING_NODES).isValid,
		false,
		'manual triggers are ignored when they are passed as STARTING_NODES',
	);
});

test('toCronExpression reproduces the reference shapes (crypto random frozen)', () => {
	const freeze = (value) => {
		const original = globalThis.crypto.getRandomValues;
		globalThis.crypto.getRandomValues = (array) => {
			array[0] = value;
			return array;
		};
		return () => {
			globalThis.crypto.getRandomValues = original;
		};
	};
	const withSecond = (value, item) => {
		const restore = freeze(value);
		try {
			return toCronExpression(item);
		} finally {
			restore();
		}
	};

	assert.equal(withSecond(0, { mode: 'everyMinute' }), '0 * * * * *');
	assert.equal(withSecond(17, { mode: 'everyHour', minute: 15 }), '17 15 * * * *');
	assert.equal(withSecond(7, { mode: 'everyX', unit: 'minutes', value: 5 }), '7 */5 * * * *');
	assert.equal(withSecond(7, { mode: 'everyX', unit: 'hours', value: 3 }), '7 7 */3 * * *', 'the minute field is randomised too');
	assert.equal(withSecond(7, { mode: 'everyDay', minute: 30, hour: 4 }), '7 30 4 * * *');
	assert.equal(withSecond(7, { mode: 'everyWeek', minute: 0, hour: 9, weekday: 1 }), '7 0 9 * * 1');
	assert.equal(withSecond(7, { mode: 'everyMonth', minute: 5, hour: 6, dayOfMonth: 12 }), '7 5 6 12 * *');
	assert.equal(withSecond(7, { mode: 'custom', cronExpression: '  7 7 * * *  ' }), '7 7 * * *', 'custom expressions are trimmed');
});

test('TriggerUserError keeps the reference name for the poll-interval guard', () => {
	const error = new TriggerUserError('The polling interval is too short. It has to be at least a minute.');
	assert.equal(error.name, 'UserError');
	assert.match(error.message, /polling interval is too short/);
});
