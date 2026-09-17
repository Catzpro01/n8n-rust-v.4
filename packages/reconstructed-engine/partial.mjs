/**
 * Graph foundation for PARTIAL execution ("Execute step" / "Execute to node" in the editor UI).
 *
 * PROJECT_RULES.md rule 1 (ZERO RUST): 1:1 port from the n8n 2.9.4 source, line-for-line.
 *
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/directed-graph.ts:39-566
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/filter-disabled-nodes.ts:5-18
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/find-subgraph.ts:6-120
 *
 * Why a second graph representation exists at all is explained in the reference header
 * (`directed-graph.ts:20-38`): `Workflow` stores the graph in a deeply nested, normalized format
 * that does not lend itself to editing or building graphs incrementally, so partial execution
 * imports it into an adjacency list, edits it, and exports it back.
 *
 * NOT ported here (named so nobody assumes it is):
 *   - `DirectedGraph#toWorkflow` (`directed-graph.ts:456-463`) constructs a `Workflow` instance,
 *     which belongs to the Workflow LEGO (`packages/workflow-lego`, `contracts/workflow.contract.md`).
 *   - The remaining partial-execution steps (`findTriggerForPartialExecution`, `findStartNodes`,
 *     `cleanRunData`, `handleCycles`, `recreateNodeExecutionStack`, `rewireGraph`) — they build on
 *     this module and are the next slice.
 *
 * Everything below is checked against the REAL implementations exported by the pinned n8n-core
 * 2.9.1 in `test/partial-equivalence.test.mjs`.
 */

import assert from 'node:assert';

/** `NodeConnectionTypes.Main` — the data/control flow connection type. */
const MAIN = 'main';

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
