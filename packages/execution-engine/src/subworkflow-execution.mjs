/**
 * Subworkflow execution runtime and helpers.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/cli/src/workflow-execute-additional-data.ts
 *     - getRunData             L55-93
 *     - executeWorkflow        L197-248
 *     - startExecution         L250-410
 *     - getBase                L448-460
 *   reference/n8n/packages/cli/src/utils.ts
 *     - findSubworkflowStart   L38
 *
 * Connects sub-workflow invocation with ActiveExecutions, WorkflowExecute,
 * and parent-child execution state transfer.
 */

import {
	SubworkflowOperationError,
	UnexpectedError,
} from './errors.mjs';
import { ExecutionLifecycleHooks } from './lifecycle-hooks.mjs';
import { createRunExecutionData } from './run-execution-data.mjs';
import { WorkflowExecute } from './workflow-execute.mjs';
import { getDataLastExecutedNodeData } from './workflow-helpers.mjs';
import { ReconstructedWorkflow } from './workflow.mjs';
import { FailedRunFactory } from './failed-run-factory.mjs';

export const STARTING_NODES = Object.freeze([
	'@n8n/n8n-nodes-langchain.manualChatTrigger',
	'n8n-nodes-base.manualTrigger',
	'n8n-nodes-base.start',
]);

/**
 * Finds the starting node for a sub-workflow.
 * Prioritizes executeWorkflowTrigger, then STARTING_NODES, otherwise throws.
 * Mirrors reference utils.ts:18-38.
 *
 * @param {Array<object>} nodes
 * @returns {object}
 */
export function findSubworkflowStart(nodes) {
	if (!Array.isArray(nodes)) {
		throw new SubworkflowOperationError(
			'Missing node to start execution',
			"Please make sure the workflow you're calling contains an Execute Workflow Trigger node",
		);
	}

	const executeWorkflowTriggerNode = nodes.find(
		(node) => node.type === 'n8n-nodes-base.executeWorkflowTrigger',
	);
	if (executeWorkflowTriggerNode) return executeWorkflowTriggerNode;

	const startNode = nodes.find((node) => STARTING_NODES.includes(node.type));
	if (startNode) return startNode;

	throw new SubworkflowOperationError(
		'Missing node to start execution',
		"Please make sure the workflow you're calling contains an Execute Workflow Trigger node",
	);
}

/**
 * Prepares workflow run data for an integrated sub-workflow execution.
 * Mirrors workflow-execute-additional-data.ts:55-93.
 *
 * @param {object} workflowData
 * @param {Array<object>} [inputData]
 * @param {object} [parentExecution]
 * @returns {object} IWorkflowExecutionDataProcess
 */
export function getRunData(workflowData, inputData, parentExecution) {
	const mode = 'integrated';
	const startingNode = findSubworkflowStart(workflowData.nodes);

	const resolvedInput = inputData || [{ json: {} }];

	const nodeExecutionStack = [
		{
			node: startingNode,
			data: {
				main: [resolvedInput],
			},
			metadata: { parentExecution },
			source: null,
		},
	];

	const runExecutionData = createRunExecutionData({
		executionData: {
			nodeExecutionStack,
		},
		parentExecution,
	});

	return {
		executionMode: mode,
		executionData: runExecutionData,
		workflowData,
	};
}

/**
 * Baseline additional data constructor for workflow execution.
 * Mirrors workflow-execute-additional-data.ts:448-460.
 *
 * @param {object} params
 * @returns {object}
 */
export function getBase(params = {}) {
	return {
		userId: params.userId,
		workflowId: params.workflowId,
		executionTimeoutTimestamp: params.executionTimeoutTimestamp,
		workflowSettings: params.workflowSettings ?? {},
		restApiUrl: params.restApiUrl ?? '',
		encryptionKey: params.encryptionKey ?? '',
		timezone: params.workflowSettings?.timezone ?? 'UTC',
	};
}

/**
 * Executes a subworkflow and returns its results.
 * Mirrors workflow-execute-additional-data.ts:197-248 and 250-410.
 *
 * @param {object} workflowInfo - { id?: string, code?: object }
 * @param {object} additionalData - execution context passed down
 * @param {object} options - execution options
 * @param {object} context - injected service dependencies
 * @returns {Promise<{ executionId: string, data: any, waitTill?: Date }>}
 */
export async function executeWorkflow(workflowInfo, additionalData, options = {}, context = {}) {
	const activeExecutions = context.activeExecutions;
	if (!activeExecutions) {
		throw new UnexpectedError('ActiveExecutions registry must be provided in context');
	}

	let workflowData = options.loadedWorkflowData;
	if (!workflowData) {
		if (workflowInfo?.id === undefined && workflowInfo?.code === undefined) {
			throw new UnexpectedError(
				'No information about the workflow to execute found. Please provide either the "id" or "code"!',
			);
		}

		if (workflowInfo.id !== undefined) {
			if (!context.workflowRepository) {
				throw new UnexpectedError('WorkflowRepository must be provided to fetch workflow by id');
			}
			workflowData = await context.workflowRepository.get({ id: workflowInfo.id });
			if (!workflowData) {
				throw new UnexpectedError('Workflow does not exist.', {
					extra: { workflowId: workflowInfo.id },
				});
			}
		} else {
			workflowData = workflowInfo.code;
			if (workflowData) {
				if (!workflowData.id) {
					workflowData.id = options.parentWorkflowId;
				}
				workflowData.settings ??= options.parentWorkflowSettings;
			}
		}
	}

	const runData = options.loadedRunData ?? getRunData(workflowData, options.inputData, options.parentExecution);

	const executionId = await activeExecutions.add(runData);

	if (context.eventService?.emit) {
		context.eventService.emit('workflow-executed', {
			user: additionalData?.userId ? { id: additionalData.userId } : undefined,
			workflowId: workflowData.id,
			workflowName: workflowData.name,
			executionId,
			source: 'integrated',
		});
	}

	const executionPromise = startSubExecution(
		additionalData,
		options,
		executionId,
		runData,
		workflowData,
		context,
	);

	if (options.doNotWaitToFinish) {
		return { executionId, data: [null] };
	}

	return await executionPromise;
}

/**
 * Internal execution handler for subworkflow.
 * Mirrors workflow-execute-additional-data.ts:250-410.
 */
async function startSubExecution(
	additionalData,
	options,
	executionId,
	runData,
	workflowData,
	context,
) {
	const nodeTypes = context.nodeTypes ?? { getByNameAndVersion: () => ({}) };
	const activeExecutions = context.activeExecutions;
	const executionRepository = context.executionRepository ?? {
		setRunning: async () => {},
		updateExistingExecution: async () => {},
	};
	const workflowFactory = context.workflowFactory ?? ((p) => new ReconstructedWorkflow(p));
	const workflowExecuteFactory = context.workflowExecuteFactory ?? ((ad, mode, execData) =>
		new WorkflowExecute(ad, mode, execData)
	);

	const workflow = workflowFactory({
		id: workflowData.id,
		name: workflowData.name,
		nodes: workflowData.nodes ?? [],
		connections: workflowData.connections ?? {},
		active: workflowData.activeVersionId !== null && workflowData.activeVersionId !== undefined,
		nodeTypes,
		staticData: workflowData.staticData,
		settings: workflowData.settings,
	});

	await executionRepository.setRunning(executionId);

	const startTime = Date.now();
	let data;

	try {
		if (context.credentialsPermissionChecker?.check) {
			await context.credentialsPermissionChecker.check(workflowData.id, workflowData.nodes);
		}

		const workflowSettings = workflowData.settings;
		const additionalDataIntegrated = {
			...getBase({
				workflowId: workflowData.id,
				workflowSettings,
			}),
			...additionalData,
			executionId,
			parentCallbackManager: options.parentCallbackManager,
			executeWorkflow: additionalData?.executeWorkflow,
			httpResponse: additionalData?.httpResponse,
			streamingEnabled: additionalData?.streamingEnabled,
		};

		additionalDataIntegrated.hooks = new ExecutionLifecycleHooks(
			runData.executionMode,
			executionId,
			workflowData,
		);

		let subworkflowTimeout = additionalData?.executionTimeoutTimestamp;
		if (workflowSettings?.executionTimeout !== undefined && workflowSettings.executionTimeout > 0) {
			subworkflowTimeout = Math.min(
				additionalData?.executionTimeoutTimestamp || Number.MAX_SAFE_INTEGER,
				startTime + workflowSettings.executionTimeout * 1000,
			);
		}
		additionalDataIntegrated.executionTimeoutTimestamp = subworkflowTimeout;

		const workflowExecute = workflowExecuteFactory(
			additionalDataIntegrated,
			runData.executionMode,
			runData.executionData,
		);

		const execution = workflowExecute.processRunExecutionData(workflow);
		activeExecutions.attachWorkflowExecution(executionId, execution);
		data = await execution;
	} catch (error) {
		const failedRunFactory = context.failedRunFactory ?? new FailedRunFactory();

		const fullRunData = failedRunFactory.generateFailedExecutionFromError(
			runData.executionMode,
			error,
			error?.node,
			startTime,
		);

		activeExecutions.finalizeExecution(executionId, fullRunData);

		await executionRepository.updateExistingExecution(executionId, {
			data: fullRunData.data,
			mode: fullRunData.mode,
			finished: false,
			startedAt: fullRunData.startedAt,
			stoppedAt: fullRunData.stoppedAt,
			status: fullRunData.status,
			workflowData,
			workflowId: workflowData.id,
		});

		throw error;
	}

	if (data.finished === true || data.status === 'waiting') {
		activeExecutions.finalizeExecution(executionId, data);
		const returnData = getDataLastExecutedNodeData(data);
		return {
			executionId,
			data: returnData?.data?.main,
			waitTill: data.waitTill,
		};
	}

	activeExecutions.finalizeExecution(executionId, data);
	const { error } = data.data?.resultData ?? {};
	throw error ?? new UnexpectedError('Subworkflow execution failed');
}
