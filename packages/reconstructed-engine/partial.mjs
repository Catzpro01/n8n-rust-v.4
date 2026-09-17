/**
 * Graph foundation for PARTIAL execution ("Execute step" / "Execute to node" in the editor UI).
 *
 * PROJECT_RULES.md rule 1 (ZERO RUST): 1:1 port from the n8n 2.9.4 source, line-for-line.
 *
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/directed-graph.ts:39-566
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/filter-disabled-nodes.ts:5-18
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/find-subgraph.ts:6-120
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/run-data-utils.ts:11-26
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/get-incoming-data.ts:3-34
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/clean-run-data.ts:12-49
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/handle-cycles.ts:15-56
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/find-trigger-for-partial-execution.ts:6-112
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/find-start-nodes.ts:13-185
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/get-source-data-groups.ts:5-164
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/recreate-node-execution-stack.ts:20-220
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/rewire-graph.ts:7-58
 *   reference/n8n/packages/@n8n/constants/src/execution.ts:1
 *
 * Why a second graph representation exists at all is explained in the reference header
 * (`directed-graph.ts:20-38`): `Workflow` stores the graph in a deeply nested, normalized format
 * that does not lend itself to editing or building graphs incrementally, so partial execution
 * imports it into an adjacency list, edits it, and exports it back.
 *
 * NOT ported here (named so nobody assumes the editor's partial run is complete):
 *   - `DirectedGraph#toWorkflow` (`directed-graph.ts:456-463`) constructs a `Workflow` instance,
 *     which belongs to the Workflow LEGO (`packages/workflow-lego`, `contracts/workflow.contract.md`).
 *   - The `WorkflowExecute#runPartialWorkflow2` orchestrator, which composes these helpers with
 *     execution-engine state and `DirectedGraph#toWorkflow` to wire "Execute step" end to end.
 *
 * Every helper is checked against the REAL n8n-core 2.9.1 implementation in
 * `test/partial-{equivalence,steps,stack-equivalence}.test.mjs`; helpers omitted from n8n-core's root
 * barrel are loaded from their pinned deep modules and retain source-derived no-runtime assertions.
 */

import assert from 'node:assert';
import strictAssert from 'node:assert/strict';

/** `NodeConnectionTypes.Main` — the data/control flow connection type. */
const MAIN = 'main';
/** `NodeConnectionTypes.AiTool` — a tool-to-agent utility connection. */
const AI_TOOL = 'ai_tool';
/** `@n8n/constants/src/execution.ts:1`. */
const TOOL_EXECUTOR_NODE_NAME = 'PartialExecutionToolExecutor';

/**
 * 1:1 port of `directed-graph.ts:39-566`.
 *
 * The reference leans on **object identity** everywhere (`connection.to === node`,
 * `this.nodes.get(name) === node`, `assert.ok(fromExists)`), because a graph node IS the `INode`
 * object from the workflow. This port keeps that exactly — do not "improve" it into name-based
 * lookups, or `removeNode`/`findSubgraph` start matching nodes that merely share a name.
 */
export class DirectedGraph {
	constructor() {
		this.nodes = new Map();
		/** key: `fromName-outputType-outputIndex-inputIndex-toName` (`directed-graph.ts:12-13`) */
		this.connections = new Map();
	}

	hasNode(nodeName) {
		return this.nodes.has(nodeName);
	}

	getNodes() {
		return new Map(this.nodes.entries());
	}

	/**
	 * Returns a set of nodes whose names match the provided array of names.
	 * Only nodes that exist in the graph will be included in the result.
	 */
	getNodesByNames(names) {
		const nodes = new Set();

		for (const name of names) {
			const node = this.nodes.get(name);

			if (node) {
				nodes.add(node);
			}
		}

		return nodes;
	}

	getConnections(filter = {}) {
		const filteredCopy = [];

		for (const connection of this.connections.values()) {
			const toMatches = filter.to ? connection.to === filter.to : true;

			if (toMatches) {
				filteredCopy.push(connection);
			}
		}

		return filteredCopy;
	}

	addNode(node) {
		this.nodes.set(node.name, node);
		return this;
	}

	addNodes(...nodes) {
		for (const node of nodes) {
			this.addNode(node);
		}
		return this;
	}

	/**
	 * Removes a node from the graph.
	 *
	 * By default it also removes every connection that uses that node and returns nothing.
	 * With `{ reconnectConnections: true }` it rewires all connections so that every parent ends up
	 * connected to every child, and returns the new connections.
	 */
	removeNode(node, options = { reconnectConnections: false }) {
		if (options.reconnectConnections) {
			const incomingConnections = this.getDirectParentConnections(node);
			const outgoingConnections = this.getDirectChildConnections(node);

			const newConnections = [];

			for (const incomingConnection of incomingConnections) {
				if (options.skipConnectionFn?.(incomingConnection)) {
					continue;
				}

				for (const outgoingConnection of outgoingConnections) {
					if (options.skipConnectionFn?.(outgoingConnection)) {
						continue;
					}

					const newConnection = {
						...incomingConnection,
						to: outgoingConnection.to,
						inputIndex: outgoingConnection.inputIndex,
					};

					newConnections.push(newConnection);
				}
			}

			for (const [key, connection] of this.connections.entries()) {
				if (connection.to === node || connection.from === node) {
					this.connections.delete(key);
				}
			}

			for (const newConnection of newConnections) {
				this.connections.set(this.makeKey(newConnection), newConnection);
			}

			this.nodes.delete(node.name);

			return newConnections;
		} else {
			for (const [key, connection] of this.connections.entries()) {
				if (connection.to === node || connection.from === node) {
					this.connections.delete(key);
				}
			}

			this.nodes.delete(node.name);

			return;
		}
	}

	addConnection(connectionInput) {
		const { from, to } = connectionInput;

		const fromExists = this.nodes.get(from.name) === from;
		const toExists = this.nodes.get(to.name) === to;

		assert.ok(fromExists);
		assert.ok(toExists);

		const connection = {
			...connectionInput,
			type: connectionInput.type ?? MAIN,
			outputIndex: connectionInput.outputIndex ?? 0,
			inputIndex: connectionInput.inputIndex ?? 0,
		};

		this.connections.set(this.makeKey(connection), connection);
		return this;
	}

	addConnections(...connectionInputs) {
		for (const connectionInput of connectionInputs) {
			this.addConnection(connectionInput);
		}
		return this;
	}

	getDirectChildConnections(node) {
		const nodeExists = this.nodes.get(node.name) === node;
		assert.ok(nodeExists);

		const directChildren = [];

		for (const connection of this.connections.values()) {
			if (connection.from !== node) {
				continue;
			}

			directChildren.push(connection);
		}

		return directChildren;
	}

	getChildrenRecursive(node, children) {
		const directChildren = this.getDirectChildConnections(node);

		for (const directChild of directChildren) {
			// Break out if we found a cycle.
			if (children.has(directChild.to)) {
				continue;
			}
			children.add(directChild.to);
			this.getChildrenRecursive(directChild.to, children);
		}

		return children;
	}

	/**
	 * All nodes that are children of the given node. If the node is a child of itself (it is part of
	 * a cycle) the returned set contains it as well.
	 */
	getChildren(node) {
		return this.getChildrenRecursive(node, new Set());
	}

	getDirectParentConnections(node) {
		const nodeExists = this.nodes.get(node.name) === node;
		assert.ok(nodeExists);

		const directParents = [];

		for (const connection of this.connections.values()) {
			if (connection.to !== node) {
				continue;
			}

			directParents.push(connection);
		}

		return directParents;
	}

	getParentConnectionsRecursive(node, connections) {
		const parentConnections = this.getDirectParentConnections(node);

		for (const connection of parentConnections) {
			// break out of cycles
			if (connections.has(connection)) {
				continue;
			}

			connections.add(connection);

			this.getParentConnectionsRecursive(connection.from, connections);
		}

		return connections;
	}

	getParentConnections(node) {
		return this.getParentConnectionsRecursive(node, new Set());
	}

	getConnection(from, outputIndex, type, inputIndex, to) {
		return this.connections.get(this.makeKey({ from, outputIndex, type, inputIndex, to }));
	}

	/**
	 * All strongly connected components — Tarjan's algorithm (`directed-graph.ts:312-411`).
	 *
	 * A strongly connected component is a set of nodes from which every node can reach every other
	 * node. The smallest one is a single node (it reaches itself by following no edges). Components
	 * cannot overlap.
	 */
	getStronglyConnectedComponents() {
		let id = 0;
		const visited = new Set();
		const ids = new Map();
		const lowLinkValues = new Map();
		const stack = [];
		const stronglyConnectedComponents = [];

		const followNode = (node) => {
			if (visited.has(node)) {
				return;
			}

			visited.add(node);
			lowLinkValues.set(node, id);
			ids.set(node, id);
			id++;
			stack.push(node);

			const directChildren = this.getDirectChildConnections(node).map((c) => c.to);
			for (const child of directChildren) {
				followNode(child);

				// if node is on stack min the low id
				if (stack.includes(child)) {
					const childLowLinkValue = lowLinkValues.get(child);
					const ownLowLinkValue = lowLinkValues.get(node);
					assert.ok(childLowLinkValue !== undefined);
					assert.ok(ownLowLinkValue !== undefined);
					const lowestLowLinkValue = Math.min(childLowLinkValue, ownLowLinkValue);

					lowLinkValues.set(node, lowestLowLinkValue);
				}
			}

			// after we visited all children, check if the low id is the same as the
			// nodes id, which means we found a strongly connected component
			const ownId = ids.get(node);
			const ownLowLinkValue = lowLinkValues.get(node);
			assert.ok(ownId !== undefined);
			assert.ok(ownLowLinkValue !== undefined);

			if (ownId === ownLowLinkValue) {
				// pop from the stack until the stack is empty or we find a node that
				// has a different low id
				const scc = new Set();
				let next = stack.at(-1);

				while (next && lowLinkValues.get(next) === ownId) {
					stack.pop();
					scc.add(next);
					next = stack.at(-1);
				}

				if (scc.size > 0) {
					stronglyConnectedComponents.push(scc);
				}
			}
		};

		for (const node of this.nodes.values()) {
			followNode(node);
		}

		return stronglyConnectedComponents;
	}

	depthFirstSearchRecursive(from, fn, seen) {
		if (seen.has(from)) {
			return undefined;
		}
		seen.add(from);

		if (fn(from)) {
			return from;
		}

		for (const childConnection of this.getDirectChildConnections(from)) {
			const found = this.depthFirstSearchRecursive(childConnection.to, fn, seen);

			if (found) {
				return found;
			}
		}

		return undefined;
	}

	/**
	 * Like `Array.prototype.find` but for directed graphs: depth first, starting from and including
	 * `from`, returns the first node for which `fn` returns true.
	 */
	depthFirstSearch({ from, fn }) {
		return this.depthFirstSearchRecursive(from, fn, new Set());
	}

	/**
	 * `directed-graph.ts:465-503` — import from a `Workflow`. Expects the reference's shape:
	 * `workflow.nodes` as a by-name object and `workflow.connectionsBySourceNode`.
	 */
	static fromWorkflow(workflow) {
		const graph = new DirectedGraph();

		graph.addNodes(...Object.values(workflow.nodes));

		for (const [fromNodeName, iConnection] of Object.entries(workflow.connectionsBySourceNode)) {
			const from = workflow.getNode(fromNodeName);
			assert.ok(from);

			for (const [outputType, outputs] of Object.entries(iConnection)) {
				for (const [outputIndex, conns] of outputs.entries()) {
					for (const conn of conns ?? []) {
						const { node: toNodeName, index: inputIndex } = conn;
						const to = workflow.getNode(toNodeName);
						assert.ok(to);

						graph.addConnection({
							from,
							to,
							type: outputType,
							outputIndex,
							inputIndex,
						});
					}
				}
			}
		}

		return graph;
	}

	/** `directed-graph.ts:505-543` — import from a plain node array plus an `IConnections` map. */
	static fromNodesAndConnections(nodes, connections) {
		const graph = new DirectedGraph();

		graph.addNodes(...nodes);

		// Create a map for quick node lookup
		const nodeMap = new Map();
		for (const node of nodes) {
			nodeMap.set(node.name, node);
		}

		for (const [fromNodeName, iConnection] of Object.entries(connections)) {
			const from = nodeMap.get(fromNodeName);
			assert.ok(from);

			for (const [outputType, outputs] of Object.entries(iConnection)) {
				for (const [outputIndex, conns] of outputs.entries()) {
					for (const conn of conns ?? []) {
						const { node: toNodeName, index: inputIndex } = conn;
						const to = nodeMap.get(toNodeName);
						assert.ok(to);

						graph.addConnection({
							from,
							to,
							type: outputType,
							outputIndex,
							inputIndex,
						});
					}
				}
			}
		}

		return graph;
	}

	clone() {
		return new DirectedGraph()
			.addNodes(...this.getNodes().values())
			.addConnections(...this.getConnections().values());
	}

	toIConnections() {
		const result = {};

		for (const connection of this.connections.values()) {
			const { from, to, type, outputIndex, inputIndex } = connection;

			result[from.name] = result[from.name] ?? {
				[type]: [],
			};
			const resultConnection = result[from.name];
			resultConnection[type][outputIndex] = resultConnection[type][outputIndex] ?? [];
			const group = resultConnection[type][outputIndex];

			group.push({
				node: to.name,
				type,
				index: inputIndex,
			});
		}

		return result;
	}

	makeKey(connection) {
		return `${connection.from.name}-${connection.type}-${connection.outputIndex}-${connection.inputIndex}-${connection.to.name}`;
	}
}


/**
 * 1:1 port of `filter-disabled-nodes.ts:5-18`.
 *
 * Disabled nodes are removed and their parents reconnected straight to their children — which is
 * why partial execution of a workflow with a disabled node still reaches the destination. Only
 * `main` connections are rewired (`skipConnectionFn`), because the other types are AI utility
 * links that must not become dataflow edges.
 */
export function filterDisabledNodes(graph) {
	const filteredGraph = graph.clone();

	for (const node of filteredGraph.getNodes().values()) {
		if (node.disabled) {
			filteredGraph.removeNode(node, {
				reconnectConnections: true,
				skipConnectionFn: (c) => c.type !== MAIN,
			});
		}
	}

	return filteredGraph;
}

function findSubgraphRecursive(graph, destinationNode, current, trigger, newGraph, currentBranch) {
	// If the current node is the chosen trigger keep this branch.
	if (current === trigger) {
		// If this graph consists of only one node there won't be any connections
		// and the loop below won't add anything.
		// We're adding the trigger here so that graphs with one node and no
		// connections are handled correctly.
		newGraph.addNode(trigger);

		for (const connection of currentBranch) {
			newGraph.addNodes(connection.from, connection.to);
			newGraph.addConnection(connection);
		}

		return;
	}

	const parentConnections = graph.getDirectParentConnections(current);

	// If the current node has no parents, don’t keep this branch.
	if (parentConnections.length === 0) {
		return;
	}

	// If the current node is the destination node again, don’t keep this branch.
	const isCycleWithDestinationNode =
		current === destinationNode && currentBranch.some((c) => c.to === destinationNode);
	if (isCycleWithDestinationNode) {
		return;
	}

	// If the current node was already visited, keep this branch.
	const isCycleWithCurrentNode = currentBranch.some((c) => c.to === current);
	if (isCycleWithCurrentNode) {
		for (const connection of currentBranch) {
			newGraph.addNodes(connection.from, connection.to);
			newGraph.addConnection(connection);
		}
		return;
	}

	// Recurse on each parent.
	for (const parentConnection of parentConnections) {
		// Skip parents that are connected via non-Main connection types. They are
		// only utility nodes for AI and are not part of the data or control flow
		// and can never lead too the trigger.
		if (parentConnection.type !== MAIN) {
			continue;
		}

		findSubgraphRecursive(graph, destinationNode, parentConnection.from, trigger, newGraph, [
			...currentBranch,
			parentConnection,
		]);
	}
}

/**
 * 1:1 port of `find-subgraph.ts:67-120`.
 *
 * Finds every node that can lead from the trigger to the destination node, walking backwards from
 * the destination (`find-subgraph.ts:71-85` documents the six rules). Afterwards it re-adds the
 * non-`main` parent connections of every node in the subgraph (`:105-118`) — without that, AI
 * workflows would lose their model/tool utility nodes during partial execution.
 */
export function findSubgraph(options) {
	const graph = options.graph;
	const destination = options.destination;
	const trigger = options.trigger;
	const subgraph = new DirectedGraph();

	findSubgraphRecursive(graph, destination, destination, trigger, subgraph, []);

	for (const node of subgraph.getNodes().values()) {
		const parentConnections = graph.getParentConnections(node);

		for (const connection of parentConnections) {
			if (connection.type === MAIN) {
				continue;
			}

			subgraph.addNodes(connection.from, connection.to);
			subgraph.addConnection(connection);
		}
	}

	return subgraph;
}

/* ================================================================== *
 * run data helpers
 * ================================================================== */

/**
 * 1:1 port of `run-data-utils.ts:11-26`.
 *
 * The execution index tracks the sequence of workflow executions; this finds the highest existing
 * index in the run data and increments it. Nodes executed before `executionIndex` existed simply
 * lack the field, which is why the `typeof value === 'number'` filter is there.
 */
export function getNextExecutionIndex(runData = {}) {
	// If runData is empty, return 0 as the first execution index
	if (!runData || Object.keys(runData).length === 0) return 0;

	const previousIndices = Object.values(runData)
		.flat()
		.map((taskData) => taskData.executionIndex)
		// filter out undefined if previous execution does not have index
		// this can happen if rerunning execution before executionIndex was introduced
		.filter((value) => typeof value === 'number');

	// If no valid indices were found, return 0 as the first execution index
	if (previousIndices.length === 0) return 0;

	return Math.max(...previousIndices) + 1;
}

/** 1:1 port of `get-incoming-data.ts:3-11`. */
export function getIncomingData(runData, nodeName, runIndex, connectionType, outputIndex) {
	return runData[nodeName]?.at(runIndex)?.data?.[connectionType].at(outputIndex) ?? null;
}

/** 1:1 port of `get-incoming-data.ts:13-15`. */
function getRunIndexLength(runData, nodeName) {
	return runData[nodeName]?.length ?? 0;
}

/** 1:1 port of `get-incoming-data.ts:17-34`. */
export function getIncomingDataFromAnyRun(runData, nodeName, connectionType, outputIndex) {
	const maxRunIndexes = getRunIndexLength(runData, nodeName);

	for (let runIndex = 0; runIndex < maxRunIndexes; runIndex++) {
		const data = getIncomingData(runData, nodeName, runIndex, connectionType, outputIndex);

		if (data && data.length > 0) {
			return { data, runIndex };
		}
	}

	return undefined;
}

/**
 * 1:1 port of `clean-run-data.ts:12-49`.
 *
 * Returns new run data without any node that is a child of any of the passed nodes — this is what
 * makes a re-run start from scratch instead of reusing stale results. Does not mutate the input.
 * Sub-node run data (AI models/tools attached via non-`main` links) is dropped too, which is why the
 * `type === MAIN` connections are skipped rather than followed.
 */
export function cleanRunData(runData, graph, nodesToClean) {
	const newRunData = { ...runData };

	for (const nodeToClean of nodesToClean) {
		delete newRunData[nodeToClean.name];

		const children = graph.getChildren(nodeToClean);
		for (const node of [nodeToClean, ...children]) {
			delete newRunData[node.name];

			// Delete runData for subNodes
			const subNodeConnections = graph.getParentConnections(node);
			for (const subNodeConnection of subNodeConnections) {
				// Sub nodes never use the Main connection type, so this filters out
				// the connection that goes upstream of the node to clean.
				if (subNodeConnection.type === MAIN) {
					continue;
				}

				delete newRunData[subNodeConnection.from.name];
			}
		}
	}

	// Remove run data for all nodes that are not part of the subgraph
	for (const nodeName of Object.keys(newRunData)) {
		if (!graph.hasNode(nodeName)) {
			// remove run data for node that is not part of the graph
			delete newRunData[nodeName];
		}
	}

	return newRunData;
}

/**
 * 1:1 port of `handle-cycles.ts:15-56`.
 *
 * For every start node this checks whether it sits inside a cycle and, if so, replaces it with the
 * cycle's start — otherwise partial execution would have to work out which run of the cycle to
 * repeat.
 */
export function handleCycles(graph, startNodes, trigger) {
	// Strongly connected components can also be nodes that are not part of a
	// cycle. They form a strongly connected component of one. E.g the trigger is
	// always a strongly connected component by itself because it does not have
	// any inputs and thus cannot build a cycle.
	//
	// We're not interested in them so we filter them out.
	const cycles = graph.getStronglyConnectedComponents().filter((cycle) => cycle.size >= 1);
	const newStartNodes = new Set(startNodes);

	// For each start node, check if the node is part of a cycle and if it is
	// replace the start node with the start of the cycle.
	if (cycles.length === 0) {
		return newStartNodes;
	}

	for (const startNode of startNodes) {
		for (const cycle of cycles) {
			const isPartOfCycle = cycle.has(startNode);
			if (isPartOfCycle) {
				const firstNode = graph.depthFirstSearch({
					from: trigger,
					fn: (node) => cycle.has(node),
				});

				assert.ok(
					firstNode,
					"the trigger must be connected to the cycle, otherwise the cycle wouldn't be part of the subgraph",
				);

				newStartNodes.delete(startNode);
				newStartNodes.add(firstNode);
			}
		}
	}

	return newStartNodes;
}

/* ================================================================== *
 * finding the trigger to start a partial run from
 * ================================================================== */

/** `find-trigger-for-partial-execution.ts:6` */
const isTriggerNode = (nodeType) => nodeType.description.group.includes('trigger');

/** 1:1 port of `find-trigger-for-partial-execution.ts:8-28`. */
function findAllParentTriggers(workflow, destinationNodeName) {
	const parentNodes = workflow
		.getParentNodes(destinationNodeName)
		.map((name) => {
			const node = workflow.getNode(name);

			// We got the node name from `workflow.getParentNodes`. The node must
			// exist.
			assert.ok(node);

			return {
				node,
				nodeType: workflow.nodeTypes.getByNameAndVersion(node.type, node.typeVersion),
			};
		})
		.filter((value) => value !== null)
		.filter(({ nodeType }) => isTriggerNode(nodeType))
		.map(({ node }) => node);

	return parentNodes;
}

/** 1:1 port of `find-trigger-for-partial-execution.ts:30-64`. */
export function anyReachableRootHasRunData(workflow, destinationNodeName, runData) {
	const destinationNode = workflow.getNodes().get(destinationNodeName);
	if (!destinationNode) return false;

	// Get all parent connections recursively
	const parentConnections = workflow.getParentConnections(destinationNode);

	// Extract unique parent nodes from connections
	const parentNodes = new Set();
	for (const connection of parentConnections) {
		parentNodes.add(connection.from);
	}

	// Find all root nodes (nodes with no incoming connections)
	const rootNodes = new Set();
	for (const parentNode of parentNodes) {
		const hasParents = workflow.getDirectParentConnections(parentNode).length > 0;
		if (!hasParents) {
			rootNodes.add(parentNode);
		}
	}

	// Check if at least one root node has run data
	for (const rootNode of rootNodes) {
		if (runData[rootNode.name]) {
			return true;
		}
	}

	return false;
}

/**
 * 1:1 port of `find-trigger-for-partial-execution.ts:67-112`.
 *
 * The reference's own TODO says this should be rewritten on top of `DirectedGraph`; until n8n does,
 * this keeps working on a `Workflow` (`getParentNodes`, `getNode`, `nodeTypes`, `pinData`), which is
 * why the reconstructed engine passes a workflow-shaped object rather than a `DirectedGraph`.
 *
 * Precedence: the destination itself (if it is an enabled trigger) → a parent trigger that already
 * has run data → a pinned trigger (webhook-typed ones first) → a webhook-typed trigger → the first
 * parent trigger.
 */
export function findTriggerForPartialExecution(workflow, destinationNodeName, runData) {
	// First, check if the destination node itself is a trigger
	const destinationNode = workflow.getNode(destinationNodeName);
	if (!destinationNode) return;

	const destinationNodeType = workflow.nodeTypes.getByNameAndVersion(
		destinationNode.type,
		destinationNode.typeVersion,
	);

	if (isTriggerNode(destinationNodeType) && !destinationNode.disabled) {
		return destinationNode;
	}

	// Since the destination node wasn't a trigger, we try to find a parent node that's a trigger
	const parentTriggers = findAllParentTriggers(workflow, destinationNodeName).filter(
		(trigger) => !trigger.disabled,
	);

	// prefer triggers that have run data
	for (const trigger of parentTriggers) {
		if (runData[trigger.name]) {
			return trigger;
		}
	}

	// Prioritize webhook triggers with pinned-data
	const pinnedTriggers = parentTriggers
		.filter((trigger) => workflow.pinData?.[trigger.name])
		// Put nodes which names end with 'webhook' first, while also reversing the
		// order they had in the original array.
		.sort((a, b) => (a.type.endsWith('webhook') ? -1 : b.type.endsWith('webhook') ? 1 : 0));
	if (pinnedTriggers.length) {
		return pinnedTriggers[0];
	}

	// Prioritize webhook triggers over other parent triggers
	const webhookTriggers = parentTriggers.filter((trigger) => trigger.type.endsWith('webhook'));
	return webhookTriggers.length > 0 ? webhookTriggers[0] : parentTriggers[0];
}

/* ================================================================== *
 * finding partial-execution start nodes
 * ================================================================== */

/**
 * 1:1 port of `find-start-nodes.ts:13-48`.
 *
 * The three TODO branches intentionally remain false, exactly as in n8n 2.9.4. Today a node is
 * clean when it has either pinned data or any run-data entry; otherwise it is dirty.
 */
export function isDirty(node, runData = {}, pinData = {}) {
	// TODO: implement
	const propertiesOrOptionsChanged = false;

	if (propertiesOrOptionsChanged) {
		return true;
	}

	// TODO: implement
	const parentNodeGotDisabled = false;

	if (parentNodeGotDisabled) {
		return true;
	}

	// TODO: implement
	const hasAnError = false;

	if (hasAnError) {
		return true;
	}

	const hasPinnedData = pinData[node.name] !== undefined;

	if (hasPinnedData) {
		return false;
	}

	const hasRunData = runData?.[node.name];

	if (hasRunData) {
		return false;
	}

	return true;
}

/** `find-start-nodes.ts:50-137`. */
function findStartNodesRecursive(graph, current, destination, runData, pinData, startNodes, seen) {
	const nodeIsDirty = isDirty(current, runData, pinData);

	// If the current node is dirty stop following this branch, we found a start
	// node.
	if (nodeIsDirty) {
		startNodes.add(current);

		return startNodes;
	}

	// If the current node is the destination node stop following this branch, we
	// found a start node.
	if (current === destination) {
		startNodes.add(current);
		return startNodes;
	}

	// If the current node is a loop node, check if the `done` output has data on
	// the last run. If it doesn't the loop wasn't fully executed and needs to be
	// re-run from the start. Thus the loop node become the start node.
	if (current.type === 'n8n-nodes-base.splitInBatches') {
		const nodeRunData = getIncomingData(
			runData,
			current.name,
			// last run
			-1,
			MAIN,
			// Although this is a Loop node, the graph may not actually have a loop here e.g.,
			// while the workflow is under development. If there's not a loop, we treat the loop
			// node as a normal node and take the data from the first output at index 1.
			// If there *is* a loop, we take the data from the `done` output at index 0.
			isALoop(graph, current) ? 0 : 1,
		);

		if (nodeRunData === null || nodeRunData.length === 0) {
			startNodes.add(current);
			return startNodes;
		}
	}

	// If we detect a cycle stop following the branch, there is no start node on
	// this branch.
	if (seen.has(current)) {
		return startNodes;
	}

	// Recurse with every direct child that is part of the sub graph.
	const outGoingConnections = graph.getDirectChildConnections(current);
	for (const outGoingConnection of outGoingConnections) {
		const nodeRunData = getIncomingDataFromAnyRun(
			runData,
			outGoingConnection.from.name,
			outGoingConnection.type,
			outGoingConnection.outputIndex,
		);

		// If the node has multiple outputs, only follow the outputs that have run data.
		const hasNoRunData =
			nodeRunData === null || nodeRunData === undefined || nodeRunData.data.length === 0;
		const hasNoPinnedData = pinData[outGoingConnection.from.name] === undefined;
		if (hasNoRunData && hasNoPinnedData) {
			continue;
		}

		findStartNodesRecursive(
			graph,
			outGoingConnection.to,
			destination,
			runData,
			pinData,
			startNodes,
			new Set(seen).add(current),
		);
	}

	return startNodes;
}

/** `find-start-nodes.ts:139-141`. */
function isALoop(graph, node) {
	return graph.getChildren(node).has(node);
}

/**
 * 1:1 port of `find-start-nodes.ts:143-185`.
 *
 * Traverses from the selected trigger toward the destination and returns the earliest dirty node on
 * every branch. The returned nodes are the ones partial execution must execute or re-execute.
 */
export function findStartNodes(options) {
	const graph = options.graph;
	const trigger = options.trigger;
	const destination = options.destination;
	const runData = { ...options.runData };
	const pinData = options.pinData;

	const startNodes = findStartNodesRecursive(
		graph,
		trigger,
		destination,
		runData,
		pinData,
		// start nodes found
		new Set(),
		// seen
		new Set(),
	);

	return startNodes;
}

/* ================================================================== *
 * source grouping and execution-stack recreation
 * ================================================================== */

/** `get-source-data-groups.ts:7-16`. */
function sortByInputIndexThenByName(connection1, connection2) {
	if (connection1.inputIndex === connection2.inputIndex) {
		return connection1.from.name.localeCompare(connection2.from.name);
	} else {
		return connection1.inputIndex - connection2.inputIndex;
	}
}

/** `get-source-data-groups.ts:31-36`. */
function newGroup() {
	return {
		complete: true,
		connections: [],
	};
}

/**
 * 1:1 port of `get-source-data-groups.ts:86-164`.
 *
 * Incoming connections are sorted by input index and source-node name, then distributed so each
 * group contains at most one connection for each input. Data-bearing connections are preferred;
 * missing-data main connections make their group incomplete, while missing-data non-main
 * connections are ignored.
 */
export function getSourceDataGroups(graph, node, runData, pinnedData) {
	const connections = graph.getConnections({ to: node });

	const sortedConnectionsWithData = [];
	const sortedConnectionsWithoutData = [];

	for (const connection of connections) {
		const hasData = runData[connection.from.name] || pinnedData[connection.from.name];

		if (hasData) {
			sortedConnectionsWithData.push(connection);
		} else if (connection.type === MAIN) {
			sortedConnectionsWithoutData.push(connection);
		}
	}

	if (sortedConnectionsWithData.length === 0 && sortedConnectionsWithoutData.length === 0) {
		return [];
	}

	sortedConnectionsWithData.sort(sortByInputIndexThenByName);
	sortedConnectionsWithoutData.sort(sortByInputIndexThenByName);

	const groups = [];
	let currentGroup = newGroup();
	let currentInputIndex =
		Math.min(
			...sortedConnectionsWithData.map((c) => c.inputIndex),
			...sortedConnectionsWithoutData.map((c) => c.inputIndex),
		) - 1;

	while (sortedConnectionsWithData.length > 0 || sortedConnectionsWithoutData.length > 0) {
		currentInputIndex++;

		const connectionWithDataIndex = sortedConnectionsWithData.findIndex(
			(c) => c.inputIndex === currentInputIndex,
		);

		if (connectionWithDataIndex >= 0) {
			const connection = sortedConnectionsWithData[connectionWithDataIndex];

			currentGroup.connections.push(connection);

			sortedConnectionsWithData.splice(connectionWithDataIndex, 1);
			continue;
		}

		const connectionWithoutDataIndex = sortedConnectionsWithoutData.findIndex(
			(c) => c.inputIndex === currentInputIndex,
		);

		if (connectionWithoutDataIndex >= 0) {
			const connection = sortedConnectionsWithoutData[connectionWithoutDataIndex];

			currentGroup.connections.push(connection);
			currentGroup.complete = false;

			sortedConnectionsWithoutData.splice(connectionWithoutDataIndex, 1);
			continue;
		}

		groups.push(currentGroup);
		currentGroup = newGroup();
		currentInputIndex =
			Math.min(
				...sortedConnectionsWithData.map((c) => c.inputIndex),
				...sortedConnectionsWithoutData.map((c) => c.inputIndex),
			) - 1;
	}

	groups.push(currentGroup);

	return groups;
}

/** 1:1 port of `recreate-node-execution-stack.ts:20-37`. Mutates `waitingExecution`. */
export function addWaitingExecution(
	waitingExecution,
	nodeName,
	runIndex,
	inputType,
	inputIndex,
	executionData,
) {
	const waitingExecutionObject = waitingExecution[nodeName] ?? {};
	const taskDataConnections = waitingExecutionObject[runIndex] ?? {};
	const executionDataList = taskDataConnections[inputType] ?? [];

	executionDataList[inputIndex] = executionData;

	taskDataConnections[inputType] = executionDataList;
	waitingExecutionObject[runIndex] = taskDataConnections;
	waitingExecution[nodeName] = waitingExecutionObject;
}

/** 1:1 port of `recreate-node-execution-stack.ts:39-56`. Mutates `waitingExecutionSource`. */
export function addWaitingExecutionSource(
	waitingExecutionSource,
	nodeName,
	runIndex,
	inputType,
	inputIndex,
	sourceData,
) {
	const waitingExecutionSourceObject = waitingExecutionSource[nodeName] ?? {};
	const taskDataConnectionsSource = waitingExecutionSourceObject[runIndex] ?? {};
	const sourceDataList = taskDataConnectionsSource[inputType] ?? [];

	sourceDataList[inputIndex] = sourceData;

	taskDataConnectionsSource[inputType] = sourceDataList;
	waitingExecutionSourceObject[runIndex] = taskDataConnectionsSource;
	waitingExecutionSource[nodeName] = waitingExecutionSourceObject;
}

/**
 * 1:1 port of `recreate-node-execution-stack.ts:58-220`.
 *
 * Rebuilds `nodeExecutionStack`, `waitingExecution`, and `waitingExecutionSource` from a filtered
 * directed graph plus existing run/pin data. This is the in-memory state consumed by the execution
 * loop after partial-run planning.
 */
export function recreateNodeExecutionStack(graph, startNodes, runData, pinData) {
	// Validate invariants.

	// The graph needs to be free of disabled nodes. If it's not it hasn't been
	// passed through findSubgraph.
	for (const node of graph.getNodes().values()) {
		strictAssert.notEqual(
			node.disabled,
			true,
			`Graph contains disabled nodes. This is not supported. Make sure to pass the graph through "findSubgraph" before calling "recreateNodeExecutionStack". The node in question is "${node.name}"`,
		);
	}

	// Initialize the nodeExecutionStack and waitingExecution with
	// the data from runData
	const nodeExecutionStack = [];
	const waitingExecution = {};
	const waitingExecutionSource = {};

	for (const startNode of startNodes) {
		const incomingStartNodeConnections = graph
			.getDirectParentConnections(startNode)
			.filter((c) => c.type === MAIN);

		let incomingData = [];
		let incomingSourceData = null;

		if (incomingStartNodeConnections.length === 0) {
			incomingData.push([{ json: {} }]);

			const executeData = {
				node: startNode,
				data: { main: incomingData },
				source: incomingSourceData,
			};

			nodeExecutionStack.push(executeData);
		} else {
			const sourceDataSets = getSourceDataGroups(graph, startNode, runData, pinData);

			for (const sourceData of sourceDataSets) {
				if (sourceData.complete) {
					// All incoming connections have data, so let's put the node on the
					// stack!
					incomingData = [];

					incomingSourceData = { main: [] };

					for (const incomingConnection of sourceData.connections) {
						let runIndex = 0;
						const sourceNode = incomingConnection.from;

						if (pinData[sourceNode.name]) {
							incomingData.push(pinData[sourceNode.name]);
						} else {
							strictAssert.ok(
								runData[sourceNode.name],
								`Start node(${incomingConnection.to.name}) has an incoming connection with no run or pinned data. This is not supported. The connection in question is "${sourceNode.name}->${startNode.name}". Are you sure the start nodes come from the "findStartNodes" function?`,
							);

							const nodeIncomingData = getIncomingDataFromAnyRun(
								runData,
								sourceNode.name,
								incomingConnection.type,
								incomingConnection.outputIndex,
							);

							if (nodeIncomingData) {
								runIndex = nodeIncomingData.runIndex;
								incomingData.push(nodeIncomingData.data);
							}
						}

						incomingSourceData.main.push({
							previousNode: incomingConnection.from.name,
							previousNodeOutput: incomingConnection.outputIndex,
							previousNodeRun: runIndex,
						});
					}

					const executeData = {
						node: startNode,
						data: { main: incomingData },
						source: incomingSourceData,
					};

					nodeExecutionStack.push(executeData);
				} else {
					const nodeName = startNode.name;
					const nextRunIndex = waitingExecution[nodeName]
						? Object.keys(waitingExecution[nodeName]).length
						: 0;

					for (const incomingConnection of sourceData.connections) {
						const sourceNode = incomingConnection.from;
						const maybeNodeIncomingData = getIncomingDataFromAnyRun(
							runData,
							sourceNode.name,
							incomingConnection.type,
							incomingConnection.outputIndex,
						);
						const nodeIncomingData = maybeNodeIncomingData?.data ?? null;

						if (nodeIncomingData) {
							addWaitingExecution(
								waitingExecution,
								nodeName,
								nextRunIndex,
								incomingConnection.type,
								incomingConnection.inputIndex,
								nodeIncomingData,
							);

							addWaitingExecutionSource(
								waitingExecutionSource,
								nodeName,
								nextRunIndex,
								incomingConnection.type,
								incomingConnection.inputIndex,
								nodeIncomingData
									? {
											previousNode: incomingConnection.from.name,
											previousNodeRun: nextRunIndex,
											previousNodeOutput: incomingConnection.outputIndex,
										}
									: null,
							);
						}
					}
				}
			}
		}
	}

	return {
		nodeExecutionStack,
		waitingExecution,
		waitingExecutionSource,
	};
}

/* ================================================================== *
 * AI-tool graph rewiring
 * ================================================================== */

/**
 * 1:1 port of `rewire-graph.ts:7-58` and
 * `packages/@n8n/constants/src/execution.ts:1`.
 */
export function rewireGraph(tool, graph, agentRequest) {
	const modifiedGraph = graph.clone();
	const children = modifiedGraph.getChildren(tool);

	if (children.size === 0) {
		return graph;
	}

	const rootNode = [...children][children.size - 1];

	strictAssert.ok(rootNode);

	const allIncomingConnection = modifiedGraph
		.getDirectParentConnections(rootNode)
		.filter((cn) => cn.type === MAIN);

	// Create virtual agent node
	const toolExecutor = {
		name: TOOL_EXECUTOR_NODE_NAME,
		disabled: false,
		type: '@n8n/n8n-nodes-langchain.toolExecutor',
		parameters: {
			query: JSON.stringify(agentRequest?.query ?? {}),
			toolName: agentRequest?.tool?.name ?? '',
			node: tool.name,
		},
		id: rootNode.id,
		typeVersion: 0,
		position: [0, 0],
	};

	// Add virtual agent to graph
	modifiedGraph.addNode(toolExecutor);

	// Rewire tool output to virtual agent
	tool.rewireOutputLogTo = AI_TOOL;
	modifiedGraph.addConnection({ from: tool, to: toolExecutor, type: AI_TOOL });

	// Rewire all incoming connections to virtual agent
	for (const cn of allIncomingConnection) {
		modifiedGraph.addConnection({ from: cn.from, to: toolExecutor, type: cn.type });
	}

	// Remove original agent node
	modifiedGraph.removeNode(rootNode);

	return modifiedGraph;
}
