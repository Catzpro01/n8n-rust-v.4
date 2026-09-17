import assert from 'node:assert/strict';
import test, { describe, it } from 'node:test';

import {
	DEFAULT_SAVE_CONFIG,
	FailedRunFactory,
	executeErrorWorkflow,
	generateFailedExecutionFromError,
	saveExecutionProgress,
	toSaveSettings,
} from '../src/index.mjs';

describe('toSaveSettings', () => {
	it('handles null workflow settings without throwing', () => {
		assert.doesNotThrow(() => toSaveSettings(null));
		const settings = toSaveSettings(null);
		assert.equal(settings.error, true);
		assert.equal(settings.success, true);
		assert.equal(settings.manual, true);
		assert.equal(settings.progress, false);
	});

	it('favors workflow settings over defaults for error execution', () => {
		const customConfig = { executions: { saveDataOnError: 'none' } };

		const saveSettings1 = toSaveSettings({ saveDataErrorExecution: 'all' }, customConfig);
		assert.equal(saveSettings1.error, true);

		const saveSettings2 = toSaveSettings({ saveDataErrorExecution: 'none' }, { executions: { saveDataOnError: 'all' } });
		assert.equal(saveSettings2.error, false);
	});

	it('falls back to default if no workflow setting or explicit DEFAULT', () => {
		const customConfig = { executions: { saveDataOnError: 'none' } };
		const settings1 = toSaveSettings({}, customConfig);
		assert.equal(settings1.error, false);

		const settings2 = toSaveSettings({ saveDataErrorExecution: 'DEFAULT' }, customConfig);
		assert.equal(settings2.error, false);
	});

	it('favors workflow settings for success execution', () => {
		const settings1 = toSaveSettings({ saveDataSuccessExecution: 'all' }, { executions: { saveDataOnSuccess: 'none' } });
		assert.equal(settings1.success, true);

		const settings2 = toSaveSettings({ saveDataSuccessExecution: 'none' }, { executions: { saveDataOnSuccess: 'all' } });
		assert.equal(settings2.success, false);
	});

	it('resolves manual execution and progress settings with boolean conversion', () => {
		const settings1 = toSaveSettings({ saveManualExecutions: true, saveExecutionProgress: true });
		assert.equal(settings1.manual, true);
		assert.equal(settings1.progress, true);

		const settings2 = toSaveSettings({ saveManualExecutions: false, saveExecutionProgress: false });
		assert.equal(settings2.manual, false);
		assert.equal(settings2.progress, false);

		const settings3 = toSaveSettings(
			{ saveManualExecutions: 'DEFAULT', saveExecutionProgress: 'DEFAULT' },
			{ executions: { saveDataManualExecutions: false, saveExecutionProgress: true } },
		);
		assert.equal(settings3.manual, false);
		assert.equal(settings3.progress, true);
	});
});

describe('FailedRunFactory and generateFailedExecutionFromError', () => {
	it('generates failed execution payload without node', () => {
		const factory = new FailedRunFactory({ modeTag: 'custom-tag' });
		const error = new Error('Test failure');
		const run = factory.generateFailedExecutionFromError('manual', error, undefined);

		assert.equal(run.status, 'error');
		assert.equal(run.finished, false);
		assert.equal(run.mode, 'manual');
		assert.equal(run.storedAt, 'custom-tag');
		assert.equal(run.data.resultData.error.message, 'Test failure');
		assert.deepEqual(run.data.resultData.runData, {});
		assert.deepEqual(run.data.startData, {});
	});

	it('generates structured failed execution with node details and execution stack', () => {
		const node = { name: 'MyNode', type: 'n8n-nodes-base.code' };
		const error = new Error('Node failed');
		const startTime = 1000;
		const run = generateFailedExecutionFromError('trigger', error, node, startTime);

		assert.equal(run.status, 'error');
		assert.equal(run.mode, 'trigger');
		assert.equal(run.data.resultData.lastNodeExecuted, 'MyNode');
		assert.equal(run.data.startData.destinationNode.nodeName, 'MyNode');
		assert.deepEqual(run.data.startData.runNodeFilter, ['MyNode']);

		const taskData = run.data.resultData.runData.MyNode[0];
		assert.equal(taskData.startTime, startTime);
		assert.equal(taskData.executionStatus, 'error');
		assert.equal(taskData.error.message, 'Node failed');

		assert.equal(run.data.executionData.nodeExecutionStack.length, 1);
		assert.equal(run.data.executionData.nodeExecutionStack[0].node.name, 'MyNode');
	});
});

describe('executeErrorWorkflow', () => {
	it('calls external error workflow with workflowErrorData when errorWorkflow is configured', async () => {
		let executedWorkflowId = null;
		let capturedErrorData = null;
		let capturedProject = null;

		const workflowData = {
			id: 'wf-main-1',
			name: 'Main Workflow',
			settings: { errorWorkflow: 'wf-error-99' },
		};

		const fullRunData = {
			data: {
				resultData: {
					error: { message: 'Workflow crashed' },
					lastNodeExecuted: 'BadNode',
				},
				executionData: { runtimeData: { env: 'prod' } },
			},
		};

		const context = {
			urlService: { getWebhookBaseUrl: () => 'https://n8n.example.com/' },
			workflowExecutionService: {
				executeErrorWorkflow: async (errWfId, errData, project) => {
					executedWorkflowId = errWfId;
					capturedErrorData = errData;
					capturedProject = project;
				},
			},
			ownershipService: {
				getWorkflowProjectCached: async (wfId) => ({ id: 'proj-123', name: 'Main Project' }),
			},
		};

		executeErrorWorkflow(workflowData, fullRunData, 'webhook', 'exec-777', 'exec-retry-1', context);

		// Allow promise to resolve
		await new Promise((resolve) => setImmediate(resolve));

		assert.equal(executedWorkflowId, 'wf-error-99');
		assert.equal(capturedProject.id, 'proj-123');
		assert.equal(capturedErrorData.execution.id, 'exec-777');
		assert.equal(
			capturedErrorData.execution.url,
			'https://n8n.example.com/workflow/wf-main-1/executions/exec-777',
		);
		assert.equal(capturedErrorData.execution.error.message, 'Workflow crashed');
		assert.equal(capturedErrorData.execution.lastNodeExecuted, 'BadNode');
		assert.equal(capturedErrorData.execution.mode, 'webhook');
		assert.equal(capturedErrorData.execution.retryOf, 'exec-retry-1');
		assert.deepEqual(capturedErrorData.execution.executionContext, { env: 'prod' });
		assert.equal(capturedErrorData.workflow.id, 'wf-main-1');
		assert.equal(capturedErrorData.workflow.name, 'Main Workflow');
	});

	it('constructs trigger error data when executionId is undefined', async () => {
		let capturedErrorData = null;

		const workflowData = {
			id: 'wf-trigger-1',
			name: 'Trigger Workflow',
			settings: { errorWorkflow: 'wf-error-trigger' },
		};

		const fullRunData = {
			data: {
				resultData: {
					error: { message: 'Trigger poller failed' },
				},
			},
		};

		const context = {
			workflowExecutionService: {
				executeErrorWorkflow: async (_errWfId, errData) => {
					capturedErrorData = errData;
				},
			},
		};

		executeErrorWorkflow(workflowData, fullRunData, 'trigger', undefined, undefined, context);
		await new Promise((resolve) => setImmediate(resolve));

		assert.ok(capturedErrorData.trigger);
		assert.equal(capturedErrorData.trigger.error.message, 'Trigger poller failed');
		assert.equal(capturedErrorData.trigger.mode, 'trigger');
		assert.equal(capturedErrorData.execution, undefined);
	});

	it('avoids infinite recursion when error workflow is its own error workflow in error mode', async () => {
		let called = false;

		const workflowData = {
			id: 'wf-self-error',
			name: 'Self Error',
			settings: { errorWorkflow: 'wf-self-error' },
		};

		const fullRunData = {
			data: {
				resultData: { error: { message: 'Loop prevention check' } },
			},
		};

		const context = {
			workflowExecutionService: {
				executeErrorWorkflow: async () => {
					called = true;
				},
			},
		};

		executeErrorWorkflow(workflowData, fullRunData, 'error', 'exec-loop', undefined, context);
		await new Promise((resolve) => setImmediate(resolve));

		assert.equal(called, false);
	});

	it('calls internal error workflow when errorTrigger is present in nodes', async () => {
		let internalWfCalled = null;

		const workflowData = {
			id: 'wf-internal-error',
			name: 'Internal Error Trigger Workflow',
			nodes: [
				{ name: 'Error Trigger', type: 'n8n-nodes-base.errorTrigger' },
				{ name: 'Email Alert', type: 'n8n-nodes-base.code' },
			],
		};

		const fullRunData = {
			data: {
				resultData: { error: { message: 'Internal crash' } },
			},
		};

		const context = {
			workflowExecutionService: {
				executeErrorWorkflow: async (wfId) => {
					internalWfCalled = wfId;
				},
			},
		};

		executeErrorWorkflow(workflowData, fullRunData, 'trigger', 'exec-int', undefined, context);
		await new Promise((resolve) => setImmediate(resolve));

		assert.equal(internalWfCalled, 'wf-internal-error');
	});
});

describe('saveExecutionProgress', () => {
	it('saves execution progress and updates lastNodeExecuted', async () => {
		let updatedExecutionId = null;
		let updatedPayload = null;
		let updatedOptions = null;

		const executionData = {
			resultData: {
				runData: {},
			},
		};

		const mockRepo = {
			updateExistingExecution: async (id, payload, options) => {
				updatedExecutionId = id;
				updatedPayload = payload;
				updatedOptions = options;
				return true;
			},
		};

		await saveExecutionProgress('wf-1', 'exec-99', 'NodeA', {}, executionData, {
			executionRepository: mockRepo,
		});

		assert.equal(updatedExecutionId, 'exec-99');
		assert.equal(updatedPayload.status, 'running');
		assert.deepEqual(updatedPayload.data, executionData);
		assert.equal(executionData.resultData.lastNodeExecuted, 'NodeA');
		assert.deepEqual(updatedOptions, { requireNotFinished: true, requireNotCanceled: true });
	});

	it('gracefully handles database errors without throwing', async () => {
		let reportedError = null;

		const mockRepo = {
			updateExistingExecution: async () => {
				throw new Error('Database locked');
			},
		};

		const mockReporter = {
			error: (err) => {
				reportedError = err;
			},
		};

		await assert.doesNotReject(async () => {
			await saveExecutionProgress('wf-1', 'exec-locked', 'NodeB', {}, {}, {
				executionRepository: mockRepo,
				errorReporter: mockReporter,
			});
		});

		assert.ok(reportedError);
		assert.equal(reportedError.message, 'Database locked');
	});
});
