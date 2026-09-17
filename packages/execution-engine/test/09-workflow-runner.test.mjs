import test from 'node:test';
import assert from 'node:assert/strict';

import {
	ActiveExecutions,
	ExecutionCancelledError,
	ExecutionNotFoundError,
	ExecutionLifecycleHooks,
	MaxStalledCountError,
	TimeoutExecutionCancelledError,
	WorkflowRunner,
	createDeferredPromise,
} from '../src/index.mjs';

function createMockActiveExecutions(opts = {}) {
	const activeMap = new Map();
	const executions = [];
	const responsePromises = new Map();
	let stoppedExecution = null;

	return {
		activeExecutions: activeMap,
		executions,
		async add(data, restartExecutionId) {
			const id = restartExecutionId ?? `exec-${executions.length + 1}`;
			executions.push({ id, data });
			activeMap.set(id, { id, data, status: 'running' });
			return id;
		},
		attachWorkflowExecution(id, execution) {
			const entry = activeMap.get(id);
			if (entry) entry.workflowExecution = execution;
		},
		attachResponsePromise(id, promise) {
			responsePromises.set(id, promise);
		},
		resolveResponsePromise(id, response) {
			const p = responsePromises.get(id);
			if (p?.resolve) p.resolve(response);
		},
		resolveExecutionResponsePromise(id) {
			const p = responsePromises.get(id);
			if (p?.resolve) p.resolve({ executionId: id });
		},
		finalizeExecution(id, runData) {
			const entry = activeMap.get(id);
			if (entry) {
				entry.runData = runData;
				entry.finalized = true;
			}
		},
		stopExecution(id, error) {
			stoppedExecution = { id, error };
			const entry = activeMap.get(id);
			if (entry) {
				entry.status = 'cancelled';
				entry.error = error;
			}
		},
		setStatus(id, status) {
			const entry = activeMap.get(id);
			if (entry) entry.status = status;
		},
		getPostExecutePromise(id) {
			return Promise.resolve();
		},
		getStoppedExecution() {
			return stoppedExecution;
		},
		getResponseMode(id) {
			return 'onReceived';
		},
	};
}

test('processError: returns early on ExecutionNotFoundError without running hooks', async () => {
	let hookRun = false;
	const activeExec = createMockActiveExecutions();
	const runner = new WorkflowRunner({ activeExecutions: activeExec });

	const hooks = new ExecutionLifecycleHooks('manual', 'exec-1', { id: 'wf-1' });
	hooks.addHandler('workflowExecuteAfter', () => {
		hookRun = true;
	});

	await runner.processError(
		new ExecutionNotFoundError('exec-1'),
		new Date(),
		'manual',
		'exec-1',
		hooks,
	);

	assert.equal(hookRun, false, 'hooks must not run for ExecutionNotFoundError');
});

test('processError: returns early on ExecutionCancelledError without running hooks', async () => {
	let hookRun = false;
	const activeExec = createMockActiveExecutions();
	const runner = new WorkflowRunner({ activeExecutions: activeExec });

	const hooks = new ExecutionLifecycleHooks('manual', 'exec-1', { id: 'wf-1' });
	hooks.addHandler('workflowExecuteAfter', () => {
		hookRun = true;
	});

	await runner.processError(
		new ExecutionCancelledError('exec-1'),
		new Date(),
		'manual',
		'exec-1',
		hooks,
	);

	assert.equal(hookRun, false, 'hooks must not run for ExecutionCancelledError');
});

test('processError: detects queue mode false positive when already finished successfully', async () => {
	let hookRun = false;
	const activeExec = createMockActiveExecutions();
	const repo = {
		findSingleExecution: async (id) => ({ id, finished: true, status: 'success' }),
	};
	const runner = new WorkflowRunner({
		activeExecutions: activeExec,
		executionRepository: repo,
		executionsConfig: { mode: 'queue' },
	});

	const hooks = new ExecutionLifecycleHooks('webhook', 'exec-qp', { id: 'wf-1' });
	hooks.addHandler('workflowExecuteAfter', () => {
		hookRun = true;
	});

	await runner.processError(
		new Error('stalled false positive'),
		new Date(),
		'webhook',
		'exec-qp',
		hooks,
	);

	assert.equal(hookRun, false, 'queue mode false positive must return early');
});

test('processError: sets execution to error, finalizes runData and fires workflowExecuteAfter', async () => {
	let capturedRunData = null;
	const activeExec = createMockActiveExecutions();
	activeExec.activeExecutions.set('exec-err', { id: 'exec-err' });

	const runner = new WorkflowRunner({ activeExecutions: activeExec });

	const hooks = new ExecutionLifecycleHooks('manual', 'exec-err', { id: 'wf-1' });
	hooks.addHandler('workflowExecuteAfter', (runData) => {
		capturedRunData = runData;
	});

	const testError = new Error('Database connection failed');
	await runner.processError(testError, new Date(), 'manual', 'exec-err', hooks);

	assert.ok(capturedRunData, 'workflowExecuteAfter must be called');
	assert.equal(capturedRunData.status, 'error');
	assert.equal(capturedRunData.finished, false);
	assert.equal(capturedRunData.data.resultData.error.message, 'Database connection failed');
});

test('run: aborts and marks execution failed when credentials checker throws', async () => {
	const activeExec = createMockActiveExecutions();
	const checker = {
		check: async () => {
			const err = new Error('Missing credentials permission');
			err.node = { name: 'MyNode', type: 'test' };
			throw err;
		},
	};

	let beforeFired = false;
	let afterFired = false;
	const runner = new WorkflowRunner({
		activeExecutions: activeExec,
		credentialsPermissionChecker: checker,
		lifecycleHooksFactory: (data, id) => {
			const h = new ExecutionLifecycleHooks(data.executionMode, id, data.workflowData);
			h.addHandler('workflowExecuteBefore', () => { beforeFired = true; });
			h.addHandler('workflowExecuteAfter', () => { afterFired = true; });
			return h;
		},
	});

	const deferred = createDeferredPromise();
	const execId = await runner.run(
		{
			executionMode: 'manual',
			workflowData: { id: 'wf-1', name: 'Wf', nodes: [{ name: 'MyNode' }] },
		},
		false,
		false,
		undefined,
		deferred,
	);

	assert.equal(execId, 'exec-1');
	assert.equal(beforeFired, true, 'workflowExecuteBefore must run');
	assert.equal(afterFired, true, 'workflowExecuteAfter must run');
	await assert.rejects(deferred.promise, /Missing credentials permission/);
});

test('run: executes workflow in main process and resolves responsePromise', async () => {
	const activeExec = createMockActiveExecutions();
	let setRunningCalled = false;
	const repo = {
		setRunning: async () => { setRunningCalled = true; },
		findSingleExecution: async () => null,
	};

	const runner = new WorkflowRunner({
		activeExecutions: activeExec,
		executionRepository: repo,
		workflowExecuteFactory: () => ({
			processRunExecutionData: () => Promise.resolve({
				finished: true,
				status: 'success',
				data: {},
			}),
		}),
	});

	const deferred = createDeferredPromise();
	const execId = await runner.run(
		{
			executionMode: 'webhook',
			workflowData: { id: 'wf-1', name: 'Webhook Workflow', nodes: [] },
			executionData: { nodeExecutionStack: [] },
		},
		false,
		false,
		undefined,
		deferred,
	);

	assert.equal(execId, 'exec-1');
	assert.equal(setRunningCalled, true, 'executionRepository.setRunning must be called');
	const response = await deferred.promise;
	assert.deepEqual(response, { executionId: 'exec-1' });
});

test('run: sets up sendChunk handler when streamingEnabled is true', async () => {
	const activeExec = createMockActiveExecutions();
	const writtenChunks = [];
	const httpResponse = {
		write: (chunk) => writtenChunks.push(chunk),
		flush: () => {},
	};

	let attachedHooks = null;
	const runner = new WorkflowRunner({
		activeExecutions: activeExec,
		workflowExecuteFactory: (additionalData) => {
			attachedHooks = additionalData.hooks;
			return {
				processRunExecutionData: () => Promise.resolve({ finished: true, status: 'success', data: {} }),
			};
		},
	});

	await runner.run({
		executionMode: 'webhook',
		workflowData: { id: 'wf-stream', name: 'Streaming Workflow', nodes: [] },
		executionData: {},
		streamingEnabled: true,
		httpResponse,
	});

	assert.ok(attachedHooks, 'lifecycle hooks must be attached');
	await attachedHooks.runHook('sendChunk', [{ text: 'chunk 1' }]);
	assert.equal(writtenChunks.length, 1);
	assert.equal(writtenChunks[0], JSON.stringify({ text: 'chunk 1' }) + '\n');
});

test('run: loads static data when loadStaticData is true', async () => {
	const activeExec = createMockActiveExecutions();
	let loadedId = null;
	const staticDataService = {
		getStaticDataById: async (id) => {
			loadedId = id;
			return { lastId: 100 };
		},
	};

	const runner = new WorkflowRunner({
		activeExecutions: activeExec,
		workflowStaticDataService: staticDataService,
		workflowExecuteFactory: () => ({
			processRunExecutionData: () => Promise.resolve({ finished: true, status: 'success', data: {} }),
		}),
	});

	const data = {
		executionMode: 'trigger',
		workflowData: { id: 'wf-static-1', name: 'Static Workflow', nodes: [] },
		executionData: {},
	};

	await runner.run(data, true);
	assert.equal(loadedId, 'wf-static-1');
	assert.equal(data.workflowData.staticData.lastId, 100);
});

test('run: calculates relative timeout based on startedAt and stops execution immediately if elapsed', async () => {
	const activeExec = createMockActiveExecutions();
	const runner = new WorkflowRunner({
		activeExecutions: activeExec,
		executionsConfig: { timeout: 10, maxTimeout: 60 },
		workflowExecuteFactory: () => ({
			processRunExecutionData: () => new Promise(() => {}), // never completes
		}),
	});

	// Started 15 seconds ago, timeout is 10 seconds -> elapsed!
	const pastStartedAt = new Date(Date.now() - 15000);
	await runner.run({
		executionMode: 'webhook',
		workflowData: { id: 'wf-timeout', settings: { executionTimeout: 10 }, nodes: [] },
		executionData: {},
		startedAt: pastStartedAt,
	});

	const stopped = activeExec.getStoppedExecution();
	assert.ok(stopped, 'execution must be stopped immediately');
	assert.ok(stopped.error instanceof TimeoutExecutionCancelledError);
});

test('run: enqueues execution when in queue mode and delegates to scalingService', async () => {
	const activeExec = createMockActiveExecutions();
	let jobAdded = null;
	const mockJob = {
		id: 42,
		data: { executionId: 'exec-1', workflowId: 'wf-q' },
		finished: async () => {},
	};

	const scalingService = {
		addJob: async (data, opts) => {
			jobAdded = { data, opts };
			return mockJob;
		},
		popJobResult: () => ({
			success: true,
			status: 'success',
			startedAt: new Date(),
			stoppedAt: new Date(),
			lastNodeExecuted: 'NodeB',
		}),
	};

	const runner = new WorkflowRunner({
		activeExecutions: activeExec,
		executionsConfig: { mode: 'queue' },
		scalingService,
	});

	const execId = await runner.run({
		executionMode: 'trigger',
		workflowData: { id: 'wf-q', name: 'Queue Wf', nodes: [] },
		executionData: {},
	});

	assert.equal(execId, 'exec-1');
	assert.ok(jobAdded, 'job must be added to scaling service');
	assert.equal(jobAdded.data.workflowId, 'wf-q');
});
