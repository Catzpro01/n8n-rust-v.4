/**
 * 1:1 native JavaScript reconstruction of n8n 2.9.4 `WorkflowExecute`
 * (reference/n8n/packages/core/src/execution-engine/workflow-execute.ts, 2655 lines).
 *
 * TASK-PIPE-02 — Node Execution Loop (Stack Pop, Run, Output Routing).
 * Behavioral spec: docs/isolation/execution-loop-spec.md (POOL-001) — every section
 * below cites the reference lines it ports (WEX:<lines>).
 *
 * What is 1:1: stack discipline (shift/pop/push/unshift), runNode dispatch order,
 * retry policy, pinData short-circuit, error semantics (continueOnFail/onError/
 * hard-fail requeue), waitTill/destinationNode/runNodeFilter, output routing with
 * the v0/v1 ordering fork, multi-input join through waitingExecution (+Source),
 * waiting-nodes drain with requiredInputs, runData recording, pairedItem handling,
 * assignPairedItems, status resolution.
 *
 * Documented deviations (infrastructure the loop does not own — see README):
 *  - PCancelable -> plain Promise + explicit cancel() with the same onCancel effects
 *  - establishExecutionContext / Sentry / DI Container / Logger -> injectable no-ops
 *  - convertBinaryData -> passthrough (binary streaming out of scope)
 *  - ExecuteContext is a minimal context (getAllInputData/getInputData/getNodeParameter/
 *    logger/abortSignal/hints) — full data-proxy surface belongs to TASK-PIPE-13
 *  - checkReadyForExecution checks node-type existence only (parameter issue checks
 *    need NodeHelpers + full node descriptions)
 *  - getSimpleParameterValue for requiredInputs expressions resolves literal
 *    JSON only (no expression engine yet)
 */

import { createRunExecutionData } from './run-execution-data.mjs';

const noopLogger = { debug() {}, error() {}, warn() {}, info() {} };

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** lodash-style `get` with array path, used by the reference for waitingExecution lookups. */
function getPath(obj, path, defaultValue) {
	let current = obj;
	for (const key of path) {
		if (current === null || current === undefined) return defaultValue;
		current = current[key];
	}
	return current === undefined ? defaultValue : current;
}

/** reference/n8n/packages/core/src/execution-engine/node-execution-context/utils/resolve-source-overwrite.ts (1:1) */
function resolveSourceOverwrite(item, executionData) {
	const isToolExecution = !!executionData.metadata?.preserveSourceOverwrite;
	if (!isToolExecution) return null;
	if (executionData.metadata?.preservedSourceOverwrite) {
		return executionData.metadata.preservedSourceOverwrite;
	}
	if (typeof item.pairedItem === 'object' && 'sourceOverwrite' in item.pairedItem) {
		return item.pairedItem.sourceOverwrite;
	}
	return null;
}

/** reference isEngineRequest (requests-response.ts): object carrying `actions`. */
function isEngineRequest(responseOrRequest) {
	return !!responseOrRequest && typeof responseOrRequest === 'object' && 'actions' in responseOrRequest;
}

/**
 * Minimal EngineRequest handling — port of handleRequest's contract
 * (schedule requested sub-nodes, re-queue requester with subNodeExecutionData).
 * The AI-tool action metadata bookkeeping is reduced to the loop-visible parts.
 */
function handleRequest({ workflow, currentNode, request, runIndex, executionData }) {
	const nodesToBeExecuted = [];

	for (const action of request.actions ?? []) {
		if (!(action.nodeName in workflow.nodes)) continue;
		const parentNode = executionData.source?.main?.[0]?.previousNode ?? currentNode.name;
		nodesToBeExecuted.push({
			inputConnectionData: { type: action.type ?? 'ai_tool', node: action.nodeName, index: 0 },
			parentOutputIndex: 0,
			parentNode,
			parentOutputData: executionData.data.main ?? [],
			runIndex,
			nodeRunIndex: runIndex,
			metadata: {
				preserveSourceOverwrite: true,
				preservedSourceOverwrite: executionData.metadata?.preservedSourceOverwrite ?? {
					previousNode: parentNode,
					previousNodeOutput: 0,
					previousNodeRun: runIndex,
				},
			},
		});
	}

	const parentNode = executionData.source?.main?.[0]?.previousNode;
	if (parentNode) {
		const metadata = executionData.metadata?.preservedSourceOverwrite
			? {
					preserveSourceOverwrite: true,
					preservedSourceOverwrite: executionData.metadata.preservedSourceOverwrite,
				}
			: {};
		nodesToBeExecuted.unshift({
			inputConnectionData: { type: 'ai_tool', node: currentNode.name, index: 0 },
			parentOutputIndex: 0,
			parentNode,
			parentOutputData: executionData.data.main ?? [],
			runIndex,
			nodeRunIndex: runIndex,
			metadata: {
				nodeWasResumed: true,
				subNodeExecutionData: {
					actions: (request.actions ?? []).map((action) => ({
						action,
						nodeName: action.nodeName,
						runIndex,
					})),
					metadata: request.metadata ?? {},
				},
				...metadata,
			},
		});
	}

	return { nodesToBeExecuted };
}

/**
 * Minimal ExecuteContext — the subset of the reference context
 * (node-execution-context/execute-context.ts) the loop's own tests need.
 */
class ExecuteContext {
	constructor(workflow, node, additionalData, mode, runExecutionData, runIndex, connectionInputData, inputData, executionData, closeFunctions, abortSignal, subNodeExecutionResults) {
		this.workflow = workflow;
		this.node = node;
		this.additionalData = additionalData;
		this.mode = mode;
		this.runExecutionData = runExecutionData;
		this.runIndex = runIndex;
		this.connectionInputData = connectionInputData;
		this.inputData = inputData;
		this.executionData = executionData;
		this.closeFunctions = closeFunctions;
		this.abortSignal = abortSignal;
		this.subNodeExecutionResults = subNodeExecutionResults;
		this.hints = [];
		this.logger = additionalData?.logger ?? noopLogger;
	}

	/** All items of the first main input (reference getAllInputData semantics). */
	getAllInputData() {
		return this.connectionInputData;
	}

	/** Items for a given input index (default 0) — reference getInputData. */
	getInputData(inputIndex = 0, _inputName = 'main') {
		const main = this.inputData.main ?? [];
		return main[inputIndex] ?? [];
	}

	/** Plain parameter access; full expression resolution belongs to PIPE-13. */
	getNodeParameter(parameterName, fallbackValue) {
		const parameters = this.node.parameters ?? {};
		return parameters[parameterName] ?? fallbackValue;
	}

	getNode() {
		return this.node;
	}
}

export class WorkflowExecute {
	/**
	 * @param {object} additionalData { hooks, executionTimeoutTimestamp?, currentNodeExecutionIndex?, executionId?, restartExecutionId?, logger? }
	 * @param {string} mode WorkflowExecuteMode
	 * @param {object} [runExecutionData]
	 */
	constructor(additionalData, mode, runExecutionData = createRunExecutionData(), storedAt = 'db') {
		this.additionalData = additionalData;
		this.mode = mode;
		this.runExecutionData = runExecutionData;
		this.storedAt = storedAt;
		this.status = 'new';
		this.timedOut = false;
		this.abortController = new AbortController();
		this.logger = additionalData?.logger ?? noopLogger;
		this._cancelRequested = false;
	}

	// WEX:189-196
	isLegacyExecutionOrder(workflow) {
		return workflow.settings.executionOrder !== 'v1';
	}

	get isCancelled() {
		return this.status === 'canceled';
	}

	// WEX:2641-2651
	updateTaskStatusesToCancelled() {
		if (!this.runExecutionData.resultData?.runData) return;
		for (const taskDataList of Object.values(this.runExecutionData.resultData.runData)) {
			for (const taskData of taskDataList) {
				if (!taskData.executionStatus) taskData.executionStatus = 'canceled';
			}
		}
	}

	/**
	 * WEX:123-188 — run(): seeds the nodeExecutionStack from the start node.
	 * PCancelable in the reference; here a plain Promise + cancel().
	 */
	run({ workflow, startNode, destinationNode, pinData, triggerToStartFrom, additionalRunFilterNodes }) {
		this.status = 'running';

		startNode = startNode || workflow.getStartNode(destinationNode?.nodeName);
		if (startNode === undefined) {
			throw new Error('No node to start the workflow from could be found');
		}

		let runNodeFilter;
		if (destinationNode) {
			runNodeFilter = [
				...workflow.getParentNodes(destinationNode.nodeName),
				...workflow.getParentNodes(destinationNode.nodeName, 'ALL_NON_MAIN'),
			];
			if (destinationNode.mode === 'inclusive') {
				runNodeFilter.push(destinationNode.nodeName);
			}
			if (additionalRunFilterNodes) {
				runNodeFilter.push(...additionalRunFilterNodes);
			}
			runNodeFilter = Array.from(new Set(runNodeFilter));
		}

		const nodeExecutionStack = [
			{
				node: startNode,
				data: triggerToStartFrom?.data?.data ?? {
					main: [[{ json: {} }]],
				},
				source: null,
			},
		];

		this.runExecutionData = createRunExecutionData({
			startData: { destinationNode, runNodeFilter },
			executionData: { nodeExecutionStack },
			resultData: { pinData },
		});

		return this.processRunExecutionData(workflow);
	}

	// WEX:1285-1304
	handleWaitingState(workflow) {
		if (this.runExecutionData.waitTill) {
			this.runExecutionData.waitTill = undefined;
			if (this.runExecutionData.executionData === undefined) {
				throw new Error(
					`Execution data for workflow "${workflow.id}" is missing but there is still data to process (executionId: ${this.additionalData.executionId})`,
				);
			}
			const executionStackEntry = this.runExecutionData.executionData.nodeExecutionStack[0];
			executionStackEntry.node.disabled = true;

			const lastNodeExecuted = this.runExecutionData.resultData.lastNodeExecuted;
			this.runExecutionData.resultData.runData[lastNodeExecuted].pop();
		}
	}

	// WEX:1305-1330 — reduced: node-type existence only (see file header)
	checkForWorkflowIssues(workflow) {
		if (this.runExecutionData.executionData === undefined) {
			throw new Error('Execution data for workflow is missing');
		}
		const startNode = this.runExecutionData.executionData.nodeExecutionStack.at(0)?.node.name;
		let destinationNode;
		if (this.runExecutionData.startData?.destinationNode) {
			destinationNode = this.runExecutionData.startData.destinationNode;
		}
		const workflowIssues = this.checkReadyForExecution(workflow, {
			startNode,
			destinationNode,
			pinDataNodeNames: Object.keys(this.runExecutionData.resultData.pinData ?? {}),
		});
		if (workflowIssues !== null) {
			const error = new Error('Workflow has issues');
			error.workflowIssues = workflowIssues;
			throw error;
		}
	}

	// WEX:826-892 — reduced
	checkReadyForExecution(workflow, inputData = {}) {
		const workflowIssues = {};
		let checkNodes = [];
		if (inputData.destinationNode) {
			checkNodes = workflow.getParentNodes(inputData.destinationNode.nodeName);
			if (inputData.destinationNode.mode === 'inclusive') {
				checkNodes.push(inputData.destinationNode.nodeName);
			}
		} else if (inputData.startNode) {
			checkNodes = workflow.getChildNodes(inputData.startNode);
			checkNodes.push(inputData.startNode);
		}
		for (const nodeName of checkNodes) {
			const node = workflow.nodes[nodeName];
			if (!node || node.disabled === true) continue;
			const nodeType = workflow.nodeTypes.getByNameAndVersion(node.type, node.typeVersion);
			if (nodeType === undefined) {
				workflowIssues[node.name] = { typeUnknown: true };
			}
		}
		if (Object.keys(workflowIssues).length === 0) return null;
		return workflowIssues;
	}

	// WEX:318-343
	moveNodeMetadata() {
		const metadata = getPath(this.runExecutionData, ['executionData', 'metadata'], undefined);
		if (metadata) {
			const runData = getPath(this.runExecutionData, ['resultData', 'runData'], {});
			for (const nodeName of Object.keys(metadata)) {
				metadata[nodeName].forEach((metaRunData, index) => {
					const taskData = runData[nodeName]?.[index];
					if (taskData) {
						taskData.metadata = { ...taskData.metadata, ...metaRunData };
					} else {
						this.logger.error('Taskdata missing at the end of an execution', { nodeName, index });
					}
				});
			}
		}
	}

	// WEX:359-374
	incomingConnectionIsEmpty(runData, inputConnections, runIndex) {
		for (const inputConnection of inputConnections) {
			const nodeIncomingData = getPath(runData, [
				inputConnection.node,
				runIndex,
				'data',
				'main',
				inputConnection.index,
			]);
			if (nodeIncomingData !== undefined && nodeIncomingData.length !== 0) {
				return false;
			}
		}
		return true;
	}

	// WEX:387-404
	prepareWaitingToExecution(nodeName, numberOfConnections, runIndex) {
		const executionData = this.runExecutionData.executionData;
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
	}

	// WEX:406-825 — enqueue + multi-input join. 1:1 incl. legacy ancestor pull-in.
	addNodeToBeExecuted(
		workflow,
		connectionData,
		outputIndex,
		parentNodeName,
		nodeSuccessData,
		runIndex,
		newRunIndex,
		metadata,
	) {
		let stillDataMissing = false;
		const enqueueFn = workflow.settings.executionOrder === 'v1' ? 'unshift' : 'push';
		let waitingNodeIndex;

		const numberOfInputs =
			workflow.connectionsByDestinationNode[connectionData.node]?.main?.length ?? 0;
		if (numberOfInputs > 1) {
			let nodeWasWaiting = true;

			if (!this.runExecutionData.executionData.waitingExecutionSource) {
				this.runExecutionData.executionData.waitingExecutionSource = {};
			}

			if (this.runExecutionData.executionData.waitingExecution[connectionData.node] === undefined) {
				this.runExecutionData.executionData.waitingExecution[connectionData.node] = {};
				this.runExecutionData.executionData.waitingExecutionSource[connectionData.node] = {};
				nodeWasWaiting = false;
			}

			let createNewWaitingEntry = true;
			if (
				Object.keys(this.runExecutionData.executionData.waitingExecution[connectionData.node]).length > 0
			) {
				for (const index of Object.keys(
					this.runExecutionData.executionData.waitingExecution[connectionData.node],
				)) {
					if (
						!this.runExecutionData.executionData.waitingExecution[connectionData.node][parseInt(index)]
							.main[connectionData.index]
					) {
						createNewWaitingEntry = false;
						waitingNodeIndex = parseInt(index);
						break;
					}
				}
			}

			if (waitingNodeIndex === undefined) {
				waitingNodeIndex = Object.values(
					this.runExecutionData.executionData.waitingExecution[connectionData.node],
				).length;
			}

			if (createNewWaitingEntry) {
				this.prepareWaitingToExecution(
					connectionData.node,
					workflow.connectionsByDestinationNode[connectionData.node].main.length,
					waitingNodeIndex,
				);
			}

			if (nodeSuccessData === null) {
				this.runExecutionData.executionData.waitingExecution[connectionData.node][
					waitingNodeIndex
				].main[connectionData.index] = null;
				this.runExecutionData.executionData.waitingExecutionSource[connectionData.node][
					waitingNodeIndex
				].main[connectionData.index] = null;
			} else {
				this.runExecutionData.executionData.waitingExecution[connectionData.node][
					waitingNodeIndex
				].main[connectionData.index] = nodeSuccessData[outputIndex];
				this.runExecutionData.executionData.waitingExecutionSource[connectionData.node][
					waitingNodeIndex
				].main[connectionData.index] = {
					previousNode: parentNodeName,
					previousNodeOutput: outputIndex ?? undefined,
					previousNodeRun: runIndex ?? undefined,
				};
			}

			// Check if all data exists now
			let allDataFound = true;
			const waitingMain =
				this.runExecutionData.executionData.waitingExecution[connectionData.node][waitingNodeIndex].main;
			for (let i = 0; i < waitingMain.length; i++) {
				if (waitingMain[i] === null) {
					allDataFound = false;
					break;
				}
			}

			if (allDataFound) {
				const executionStackItem = {
					node: workflow.nodes[connectionData.node],
					data: this.runExecutionData.executionData.waitingExecution[connectionData.node][
						waitingNodeIndex
					],
					source:
						this.runExecutionData.executionData.waitingExecutionSource[connectionData.node][
							waitingNodeIndex
						],
				};

				this.runExecutionData.executionData.nodeExecutionStack[enqueueFn](executionStackItem);

				delete this.runExecutionData.executionData.waitingExecution[connectionData.node][
					waitingNodeIndex
				];
				delete this.runExecutionData.executionData.waitingExecutionSource[connectionData.node][
					waitingNodeIndex
				];

				if (
					Object.keys(this.runExecutionData.executionData.waitingExecution[connectionData.node])
						.length === 0
				) {
					delete this.runExecutionData.executionData.waitingExecution[connectionData.node];
					delete this.runExecutionData.executionData.waitingExecutionSource[connectionData.node];
				}
				return;
			}
			stillDataMissing = true;

			if (!nodeWasWaiting) {
				const checkOutputNodes = [];
				for (const outputIndexParent in workflow.connectionsBySourceNode[parentNodeName].main) {
					if (
						!Object.hasOwn(
							workflow.connectionsBySourceNode[parentNodeName].main,
							outputIndexParent,
						)
					) {
						continue;
					}
					for (const connectionDataCheck of (workflow.connectionsBySourceNode[parentNodeName].main[
						outputIndexParent
					] ?? [])) {
						checkOutputNodes.push(connectionDataCheck.node);
					}
				}

				for (
					let inputIndex = 0;
					inputIndex < workflow.connectionsByDestinationNode[connectionData.node].main.length;
					inputIndex++
				) {
					for (const inputData of (workflow.connectionsByDestinationNode[connectionData.node].main[
						inputIndex
					] ?? [])) {
						if (inputData.node === parentNodeName) continue;

						const executionStackNodes =
							this.runExecutionData.executionData.nodeExecutionStack.map(
								(stackData) => stackData.node.name,
							);

						if (inputData.node !== parentNodeName && checkOutputNodes.includes(inputData.node)) {
							if (
								!this.incomingConnectionIsEmpty(
									this.runExecutionData.resultData.runData,
									workflow.connectionsByDestinationNode[inputData.node].main[0] ?? [],
									runIndex,
								)
							) {
								continue;
							}
						}

						if (executionStackNodes.includes(inputData.node)) continue;
						if (this.runExecutionData.resultData.runData[inputData.node] !== undefined) continue;

						if (!this.isLegacyExecutionOrder(workflow)) {
							// Do not automatically follow all incoming nodes and force them to execute
							continue;
						}

						// v0 legacy: force-execute unexecuted ancestor chains
						const parentNodes = workflow.getParentNodes(inputData.node, 'main', -1);
						let nodeToAdd = inputData.node;
						parentNodes.push(inputData.node);
						parentNodes.reverse();

						for (const parentNode of parentNodes) {
							if (inputData.node !== parentNode && checkOutputNodes.includes(parentNode)) {
								nodeToAdd = undefined;
								break;
							}
							if (executionStackNodes.includes(parentNode)) {
								nodeToAdd = undefined;
								break;
							}
							if (this.runExecutionData.resultData.runData[parentNode] !== undefined) {
								break;
							}
							nodeToAdd = parentNode;
						}

						const parentNodesNodeToAdd = nodeToAdd !== undefined ? workflow.getParentNodes(nodeToAdd) : [];
						if (
							nodeToAdd !== undefined &&
							parentNodesNodeToAdd.includes(parentNodeName) &&
							nodeSuccessData[outputIndex].length === 0
						) {
							nodeToAdd = undefined;
						}

						if (nodeToAdd === undefined) continue;

						let addEmptyItem = false;
						if (workflow.connectionsByDestinationNode[nodeToAdd] === undefined) {
							addEmptyItem = true;
						} else if (
							this.incomingConnectionIsEmpty(
								this.runExecutionData.resultData.runData,
								workflow.connectionsByDestinationNode[nodeToAdd].main[0] ?? [],
								runIndex,
							)
						) {
							addEmptyItem = true;
						}

						if (addEmptyItem) {
							this.runExecutionData.executionData.nodeExecutionStack[enqueueFn]({
								node: workflow.getNode(nodeToAdd),
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

		// WEX:748-770
		let connectionDataArray = getPath(
			this.runExecutionData,
			[
				'executionData',
				'waitingExecution',
				connectionData.node,
				waitingNodeIndex,
				'main',
			],
			null,
		);

		if (connectionDataArray === null) {
			connectionDataArray = [];
			for (let i = connectionData.index; i >= 0; i--) {
				connectionDataArray[i] = null;
			}
		}

		if (nodeSuccessData === null) {
			connectionDataArray[connectionData.index] = null;
		} else {
			connectionDataArray[connectionData.index] = nodeSuccessData[outputIndex];
		}

		if (stillDataMissing) {
			waitingNodeIndex = waitingNodeIndex;
			const waitingExecutionSource =
				this.runExecutionData.executionData.waitingExecutionSource[connectionData.node][
					waitingNodeIndex
				].main;

			this.prepareWaitingToExecution(
				connectionData.node,
				workflow.connectionsByDestinationNode[connectionData.node].main.length,
				waitingNodeIndex,
			);

			this.runExecutionData.executionData.waitingExecution[connectionData.node][waitingNodeIndex] = {
				main: connectionDataArray,
			};
			this.runExecutionData.executionData.waitingExecutionSource[connectionData.node][
				waitingNodeIndex
			].main = waitingExecutionSource;
		} else if (workflow.nodes[connectionData.node]) {
			this.runExecutionData.executionData.nodeExecutionStack[enqueueFn]({
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
		}
	}

	// WEX:911-921
	handleDisabledNode(inputData) {
		if (Object.hasOwn(inputData, 'main') && inputData.main.length > 0) {
			if (inputData.main[0] === null) {
				return { data: undefined };
			}
			return { data: [inputData.main[0]] };
		}
		return { data: undefined };
	}

	// WEX:922-955
	prepareConnectionInputData(workflow, nodeType, customOperation, inputData) {
		if (nodeType.execute || customOperation || (!nodeType.poll && !nodeType.trigger && !nodeType.webhook)) {
			if (!inputData.main?.length) {
				return null;
			}
			let connectionInputData = inputData.main[0];

			const forceInputNodeExecution = workflow.settings.executionOrder !== 'v1';
			if (!forceInputNodeExecution) {
				for (const mainData of inputData.main) {
					if (mainData?.length) {
						connectionInputData = mainData;
						break;
					}
				}
			}

			if (!connectionInputData || connectionInputData.length === 0) {
				return null;
			}
			return connectionInputData;
		}
		return [];
	}

	// WEX:966-989
	rethrowLastNodeError(runExecutionData, node) {
		if (
			runExecutionData.resultData.lastNodeExecuted === node.name &&
			runExecutionData.resultData.error !== undefined
		) {
			if (
				runExecutionData.resultData.error.name === 'NodeOperationError' ||
				runExecutionData.resultData.error.name === 'NodeApiError'
			) {
				throw runExecutionData.resultData.error;
			}
			const error = new Error(runExecutionData.resultData.error.message);
			error.stack = runExecutionData.resultData.error.stack;
			throw error;
		}
	}

	// WEX:990-1003
	handleExecuteOnce(node, inputData) {
		if (node.executeOnce === true) {
			const newInputData = {};
			for (const connectionType of Object.keys(inputData)) {
				newInputData[connectionType] = inputData[connectionType].map((input) => {
					return input && input.slice(0, 1);
				});
			}
			return newInputData;
		}
		return inputData;
	}

	// WEX:1004-1077 — with minimal ExecuteContext (see file header)
	async executeNode(
		workflow,
		node,
		nodeType,
		_additionalData,
		mode,
		runExecutionData,
		runIndex,
		connectionInputData,
		inputData,
		executionData,
		abortSignal,
		subNodeExecutionResults,
	) {
		const closeFunctions = [];
		const context = new ExecuteContext(
			workflow,
			node,
			this.additionalData,
			mode,
			runExecutionData,
			runIndex,
			connectionInputData,
			inputData,
			executionData,
			closeFunctions,
			abortSignal,
			subNodeExecutionResults,
		);

		const data = await nodeType.execute.call(context, subNodeExecutionResults);

		// reference WEX:1059-1061: engine requests are returned UNWRAPPED so the
		// loop's isEngineRequest check sees them directly
		if (isEngineRequest(data)) {
			return data;
		}

		const closeFunctionsResults = await Promise.allSettled(
			closeFunctions.map(async (fn) => await fn()),
		);
		const closingErrors = closeFunctionsResults
			.filter((result) => result.status === 'rejected')
			.map((result) => result.reason);
		if (closingErrors.length > 0) {
			if (closingErrors[0] instanceof Error) throw closingErrors[0];
			throw new Error("Error on execution node's close function(s)");
		}

		return { data, hints: context.hints };
	}

	// WEX:1078-1097
	async executePollNode(_workflow, node, nodeType, _additionalData, mode, inputData) {
		if (mode === 'manual') {
			return { data: await nodeType.poll() };
		}
		return { data: inputData.main };
	}

	// WEX:1098-1150 — reduced: no TriggersAndPollers service; manual trigger
	// nodes register a manualTriggerFunction-like behavior via nodeType.trigger.
	async executeTriggerNode(_workflow, node, _nodeType, _additionalData, mode, inputData, abortSignal) {
		if (mode === 'manual') {
			const manualTriggerFunction = node.manualTriggerFunction;
			if (typeof manualTriggerFunction === 'function') {
				await manualTriggerFunction(abortSignal);
			}
			return { data: inputData.main };
		}
		return { data: inputData.main };
	}

	// WEX:1186-1284 — dispatch
	async runNode(workflow, executionData, runExecutionData, runIndex, additionalData, mode, abortSignal, subNodeExecutionResults) {
		const { node } = executionData;
		let inputData = executionData.data;

		if (node.disabled === true) {
			return this.handleDisabledNode(inputData);
		}

		const nodeType = workflow.nodeTypes.getByNameAndVersion(node.type, node.typeVersion);
		if (nodeType === undefined) {
			throw new Error(`Unknown node type: ${node.type} (node: ${node.name})`, {
				cause: { nodeTypeUnknown: true },
			});
		}

		const connectionInputData = this.prepareConnectionInputData(
			workflow,
			nodeType,
			undefined, // customOperations not reconstructed yet
			inputData,
		);

		if (connectionInputData === null) {
			return { data: undefined };
		}

		this.rethrowLastNodeError(runExecutionData, node);

		inputData = this.handleExecuteOnce(node, inputData);

		if (nodeType.execute) {
			return await this.executeNode(
				workflow,
				node,
				nodeType,
				additionalData,
				mode,
				runExecutionData,
				runIndex,
				connectionInputData,
				inputData,
				executionData,
				abortSignal,
				subNodeExecutionResults,
			);
		}

		if (nodeType.poll) {
			return await this.executePollNode(workflow, node, nodeType, additionalData, mode, inputData);
		}

		if (nodeType.trigger) {
			return await this.executeTriggerNode(workflow, node, nodeType, additionalData, mode, inputData, abortSignal);
		}

		const isDeclarativeNode = nodeType.description?.requestDefaults !== undefined;
		if (nodeType.webhook && !isDeclarativeNode) {
			// webhook data was produced by the webhook service; pass through
			return { data: inputData.main };
		}

		// Declarative routing nodes (requestDefaults) are out of PIPE-02 scope
		throw new Error(
			"Can't execute node. There is no custom operation and the node has not execute function.",
		);
	}

	// WEX:1331-1356
	setupExecution() {
		this.status = 'running';
		const { hooks } = this.additionalData;
		if (!hooks) {
			throw new Error('Failed to run workflow due to missing execution lifecycle hooks');
		}
		if (this.runExecutionData.startData === undefined) {
			this.runExecutionData.startData = {};
		}
		return { startedAt: new Date(), hooks };
	}

	// WEX:1357-1402
	handleEngineRequest({ workflow, currentNode, request, runIndex, executionData, runData }) {
		const { nodesToBeExecuted } = handleRequest({
			workflow,
			currentNode,
			request,
			runIndex,
			executionData,
			runData,
		});
		for (const nodeData of nodesToBeExecuted) {
			this.addNodeToBeExecuted(
				workflow,
				nodeData.inputConnectionData,
				nodeData.parentOutputIndex,
				nodeData.parentNode,
				nodeData.parentOutputData,
				nodeData.runIndex,
				nodeData.nodeRunIndex,
				nodeData.metadata,
			);
		}
	}

	// WEX:2315-2370
	ensureInputData(workflow, executionNode, executionData) {
		const inputConnections = workflow.connectionsByDestinationNode[executionNode.name]?.main ?? [];
		for (let connectionIndex = 0; connectionIndex < inputConnections.length; connectionIndex++) {
			const highestNodes = workflow.getHighestNode(executionNode.name, connectionIndex);
			if (highestNodes.length === 0) {
				// no valid incoming node (all disabled) → execute anyway without data
				return true;
			}
			if (!Object.hasOwn(executionData.data, 'main')) {
				this.runExecutionData.executionData.nodeExecutionStack.push(executionData);
				return false;
			}
			if (this.isLegacyExecutionOrder(workflow)) {
				if (
					executionData.data.main.length < connectionIndex ||
					executionData.data.main[connectionIndex] === null
				) {
					this.runExecutionData.executionData.nodeExecutionStack.push(executionData);
					return false;
				}
			}
		}
		return true;
	}

	// WEX:2463-2580 — reduced port: no WorkflowDataProxy; items with error shapes
	// are collected onto the last (error) output, merged with paired item json when
	// trivially resolvable from the source run data.
	handleNodeErrorOutput(workflow, executionData, nodeSuccessData, runIndex) {
		const nodeType = workflow.nodeTypes.getByNameAndVersion(
			executionData.node.type,
			executionData.node.typeVersion,
		);
		const outputs = nodeType.description?.outputs ?? ['main'];
		const mainOutputTypes = outputs.filter((output) => output === 'main');

		const errorItems = [];
		// Loop over all outputs except the error output
		for (let outputIndex = 0; outputIndex < mainOutputTypes.length - 1; outputIndex++) {
			const successItems = [];
			const items = nodeSuccessData[outputIndex]?.length ? [...nodeSuccessData[outputIndex]] : [];

			while (items.length) {
				const item = items.shift();
				if (item === undefined) continue;

				let errorData;
				if (item.error) {
					errorData = item.error;
				} else if (item.json.error && Object.keys(item.json).length === 1) {
					errorData = item.json.error;
				} else if (item.json.error && item.json.message && Object.keys(item.json).length === 2) {
					errorData = item.json.error;
				}

				if (errorData) {
					const pairedItemData =
						item.pairedItem && typeof item.pairedItem === 'object'
							? Array.isArray(item.pairedItem)
								? item.pairedItem[0]
								: item.pairedItem
							: undefined;

					if (executionData.source === null || pairedItemData === undefined) {
						errorItems.push(item);
					} else {
						// resolve paired item json directly from source run data
						const pairedItemInputIndex = pairedItemData.input || 0;
						const sourceData = executionData.source.main?.[pairedItemInputIndex];
						let constPairedItem = null;
						if (sourceData?.previousNode) {
							const sourceRun = this.runExecutionData.resultData.runData[sourceData.previousNode];
							const sourceTask = sourceRun?.[sourceData.previousNodeRun ?? 0];
							const sourceItems = sourceTask?.data?.main?.[sourceData.previousNodeOutput ?? 0];
							constPairedItem = sourceItems?.[pairedItemData.item ?? 0] ?? null;
						}
						if (constPairedItem === null) {
							errorItems.push(item);
						} else {
							errorItems.push({ ...item, json: { ...constPairedItem.json, ...item.json } });
						}
					}
				} else {
					successItems.push(item);
				}
			}
			nodeSuccessData[outputIndex] = successItems;
		}
		nodeSuccessData[mainOutputTypes.length - 1] = errorItems;
	}

	// WEX:2581-2640 — 1:1
	assignPairedItems(nodeSuccessData, executionData) {
		if (nodeSuccessData?.length) {
			const isSingleInputAndOutput =
				executionData.data.main.length === 1 && executionData.data.main[0]?.length === 1;

			const isSameNumberOfItems =
				nodeSuccessData.length === 1 &&
				executionData.data.main.length === 1 &&
				executionData.data.main[0]?.length === nodeSuccessData[0].length;

			const isSingleOutput =
				nodeSuccessData.length === 1 &&
				nodeSuccessData[0]?.length === 1 &&
				executionData.data.main.length === 1 &&
				(executionData.data.main[0]?.length ?? 0) > 1;

			checkOutputData: for (const outputData of nodeSuccessData) {
				if (outputData === null) continue;
				for (const [index, item] of outputData.entries()) {
					if (item.pairedItem === undefined) {
						if (isSingleInputAndOutput) {
							item.pairedItem = { item: 0 };
						} else if (isSameNumberOfItems) {
							item.pairedItem = { item: index };
						} else if (isSingleOutput) {
							item.pairedItem = { item: 0 };
						} else {
							break checkOutputData;
						}
					}
				}
			}
		}
		return nodeSuccessData ?? null;
	}

	// WEX:2452-2462
	getFullRunData(startedAt, stoppedAt) {
		return {
			data: this.runExecutionData,
			mode: this.mode,
			startedAt,
			stoppedAt: stoppedAt ?? new Date(),
			storedAt: this.storedAt,
			status: this.status,
		};
	}

	// WEX:2371-2451
	async processSuccessExecution(startedAt, workflow, executionError, closeFunction) {
		if (executionError !== undefined) {
			if (
				executionError.message?.includes('canceled') ||
				executionError.name?.includes('Cancelled')
			) {
				this.status = 'canceled';
			} else {
				this.status = 'error';
			}
		} else if (this.runExecutionData.waitTill) {
			this.status = 'waiting';
		} else {
			this.status = 'success';
		}

		let newStaticData;
		if (workflow.staticData.__dataChanged === true) {
			newStaticData = workflow.staticData;
		}

		this.moveNodeMetadata();

		if (closeFunction) {
			try {
				await closeFunction;
			} catch (error) {
				this.logger.error(
					`There was a problem deactivating trigger of workflow "${workflow.id}": "${error.message}"`,
					{ workflowId: workflow.id },
				);
			}
		}

		const stoppedAt = new Date();
		const fullRunData = this.getFullRunData(startedAt, stoppedAt);

		if (executionError !== undefined) {
			fullRunData.data.resultData.error = {
				...executionError,
				message: executionError.message,
				stack: executionError.stack,
			};
		} else if (this.runExecutionData.waitTill) {
			fullRunData.waitTill = this.runExecutionData.waitTill;
		} else {
			fullRunData.finished = true;
		}

		if (!this.isCancelled) {
			await this.additionalData.hooks?.runHook('workflowExecuteAfter', [fullRunData, newStaticData]);
		}

		return fullRunData;
	}

	/**
	 * WEX:1403-2314 — THE EXECUTION LOOP. 1:1 port.
	 * PCancelable in the reference; cancellation is exposed via cancel().
	 */
	processRunExecutionData(workflow) {
		const { startedAt, hooks } = this.setupExecution();
		this.checkForWorkflowIssues(workflow);
		this.handleWaitingState(workflow);

		let executionData;
		let subNodeExecutionResults = { actionResponses: [], metadata: {} };
		let executionError;
		let executionNode;
		let runIndex;
		let currentExecutionTry = '';
		let lastExecutionTry = '';
		let closeFunction;

		const executionPromise = (async () => {
			try {
				// establishExecutionContext + workflowExecuteBefore/Resume (WEX:1438-1465)
				if (!this.additionalData.restartExecutionId) {
					await hooks.runHook('workflowExecuteBefore', [workflow, this.runExecutionData]);
				} else {
					await hooks.runHook('workflowExecuteResume', [workflow, this.runExecutionData]);
				}
			} catch (error) {
				executionError = { ...error, message: error.message, stack: error.stack };
				executionData = this.runExecutionData.executionData.nodeExecutionStack[0];
				const taskData = {
					startTime: Date.now(),
					executionIndex: 0,
					executionTime: 0,
					data: { main: executionData.data.main },
					source: [],
					executionStatus: 'error',
					hints: [],
				};
				this.runExecutionData.resultData = {
					runData: { [executionData.node.name]: [taskData] },
					lastNodeExecuted: executionData.node.name,
					error: executionError,
				};
				throw error;
			}

			executionLoop: while (this.runExecutionData.executionData.nodeExecutionStack.length !== 0) {
				if (
					this.additionalData.executionTimeoutTimestamp !== undefined &&
					Date.now() >= this.additionalData.executionTimeoutTimestamp
				) {
					this.status = 'canceled';
					this.timedOut = true;
				}

				if (this.status === 'canceled') {
					return;
				}

				subNodeExecutionResults = { actionResponses: [], metadata: {} };

				let nodeSuccessData = null;
				executionError = undefined;
				executionData = this.runExecutionData.executionData.nodeExecutionStack.shift();
				executionNode = executionData.node;

				const taskStartedData = {
					startTime: Date.now(),
					executionIndex: this.additionalData.currentNodeExecutionIndex++,
					source: !executionData.source ? [] : executionData.source.main,
					hints: [],
				};

				// pairedItem pre-assignment (WEX:1514-1552)
				const newTaskDataConnections = {};
				for (const connectionType of Object.keys(executionData.data)) {
					newTaskDataConnections[connectionType] = executionData.data[connectionType].map(
						(input, inputIndex) => {
							if (input === null) return input;
							return input.map((item, itemIndex) => {
								const sourceOverwrite = resolveSourceOverwrite(item, executionData);
								if (sourceOverwrite) {
									return {
										...item,
										pairedItem: {
											item: itemIndex,
											input: inputIndex || undefined,
											sourceOverwrite,
										},
									};
								}
								return {
									...item,
									pairedItem: { item: itemIndex, input: inputIndex || undefined },
								};
							});
						},
					);
				}
				executionData.data = newTaskDataConnections;

				// runIndex (WEX:1554-1560)
				runIndex = 0;
				if (executionData.runIndex !== undefined) {
					runIndex = executionData.runIndex;
				} else if (Object.hasOwn(this.runExecutionData.resultData.runData, executionNode.name)) {
					runIndex = this.runExecutionData.resultData.runData[executionNode.name].length;
				}

				// endless loop guard (WEX:1562-1568)
				currentExecutionTry = `${executionNode.name}:${runIndex}`;
				if (currentExecutionTry === lastExecutionTry) {
					throw new Error('Stopped execution because it seems to be in an endless loops');
				}

				// runNodeFilter (WEX:1570-1580)
				if (
					this.runExecutionData.startData.runNodeFilter !== undefined &&
					this.runExecutionData.startData.runNodeFilter.indexOf(executionNode.name) === -1
				) {
					continue;
				}

				// ensureInputData (WEX:1582-1587)
				const hasInputData = this.ensureInputData(workflow, executionNode, executionData);
				if (!hasInputData) {
					lastExecutionTry = currentExecutionTry;
					continue executionLoop;
				}

				// nodeExecuteBefore (WEX:1590-1614)
				if (!executionData.metadata?.nodeWasResumed) {
					await hooks.runHook('nodeExecuteBefore', [executionNode.name, taskStartedData]);
				}

				// retry policy (WEX:1615-1631)
				let maxTries = 1;
				if (executionData.node.retryOnFail === true) {
					maxTries = Math.min(5, Math.max(2, executionData.node.maxTries || 3));
				}
				let waitBetweenTries = 0;
				if (executionData.node.retryOnFail === true) {
					waitBetweenTries = Math.min(5000, Math.max(0, executionData.node.waitBetweenTries || 1000));
				}

				for (let tryIndex = 0; tryIndex < maxTries; tryIndex++) {
					try {
						if (tryIndex !== 0) {
							executionError = undefined;
							if (waitBetweenTries !== 0) {
								await sleep(waitBetweenTries);
							}
						}

						const { pinData } = this.runExecutionData.resultData;

						if (pinData && !executionNode.disabled && pinData[executionNode.name] !== undefined) {
							const nodePinData = pinData[executionNode.name];
							nodeSuccessData = [nodePinData]; // always zeroth runIndex
						} else {
							if (executionData.metadata?.subNodeExecutionData) {
								subNodeExecutionResults.metadata =
									executionData.metadata.subNodeExecutionData.metadata;
								for (const subNode of executionData.metadata.subNodeExecutionData.actions) {
									const nodeRunData = this.runExecutionData.resultData.runData[subNode.nodeName];
									if (nodeRunData && nodeRunData[subNode.runIndex]) {
										const data = nodeRunData[subNode.runIndex];
										subNodeExecutionResults.actionResponses.push({
											data,
											action: subNode.action,
										});
									}
								}
							}

							let runNodeData = await this.runNode(
								workflow,
								executionData,
								this.runExecutionData,
								runIndex,
								this.additionalData,
								this.mode,
								this.abortController.signal,
								subNodeExecutionResults,
							);

							let nodeFailed =
								!isEngineRequest(runNodeData) && runNodeData.data?.[0]?.[0]?.json?.error !== undefined;

							while (nodeFailed && tryIndex !== maxTries - 1) {
								await sleep(waitBetweenTries);
								runNodeData = await this.runNode(
									workflow,
									executionData,
									this.runExecutionData,
									runIndex,
									this.additionalData,
									this.mode,
									this.abortController.signal,
									subNodeExecutionResults,
								);
								nodeFailed =
									!isEngineRequest(runNodeData) &&
									runNodeData.data?.[0]?.[0]?.json?.error !== undefined;
								tryIndex++;
							}

							if (isEngineRequest(runNodeData)) {
								this.handleEngineRequest({
									workflow,
									currentNode: executionNode,
									request: runNodeData,
									runIndex,
									executionData,
									runData: this.runExecutionData.resultData.runData,
								});
								continue executionLoop;
							}

							// convertBinaryData -> passthrough (documented deviation)
							nodeSuccessData = runNodeData.data;

							if (runNodeData.hints?.length) {
								taskStartedData.hints.push(...runNodeData.hints);
							}

							if (nodeSuccessData && executionData.node.onError === 'continueErrorOutput') {
								this.handleNodeErrorOutput(workflow, executionData, nodeSuccessData, runIndex);
							}

							if (runNodeData.closeFunction) {
								closeFunction = runNodeData.closeFunction();
							}
						}

						// success post-processing (WEX:1730-1776)
						nodeSuccessData = this.assignPairedItems(nodeSuccessData, executionData);

						if (nodeSuccessData) {
							this.runExecutionData.resultData.lastNodeExecuted = executionData.node.name;
						}

						if (!nodeSuccessData?.[0]?.[0]) {
							if (executionData.node.alwaysOutputData === true) {
								const pairedItem = [];
								executionData.data.main.forEach((inputData, inputIndex) => {
									if (!inputData) return;
									inputData.forEach((_item, itemIndex) => {
										pairedItem.push({ item: itemIndex, input: inputIndex });
									});
								});
								nodeSuccessData ??= [];
								nodeSuccessData[0] = [{ json: {}, pairedItem }];
							}
						}

						if (nodeSuccessData === null && !this.runExecutionData.waitTill) {
							// branch ends here
							continue executionLoop;
						}

						break;
					} catch (error) {
						this.runExecutionData.resultData.lastNodeExecuted = executionData.node.name;
						executionError = { ...error, message: error.message, stack: error.stack };
					}
				}

				// record run data (WEX:1800-1811)
				if (!Object.hasOwn(this.runExecutionData.resultData.runData, executionNode.name)) {
					this.runExecutionData.resultData.runData[executionNode.name] = [];
				}

				const taskData = {
					...taskStartedData,
					executionTime: Date.now() - taskStartedData.startTime,
					metadata: executionData.metadata,
					executionStatus: this.runExecutionData.waitTill ? 'waiting' : 'success',
				};

				if (executionError !== undefined) {
					taskData.error = executionError;
					taskData.executionStatus = 'error';

					await hooks.runHook('sendChunk', [
						{
							type: 'error',
							content: executionError.description,
							metadata: {
								nodeId: executionNode.id,
								nodeName: executionNode.name,
								runIndex,
								itemIndex: 0,
							},
						},
					]);

					if (
						executionData.node.continueOnFail === true ||
						['continueRegularOutput', 'continueErrorOutput'].includes(
							executionData.node.onError || '',
						)
					) {
						if (Object.hasOwn(executionData.data, 'main') && executionData.data.main.length > 0) {
							if (executionData.data.main[0] !== null) {
								nodeSuccessData = [executionData.data.main[0]];
							}
						}
					} else {
						// hard fail
						const errorRunDataExists = !!this.runExecutionData.resultData.runData[
							executionNode.name
						][runIndex];
						if (errorRunDataExists) {
							const currentTaskData =
								this.runExecutionData.resultData.runData[executionNode.name][runIndex];
							Object.assign(currentTaskData, taskData);
						} else {
							this.runExecutionData.resultData.runData[executionNode.name].push(taskData);
						}

						// re-queue for restart
						this.runExecutionData.executionData.nodeExecutionStack.unshift(executionData);

						if (!this.isCancelled) {
							await hooks.runHook('nodeExecuteAfter', [
								executionNode.name,
								taskData,
								this.runExecutionData,
							]);
						}
						break;
					}
				}

				// $error/$json merge (WEX:1899-1913)
				for (const execution of nodeSuccessData ?? []) {
					for (const lineResult of execution) {
						if (
							lineResult.json !== undefined &&
							lineResult.json.$error !== undefined &&
							lineResult.json.$json !== undefined
						) {
							lineResult.error = lineResult.json.$error;
							lineResult.json = { error: lineResult.json.$error.message };
						} else if (lineResult.error !== undefined) {
							lineResult.json = { error: lineResult.error.message };
						}
					}
				}

				// success data recording (WEX:1915-1947)
				taskData.data = { main: nodeSuccessData };

				const runDataAlreadyExists = !!this.runExecutionData.resultData.runData[executionNode.name][
					runIndex
				];
				if (runDataAlreadyExists) {
					const currentTaskData =
						this.runExecutionData.resultData.runData[executionNode.name][runIndex];
					Object.assign(currentTaskData, taskData);
				} else {
					this.runExecutionData.resultData.runData[executionNode.name].push(taskData);
				}

				if (this.runExecutionData.waitTill) {
					await hooks.runHook('nodeExecuteAfter', [
						executionNode.name,
						taskData,
						this.runExecutionData,
					]);
					this.runExecutionData.executionData.nodeExecutionStack.unshift(executionData);
					break;
				}

				if (
					this.runExecutionData?.startData?.destinationNode?.nodeName === executionNode.name
				) {
					await hooks.runHook('nodeExecuteAfter', [
						executionNode.name,
						taskData,
						this.runExecutionData,
					]);
					continue;
				}

				// output routing (WEX:1975-2057)
				if (Object.hasOwn(workflow.connectionsBySourceNode, executionNode.name)) {
					if (Object.hasOwn(workflow.connectionsBySourceNode[executionNode.name], 'main')) {
						const nodesToAdd = [];

						for (const outputIndex in workflow.connectionsBySourceNode[executionNode.name].main) {
							if (
								!Object.hasOwn(
									workflow.connectionsBySourceNode[executionNode.name].main,
									outputIndex,
								)
							) {
								continue;
							}

							for (const connectionData of (workflow.connectionsBySourceNode[executionNode.name]
								.main[outputIndex] ?? [])) {
								if (!Object.hasOwn(workflow.nodes, connectionData.node)) {
									throw new Error('Destination node not found', {
										cause: {
											sourceNodeName: executionNode.name,
											destinationNodeName: connectionData.node,
										},
									});
								}

								if (
									nodeSuccessData[outputIndex] &&
									(nodeSuccessData[outputIndex].length !== 0 ||
										(connectionData.index > 0 && this.isLegacyExecutionOrder(workflow)))
								) {
									if (workflow.settings.executionOrder === 'v1') {
										const nodeToAdd = workflow.getNode(connectionData.node);
										nodesToAdd.push({
											position: nodeToAdd?.position || [0, 0],
											connection: connectionData,
											outputIndex: parseInt(outputIndex, 10),
										});
									} else {
										this.addNodeToBeExecuted(
											workflow,
											connectionData,
											parseInt(outputIndex, 10),
											executionNode.name,
											nodeSuccessData,
											runIndex,
										);
									}
								}
							}
						}

						if (workflow.settings.executionOrder === 'v1') {
							// Always execute the node that is more to the top-left first
							nodesToAdd.sort((a, b) => {
								if (a.position[1] < b.position[1]) return 1;
								if (a.position[1] > b.position[1]) return -1;
								if (a.position[0] > b.position[0]) return -1;
								return 0;
							});

							for (const nodeData of nodesToAdd) {
								this.addNodeToBeExecuted(
									workflow,
									nodeData.connection,
									nodeData.outputIndex,
									executionNode.name,
									nodeSuccessData,
									runIndex,
								);
							}
						}
					}
				}

				await hooks.runHook('nodeExecuteAfter', [
					executionNode.name,
					taskData,
					this.runExecutionData,
				]);

				// waiting-nodes drain (WEX:2069-2245)
				let waitingNodes = Object.keys(this.runExecutionData.executionData.waitingExecution);

				if (this.runExecutionData.executionData.nodeExecutionStack.length === 0 && waitingNodes.length) {
					for (let i = 0; i < waitingNodes.length; i++) {
						const nodeName = waitingNodes[i];

						const checkNode = workflow.getNode(nodeName);
						if (!checkNode) continue;
						const nodeType = workflow.nodeTypes.getByNameAndVersion(
							checkNode.type,
							checkNode.typeVersion,
						);

						let requiredInputs =
							workflow.settings.executionOrder === 'v1'
								? nodeType?.description?.requiredInputs
								: undefined;
						if (requiredInputs !== undefined) {
							if (typeof requiredInputs === 'string') {
								// literal JSON only (expression engine is PIPE-13)
								try {
									requiredInputs = JSON.parse(requiredInputs);
								} catch {
									requiredInputs = undefined;
								}
							}
							if (
								(requiredInputs !== undefined &&
									Array.isArray(requiredInputs) &&
									requiredInputs.length === nodeType.description.inputs.length) ||
								requiredInputs === nodeType.description.inputs.length
							) {
								continue;
							}
						}

						const parentNodes = workflow.getParentNodes(nodeName);
						const parentIsWaiting = parentNodes.some((value) => waitingNodes.includes(value));
						if (parentIsWaiting) continue;

						const runIndexes = Object.keys(
							this.runExecutionData.executionData.waitingExecution[nodeName],
						).sort();
						const firstRunIndex = parseInt(runIndexes[0]);

						const inputsWithData = this.runExecutionData.executionData.waitingExecution[
							nodeName
						][firstRunIndex].main
							.map((data, index) => (data === null ? null : index))
							.filter((data) => data !== null);

						if (requiredInputs !== undefined) {
							if (Array.isArray(requiredInputs)) {
								let inputDataMissing = false;
								for (const requiredInput of requiredInputs) {
									if (!inputsWithData.includes(requiredInput)) {
										inputDataMissing = true;
										break;
									}
								}
								if (inputDataMissing) continue;
							} else if (inputsWithData.length < requiredInputs) {
								continue;
							}
						}

						const taskDataMain = this.runExecutionData.executionData.waitingExecution[nodeName][
							firstRunIndex
						].main.map((data) => (data === null ? [] : data));

						if (taskDataMain.filter((data) => data.length).length !== 0) {
							if (taskDataMain.length < nodeType.description.inputs.length) {
								for (; taskDataMain.length < nodeType.description.inputs.length; ) {
									taskDataMain.push([]);
								}
							}

							this.runExecutionData.executionData.nodeExecutionStack.push({
								node: workflow.nodes[nodeName],
								data: { main: taskDataMain },
								source: this.runExecutionData.executionData.waitingExecutionSource[nodeName][
									firstRunIndex
								],
							});
						}

						delete this.runExecutionData.executionData.waitingExecution[nodeName][firstRunIndex];
						delete this.runExecutionData.executionData.waitingExecutionSource[nodeName][
							firstRunIndex
						];

						if (
							Object.keys(this.runExecutionData.executionData.waitingExecution[nodeName]).length ===
							0
						) {
							delete this.runExecutionData.executionData.waitingExecution[nodeName];
							delete this.runExecutionData.executionData.waitingExecutionSource[nodeName];
						}

						if (taskDataMain.filter((data) => data.length).length !== 0) {
							break;
						} else {
							waitingNodes = Object.keys(this.runExecutionData.executionData.waitingExecution);
							i = -1;
						}
					}
				}
			}

			return;
		})()
			.then(async () => {
				if (this.status === 'canceled' && executionError === undefined) {
					return await this.processSuccessExecution(
						startedAt,
						workflow,
						this.timedOut
							? new Error(`Execution cancelled because of timeout (executionId: ${this.additionalData.executionId ?? 'unknown'})`)
							: new Error(`Execution canceled (executionId: ${this.additionalData.executionId ?? 'unknown'})`),
						closeFunction,
					);
				}
				return await this.processSuccessExecution(startedAt, workflow, executionError, closeFunction);
			})
			.catch(async (error) => {
				const fullRunData = this.getFullRunData(startedAt);
				fullRunData.data.resultData.error = { ...error, message: error.message, stack: error.stack };

				let newStaticData;
				if (workflow.staticData.__dataChanged === true) {
					newStaticData = workflow.staticData;
				}

				this.moveNodeMetadata();

				await hooks
					.runHook('workflowExecuteAfter', [fullRunData, newStaticData])
					.catch((hookError) => {
						console.error('There was a problem running hook "workflowExecuteAfter"', hookError);
					});

				if (closeFunction) {
					try {
						await closeFunction;
					} catch (errorClose) {
						this.logger.error(
							`There was a problem deactivating trigger of workflow "${workflow.id}": "${errorClose.message}"`,
							{ workflowId: workflow.id },
						);
					}
				}

				return fullRunData;
			});

		// PCancelable replacement: cancel() mirrors the reference onCancel block (WEX:1423-1436)
		executionPromise.cancel = () => {
			if (this.status === 'canceled' || this.status === 'error' || this.status === 'success') return;
			this._cancelRequested = true;
			this.status = 'canceled';
			this.updateTaskStatusesToCancelled();
			this.abortController.abort();
			const fullRunData = this.getFullRunData(startedAt);
			void hooks.runHook('workflowExecuteAfter', [fullRunData]);
		};

		return executionPromise;
	}
}

export { createRunExecutionData };
