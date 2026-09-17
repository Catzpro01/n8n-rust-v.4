/**
 * FailedRunFactory — constructs structured IRun execution payloads from errors.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/cli/src/executions/failed-run-factory.ts
 */

import { createRunExecutionData } from './run-execution-data.mjs';

/**
 * Builds a failed execution IRun object representing an early error.
 *
 * @param {string} mode WorkflowExecuteMode ('manual' | 'trigger' | 'webhook' | 'error' | etc.)
 * @param {object} error ExecutionError
 * @param {object} [node] Starting or failing INode
 * @param {number} [startTime=Date.now()]
 * @param {object} [storageConfig={ modeTag: 'filesystem' }]
 * @returns {object} IRun
 */
export function generateFailedExecutionFromError(
	mode,
	error,
	node,
	startTime = Date.now(),
	storageConfig = { modeTag: 'filesystem' },
) {
	const executionError = {
		...error,
		message: error?.message ?? 'Execution error',
		stack: error?.stack,
	};

	const returnData = {
		data: createRunExecutionData({
			resultData: {
				error: executionError,
				runData: {},
			},
		}),
		finished: false,
		mode,
		startedAt: new Date(),
		stoppedAt: new Date(),
		status: 'error',
		storedAt: storageConfig?.modeTag,
	};

	if (node) {
		returnData.data.startData = {
			destinationNode: {
				nodeName: node.name,
				mode: 'inclusive',
			},
			runNodeFilter: [node.name],
		};
		returnData.data.resultData.lastNodeExecuted = node.name;
		returnData.data.resultData.runData[node.name] = [
			{
				startTime,
				executionIndex: 0,
				executionTime: 0,
				executionStatus: 'error',
				error: executionError,
				source: [],
			},
		];
		returnData.data.executionData = {
			contextData: {},
			metadata: {},
			waitingExecution: {},
			waitingExecutionSource: {},
			nodeExecutionStack: [
				{
					node,
					data: {},
					source: null,
				},
			],
		};
	}

	return returnData;
}

export class FailedRunFactory {
	constructor(storageConfig = { modeTag: 'filesystem' }) {
		this.storageConfig = storageConfig;
	}

	generateFailedExecutionFromError(mode, error, node, startTime = Date.now()) {
		return generateFailedExecutionFromError(mode, error, node, startTime, this.storageConfig);
	}
}
