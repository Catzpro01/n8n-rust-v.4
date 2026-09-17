import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	ActiveExecutions,
	ActiveWorkflows,
	ExecutionContextHookRegistry,
	ExecutionContextService,
	ExecutionRecoveryService,
	ExecutionAlreadyResumingError,
	ExecutionNotFoundError,
	ManualExecutionCancelledError,
	MemoryConcurrencyControl,
	MemoryExecutionPersistence,
	MemoryExecutionRepository,
	MemoryWorkflowRepository,
	NodeCrashedError,
	SystemShutdownExecutionCancelledError,
	TriggerCloseError,
	UserError,
	WorkflowActivationError,
	WorkflowCrashedError,
	WorkflowDeactivationError,
	ARTIFICIAL_TASK_DATA,
	Emitter,
	createRecordingLogger,
	deepMerge,
	isWorkflowIdValid,
} from '../src/index.ts';

const WORKFLOW = { id: 'wf-1', name: 'Workflow One' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const flush = () => new Promise((resolve) => setImmediate(resolve));

const buildExecutions = (options = {}) => {
	const repository = new MemoryExecutionRepository(options.seed ?? []);
	const logger = createRecordingLogger();
	const eventService = new Emitter();
	const concurrencyControl = new MemoryConcurrencyControl();
	const activeExecutions = new ActiveExecutions({
		logger,
		executionRepository: repository,
		executionPersistence: new MemoryExecutionPersistence(repository),
		concurrencyControl,
		eventService,
		executionsConfig: { mode: options.mode ?? 'regular' },
		sleep: options.sleep ?? (async () => {}),
	});
	return { repository, logger, eventService, concurrencyControl, activeExecutions };
};

const executionData = (overrides = {}) => ({
	executionMode: 'trigger',
	workflowData: { ...WORKFLOW },
	...overrides,
});

/* ------------------------------------------------------------------ *
 * X1..X8 — ActiveExecutions
 * ------------------------------------------------------------------ */

test('X1 — add() persists a new execution and marks it running in regular mode', async () => {
	const { activeExecutions, repository, concurrencyControl } = buildExecutions();

	const id = await activeExecutions.add(executionData());

	assert.equal(id, 'exec-1');
	assert.equal(activeExecutions.has(id), true);
	assert.equal(activeExecutions.getStatus(id), 'running');
	assert.equal(repository.get(id).status, 'running');
	assert.deepEqual(concurrencyControl.reservations, [id]);

	// queue mode leaves the row as 'new' until the worker picks it up
	const queueBuild = buildExecutions({ mode: 'queue' });
	const queueId = await queueBuild.activeExecutions.add(executionData());
	assert.equal(queueBuild.repository.get(queueId).status, 'new');
	assert.equal(queueBuild.activeExecutions.getStatus(queueId), 'running');
});

test('X1b — the raw workflow id is forwarded (the reference re-asserts only valid ids)', async () => {
	const { activeExecutions, repository } = buildExecutions();

	const id = await activeExecutions.add(
		executionData({ workflowData: { id: 'x'.repeat(30), name: 'too long' } }),
	);

	// `isWorkflowIdValid` gates the re-assignment, not the initial payload:
	// active-executions.ts writes `workflowId: executionData.workflowData.id` first.
	assert.equal(repository.get(id).workflowId, 'x'.repeat(30));
});

test('X2 — resuming requires status waiting, otherwise ExecutionAlreadyResumingError', async () => {
	const { activeExecutions, repository, concurrencyControl } = buildExecutions({
		seed: [{ id: 'exec-waiting', workflowId: 'wf-1', status: 'waiting', mode: 'trigger', startedAt: new Date() }],
	});

	const resumedAt = new Date('2026-01-01T00:00:00.000Z');
	const firstId = await activeExecutions.add(executionData(), 'exec-waiting');
	assert.equal(firstId, 'exec-waiting');
	assert.equal(repository.get('exec-waiting').status, 'running');

	// a second resume attempt finds status 'running' — not 'waiting'
	await assert.rejects(
		() => activeExecutions.add(executionData(), 'exec-waiting'),
		(error) => {
			assert.ok(error instanceof ExecutionAlreadyResumingError);
			assert.equal(error.message, 'Execution is already being resumed by another process');
			assert.deepEqual(error.extra, { executionId: 'exec-waiting' });
			return true;
		},
	);
	// the failed reservation is released again
	assert.equal(concurrencyControl.reservations.length, 1);
	assert.ok(resumedAt instanceof Date);
});

test('X3 — summary shape and the not-found error', async () => {
	const { activeExecutions } = buildExecutions();

	const id = await activeExecutions.add(executionData({ retryOf: 'exec-0' }));
	const [summary] = activeExecutions.getActiveExecutions();

	assert.deepEqual(Object.keys(summary).sort(), ['id', 'mode', 'retryOf', 'startedAt', 'status', 'workflowId'].sort());
	assert.equal(summary.id, id);
	assert.equal(summary.mode, 'trigger');
	assert.equal(summary.status, 'running');
	assert.equal(summary.workflowId, 'wf-1');
	assert.equal(summary.retryOf, 'exec-0');

	assert.throws(
		() => activeExecutions.getExecutionOrFail('missing'),
		(error) => {
			assert.ok(error instanceof ExecutionNotFoundError);
			assert.equal(error.message, 'No active execution found');
			assert.deepEqual(error.extra, { executionId: 'missing' });
			return true;
		},
	);
});

test('X4 — executions remove themselves when the post-execute promise settles, waiting ones survive', async () => {
	const { activeExecutions, logger } = buildExecutions();

	const doneId = await activeExecutions.add(executionData());
	activeExecutions.finalizeExecution(doneId, { status: 'success' });
	await flush();
	assert.equal(activeExecutions.has(doneId), false);

	const waitingId = await activeExecutions.add(executionData());
	activeExecutions.setStatus(waitingId, 'waiting');
	activeExecutions.attachWorkflowExecution(waitingId, { cancel: () => {} });
	activeExecutions.finalizeExecution(waitingId, { status: 'waiting' });
	await flush();

	assert.equal(activeExecutions.has(waitingId), true, 'a waiting execution stays registered');
	assert.equal(activeExecutions.getExecutionOrFail(waitingId).workflowExecution, undefined);
	assert.ok(logger.lines.includes('debug: Execution removed'));
	assert.ok(logger.lines.includes('debug: Execution finalized'));
});

test('X5 — stopExecution emits execution-cancelled and settles both promises', async () => {
	const { activeExecutions, eventService } = buildExecutions();

	let cancelled = null;
	eventService.on('execution-cancelled', (payload) => {
		cancelled = payload;
	});

	const id = await activeExecutions.add(executionData());
	const postExecute = activeExecutions.getPostExecutePromise(id);
	let workflowCancelled = false;
	activeExecutions.attachWorkflowExecution(id, { cancel: () => (workflowCancelled = true) });

	activeExecutions.stopExecution(id, new ManualExecutionCancelledError(id));

	assert.deepEqual(cancelled, {
		executionId: id,
		workflowId: 'wf-1',
		workflowName: 'Workflow One',
		reason: 'manual',
	});
	assert.equal(workflowCancelled, true);
	await assert.rejects(() => postExecute, /The execution was cancelled manually/);
	await flush();
	assert.equal(activeExecutions.has(id), false);

	// unknown ids are a no-op
	assert.doesNotThrow(() => activeExecutions.stopExecution('nope', new ManualExecutionCancelledError('nope')));
});

test('X5b — a waiting execution is dropped immediately on cancel', async () => {
	const { activeExecutions } = buildExecutions();

	const id = await activeExecutions.add(executionData());
	activeExecutions.setStatus(id, 'waiting');
	activeExecutions.stopExecution(id, new ManualExecutionCancelledError(id));

	assert.equal(activeExecutions.has(id), false);
});

test('X6 — finalizeExecution resolves the run and closes streaming responses', async () => {
	const { activeExecutions, logger } = buildExecutions();

	const closed = [];
	const flakyResponse = {
		write: () => {},
		flush: () => {},
		end: () => {
			throw new Error('socket gone');
		},
	};
	const id = await activeExecutions.add(executionData({ httpResponse: flakyResponse }));
	activeExecutions.finalizeExecution(id);
	assert.equal(await activeExecutions.getPostExecutePromise(id), undefined);
	assert.ok(logger.lines.includes('error: Error closing streaming response'));

	const streamed = [];
	const response = {
		write: (chunk) => streamed.push(chunk),
		flush: () => streamed.push('flush'),
		end: () => closed.push('end'),
	};
	const id2 = await activeExecutions.add(executionData({ httpResponse: response }));
	activeExecutions.sendChunk(id2, { type: 'nodeExecuteAfter', data: { nodeName: 'A' } });
	activeExecutions.finalizeExecution(id2, { status: 'success' });
	assert.deepEqual(streamed, [`${JSON.stringify({ type: 'nodeExecuteAfter', data: { nodeName: 'A' } })}\n`, 'flush']);
	assert.deepEqual(closed, ['end']);
});

test('X6b — resolveExecutionResponsePromise only resolves outside the waiting state', async () => {
	const { activeExecutions } = buildExecutions();

	const id = await activeExecutions.add(executionData());
	const responsePromise = { resolve: (value) => (responsePromise.value = value) };
	activeExecutions.attachResponsePromise(id, responsePromise);

	activeExecutions.setStatus(id, 'waiting');
	activeExecutions.resolveExecutionResponsePromise(id);
	assert.equal(responsePromise.value, undefined);

	activeExecutions.setStatus(id, 'running');
	activeExecutions.resolveExecutionResponsePromise(id);
	assert.deepEqual(responsePromise.value, {});
});

test('X7 — shutdown cancels everything in regular mode and drops waiting/new executions', async () => {
	const { activeExecutions, concurrencyControl } = buildExecutions({ sleep: async () => {} });

	const runningId = await activeExecutions.add(executionData());
	const waitingId = await activeExecutions.add(executionData());
	activeExecutions.setStatus(waitingId, 'waiting');

	await activeExecutions.shutdown(true);

	assert.equal(activeExecutions.has(runningId), false);
	assert.equal(activeExecutions.has(waitingId), false);
	assert.equal(concurrencyControl.disabled, true);
	assert.deepEqual(concurrencyControl.reservations, []);

	// the cancellation error is the shutdown flavour (X7 detail)
	const { activeExecutions: active2, eventService } = buildExecutions({ sleep: async () => {} });
	const reasons = [];
	eventService.on('execution-cancelled', (payload) => reasons.push(payload.reason));
	const id = await active2.add(executionData());
	await active2.shutdown(true);
	assert.deepEqual(reasons, ['shutdown']);
	assert.equal(active2.has(id), false);
	assert.equal(SystemShutdownExecutionCancelledError.prototype.message, '');
	assert.equal(new SystemShutdownExecutionCancelledError(id).reason, 'shutdown');
});

test('X8 — isWorkflowIdValid accepts 1..21 characters', () => {
	assert.equal(isWorkflowIdValid('a'), true);
	assert.equal(isWorkflowIdValid('a'.repeat(21)), true);
	assert.equal(isWorkflowIdValid('a'.repeat(22)), false);
	assert.equal(isWorkflowIdValid(''), false);
	assert.equal(isWorkflowIdValid(null), false);
	assert.equal(isWorkflowIdValid(undefined), false);
});

/* ------------------------------------------------------------------ *
 * X9..X12 — ActiveWorkflows
 * ------------------------------------------------------------------ */

const buildWorkflow = ({ triggers = [{ name: 'Webhook' }], polls = [] } = {}) => ({
	id: 'wf-1',
	name: 'Workflow One',
	timezone: 'UTC',
	getTriggerNodes: () => triggers,
	getPollNodes: () => polls,
	getNode: () => ({ parameters: {} }),
});

test('X9 — trigger failures are wrapped in WorkflowActivationError', async () => {
	const workflows = new ActiveWorkflows({
		triggersAndPollers: {
			runTrigger: async () => {
				throw new Error('port 5678 already in use');
			},
			runPoll: async () => null,
		},
	});

	await assert.rejects(
		() => workflows.add('wf-1', buildWorkflow(), {}, 'trigger', 'init'),
		(error) => {
			assert.ok(error instanceof WorkflowActivationError);
			assert.equal(
				error.message,
				'There was a problem activating the workflow: "port 5678 already in use"',
			);
			assert.equal(error.node.name, 'Webhook');
			return true;
		},
	);
	assert.equal(workflows.isActive('wf-1'), false);
});

test('X9b — trigger responses are stored even without polling nodes', async () => {
	const responses = [];
	const workflows = new ActiveWorkflows({
		triggersAndPollers: {
			runTrigger: async (workflow, node) => {
				const response = { closeFunction: async () => responses.push(`closed ${node.name}`) };
				return response;
			},
			runPoll: async () => null,
		},
	});

	await workflows.add('wf-1', buildWorkflow(), {}, 'trigger', 'init');
	assert.equal(workflows.isActive('wf-1'), true);
	assert.deepEqual(workflows.allActiveWorkflows(), ['wf-1']);
	assert.equal(workflows.get('wf-1').triggerResponses.length, 1);

	await workflows.remove('wf-1');
	assert.deepEqual(responses, ['closed Webhook']);
	assert.deepEqual(workflows.allActiveWorkflows(), []);
});

test('X10 — polling validates the cron and runs the trigger once on activation', async () => {
	const registered = [];
	const polls = [];
	const workflows = new ActiveWorkflows({
		scheduledTaskManager: {
			registerCron: (ctx) => registered.push(ctx.expression),
			deregisterCrons: () => {},
		},
		toCronExpression: (triggerTime) => triggerTime.expression,
		getPollFunctions: () => ({
			getNodeParameter: () => ({ item: [{ expression: '0 5 * * *' }] }),
			__emit: (data) => polls.push(data),
			__emitError: () => {},
		}),
		triggersAndPollers: {
			runTrigger: async () => undefined,
			runPoll: async () => ({ json: { polled: true } }),
		},
	});

	await workflows.add('wf-1', buildWorkflow({ triggers: [], polls: [{ name: 'Schedule', id: 'n1' }] }), {}, 'trigger', 'init');

	assert.deepEqual(registered, ['0 5 * * *']);
	assert.deepEqual(polls, [{ json: { polled: true } }]);

	const wildcard = new ActiveWorkflows({
		scheduledTaskManager: { registerCron: () => {}, deregisterCrons: () => {} },
		toCronExpression: (triggerTime) => triggerTime.expression,
		getPollFunctions: () => ({
			getNodeParameter: () => ({ item: [{ expression: '*/5 * * * *' }] }),
			__emit: () => {},
			__emitError: () => {},
		}),
		triggersAndPollers: { runTrigger: async () => undefined, runPoll: async () => null },
	});

	await assert.rejects(
		() => wildcard.add('wf-1', buildWorkflow({ triggers: [], polls: [{ name: 'Schedule' }] }), {}, 'trigger', 'init'),
		(error) => {
			assert.ok(error instanceof WorkflowActivationError);
			assert.ok(error.cause instanceof UserError);
			assert.equal(error.cause.message, 'The polling interval is too short. It has to be at least a minute.');
			return true;
		},
	);
});

test('X11 — a failed poll activation keeps the workflow inactive when no trigger responded', async () => {
	const workflows = new ActiveWorkflows({
		scheduledTaskManager: { registerCron: () => {}, deregisterCrons: () => {} },
		toCronExpression: () => '0 5 * * *',
		getPollFunctions: () => ({ getNodeParameter: () => ({ item: [] }), __emit: () => {}, __emitError: () => {} }),
		triggersAndPollers: {
			runTrigger: async () => undefined,
			runPoll: async () => {
				throw new Error('poll backend unreachable');
			},
		},
	});

	await assert.rejects(
		() => workflows.add('wf-1', buildWorkflow({ triggers: [], polls: [{ name: 'Schedule' }] }), {}, 'trigger', 'init'),
		/There was a problem activating the workflow: "poll backend unreachable"/,
	);
	assert.equal(workflows.isActive('wf-1'), false);

	// when a trigger DID respond, the workflow stays registered despite the failed poller
	const partiallyActive = new ActiveWorkflows({
		scheduledTaskManager: { registerCron: () => {}, deregisterCrons: () => {} },
		toCronExpression: () => '0 5 * * *',
		getPollFunctions: () => ({ getNodeParameter: () => ({ item: [] }), __emit: () => {}, __emitError: () => {} }),
		triggersAndPollers: {
			runTrigger: async () => ({ closeFunction: async () => {} }),
			runPoll: async () => {
				throw new Error('poll backend unreachable');
			},
		},
	});

	await assert.rejects(() =>
		partiallyActive.add(
			'wf-1',
			buildWorkflow({ triggers: [{ name: 'Webhook' }], polls: [{ name: 'Schedule' }] }),
			{},
			'trigger',
			'init',
		),
	);
	assert.equal(partiallyActive.isActive('wf-1'), true);
});

test('X10b — a poll error after activation is emitted, not thrown', async () => {
	const errors = [];
	let armed = false;
	const invoked = [];
	let executeTrigger;
	const workflows = new ActiveWorkflows({
		scheduledTaskManager: { registerCron: (ctx, fn) => (executeTrigger = fn), deregisterCrons: () => {} },
		toCronExpression: () => '0 5 * * *',
		getPollFunctions: () => ({
			getNodeParameter: () => ({ item: [{ expression: '0 5 * * *' }] }),
			__emit: () => {},
			__emitError: (error) => errors.push(error.message),
		}),
		triggersAndPollers: {
			runTrigger: async () => undefined,
			runPoll: async () => {
				invoked.push(armed);
				if (armed) throw new Error('poll backend unreachable');
				return null;
			},
		},
	});

	await workflows.add('wf-1', buildWorkflow({ triggers: [], polls: [{ name: 'Schedule' }] }), {}, 'trigger', 'init');
	assert.deepEqual(invoked, [false], 'the trigger runs once during activation to validate it');
	assert.deepEqual(errors, []);

	armed = true;
	await executeTrigger();
	assert.deepEqual(errors, ['poll backend unreachable'], 'later cron failures are emitted');
});

test('X12 — remove() semantics, TriggerCloseError tolerance and deactivation errors', async () => {
	const logger = createRecordingLogger();
	const reported = [];
	const workflows = new ActiveWorkflows({ logger, errorReporter: { error: (error) => reported.push(error) } });

	assert.equal(await workflows.remove('wf-unknown'), false);
	assert.ok(logger.lines.includes('warn: Cannot deactivate already inactive workflow ID "wf-unknown"'));

	// TriggerCloseError → logged + reported, workflow still removed
	const closeFailure = new ActiveWorkflows({
		logger,
		errorReporter: { error: (error) => reported.push(error) },
		triggersAndPollers: { runTrigger: async () => ({ closeFunction: async () => {} }), runPoll: async () => null },
	});
	await closeFailure.add(
		'wf-1',
		buildWorkflow(),
		{},
		'trigger',
		'init',
	);
	closeFailure.get('wf-1').triggerResponses[0].closeFunction = async () => {
		throw new TriggerCloseError({ name: 'Webhook' }, { level: 'warning' });
	};
	assert.equal(await closeFailure.remove('wf-1'), true);
	assert.equal(closeFailure.isActive('wf-1'), false);
	assert.ok(
		logger.lines.some((line) => line.includes('There was a problem calling "closeFunction" on "Webhook"')),
	);
	assert.equal(reported.length, 1);

	// any other close error → WorkflowDeactivationError
	const brokenClose = new ActiveWorkflows({
		triggersAndPollers: { runTrigger: async () => ({ closeFunction: async () => {} }), runPoll: async () => null },
	});
	await brokenClose.add('wf-2', buildWorkflow(), {}, 'trigger', 'init');
	brokenClose.get('wf-2').triggerResponses[0].closeFunction = async () => {
		throw new Error('socket closed');
	};
	await assert.rejects(
		() => brokenClose.remove('wf-2'),
		(error) => {
			assert.ok(error instanceof WorkflowDeactivationError);
			assert.equal(error.message, 'Failed to deactivate trigger of workflow ID "wf-2": "socket closed"');
			return true;
		},
	);

	// removeAll deactivates and logs
	const many = new ActiveWorkflows({ logger });
	const triggers = { runTrigger: async () => ({ closeFunction: async () => {} }), runPoll: async () => null };
	const seeded = new ActiveWorkflows({ logger, triggersAndPollers: triggers });
	await seeded.add('wf-a', buildWorkflow(), {}, 'trigger', 'init');
	await seeded.add('wf-b', buildWorkflow(), {}, 'trigger', 'init');
	await seeded.removeAllTriggerAndPollerBasedWorkflows();
	assert.deepEqual(seeded.allActiveWorkflows(), []);
	assert.ok(logger.lines.includes('debug: Deactivated all trigger- and poller-based workflows'));
	assert.ok(many);
});
