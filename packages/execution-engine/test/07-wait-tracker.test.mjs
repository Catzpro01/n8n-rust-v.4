import assert from 'node:assert/strict';
import test from 'node:test';
import {
	ExecutionAlreadyResumingError,
	OperationalError,
	UnexpectedError,
	WaitTracker,
	createDeferredPromise,
	createRunExecutionData,
	getDataLastExecutedNodeData,
	shouldRestartParentExecution,
	updateParentExecutionWithChildResults,
} from '../src/index.mjs';

function createMockLogger() {
	const logs = [];
	const logger = {
		logs,
		debug: (...args) => logs.push({ level: 'debug', args }),
		error: (...args) => logs.push({ level: 'error', args }),
		info: (...args) => logs.push({ level: 'info', args }),
		warn: (...args) => logs.push({ level: 'warn', args }),
		scoped: () => logger,
	};
	return logger;
}

function createMockHarness({ isLeader = true, initialTime = 10000 } = {}) {
	let currentTime = initialTime;
	const timers = new Map();
	let nextTimerId = 1;

	const setTimeoutFn = (fn, delay) => {
		const id = nextTimerId++;
		timers.set(id, { fn, triggerAt: currentTime + delay, type: 'timeout' });
		return id;
	};

	const clearTimeoutFn = (id) => {
		timers.delete(id);
	};

	const setIntervalFn = (fn, delay) => {
		const id = nextTimerId++;
		timers.set(id, { fn, delay, triggerAt: currentTime + delay, type: 'interval' });
		return id;
	};

	const clearIntervalFn = (id) => {
		timers.delete(id);
	};

	const advanceTime = async (ms) => {
		currentTime += ms;
		// Trigger any expired timers in chronological order
		while (true) {
			const ready = [...timers.entries()]
				.filter(([_, t]) => t.triggerAt <= currentTime)
				.sort((a, b) => a[1].triggerAt - b[1].triggerAt);

			if (ready.length === 0) break;
			const [id, timer] = ready[0];
			if (timer.type === 'timeout') {
				timers.delete(id);
			} else {
				timer.triggerAt += timer.delay;
			}
			await timer.fn();
		}
	};

	const executions = new Map();
	const waitingExecutionsList = [];

	const executionRepository = {
		executions,
		waitingExecutionsList,
		calls: {
			getWaitingExecutions: 0,
			findSingleExecution: [],
			updateExistingExecution: [],
		},
		getWaitingExecutions: async () => {
			executionRepository.calls.getWaitingExecutions++;
			return [...executionRepository.waitingExecutionsList];
		},
		findSingleExecution: async (id, opts) => {
			executionRepository.calls.findSingleExecution.push({ id, opts });
			return executionRepository.executions.get(String(id));
		},
		updateExistingExecution: async (id, patch) => {
			executionRepository.calls.updateExistingExecution.push({ id, patch });
			const existing = executionRepository.executions.get(String(id));
			if (existing) {
				Object.assign(existing, patch);
			}
			return true;
		},
	};

	const ownershipService = {
		projects: new Map([['abcd', { id: 'projectId' }], ['parent_workflow_id', { id: 'projectId' }]]),
		getWorkflowProjectCached: async (workflowId) => {
			return ownershipService.projects.get(workflowId) ?? { id: 'default-project' };
		},
	};

	const activeExecutions = {
		promises: new Map(),
		getPostExecutePromise: (id) => {
			if (!activeExecutions.promises.has(String(id))) {
				activeExecutions.promises.set(String(id), createDeferredPromise());
			}
			return activeExecutions.promises.get(String(id)).promise;
		},
	};

	const runnerCalls = [];
	const workflowRunner = {
		runnerCalls,
		run: async (data, destinationNode, restartExecution, executionId) => {
			runnerCalls.push({ data, destinationNode, restartExecution, executionId });
		},
	};

	const instanceSettings = { isLeader };
	const logger = createMockLogger();

	const waitTracker = new WaitTracker({
		logger,
		executionRepository,
		ownershipService,
		activeExecutions,
		workflowRunner,
		instanceSettings,
		setTimeoutFn,
		clearTimeoutFn,
		setIntervalFn,
		clearIntervalFn,
		nowFn: () => currentTime,
	});

	return {
		waitTracker,
		logger,
		executionRepository,
		ownershipService,
		activeExecutions,
		workflowRunner,
		instanceSettings,
		advanceTime,
		getTime: () => currentTime,
	};
}

test('init() queries DB for waiting executions if leader', async () => {
	const h = createMockHarness({ isLeader: true });
	h.executionRepository.waitingExecutionsList.push({
		id: '123',
		waitTill: new Date(h.getTime() + 1000),
	});

	h.waitTracker.init();
	assert.equal(h.executionRepository.calls.getWaitingExecutions, 1);
	await h.waitTracker.getWaitingExecutions();
	assert.equal(h.waitTracker.has('123'), true);
	h.waitTracker.stopTracking();
});

test('init() does nothing if follower', async () => {
	const h = createMockHarness({ isLeader: false });
	h.executionRepository.waitingExecutionsList.push({
		id: '123',
		waitTill: new Date(h.getTime() + 1000),
	});

	h.waitTracker.init();
	assert.equal(h.executionRepository.calls.getWaitingExecutions, 0);
	assert.equal(h.waitTracker.has('123'), false);
});

test('init() does not schedule when no waiting executions found', async () => {
	const h = createMockHarness({ isLeader: true });
	h.waitTracker.init();
	assert.equal(h.executionRepository.calls.getWaitingExecutions, 1);
	assert.equal(h.waitTracker.waitingExecutionsCount, 0);
	h.waitTracker.stopTracking();
});

test('timed execution starts only after sufficient time advances', async () => {
	const h = createMockHarness({ isLeader: true });
	const execution = {
		id: '123',
		finished: false,
		waitTill: new Date(h.getTime() + 1000),
		mode: 'manual',
		workflowData: { id: 'abcd' },
		data: { pushRef: 'push_ref', parentExecution: undefined },
		startedAt: undefined,
	};
	h.executionRepository.executions.set('123', execution);
	h.executionRepository.waitingExecutionsList.push({ id: '123', waitTill: execution.waitTill });

	h.waitTracker.init();
	await h.waitTracker.getWaitingExecutions();
	assert.equal(h.waitTracker.has('123'), true);

	// Advance only 500ms: not yet triggered
	await h.advanceTime(500);
	assert.equal(h.workflowRunner.runnerCalls.length, 0);
	assert.equal(h.waitTracker.has('123'), true);

	// Advance another 600ms (total 1100ms): triggers
	await h.advanceTime(600);
	assert.equal(h.workflowRunner.runnerCalls.length, 1);
	assert.equal(h.workflowRunner.runnerCalls[0].executionId, '123');
	assert.equal(h.waitTracker.has('123'), false);

	h.waitTracker.stopTracking();
});

test('startExecution() dispatches full execution payload to workflowRunner', async () => {
	const h = createMockHarness();
	const startedAt = new Date('2026-09-18T12:00:00Z');
	const execution = {
		id: '123',
		finished: false,
		mode: 'manual',
		workflowData: { id: 'abcd' },
		data: { pushRef: 'push_ref', parentExecution: undefined },
		startedAt,
	};
	h.executionRepository.executions.set('123', execution);

	await h.waitTracker.startExecution('123');

	assert.equal(h.executionRepository.calls.findSingleExecution.length, 1);
	assert.deepEqual(h.executionRepository.calls.findSingleExecution[0], {
		id: '123',
		opts: { includeData: true, unflattenData: true },
	});

	assert.equal(h.workflowRunner.runnerCalls.length, 1);
	const call = h.workflowRunner.runnerCalls[0];
	assert.equal(call.executionId, '123');
	assert.equal(call.destinationNode, false);
	assert.equal(call.restartExecution, false);
	assert.equal(call.data.executionMode, 'manual');
	assert.equal(call.data.projectId, 'projectId');
	assert.equal(call.data.pushRef, 'push_ref');
	assert.equal(call.data.startedAt, startedAt);
	assert.deepEqual(call.data.workflowData, { id: 'abcd' });
});

test('startExecution() throws UnexpectedError when execution does not exist', async () => {
	const h = createMockHarness();
	await assert.rejects(
		() => h.waitTracker.startExecution('non-existent'),
		(err) => err instanceof UnexpectedError && err.message === 'Execution does not exist.',
	);
});

test('startExecution() throws UnexpectedError when execution is finished', async () => {
	const h = createMockHarness();
	h.executionRepository.executions.set('finished-id', {
		id: 'finished-id',
		finished: true,
		workflowData: { id: 'abcd' },
		data: {},
	});

	await assert.rejects(
		() => h.waitTracker.startExecution('finished-id'),
		(err) => err instanceof UnexpectedError && err.message.includes('The execution did succeed'),
	);
});

test('startExecution() throws UnexpectedError when workflowData.id is missing', async () => {
	const h = createMockHarness();
	h.executionRepository.executions.set('unsaved-id', {
		id: 'unsaved-id',
		finished: false,
		workflowData: {},
		data: {},
	});

	await assert.rejects(
		() => h.waitTracker.startExecution('unsaved-id'),
		(err) => err instanceof UnexpectedError && err.message === 'Only saved workflows can be resumed.',
	);
});

test('startExecution() suppresses ExecutionAlreadyResumingError gracefully', async () => {
	const h = createMockHarness();
	const execution = {
		id: '123',
		finished: false,
		mode: 'manual',
		workflowData: { id: 'abcd' },
		data: {},
	};
	h.executionRepository.executions.set('123', execution);

	h.workflowRunner.run = async () => {
		throw new ExecutionAlreadyResumingError('123');
	};

	// Should not throw
	await h.waitTracker.startExecution('123');
	assert.ok(h.logger.logs.some((l) => l.args[0].includes('already being resumed')));
});

test('startExecution() rethrows unexpected errors', async () => {
	const h = createMockHarness();
	const execution = {
		id: '123',
		finished: false,
		mode: 'manual',
		workflowData: { id: 'abcd' },
		data: {},
	};
	h.executionRepository.executions.set('123', execution);

	h.workflowRunner.run = async () => {
		throw new Error('Database connection failed');
	};

	await assert.rejects(
		() => h.waitTracker.startExecution('123'),
		/Database connection failed/,
	);
});

test('resumes parent execution when sub-workflow finishes by default', async () => {
	const h = createMockHarness();
	const parentExecution = {
		id: 'parent_execution_id',
		finished: false,
		status: 'waiting',
		mode: 'manual',
		workflowData: { id: 'parent_workflow_id' },
		data: {
			pushRef: 'parent_push',
			executionData: {
				nodeExecutionStack: [
					{ node: { name: 'Execute Sub Workflow' }, data: { main: [[{ json: { old: true } }]] } },
				],
			},
		},
	};
	const childExecution = {
		id: 'child_execution_id',
		finished: false,
		mode: 'manual',
		workflowData: { id: 'abcd' },
		data: {
			parentExecution: {
				executionId: parentExecution.id,
				workflowId: parentExecution.workflowData.id,
				// shouldResume undefined -> defaults to true
			},
		},
	};

	h.executionRepository.executions.set(childExecution.id, childExecution);
	h.executionRepository.executions.set(parentExecution.id, parentExecution);

	const childResultData = {
		status: 'success',
		mode: 'manual',
		data: createRunExecutionData({
			resultData: {
				lastNodeExecuted: 'Final Node',
				runData: {
					'Final Node': [
						{
							startTime: 100,
							executionIndex: 0,
							executionTime: 5,
							data: {
								main: [[{ json: { output: 'from child' }, pairedItem: { item: 0 } }]],
							},
						},
					],
				},
			},
		}),
	};

	// Start child execution
	await h.waitTracker.startExecution(childExecution.id);
	assert.equal(h.workflowRunner.runnerCalls.length, 1);
	assert.equal(h.workflowRunner.runnerCalls[0].executionId, childExecution.id);

	// Child completes
	const deferred = h.activeExecutions.promises.get(childExecution.id);
	deferred.resolve(childResultData);
	await new Promise((resolve) => setImmediate(resolve));
	await new Promise((resolve) => setImmediate(resolve));

	// Parent was resumed!
	assert.equal(h.workflowRunner.runnerCalls.length, 2);
	assert.equal(h.workflowRunner.runnerCalls[1].executionId, parentExecution.id);

	// Parent's stack was updated with child results
	assert.equal(h.executionRepository.calls.updateExistingExecution.length, 1);
	const updateCall = h.executionRepository.calls.updateExistingExecution[0];
	assert.equal(updateCall.id, parentExecution.id);
	assert.deepEqual(
		updateCall.patch.data.executionData.nodeExecutionStack[0].data.main,
		[[{ json: { output: 'from child' }, pairedItem: { item: 0 } }]],
	);
});

test('does not resume parent execution when shouldResume is false', async () => {
	const h = createMockHarness();
	const parentExecution = {
		id: 'parent_execution_id',
		finished: false,
		status: 'waiting',
		mode: 'manual',
		workflowData: { id: 'parent_workflow_id' },
		data: {},
	};
	const childExecution = {
		id: 'child_execution_id',
		finished: false,
		mode: 'manual',
		workflowData: { id: 'abcd' },
		data: {
			parentExecution: {
				executionId: parentExecution.id,
				workflowId: parentExecution.workflowData.id,
				shouldResume: false,
			},
		},
	};

	h.executionRepository.executions.set(childExecution.id, childExecution);
	h.executionRepository.executions.set(parentExecution.id, parentExecution);

	await h.waitTracker.startExecution(childExecution.id);
	assert.equal(h.workflowRunner.runnerCalls.length, 1);

	// Resolve child
	const deferred = h.activeExecutions.promises.get(childExecution.id);
	if (deferred) deferred.resolve({ status: 'success', data: createRunExecutionData() });
	await new Promise((resolve) => setImmediate(resolve));

	// Parent is NOT resumed
	assert.equal(h.workflowRunner.runnerCalls.length, 1);
});

test('does not resume parent execution when child execution status is waiting', async () => {
	const h = createMockHarness();
	const parentExecution = {
		id: 'parent_execution_id',
		finished: false,
		status: 'waiting',
		mode: 'manual',
		workflowData: { id: 'parent_workflow_id' },
		data: {},
	};
	const childExecution = {
		id: 'child_execution_id',
		finished: false,
		mode: 'manual',
		workflowData: { id: 'abcd' },
		data: {
			parentExecution: {
				executionId: parentExecution.id,
				workflowId: parentExecution.workflowData.id,
				shouldResume: true,
			},
		},
	};

	h.executionRepository.executions.set(childExecution.id, childExecution);
	h.executionRepository.executions.set(parentExecution.id, parentExecution);

	await h.waitTracker.startExecution(childExecution.id);

	// Child transitions into waiting state
	const deferred = h.activeExecutions.promises.get(childExecution.id);
	deferred.resolve({ status: 'waiting', data: createRunExecutionData() });
	await new Promise((resolve) => setImmediate(resolve));

	// Parent is NOT resumed
	assert.equal(h.workflowRunner.runnerCalls.length, 1);
	assert.equal(h.executionRepository.calls.updateExistingExecution.length, 0);
});

test('stopExecution() clears single timer and removes from tracking map', async () => {
	const h = createMockHarness();
	h.executionRepository.waitingExecutionsList.push({
		id: '123',
		waitTill: new Date(h.getTime() + 1000),
	});

	h.waitTracker.init();
	await h.waitTracker.getWaitingExecutions();
	assert.equal(h.waitTracker.has('123'), true);

	h.waitTracker.stopExecution('123');
	assert.equal(h.waitTracker.has('123'), false);

	await h.advanceTime(2000);
	assert.equal(h.workflowRunner.runnerCalls.length, 0);

	h.waitTracker.stopTracking();
});

test('stopTracking() clears interval and all scheduled execution timers', async () => {
	const h = createMockHarness();
	h.executionRepository.waitingExecutionsList.push(
		{ id: '101', waitTill: new Date(h.getTime() + 1000) },
		{ id: '102', waitTill: new Date(h.getTime() + 2000) },
	);

	h.waitTracker.init();
	await h.waitTracker.getWaitingExecutions();
	assert.equal(h.waitTracker.waitingExecutionsCount, 2);
	assert.ok(h.waitTracker.mainTimer !== null);

	h.waitTracker.stopTracking();
	assert.equal(h.waitTracker.waitingExecutionsCount, 0);
	assert.equal(h.waitTracker.mainTimer, null);

	await h.advanceTime(5000);
	assert.equal(h.workflowRunner.runnerCalls.length, 0);
});

test('helper: shouldRestartParentExecution handles edge cases', () => {
	assert.equal(shouldRestartParentExecution(undefined), false);
	assert.equal(shouldRestartParentExecution(null), false);
	assert.equal(shouldRestartParentExecution({}), true);
	assert.equal(shouldRestartParentExecution({ shouldResume: undefined }), true);
	assert.equal(shouldRestartParentExecution({ shouldResume: false }), false);
	assert.equal(shouldRestartParentExecution({ shouldResume: true }), true);
});

test('helper: getDataLastExecutedNodeData handles pinData in manual mode', () => {
	const inputData = {
		mode: 'manual',
		data: {
			resultData: {
				lastNodeExecuted: 'NodeA',
				pinData: {
					NodeA: [{ item: 'pinned' }],
				},
				runData: {
					NodeA: [{ data: { main: [[{ json: { item: 'run' } }]] } }],
				},
			},
		},
	};

	const nodeData = getDataLastExecutedNodeData(inputData);
	assert.deepEqual(nodeData.data.main[0], [{ json: { item: 'pinned' }, pairedItem: { item: 0 } }]);
});

test('helper: updateParentExecutionWithChildResults skips non-waiting parent', async () => {
	let updated = false;
	const repo = {
		findSingleExecution: async () => ({ status: 'running', data: {} }),
		updateExistingExecution: async () => { updated = true; },
	};
	const childRun = {
		mode: 'manual',
		data: {
			resultData: {
				lastNodeExecuted: 'N',
				runData: { N: [{ data: { main: [[{ json: { v: 1 } }]] } }] },
			},
		},
	};

	await updateParentExecutionWithChildResults(repo, 'parent-1', childRun);
	assert.equal(updated, false);
});
