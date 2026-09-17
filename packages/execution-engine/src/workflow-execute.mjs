/**
 * WorkflowExecute — the reconstructed core execute loop.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/core/src/execution-engine/workflow-execute.ts
 *      run()                   L123-180
 *      prepareConnectionInputData L922
 *      rethrowLastNodeError    L966
 *      handleExecuteOnce       L990
 *      executeNode             L1004
 *      runNode                 L1186
 *      handleWaitingState      L1285
 *      processRunExecutionData L1403-2315   ← the main loop
 *      ensureInputData         L2315
 *      handleNodeErrorOutput   L2463
 *      assignPairedItems       L2581
 *
 * Everything that is *not* part of the loop is delegated:
 *   - the Workflow model      → packages/workflow-lego (Phase-2 LEGO)
 *   - run data shape          → src/run-execution-data.mjs (execution-data contract)
 *   - node context/data proxy → src/node-execution-context.mjs, src/data-proxy.mjs
 *   - retry / error policy    → src/retry.mjs, src/error-handling.mjs
 *   - stack / waiting wiring  → src/execution-stack.mjs
 *
 * DELIBERATE SUBSET (documented in docs/isolation/execution.md §"Known deltas"):
 *   no cancellation/AbortController, no engine requests (AI agent pause/resume),
 *   no partial execution (`runPartialWorkflow2`), no binary data conversion, no
 *   queue mode, no hooks beyond the five lifecycle hooks the loop itself fires.
 */

import { ApplicationError, toExecutionError, isSoftFailure } from './errors.mjs';
import { createRunExecutionData } from './run-execution-data.mjs';
import { resolveRetryPolicy, sleep } from './retry.mjs';
import { buildErrorItem, errorPassThrough, mergeErrorInformation, resolveErrorStrategy, splitErrorOutputs } from './error-handling.mjs';
import { addNodeToBeExecuted, incomingConnectionIsEmpty, isLegacyExecutionOrder } from './execution-stack.mjs';
import { ExecuteContext, returnJsonArray } from './node-execution-context.mjs';
import { resolvePairedItemJson } from './data-proxy.mjs';

export const LOOP_ERRORS = Object.freeze({
	noStartNode: 'No node to start the workflow from could be found',
	endlessLoop: 'Stopped execution because it seems to be in an endless loop',
	noExecuteFunction: "Can't execute node. There is no custom operation and the node has not execute function.",
});

const NOOP_HOOKS = {
	async runHook() {},
};

export class WorkflowExecute {
	constructor(workflow, options = {}) {
		this.workflow = workflow;
		this.mode = options.mode ?? 'manual';
		this.additionalData = options.additionalData ?? {};
		this.hooks = options.hooks ?? this.additionalData.hooks ?? NOOP_HOOKS;
		this.logger = options.logger ?? { debug() {}, info() {}, warn() {}, error() {} };
		this.runExecutionData = options.runExecutionData ?? createRunExecutionData();
		this.pinData = options.pinData;
		this.status = 'new';
		this.nodeExecutionIndex = options.nodeExecutionIndex ?? 0;
		this.closeFunctions = [];
		this.contexts = [];
	}

	/**
	 * `run()` — seeds the execution stack with the start node and drives the loop.
	 * `startNodes` is the reconstruction's equivalent of upstream's optional
	 * `triggerToStartFrom` (a start node plus its data).
	 */
	async run(options = {}) {
		const { destinationNode, startNodes, additionalRunFilterNodes } = options;
		this.status = 'running';

		const startNode = options.startNode ?? this.workflow.getStartNode();
		if (startNode === undefined) {
			throw new ApplicationError(LOOP_ERRORS.noStartNode);
		}

		let runNodeFilter;
		if (destinationNode) {
			runNodeFilter = [
				...this.workflow.getParentNodes(destinationNode.nodeName),
				...this.workflow.getParentNodes(destinationNode.nodeName, 'ALL_NON_MAIN'),
			];
			if (destinationNode.mode === 'inclusive') runNodeFilter.push(destinationNode.nodeName);
			if (additionalRunFilterNodes) runNodeFilter.push(...additionalRunFilterNodes);
			runNodeFilter = [...new Set(runNodeFilter)];
		}

		const nodeExecutionStack = (startNodes ?? [{ node: startNode }]).map((entry) => ({
			node: entry.node,
			data: entry.data ?? { main: [[{ json: {} }]] },
			source: entry.source ?? null,
		}));

		this.runExecutionData = createRunExecutionData({
			...this.runExecutionData,
			startData: { destinationNode, runNodeFilter, startedAt: new Date() },
			executionData: { ...this.runExecutionData.executionData, nodeExecutionStack },
			resultData: { ...this.runExecutionData.resultData, pinData: options.pinData ?? this.pinData },
		});

		return await this.processRunExecutionData();
	}

	/** Fires `workflowExecuteBefore`, then runs the main loop. */
	async processRunExecutionData() {
		const startedAt = new Date();
		this.status = 'running';

		try {
			await this.hooks.runHook('workflowExecuteBefore', [this.workflow, this.runExecutionData]);
		} catch (error) {
			const executionError = toExecutionError(error);
			this.runExecutionData.resultData.error = executionError;
			const executionData = this.runExecutionData.executionData.nodeExecutionStack[0];
			if (executionData) {
				this.runExecutionData.resultData.runData[executionData.node.name] = [
					{
						startTime: Date.now(),
						executionIndex: 0,
						executionTime: 0,
						data: { main: executionData.data.main },
						source: [],
						executionStatus: 'error',
						error: executionError,
						hints: [],
					},
				];
			}
			return this.finishExecution(startedAt, executionError);
		}

		this.handleWaitingState();

		let executionError;
		let currentExecutionTry = '';
		let lastExecutionTry = '';
		const { pinData } = this.runExecutionData.resultData;

		mainLoop: while (this.runExecutionData.executionData.nodeExecutionStack.length !== 0) {
			let nodeSuccessData = null;
			executionError = undefined;

			const executionData = this.runExecutionData.executionData.nodeExecutionStack.shift();
			const executionNode = executionData.node;

			const taskStartedData = {
				startTime: Date.now(),
				executionIndex: this.nodeExecutionIndex++,
				source: !executionData.source ? [] : executionData.source.main,
				hints: [],
			};

			// n8n replaces the pairedItem of every input item with the position it
			// occupies in this execution (execution-data contract I3).
			executionData.data = this.assignPairedItemsToInputs(executionData.data);

			// Run index of this execution: explicit (from the stack entry) wins,
			// otherwise the number of runs already recorded for that node.
			let runIndex = executionData.runIndex ?? this.runExecutionData.resultData.runData[executionNode.name]?.length ?? 0;

			if (executionData.runIndex !== undefined) runIndex = executionData.runIndex;
			else if (Object.hasOwn(this.runExecutionData.resultData.runData, executionNode.name)) {
				runIndex = this.runExecutionData.resultData.runData[executionNode.name].length;
			} else {
				runIndex = 0;
			}

			currentExecutionTry = `${executionNode.name}:${runIndex}`;
			if (currentExecutionTry === lastExecutionTry) {
				const endlessLoopError = new ApplicationError(LOOP_ERRORS.endlessLoop);
				this.runExecutionData.resultData.error = toExecutionError(endlessLoopError);
				return this.finishExecution(startedAt, this.runExecutionData.resultData.error);
			}

			const { runNodeFilter } = this.runExecutionData.startData ?? {};
			if (runNodeFilter !== undefined && !runNodeFilter.includes(executionNode.name)) {
				// A destination node was requested: nodes outside its ancestry are skipped
				continue;
			}

			if (!this.ensureInputData(executionNode, executionData)) {
				lastExecutionTry = currentExecutionTry;
				continue;
			}

			// Upstream fires `nodeExecuteBefore` here, and skips it for resumed
			// agent nodes (`metadata.nodeWasResumed`) to avoid duplicate events.
			if (!executionData.metadata?.nodeWasResumed) {
				await this.hooks.runHook('nodeExecuteBefore', [executionNode.name, taskStartedData]);
			}

			const { maxTries, waitBetweenTries } = resolveRetryPolicy(executionNode);

			for (let tryIndex = 0; tryIndex < maxTries; tryIndex++) {
				try {
					if (tryIndex !== 0) {
						executionError = undefined;
						if (waitBetweenTries !== 0) await sleep(waitBetweenTries);
					}

					if (pinData?.[executionNode.name] !== undefined && !executionNode.disabled) {
						nodeSuccessData = [pinData[executionNode.name]];
					} else {
						nodeSuccessData = await this.runNode(executionData, runIndex);
					}

					// Soft failure: the node returned `{ json: { error } }` instead of throwing.
					let nodeFailed = isSoftFailure(nodeSuccessData);
					while (nodeFailed && tryIndex !== maxTries - 1) {
						await sleep(waitBetweenTries);
						nodeSuccessData = await this.runNode(executionData, runIndex);
						nodeFailed = isSoftFailure(nodeSuccessData);
						tryIndex++;
					}

					if (nodeSuccessData && executionNode.onError === 'continueErrorOutput') {
						this.handleNodeErrorOutput(executionData, nodeSuccessData, runIndex);
					}

					nodeSuccessData = this.assignPairedItems(nodeSuccessData, executionData);

					if (nodeSuccessData) {
						this.runExecutionData.resultData.lastNodeExecuted = executionNode.name;
					}

					if (!nodeSuccessData?.[0]?.[0] && executionNode.alwaysOutputData === true) {
						const pairedItem = [];
						(executionData.data.main ?? []).forEach((inputData, inputIndex) => {
							if (!inputData) return;
							inputData.forEach((_item, itemIndex) => {
								pairedItem.push({ item: itemIndex, input: inputIndex });
							});
						});

						nodeSuccessData ??= [];
						nodeSuccessData[0] = [{ json: {}, pairedItem }];
					}

					if (nodeSuccessData === null && !this.runExecutionData.waitTill) {
						// The node succeeded without any data: the branch ends here,
						// and upstream records no task data for it at all.
						continue mainLoop;
					}

					break;
				} catch (error) {
					this.runExecutionData.resultData.lastNodeExecuted = executionNode.name;
					executionError = toExecutionError(error);
				}
			}

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

				const { strategy } = resolveErrorStrategy(executionNode);
				if (strategy !== 'stopWorkflow') {
					const passThrough = errorPassThrough(executionData);
					nodeSuccessData = passThrough;
					nodeSuccessData?.forEach((items) =>
						items?.forEach((item) => {
							item.pairedItem ??= { item: 0 };
						}),
					);
				} else {
					// Stop the workflow: keep the failed entry on the stack so the
					// execution can be restarted from exactly this node.
					const existing = this.runExecutionData.resultData.runData[executionNode.name][runIndex];
					if (existing) Object.assign(existing, taskData);
					else this.runExecutionData.resultData.runData[executionNode.name].push(taskData);

					this.runExecutionData.resultData.error = executionError;
					this.runExecutionData.executionData.nodeExecutionStack.unshift(executionData);

					await this.hooks.runHook('nodeExecuteAfter', [executionNode.name, taskData, this.runExecutionData]);
					break mainLoop;
				}
			}

			mergeErrorInformation(nodeSuccessData);

			taskData.data = { main: nodeSuccessData };

			const runDataAlreadyExists = Boolean(this.runExecutionData.resultData.runData[executionNode.name][runIndex]);
			if (runDataAlreadyExists) {
				Object.assign(this.runExecutionData.resultData.runData[executionNode.name][runIndex], taskData);
			} else {
				this.runExecutionData.resultData.runData[executionNode.name].push(taskData);
			}

			if (this.runExecutionData.waitTill) {
				await this.hooks.runHook('nodeExecuteAfter', [executionNode.name, taskData, this.runExecutionData]);
				this.runExecutionData.executionData.nodeExecutionStack.unshift(executionData);
				break mainLoop;
			}

			if (this.runExecutionData.startData?.destinationNode?.nodeName === executionNode.name) {
				await this.hooks.runHook('nodeExecuteAfter', [executionNode.name, taskData, this.runExecutionData]);
				continue;
			}

			this.routeOutputData(executionNode, nodeSuccessData, runIndex);

			await this.hooks.runHook('nodeExecuteAfter', [executionNode.name, taskData, this.runExecutionData]);

			if (
				this.runExecutionData.executionData.nodeExecutionStack.length === 0 &&
				this.resolveWaitingNodes(runIndex)
			) {
				// Waiting nodes that are now runnable were pushed back on the stack
				continue;
			}
		}

		return this.finishExecution(startedAt, this.runExecutionData.resultData.error);
	}

	/** Push outputs of a finished node to its children (main connections). */
	routeOutputData(executionNode, nodeSuccessData, runIndex) {
		const sourceConnections = this.workflow.connectionsBySourceNode[executionNode.name];
		if (!sourceConnections || !Object.hasOwn(sourceConnections, 'main')) return;

		const legacy = isLegacyExecutionOrder(this.workflow);
		const nodesToAdd = [];

		for (const outputIndex of Object.keys(sourceConnections.main)) {
			for (const connectionData of sourceConnections.main[outputIndex] ?? []) {
				if (!Object.hasOwn(this.workflow.nodes, connectionData.node)) {
					throw new ApplicationError('Destination node not found', {
						extra: { sourceNodeName: executionNode.name, destinationNodeName: connectionData.node },
					});
				}

				const outputItems = nodeSuccessData?.[outputIndex];
				const hasData = outputItems && (outputItems.length !== 0 || (connectionData.index > 0 && legacy));
				if (!hasData) continue;

				if (!legacy) {
					this.addNodeToBeExecutedFor(connectionData, parseInt(outputIndex, 10), executionNode.name, nodeSuccessData, runIndex);
				} else {
					const nodeToAdd = this.workflow.getNode(connectionData.node);
					nodesToAdd.push({
						position: nodeToAdd?.position || [0, 0],
						connection: connectionData,
						outputIndex: parseInt(outputIndex, 10),
					});
				}
			}
		}

		if (legacy) {
			// Always execute the node that is more to the top-left first
			nodesToAdd.sort((a, b) => {
				if (a.position[1] < b.position[1]) return 1;
				if (a.position[1] > b.position[1]) return -1;
				if (a.position[0] > b.position[0]) return -1;
				return 0;
			});

			for (const nodeData of nodesToAdd) {
				this.addNodeToBeExecutedFor(
					nodeData.connection,
					nodeData.outputIndex,
					executionNode.name,
					nodeSuccessData,
					runIndex,
				);
			}
		}
	}

	addNodeToBeExecutedFor(connectionData, outputIndex, parentNodeName, nodeSuccessData, runIndex, newRunIndex, metadata) {
		return addNodeToBeExecuted({
			workflow: this.workflow,
			runExecutionData: this.runExecutionData,
			connectionData,
			outputIndex,
			parentNodeName,
			nodeSuccessData,
			runIndex,
			newRunIndex,
			metadata,
		});
	}

	/**
	 * `handleWaitingState` — a resumed execution must not run the node that put it
	 * into waiting again; its last run is removed.
	 */
	handleWaitingState() {
		if (!this.runExecutionData.waitTill) return;

		this.runExecutionData.waitTill = undefined;
		const executionStackEntry = this.runExecutionData.executionData.nodeExecutionStack[0];
		if (executionStackEntry) executionStackEntry.node.disabled = true;

		const lastNodeExecuted = this.runExecutionData.resultData.lastNodeExecuted;
		if (lastNodeExecuted && this.runExecutionData.resultData.runData[lastNodeExecuted]) {
			const runData = this.runExecutionData.resultData.runData[lastNodeExecuted];
			const lastRunIndex = runData.length - 1;
			if (lastRunIndex >= 0) runData.splice(lastRunIndex, 1);
			if (runData.length === 0) delete this.runExecutionData.resultData.runData[lastNodeExecuted];
		}
	}

	/**
	 * `runNode` — resolves what kind of node this is and dispatches. Returns
	 * `INodeExecutionData[][] | null` (null = branch ends, no task data recorded),
	 * which is what the loop consumes.
	 */
	async runNode(executionData, runIndex) {
		const { node } = executionData;

		if (node.disabled === true) return this.handleDisabledNode(executionData.data);

		const nodeType = this.workflow.nodeTypes.getByNameAndVersion(node.type, node.typeVersion);
		const customOperation = this.getCustomOperation(node, nodeType);

		const connectionInputData = this.prepareConnectionInputData(nodeType, customOperation, executionData.data);
		if (connectionInputData === null) return undefined;

		this.rethrowLastNodeError(node);

		const inputData = this.handleExecuteOnce(node, executionData.data);

		if (nodeType.execute || customOperation) {
			return await this.executeNode(node, nodeType, customOperation, connectionInputData, inputData, executionData, runIndex);
		}

		if (nodeType.poll) return await this.executePollNode(node, nodeType, inputData);
		if (nodeType.trigger) return await this.executeTriggerNode(node, nodeType, inputData);

		if (nodeType.webhook) {
			// Webhook nodes without requestDefaults simply pass the data through
			return inputData.main ?? [];
		}

		throw new ApplicationError(LOOP_ERRORS.noExecuteFunction, { extra: { nodeName: node.name } });
	}

	async executeNode(node, nodeType, customOperation, connectionInputData, inputData, executionData, runIndex) {
		const context = new ExecuteContext({
			workflow: this.workflow,
			node,
			runExecutionData: this.runExecutionData,
			runIndex,
			inputData,
			connectionInputData,
			executionData,
			mode: this.mode,
			additionalData: this.additionalData,
			closeFunctions: this.closeFunctions,
			logger: this.logger,
		});
		this.contexts.push(context);

		let data;
		if (customOperation) {
			data = await customOperation.call(context);
		} else {
			// Classic `execute(this)` and class-based `execute(context)` both work:
			// the context is the receiver *and* the first argument.
			data = await nodeType.execute.call(context, context);
		}

		return data;
	}

	async executePollNode(node, nodeType, inputData) {
		const context = new ExecuteContext({
			workflow: this.workflow,
			node,
			runExecutionData: this.runExecutionData,
			runIndex: 0,
			inputData,
			connectionInputData: inputData.main?.[0] ?? [],
			mode: this.mode,
			additionalData: this.additionalData,
			logger: this.logger,
		});

		const result = await nodeType.poll.call(context);
		if (Array.isArray(result)) return returnJsonArray(result).map((item) => [item]);
		return inputData.main ?? [];
	}

	async executeTriggerNode(node, nodeType, inputData) {
		const closeFunctions = [];
		const context = new ExecuteContext({
			workflow: this.workflow,
			node,
			runExecutionData: this.runExecutionData,
			runIndex: 0,
			inputData,
			connectionInputData: inputData.main?.[0] ?? [],
			mode: this.mode,
			additionalData: this.additionalData,
			closeFunctions,
			logger: this.logger,
		});

		if (nodeType.trigger) {
			const response = await nodeType.trigger.call(context);
			if (response?.closeFunction) closeFunctions.push(response.closeFunction);
		}

		return inputData.main ?? [];
	}

	/** A disabled node passes its input through (workflow-execute.ts L911). */
	handleDisabledNode(inputData) {
		if (Object.hasOwn(inputData, 'main') && inputData.main.length > 0) {
			return inputData.main;
		}
		return [[]];
	}

	/**
	 * `prepareConnectionInputData` — the "connectionInputData" is `main[0]` in
	 * legacy order, or the first non-empty input in v1 order; `null` means the
	 * node gets no data and must not run.
	 */
	prepareConnectionInputData(nodeType, customOperation, inputData) {
		if (nodeType.execute || customOperation || (!nodeType.poll && !nodeType.trigger && !nodeType.webhook)) {
			if (!inputData.main?.length) return null;

			let connectionInputData = inputData.main[0];

			const forceInputNodeExecution = isLegacyExecutionOrder(this.workflow);
			if (!forceInputNodeExecution) {
				for (const mainData of inputData.main) {
					if (mainData?.length) {
						connectionInputData = mainData;
						break;
					}
				}
			}

			if (!connectionInputData || connectionInputData.length === 0) return null;
			return connectionInputData;
		}

		return [];
	}

	/** `rethrowLastNodeError` — a node that already failed must fail again. */
	rethrowLastNodeError(node) {
		const { lastNodeExecuted, error } = this.runExecutionData.resultData;
		if (lastNodeExecuted === node.name && error !== undefined) {
			const rethrown = error.name === 'NodeOperationError' || error.name === 'NodeApiError'
				? Object.assign(new Error(error.message), error)
				: new Error(error.message);
			rethrown.stack = error.stack;
			throw rethrown;
		}
	}

	/** `handleExecuteOnce` — only the first item of every input is used. */
	handleExecuteOnce(node, inputData) {
		if (node.executeOnce !== true) return inputData;

		const newInputData = {};
		for (const connectionType of Object.keys(inputData)) {
			newInputData[connectionType] = inputData[connectionType].map((input) => input?.slice(0, 1));
		}
		return newInputData;
	}

	/** `getCustomOperation` — `customOperations[resource][operation]`. */
	getCustomOperation(node, nodeType) {
		if (!nodeType.customOperations) return undefined;
		if (!node.parameters && !node.forceCustomOperation) return undefined;

		const customOperations = nodeType.customOperations;
		const resource = node.parameters?.resource;
		const operation = node.parameters?.operation;
		if (typeof resource !== 'string' || typeof operation !== 'string') return undefined;
		if (!customOperations[resource] || !customOperations[resource][operation]) return undefined;

		return customOperations[resource][operation];
	}

	/** `ensureInputData` — verbatim, including the re-queue on missing data. */
	ensureInputData(executionNode, executionData) {
		const inputConnections = this.workflow.connectionsByDestinationNode[executionNode.name]?.main ?? [];

		for (let connectionIndex = 0; connectionIndex < inputConnections.length; connectionIndex++) {
			const highestNodes = this.workflow.getHighestNode(executionNode.name, connectionIndex);
			if (highestNodes.length === 0) return true;

			if (!Object.hasOwn(executionData.data, 'main')) {
				this.runExecutionData.executionData.nodeExecutionStack.push(executionData);
				return false;
			}

			if (isLegacyExecutionOrder(this.workflow)) {
				if (executionData.data.main.length < connectionIndex || executionData.data.main[connectionIndex] === null) {
					this.runExecutionData.executionData.nodeExecutionStack.push(executionData);
					return false;
				}
			}
		}

		return true;
	}

	/**
	 * After the stack drains, nodes that were waiting for a second input may be
	 * runnable if their remaining parent(s) will never run again. Upstream walks
	 * `waitingExecution` and its parents; this reconstruction checks the waiting
	 * entries whose parents all finished and promotes them.
	 */
	resolveWaitingNodes(runIndex) {
		const waitingExecution = this.runExecutionData.executionData.waitingExecution;
		const waitingNodes = Object.keys(waitingExecution ?? {});
		if (waitingNodes.length === 0) return false;

		let promoted = false;

		for (const nodeName of waitingNodes) {
			const checkNode = this.workflow.getNode(nodeName);
			if (!checkNode) continue;

			const parentNodes = this.workflow.getParentNodes(nodeName);
			const parentIsWaiting = parentNodes.some((value) => waitingNodes.includes(value));
			if (parentIsWaiting) continue;

			// A parent that did not produce data for this input cannot do so anymore
			for (const index of Object.keys(waitingExecution[nodeName]).map((value) => parseInt(value, 10))) {
				const entry = waitingExecution[nodeName][index];
				const complete = (entry.main ?? []).every((mainData) => mainData !== null && mainData !== undefined);
				const source = this.runExecutionData.executionData.waitingExecutionSource[nodeName][index];

				for (let inputIndex = 0; inputIndex < entry.main.length; inputIndex++) {
					if (entry.main[inputIndex] !== null && entry.main[inputIndex] !== undefined) continue;

					const parent = this.workflow.connectionsByDestinationNode[nodeName]?.main?.[inputIndex]?.[0]?.node;
					const parentFinished =
						parent !== undefined &&
						(this.runExecutionData.resultData.runData[parent] !== undefined || this.workflow.isNodeDisabled(parent));

					if (parentFinished) {
						entry.main[inputIndex] = [];
						source.main[inputIndex] = source.main[inputIndex] ?? null;
					}
				}

				if (!complete && entry.main.every((mainData) => mainData !== null && mainData !== undefined)) {
					this.runExecutionData.executionData.nodeExecutionStack.push({
						node: checkNode,
						data: entry,
						source: source,
					});
					delete waitingExecution[nodeName][index];
					delete this.runExecutionData.executionData.waitingExecutionSource[nodeName][index];
					promoted = true;
				}
			}

			if (Object.keys(waitingExecution[nodeName]).length === 0) {
				delete waitingExecution[nodeName];
				delete this.runExecutionData.executionData.waitingExecutionSource[nodeName];
			}
		}

		return promoted;
	}

	/** `handleNodeErrorOutput` — split success/error items onto the error output. */
	handleNodeErrorOutput(executionData, nodeSuccessData, runIndex) {
		const nodeType = this.workflow.nodeTypes.getByNameAndVersion(
			executionData.node.type,
			executionData.node.typeVersion,
		);

		const mainOutputCount = getMainOutputCount(nodeType.description);

		const context = new ExecuteContext({
			workflow: this.workflow,
			node: executionData.node,
			runExecutionData: this.runExecutionData,
			runIndex,
			inputData: executionData.data,
			connectionInputData: [],
			executionData,
			mode: this.mode,
			additionalData: this.additionalData,
			logger: this.logger,
		});
		const proxy = context.getWorkflowDataProxy(0);

		return splitErrorOutputs(nodeSuccessData, {
			mainOutputCount,
			resolvePairedItem: (_item, pairedItemData) => {
				const sourceData = executionData.source?.main?.[pairedItemData?.input ?? 0];
				return resolvePairedItemJson(proxy, sourceData, pairedItemData, { runIndex });
			},
		});
	}

	/** n8n replaces every input item's pairedItem before running a node (I3). */
	assignPairedItemsToInputs(inputData) {
		const newTaskDataConnections = {};

		for (const connectionType of Object.keys(inputData)) {
			newTaskDataConnections[connectionType] = inputData[connectionType].map((input, inputIndex) => {
				if (input === null) return input;

				return input.map((item, itemIndex) => ({
					...item,
					pairedItem: {
						item: itemIndex,
						input: inputIndex || undefined,
					},
				}));
			});
		}

		return newTaskDataConnections;
	}

	/** `assignPairedItems` — auto-fix missing pairedItem where it is unambiguous (I4/I5). */
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

	/** Builds the `{ json: { error } }` item used by continueOnFail node code. */
	buildErrorItem(error, pairedItem) {
		return buildErrorItem(error, pairedItem);
	}

	async finishExecution(startedAt, executionError) {
		if (executionError !== undefined) {
			this.status = 'error';
		} else if (this.runExecutionData.waitTill) {
			this.status = 'waiting';
		} else {
			this.status = 'success';
		}

		const run = {
			status: this.status,
			mode: this.mode,
			startedAt,
			stoppedAt: new Date(),
			finished: this.status !== 'running',
			data: this.runExecutionData,
			waitTill: this.runExecutionData.waitTill,
		};

		try {
			await this.hooks.runHook('workflowExecuteAfter', [run]);
		} catch {
			// Hook failures never change the execution result
		}

		return run;
	}

	getRunExecutionData() {
		return this.runExecutionData;
	}

	getStatus() {
		return this.status;
	}
}

/** Counts `main` outputs in a node description (`outputs` may be strings or objects). */
export function getMainOutputCount(description = {}) {
	const outputs = description.outputs ?? ['main'];
	if (typeof outputs === 'string') return outputs === 'main' ? 1 : 0;

	return outputs.filter((output) => (typeof output === 'string' ? output === 'main' : output?.type === 'main')).length;
}

export { incomingConnectionIsEmpty };
