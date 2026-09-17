/**
 * Partial execution utilities and DirectedGraph representation.
 *
 * Reconstruction targets (n8n 2.9.4):
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/directed-graph.ts
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/filter-disabled-nodes.ts
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/rewire-graph.ts
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/recreate-node-execution-stack.ts
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/get-incoming-data.ts
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/get-source-data-groups.ts
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/find-trigger-for-partial-execution.ts
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/find-subgraph.ts
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/find-start-nodes.ts
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/handle-cycles.ts
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/clean-run-data.ts
 */

import assert from 'node:assert/strict';
import { ReconstructedWorkflow } from './workflow.mjs';

export const TOOL_EXECUTOR_NODE_NAME = 'PartialExecutionToolExecutor';

/**
 * Checks if a node is configured as an AI tool.
 * Verbatim logic from n8n 2.9.4 NodeHelpers.isTool.
 */
export function isTool(nodeTypeDescription, parameters = {}) {
	if (!nodeTypeDescription) return false;

	if (nodeTypeDescription.name?.includes('vectorStore')) {
		const mode = parameters?.mode;
		return mode === 'retrieve-as-tool';
	}

	if (Array.isArray(nodeTypeDescription.outputs)) {
		for (const output of nodeTypeDescription.outputs) {
			if (typeof output === 'string') {
				if (output === 'ai_tool') return true;
			} else if (output?.type && output.type === 'ai_tool') {
				return true;
			}
		}
	}

	return false;
}

/**
 * DirectedGraph — adjacency list representation of workflow nodes and connections.
 */
export class DirectedGraph {
	constructor() {
		this.nodes = new Map();
		this.connections = new Map();
	}

	hasNode(nodeName) {
		return this.nodes.has(nodeName);
	}

	getNodes() {
		return new Map(this.nodes.entries());
	}

	getNodesByNames(names) {
		const result = new Set();
		for (const name of names) {
			const node = this.nodes.get(name);
			if (node) {
				result.add(node);
			}
		}
		return result;
	}

	getConnections(filter = {}) {
		const filtered = [];
		for (const connection of this.connections.values()) {
			const toMatches = filter.to ? connection.to === filter.to : true;
			if (toMatches) {
				filtered.push(connection);
			}
		}
		return filtered;
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
		}

		for (const [key, connection] of this.connections.entries()) {
			if (connection.to === node || connection.from === node) {
				this.connections.delete(key);
			}
		}

		this.nodes.delete(node.name);
		return undefined;
	}

	addConnection(connectionInput) {
		const { from, to } = connectionInput;
		const fromExists = this.nodes.get(from?.name) === from;
		const toExists = this.nodes.get(to?.name) === to;

		assert.ok(fromExists, `From node "${from?.name}" does not exist in graph`);
		assert.ok(toExists, `To node "${to?.name}" does not exist in graph`);

		const connection = {
			...connectionInput,
			type: connectionInput.type ?? 'main',
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
		const nodeExists = this.nodes.get(node?.name) === node;
		assert.ok(nodeExists, `Node "${node?.name}" does not exist in graph`);

		const directChildren = [];
		for (const connection of this.connections.values()) {
			if (connection.from !== node) continue;
			directChildren.push(connection);
		}
		return directChildren;
	}

	#getChildrenRecursive(node, children) {
		const directChildren = this.getDirectChildConnections(node);
		for (const directChild of directChildren) {
			if (children.has(directChild.to)) continue;
			children.add(directChild.to);
			this.#getChildrenRecursive(directChild.to, children);
		}
		return children;
	}

	getChildren(node) {
		return this.#getChildrenRecursive(node, new Set());
	}

	getDirectParentConnections(node) {
		const nodeExists = this.nodes.get(node?.name) === node;
		assert.ok(nodeExists, `Node "${node?.name}" does not exist in graph`);

		const directParents = [];
		for (const connection of this.connections.values()) {
			if (connection.to !== node) continue;
			directParents.push(connection);
		}
		return directParents;
	}

	#getParentConnectionsRecursive(node, connections) {
		const parentConnections = this.getDirectParentConnections(node);
		for (const connection of parentConnections) {
			if (connections.has(connection)) continue;
			connections.add(connection);
			this.#getParentConnectionsRecursive(connection.from, connections);
		}
		return connections;
	}

	getParentConnections(node) {
		return this.#getParentConnectionsRecursive(node, new Set());
	}

	getConnection(from, outputIndex, type, inputIndex, to) {
		return this.connections.get(
			this.makeKey({
				from,
				outputIndex,
				type,
				inputIndex,
				to,
			}),
		);
	}

	getStronglyConnectedComponents() {
		let id = 0;
		const visited = new Set();
		const ids = new Map();
		const lowLinkValues = new Map();
		const stack = [];
		const stronglyConnectedComponents = [];

		const followNode = (node) => {
			if (visited.has(node)) return;

			visited.add(node);
			lowLinkValues.set(node, id);
			ids.set(node, id);
			id++;
			stack.push(node);

			const directChildren = this.getDirectChildConnections(node).map((c) => c.to);
			for (const child of directChildren) {
				followNode(child);

				if (stack.includes(child)) {
					const childLowLinkValue = lowLinkValues.get(child);
					const ownLowLinkValue = lowLinkValues.get(node);
					assert.ok(childLowLinkValue !== undefined);
					assert.ok(ownLowLinkValue !== undefined);
					const lowestLowLinkValue = Math.min(childLowLinkValue, ownLowLinkValue);
					lowLinkValues.set(node, lowestLowLinkValue);
				}
			}

			const ownId = ids.get(node);
			const ownLowLinkValue = lowLinkValues.get(node);
			assert.ok(ownId !== undefined);
			assert.ok(ownLowLinkValue !== undefined);

			if (ownId === ownLowLinkValue) {
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

	#depthFirstSearchRecursive(from, fn, seen) {
		if (seen.has(from)) return undefined;
		seen.add(from);

		if (fn(from)) return from;

		for (const childConnection of this.getDirectChildConnections(from)) {
			const found = this.#depthFirstSearchRecursive(childConnection.to, fn, seen);
			if (found) return found;
		}

		return undefined;
	}

	depthFirstSearch({ from, fn }) {
		return this.#depthFirstSearchRecursive(from, fn, new Set());
	}

	toWorkflow(parameters = {}) {
		const WorkflowClass = parameters?.WorkflowClass ?? ReconstructedWorkflow;
		return new WorkflowClass({
			...parameters,
			nodes: [...this.nodes.values()],
			connections: this.toIConnections(),
		});
	}

	static fromWorkflow(workflow) {
		const graph = new DirectedGraph();
		graph.addNodes(...Object.values(workflow.nodes));

		for (const [fromNodeName, iConnection] of Object.entries(workflow.connectionsBySourceNode ?? {})) {
			const from = workflow.getNode(fromNodeName);
			assert.ok(from, `From node "${fromNodeName}" does not exist in workflow`);

			for (const [outputType, outputs] of Object.entries(iConnection ?? {})) {
				for (const [outputIndex, conns] of (outputs ?? []).entries()) {
					for (const conn of conns ?? []) {
						const to = workflow.getNode(conn.node);
						assert.ok(to, `To node "${conn.node}" does not exist in workflow`);

						graph.addConnection({
							from,
							to,
							type: outputType,
							outputIndex,
							inputIndex: conn.index ?? 0,
						});
					}
				}
			}
		}

		return graph;
	}

	static fromNodesAndConnections(nodes, connections) {
		const graph = new DirectedGraph();
		graph.addNodes(...nodes);

		const nodeMap = new Map();
		for (const node of nodes) {
			nodeMap.set(node.name, node);
		}

		for (const [fromNodeName, iConnection] of Object.entries(connections ?? {})) {
			const from = nodeMap.get(fromNodeName);
			assert.ok(from, `From node "${fromNodeName}" does not exist in nodes`);

			for (const [outputType, outputs] of Object.entries(iConnection ?? {})) {
				for (const [outputIndex, conns] of (outputs ?? []).entries()) {
					for (const conn of conns ?? []) {
						const to = nodeMap.get(conn.node);
						assert.ok(to, `To node "${conn.node}" does not exist in nodes`);

						graph.addConnection({
							from,
							to,
							type: outputType,
							outputIndex,
							inputIndex: conn.index ?? 0,
						});
					}
				}
			}
		}

		return graph;
	}

	clone() {
		const cloned = new DirectedGraph();
		cloned.addNodes(...this.getNodes().values());
		cloned.addConnections(...this.getConnections().values());
		return cloned;
	}

	toIConnections() {
		const result = {};

		for (const connection of this.connections.values()) {
			const { from, to, type, outputIndex, inputIndex } = connection;

			result[from.name] ??= {};
			result[from.name][type] ??= [];
			result[from.name][type][outputIndex] ??= [];

			result[from.name][type][outputIndex].push({
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
 * Removes disabled nodes from graph, reconnecting main connections if needed.
 */
export function filterDisabledNodes(graph) {
	const filteredGraph = graph.clone();

	for (const node of filteredGraph.getNodes().values()) {
		if (node.disabled) {
			filteredGraph.removeNode(node, {
				reconnectConnections: true,
				skipConnectionFn: (c) => c.type !== 'main',
			});
		}
	}

	return filteredGraph;
}

/**
 * Rewires graph to route tool node to virtual tool executor.
 */
export function rewireGraph(tool, graph, agentRequest) {
	const modifiedGraph = graph.clone();
	const children = modifiedGraph.getChildren(tool);

	if (children.size === 0) {
		return graph;
	}

	const rootNode = [...children][children.size - 1];
	assert.ok(rootNode);

	const allIncomingConnection = modifiedGraph
		.getDirectParentConnections(rootNode)
		.filter((cn) => cn.type === 'main');

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
	tool.rewireOutputLogTo = 'ai_tool';
	modifiedGraph.addConnection({ from: tool, to: toolExecutor, type: 'ai_tool' });

	// Rewire all incoming connections to virtual agent
	for (const cn of allIncomingConnection) {
		modifiedGraph.addConnection({ from: cn.from, to: toolExecutor, type: cn.type });
	}

	// Remove original agent node
	modifiedGraph.removeNode(rootNode);

	return modifiedGraph;
}

export function addWaitingExecution(
	waitingExecution,
	nodeName,
	runIndex,
	inputType,
	inputIndex,
	executionData,
) {
	const waitingExecutionObject = (waitingExecution[nodeName] ??= {});
	const taskDataConnections = (waitingExecutionObject[runIndex] ??= {});
	const executionDataList = (taskDataConnections[inputType] ??= []);

	executionDataList[inputIndex] = executionData;
}

export function addWaitingExecutionSource(
	waitingExecutionSource,
	nodeName,
	runIndex,
	inputType,
	inputIndex,
	sourceData,
) {
	const waitingExecutionSourceObject = (waitingExecutionSource[nodeName] ??= {});
	const taskDataConnectionsSource = (waitingExecutionSourceObject[runIndex] ??= {});
	const sourceDataList = (taskDataConnectionsSource[inputType] ??= []);

	sourceDataList[inputIndex] = sourceData;
}

export function getIncomingData(runData, nodeName, runIndex, connectionType, outputIndex) {
	const runs = runData[nodeName];
	if (!runs) return null;
	const run = runIndex < 0 ? runs[runs.length + runIndex] : runs[runIndex];
	const data = run?.data?.[connectionType];
	if (!data) return null;
	const output = outputIndex < 0 ? data[data.length + outputIndex] : data[outputIndex];
	return output ?? null;
}

function getRunIndexLength(runData, nodeName) {
	return runData[nodeName]?.length ?? 0;
}

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

function sortByInputIndexThenByName(connection1, connection2) {
	if (connection1.inputIndex === connection2.inputIndex) {
		return connection1.from.name.localeCompare(connection2.from.name);
	}
	return connection1.inputIndex - connection2.inputIndex;
}

export function getSourceDataGroups(graph, node, runData = {}, pinnedData = {}) {
	const connections = graph.getConnections({ to: node });

	const sortedConnectionsWithData = [];
	const sortedConnectionsWithoutData = [];

	for (const connection of connections) {
		const hasData = runData[connection.from.name] || pinnedData[connection.from.name];

		if (hasData) {
			sortedConnectionsWithData.push(connection);
		} else if (connection.type === 'main') {
			sortedConnectionsWithoutData.push(connection);
		}
	}

	if (sortedConnectionsWithData.length === 0 && sortedConnectionsWithoutData.length === 0) {
		return [];
	}

	sortedConnectionsWithData.sort(sortByInputIndexThenByName);
	sortedConnectionsWithoutData.sort(sortByInputIndexThenByName);

	const groups = [];
	let currentGroup = { complete: true, connections: [] };
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
		currentGroup = { complete: true, connections: [] };
		currentInputIndex =
			Math.min(
				...sortedConnectionsWithData.map((c) => c.inputIndex),
				...sortedConnectionsWithoutData.map((c) => c.inputIndex),
			) - 1;
	}

	groups.push(currentGroup);
	return groups;
}

/**
 * Recreates nodeExecutionStack, waitingExecution, and waitingExecutionSource from graph.
 */
export function recreateNodeExecutionStack(
	graph,
	startNodes,
	runData = {},
	pinData = {},
) {
	for (const node of graph.getNodes().values()) {
		assert.notEqual(
			node.disabled,
			true,
			`Graph contains disabled nodes. This is not supported. Make sure to pass the graph through "findSubgraph" before calling "recreateNodeExecutionStack". The node in question is "${node.name}"`,
		);
	}

	const nodeExecutionStack = [];
	const waitingExecution = {};
	const waitingExecutionSource = {};

	for (const startNode of startNodes) {
		const incomingStartNodeConnections = graph
			.getDirectParentConnections(startNode)
			.filter((c) => c.type === 'main');

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
					incomingData = [];
					incomingSourceData = { main: [] };

					for (const incomingConnection of sourceData.connections) {
						let runIndex = 0;
						const sourceNode = incomingConnection.from;

						if (pinData[sourceNode.name]) {
							incomingData.push(pinData[sourceNode.name]);
						} else {
							assert.ok(
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

const isTriggerNode = (nodeType) => nodeType?.description?.group?.includes('trigger') ?? false;

function findAllParentTriggers(workflow, destinationNodeName) {
	const parentNodes = workflow
		.getParentNodes(destinationNodeName)
		.map((name) => {
			const node = workflow.getNode(name);
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

export function findTriggerForPartialExecution(
	workflow,
	destinationNodeName,
	runData = {},
) {
	const destinationNode = workflow.getNode(destinationNodeName);
	if (!destinationNode) return undefined;

	const destinationNodeType = workflow.nodeTypes?.getByNameAndVersion?.(
		destinationNode.type,
		destinationNode.typeVersion,
	);

	if (isTriggerNode(destinationNodeType) && !destinationNode.disabled) {
		return destinationNode;
	}

	const parentTriggers = findAllParentTriggers(workflow, destinationNodeName).filter(
		(trigger) => !trigger.disabled,
	);

	for (const trigger of parentTriggers) {
		if (runData[trigger.name]) {
			return trigger;
		}
	}

	const pinnedTriggers = parentTriggers
		.filter((trigger) => workflow.pinData?.[trigger.name])
		.sort((a, b) => (a.type.endsWith('webhook') ? -1 : b.type.endsWith('webhook') ? 1 : 0));
	if (pinnedTriggers.length) {
		return pinnedTriggers[0];
	}

	const webhookTriggers = parentTriggers.filter((trigger) => trigger.type.endsWith('webhook'));
	return webhookTriggers.length > 0 ? webhookTriggers[0] : parentTriggers[0];
}

function findSubgraphRecursive(
	graph,
	destinationNode,
	current,
	trigger,
	newGraph,
	currentBranch,
) {
	if (current === trigger) {
		newGraph.addNode(trigger);
		for (const connection of currentBranch) {
			newGraph.addNodes(connection.from, connection.to);
			newGraph.addConnection(connection);
		}
		return;
	}

	const parentConnections = graph.getDirectParentConnections(current);
	if (parentConnections.length === 0) return;

	const isCycleWithDestinationNode =
		current === destinationNode && currentBranch.some((c) => c.to === destinationNode);
	if (isCycleWithDestinationNode) return;

	const isCycleWithCurrentNode = currentBranch.some((c) => c.to === current);
	if (isCycleWithCurrentNode) {
		for (const connection of currentBranch) {
			newGraph.addNodes(connection.from, connection.to);
			newGraph.addConnection(connection);
		}
		return;
	}

	for (const parentConnection of parentConnections) {
		if (parentConnection.type !== 'main') continue;

		findSubgraphRecursive(graph, destinationNode, parentConnection.from, trigger, newGraph, [
			...currentBranch,
			parentConnection,
		]);
	}
}

export function findSubgraph({ graph, destination, trigger }) {
	const subgraph = new DirectedGraph();
	findSubgraphRecursive(graph, destination, destination, trigger, subgraph, []);

	for (const node of subgraph.getNodes().values()) {
		const parentConnections = graph.getParentConnections(node);

		for (const connection of parentConnections) {
			if (connection.type === 'main') continue;

			subgraph.addNodes(connection.from, connection.to);
			subgraph.addConnection(connection);
		}
	}

	return subgraph;
}

export function isDirty(node, runData = {}, pinData = {}) {
	if (pinData[node.name] !== undefined) return false;
	if (runData?.[node.name]) return false;
	return true;
}

function isALoop(graph, node) {
	return graph.getChildren(node).has(node);
}

function findStartNodesRecursive(
	graph,
	current,
	destination,
	runData,
	pinData,
	startNodes,
	seen,
) {
	const nodeIsDirty = isDirty(current, runData, pinData);

	if (nodeIsDirty) {
		startNodes.add(current);
		return startNodes;
	}

	if (current === destination) {
		startNodes.add(current);
		return startNodes;
	}

	if (current.type === 'n8n-nodes-base.splitInBatches') {
		const nodeRunData = getIncomingData(
			runData,
			current.name,
			-1,
			'main',
			isALoop(graph, current) ? 0 : 1,
		);

		if (nodeRunData === null || nodeRunData.length === 0) {
			startNodes.add(current);
			return startNodes;
		}
	}

	if (seen.has(current)) {
		return startNodes;
	}

	const outGoingConnections = graph.getDirectChildConnections(current);
	for (const outGoingConnection of outGoingConnections) {
		const nodeRunData = getIncomingDataFromAnyRun(
			runData,
			outGoingConnection.from.name,
			outGoingConnection.type,
			outGoingConnection.outputIndex,
		);

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

export function findStartNodes({ graph, trigger, destination, pinData = {}, runData = {} }) {
	return findStartNodesRecursive(
		graph,
		trigger,
		destination,
		{ ...runData },
		pinData,
		new Set(),
		new Set(),
	);
}

export function handleCycles(graph, startNodes, trigger) {
	const cycles = graph.getStronglyConnectedComponents().filter((cycle) => cycle.size >= 1);
	const newStartNodes = new Set(startNodes);

	if (cycles.length === 0) {
		return newStartNodes;
	}

	for (const startNode of startNodes) {
		for (const cycle of cycles) {
			if (cycle.has(startNode)) {
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

export function cleanRunData(runData = {}, graph, nodesToClean = new Set()) {
	const newRunData = { ...runData };

	for (const nodeToClean of nodesToClean) {
		delete newRunData[nodeToClean.name];

		const children = graph.getChildren(nodeToClean);
		for (const node of [nodeToClean, ...children]) {
			delete newRunData[node.name];

			const subNodeConnections = graph.getParentConnections(node);
			for (const subNodeConnection of subNodeConnections) {
				if (subNodeConnection.type === 'main') continue;
				delete newRunData[subNodeConnection.from.name];
			}
		}
	}

	for (const nodeName of Object.keys(newRunData)) {
		if (!graph.hasNode(nodeName)) {
			delete newRunData[nodeName];
		}
	}

	return newRunData;
}
