import test from 'node:test';
import assert from 'node:assert/strict';
import {
	ActiveExecutions,
	ExecutionNotFoundError,
	ExecutionAlreadyResumingError,
	ExecutionCancelledError,
	ManualExecutionCancelledError,
	TimeoutExecutionCancelledError,
	SystemShutdownExecutionCancelledError,
	createDeferredPromise,
} from '../src/index.mjs';

test('ActiveExecutions: add new execution creates record, reserves capacity and sets status', async () => {
	let createdPayload;
	let reservedPayload;
	let runningId;

	const mockPersistence = {
		create: async (payload) => {
			createdPayload = payload;
			return 'exec-101';
		},
	};
	const mockConcurrency = {
		reserve: async (req) => {
			reservedPayload = req;
		},
		release: () => {},
	};
	const mockRepo = {
		setRunning: async (id) => {
			runningId = id;
		},
	};

	const active = new ActiveExecutions({
		executionPersistence: mockPersistence,
		concurrencyControl: mockConcurrency,
		executionRepository: mockRepo,
		executionsConfig: { mode: 'regular' },
	});

	const workflowData = { id: 'wf-1', name: 'Test WF' };
	const executionData = {
		executionMode: 'manual',
		workflowData,
		executionData: { startData: {} },
		retryOf: 'exec-100',
	};

	const id = await active.add(executionData);
	assert.equal(id, 'exec-101');
	assert.equal(active.has('exec-101'), true);
	assert.equal(createdPayload.mode, 'manual');
	assert.equal(createdPayload.workflowId, 'wf-1');
	assert.equal(createdPayload.retryOf, 'exec-100');
	assert.equal(reservedPayload.executionId, 'exec-101');
	assert.equal(runningId, 'exec-101');
	assert.equal(active.getStatus('exec-101'), 'running');

	const summaries = active.getActiveExecutions();
	assert.equal(summaries.length, 1);
	assert.equal(summaries[0].id, 'exec-101');
	assert.equal(summaries[0].workflowId, 'wf-1');
	assert.equal(summaries[0].retryOf, 'exec-100');
});

test('ActiveExecutions: add resuming execution enforces requireStatus waiting and catches conflicts', async () => {
	let updateCall;
	let shouldSucceed = true;

	const mockRepo = {
		updateExistingExecution: async (id, data, options) => {
			updateCall = { id, data, options };
			return shouldSucceed;
		},
	};

	const active = new ActiveExecutions({
		executionRepository: mockRepo,
	});

	const executionData = {
		executionMode: 'integrated',
		workflowData: { id: 'wf-2' },
		executionData: { resumeData: {} },
	};

	// 1. Successful resume
	const id = await active.add(executionData, 'exec-202');
	assert.equal(id, 'exec-202');
	assert.equal(updateCall.id, 'exec-202');
	assert.deepEqual(updateCall.options, { requireStatus: 'waiting' });
	assert.equal(updateCall.data.waitTill, null);
	assert.equal(active.getStatus('exec-202'), 'running');

	// 2. Conflict: another worker is already resuming
	shouldSucceed = false;
	await assert.rejects(
		() => active.add(executionData, 'exec-303'),
		(err) => err instanceof ExecutionAlreadyResumingError && err.executionId === 'exec-303',
	);
	assert.equal(active.has('exec-303'), false);
});

test('ActiveExecutions: postExecutePromise resolution automatically cleans up or preserves waiting execution', async () => {
	const active = new ActiveExecutions();

	const id1 = await active.add({ executionMode: 'manual', workflowData: { id: 'wf-1' } }, 'exec-1');
	const id2 = await active.add({ executionMode: 'manual', workflowData: { id: 'wf-2' } }, 'exec-2');

	assert.equal(active.has(id1), true);
	assert.equal(active.has(id2), true);

	// exec-1 finishes normally
	const runData1 = { resultData: { runData: {} } };
	active.finalizeExecution(id1, runData1);
	const postResult1 = await active.getPostExecutePromise(id1);
	assert.deepEqual(postResult1, runData1);

	// Let microtasks run
	await new Promise((r) => setImmediate(r));
	assert.equal(active.has(id1), false, 'finished execution should be removed');

	// exec-2 transitions to waiting
	active.setStatus(id2, 'waiting');
	const cancelableDummy = { cancel: () => {} };
	active.attachWorkflowExecution(id2, cancelableDummy);
	active.finalizeExecution(id2, undefined);
	await new Promise((r) => setImmediate(r));

	assert.equal(active.has(id2), true, 'waiting execution should be preserved');
	assert.equal(active.getExecutionOrFail(id2).workflowExecution, undefined, 'workflowExecution reference should be dropped');
});

test('ActiveExecutions: attachWorkflowExecution, attachResponsePromise, and resolveResponsePromise', async () => {
	const active = new ActiveExecutions();
	const id = await active.add({ executionMode: 'webhook', workflowData: { id: 'wf-3' } }, 'exec-hook');

	let cancelCalled = false;
	const dummyWorkflowExecution = {
		cancel: () => {
			cancelCalled = true;
		},
	};
	active.attachWorkflowExecution(id, dummyWorkflowExecution);
	assert.equal(active.getExecutionOrFail(id).workflowExecution, dummyWorkflowExecution);

	const responsePromise = createDeferredPromise();
	active.attachResponsePromise(id, responsePromise);
	assert.equal(active.getExecutionOrFail(id).responsePromise, responsePromise);

	active.resolveResponsePromise(id, { data: 'ok', responseCode: 200 });
	const resolved = await responsePromise.promise;
	assert.deepEqual(resolved, { data: 'ok', responseCode: 200 });
});

test('ActiveExecutions: sendChunk writes structured NDJSON and flushes response', async () => {
	const chunks = [];
	let flushCalled = false;
	let endCalled = false;

	const mockHttpResponse = {
		write: (data) => chunks.push(data),
		flush: () => {
			flushCalled = true;
		},
		end: () => {
			endCalled = true;
		},
	};

	const active = new ActiveExecutions();
	const id = await active.add(
		{
			executionMode: 'webhook',
			workflowData: { id: 'wf-stream' },
			httpResponse: mockHttpResponse,
		},
		'exec-stream',
	);

	active.sendChunk(id, { type: 'item', content: 'hello world' });
	assert.equal(chunks.length, 1);
	assert.equal(chunks[0], '{"type":"item","content":"hello world"}\n');
	assert.equal(flushCalled, true);

	active.finalizeExecution(id, { status: 'success' });
	assert.equal(endCalled, true);
});

test('ActiveExecutions: stopExecution cancels workflowExecution, rejects promises and emits event', async () => {
	let cancelledEvent;
	let cancelInvoked = false;

	const mockEventService = {
		emit: (event, payload) => {
			if (event === 'execution-cancelled') cancelledEvent = payload;
		},
	};

	const active = new ActiveExecutions({ eventService: mockEventService });
	const id = await active.add(
		{
			executionMode: 'manual',
			workflowData: { id: 'wf-c', name: 'Cancel Me' },
		},
		'exec-cancel',
	);

	const dummyExecution = {
		cancel: () => {
			cancelInvoked = true;
		},
	};
	active.attachWorkflowExecution(id, dummyExecution);
	const responsePromise = createDeferredPromise();
	active.attachResponsePromise(id, responsePromise);

	const postExecutePromise = active.getPostExecutePromise(id);

	const cancelError = new ManualExecutionCancelledError(id);
	active.stopExecution(id, cancelError);

	assert.equal(cancelInvoked, true);
	assert.equal(cancelledEvent.executionId, 'exec-cancel');
	assert.equal(cancelledEvent.workflowId, 'wf-c');
	assert.equal(cancelledEvent.workflowName, 'Cancel Me');
	assert.equal(cancelledEvent.reason, 'manual');

	await assert.rejects(responsePromise.promise, (err) => err instanceof ManualExecutionCancelledError);
	await assert.rejects(postExecutePromise, (err) => err instanceof ManualExecutionCancelledError);
});

test('ActiveExecutions: stopExecution for waiting execution cleans up immediately', async () => {
	const active = new ActiveExecutions();
	const id = await active.add({ executionMode: 'webhook', workflowData: { id: 'wf-w' } }, 'exec-wait');
	active.setStatus(id, 'waiting');

	const cancelError = new TimeoutExecutionCancelledError(id);
	active.stopExecution(id, cancelError);

	assert.equal(active.has(id), false);
	assert.throws(() => active.getExecutionOrFail(id), ExecutionNotFoundError);
});

test('ActiveExecutions: resolveExecutionResponsePromise clears responsePromise for non-waiting execution', async () => {
	const active = new ActiveExecutions();
	const id = await active.add({ executionMode: 'webhook', workflowData: { id: 'wf-form' } }, 'exec-form');

	const responsePromise = createDeferredPromise();
	active.attachResponsePromise(id, responsePromise);

	active.resolveExecutionResponsePromise(id);
	const resolved = await responsePromise.promise;
	assert.deepEqual(resolved, {});
});

test('ActiveExecutions: response mode getters and setters', async () => {
	const active = new ActiveExecutions();
	const id = await active.add({ executionMode: 'webhook', workflowData: { id: 'wf-mode' } }, 'exec-m');

	assert.equal(active.getResponseMode(id), undefined);
	active.setResponseMode(id, 'responseNode');
	assert.equal(active.getResponseMode(id), 'responseNode');
});

test('ActiveExecutions: shutdown drains active executions and stops running ones on cancelAll', async () => {
	let concurrencyDisabled = false;
	const mockConcurrency = {
		disable: () => {
			concurrencyDisabled = true;
		},
		removeAll: async () => {},
	};

	const active = new ActiveExecutions({
		concurrencyControl: mockConcurrency,
		executionsConfig: { mode: 'regular' },
	});

	const id1 = await active.add({ executionMode: 'manual', workflowData: { id: 'wf-1' } }, 'exec-s1');
	const id2 = await active.add({ executionMode: 'manual', workflowData: { id: 'wf-2' } }, 'exec-s2');
	active.setStatus(id2, 'waiting');

	const shutdownPromise = active.shutdown(true);

	// Let shutdown inspect active executions
	await new Promise((r) => setTimeout(r, 10));

	assert.equal(concurrencyDisabled, true);
	assert.equal(active.has(id2), false, 'waiting execution should be removed during shutdown');

	// Finalize id1 to allow drain to finish
	active.finalizeExecution(id1, { finished: true });

	await shutdownPromise;
	assert.equal(active.has(id1), false);
});
