/**
 * Execution stack plumbing: waiting execution, output routing and the helpers
 * the main loop calls for both.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/core/src/execution-engine/workflow-execute.ts
 *     - incomingConnectionIsEmpty   (L359)
 *     - prepareWaitingToExecution   (L387)
 *     - addNodeToBeExecuted         (L406-830)
 */

import { ApplicationError } from './errors.mjs';

/** `incomingConnectionIsEmpty(runData, inputConnections, runIndex)` — verbatim. */
export function incomingConnectionIsEmpty(runData, inputConnections, runIndex) {
	for (const inputConnection of inputConnections ?? []) {
		const nodeIncomingData = runData?.[inputConnection.node]?.[runIndex]?.data?.main?.[inputConnection.index];
		if (nodeIncomingData !== undefined && nodeIncomingData.length !== 0) return false;
	}
	return true;
}

/**
 * `prepareWaitingToExecution` — allocates the waiting slot for `runIndex` and
 * fills `main[i] = null` for every input connection, so the loop can detect
 * which inputs are still missing.
 */
export function prepareWaitingToExecution(runExecutionData, nodeName, numberOfConnections, runIndex) {
	const executionData = runExecutionData.executionData;
	executionData.waitingExecution ??= {};
	executionData.waitingExecutionSource ??= {};

	const nodeWaiting = (executionData.waitingExecution[nodeName] ??= []);
	const nodeWaitingSource = (executionData.waitingExecutionSource[nodeName] ??= []);

	nodeWaiting[runIndex] = { main: [] };
	nodeWaitingSource[runIndex] = { main: [] };

	for (let i = 0; i < numberOfConnections; i++) {
		nodeWaiting[runIndex].main.push(null);
		nodeWaitingSource[runIndex].main.push(null);
	}

	return { waiting: nodeWaiting[runIndex], waitingSource: nodeWaitingSource[runIndex] };
}

export function isLegacyExecutionOrder(workflow) {
	return workflow.settings?.executionOrder !== 'v1';
}

/**
 * `addNodeToBeExecuted(workflow, connectionData, outputIndex, parentNodeName,
 * nodeSuccessData, runIndex, newRunIndex?, metadata?)`.
 *
 * Two paths, exactly like upstream:
 *   1. `numberOfInputs > 1` → park the data in `waitingExecution` until every
 *      input has data (creating new entries as needed), then push an
 *      `IExecuteData` onto the node execution stack.
 *   2. single input → build `data.main` up to `connectionData.index` and push.
 *
 * The "legacy" (`executionOrder !== 'v1'`) `forceInputNodeExecution` branch —
 * walking parents to force-execute them with an empty item — is implemented for
 * the direct-input case only; upstream additionally walks grandparents. That
 * difference is recorded in docs/isolation/execution.md §"Known deltas".
 */
export function addNodeToBeExecuted({
	workflow,
	runExecutionData,
	connectionData,
	outputIndex,
	parentNodeName,
	nodeSuccessData,
	runIndex,
	newRunIndex,
	metadata,
}) {
	let stillDataMissing = false;
	const enqueue = isLegacyExecutionOrder(workflow) ? 'push' : 'unshift';
	const numberOfInputs = workflow.connectionsByDestinationNode[connectionData.node]?.main?.length ?? 0;
	let waitingNodeIndex;

	if (numberOfInputs > 1) {
		let nodeWasWaiting = true;
		const executionData = runExecutionData.executionData;
		executionData.waitingExecutionSource ??= {};

		if (executionData.waitingExecution[connectionData.node] === undefined) {
			executionData.waitingExecution[connectionData.node] = [];
			executionData.waitingExecutionSource[connectionData.node] = [];
			nodeWasWaiting = false;
		}

		let createNewWaitingEntry = true;

		if (Object.keys(executionData.waitingExecution[connectionData.node]).length > 0) {
			for (const index of Object.keys(executionData.waitingExecution[connectionData.node])) {
				if (!executionData.waitingExecution[connectionData.node][parseInt(index, 10)].main[connectionData.index]) {
					createNewWaitingEntry = false;
					waitingNodeIndex = parseInt(index, 10);
					break;
				}
			}
		}

		if (waitingNodeIndex === undefined) {
			waitingNodeIndex = Object.values(executionData.waitingExecution[connectionData.node]).length;
		}

		if (createNewWaitingEntry) {
			prepareWaitingToExecution(runExecutionData, connectionData.node, numberOfInputs, waitingNodeIndex);
		}

		const waiting = executionData.waitingExecution[connectionData.node][waitingNodeIndex];
		const waitingSource = executionData.waitingExecutionSource[connectionData.node][waitingNodeIndex];

		if (nodeSuccessData === null) {
			waiting.main[connectionData.index] = null;
			waitingSource.main[connectionData.index] = null;
		} else {
			waiting.main[connectionData.index] = nodeSuccessData[outputIndex];
			waitingSource.main[connectionData.index] = {
				previousNode: parentNodeName,
				previousNodeOutput: outputIndex ?? undefined,
				previousNodeRun: runIndex ?? undefined,
			};
		}

		let allDataFound = true;
		for (let i = 0; i < waiting.main.length; i++) {
			if (waiting.main[i] === null) {
				allDataFound = false;
				break;
			}
		}

		if (allDataFound) {
			executionData.nodeExecutionStack[enqueue]({
				node: workflow.nodes[connectionData.node],
				data: waiting,
				source: waitingSource,
			});

			delete executionData.waitingExecution[connectionData.node][waitingNodeIndex];
			delete executionData.waitingExecutionSource[connectionData.node][waitingNodeIndex];

			if (Object.keys(executionData.waitingExecution[connectionData.node]).length === 0) {
				delete executionData.waitingExecution[connectionData.node];
				delete executionData.waitingExecutionSource[connectionData.node];
			}

			return { added: true, waiting: false };
		}

		stillDataMissing = true;

		if (!nodeWasWaiting) {
			// First time this node is seen waiting: make sure the sibling inputs
			// that belong to the *same* parent fan-out are also scheduled, so the
			// join can ever complete. Upstream additionally checks grandparents.
			const checkOutputNodes = [];
			for (const outputIndexParent of Object.keys(workflow.connectionsBySourceNode[parentNodeName]?.main ?? {})) {
				for (const connectionDataCheck of workflow.connectionsBySourceNode[parentNodeName].main[outputIndexParent] ?? []) {
					checkOutputNodes.push(connectionDataCheck.node);
				}
			}

			for (let inputIndex = 0; inputIndex < numberOfInputs; inputIndex++) {
				for (const inputData of workflow.connectionsByDestinationNode[connectionData.node].main[inputIndex] ?? []) {
					if (inputData.node === parentNodeName) continue;

					const executionStackNodes = executionData.nodeExecutionStack.map((stackData) => stackData.node.name);
					if (executionStackNodes.includes(inputData.node)) continue;
					if (runExecutionData.resultData.runData[inputData.node] !== undefined) continue;
					if (!isLegacyExecutionOrder(workflow)) continue;
					if (checkOutputNodes.includes(inputData.node)) {
						// The parent fan-out reaches that node anyway
						continue;
					}

					const parentNodes = workflow.getParentNodes(inputData.node, 'main', -1);
					if (parentNodes.includes(parentNodeName)) continue;

					const emptyInput = workflow.connectionsByDestinationNode[inputData.node] === undefined ||
						incomingConnectionIsEmpty(
							runExecutionData.resultData.runData,
							workflow.connectionsByDestinationNode[inputData.node].main[0] ?? [],
							runIndex,
						);

					if (emptyInput) {
						executionData.nodeExecutionStack[enqueue]({
							node: workflow.getNode(inputData.node),
							data: { main: [[{ json: {} }]] },
							source: {
								main: [
									{
										previousNode: parentNodeName,
										previousNodeOutput: outputIndex ?? undefined,
										previousNodeRun: runIndex ?? undefined,
									},
								],
							},
						});
					}
				}
			}
		}
	}

	let connectionDataArray = runExecutionData.executionData.waitingExecution?.[connectionData.node]?.[waitingNodeIndex]?.main ?? null;

	if (connectionDataArray === null || connectionDataArray === undefined) {
		connectionDataArray = [];
		for (let i = connectionData.index; i >= 0; i--) {
			connectionDataArray[i] = null;
		}
	} else {
		connectionDataArray = [...connectionDataArray];
	}

	connectionDataArray[connectionData.index] = nodeSuccessData === null ? null : nodeSuccessData[outputIndex];

	if (stillDataMissing) {
		const executionData = runExecutionData.executionData;
		const previousSource = executionData.waitingExecutionSource[connectionData.node][waitingNodeIndex].main;

		prepareWaitingToExecution(runExecutionData, connectionData.node, numberOfInputs, waitingNodeIndex);
		executionData.waitingExecution[connectionData.node][waitingNodeIndex] = { main: connectionDataArray };
		executionData.waitingExecutionSource[connectionData.node][waitingNodeIndex].main = previousSource;

		return { added: false, waiting: true };
	}

	if (workflow.nodes[connectionData.node]) {
		runExecutionData.executionData.nodeExecutionStack[enqueue]({
			node: workflow.nodes[connectionData.node],
			data: { main: connectionDataArray },
			source: {
				main: [
					{
						previousNode: parentNodeName,
						previousNodeOutput: outputIndex ?? undefined,
						previousNodeRun: runIndex ?? undefined,
					},
				],
			},
			runIndex: newRunIndex,
			metadata,
		});

		return { added: true, waiting: false };
	}

	throw new ApplicationError('Destination node not found', {
		extra: { sourceNodeName: parentNodeName, destinationNodeName: connectionData.node },
	});
}
