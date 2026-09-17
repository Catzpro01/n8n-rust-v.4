/**
 * Workflow execution helper functions.
 *
 * Reconstruction target: n8n 2.9.4
 *   reference/n8n/packages/cli/src/workflow-helpers.ts
 *
 * Scope: functions needed by WaitTracker and sub-workflow parent execution resumption.
 */

/**
 * Checks if a parent execution should be restarted when a child execution completes.
 * Backward compatibility: if shouldResume is undefined, returns true.
 *
 * @param {object} [parentExecution]
 * @returns {boolean}
 */
export function shouldRestartParentExecution(parentExecution) {
	if (parentExecution === undefined || parentExecution === null) {
		return false;
	}
	if (parentExecution.shouldResume === undefined) {
		return true;
	}
	return Boolean(parentExecution.shouldResume);
}

/**
 * Extracts output data from the last executed node of a finished workflow run.
 *
 * @param {object} inputData - IRun object
 * @returns {object|undefined} - ITaskData or undefined
 */
export function getDataLastExecutedNodeData(inputData) {
	if (!inputData?.data?.resultData) {
		return undefined;
	}
	const { runData = {}, pinData = {}, lastNodeExecuted } = inputData.data.resultData;

	if (lastNodeExecuted === undefined || runData[lastNodeExecuted] === undefined) {
		return undefined;
	}

	const lastNodeRuns = runData[lastNodeExecuted];
	if (!Array.isArray(lastNodeRuns) || lastNodeRuns.length === 0) {
		return undefined;
	}
	const lastNodeRunData = lastNodeRuns[lastNodeRuns.length - 1];

	let lastNodePinData = pinData[lastNodeExecuted];
	if (lastNodePinData && inputData.mode === 'manual') {
		if (!Array.isArray(lastNodePinData)) lastNodePinData = [lastNodePinData];
		const itemsPerRun = lastNodePinData.map((item, index) => ({
			json: item,
			pairedItem: { item: index },
		}));
		return {
			startTime: 0,
			executionIndex: 0,
			executionTime: 0,
			data: {
				main: [itemsPerRun],
			},
		};
	}

	return lastNodeRunData;
}

/**
 * Updates a waiting parent execution's nodeExecutionStack with the final results
 * from a completed child execution.
 *
 * @param {object} executionRepository
 * @param {string} parentExecutionId
 * @param {object} subworkflowResults
 * @returns {Promise<void>}
 */
export async function updateParentExecutionWithChildResults(
	executionRepository,
	parentExecutionId,
	subworkflowResults,
) {
	const lastExecutedNodeData = getDataLastExecutedNodeData(subworkflowResults);
	if (!lastExecutedNodeData?.data) return;

	const parent = await executionRepository.findSingleExecution(parentExecutionId, {
		includeData: true,
		unflattenData: true,
	});

	if (parent?.status !== 'waiting') {
		return;
	}

	const parentWithSubWorkflowResults = { data: { ...parent.data } };
	const nodeExecutionStack = parentWithSubWorkflowResults.data?.executionData?.nodeExecutionStack;
	if (!nodeExecutionStack || nodeExecutionStack.length === 0) {
		return;
	}

	// Copy the sub workflow result to the parent execution's Execute Workflow node inputs
	nodeExecutionStack[0].data = lastExecutedNodeData.data;

	await executionRepository.updateExistingExecution(
		parentExecutionId,
		parentWithSubWorkflowResults,
	);
}
