/**
 * Minimal Workflow scaffold — the exact object surface `WorkflowExecute`
 * consumes (n8n-workflow `Workflow`, reference/n8n/packages/workflow/src/workflow.ts).
 *
 * TEMPORARY: TASK-PIPE-01 (Agent 1, "Topological DAG Resolution & Execution Stack
 * Initialization") owns the full native Workflow model. Until it lands, this
 * scaffold provides the loop-consumed members, ported 1:1 where copied:
 *   - connectionsBySourceNode / connectionsByDestinationNode (Workflow ctor wiring)
 *   - getHighestNode (workflow.ts:492-573)
 *   - getParentNodes / getChildNodes (common/get-connected-nodes.ts)
 *   - getStartNode / __getStartNode (workflow.ts:826-867) — reduced
 *     STARTING_NODE_TYPES list (no langchain types registered here yet)
 */

export const NodeConnectionTypes = Object.freeze({ Main: 'main', AiTool: 'ai_tool' });

/**
 * 1:1 port of reference/n8n/packages/workflow/src/common/map-connections-by-destination.ts
 * Reverses every edge: destination side stores {node: SOURCE, type, index: SOURCE OUTPUT INDEX},
 * with gap padding for skipped input indexes.
 * @param {object} connections connectionsBySourceNode
 */
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

					const maxIndex = returnConnection[connectionInfo.node][connectionInfo.type].length - 1;
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

export const STARTING_NODE_TYPES = [
	'n8n-nodes-base.manualTrigger',
	'n8n-nodes-base.executeWorkflowTrigger',
	'n8n-nodes-base.errorTrigger',
	'n8n-nodes-base.evaluationTrigger',
	'n8n-nodes-base.formTrigger',
];

/**
 * @param {object} params
 * @param {Array<object>} params.nodes workflow JSON nodes
 * @param {object} params.connections workflow JSON connections { [source]: { [type]: Array<Array<{node,type,index}>> } }
 * @param {Map<string, object>|object} params.nodeTypes map type-name -> INodeType-like {description, execute?, trigger?, poll?, webhook?}
 * @param {object} [params.settings] workflow settings (executionOrder, binaryMode, ...)
 * @param {string|number} [params.id]
 */
export function createWorkflow({ nodes, connections = {}, nodeTypes, settings = {}, id }) {
	// name -> node map (reference Workflow keeps INode[] and this.nodes as map)
	const nodesByName = {};
	for (const node of nodes) {
		if (node.disabled === undefined) node.disabled = false;
		nodesByName[node.name] = node;
	}

	const typesMap = nodeTypes instanceof Map ? nodeTypes : new Map(Object.entries(nodeTypes ?? {}));

	/** @param {string} name @param {object} [fallback] */
	const getNode = (name, fallback) => nodesByName[name] ?? fallback;

	const nodeTypesRegistry = {
		/**
		 * Reference NodeTypes.getByNameAndVersion resolves the highest known
		 * version <= node.typeVersion. Scaffold: exact match, else the sole
		 * registered version for that type name (documented deviation).
		 */
		getByNameAndVersion(type, typeVersion) {
			if (typesMap.has(type)) {
				const t = typesMap.get(type);
				if (t?.description?.version && typeVersion && t.description.version > typeVersion) {
					return t; // still closest match in this scaffold
				}
				return t;
			}
			return undefined;
		},
		get(node) {
			return nodeTypesRegistry.getByNameAndVersion(node.type, node.typeVersion);
		},
	};

	// --- connection maps (1:1 port of Workflow.setConnections, workflow.ts:146-149) -----
	// connectionsBySourceNode IS the raw workflow JSON connections
	// ({ [source]: { [type]: Array<Array<IConnection>> } }); the destination map
	// is derived by reversing each edge (common/map-connections-by-destination.ts).
	const connectionsBySourceNode = connections ?? {};
	const connectionsByDestinationNode = mapConnectionsByDestination(connectionsBySourceNode);

	// --- getConnectedNodes (1:1 port of common/get-connected-nodes.ts) ---------
	function getConnectedNodes(connections, nodeName, connectionType = 'main', depth = -1, checkedNodesIncoming) {
		const newDepth = depth === -1 ? depth : depth - 1;
		if (depth === 0) return [];
		if (!Object.hasOwn(connections, nodeName)) return [];

		let types;
		if (connectionType === 'ALL') {
			types = Object.keys(connections[nodeName]);
		} else if (connectionType === 'ALL_NON_MAIN') {
			types = Object.keys(connections[nodeName]).filter((t) => t !== 'main');
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

					const addNodes = getConnectedNodes(
						connections,
						connection.node,
						connectionType,
						newDepth,
						checkedNodes,
					);

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

	// --- getHighestNode (1:1 port of workflow.ts:492-573) ----------------------
	function getHighestNode(nodeName, nodeConnectionIndex, checkedNodes) {
		const currentHighest = [];
		if (nodesByName[nodeName] && nodesByName[nodeName].disabled === false) {
			currentHighest.push(nodeName);
		}
		if (
			!Object.hasOwn(connectionsByDestinationNode, nodeName) ||
			!Object.hasOwn(connectionsByDestinationNode[nodeName], NodeConnectionTypes.Main)
		) {
			return currentHighest;
		}

		checkedNodes = checkedNodes || [];
		if (checkedNodes.includes(nodeName)) return currentHighest;
		checkedNodes.push(nodeName);

		const returnNodes = [];
		const mainInputs = connectionsByDestinationNode[nodeName][NodeConnectionTypes.Main];
		for (let connectionIndex = 0; connectionIndex < mainInputs.length; connectionIndex++) {
			if (nodeConnectionIndex !== undefined && nodeConnectionIndex !== connectionIndex) continue;
			const connectionsByIndex = mainInputs[connectionIndex];

			connectionsByIndex?.forEach((connection) => {
				if (checkedNodes.includes(connection.node)) return;
				if (!(connection.node in nodesByName)) return;

				let addNodes = getHighestNode(connection.node, undefined, checkedNodes);
				if (addNodes.length === 0) {
					if (nodesByName[connection.node].disabled !== true) {
						addNodes = [connection.node];
					}
				}
				addNodes.forEach((name) => {
					if (!returnNodes.includes(name)) returnNodes.push(name);
				});
			});
		}

		if (returnNodes.length === 0) {
			// If we did not find any higher nodes, return the current one (if not disabled)
			return currentHighest;
		}
		return returnNodes;
	}

	// --- __getStartNode (reduced port of workflow.ts:826-860) ------------------
	function __getStartNode(nodeNames) {
		if (nodeNames.length === 1) {
			const node = nodesByName[nodeNames[0]];
			if (node && !node.disabled) return node;
		}
		for (const nodeName of nodeNames) {
			const node = nodesByName[nodeName];
			if (!node) continue;
			const nodeType = nodeTypesRegistry.getByNameAndVersion(node.type, node.typeVersion);
			if (nodeType && (nodeType.trigger !== undefined || nodeType.poll !== undefined)) {
				if (node.disabled === true) continue;
				return node;
			}
		}
		const sorted = Object.values(nodesByName).sort(
			(a, b) => STARTING_NODE_TYPES.indexOf(a.type) - STARTING_NODE_TYPES.indexOf(b.type),
		);
		for (const node of sorted) {
			if (STARTING_NODE_TYPES.includes(node.type)) {
				if (node.disabled === true) continue;
				return node;
			}
		}
		return undefined;
	}

	function getStartNode(destinationNode) {
		if (destinationNode) {
			const nodeNames = getHighestNode(destinationNode);
			if (nodeNames.length === 0) nodeNames.push(destinationNode);
			const node = __getStartNode(nodeNames);
			if (node !== undefined) return node;
			return nodesByName[nodeNames[0]];
		}
		return __getStartNode(Object.keys(nodesByName));
	}

	return {
		id,
		settings: { executionOrder: settings.executionOrder, binaryMode: settings.binaryMode, ...settings },
		staticData: { __dataChanged: false },
		nodes: nodesByName,
		nodeTypes: nodeTypesRegistry,
		connectionsBySourceNode,
		connectionsByDestinationNode,
		getNode,
		getStartNode,
		getHighestNode,
		getParentNodes: (nodeName, type = 'main', depth = -1) =>
			getConnectedNodes(connectionsByDestinationNode, nodeName, type, depth),
		getChildNodes: (nodeName, type = 'main', depth = -1) =>
			getConnectedNodes(connectionsBySourceNode, nodeName, type, depth),
	};
}
