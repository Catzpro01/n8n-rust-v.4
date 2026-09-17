/**
 * Graph traversal for the reconstructed engine.
 *
 * PROJECT_RULES.md rule 1 (ZERO RUST): 1:1 port from the n8n 2.9.4 source, line-for-line.
 *
 *   reference/n8n/packages/workflow/src/common/get-connected-nodes.ts:11-95   getConnectedNodes
 *   reference/n8n/packages/workflow/src/common/get-parent-nodes.ts:11-18      getParentNodes
 *   reference/n8n/packages/workflow/src/workflow.ts:590-596                   Workflow#getParentNodes
 *
 * `getParentNodes` is what the execution engine's waiting-node release pass uses
 * (`workflow-execute.ts:2136`) — it needs ALL ancestors, not just the direct predecessors,
 * otherwise a node can be released while a grand-parent is still waiting for its own inputs.
 */

/** `NodeConnectionTypes.Main` (interfaces.ts) — the only connection type the engine walks. */
const MAIN = 'main';

/**
 * 1:1 port of `common/get-connected-nodes.ts:11-95`.
 *
 * @param {object} connections connection map to walk (by-destination for parents, by-source for children)
 * @param {string} nodeName
 * @param {'main'|'ALL'|'ALL_NON_MAIN'|string} connectionType
 * @param {number} depth -1 = unlimited
 * @param {string[]|undefined} checkedNodesIncoming cycle protection shared across the recursion
 * @returns {string[]}
 */
export function getConnectedNodes(
	connections,
	nodeName,
	connectionType = 'main',
	depth = -1,
	checkedNodesIncoming,
) {
	const newDepth = depth === -1 ? depth : depth - 1;
	if (depth === 0) {
		// Reached max depth
		return [];
	}

	if (!Object.prototype.hasOwnProperty.call(connections, nodeName)) {
		// Node does not have incoming connections
		return [];
	}

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
		if (!Object.prototype.hasOwnProperty.call(connections[nodeName], type)) {
			// Node does not have incoming connections of given type
			return;
		}

		const checkedNodes = checkedNodesIncoming ? [...checkedNodesIncoming] : [];

		if (checkedNodes.includes(nodeName)) {
			// Node got checked already before
			return;
		}

		checkedNodes.push(nodeName);

		(connections[nodeName][type] ?? []).forEach((connectionsByIndex) => {
			connectionsByIndex?.forEach((connection) => {
				if (checkedNodes.includes(connection.node)) {
					// Node got checked already before
					return;
				}

				returnNodes.unshift(connection.node);

				const addNodes = getConnectedNodes(
					connections,
					connection.node,
					connectionType,
					newDepth,
					checkedNodes,
				);

				for (let i = addNodes.length; i--; i > 0) {
					// Because nodes can have multiple parents it is possible that
					// parts of the tree is parent of both and to not add nodes
					// twice check first if they already got added before.
					const parentNodeName = addNodes[i];
					const nodeIndex = returnNodes.indexOf(parentNodeName);

					if (nodeIndex !== -1) {
						// Node got found before so remove it from current location
						// that node-order stays correct
						returnNodes.splice(nodeIndex, 1);
					}

					returnNodes.unshift(parentNodeName);
				}
			});
		});
	});

	return returnNodes;
}

/** 1:1 port of `common/get-parent-nodes.ts:11-18`. */
export function getParentNodes(connectionsByDestinationNode, nodeName, type = 'main', depth = -1) {
	return getConnectedNodes(connectionsByDestinationNode, nodeName, type, depth);
}

/**
 * 1:1 port of `workflow.ts:492-568` (`Workflow#getHighestNode`).
 *
 * "Highest" = the root-most nodes that feed `nodeName`, i.e. the ancestors that have no incoming
 * connection of their own and are not disabled. The execution engine needs it in `ensureInputData`
 * (`workflow-execute.ts:2317-2325`): when every node feeding an input is disabled there is no data
 * to wait for and the node runs as-is.
 *
 * Two details of the reference are load-bearing and easy to "simplify" away:
 *   - a node that is itself NOT disabled is its own highest node (`:498-501`), and the walk still
 *     continues, so the result can contain both the node and its ancestors;
 *   - `checkedNodes` is shared across the recursion as cycle protection (`:514-521`).
 *
 * @param {Map<string,object>|object} nodes node lookup — a Map (the engine) or a plain object
 * @param {object} connectionsByDestinationNode
 * @param {string} nodeName
 * @param {number|undefined} nodeConnectionIndex restrict the walk to one input slot
 * @param {string[]|undefined} checkedNodes
 * @returns {string[]}
 */
export function getHighestNode(
	nodes,
	connectionsByDestinationNode,
	nodeName,
	nodeConnectionIndex,
	checkedNodes,
) {
	const nodeAt = (name) => (nodes instanceof Map ? nodes.get(name) : nodes?.[name]);
	const hasNode = (name) =>
		nodes instanceof Map ? nodes.has(name) : Object.prototype.hasOwnProperty.call(nodes ?? {}, name);

	const currentHighest = [];
	if (nodeAt(nodeName)?.disabled === false) {
		// If the current node is not disabled itself is the highest
		currentHighest.push(nodeName);
	}

	if (!Object.prototype.hasOwnProperty.call(connectionsByDestinationNode, nodeName)) {
		// Node does not have incoming connections
		return currentHighest;
	}

	if (!Object.prototype.hasOwnProperty.call(connectionsByDestinationNode[nodeName], MAIN)) {
		// Node does not have incoming connections of given type
		return currentHighest;
	}

	checkedNodes = checkedNodes || [];

	if (checkedNodes.includes(nodeName)) {
		// Node got checked already before
		return currentHighest;
	}

	checkedNodes.push(nodeName);

	const returnNodes = [];
	let addNodes;

	let connectionsByIndex;
	for (
		let connectionIndex = 0;
		connectionIndex < connectionsByDestinationNode[nodeName][MAIN].length;
		connectionIndex++
	) {
		if (nodeConnectionIndex !== undefined && nodeConnectionIndex !== connectionIndex) {
			// If a connection-index is given ignore all other ones
			continue;
		}
		connectionsByIndex = connectionsByDestinationNode[nodeName][MAIN][connectionIndex];

		connectionsByIndex?.forEach((connection) => {
			if (checkedNodes.includes(connection.node)) {
				// Node got checked already before
				return;
			}

			// Ignore connections for nodes that don't exist in this workflow
			if (!hasNode(connection.node)) return;

			addNodes = getHighestNode(nodes, connectionsByDestinationNode, connection.node, undefined, checkedNodes);

			if (addNodes.length === 0) {
				// The checked node does not have any further parents so add it
				// if it is not disabled
				if (nodeAt(connection.node)?.disabled !== true) {
					addNodes = [connection.node];
				}
			}

			addNodes.forEach((name) => {
				// Only add if node is not on the list already anyway
				if (returnNodes.indexOf(name) === -1) {
					returnNodes.push(name);
				}
			});
		});
	}

	return returnNodes;
}
