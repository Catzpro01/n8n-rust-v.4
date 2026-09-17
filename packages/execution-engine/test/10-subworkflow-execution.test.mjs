import test from 'node:test';
import assert from 'node:assert/strict';

import {
	ActiveExecutions,
	STARTING_NODES,
	SubworkflowOperationError,
	UnexpectedError,
	executeWorkflow,
	findSubworkflowStart,
	getBase,
	getRunData,
} from '../src/index.mjs';

function createMockActiveExecutions() {
	const activeMap = new Map();
	const executions = [];
	return {
		activeExecutions: activeMap,
		executions,
		async add(data) {
			const id = `sub-exec-${executions.length + 1}`;
			executions.push({ id, data });
			activeMap.set(id, { id, data, status: 'running' });
			return id;
		},
		attachWorkflowExecution(id, execution) {
			const entry = activeMap.get(id);
			if (entry) entry.workflowExecution = execution;
		},
		finalizeExecution(id, runData) {
			const entry = activeMap.get(id);
			if (entry) {
				entry.runData = runData;
				entry.finalized = true;
			}
		},
	};
}

test('findSubworkflowStart: prefers executeWorkflowTrigger over manualTrigger and start', () => {
	const nodes = [
		{ name: 'Start', type: 'n8n-nodes-base.start' },
		{ name: 'Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger' },
		{ name: 'Manual', type: 'n8n-nodes-base.manualTrigger' },
	];

	const start = findSubworkflowStart(nodes);
	assert.equal(start.name, 'Trigger');
	assert.equal(start.type, 'n8n-nodes-base.executeWorkflowTrigger');
});

test('findSubworkflowStart: falls back to STARTING_NODES when executeWorkflowTrigger absent', () => {
	const nodes = [
		{ name: 'ManualChat', type: '@n8n/n8n-nodes-langchain.manualChatTrigger' },
		{ name: 'Process', type: 'n8n-nodes-base.set' },
	];

	const start = findSubworkflowStart(nodes);
	assert.equal(start.name, 'ManualChat');
});

test('findSubworkflowStart: throws SubworkflowOperationError when no start node present', () => {
	const nodes = [
		{ name: 'Node1', type: 'n8n-nodes-base.set' },
		{ name: 'Node2', type: 'n8n-nodes-base.httpRequest' },
	];

	assert.throws(
		() => findSubworkflowStart(nodes),
		(err) => err instanceof SubworkflowOperationError && /Missing node/.test(err.message),
	);
});

test('getRunData: creates integrated execution payload with inputData mapped to main[0]', () => {
	const workflowData = {
		id: 'wf-sub-1',
		name: 'Sub Wf',
		nodes: [
			{ name: 'Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger' },
			{ name: 'End', type: 'n8n-nodes-base.set' },
		],
	};

	const input = [{ json: { greeting: 'hello' } }, { json: { greeting: 'world' } }];
	const parentExec = { executionId: 'parent-123' };

	const runData = getRunData(workflowData, input, parentExec);

	assert.equal(runData.executionMode, 'integrated');
	assert.equal(runData.workflowData.id, 'wf-sub-1');

	const stack = runData.executionData.executionData.nodeExecutionStack;
	assert.equal(stack.length, 1);
	assert.equal(stack[0].node.name, 'Trigger');
	assert.deepEqual(stack[0].data.main[0], input);
	assert.deepEqual(stack[0].metadata.parentExecution, parentExec);
});

test('getRunData: defaults inputData to empty json item when undefined', () => {
	const workflowData = {
		id: 'wf-sub-2',
		name: 'Sub Wf 2',
		nodes: [{ name: 'Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger' }],
	};

	const runData = getRunData(workflowData);
	const stack = runData.executionData.executionData.nodeExecutionStack;
	assert.deepEqual(stack[0].data.main[0], [{ json: {} }]);
});

test('getBase: returns baseline execution context fields', () => {
	const base = getBase({
		userId: 'user-99',
		workflowId: 'wf-ctx-1',
		executionTimeoutTimestamp: 1700000000,
		workflowSettings: { timezone: 'Europe/Berlin' },
	});

	assert.equal(base.userId, 'user-99');
	assert.equal(base.workflowId, 'wf-ctx-1');
	assert.equal(base.executionTimeoutTimestamp, 1700000000);
	assert.equal(base.timezone, 'Europe/Berlin');
});

test('executeWorkflow: throws when neither id nor code is provided', async () => {
	const activeExec = createMockActiveExecutions();
	await assert.rejects(
		() => executeWorkflow({}, {}, {}, { activeExecutions: activeExec }),
		(err) => err instanceof UnexpectedError && /No information about the workflow/.test(err.message),
	);
});

test('executeWorkflow: executes subworkflow with code and returns last node output', async () => {
	const activeExec = createMockActiveExecutions();
	let setRunningCalled = false;
	const repo = {
		setRunning: async () => { setRunningCalled = true; },
		updateExistingExecution: async () => {},
	};

	const subworkflowCode = {
		id: 'sub-code-wf',
		name: 'Code Subworkflow',
		nodes: [
			{ name: 'Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger' },
			{ name: 'Result', type: 'n8n-nodes-base.set' },
		],
		connections: {},
	};

	const mockExecutionResult = {
		finished: true,
		status: 'success',
		mode: 'integrated',
		data: {
			resultData: {
				lastNodeExecuted: 'Result',
				runData: {
					Result: [
						{
							data: {
								main: [[{ json: { calculated: 42 } }]],
							},
						},
					],
				},
			},
		},
	};

	const result = await executeWorkflow(
		{ code: subworkflowCode },
		{ userId: 'u-1' },
		{ inputData: [{ json: { num: 10 } }] },
		{
			activeExecutions: activeExec,
			executionRepository: repo,
			workflowExecuteFactory: () => ({
				processRunExecutionData: () => Promise.resolve(mockExecutionResult),
			}),
		},
	);

	assert.equal(result.executionId, 'sub-exec-1');
	assert.deepEqual(result.data, [[{ json: { calculated: 42 } }]]);
	assert.equal(setRunningCalled, true);
});

test('executeWorkflow: fetches workflow by id from workflowRepository', async () => {
	const activeExec = createMockActiveExecutions();
	const repo = {
		setRunning: async () => {},
		updateExistingExecution: async () => {},
	};
	const wfRepo = {
		get: async ({ id }) => ({
			id,
			name: 'Repo Subworkflow',
			nodes: [{ name: 'Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger' }],
			connections: {},
		}),
	};

	const mockExecutionResult = {
		finished: true,
		status: 'success',
		mode: 'integrated',
		data: {
			resultData: {
				lastNodeExecuted: 'Trigger',
				runData: {
					Trigger: [{ data: { main: [[{ json: { ok: true } }]] } }],
				},
			},
		},
	};

	const result = await executeWorkflow(
		{ id: 'wf-from-repo' },
		{},
		{},
		{
			activeExecutions: activeExec,
			executionRepository: repo,
			workflowRepository: wfRepo,
			workflowExecuteFactory: () => ({
				processRunExecutionData: () => Promise.resolve(mockExecutionResult),
			}),
		},
	);

	assert.equal(result.executionId, 'sub-exec-1');
	assert.deepEqual(result.data, [[{ json: { ok: true } }]]);
});

test('executeWorkflow: doNotWaitToFinish returns executionId and [null] data immediately', async () => {
	const activeExec = createMockActiveExecutions();
	let subExecutionFinished = false;

	const subworkflowCode = {
		name: 'Fire And Forget',
		nodes: [{ name: 'Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger' }],
	};

	const result = await executeWorkflow(
		{ code: subworkflowCode },
		{},
		{ doNotWaitToFinish: true },
		{
			activeExecutions: activeExec,
			executionRepository: { setRunning: async () => {} },
			workflowExecuteFactory: () => ({
				processRunExecutionData: () =>
					new Promise((resolve) => {
						setTimeout(() => {
							subExecutionFinished = true;
							resolve({ finished: true, status: 'success', data: { resultData: {} } });
						}, 50);
					}),
			}),
		},
	);

	assert.equal(result.executionId, 'sub-exec-1');
	assert.deepEqual(result.data, [null]);
	assert.equal(subExecutionFinished, false, 'must return before sub-execution resolves');
});

test('executeWorkflow: handles subworkflow entering waiting state and returns waitTill', async () => {
	const activeExec = createMockActiveExecutions();
	const waitTillDate = new Date(Date.now() + 60000);

	const subworkflowCode = {
		name: 'Waiting Subworkflow',
		nodes: [{ name: 'Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger' }],
	};

	const mockWaitingResult = {
		finished: false,
		status: 'waiting',
		waitTill: waitTillDate,
		data: {
			resultData: {
				lastNodeExecuted: 'Trigger',
				runData: {
					Trigger: [{ data: { main: [[{ json: { inWait: true } }]] } }],
				},
			},
		},
	};

	const result = await executeWorkflow(
		{ code: subworkflowCode },
		{},
		{},
		{
			activeExecutions: activeExec,
			executionRepository: { setRunning: async () => {} },
			workflowExecuteFactory: () => ({
				processRunExecutionData: () => Promise.resolve(mockWaitingResult),
			}),
		},
	);

	assert.equal(result.executionId, 'sub-exec-1');
	assert.deepEqual(result.waitTill, waitTillDate);
	assert.deepEqual(result.data, [[{ json: { inWait: true } }]]);
});

test('executeWorkflow: catches execution failure, records to DB, and throws error', async () => {
	const activeExec = createMockActiveExecutions();
	let updatedDbExecution = null;
	const repo = {
		setRunning: async () => {},
		updateExistingExecution: async (id, data) => {
			updatedDbExecution = { id, data };
		},
	};

	const subworkflowCode = {
		id: 'wf-fail',
		name: 'Failing Subworkflow',
		nodes: [{ name: 'Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger' }],
	};

	const failureError = new Error('Sub-node exploded');

	await assert.rejects(
		() =>
			executeWorkflow(
				{ code: subworkflowCode },
				{},
				{},
				{
					activeExecutions: activeExec,
					executionRepository: repo,
					workflowExecuteFactory: () => ({
						processRunExecutionData: () => Promise.reject(failureError),
					}),
				},
			),
		/Sub-node exploded/,
	);

	assert.ok(updatedDbExecution, 'execution must be saved to DB as error');
	assert.equal(updatedDbExecution.data.status, 'error');
	assert.equal(updatedDbExecution.data.finished, false);
});
