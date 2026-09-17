import test from 'node:test';
import assert from 'node:assert/strict';

import {
	ARTIFICIAL_TASK_DATA,
	ExecutionRecoveryService,
	NodeCrashedError,
	NodeOperationError,
	OperationalError,
	WorkflowCrashedError,
} from '../src/index.mjs';

function createMockLogger() {
	return {
		debug: () => {},
		info: () => {},
		warn: () => {},
		error: () => {},
	};
}

const SAMPLE_WORKFLOW = {
	id: 'wf-100',
	name: 'Crash Recovery Workflow',
	active: true,
	activeVersionId: 'v1',
	nodes: [
		{
			id: 'node-1',
			name: 'Manual Trigger',
			type: 'n8n-nodes-base.manualTrigger',
			typeVersion: 1,
			position: [100, 100],
		},
		{
			id: 'node-2',
			name: 'Heavy Compute',
			type: 'n8n-nodes-base.function',
			typeVersion: 1,
			position: [300, 100],
		},
	],
	connections: {
		'Manual Trigger': {
			main: [[{ node: 'Heavy Compute', type: 'main', index: 0 }]],
		},
	},
};

const IN_PROGRESS_DATA = {
	startData: {},
	resultData: {
		runData: {
			'Manual Trigger': [
				{
					startTime: 1000,
					executionTime: 10,
					source: [],
					executionStatus: 'success',
					data: {
						main: [[{ json: { test: true }, pairedItem: { item: 0 } }]],
					},
				},
			],
		},
		lastNodeExecuted: 'Manual Trigger',
	},
};

test('13.1 NodeCrashedError and WorkflowCrashedError hierarchy and properties', () => {
	const node = { id: 'n1', name: 'TestNode', type: 'test' };
	const nodeErr = new NodeCrashedError(node);
	assert.ok(nodeErr instanceof NodeOperationError);
	assert.equal(nodeErr.name, 'NodeCrashedError');
	assert.equal(nodeErr.node, node);
	assert.equal(nodeErr.message, 'Execution stopped at this node');
	assert.match(nodeErr.description, /out of memory/);

	const wfErr = new WorkflowCrashedError();
	assert.ok(wfErr instanceof OperationalError);
	assert.equal(wfErr.name, 'WorkflowCrashedError');
	assert.match(wfErr.message, /Workflow did not finish/);

	assert.ok(Object.isFrozen(ARTIFICIAL_TASK_DATA));
	assert.equal(ARTIFICIAL_TASK_DATA.main[0][0].json.isArtificialRecoveredEventItem, true);
});

test('13.2 ExecutionRecoveryService: does nothing if follower instance', async () => {
	let amendCalled = false;
	const service = new ExecutionRecoveryService(createMockLogger(), {
		instanceSettings: { isFollower: true },
		executionRepository: {
			async findSingleExecution() {
				amendCalled = true;
				return null;
			},
		},
	});

	const result = await service.recoverFromLogs('exec-1', [
		{ eventName: 'n8n.workflow.started', payload: { executionId: 'exec-1' } },
	]);
	assert.equal(result, null);
	assert.equal(amendCalled, false);
});

test('13.3 ExecutionRecoveryService: amend without logs (messages = [])', async () => {
	const db = new Map();
	const execution = {
		id: 'exec-123',
		status: 'running',
		workflowData: SAMPLE_WORKFLOW,
		data: IN_PROGRESS_DATA,
		stoppedAt: undefined,
	};
	db.set('exec-123', execution);

	const service = new ExecutionRecoveryService(createMockLogger(), {
		instanceSettings: { isFollower: false },
		executionRepository: {
			async exists({ where }) {
				return db.has(where.id);
			},
			async markAsCrashed(id) {
				const item = db.get(id);
				if (item) {
					item.status = 'crashed';
					item.stoppedAt = new Date();
				}
			},
			async findSingleExecution(id) {
				return db.get(id) ?? null;
			},
			async updateExistingExecution(id, data) {
				db.set(id, { ...db.get(id), ...data });
			},
		},
	});

	// Inexistent execution
	const inexistent = await service.recoverFromLogs('unknown-id', []);
	assert.equal(inexistent, null);

	// Existing execution
	const amended = await service.recoverFromLogs('exec-123', []);
	assert.ok(amended);
	assert.equal(amended.status, 'crashed');
	assert.ok(amended.stoppedAt instanceof Date);
});

test('13.4 ExecutionRecoveryService: returns null for finished dataful executions', async () => {
	const completedExecutions = [
		{ id: 'e1', status: 'success', data: { resultData: { runData: { a: 1 } } } },
		{ id: 'e2', status: 'error', data: { resultData: { runData: { a: 1 } } } },
		{ id: 'e3', status: 'canceled', data: { resultData: { runData: {} } } },
	];

	for (const exec of completedExecutions) {
		const service = new ExecutionRecoveryService(createMockLogger(), {
			instanceSettings: { isFollower: false },
			executionRepository: {
				async findSingleExecution() {
					return exec;
				},
			},
		});

		const messages = [
			{ eventName: 'n8n.workflow.started', payload: { executionId: exec.id } },
			{
				eventName: 'n8n.node.started',
				payload: { executionId: exec.id, nodeName: 'Manual Trigger' },
			},
		];
		const res = await service.recoverFromLogs(exec.id, messages);
		assert.equal(res, null, `Should return null for status ${exec.status}`);
	}
});

test('13.5 ExecutionRecoveryService: recovers dataless success execution', async () => {
	const execution = {
		id: 'dataless-exec',
		status: 'success',
		data: undefined,
		workflowData: SAMPLE_WORKFLOW,
	};

	let updated = null;
	const service = new ExecutionRecoveryService(createMockLogger(), {
		instanceSettings: { isFollower: false },
		executionRepository: {
			async findSingleExecution() {
				return execution;
			},
			async updateExistingExecution(id, item) {
				updated = item;
			},
		},
	});

	const messages = [
		{ eventName: 'n8n.workflow.started', ts: new Date(1700000000000) },
		{
			eventName: 'n8n.node.started',
			payload: { nodeName: 'Manual Trigger' },
			ts: new Date(1700000001000),
		},
		{
			eventName: 'n8n.node.finished',
			payload: { nodeName: 'Manual Trigger' },
			ts: new Date(1700000002000),
		},
	];

	const res = await service.recoverFromLogs('dataless-exec', messages);
	assert.ok(res);
	assert.equal(res.status, 'crashed');
	assert.deepEqual(res.data.resultData.runData['Manual Trigger'][0].data, ARTIFICIAL_TASK_DATA);
	assert.equal(updated.status, 'crashed');
});

test('13.6 ExecutionRecoveryService: recovers in-progress execution when last node crashed', async () => {
	const execution = {
		id: 'exec-running-crashed',
		status: 'running',
		data: JSON.parse(JSON.stringify(IN_PROGRESS_DATA)),
		workflowData: SAMPLE_WORKFLOW,
	};

	let hookCalled = false;
	const pushBroadcasts = [];
	let pushPromise = null;

	const service = new ExecutionRecoveryService(createMockLogger(), {
		instanceSettings: { isFollower: false },
		executionRepository: {
			async findSingleExecution() {
				return execution;
			},
			async updateExistingExecution() {},
		},
		push: {
			once(evt, fn) {
				pushPromise = fn();
			},
			broadcast(data) {
				pushBroadcasts.push(data);
			},
		},
		sleep: async () => {},
		lifecycleHooksFactory() {
			return {
				async runHook(name, args) {
					if (name === 'workflowExecuteAfter') {
						hookCalled = true;
					}
				},
			};
		},
	});

	const startNode2Ts = new Date(1700000050000);
	const messages = [
		{
			eventName: 'n8n.workflow.started',
			payload: { executionId: 'exec-running-crashed' },
			ts: new Date(1700000000000),
		},
		{
			eventName: 'n8n.node.started',
			payload: { nodeName: 'Manual Trigger' },
			ts: new Date(1700000001000),
		},
		{
			eventName: 'n8n.node.finished',
			payload: { nodeName: 'Manual Trigger' },
			ts: new Date(1700000002000),
		},
		{
			eventName: 'n8n.node.started',
			payload: { nodeName: 'Heavy Compute' },
			ts: startNode2Ts,
		},
		// Heavy Compute never finished!
	];

	const amended = await service.recoverFromLogs('exec-running-crashed', messages);
	await pushPromise;
	assert.ok(amended);
	assert.equal(amended.status, 'crashed');
	assert.equal(amended.stoppedAt.getTime(), startNode2Ts.getTime());

	const resultData = amended.data.resultData;
	assert.equal(resultData.lastNodeExecuted, 'Heavy Compute');
	assert.ok(resultData.error instanceof WorkflowCrashedError);

	const node1Data = resultData.runData['Manual Trigger'][0];
	assert.equal(node1Data.executionStatus, 'success');
	assert.equal(node1Data.error, undefined);
	assert.deepEqual(node1Data.data.main[0][0].json, { test: true }); // preserved

	const node2Data = resultData.runData['Heavy Compute'][0];
	assert.equal(node2Data.executionStatus, 'crashed');
	assert.ok(node2Data.error instanceof NodeCrashedError);
	assert.equal(node2Data.executionTime, 0);

	assert.equal(hookCalled, true);
	assert.deepEqual(pushBroadcasts, [
		{ type: 'executionRecovered', data: { executionId: 'exec-running-crashed' } },
	]);
});

test('13.7 ExecutionRecoveryService: recovers in-progress execution when last node finished', async () => {
	const execution = {
		id: 'exec-running-finished',
		status: 'running',
		data: JSON.parse(JSON.stringify(IN_PROGRESS_DATA)),
		workflowData: SAMPLE_WORKFLOW,
	};

	const service = new ExecutionRecoveryService(createMockLogger(), {
		instanceSettings: { isFollower: false },
		executionRepository: {
			async findSingleExecution() {
				return execution;
			},
			async updateExistingExecution() {},
		},
	});

	const startNode2Ts = new Date(1700000050000);
	const endNode2Ts = new Date(1700000052500);
	const messages = [
		{
			eventName: 'n8n.workflow.started',
			payload: { executionId: 'exec-running-finished' },
			ts: new Date(1700000000000),
		},
		{
			eventName: 'n8n.node.started',
			payload: { nodeName: 'Manual Trigger' },
			ts: new Date(1700000001000),
		},
		{
			eventName: 'n8n.node.finished',
			payload: { nodeName: 'Manual Trigger' },
			ts: new Date(1700000002000),
		},
		{
			eventName: 'n8n.node.started',
			payload: { nodeName: 'Heavy Compute' },
			ts: startNode2Ts,
		},
		{
			eventName: 'n8n.node.finished',
			payload: { nodeName: 'Heavy Compute' },
			ts: endNode2Ts,
		},
	];

	const amended = await service.recoverFromLogs('exec-running-finished', messages);
	assert.ok(amended);
	assert.equal(amended.status, 'crashed');
	assert.equal(amended.stoppedAt.getTime(), endNode2Ts.getTime());

	const resultData = amended.data.resultData;
	assert.equal(resultData.lastNodeExecuted, 'Heavy Compute');
	assert.equal(resultData.error, undefined);

	const node2Data = resultData.runData['Heavy Compute'][0];
	assert.equal(node2Data.executionStatus, 'success');
	assert.equal(node2Data.error, undefined);
	assert.deepEqual(node2Data.data, ARTIFICIAL_TASK_DATA);
	assert.equal(node2Data.executionTime, 2500);
});

test('13.8 ExecutionRecoveryService: autoDeactivateWorkflowsIfNeeded', async () => {
	let deactivatedWorkflowId = null;
	let mailedPayload = null;
	let updatedExecutions = null;
	const pushBroadcasts = [];
	let pushPromise = null;

	const workflow = {
		id: 'wf-failing',
		name: 'Crash prone workflow',
		active: true,
		activeVersionId: 'v12',
	};

	const service = new ExecutionRecoveryService(createMockLogger(), {
		executionsConfig: { recovery: { maxLastExecutions: 3 } },
		executionRepository: {
			async findMultipleExecutions() {
				return [{ status: 'crashed' }, { status: 'crashed' }, { status: 'crashed' }];
			},
			async update(criteria, updateData) {
				updatedExecutions = { criteria, updateData };
			},
		},
		workflowRepository: {
			async findOne({ where }) {
				if (where.id === 'wf-failing') return workflow;
				return null;
			},
			async updateActiveState(id, active) {
				deactivatedWorkflowId = id;
				workflow.active = active;
				workflow.activeVersionId = null;
			},
		},
		ownershipService: {
			async getWorkflowProjectCached() {
				return { id: 'team-proj', type: 'team' };
			},
			async getInstanceOwner() {
				return { id: 'owner-1', email: 'owner@n8n.io' };
			},
		},
		projectRelationRepository: {
			async find({ where }) {
				if (where.projectId === 'team-proj' && where.role?.slug === 'admin') {
					return [{ user: { id: 'admin-1', email: 'admin@n8n.io' } }];
				}
				return [];
			},
		},
		userManagementMailer: {
			async notifyWorkflowAutodeactivated(payload) {
				mailedPayload = payload;
			},
		},
		push: {
			once(evt, fn) {
				pushPromise = fn();
			},
			broadcast(data) {
				pushBroadcasts.push(data);
			},
		},
		sleep: async () => {},
	});

	await service.autoDeactivateWorkflowsIfNeeded(new Set(['wf-failing']));
	await pushPromise;

	assert.equal(deactivatedWorkflowId, 'wf-failing');
	assert.equal(workflow.active, false);
	assert.equal(mailedPayload?.recipient?.email, 'admin@n8n.io');
	assert.equal(mailedPayload?.workflow?.id, 'wf-failing');
	assert.equal(updatedExecutions?.updateData?.status, 'crashed');
	assert.deepEqual(pushBroadcasts, [
		{ type: 'workflowAutoDeactivated', data: { workflowId: 'wf-failing' } },
	]);
});

test('13.9 ExecutionRecoveryService: autoDeactivateWorkflowsIfNeeded does not deactivate when fewer crashed executions', async () => {
	let updateStateCalled = false;
	const service = new ExecutionRecoveryService(createMockLogger(), {
		executionsConfig: { recovery: { maxLastExecutions: 3 } },
		executionRepository: {
			async findMultipleExecutions() {
				// Only 2 crashed out of 3
				return [{ status: 'crashed' }, { status: 'success' }, { status: 'crashed' }];
			},
		},
		workflowRepository: {
			async updateActiveState() {
				updateStateCalled = true;
			},
		},
	});

	await service.autoDeactivateWorkflowsIfNeeded(['wf-ok']);
	assert.equal(updateStateCalled, false);
});

test('13.10 ExecutionRecoveryService: supports positional arguments and Luxon-like DateTime timestamps', async () => {
	const execution = {
		id: 'exec-luxon',
		status: 'running',
		workflowData: SAMPLE_WORKFLOW,
	};

	const mockExecRepo = {
		async findSingleExecution() {
			return execution;
		},
		async updateExistingExecution() {},
	};

	// Positional constructor: logger, instanceSettings, push, executionRepository, executionsConfig, workflowRepository, userManagementMailer, ownershipService, projectRelationRepository
	const service = new ExecutionRecoveryService(
		createMockLogger(),
		{ isFollower: false },
		{ once() {}, broadcast() {} },
		mockExecRepo,
		{ recovery: { maxLastExecutions: 5 } },
		{},
		{},
		{
			async getWorkflowProjectCached() {
				return { id: 'p1', type: 'personal' };
			},
			async getInstanceOwner() {
				return { id: 'fallback-owner', email: 'owner@personal.io' };
			},
		},
		{
			async find() {
				return []; // Empty relation -> triggers fallback to getInstanceOwner
			},
		},
	);

	const luxonStart = {
		toMillis: () => 1700000000000,
		toJSDate: () => new Date(1700000000000),
		toUnixInteger: () => 1700000000,
	};
	const luxonEnd = {
		toMillis: () => 1700000005000,
		toJSDate: () => new Date(1700000005000),
		toUnixInteger: () => 1700000005,
		diff: (other) => ({ toMillis: () => 5000 }),
	};

	const messages = [
		{ eventName: 'n8n.workflow.started', ts: luxonStart },
		{
			eventName: 'n8n.node.started',
			payload: { nodeName: 'Manual Trigger' },
			ts: luxonStart,
		},
		{
			eventName: 'n8n.node.finished',
			payload: { nodeName: 'Manual Trigger' },
			ts: luxonEnd,
		},
	];

	const res = await service.recoverFromLogs('exec-luxon', messages);
	assert.ok(res);
	assert.equal(res.status, 'crashed');
	assert.equal(res.stoppedAt.getTime(), 1700000005000);
	assert.equal(res.data.resultData.runData['Manual Trigger'][0].executionTime, 5000);

	// Test recipient fallback
	const recipient = await service.getAutodeactivationRecipient({ id: 'wf-personal' });
	assert.equal(recipient.email, 'owner@personal.io');
});

