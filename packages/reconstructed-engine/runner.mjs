/**
 * Reconstructed n8n Workflow Execution Engine (Node.js / ESM).
 *
 * PROJECT_RULES.md rule 1 (ZERO RUST): the reconstruction is JavaScript / TypeScript,
 * 1:1 from the n8n 2.9.4 source. Every behaviour below was read off `reference/n8n` and
 * carries its source location inline — nothing here is guessed.
 *
 * Source of truth — n8n 2.9.4 (upstream `b6dc2787c45677a29a9612cd27eb911302961a83`):
 *   reference/n8n/packages/core/src/execution-engine/workflow-execute.ts
 *     :157-171   initial nodeExecutionStack; default start data = { main: [[{ json: {} }]] }
 *     :189-191   `isLegacyExecutionOrder` → settings.executionOrder !== 'v1' ('v1' is the default)
 *     :405-560   addNodeToBeExecuted(): fan-in — a node with >1 input SLOT waits in
 *                waitingExecution until every slot has data, then is enqueued exactly ONCE
 *     :417       enqueueFn = executionOrder === 'v1' ? 'unshift' : 'push'
 *     :387-403   prepareWaitingToExecution(): one `null` per input slot
 *     :1823-1900 error path: taskData.executionStatus = 'error' + taskData.error;
 *                continueOnFail / onError ∈ {continueRegularOutput, continueErrorOutput} passes the
 *                INPUT through and keeps going, otherwise runData.push + stack.unshift + break
 *     :1918-1945 success path: taskData.data = { main: nodeSuccessData }; runData[name].push(taskData)
 *     :2079-2130 stack drained but waiting nodes remain → run them with [] for the missing inputs
 *     :2383-2400 final status: 'error' when executionError is set, otherwise 'success'
 *   reference/n8n/packages/workflow/src/common/map-connections-by-destination.ts:5-49
 *   reference/n8n/packages/workflow/src/interfaces.ts:2675-2691  ITaskStartedData / ITaskData
 *   reference/n8n/packages/workflow/src/execution-status.ts:1-11 ExecutionStatusList
 *
 * Deliberately NOT reconstructed (named so nobody assumes it is there):
 *   - expressions `{{ … }}`, credentials, pin data, wait/resume (`waitTill`), sub-workflows,
 *     AI/routing nodes, execution timeout, `requiredInputs` (needs node type descriptions).
 *   - Cycle REJECTION. n8n refuses cyclic graphs at validation time (Validation LEGO —
 *     contracts/validation.contract.md §CycleDetection). This engine still needs a local
 *     safety net so a graph that slipped through cannot hang the process: see maxExecutionsFor().
 */

const MAIN = 'main';

/**
 * 1:1 port of `common/map-connections-by-destination.ts:5-49`.
 * Inverts the by-source connection map into a by-destination map, padding missing input
 * indexes with empty arrays so `array.length` == the number of input slots of that node.
 */
export function mapConnectionsByDestination(connections) {
	const returnConnection = {};

	for (const sourceNode in connections) {
		for (const type of Object.keys(connections[sourceNode] ?? {})) {
			for (const inputIndex in connections[sourceNode][type]) {
				for (const connectionInfo of connections[sourceNode][type][inputIndex] ?? []) {
					returnConnection[connectionInfo.node] ??= {};
					returnConnection[connectionInfo.node][connectionInfo.type] ??= [];

					const bucket = returnConnection[connectionInfo.node][connectionInfo.type];
					const maxIndex = bucket.length - 1;
					for (let j = maxIndex; j < connectionInfo.index; j++) {
						bucket.push([]);
					}

					bucket[connectionInfo.index]?.push({
						node: sourceNode,
						type,
						index: parseInt(inputIndex, 10),
					});
				}
			}
		}
	}

	return returnConnection;
}

/** Loose compatibility shim for the start payload: wrap plain objects as n8n items. */
function normalizeItems(list) {
	return (list ?? []).map((entry) =>
		entry && typeof entry === 'object' && 'json' in entry ? entry : { json: entry },
	);
}

export class WorkflowExecutionEngine {
	constructor(workflowDefinition = {}) {
		this.definition = workflowDefinition;
		this.nodes = new Map();
		for (const node of workflowDefinition.nodes ?? []) {
			this.nodes.set(node.name, node);
		}
		/** IConnections keyed by SOURCE node — the shape a workflow file stores. */
		this.connections = workflowDefinition.connections ?? {};
		/** IConnections keyed by DESTINATION node (workflow.ts:147). */
		this.connectionsByDestinationNode = mapConnectionsByDestination(this.connections);
		this.settings = workflowDefinition.settings ?? {};
		this.nodeTypes = new Map();
	}

	registerNodeType(typeName, handler) {
		this.nodeTypes.set(typeName, handler);
	}

	/** `workflow-execute.ts:421-423` — number of input SLOTS, not number of incoming edges. */
	numberOfInputs(nodeName) {
		return this.connectionsByDestinationNode[nodeName]?.[MAIN]?.length ?? 0;
	}

	/** `workflow-execute.ts:189-191` — 'v1' is the default in 2.9.4. */
	get executionOrder() {
		return this.settings.executionOrder ?? 'v1';
	}

	/**
	 * SAFETY NET, not n8n behaviour. n8n assumes an acyclic graph because the Validation
	 * LEGO rejects cycles before execution; a naive BFS on a cyclic graph here never
	 * terminates and, being synchronous, starves the event loop so no watchdog can fire.
	 * Bound: a node may run at most once per input slot (1 for single-input nodes), which
	 * guarantees termination (total runs ≤ Σ max(1, inputs)) without ever firing on a
	 * linear, fan-out or diamond graph — those execute each node exactly once.
	 */
	maxExecutionsFor(nodeName) {
		return Math.max(1, this.numberOfInputs(nodeName));
	}

	/** Direct predecessors of a node, from the by-destination map. */
	predecessors(nodeName) {
		const slots = this.connectionsByDestinationNode[nodeName]?.[MAIN] ?? [];
		return slots.flat().map((c) => c.node);
	}

	/** `workflow-execute.ts:387-403` — one `null` per input slot. */
	prepareWaitingToExecution(waiting, waitingSource, nodeName, numberOfConnections, runIndex) {
		waiting[nodeName] ??= [];
		waitingSource[nodeName] ??= [];
		waiting[nodeName][runIndex] = { main: [] };
		waitingSource[nodeName][runIndex] = { main: [] };
		for (let i = 0; i < numberOfConnections; i++) {
			waiting[nodeName][runIndex].main.push(null);
			waitingSource[nodeName][runIndex].main.push(null);
		}
	}

	/**
	 * `workflow-execute.ts:405-560` (reduced to `main` connections).
	 * A node with more than one input slot is NOT enqueued until every slot has data, so a
	 * merge node runs ONCE with all of its inputs — the behaviour the previous BFS lacked.
	 */
	addNodeToBeExecuted(ctx, connection, outputIndex, parentNodeName, items, runIndex) {
		const target = this.nodes.get(connection.node);
		if (!target) return; // a connection to a node that is not in the graph is ignored

		const source = { node: parentNodeName, type: MAIN, index: outputIndex };
		const numberOfInputs = this.numberOfInputs(connection.node);

		if (numberOfInputs <= 1) {
			ctx.enqueue({ node: target, data: { main: [items] }, source: { main: [source] } });
			return;
		}

		const { waiting, waitingSource } = ctx;
		waiting[connection.node] ??= {};
		waitingSource[connection.node] ??= {};

		// Reuse a waiting entry whose slot for this input is still empty (:441-462).
		let waitingNodeIndex;
		for (const index of Object.keys(waiting[connection.node])) {
			if (!waiting[connection.node][Number(index)].main[connection.index]) {
				waitingNodeIndex = Number(index);
				break;
			}
		}
		if (waitingNodeIndex === undefined) {
			waitingNodeIndex = Object.values(waiting[connection.node]).length;
			this.prepareWaitingToExecution(
				waiting,
				waitingSource,
				connection.node,
				numberOfInputs,
				waitingNodeIndex,
			);
		}

		waiting[connection.node][waitingNodeIndex].main[connection.index] = items;
		waitingSource[connection.node][waitingNodeIndex].main[connection.index] = source;

		const stillMissing = waiting[connection.node][waitingNodeIndex].main.some((d) => d === null);
		if (stillMissing) return;

		ctx.enqueue({
			node: target,
			data: { main: waiting[connection.node][waitingNodeIndex].main },
			source: waitingSource[connection.node][waitingNodeIndex],
		});
		delete waiting[connection.node][waitingNodeIndex];
		delete waitingSource[connection.node][waitingNodeIndex];
		if (Object.keys(waiting[connection.node]).length === 0) {
			delete waiting[connection.node];
			delete waitingSource[connection.node];
		}
	}

	/**
	 * `workflow-execute.ts:2079-2130` — the stack is drained but nodes are still waiting for
	 * inputs that will never arrive (e.g. the untaken branch of an IF). n8n runs them anyway,
	 * substituting `[]` for the missing inputs. Simplification: `requiredInputs` is not
	 * evaluated (it needs node type descriptions) and only DIRECT predecessors are checked
	 * for "still waiting" instead of the full ancestor set from `getParentNodes`.
	 */
	releaseWaitingNodes(ctx) {
		for (const nodeName of Object.keys(ctx.waiting)) {
			const node = this.nodes.get(nodeName);
			if (!node) continue;

			const waitingNames = Object.keys(ctx.waiting);
			if (this.predecessors(nodeName).some((p) => waitingNames.includes(p))) continue;

			const firstRunIndex = Object.keys(ctx.waiting[nodeName])[0];
			if (firstRunIndex === undefined) continue;

			const taskDataMain = ctx.waiting[nodeName][firstRunIndex].main.map((d) => (d === null ? [] : d));
			const source = ctx.waitingSource[nodeName][firstRunIndex];

			delete ctx.waiting[nodeName][firstRunIndex];
			delete ctx.waitingSource[nodeName][firstRunIndex];
			if (Object.keys(ctx.waiting[nodeName]).length === 0) {
				delete ctx.waiting[nodeName];
				delete ctx.waitingSource[nodeName];
			}

			if (taskDataMain.some((d) => d.length)) {
				ctx.enqueue({ node, data: { main: taskDataMain }, source });
				return true; // n8n releases one node per pass (:2129-2132)
			}
		}
		return false;
	}

	/** Start node: explicit argument wins, else the n8n-ish trigger heuristic. */
	findStartNode(startNodeName) {
		if (startNodeName) return startNodeName;
		for (const [name, node] of this.nodes.entries()) {
			const type = node.type ?? '';
			if (type.includes('trigger') || type.includes('Manual') || type.includes('Start')) return name;
		}
		return this.nodes.keys().next().value;
	}

	/**
	 * Execute the workflow.
	 *
	 * @param {string|null} startNodeName
	 * @param {Array<object>} initialData items for the start node (plain objects are wrapped as `{ json }`)
	 * @returns result in the n8n shape — `resultData.runData[nodeName]` is an `ITaskData[]`,
	 *          `status` is an `ExecutionStatus` (`execution-status.ts`), `resultData.error` is set
	 *          when the run stopped on a node error. `data` and `executionLog` are kept as
	 *          flat compatibility views of the same information.
	 */
	async runWorkflow(startNodeName = null, initialData = [{}]) {
		const startName = this.findStartNode(startNodeName);
		const startNode = startName ? this.nodes.get(startName) : undefined;
		if (!startNode) {
			throw new Error('No nodes found in workflow definition');
		}

		/** workflow-execute.ts:157-171 */
		const stack = [
			{ node: startNode, data: { main: [normalizeItems(initialData)] }, source: { main: [null] } },
		];
		const waiting = {};
		const waitingSource = {};
		const enqueue =
			this.executionOrder === 'v1' ? (entry) => stack.unshift(entry) : (entry) => stack.push(entry); // :417
		const ctx = { enqueue, waiting, waitingSource };

		const runData = {}; // IRunData: nodeName -> ITaskData[]
		const executionLog = [];
		const cycleSkips = [];
		const executionCounts = new Map();
		let executionIndex = 0;
		let executionError;
		let lastNodeExecuted;
		let stopped = false;

		for (;;) {
			while (stack.length > 0) {
				const executionData = stack.shift();
				const node = executionData?.node;
				if (!node) continue;

				const alreadyRun = executionCounts.get(node.name) ?? 0;
				if (alreadyRun >= this.maxExecutionsFor(node.name)) {
					cycleSkips.push({
						node: node.name,
						executions: alreadyRun,
						droppedInputs: (executionData.data?.main ?? []).map((d) => d?.length ?? 0),
					});
					continue;
				}
				executionCounts.set(node.name, alreadyRun + 1);
				const runIndex = alreadyRun;
				lastNodeExecuted = node.name;

				const inputData = executionData.data ?? { main: [] };
				const items = inputData.main?.[0] ?? [];
				const handler = this.nodeTypes.get(node.type);

				const startTime = Date.now();
				/** interfaces.ts:2675-2681 */
				const taskData = {
					startTime,
					executionIndex: executionIndex++,
					source: executionData.source ? executionData.source.main : [],
					hints: [],
				};

				let nodeSuccessData = null;
				executionError = undefined;

				try {
					const produced = handler
						? await handler(node, items, {
								inputData: inputData.main ?? [],
								source: taskData.source,
								runIndex,
							})
						: items; // unregistered node type: passthrough
					/** INodeExecutionData[][] — one entry per output index. */
					nodeSuccessData = [produced ?? []];
				} catch (error) {
					executionError = {
						name: error?.name,
						message: error?.message,
						description: error?.description,
						node: node.name,
						stack: error?.stack,
					};
				}

				taskData.executionTime = Date.now() - startTime;
				taskData.executionStatus = 'success';

				if (executionError !== undefined) {
					/** workflow-execute.ts:1824-1900 */
					taskData.error = executionError;
					taskData.executionStatus = 'error';

					const continues =
						node.continueOnFail === true ||
						['continueRegularOutput', 'continueErrorOutput'].includes(node.onError ?? '');

					if (continues) {
						// :1854-1860 — pass the node's INPUT through to the next node and keep going.
						if (Object.hasOwn(inputData, MAIN) && inputData.main.length > 0 && inputData.main[0] !== null) {
							nodeSuccessData = [inputData.main[0]];
						}
					} else {
						(runData[node.name] ??= []).push(taskData);
						executionLog.push({
							node: node.name,
							type: node.type,
							inputCount: items.length,
							outputCount: 0,
							durationMs: taskData.executionTime,
							status: 'error',
						});
						stack.unshift(executionData); // :1884 — so the node can get restarted
						stopped = true;
						break;
					}
				}

				/** workflow-execute.ts:1918-1945 */
				taskData.data = { main: nodeSuccessData };
				(runData[node.name] ??= []).push(taskData);
				executionLog.push({
					node: node.name,
					type: node.type,
					inputCount: items.length,
					outputCount: (nodeSuccessData?.[0] ?? []).length,
					durationMs: taskData.executionTime,
					status: taskData.executionStatus,
				});

				const outputs = this.connections[node.name]?.[MAIN] ?? [];
				/** workflow-execute.ts:1990-2065 */
				const nodesToAdd = [];
				outputs.forEach((outputList, outputIndex) => {
					for (const connection of outputList ?? []) {
						// :2005-2012 — n8n does NOT ignore this, it aborts the execution.
						if (!this.nodes.has(connection.node)) {
							const error = new Error('Destination node not found');
							error.name = 'ApplicationError';
							error.extra = {
								sourceNodeName: node.name,
								destinationNodeName: connection.node,
							};
							throw error;
						}

						const outputItems = nodeSuccessData?.[outputIndex];
						// :2013-2019 — follow the connection only if that output produced items
						// (legacy order also follows an empty *optional* second input).
						const legacy = this.executionOrder !== 'v1';
						if (
							!(
								outputItems &&
								(outputItems.length !== 0 || (connection.index > 0 && legacy))
							)
						) {
							continue;
						}

						if (this.executionOrder === 'v1') {
							const target = this.nodes.get(connection.node);
							nodesToAdd.push({
								position: target?.position ?? [0, 0],
								connection,
								outputIndex,
							});
						} else {
							this.addNodeToBeExecuted(ctx, connection, outputIndex, node.name, outputItems, runIndex);
						}
					}
				});

				if (this.executionOrder === 'v1') {
					// :2041-2055 — "Always execute the node that is more to the top-left first".
					// Comparator copied verbatim (note: x-equal-or-smaller falls through to 0).
					nodesToAdd.sort((a, b) => {
						if (a.position[1] < b.position[1]) return 1;
						if (a.position[1] > b.position[1]) return -1;
						if (a.position[0] > b.position[0]) return -1;
						return 0;
					});
					for (const entry of nodesToAdd) {
						this.addNodeToBeExecuted(
							ctx,
							entry.connection,
							entry.outputIndex,
							node.name,
							nodeSuccessData[entry.outputIndex],
							runIndex,
						);
					}
				}
			}

			if (stopped) break;
			if (!this.releaseWaitingNodes(ctx)) break;
		}

		/** workflow-execute.ts:2383-2400 */
		const status = executionError !== undefined ? 'error' : 'success';

		// Flat compatibility view: last run of each node, first output slot.
		const data = {};
		for (const [name, entries] of Object.entries(runData)) {
			data[name] = entries.at(-1)?.data?.main?.[0] ?? [];
		}

		return {
			status,
			finished: status === 'success',
			/** true when the safety net had to drop arrivals — the graph contains a cycle. */
			cyclic: cycleSkips.length > 0,
			cycleSkips,
			executionLog,
			data,
			resultData: { runData, lastNodeExecuted, error: executionError },
		};
	}
}
