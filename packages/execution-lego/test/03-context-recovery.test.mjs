import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	ExecutionContextHookRegistry,
	ExecutionContextService,
	ExecutionRecoveryService,
	NodeCrashedError,
	WorkflowCrashedError,
	ARTIFICIAL_TASK_DATA,
	Emitter,
	MemoryExecutionRepository,
	MemoryWorkflowRepository,
	createRecordingLogger,
	deepMerge,
} from '../src/index.ts';

/* ------------------------------------------------------------------ *
 * X13..X15 — execution context hooks
 * ------------------------------------------------------------------ */

const makeHook = ({ name, applicable = () => true, init, execute }) => {
	const Hook = class {
		hookDescription = { name };
		isApplicableToTriggerNode = applicable;
	};
	if (init) Hook.prototype.init = init;
	if (execute) Hook.prototype.execute = execute;
	return Hook;
};

test('X13 — hook registry: first registration wins, failing init is skipped', async () => {
	const logger = createRecordingLogger();
	const first = makeHook({ name: 'credentials.bearerToken' });
	const duplicate = makeHook({ name: 'credentials.bearerToken' });
	const broken = makeHook({
		name: 'env.variables',
		init: async () => {
			throw new Error('missing secret store');
		},
	});
	const webhookOnly = makeHook({ name: 'webhook.headers', applicable: (type) => type === 'n8n-nodes-base.webhook' });
	const boom = makeHook({
		name: 'boom.hook',
		init: async () => {
			throw new Error('boom');
		},
	});

	const registry = new ExecutionContextHookRegistry({ hooks: [first, duplicate, broken, webhookOnly, boom], logger });
	await registry.init();

	assert.deepEqual(
		registry.getAllHooks().map((hook) => hook.hookDescription.name),
		['credentials.bearerToken', 'webhook.headers'],
	);
	assert.ok(logger.lines.includes('debug: Registering 5 execution context hooks.'));
	assert.ok(
		logger.lines.some((line) =>
			line.includes('Execution context hook with name "credentials.bearerToken" is already registered.'),
		),
	);
	assert.ok(
		logger.lines.some((line) =>
			line.includes('Failed to initialize execution context hook "env.variables": missing secret store'),
		),
	);
	assert.ok(logger.lines.some((line) => line.includes('Failed to instantiate execution context hook class')) === false);
	assert.equal(registry.getHookByName('credentials.bearerToken').constructor, first);
	assert.equal(registry.getHookByName('missing')?.constructor, undefined);
	assert.deepEqual(
		registry.getHookForTriggerType('n8n-nodes-base.webhook').map((hook) => hook.hookDescription.name),
		['credentials.bearerToken', 'webhook.headers'],
	);
	assert.deepEqual(
		registry.getHookForTriggerType('n8n-nodes-base.scheduleTrigger').map((hook) => hook.hookDescription.name),
		['credentials.bearerToken'],
	);

	// re-init clears the map first
	await registry.init();
	assert.equal(registry.getAllHooks().length, 2);
});

test('X14 — decrypt/encrypt keep credentials symmetrical and merge is a deep merge', () => {
	const registry = new ExecutionContextHookRegistry({ hooks: [] });
	const cipher = {
		encrypt: (value) => ({ encrypted: JSON.stringify(value) }),
		decrypt: (value) => JSON.parse(value.encrypted),
	};
	const service = new ExecutionContextService({
		registry,
		cipher,
		toCredentialContext: (decrypted) => ({ ...decrypted, mapped: true }),
	});

	const encrypted = service.encryptExecutionContext({ credentials: { bearer: 'tok' }, version: 1 });
	assert.deepEqual(encrypted, { credentials: { encrypted: JSON.stringify({ bearer: 'tok' }) }, version: 1 });

	const decrypted = service.decryptExecutionContext(encrypted);
	assert.deepEqual(decrypted, { credentials: { bearer: 'tok', mapped: true }, version: 1 });

	// no credentials → the member stays undefined, the rest of the context is untouched
	assert.deepEqual(service.encryptExecutionContext({ version: 2 }), { credentials: undefined, version: 2 });

	assert.deepEqual(
		deepMerge({ a: 1, nested: { x: 1, keep: true } }, { nested: { x: 2 }, b: 3 }),
		{ a: 1, nested: { x: 2, keep: true }, b: 3 },
	);
	// arrays are replaced, not merged
	assert.deepEqual(deepMerge({ list: [1, 2] }, { list: [3] }), { list: [3] });
});

test('X15 — augmentExecutionContextWithHooks runs the configured hooks in order', async () => {
	const registry = new ExecutionContextHookRegistry({ hooks: [] });
	const calls = [];
	registry.hookMap.set('credentials.bearerToken', {
		hookDescription: { name: 'credentials.bearerToken' },
		isApplicableToTriggerNode: () => true,
		execute: async ({ triggerItems, context }) => {
			calls.push('bearer');
			assert.deepEqual(context.credentials, { bearer: 'tok' });
			return { triggerItems: [...triggerItems, { json: { hooked: true } }] };
		},
	});
	registry.hookMap.set('env.variables', {
		hookDescription: { name: 'env.variables' },
		isApplicableToTriggerNode: () => true,
		execute: async () => ({ contextUpdate: { variables: { REGION: 'eu' } } }),
	});

	const service = new ExecutionContextService({
		registry,
		cipher: { encrypt: (value) => ({ enc: value }), decrypt: (value) => value.enc },
		toCredentialContext: (value) => value,
		toHookParameters: () => ({
			data: {
				contextEstablishmentHooks: {
					hooks: [{ hookName: 'credentials.bearerToken' }, { hookName: 'env.variables' }, { hookName: 'unknown.hook' }],
				},
			},
		}),
	});

	const workflow = { getNode: () => ({ parameters: { nodeParam: 'from-workflow' } }) };
	const startItem = {
		node: { name: 'Webhook', parameters: { nodeParam: 'from-start-item' } },
		data: { main: [[{ json: { id: 1 } }]] },
	};

	const { context, triggerItems } = await service.augmentExecutionContextWithHooks(workflow, startItem, {
		credentials: { enc: { bearer: 'tok' } },
		version: 1,
	});

	assert.deepEqual(calls, ['bearer']);
	assert.deepEqual(triggerItems, [{ json: { id: 1 } }, { json: { hooked: true } }]);
	assert.deepEqual(context, {
		credentials: { enc: { bearer: 'tok' } },
		version: 1,
		variables: { REGION: 'eu' },
	});
});

test('X15b — unparsable parameters, unknown hooks and isAllowedToFail', async () => {
	const logger = createRecordingLogger();
	const registry = new ExecutionContextHookRegistry({ hooks: [], logger });
	const service = new ExecutionContextService({
		registry,
		logger,
		toHookParameters: () => ({ error: new Error('invalid json') }),
	});
	const workflow = { getNode: () => null };
	const startItem = { node: { name: 'Webhook', parameters: {} }, data: { main: [[{ json: {} }]] } };

	// parsing failed → warn and pass the context through untouched
	const untouched = await service.augmentExecutionContextWithHooks(workflow, startItem, { version: 1 });
	assert.deepEqual(untouched, { context: { version: 1 }, triggerItems: [{ json: {} }] });
	assert.ok(
		logger.lines.some((line) =>
			line.includes(
				'Failed to parse execution context establishment hook parameters for node Webhook: invalid json',
			),
		),
	);

	// unknown hook → warn + skip
	const skipping = new ExecutionContextService({
		registry,
		logger,
		toHookParameters: () => ({ data: { contextEstablishmentHooks: { hooks: [{ hookName: 'missing.hook' }] } } }),
	});
	const skipped = await skipping.augmentExecutionContextWithHooks(workflow, startItem, { version: 2 });
	// decrypt/encrypt keep the `credentials` member present (undefined) exactly like the reference spread
	assert.deepEqual(skipped.context, { version: 2, credentials: undefined });
	assert.ok(
		logger.lines.some((line) =>
			line.includes('Execution context establishment hook missing.hook not found, skipping this hook'),
		),
	);

	const throwingHook = {
		hookDescription: { name: 'boom.hook' },
		isApplicableToTriggerNode: () => true,
		execute: async () => {
			throw new Error('hook exploded');
		},
	};
	registry.hookMap.set('boom.hook', throwingHook);

	// isAllowedToFail: true → warn and continue with the previous context
	const tolerated = new ExecutionContextService({
		registry,
		logger,
		toHookParameters: () => ({
			data: { contextEstablishmentHooks: { hooks: [{ hookName: 'boom.hook', isAllowedToFail: true }] } },
		}),
	});
	const result = await tolerated.augmentExecutionContextWithHooks(workflow, startItem, { version: 3 });
	assert.deepEqual(result.context, { version: 3, credentials: undefined });
	assert.ok(logger.lines.some((line) => line.includes('Failed to execute context establishment hook boom.hook')));

	// isAllowedToFail: false/absent → the error propagates
	const strict = new ExecutionContextService({
		registry,
		logger,
		toHookParameters: () => ({ data: { contextEstablishmentHooks: { hooks: [{ hookName: 'boom.hook' }] } } }),
	});
	await assert.rejects(() => strict.augmentExecutionContextWithHooks(workflow, startItem, { version: 4 }), /hook exploded/);
});

/* ------------------------------------------------------------------ *
 * X16..X17 — recovery
 * ------------------------------------------------------------------ */

const crashedRow = (id, workflowId, status = 'crashed', startedAt = new Date(Date.now() - 1000)) => ({
	id,
	workflowId,
	status,
	mode: 'trigger',
	startedAt,
});

test('X16 — auto-deactivation when the last N executions all crashed', async () => {
	const logger = createRecordingLogger();
	const push = new Emitter();
	const notified = [];
	const t = (seconds) => new Date(1_700_000_000_000 + seconds * 1000);
	const repository = new MemoryExecutionRepository([
		// wf-1: the three newest executions all crashed
		crashedRow('e1', 'wf-1', 'crashed', t(30)),
		crashedRow('e2', 'wf-1', 'crashed', t(29)),
		crashedRow('e3', 'wf-1', 'crashed', t(28)),
		// a healthy workflow: the newest three are mixed
		crashedRow('e4', 'wf-2', 'crashed', t(27)),
		crashedRow('e5', 'wf-2', 'crashed', t(26)),
		{ id: 'e6', workflowId: 'wf-2', status: 'success', mode: 'trigger', startedAt: t(25) },
		// dangling rows for wf-1 (older than the crashed window) that must be flipped to crashed
		{ id: 'e7', workflowId: 'wf-1', status: 'running', mode: 'trigger', startedAt: t(2) },
		{ id: 'e8', workflowId: 'wf-1', status: 'new', mode: 'trigger', startedAt: t(1) },
		// executions of a workflow row that no longer exists
		crashedRow('e9', 'wf-missing', 'crashed', t(24)),
		crashedRow('e10', 'wf-missing', 'crashed', t(23)),
		crashedRow('e11', 'wf-missing', 'crashed', t(22)),
	]);
	const workflows = new MemoryWorkflowRepository([
		{ id: 'wf-1', name: 'Workflow One', activeVersionId: 'v1' },
		{ id: 'wf-2', name: 'Workflow Two', activeVersionId: 'v1' },
	]);
	const sleeps = [];
	const service = new ExecutionRecoveryService({
		logger,
		executionRepository: repository,
		workflowRepository: workflows,
		push,
		notifyWorkflowAutodeactivated: ({ workflow }) => notified.push(workflow.id),
		sleep: async (ms) => sleeps.push(ms),
	});

	await service.autoDeactivateWorkflowsIfNeeded(new Set(['wf-1', 'wf-2', 'wf-missing']));

	assert.equal(workflows.findOne({ where: { id: 'wf-1' } }).active, false);
	assert.equal(workflows.findOne({ where: { id: 'wf-2' } }).active, undefined);
	assert.deepEqual(notified, ['wf-1'], 'a missing workflow row must not notify');
	assert.ok(logger.lines.some((line) => line.includes('Autodeactivated workflow wf-1 due to too many crashed executions.')));
	assert.ok(
		logger.lines.some((line) => line.includes('Workflow wf-missing not found, skipping workflow auto-deactivation')),
	);

	const broadcasts = [];
	push.broadcast = (message) => broadcasts.push(message);
	assert.deepEqual(broadcasts, [], 'push waits for the editor UI');

	push.emit('editorUiConnected');
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(sleeps, [1000]);
	assert.deepEqual(broadcasts, [{ type: 'workflowAutoDeactivated', data: { workflowId: 'wf-1' } }]);

	assert.equal(repository.get('e7').status, 'crashed');
	assert.equal(repository.get('e8').status, 'crashed');
	assert.ok(repository.get('e7').stoppedAt instanceof Date);
	assert.equal(repository.get('e6').status, 'success', 'healthy workflows are untouched');
});

test('X16b — an already deactivated workflow still gets its dangling executions crashed', async () => {
	const t = (seconds) => new Date(1_700_000_000_000 + seconds * 1000);
	const repository = new MemoryExecutionRepository([
		crashedRow('e1', 'wf-1', 'crashed', t(30)),
		crashedRow('e2', 'wf-1', 'crashed', t(29)),
		crashedRow('e3', 'wf-1', 'crashed', t(28)),
		{ id: 'e4', workflowId: 'wf-1', status: 'running', mode: 'trigger', startedAt: t(1) },
	]);
	const workflows = new MemoryWorkflowRepository([{ id: 'wf-1', name: 'Workflow One', activeVersionId: null }]);
	const service = new ExecutionRecoveryService({ executionRepository: repository, workflowRepository: workflows });

	await service.autoDeactivateWorkflowsIfNeeded(new Set(['wf-1']));

	assert.equal(workflows.findOne({ where: { id: 'wf-1' } }).active, undefined, 'no deactivation wrote the row');
	assert.equal(repository.get('e4').status, 'crashed');
});

const makeMessage = (eventName, payload, seconds) => ({
	eventName,
	payload,
	ts: {
		toUnixInteger: () => seconds,
		toJSDate: () => new Date(seconds * 1000),
		diff: (other) => ({ toMillis: () => (seconds - other.toUnixInteger()) * 1000 }),
	},
});

test('X17 — recoverFromLogs rebuilds task data from the event stream', async () => {
	const repository = new MemoryExecutionRepository([
		{
			id: 'e1',
			workflowId: 'wf-1',
			status: 'running',
			mode: 'trigger',
			startedAt: new Date(0),
			workflowData: { nodes: [{ name: 'Webhook' }, { name: 'HTTP Request' }] },
			data: { resultData: { runData: {} } },
		},
	]);
	const logger = createRecordingLogger();
	const push = new Emitter();
	const hooksRun = [];
	const service = new ExecutionRecoveryService({
		logger,
		executionRepository: repository,
		workflowRepository: new MemoryWorkflowRepository(),
		push,
		sleep: async () => {},
		runLifecycleHooks: (execution) => hooksRun.push(execution.id),
	});

	const amended = await service.recoverFromLogs('e1', [
		makeMessage('n8n.workflow.started', { executionId: 'e1' }, 1),
		makeMessage('n8n.node.started', { nodeName: 'Webhook' }, 2),
		makeMessage('n8n.node.finished', { nodeName: 'Webhook' }, 5),
		makeMessage('n8n.node.started', { nodeName: 'HTTP Request' }, 6),
	]);

	assert.equal(amended.status, 'crashed');
	const runData = amended.data.resultData;
	assert.deepEqual(runData.runData.Webhook, [
		{ startTime: 2, executionIndex: 0, executionTime: 3000, source: [null], executionStatus: 'success', data: ARTIFICIAL_TASK_DATA },
	]);
	const crashedTask = runData.runData['HTTP Request'][0];
	assert.equal(crashedTask.executionStatus, 'crashed');
	assert.equal(crashedTask.executionTime, 0);
	assert.ok(crashedTask.error instanceof NodeCrashedError);
	assert.equal(crashedTask.error.message, 'Execution stopped at this node');
	assert.ok(runData.error instanceof WorkflowCrashedError);
	assert.equal(runData.lastNodeExecuted, 'HTTP Request');
	assert.deepEqual(amended.stoppedAt, new Date(6000));
	assert.deepEqual(hooksRun, ['e1']);
	assert.ok(logger.lines.some((line) => line.includes('[Recovery] Logs available, amended execution')));

	// the amended execution is persisted
	assert.equal(repository.get('e1').status, 'crashed');
	assert.deepEqual(repository.get('e1').stoppedAt, new Date(6000));

	// push is delivered once the editor is connected
	const broadcasts = [];
	push.broadcast = (message) => broadcasts.push(message);
	push.emit('editorUiConnected');
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(broadcasts, [{ type: 'executionRecovered', data: { executionId: 'e1' } }]);
});

test('X17b — finished executions, followers and missing log streams', async () => {
	const repository = new MemoryExecutionRepository([
		{
			id: 'finished',
			workflowId: 'wf-1',
			status: 'success',
			mode: 'trigger',
			startedAt: new Date(0),
			workflowData: { nodes: [{ name: 'Webhook' }] },
			data: { resultData: { runData: { Webhook: [{ executionStatus: 'success' }] } } },
		},
		{
			id: 'emptylogs',
			workflowId: 'wf-1',
			status: 'running',
			mode: 'trigger',
			startedAt: new Date(0),
			workflowData: { nodes: [{ name: 'Webhook' }] },
			data: { resultData: { runData: {} } },
		},
		{
			id: 'keepProgress',
			workflowId: 'wf-1',
			status: 'error',
			mode: 'trigger',
			startedAt: new Date(0),
			workflowData: { nodes: [{ name: 'HTTP Request' }] },
			// no `data` yet — a finished execution *with* data is filtered out by `amend()`
		},
	]);
	const service = new ExecutionRecoveryService({ executionRepository: repository, workflowRepository: new MemoryWorkflowRepository() });

	// logs that only describe a finished execution are ignored
	assert.equal(await service.recoverFromLogs('finished', [makeMessage('n8n.node.started', { nodeName: 'Webhook' }, 1)]), null);

	// a stream without node messages cannot amend anything (reference: `nodeMessages.length === 0 → null`)
	assert.equal(await service.recoverFromLogs('emptylogs', [makeMessage('n8n.workflow.started', {}, 1)]), null);
	assert.equal(repository.get('emptylogs').status, 'running');

	// no messages at all → amend without logs (markAsCrashed)
	const amended = await service.recoverFromLogs('emptylogs', []);
	assert.equal(amended.status, 'crashed');
	assert.equal(repository.get('emptylogs').status, 'crashed');

	// no messages + row missing → null
	assert.equal(await service.recoverFromLogs('missing', []), null);

	// an error execution stays 'error' and keeps the runData it already persisted
	const kept = await service.recoverFromLogs('keepProgress', [makeMessage('n8n.node.started', { nodeName: 'HTTP Request' }, 10)]);
	assert.equal(kept.status, 'error', 'an error execution keeps its status but is still amended');
	assert.equal(kept.data.resultData.runData['HTTP Request'][0].executionStatus, 'crashed');
	assert.equal(kept.data.resultData.lastNodeExecuted, 'HTTP Request');

	// a follower node must never amend (the leader owns recovery)
	const follower = new ExecutionRecoveryService({
		executionRepository: repository,
		workflowRepository: new MemoryWorkflowRepository(),
		isFollower: true,
	});
	assert.equal(await follower.recoverFromLogs('emptylogs', []), null);
});
