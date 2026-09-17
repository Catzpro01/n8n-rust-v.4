import type { INode, INodes, IConnections } from './interfaces';

/**
 * `Workflow.getHighestNode` / `Workflow.__getStartNode` / `Workflow.getStartNode`
 * — 1:1 port of `reference/n8n/packages/workflow/src/workflow.ts` :495-562 and
 * :817-883 (TASK-DGRAPH-01, ISSUE-015 corrected scope / ISSUE-017 / D-01..D-04).
 *
 * Behavioural core (the reason this is NOT part of the CD-02 plain-traversal port —
 * `graph-utils.ts` has no `disabled` concept):
 * - `getHighestNode` is ASYMMETRIC on purpose: the starting node is tested with the
 *   STRICT `disabled === false` (:498) while a parent is re-added with the LOOSE
 *   `disabled !== true` (:553). A node that merely OMITS the key is therefore not its
 *   own highest node but IS included as a parent (case D-04).
 * - `__getStartNode` skips a manual-chat trigger, then trigger/poll nodes with
 *   `disabled === true → continue` (:839), then the `STARTING_NODE_TYPES` order with
 *   the same strict skip (:853); the single-node shortcut uses LOOSE `!node.disabled`
 *   (:824).
 *
 * Deliberately faithful oddities (do not "clean up"):
 * - the final `STARTING_NODE_TYPES` scan iterates `Object.values(nodes)` — the FULL
 *   map — not the `nodeNames` candidate list it was handed (:847);
 * - `getStartNode(destination)` falls back to `nodes[nodeNames[0]]` — the first
 *   highest node, which may itself be disabled if the whole chain is (:876-881);
 * - connections to nodes that do not exist in the workflow are ignored (:540-541).
 */

/** Reference `constants.ts` :53-59 `STARTING_NODE_TYPES`. */
export const STARTING_NODE_TYPES = [
	'n8n-nodes-base.manualTrigger',
	'n8n-nodes-base.executeWorkflowTrigger',
	'n8n-nodes-base.errorTrigger',
	'n8n-nodes-base.evaluationTrigger',
	'n8n-nodes-base.formTrigger',
] as const;

/** Reference `constants.ts` :87 `MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE`. */
export const MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE = '@n8n/n8n-nodes-langchain.manualChatTrigger';

/** Structural subset of `INodeTypes` the navigation actually needs. */
export interface NodeTypesLike {
	getByNameAndVersion: (
		type: string,
		version?: number,
	) =>
		| {
				description: { name: string; properties?: unknown[] };
				trigger?: unknown;
				poll?: unknown;
		  }
		| undefined;
}

const MAIN = 'main' as const;

/**
 * `Workflow.getHighestNode` — workflow.ts :495-562. Returns the highest non-disabled
 * parent chain of `nodeName` (see the asymmetry note above).
 */
export function getHighestNode(
	nodes: INodes,
	connectionsByDestinationNode: IConnections,
	nodeName: string,
	nodeConnectionIndex?: number,
	checkedNodes?: string[],
): string[] {
	const currentHighest: string[] = [];
	// :498 — STRICT self test (`undefined === false` is false: an omitted key is NOT pushed).
	if (nodes[nodeName].disabled === false) {
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

	const returnNodes: string[] = [];
	let addNodes: string[];

	let connectionsByIndex: { node: string; type: string; index: number }[] | null;
	for (
		let connectionIndex = 0;
		connectionIndex < connectionsByDestinationNode[nodeName][MAIN].length;
		connectionIndex++
	) {
		if (nodeConnectionIndex !== undefined && nodeConnectionIndex !== connectionIndex) {
			// If a connection-index is given ignore all other ones
			continue;
		}
		connectionsByIndex =
			connectionsByDestinationNode[nodeName][MAIN][connectionIndex] as
				| { node: string; type: string; index: number }[]
				| null;

		connectionsByIndex?.forEach((connection) => {
			if (checkedNodes.includes(connection.node)) {
				// Node got checked already before
				return;
			}

			// Ignore connections for nodes that don't exist in this workflow
			if (!(connection.node in nodes)) return;

			addNodes = getHighestNode(nodes, connectionsByDestinationNode, connection.node, undefined, checkedNodes);

			if (addNodes.length === 0) {
				// The checked node does not have any further parents so add it
				// if it is not disabled
				// :553 — LOOSE parent test (`undefined !== true` is true: an omitted key IS included).
				if (nodes[connection.node].disabled !== true) {
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

/**
 * `Workflow.__getStartNode` — workflow.ts :817-858. Note that the final
 * `STARTING_NODE_TYPES` scan walks the FULL node map, not `nodeNames` (:847).
 */
export function __getStartNode(
	nodes: INodes,
	nodeTypes: NodeTypesLike,
	nodeNames: string[],
): INode | undefined {
	// Check if there are any trigger or poll nodes and then return the first one
	let node: INode;
	let nodeType: ReturnType<NodeTypesLike['getByNameAndVersion']>;

	if (nodeNames.length === 1) {
		node = nodes[nodeNames[0]];
		if (node && !node.disabled) {
			return node;
		}
	}

	for (const nodeName of nodeNames) {
		node = nodes[nodeName];
		nodeType = nodeTypes.getByNameAndVersion(node.type, node.typeVersion);

		if (nodeType?.description.name === MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE) {
			continue;
		}

		if (nodeType && (nodeType.trigger !== undefined || nodeType.poll !== undefined)) {
			if (node.disabled === true) {
				continue;
			}
			return node;
		}
	}

	const sortedNodeNames = Object.values(nodes)
		.sort((a, b) => STARTING_NODE_TYPES.indexOf(a.type as never) - STARTING_NODE_TYPES.indexOf(b.type as never))
		.map((n) => n.name);

	for (const nodeName of sortedNodeNames) {
		node = nodes[nodeName];
		if (STARTING_NODE_TYPES.includes(node.type as never)) {
			if (node.disabled === true) {
				continue;
			}
			return node;
		}
	}

	return undefined;
}

/**
 * `Workflow.getStartNode` — workflow.ts :867-883. Returns the start node to start
 * the workflow from.
 */
export function getStartNode(
	nodes: INodes,
	connectionsByDestinationNode: IConnections,
	nodeTypes: NodeTypesLike,
	destinationNode?: string,
): INode | undefined {
	let node: INode | undefined;
	if (destinationNode) {
		// Find the highest parent nodes of the given one
		const nodeNames = getHighestNode(nodes, connectionsByDestinationNode, destinationNode);

		if (nodeNames.length === 0) {
			// If no parent nodes have been found then only the destination-node
			// is in the tree so add that one
			nodeNames.push(destinationNode);
		}

		// Check which node to return as start node
		node = __getStartNode(nodes, nodeTypes, nodeNames);
		if (node !== undefined) {
			return node;
		}

		// If none of the above did find anything simply return the
		// first parent node in the list
		return nodes[nodeNames[0]];
	}

	return __getStartNode(nodes, nodeTypes, Object.keys(nodes));
}
