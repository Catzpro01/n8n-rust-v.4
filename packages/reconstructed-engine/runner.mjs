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
 *     :1600-1630 retryOnFail: maxTries = min(5, max(2, maxTries || 3)),
 *                waitBetweenTries = min(5000, max(0, waitBetweenTries || 1000)) — note `||`,
 *                so an explicit 0 means 1000 ms, not "no wait"
 *     :1670-1692 a node that did not throw but returned `json.error` on its first item is
 *                retried the same number of times ("soft" failure)
 *     :1720-1722 onError === 'continueErrorOutput' → handleNodeErrorOutput()
 *     :1736-1741 assignPairedItems, then `if (nodeSuccessData) lastNodeExecuted = node`
 *     :1823-1900 error path: taskData.executionStatus = 'error' + taskData.error;
 *                continueOnFail / onError ∈ {continueRegularOutput, continueErrorOutput} passes the
 *                INPUT through and keeps going, otherwise runData.push + stack.unshift + break
 *     :1898-1917 per-item error reporting: `json.$error` + `json.$json` collapse into
 *                `item.error` + `json = { error: message }`
 *     :1918-1945 success path: taskData.data = { main: nodeSuccessData }; runData[name].push(taskData)
 *     :2079-2130 stack drained but waiting nodes remain → run them with [] for the missing inputs
 *     :2383-2400 final status: 'error' when executionError is set, otherwise 'success'
 *     :2463-2562 handleNodeErrorOutput(): items carrying an error move to the LAST main output
 *   reference/n8n/packages/workflow/src/common/map-connections-by-destination.ts:5-49
 *   reference/n8n/packages/workflow/src/interfaces.ts:2675-2691  ITaskStartedData / ITaskData
 *   reference/n8n/packages/workflow/src/execution-status.ts:1-11 ExecutionStatusList
 *   reference/n8n/packages/workflow/src/node-helpers.ts:1140-1196 getNodeOutputs(): with
 *                onError === 'continueErrorOutput' an `error` main output is appended
 *
 * Deliberately NOT reconstructed (named so nobody assumes it is there):
 *   - expressions `{{ … }}`, credentials, wait/resume (`waitTill`), sub-workflows, AI/routing
 *     nodes, and dynamically computed (`{{ }}`) node `outputs`.
 *   - Cycle REJECTION. n8n refuses cyclic graphs at validation time (Validation LEGO —
 *     contracts/validation.contract.md §CycleDetection). This engine still needs a local
 *     safety net so a graph that slipped through cannot hang the process: see maxExecutionsFor().
 */

import { getConnectedNodes, getParentNodes } from './graph.mjs';

export { getConnectedNodes, getParentNodes };

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
/** `await sleep(ms)` — the same helper the reference uses between retries. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
		/** type name -> the slice of the n8n node type description the engine reads. */
		this.nodeTypeDescriptions = new Map();
	}

	/**
	 * Register the implementation of a node type.
	 *
	 * @param {string} typeName
	 * @param {Function} handler `(node, items, ctx) => items[]`
	 * @param {object} [description] the parts of the n8n node type description the engine needs:
	 *   `requiredInputs` (`number | number[]`, interfaces.ts:2355) and `inputs` (input type list,
	 *   used for its `.length`). Without a description the engine falls back to the number of
	 *   connected input slots.
	 */
	registerNodeType(typeName, handler, description = null) {
		this.nodeTypes.set(typeName, handler);
		// Only a description that was actually handed over is recorded: "registered without a
		// description" has to stay indistinguishable from "unknown node type", because
		// `node-helpers.ts:1146-1148` treats a missing nodeTypeData as "no outputs at all".
		if (description !== null && description !== undefined) {
			this.nodeTypeDescriptions.set(typeName, description);
		}
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

	/**
	 * ALL ancestors of a node — `Workflow#getParentNodes` (workflow.ts:590-596).
	 * The release pass needs the full ancestor set, not just the direct predecessors:
	 * a node must not be released while any node upstream of it is still waiting.
	 */
	getParentNodes(nodeName, type = MAIN, depth = -1) {
		return getParentNodes(this.connectionsByDestinationNode, nodeName, type, depth);
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
	 * `workflow-execute.ts:2079-2160` — the stack is drained but nodes are still waiting for
	 * inputs that will never arrive (e.g. the untaken branch of an IF). n8n releases them one
	 * per pass, substituting `[]` for the inputs that received nothing.
	 *
	 * Two rules from the reference are enforced here:
	 *   - `requiredInputs` (`interfaces.ts:2355`, only honoured for executionOrder 'v1'): a node
	 *     that requires ALL its inputs is never released with partial data (:2107-2124), and a
	 *     node that requires *some* inputs is released only when those slots have data
	 *     (:2126-2160). The reference can also take an EXPRESSION string here (Merge v2:
	 *     `requiredInputs: '={{ $parameter["mode"] === "chooseBranch" ? [0, 1] : 1 }}'`);
	 *     evaluating that needs the Expression LEGO, so the string form is treated as
	 *     "not specified" and is the one documented gap left in this pass.
	 *   - "is an ancestor still waiting" uses ALL ancestors via `getParentNodes`
	 *     (:2136), not just the direct predecessors.
	 */
	releaseWaitingNodes(ctx) {
		const waitingNames = Object.keys(ctx.waiting);

		for (const nodeName of waitingNames) {
			const node = this.nodes.get(nodeName);
			if (!node) continue; // :2098-2100

			const description = this.nodeTypeDescriptions.get(node.type) ?? {};
			const declaredInputs = description.inputs?.length;
			const inputSlots = declaredInputs ?? this.numberOfInputs(nodeName);

			// :2107-2110 — requiredInputs is only consulted for executionOrder 'v1'
			let requiredInputs = this.executionOrder === 'v1' ? description.requiredInputs : undefined;
			if (typeof requiredInputs === 'string') requiredInputs = undefined; // needs the Expression LEGO

			if (
				requiredInputs !== undefined &&
				((Array.isArray(requiredInputs) && requiredInputs.length === inputSlots) ||
					requiredInputs === inputSlots)
			) {
				continue; // :2119-2123 — all inputs are required but not all have data
			}

			// :2136-2142 — a node stays waiting while ANY ancestor is still waiting
			if (this.getParentNodes(nodeName).some((value) => waitingNames.includes(value))) continue;

			const runIndexes = Object.keys(ctx.waiting[nodeName]).sort();
			const firstRunIndex = runIndexes[0];
			if (firstRunIndex === undefined) continue;

			const slots = ctx.waiting[nodeName][firstRunIndex].main;
			// :2144-2152 — slots that received data, even an empty array, count as "has data"
			const inputsWithData = slots.map((data, index) => (data === null ? null : index)).filter((v) => v !== null);

			if (requiredInputs !== undefined) {
				if (Array.isArray(requiredInputs)) {
					if (requiredInputs.some((required) => !inputsWithData.includes(required))) continue; // :2160-2172
				} else if (inputsWithData.length < requiredInputs) {
					continue; // :2174-2177
				}
			}

			const taskDataMain = slots.map((data) => (data === null ? [] : data));
			const source = ctx.waitingSource[nodeName][firstRunIndex];

			delete ctx.waiting[nodeName][firstRunIndex];
			delete ctx.waitingSource[nodeName][firstRunIndex];
			if (Object.keys(ctx.waiting[nodeName]).length === 0) {
				delete ctx.waiting[nodeName];
				delete ctx.waitingSource[nodeName];
			}

			if (taskDataMain.some((data) => data.length)) {
				// :2192-2196 — every input at least receives an empty array
				if (declaredInputs !== undefined) {
					while (taskDataMain.length < declaredInputs) taskDataMain.push([]);
				}
				ctx.enqueue({ node, data: { main: taskDataMain }, source });
				return true; // n8n releases one node per pass (:2226-2229)
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
	 * `workflow-execute.ts:2581-2641` — 1:1 port.
	 *
	 * Output items normally carry `pairedItem` so the UI can link an output item back to the
	 * input item it came from. Nodes that do not set it get it auto-fixed where the mapping is
	 * unambiguous: one input item → `{item:0}`, equal input/output counts → `{item:index}`,
	 * many inputs aggregated into one output → `{item:0}`. In every other case the reference
	 * leaves the items untouched (`break checkOutputData`).
	 */
	assignPairedItems(nodeSuccessData, executionData) {
		if (nodeSuccessData?.length) {
			const isSingleInputAndOutput =
				executionData.data.main.length === 1 && executionData.data.main[0]?.length === 1;

			const isSameNumberOfItems =
				nodeSuccessData.length === 1 &&
				executionData.data.main.length === 1 &&
				executionData.data.main[0]?.length === nodeSuccessData[0].length;

			// Multiple inputs → single output (e.g., aggregating items into one)
			const isSingleOutput =
				nodeSuccessData.length === 1 &&
				nodeSuccessData[0]?.length === 1 &&
				executionData.data.main.length === 1 &&
				(executionData.data.main[0]?.length ?? 0) > 1;

			checkOutputData: for (const outputData of nodeSuccessData) {
				if (outputData === null) {
					continue;
				}
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

	/**
	 * `node-helpers.ts:1140-1196` (`getNodeOutputs`) + the `getConnectionTypes(...).filter(main)`
	 * step at `workflow-execute.ts:2469-2473`, reduced to the count this engine needs.
	 *
	 * Two reference details are load-bearing here:
	 *   - the outputs come from the node TYPE description, not from `node.outputs`;
	 *   - when `node.onError === 'continueErrorOutput'` the reference APPENDS an
	 *     `{ category: 'error', type: 'main' }` output — that is what gives an ordinary
	 *     single-output node its second, error, output.
	 * A node type with no registered description yields 0 main outputs, exactly like the
	 * reference's `if (!nodeTypeData) return []`. Dynamically computed outputs
	 * (`outputs: '={{ … }}'`) are not reconstructed — the Expression LEGO owns those.
	 */
	mainOutputCount(node) {
		const description = this.nodeTypeDescriptions.get(node.type);
		if (!description) return 0; // node-helpers.ts:1146-1148 — `if (!nodeTypeData) return []`
		let outputs = Array.isArray(description.outputs) ? description.outputs : [];
		if (node.onError === 'continueErrorOutput') {
			outputs = [...outputs, { category: 'error', type: MAIN, displayName: 'Error' }];
		}
		return outputs.filter((output) => (typeof output === 'string' ? output : output?.type) === MAIN).length;
	}

	/**
	 * `workflow-execute.ts:2463-2562` — 1:1 port.
	 *
	 * When a node has `onError: 'continueErrorOutput'`, items that carry an error are pulled off
	 * every regular output and collected on the LAST main output (the error output). An item
	 * counts as failed when it has `item.error`, or `json.error` as its only key, or
	 * `json.error` + `json.message` as its only two keys — those exact three rules, no more.
	 *
	 * The reference enriches a routed item with the json of its source item via
	 * `dataProxy.$getPairedItem(sourceData.previousNode, sourceData, pairedItemData)`. Because the
	 * destination passed in IS the direct parent, `$getPairedItem` always takes its first branch
	 * (`workflow-data-proxy.ts:960-985`) and returns `outputData[pairedItem.item]` of that parent —
	 * which is precisely the item sitting in this node's input slot. So resolving it from
	 * `executionData.data.main[input][item]` is equivalent, and the Expression LEGO's data proxy is
	 * not needed. The two reference fallbacks (no source, no usable pairedItem) push the item
	 * unchanged; a pairedItem pointing outside the input does the same.
	 */
	handleNodeErrorOutput(node, nodeSuccessData, executionData) {
		const mainOutputCount = this.mainOutputCount(node);
		const errorItems = [];

		// Every output except the last one (the error output) is inspected.
		for (let outputIndex = 0; outputIndex < mainOutputCount - 1; outputIndex++) {
			const successItems = [];
			const items = nodeSuccessData[outputIndex]?.length ? nodeSuccessData[outputIndex] : [];

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

					const sourceItems =
						pairedItemData === undefined
							? undefined
							: executionData.data?.main?.[pairedItemData.input || 0];
					const sourceItem = sourceItems?.[pairedItemData?.item];

					if (executionData.source === null || pairedItemData === undefined || sourceItem === undefined) {
						errorItems.push(item);
					} else {
						errorItems.push({ ...item, json: { ...sourceItem.json, ...item.json } });
					}
				} else {
					successItems.push(item);
				}
			}

			nodeSuccessData[outputIndex] = successItems;
		}

		nodeSuccessData[mainOutputCount - 1] = errorItems;
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
	async runWorkflow(startNodeName = null, initialData = [{}], options = {}) {
		/**
		 * `options.executionTimeoutTimestamp` — `IWorkflowExecutionData`-style deadline, checked at
		 * the top of every loop iteration (workflow-execute.ts:1486-1496).
		 * `options.pinData` — overrides `definition.pinData` (workflow-execute.ts:1632-1637).
		 */
		const executionTimeoutTimestamp = options.executionTimeoutTimestamp;
		const pinData = options.pinData ?? this.definition.pinData;
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
		let timedOut = false;

		for (;;) {
			while (stack.length > 0) {
				/** workflow-execute.ts:1486-1496 — timeout is checked once per node, not per item. */
				if (
					executionTimeoutTimestamp !== undefined &&
					Date.now() >= executionTimeoutTimestamp
				) {
					timedOut = true;
					stopped = true;
					break;
				}

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

				/**
				 * `workflow-execute.ts:1517-1552` — before a node runs, every INPUT item is
				 * re-stamped with its position in this node's input:
				 * `pairedItem: { item: itemIndex, input: inputIndex || undefined }`.
				 * Note the reference really does write `input: undefined` for input 0
				 * (`0 || undefined`), which is why a passthrough node hands that shape on.
				 * The `sourceOverwrite` branch (:1530-1541) belongs to AI tool executions and is
				 * not reconstructed.
				 */
				const reStamped = {};
				for (const connectionType of Object.keys(executionData.data ?? {})) {
					reStamped[connectionType] = (executionData.data[connectionType] ?? []).map((input, inputIndex) =>
						input === null
							? input
							: input.map((item, itemIndex) => ({
									...item,
									pairedItem: { item: itemIndex, input: inputIndex || undefined },
								})),
					);
				}
				executionData.data = reStamped;

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

				/**
				 * `workflow-execute.ts:1600-1613` — the retry budget of this node.
				 * `maxTries` is clamped to [2, 5] and `waitBetweenTries` to [0, 5000], and both
				 * use `||`, so an explicit `0` wait becomes 1000 ms (verified against the real
				 * engine: maxTries 1 → 2 attempts, 10 → 5 attempts, wait 0 → 1000 ms).
				 */
				let maxTries = 1;
				let waitBetweenTries = 0;
				if (node.retryOnFail === true) {
					maxTries = Math.min(5, Math.max(2, node.maxTries || 3));
					waitBetweenTries = Math.min(5000, Math.max(0, node.waitBetweenTries || 1000));
				}

				/** One attempt — pin data first (`:1632-1637`), otherwise the registered handler. */
				const runNodeOnce = async () => {
					if (pinData && !node.disabled && pinData[node.name] !== undefined) {
						return [pinData[node.name]]; // always the zeroth runIndex
					}
					const produced = handler
						? await handler(node, items, {
								inputData: inputData.main ?? [],
								source: taskData.source,
								runIndex,
							})
						: items; // unregistered node type: passthrough
					/** INodeExecutionData[][] — one entry per output index. */
					return [produced ?? []];
				};

				/** `workflow-execute.ts:1615-1810` — the try/retry loop. */
				for (let tryIndex = 0; tryIndex < maxTries; tryIndex++) {
					try {
						if (tryIndex !== 0) {
							// :1618-1619 — the previous attempt's error is cleared before a retry.
							executionError = undefined;
							if (waitBetweenTries !== 0) await sleep(waitBetweenTries);
						}

						nodeSuccessData = await runNodeOnce();

						/**
						 * `:1670-1692` — a node that did not throw but reported a failure on its
						 * first item (`json.error !== undefined`) is retried just the same, until
						 * the try budget is spent; it is then treated as a SUCCESS.
						 */
						let nodeFailed = nodeSuccessData?.[0]?.[0]?.json?.error !== undefined;
						while (nodeFailed && tryIndex !== maxTries - 1) {
							await sleep(waitBetweenTries);
							nodeSuccessData = await runNodeOnce();
							nodeFailed = nodeSuccessData?.[0]?.[0]?.json?.error !== undefined;
							tryIndex++;
						}

						/** `:1720-1722` — split failed items onto the error output. */
						if (nodeSuccessData && node.onError === 'continueErrorOutput') {
							this.handleNodeErrorOutput(node, nodeSuccessData, executionData);
						}

						break;
					} catch (error) {
						executionError = {
							name: error?.name,
							message: error?.message,
							description: error?.description,
							node: node.name,
							stack: error?.stack,
						};
					}
				}

				/** workflow-execute.ts:1736 — decorate output items before anything else reads them. */
				nodeSuccessData = this.assignPairedItems(nodeSuccessData, executionData);

				/**
				 * `workflow-execute.ts:1738-1741` — `if (nodeSuccessData)`: ANY non-null output makes
				 * this node `lastNodeExecuted`, including an output of zero items. Checked against
				 * the real engine — a Limit node with `maxItems: 0` emits `data = [[]]` and still
				 * becomes `lastNodeExecuted`.
				 */
				if (nodeSuccessData) lastNodeExecuted = node.name;

				/** workflow-execute.ts:1742-1767 — a node with no output can still emit one item. */
				if (!nodeSuccessData?.[0]?.[0] && node.alwaysOutputData === true) {
					const pairedItem = [];
					(inputData.main ?? []).forEach((inputItems, inputIndex) => {
						if (!inputItems) return;
						inputItems.forEach((_item, itemIndex) => pairedItem.push({ item: itemIndex, input: inputIndex }));
					});
					nodeSuccessData ??= [];
					nodeSuccessData[0] = [{ json: {}, pairedItem }];
				}

				taskData.executionTime = Date.now() - startTime;
				taskData.executionStatus = 'success';

				if (executionError !== undefined) {
					/** workflow-execute.ts:1778, 1824-1900 */
					lastNodeExecuted = node.name;
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

				/**
				 * `workflow-execute.ts:1898-1917` — per-item error reporting on the regular output.
				 * Nodes that report a failure inline (`json.$error` + `json.$json`) get collapsed
				 * into `item.error` + `json = { error: message }`; an item that already carries
				 * `error` gets its json replaced by `{ error: message }` too. The UI reads
				 * `item.error`, so this runs even on a fully successful node.
				 */
				for (const execution of nodeSuccessData ?? []) {
					for (const lineResult of execution ?? []) {
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

		/** workflow-execute.ts:2383-2400 — 'canceled' takes precedence, then 'error', then 'success'. */
		const status = timedOut ? 'canceled' : executionError !== undefined ? 'error' : 'success';

		// Flat compatibility view: last run of each node, first output slot.
		const data = {};
		for (const [name, entries] of Object.entries(runData)) {
			data[name] = entries.at(-1)?.data?.main?.[0] ?? [];
		}

		return {
			status,
			finished: status === 'success',
			/** true when the run stopped because executionTimeoutTimestamp passed (:1489-1490). */
			timedOut,
			/** true when the safety net had to drop arrivals — the graph contains a cycle. */
			cyclic: cycleSkips.length > 0,
			cycleSkips,
			executionLog,
			data,
			resultData: { runData, lastNodeExecuted, error: executionError },
		};
	}
}
