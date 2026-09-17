import { NodeConnectionTypes } from './interfaces';
import type { IConnections, NodeConnectionType } from './interfaces';

/**
 * Gets all the nodes which are connected nodes starting from the given one.
 *
 * 1:1 reconstruction of `reference/n8n/packages/workflow/src/common/get-connected-nodes.ts`
 * (n8n 2.9.4, commit `b6dc2787c45677a29a9612cd27eb911302961a83`).
 *
 * The result **order is part of the contract**, not an implementation detail. It is pinned by
 * the `traversal` section of `tests/reference/workflow-rust/fixtures.json` (9 cases) and by
 * `tests/reference/connection/01-linear|02-multi-output|03-connection-types|04-cycle`. The
 * reference produces "farthest first" through `unshift` plus a de-duplicating `splice`:
 *
 * - `returnNodes.unshift(connection.node)` — a child is prepended, so deeper nodes end up
 *   ahead of shallower ones;
 * - when a node turns out to be reachable from more than one path, the earlier copy is
 *   spliced out and the node is prepended again, which is what keeps the order stable
 *   (`get-connected-nodes.ts:76-90`);
 * - `checkedNodes` is cloned per connection type, so the visited-set does **not** leak
 *   between types (`get-connected-nodes.ts:44`).
 *
 * Two reference quirks are reproduced deliberately, because the contract forbids a port from
 * fixing them:
 *
 * 1. `for (i = addNodes.length; i--; i > 0)` — the third expression is a **no-op** in the
 *    reference. The loop still terminates because `i--` is the condition. Reproduced verbatim.
 * 2. `depth === 0` returns `[]`, and the decrement happens before the guard, so `depth = -1`
 *    means "unlimited" while `depth = 0` means "nothing" (`get-connected-nodes.ts:14-19`).
 */
export function getConnectedNodes(
	connections: IConnections,
	nodeName: string,
	connectionType: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = NodeConnectionTypes.Main,
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
		types = Object.keys(connections[nodeName]).filter(
			(type) => type !== 'main',
		) as NodeConnectionType[];
	} else {
		types = [connectionType];
	}

	let addNodes: string[] = [];
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
