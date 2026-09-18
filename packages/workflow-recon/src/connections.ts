/**
 * Connection indexes + traversals — 1:1 reconstruction.
 *
 * Reference (n8n 2.9.4, `reference/n8n/packages/workflow/src/common/`):
 *   map-connections-by-destination.ts   -> mapConnectionsByDestination
 *   get-connected-nodes.ts              -> getConnectedNodes
 *   get-child-nodes.ts                  -> getChildNodes
 *   get-parent-nodes.ts                 -> getParentNodes
 *   get-node-by-name.ts                 -> getNodeByName
 *
 * FIDELITY NOTES — the quirks below are the reference's behaviour, not oversights.
 * They are reproduced on purpose and each is pinned by a test:
 *
 *  1. `getConnectedNodes` decrements depth *before* the `depth === 0` guard
 *     (`newDepth` is computed first, the guard still tests the incoming value).
 *  2. The inner re-ordering loop is written `for (i = addNodes.length; i--; i > 0)`
 *     in the reference — the third expression is a no-op, so the loop body runs
 *     for `i = length-1 … 0`. Kept verbatim; "fixing" it would change ordering.
 *  3. `mapConnectionsByDestination` may leave `undefined` holes inside a slot
 *     array when `connection.index` skips a value (`[index]?.push(...)`).
 *  4. `disabled` is NOT consulted here. Parent/child sets include disabled nodes;
 *     only `getHighestNode` and `__getStartNode` skip them. See
 *     `docs/isolation/workflow-disabled-fidelity.md`.
 */
import { MAIN_CONNECTION_TYPE } from './constants.ts';
import type {
	IConnection,
	IConnections,
	INode,
	INodes,
	NodeConnectionType,
} from './types.ts';

/** `common/map-connections-by-destination.ts` (identical to `Workflow.getConnectionsByDestination`). */
export function mapConnectionsByDestination(connections: IConnections): IConnections {
	const returnConnection: IConnections = {};

	let connectionInfo: IConnection;
	let maxIndex: number;
	for (const sourceNode in connections) {
		if (!connections.hasOwnProperty(sourceNode)) {
			continue;
		}

		for (const type of Object.keys(connections[sourceNode]) as NodeConnectionType[]) {
			if (!connections[sourceNode].hasOwnProperty(type)) {
				continue;
			}

			for (const inputIndex in connections[sourceNode][type]) {
				if (!connections[sourceNode][type].hasOwnProperty(inputIndex)) {
					continue;
				}

				for (connectionInfo of connections[sourceNode][type][inputIndex] ?? []) {
					if (!returnConnection.hasOwnProperty(connectionInfo.node)) {
						returnConnection[connectionInfo.node] = {} as IConnections[string];
					}
					if (!returnConnection[connectionInfo.node].hasOwnProperty(connectionInfo.type)) {
						returnConnection[connectionInfo.node][connectionInfo.type] = [];
					}

					maxIndex = returnConnection[connectionInfo.node][connectionInfo.type].length - 1;
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

/** `common/get-connected-nodes.ts`. */
export function getConnectedNodes(
	connections: IConnections,
	nodeName: string,
	connectionType: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = MAIN_CONNECTION_TYPE,
	depth = -1,
	checkedNodesIncoming?: string[],
): string[] {
	const newDepth = depth === -1 ? depth : depth - 1;
	if (depth === 0) {
		// Reached max depth
		return [];
	}

	if (!connections.hasOwnProperty(nodeName)) {
		// Node does not have incoming connections
		return [];
	}

	let types: NodeConnectionType[];
	if (connectionType === 'ALL') {
		types = Object.keys(connections[nodeName]) as NodeConnectionType[];
	} else if (connectionType === 'ALL_NON_MAIN') {
		types = Object.keys(connections[nodeName]).filter((type) => type !== 'main');
	} else {
		types = [connectionType];
	}

	let addNodes: string[];
	let nodeIndex: number;
	let i: number;
	let parentNodeName: string;
	const returnNodes: string[] = [];

	types.forEach((type) => {
		if (!connections[nodeName].hasOwnProperty(type)) {
			// Node does not have incoming connections of given type
			return;
		}

		const checkedNodes = checkedNodesIncoming ? [...checkedNodesIncoming] : [];

		if (checkedNodes.includes(nodeName)) {
			// Node got checked already before
			return;
		}

		checkedNodes.push(nodeName);

		connections[nodeName][type].forEach((connectionsByIndex) => {
			connectionsByIndex?.forEach((connection) => {
				if (checkedNodes.includes(connection.node)) {
					// Node got checked already before
					return;
				}

				returnNodes.unshift(connection.node);

				addNodes = getConnectedNodes(
					connections,
					connection.node,
					connectionType,
					newDepth,
					checkedNodes,
				);

				for (i = addNodes.length; i--; i > 0) {
					// Because nodes can have multiple parents it is possible that
					// parts of the tree is parent of both and to not add nodes
					// twice check first if they already got added before.
					parentNodeName = addNodes[i];
					nodeIndex = returnNodes.indexOf(parentNodeName);

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

/** `common/get-child-nodes.ts`. */
export function getChildNodes(
	connectionsBySourceNode: IConnections,
	nodeName: string,
	type: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = MAIN_CONNECTION_TYPE,
	depth = -1,
): string[] {
	return getConnectedNodes(connectionsBySourceNode, nodeName, type, depth);
}

/** `common/get-parent-nodes.ts`. */
export function getParentNodes(
	connectionsByDestinationNode: IConnections,
	nodeName: string,
	type: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = MAIN_CONNECTION_TYPE,
	depth = -1,
): string[] {
	return getConnectedNodes(connectionsByDestinationNode, nodeName, type, depth);
}

/** `common/get-node-by-name.ts`. */
export function getNodeByName(nodes: INodes | INode[], name: string): INode | null {
	if (Array.isArray(nodes)) {
		return nodes.find((node) => node.name === name) || null;
	}

	if (nodes.hasOwnProperty(name)) {
		return nodes[name];
	}

	return null;
}
