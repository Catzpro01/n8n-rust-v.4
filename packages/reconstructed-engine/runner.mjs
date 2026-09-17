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
 *     :909-920   handleDisabledNode(): a disabled node is not executed — its first main input is
 *                passed through (used on resume, and by `:1199-1201` in runNode)
 *     :990-1002  handleExecuteOnce(): `executeOnce` narrows every input slot to its first item
 *     :1219      …and it is applied right after the disabled check, before the node runs
 *     :1555-1561 runIndex comes from the stack override, otherwise the node's existing runData length
 *     :1564-1568 the same `node:runIndex` twice in a row aborts the run ('endless loop')
 *     :1580-1584 ensureInputData(): a node whose inputs are not ready goes back on the stack
 *     :2315-2348 ensureInputData(): a slot whose ancestors are all disabled never waits
 *     :1285-1302 handleWaitingState(): resuming clears waitTill, disables the node on top of the
 *                stack and pops its last runData entry so it does not look like it ran twice
 *     :1400-1412 processRunExecutionData(): the resume entry point
 *     :1600-1630 retryOnFail: maxTries = min(5, max(2, maxTries || 3)),
 *                waitBetweenTries = min(5000, max(0, waitBetweenTries || 1000)) — note `||`,
 *                so an explicit 0 means 1000 ms, not "no wait"
 *     :1670-1692 a node that did not throw but returned `json.error` on its first item is
 *                retried the same number of times ("soft" failure)
 *     :1720-1722 onError === 'continueErrorOutput' → handleNodeErrorOutput()
 *     :1736-1741 assignPairedItems, then `if (nodeSuccessData) lastNodeExecuted = node`
 *     :1769-1774 a `null` node output records nothing and ends its branch — unless it parked
 *                the execution, which must be recorded to be resumable
 *     :1821      `executionStatus: waitTill ? 'waiting' : 'success'`
 *     :1823-1900 error path: taskData.executionStatus = 'error' + taskData.error;
 *                continueOnFail / onError ∈ {continueRegularOutput, continueErrorOutput} passes the
 *                INPUT through and keeps going, otherwise runData.push + stack.unshift + break
 *     :1898-1917 per-item error reporting: `json.$error` + `json.$json` collapse into
 *                `item.error` + `json = { error: message }`
 *     :1918-1945 success path: taskData.data = { main: nodeSuccessData }; runData[name].push(taskData)
 *     :1948-1959 a waiting node goes back on the stack and the loop stops — nothing downstream runs
 *     :2391-2396 status 'waiting' when waitTill is set (after 'canceled' and 'error')
 *     :2435-2436 the run carries `waitTill`
 *     :2079-2130 stack drained but waiting nodes remain → run them with [] for the missing inputs
 *     :2383-2400 final status precedence: 'canceled' > 'error' > 'waiting' > 'success'
 *     :2463-2562 handleNodeErrorOutput(): items carrying an error move to the LAST main output
 *   reference/n8n/packages/workflow/src/common/map-connections-by-destination.ts:5-49
 *   reference/n8n/packages/workflow/src/interfaces.ts:2675-2691  ITaskStartedData / ITaskData
 *   reference/n8n/packages/workflow/src/execution-status.ts:1-11 ExecutionStatusList
 *   reference/n8n/packages/workflow/src/node-helpers.ts:1140-1196 getNodeOutputs(): with
 *                onError === 'continueErrorOutput' an `error` main output is appended
 *   reference/n8n/packages/workflow/src/workflow.ts:492-568  Workflow#getHighestNode
 *   reference/n8n/packages/workflow/src/run-execution-data-factory.ts:54-89 IRunExecutionData
 *   reference/n8n/packages/core/src/execution-engine/node-execution-context/base-execute-context.ts:107-112
 *                putExecutionToWait(waitTill) — how a node parks the execution
 *
 * Deliberately NOT reconstructed (named so nobody assumes it is there):
 *   - expressions `{{ … }}`, credentials, sub-workflows, AI/routing nodes, and dynamically
 *     computed (`{{ }}`) node `outputs`. `waitTill` pause/resume IS reconstructed; what is not is
 *     the scheduler that decides WHEN to resume (n8n's WaitTracker + the database).
 *   - Full loop-node semantics. Cycles are legal in n8n workflows, so the local execution bound is
 *     only a fail-safe until loop nodes and their reset data are reconstructed end-to-end.
 */

import { getConnectedNodes, getHighestNode, getParentNodes } from './graph.mjs';

export { getConnectedNodes, getHighestNode, getParentNodes };

const MAIN = 'main';

// `constants.ts:53-59` — the exact fallback order used by `Workflow#__getStartNode`.
const STARTING_NODE_TYPES = [
	'n8n-nodes-base.manualTrigger',
	'n8n-nodes-base.executeWorkflowTrigger',
	'n8n-nodes-base.errorTrigger',
	'n8n-nodes-base.evaluationTrigger',
	'n8n-nodes-base.formTrigger',
];
const MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE = '@n8n/n8n-nodes-langchain.manualChatTrigger';

/** Standalone counterpart of n8n-workflow's ApplicationError; intentionally not exported. */
class ApplicationError extends Error {
	constructor(message) {
		super(message);
		this.name = 'ApplicationError';
	}
}

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
	/**
	 * @param {object} workflowDefinition `{ nodes, connections, settings?, pinData? }`
	 * @param {object|null} [runExecutionData] a persisted `IRunExecutionData`
	 *   (`run-execution-data-factory.ts:54-89`) to continue from — this is the reference's third
	 *   constructor argument (`workflow-execute.ts:105-108`), and it is what makes a paused
	 *   execution resumable.
	 */
	constructor(workflowDefinition = {}, runExecutionData = null) {
		this.definition = workflowDefinition;
		this.runExecutionData = runExecutionData ?? null;
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
	 * @param {object} [description] the parts of the n8n node type the engine needs:
	 *   `requiredInputs` (`number | number[]`, interfaces.ts:2355), `inputs` (input type list,
	 *   used for its `.length`), `trigger` / `poll` (presence marks a start node), and `name`
	 *   (used to exclude the manual-chat trigger). Without an input description the engine falls
	 *   back to the number of connected input slots.
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

	/** `workflow.ts:492-568` — the root-most non-disabled ancestors feeding `nodeName`. */
	getHighestNode(nodeName, nodeConnectionIndex) {
		return getHighestNode(this.nodes, this.connectionsByDestinationNode, nodeName, nodeConnectionIndex);
	}

	/**
	 * `workflow-execute.ts:990-1002` — 1:1 port of `handleExecuteOnce` (called at `:1219`).
	 * A node with `executeOnce: true` is handed only the FIRST item of every input slot.
	 */
	handleExecuteOnce(node, inputData) {
		if (node.executeOnce === true) {
			// If node should be executed only once so use only the first input item
			const newInputData = {};
			for (const connectionType of Object.keys(inputData)) {
				newInputData[connectionType] = inputData[connectionType].map((input) => input && input.slice(0, 1));
			}
			return newInputData;
		}
		return inputData;
	}

	/**
	 * `workflow-execute.ts:2315-2348` — 1:1 port of `ensureInputData` (called at `:1580-1584`).
	 *
	 * Decides whether a node may run now:
	 *   - an input slot whose ancestors are all disabled never receives data, so the node runs
	 *     as-is instead of waiting forever;
	 *   - with no `main` data at all (or, in the legacy `'v0'` order, a missing/`null` slot) the
	 *     entry goes back on the stack and the caller skips this node for now.
	 *
	 * @returns {boolean} false = not ready; the entry was pushed back onto `stack`
	 */
	ensureInputData(node, executionData, stack) {
		const inputConnections = this.connectionsByDestinationNode[node.name]?.[MAIN] ?? [];
		for (let connectionIndex = 0; connectionIndex < inputConnections.length; connectionIndex++) {
			const highestNodes = this.getHighestNode(node.name, connectionIndex);
			if (highestNodes.length === 0) {
				// If there is no valid incoming node (if all are disabled)
				// then ignore that it has inputs and simply execute it as it is without
				// any data
				return true;
			}

			if (!Object.hasOwn(executionData.data, MAIN)) {
				// ExecutionData does not even have the connection set up so can
				// not have that data, so add it again to be executed later
				stack.push(executionData);
				return false;
			}

			if (this.executionOrder !== 'v1') {
				// Check if it has the data for all the inputs
				// The most nodes just have one but merge node for example has two and data
				// of both inputs has to be available to be able to process the node.
				if (
					executionData.data.main.length < connectionIndex ||
					executionData.data.main[connectionIndex] === null
				) {
					// Does not have the data of the connections so add back to stack
					stack.push(executionData);
					return false;
				}
			}
		}
		return true;
	}

	/** `workflow-execute.ts:189-191` — 'v1' is the default in 2.9.4. */
	get executionOrder() {
		return this.settings.executionOrder ?? 'v1';
	}

	/**
	 * SAFETY NET, not full n8n loop behaviour. n8n permits cyclic workflows and coordinates
	 * intentional loops with loop-node reset data; that larger execution context is not yet
	 * reconstructed here. A naive traversal of an accidental cycle would never terminate and,
	 * being synchronous, would starve the event loop so no watchdog could fire. This temporary
	 * bound allows at most one run per input slot (one for a single-input node), guaranteeing
	 * termination without firing on linear, fan-out, or diamond graphs.
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

	/**
	 * Start-node selection. An explicit start name is the `WorkflowExecute.run()` input and wins
	 * unchanged (`workflow-execute.ts:123-138`). With no explicit start, this is the no-destination
	 * branch of `Workflow#getStartNode` / `#__getStartNode` (`workflow.ts:817-860,867-889`):
	 * one enabled node wins; then the first enabled trigger/poll node; then the exact ordered list
	 * in `STARTING_NODE_TYPES`. There is deliberately no "first arbitrary node" fallback.
	 */
	findStartNode(startNodeName) {
		if (startNodeName) return startNodeName;

		const nodeNames = [...this.nodes.keys()];
		if (nodeNames.length === 1) {
			const onlyNode = this.nodes.get(nodeNames[0]);
			if (onlyNode && !onlyNode.disabled) return onlyNode.name; // workflow.ts:822-827
		}

		for (const nodeName of nodeNames) {
			const node = this.nodes.get(nodeName);
			const nodeType = this.nodeTypeDescriptions.get(node?.type) ?? {};
			if ((nodeType.name ?? node?.type) === MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE) continue;
			if (nodeType.trigger !== undefined || nodeType.poll !== undefined) {
				if (node?.disabled === true) continue;
				return nodeName;
			}
		}

		const sortedNodes = [...this.nodes.values()].sort(
			(a, b) => STARTING_NODE_TYPES.indexOf(a.type) - STARTING_NODE_TYPES.indexOf(b.type),
		);
		for (const node of sortedNodes) {
			if (STARTING_NODE_TYPES.includes(node.type) && node.disabled !== true) return node.name;
		}

		return undefined;
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
	 * `workflow-execute.ts:1285-1302` — 1:1 port of `handleWaitingState`.
	 *
	 * Resuming a waiting execution is not "run it again": the state has to be repaired first.
	 *   1. `waitTill` is cleared;
	 *   2. the node on top of the stack — the one that paused the run — is marked `disabled`, so it
	 *      will not execute again (a disabled node passes its input through, see `:909-920`);
	 *   3. that node's last `runData` entry is popped, so it does not look like it ran twice.
	 * Mutates the state it is given, exactly like the reference.
	 */
	handleWaitingState(state) {
		if (!state?.waitTill) return state;

		state.waitTill = undefined;

		const executionStackEntry = state.executionData?.nodeExecutionStack?.[0];
		if (executionStackEntry) executionStackEntry.node.disabled = true;

		const lastNodeExecuted = state.resultData?.lastNodeExecuted;
		if (lastNodeExecuted) state.resultData.runData[lastNodeExecuted]?.pop();

		return state;
	}

	/**
	 * `workflow-execute.ts:1400-1412` — the entry point that runs whatever execution state this
	 * engine was constructed with, applying `handleWaitingState` first. This is how n8n resumes a
	 * paused execution: build the engine on the persisted `IRunExecutionData`, then call this.
	 *
	 * ```js
	 * const paused = await new WorkflowExecutionEngine(json).runWorkflow();      // status 'waiting'
	 * const done = await new WorkflowExecutionEngine(json, paused.runExecutionData)
	 *   .processRunExecutionData();                                              // status 'success'
	 * ```
	 */
	processRunExecutionData(options = {}) {
		return this.runWorkflow(null, [], { ...options, runExecutionData: this.runExecutionData });
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
		 * `options.runExecutionData` — a persisted `IRunExecutionData` to continue from; defaults to
		 * the one this engine was constructed with (workflow-execute.ts:105-108).
		 */
		const executionTimeoutTimestamp = options.executionTimeoutTimestamp;
		const pinData = options.pinData ?? this.definition.pinData;
		const restored = options.runExecutionData ?? this.runExecutionData;

		/** workflow-execute.ts:1407 — a waiting execution is repaired before it runs on. */
		if (restored) this.handleWaitingState(restored);

		let stack;
		if (restored) {
			stack = restored.executionData?.nodeExecutionStack ?? [];
		} else {
			const startName = this.findStartNode(startNodeName);
			const startNode = startName ? this.nodes.get(startName) : undefined;
			if (!startNode) {
				throw new ApplicationError('No node to start the workflow from could be found');
			}
			/** workflow-execute.ts:157-171 */
			stack = [
				{ node: startNode, data: { main: [normalizeItems(initialData)] }, source: { main: [null] } },
			];
		}
		const waiting = restored?.executionData?.waitingExecution ?? {};
		const waitingSource = restored?.executionData?.waitingExecutionSource ?? {};
		const enqueue =
			this.executionOrder === 'v1' ? (entry) => stack.unshift(entry) : (entry) => stack.push(entry); // :417
		const ctx = { enqueue, waiting, waitingSource };

		const runData = restored?.resultData?.runData ?? {}; // IRunData: nodeName -> ITaskData[]
		const executionLog = [];
		const cycleSkips = [];
		const executionCounts = new Map();
		// `additionalData.currentNodeExecutionIndex` in the reference (interfaces.ts:2677) — a
		// resumed run continues the numbering it was persisted with.
		let executionIndex = Object.values(runData).reduce(
			(max, runs) => Math.max(max, ...runs.map((run) => (run.executionIndex ?? -1) + 1)),
			0,
		);
		let executionError = restored?.resultData?.error;
		let lastNodeExecuted = restored?.resultData?.lastNodeExecuted;
		/** `IRunExecutionData.waitTill` — set by `putExecutionToWait` (base-execute-context.ts:107). */
		let waitTill = restored?.waitTill;
		let stopped = false;
		let timedOut = false;
		let paused = false;
		/** `workflow-execute.ts:1564-1568` — the reference's own endless-loop protection. */
		let lastExecutionTry;

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

				/** `:1555-1561` — an explicit stack runIndex wins; otherwise continue runData. */
				const runIndex = executionData.runIndex ?? runData[node.name]?.length ?? 0;

				/**
				 * `:1564-1568` — if the very same `node:runIndex` comes around twice in a row the
				 * reference aborts the execution instead of spinning. This is what keeps the
				 * `ensureInputData` "put it back and try later" path from looping forever.
				 */
				const currentExecutionTry = `${node.name}:${runIndex}`;
				if (currentExecutionTry === lastExecutionTry) {
					executionError = {
						name: 'ApplicationError',
						message: 'Stopped execution because it seems to be in an endless loop',
						node: node.name,
					};
					stopped = true;
					break;
				}

				/**
				 * `:1580-1584` — a node whose inputs are not ready goes back on the stack and is
				 * skipped for now; `ensureInputData` is what pushed it back.
				 */
				if (!this.ensureInputData(node, executionData, stack)) {
					lastExecutionTry = currentExecutionTry;
					continue;
				}

				executionCounts.set(node.name, alreadyRun + 1);

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

				/**
				 * `:1219` — `executeOnce` narrows every input slot to its first item before the node
				 * sees it, so the handler and `ctx.inputData` both get the narrowed data.
				 */
				const onceData = this.handleExecuteOnce(node, inputData);
				/** What the node receives: the narrowed data, exactly like `connectionInputData`. */
				const items = onceData.main?.[0] ?? [];

				/** One attempt — pin data first (`:1632-1637`), otherwise the registered handler. */
				const runNodeOnce = async () => {
					/**
					 * `:1199-1201` → `handleDisabledNode` (`:909-920`): a disabled node is not
					 * executed at all; its first main input is passed through, or `undefined`
					 * (which ends the branch) when there is none.
					 */
					if (node.disabled === true) {
						if (Object.hasOwn(inputData, MAIN) && inputData.main.length > 0) {
							return inputData.main[0] === null ? undefined : [inputData.main[0]];
						}
						return undefined;
					}
					if (pinData && pinData[node.name] !== undefined) {
						return [pinData[node.name]]; // always the zeroth runIndex
					}
					const produced = handler
						? await handler(node, items, {
								inputData: onceData.main ?? [],
								source: taskData.source,
								runIndex,
								/**
								 * `base-execute-context.ts:107-112` — how a node (the Wait node does
								 * exactly this) parks the whole execution until a point in time.
								 */
								putExecutionToWait: (date) => {
									waitTill = date;
								},
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

				/**
				 * `:1769-1774` — a node whose output object is exactly `null` (as opposed to
				 * `undefined` or an empty output array) ends its branch and records nothing: the
				 * reference `continue`s before `taskData` is pushed. A failed node must record its
				 * error, and a waiting node must be recorded so the run can be resumed from it.
				 */
				if (executionError === undefined && nodeSuccessData === null && waitTill === undefined) {
					continue;
				}

				taskData.executionTime = Date.now() - startTime;
				/** `:1821` — `executionStatus: this.runExecutionData.waitTill ? 'waiting' : 'success'`. */
				taskData.executionStatus = waitTill !== undefined ? 'waiting' : 'success';

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

				/**
				 * `:1948-1959` — a node that parked the execution: the node goes back on the stack
				 * so the run can start again from it, and the loop stops here. Nothing downstream
				 * runs until the execution is resumed.
				 */
				if (waitTill !== undefined) {
					stack.unshift(executionData);
					paused = true;
					stopped = true;
					break;
				}

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

		/**
		 * `workflow-execute.ts:2383-2400` — status precedence: `canceled` (timeout/cancel) beats
		 * `error`, which beats `waiting`, which beats `success`.
		 */
		const status = timedOut
			? 'canceled'
			: executionError !== undefined
				? 'error'
				: waitTill !== undefined
					? 'waiting'
					: 'success';

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
			/** true when a node parked the run with `putExecutionToWait` (:1948-1959). */
			paused,
			/** `IRunExecutionData.waitTill` — the moment the run may be resumed (:2435-2436). */
			waitTill,
			/** true when the safety net had to drop arrivals — the graph contains a cycle. */
			cyclic: cycleSkips.length > 0,
			cycleSkips,
			executionLog,
			data,
			resultData: { runData, lastNodeExecuted, error: executionError },
			/**
			 * The persistable snapshot (`run-execution-data-factory.ts:54-89`, trimmed to the fields
			 * this engine maintains). Hand it back as the constructor's second argument — or as
			 * `options.runExecutionData` — and call `processRunExecutionData()` to resume.
			 */
			runExecutionData: {
				version: 1,
				startData: { startNodes: [{ source: null, startNode: startNodeName ?? undefined }] },
				resultData: { runData, lastNodeExecuted, error: executionError },
				executionData: {
					nodeExecutionStack: stack,
					waitingExecution: waiting,
					waitingExecutionSource: waitingSource,
				},
				waitTill,
			},
		};
	}
}
