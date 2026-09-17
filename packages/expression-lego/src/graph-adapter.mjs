/**
 * Expression LEGO — Workflow graph adapter.
 *
 * The Expression LEGO consumes the Workflow LEGO's graph query API
 * (contracts/workflow.contract.md: getNode, getNodeConnectionIndexes,
 * getParentNodes, getChildNodes, getParentMainInputNode, getPinDataOfNode,
 * nodes, settings, expression). This file is a pure-JS adapter implementing
 * exactly those queries 1:1 from n8n-workflow 2.9.4 src/workflow.ts +
 * src/common/get-connected-nodes.ts so the expression LEGO can be verified
 * standalone (the Workflow LEGO's TypeScript seam is not importable here).
 *
 * The golden runner (test/golden.test.mjs) drives THIS adapter; parity with
 * the real Workflow class is asserted by the reference case expectations.
 */

import { Expression } from './expression.mjs';

/** common/get-connected-nodes.ts */
export function getConnectedNodes(connections, nodeName, connectionType = 'main', depth = -1, checkedNodesIncoming) {
	const newDepth = depth === -1 ? depth : depth - 1;
	if (depth === 0) return [];
	if (!Object.hasOwn(connections, nodeName)) return [];

	let types;
	if (connectionType === 'ALL') {
		types = Object.keys(connections[nodeName]);
	} else if (connectionType === 'ALL_NON_MAIN') {
		types = Object.keys(connections[nodeName]).filter((type) => type !== 'main');
	} else {
		types = [connectionType];
	}

	const returnNodes = [];
	types.forEach((type) => {
		if (!Object.hasOwn(connections[nodeName], type)) return;

		const checkedNodes = checkedNodesIncoming ? [...checkedNodesIncoming] : [];
		if (checkedNodes.includes(nodeName)) return;
		checkedNodes.push(nodeName);

		connections[nodeName][type].forEach((connectionsByIndex) => {
			connectionsByIndex?.forEach((connection) => {
				if (checkedNodes.includes(connection.node)) return;

				returnNodes.unshift(connection.node);

				const addNodes = getConnectedNodes(connections, connection.node, connectionType, newDepth, checkedNodes);
				for (let i = addNodes.length; i--; i > 0) {
					const parentNodeName = addNodes[i];
					const nodeIndex = returnNodes.indexOf(parentNodeName);
					if (nodeIndex !== -1) returnNodes.splice(nodeIndex, 1);
					returnNodes.unshift(parentNodeName);
				}
			});
		});
	});

	return returnNodes;
}

/** workflow.ts getNodeConnectionIndexes */
export function getNodeConnectionIndexes(connectionsByDestinationNode, getNode, nodeName, parentNodeName, type = 'main') {
	const parentNode = getNode(parentNodeName);
	if (parentNode === null) return undefined;

	const visitedNodes = new Set();
	const queue = [nodeName];

	while (queue.length > 0) {
		const currentNodeName = queue.shift();
		if (visitedNodes.has(currentNodeName)) continue;
		visitedNodes.add(currentNodeName);

		const typeConnections = connectionsByDestinationNode[currentNodeName]?.[type];
		if (!typeConnections) continue;

		for (let typedConnectionIdx = 0; typedConnectionIdx < typeConnections.length; typedConnectionIdx++) {
			const connectionsByIndex = typeConnections[typedConnectionIdx];
			if (!connectionsByIndex) continue;

			for (let destinationIndex = 0; destinationIndex < connectionsByIndex.length; destinationIndex++) {
				const connection = connectionsByIndex[destinationIndex];
				if (parentNodeName === connection.node) {
					return { sourceIndex: connection.index, destinationIndex };
				}
				if (!visitedNodes.has(connection.node)) queue.push(connection.node);
			}
		}
	}
	return undefined;
}

/**
 * Adapter exposing the Workflow LEGO surface needed by WorkflowDataProxy.
 * `nodeTypesByName` (optional) maps node type → { outputs } for
 * getParentMainInputNode; unknown types are treated as main-only.
 */
/** common/map-connections-by-destination.ts */
export function mapConnectionsByDestination(connections) {
	const returnConnection = {};
	for (const sourceNode in connections) {
		if (!Object.hasOwn(connections, sourceNode)) continue;
		for (const type of Object.keys(connections[sourceNode])) {
			if (!Object.hasOwn(connections[sourceNode], type)) continue;
			for (const inputIndex in connections[sourceNode][type]) {
				if (!Object.hasOwn(connections[sourceNode][type], inputIndex)) continue;
				for (const connectionInfo of connections[sourceNode][type][inputIndex] ?? []) {
					if (!Object.hasOwn(returnConnection, connectionInfo.node)) {
						returnConnection[connectionInfo.node] = {};
					}
					if (!Object.hasOwn(returnConnection[connectionInfo.node], connectionInfo.type)) {
						returnConnection[connectionInfo.node][connectionInfo.type] = [];
					}
					let maxIndex = returnConnection[connectionInfo.node][connectionInfo.type].length - 1;
					for (let j = maxIndex; j < connectionInfo.index; j++) {
						returnConnection[connectionInfo.node][connectionInfo.type].push([]);
					}
					returnConnection[connectionInfo.node][connectionInfo.type][connectionInfo.index]?.push({
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

export class WorkflowGraphAdapter {
	constructor(workflowData, options = {}) {
		this.nodes = {};
		for (const node of workflowData.nodes ?? []) {
			this.nodes[node.name] = node;
		}
		this.connections = workflowData.connections ?? {};
		this.settings = workflowData.settings ?? {};
		this.id = workflowData.id;
		this.name = workflowData.name;
		this.active = workflowData.active ?? false;
		this.pinData = workflowData.pinData ?? options.pinData ?? {};
		this.nodeTypesByName = options.nodeTypesByName ?? {};

		// workflow.ts setConnections
		this.connectionsBySourceNode = this.connections;
		this.connectionsByDestinationNode = mapConnectionsByDestination(this.connectionsBySourceNode);

		// cyclic dependency: Workflow constructs Expression (dependencies.md D-01/D-02)
		this.expression = new Expression(this);
	}

	getNode(nodeName) {
		return this.nodes[nodeName] ?? null;
	}

	getChildNodes(nodeName, type = 'main', depth = -1) {
		return getConnectedNodes(this.connectionsBySourceNode, nodeName, type, depth);
	}

	getParentNodes(nodeName, type = 'main', depth = -1) {
		return getConnectedNodes(this.connectionsByDestinationNode, nodeName, type, depth);
	}

	getNodeConnectionIndexes(nodeName, parentNodeName, type = 'main') {
		return getNodeConnectionIndexes(
			this.connectionsByDestinationNode,
			(n) => this.getNode(n),
			nodeName,
			parentNodeName,
			type,
		);
	}

	getPinDataOfNode(nodeName) {
		return this.pinData?.[nodeName];
	}

	/** workflow.ts getParentMainInputNode (main-only adapter subset) */
	getParentMainInputNode(node) {
		if (!node) return node;
		const typeDescription = this.nodeTypesByName[node.type];
		if (!typeDescription?.outputs) return node;

		const outputs = typeDescription.outputs;
		const nonMainConnectionTypes = [];
		for (const output of outputs) {
			const type = typeof output === 'string' ? output : output.type;
			if (type !== 'main') nonMainConnectionTypes.push(type);
		}
		nonMainConnectionTypes.sort();

		if (nonMainConnectionTypes.length > 0) {
			const nonMainNodesConnected = [];
			const nodeConnections = this.connectionsBySourceNode[node.name];
			for (const type of nonMainConnectionTypes) {
				if (nodeConnections?.[type]) {
					const childNodes = this.getChildNodes(node.name, type);
					if (childNodes.length > 0) nonMainNodesConnected.push(...childNodes);
				}
			}
			if (nonMainNodesConnected.length) {
				nonMainNodesConnected.sort();
				const returnNode = this.getNode(nonMainNodesConnected[0]);
				if (!returnNode) throw new Error(`Node "${nonMainNodesConnected[0]}" not found`);
				return this.getParentMainInputNode(returnNode);
			}
		}
		return node;
	}
}
