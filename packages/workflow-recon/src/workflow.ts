/**
 * `WorkflowRecon` — TypeScript reconstruction of the n8n 2.9.4 Workflow Model
 * graph surface (Phase 3, "IMPLEMENTED (NODE.JS/TS)" stage of the LEGO cycle).
 *
 * Reference: `reference/n8n/packages/workflow/src/workflow.ts` (925 lines,
 * commit b6dc2787c45677a29a9612cd27eb911302961a83). Every method below carries
 * the reference line range it reproduces.
 *
 * SCOPE — what this LEGO owns and what it does not:
 *   owns        node collection, connection indexes, adjacency traversals,
 *               highest-node resolution, start-node selection, connection
 *               indexes, BFS-by-depth, connections-between-nodes
 *   ports       node type registry  -> Node Model LEGO (02)
 *               node parameter defaults -> Node Model LEGO (02)
 *               expression runtime   -> Expression LEGO (not touched here)
 *   NOT owned   execution, persistence, webhooks, scheduler
 *
 * THE `disabled` FLAG IS BEHAVIOUR, NOT STORAGE (ISSUE-015 / ISSUE-017).
 * n8n consults it in five places, all reproduced here:
 *   workflow.ts:282  queryNodes            — disabled nodes are never returned
 *   workflow.ts:498  getHighestNode        — `disabled === false` (strict!)
 *   workflow.ts:553  getHighestNode        — child added only if `!== true`
 *   workflow.ts:824  __getStartNode        — single-candidate fast path
 *   workflow.ts:839  __getStartNode        — trigger/poll scan
 *   workflow.ts:853  __getStartNode        — STARTING_NODE_TYPES scan
 * Traversals (`getParentNodes` / `getChildNodes` / `getConnectedNodes`) do NOT
 * consult it. Recorded evidence: `tests/reference/04-disabled-node/expected.json`.
 */
import {
	MAIN_CONNECTION_TYPE,
	MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE,
	STARTING_NODE_TYPES,
} from './constants.ts';
import {
	getChildNodes,
	getConnectedNodes,
	getParentNodes,
	mapConnectionsByDestination,
} from './connections.ts';
import type {
	IConnection,
	IConnectedNode,
	IConnections,
	INode,
	INodeConnection,
	INodes,
	INodeType,
	INodeTypes,
	IPinData,
	IWorkflowSettings,
	NodeConnectionType,
	WorkflowReconParameters,
} from './types.ts';

/** `utils.ts:477` — `[...new Set(arr)]`. */
function dedupe<T>(arr: T[]): T[] {
	return [...new Set(arr)];
}

/**
 * Port for node parameter defaults. The reference constructor resolves defaults
 * through `NodeHelpers.getNodeParameters` (`workflow.ts:98-110`) — that belongs
 * to the Node Model LEGO, so this reconstruction accepts it as a port and
 * defaults to identity (parameters pass through unchanged).
 */
export type NodeParameterDefaultsPort = (
	nodeType: INodeType,
	node: INode,
) => Record<string, unknown> | null;

const identityDefaults: NodeParameterDefaultsPort = (_nodeType, node) =>
	(node.parameters ?? {}) as Record<string, unknown>;

export class WorkflowRecon {
	id: string;

	name: string | undefined;

	nodes: INodes = {};

	connectionsBySourceNode: IConnections = {};

	connectionsByDestinationNode: IConnections = {};

	nodeTypes: INodeTypes;

	active: boolean;

	settings: IWorkflowSettings = {};

	timezone: string;

	pinData?: IPinData;

	private readonly applyNodeParameterDefaults: NodeParameterDefaultsPort;

	private readonly defaultTimezone: string;

	constructor(parameters: WorkflowReconParameters & {
		applyNodeParameterDefaults?: NodeParameterDefaultsPort;
		defaultTimezone?: string;
	}) {
		this.id = parameters.id as string; // @tech_debt carried over from the reference
		this.name = parameters.name;
		this.nodeTypes = parameters.nodeTypes;
		this.applyNodeParameterDefaults =
			parameters.applyNodeParameterDefaults ?? identityDefaults;
		// `getGlobalState().defaultTimezone` in the reference (global state is a
		// separate LEGO — ISSUE-006); injected here instead of being read globally.
		this.defaultTimezone = parameters.defaultTimezone ?? 'America/New_York';

		let nodeType: INodeType | undefined;
		for (const node of parameters.nodes) {
			nodeType = this.nodeTypes.getByNameAndVersion(node.type, node.typeVersion);

			if (nodeType === undefined) {
				// Go on to next node when its type is not known.
				continue;
			}

			// Defaults are resolved through the Node Model LEGO port (workflow.ts:98-110).
			const nodeParameters = this.applyNodeParameterDefaults(nodeType, node);
			node.parameters = nodeParameters !== null ? nodeParameters : {};
		}

		this.setNodes(parameters.nodes);
		this.setConnections(parameters.connections);
		this.setPinData(parameters.pinData);
		this.setSettings(parameters.settings ?? {});

		this.active = parameters.active || false;
		this.timezone = this.settings.timezone ?? this.defaultTimezone;
	}

	/* ------------------------------------------------------------------ *
	 * structure — workflow.ts:137-156
	 * ------------------------------------------------------------------ */

	setNodes(nodes: INode[]) {
		this.nodes = {};
		for (const node of nodes) {
			this.nodes[node.name] = node;
		}
	}

	setConnections(connections: IConnections) {
		this.connectionsBySourceNode = connections;
		this.connectionsByDestinationNode = mapConnectionsByDestination(this.connectionsBySourceNode);
	}

	setPinData(pinData: IPinData | undefined) {
		this.pinData = pinData;
	}

	setSettings(settings: IWorkflowSettings) {
		this.settings = settings;
	}

	static getConnectionsByDestination(connections: IConnections): IConnections {
		return mapConnectionsByDestination(connections);
	}

	/* ------------------------------------------------------------------ *
	 * node access — workflow.ts:254-335
	 * ------------------------------------------------------------------ */

	/** workflow.ts:266-292 — disabled nodes are skipped *before* the type check. */
	queryNodes(checkFunction: (nodeType: INodeType) => boolean): INode[] {
		const returnNodes: INode[] = [];

		let node: INode;
		let nodeType: INodeType | undefined;

		for (const nodeName of Object.keys(this.nodes)) {
			node = this.nodes[nodeName];

			if (node.disabled === true) {
				continue;
			}

			nodeType = this.nodeTypes.getByNameAndVersion(node.type, node.typeVersion);

			if (nodeType !== undefined && checkFunction(nodeType)) {
				returnNodes.push(node);
			}
		}

		return returnNodes;
	}

	/** workflow.ts:254-256. */
	getTriggerNodes(): INode[] {
		return this.queryNodes((nodeType: INodeType) => !!nodeType.trigger);
	}

	/** workflow.ts:262-264. */
	getPollNodes(): INode[] {
		return this.queryNodes((nodeType: INodeType) => !!nodeType.poll);
	}

	/** workflow.ts:299-301. */
	getNode(nodeName: string): INode | null {
		return this.nodes[nodeName] ?? null;
	}

	/** workflow.ts:309-323. */
	getNodes(nodeNames: string[]): INode[] {
		const nodes: INode[] = [];
		for (const name of nodeNames) {
			const node = this.getNode(name);
			if (!node) {
				console.warn(
					`Could not find a node with the name ${name} in the workflow. This was passed in as a dirty node name.`,
				);
				continue;
			}
			nodes.push(node);
		}

		return nodes;
	}

	/** workflow.ts:330-332 — ISSUE-016: pin data is behaviour, so it is readable here. */
	getPinDataOfNode(nodeName: string): unknown[] | undefined {
		return this.pinData ? this.pinData[nodeName] : undefined;
	}

	/* ------------------------------------------------------------------ *
	 * traversals — workflow.ts:487-616
	 * ------------------------------------------------------------------ */

	/**
	 * workflow.ts:487-570 — `disabled` decides membership twice:
	 *   :498 the node itself counts as "highest" only when `disabled === false`
	 *        (strictly false — an *absent* flag does NOT qualify here)
	 *   :553 a parentless node is added only when `disabled !== true`
	 *        (an absent flag DOES qualify here)
	 * That asymmetry is n8n's real behaviour and is pinned by a test.
	 */
	getHighestNode(nodeName: string, nodeConnectionIndex?: number, checkedNodes?: string[]): string[] {
		const currentHighest: string[] = [];
		if (this.nodes[nodeName].disabled === false) {
			// If the current node is not disabled itself is the highest
			currentHighest.push(nodeName);
		}

		if (!this.connectionsByDestinationNode.hasOwnProperty(nodeName)) {
			// Node does not have incoming connections
			return currentHighest;
		}

		if (!this.connectionsByDestinationNode[nodeName].hasOwnProperty(MAIN_CONNECTION_TYPE)) {
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

		let connectionsByIndex: IConnection[] | null;
		for (
			let connectionIndex = 0;
			connectionIndex <
			this.connectionsByDestinationNode[nodeName][MAIN_CONNECTION_TYPE].length;
			connectionIndex++
		) {
			if (nodeConnectionIndex !== undefined && nodeConnectionIndex !== connectionIndex) {
				// If a connection-index is given ignore all other ones
				continue;
			}
			connectionsByIndex =
				this.connectionsByDestinationNode[nodeName][MAIN_CONNECTION_TYPE][connectionIndex];

			connectionsByIndex?.forEach((connection) => {
				if (checkedNodes!.includes(connection.node)) {
					// Node got checked already before
					return;
				}

				// Ignore connections for nodes that don't exist in this workflow
				if (!(connection.node in this.nodes)) return;

				addNodes = this.getHighestNode(connection.node, undefined, checkedNodes);

				if (addNodes.length === 0) {
					// The checked node does not have any further parents so add it
					// if it is not disabled
					if (this.nodes[connection.node].disabled !== true) {
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

	/** workflow.ts:572-583. */
	getChildNodes(
		nodeName: string,
		type: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = MAIN_CONNECTION_TYPE,
		depth = -1,
	): string[] {
		return getChildNodes(this.connectionsBySourceNode, nodeName, type, depth);
	}

	/** workflow.ts:585-596. */
	getParentNodes(
		nodeName: string,
		type: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = MAIN_CONNECTION_TYPE,
		depth = -1,
	): string[] {
		return getParentNodes(this.connectionsByDestinationNode, nodeName, type, depth);
	}

	/** workflow.ts:598-614. */
	getConnectedNodes(
		connections: IConnections,
		nodeName: string,
		connectionType: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = MAIN_CONNECTION_TYPE,
		depth = -1,
		checkedNodesIncoming?: string[],
	): string[] {
		return getConnectedNodes(connections, nodeName, connectionType, depth, checkedNodesIncoming);
	}

	/** workflow.ts:616-622. */
	getParentNodesByDepth(nodeName: string, maxDepth = -1): IConnectedNode[] {
		return this.searchNodesBFS(this.connectionsByDestinationNode, nodeName, maxDepth);
	}

	/** workflow.ts:624-688 — BFS with per-row depth and merged `indicies`. */
	searchNodesBFS(connections: IConnections, sourceNode: string, maxDepth = -1): IConnectedNode[] {
		const returnConns: IConnectedNode[] = [];

		const type: NodeConnectionType = MAIN_CONNECTION_TYPE;
		let queue: IConnectedNode[] = [];
		queue.push({
			name: sourceNode,
			depth: 0,
			indicies: [],
		});

		const visited: Record<string, IConnectedNode> = {};

		let depth = 0;
		while (queue.length > 0) {
			if (maxDepth !== -1 && depth > maxDepth) {
				break;
			}
			depth++;

			const toAdd = [...queue];
			queue = [];

			toAdd.forEach((curr) => {
				if (visited[curr.name]) {
					visited[curr.name].indicies = dedupe(visited[curr.name].indicies.concat(curr.indicies));
					return;
				}

				visited[curr.name] = curr;
				if (curr.name !== sourceNode) {
					returnConns.push(curr);
				}

				if (
					!connections.hasOwnProperty(curr.name) ||
					!connections[curr.name].hasOwnProperty(type)
				) {
					return;
				}

				connections[curr.name][type].forEach((connectionsByIndex) => {
					connectionsByIndex?.forEach((connection) => {
						queue.push({
							name: connection.node,
							indicies: [connection.index],
							depth,
						});
					});
				});
			});
		}

		return returnConns;
	}

	/** workflow.ts:746-810 — BFS over destination connections, first match wins. */
	getNodeConnectionIndexes(
		nodeName: string,
		parentNodeName: string,
		type: NodeConnectionType = MAIN_CONNECTION_TYPE,
	): INodeConnection | undefined {
		const parentNode = this.getNode(parentNodeName);
		if (parentNode === null) {
			return undefined;
		}

		const visitedNodes = new Set<string>();
		const queue: string[] = [nodeName];

		const connectionsByDest = this.connectionsByDestinationNode;

		while (queue.length > 0) {
			const currentNodeName = queue.shift()!;

			if (visitedNodes.has(currentNodeName)) {
				continue;
			}

			visitedNodes.add(currentNodeName);

			const typeConnections = connectionsByDest[currentNodeName]?.[type];
			if (!typeConnections) {
				continue;
			}

			for (let typedConnectionIdx = 0; typedConnectionIdx < typeConnections.length; typedConnectionIdx++) {
				const connectionsByIndex = typeConnections[typedConnectionIdx];
				if (!connectionsByIndex) {
					continue;
				}

				for (let destinationIndex = 0; destinationIndex < connectionsByIndex.length; destinationIndex++) {
					const connection = connectionsByIndex[destinationIndex];

					if (parentNodeName === connection.node) {
						return {
							sourceIndex: connection.index,
							destinationIndex,
						};
					}

					if (!visitedNodes.has(connection.node)) {
						queue.push(connection.node);
					}
				}
			}
		}

		return undefined;
	}

	/* ------------------------------------------------------------------ *
	 * start-node selection — workflow.ts:812-880
	 * ------------------------------------------------------------------ */

	/**
	 * workflow.ts:817-862. Three `disabled` gates:
	 *   :824 single candidate  -> `if (node && !node.disabled)`
	 *   :839 trigger/poll scan -> `if (node.disabled === true) continue`
	 *   :853 STARTING_NODE_TYPES scan -> `if (node.disabled === true) continue`
	 * The reference dereferences `nodeType.description` before the `nodeType`
	 * guard on the next line; an unknown node type therefore throws here exactly
	 * as it does upstream. Reproduced deliberately (1:1).
	 */
	__getStartNode(nodeNames: string[]): INode | undefined {
		let node: INode;
		let nodeType: INodeType;

		if (nodeNames.length === 1) {
			node = this.nodes[nodeNames[0]];
			if (node && !node.disabled) {
				return node;
			}
		}

		for (const nodeName of nodeNames) {
			node = this.nodes[nodeName];
			nodeType = this.nodeTypes.getByNameAndVersion(node.type, node.typeVersion)!;

			// TODO: Identify later differently
			if (nodeType.description.name === MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE) {
				continue;
			}

			if (nodeType && (nodeType.trigger !== undefined || nodeType.poll !== undefined)) {
				if (node.disabled === true) {
					continue;
				}
				return node;
			}
		}

		const sortedNodeNames = Object.values(this.nodes)
			.sort((a, b) => STARTING_NODE_TYPES.indexOf(a.type) - STARTING_NODE_TYPES.indexOf(b.type))
			.map((n) => n.name);

		for (const nodeName of sortedNodeNames) {
			node = this.nodes[nodeName];
			if (STARTING_NODE_TYPES.includes(node.type)) {
				if (node.disabled === true) {
					continue;
				}
				return node;
			}
		}

		return undefined;
	}

	/** workflow.ts:864-885. */
	getStartNode(destinationNode?: string): INode | undefined {
		if (destinationNode) {
			// Find the highest parent nodes of the given one
			const nodeNames = this.getHighestNode(destinationNode);

			if (nodeNames.length === 0) {
				// If no parent nodes have been found then only the destination-node
				// is in the tree so add that one
				nodeNames.push(destinationNode);
			}

			// Check which node to return as start node
			const node = this.__getStartNode(nodeNames);
			if (node !== undefined) {
				return node;
			}

			// If none of the above did find anything simply return the
			// first parent node in the list
			return this.nodes[nodeNames[0]];
		}

		return this.__getStartNode(Object.keys(this.nodes));
	}

	/** workflow.ts:887-924. */
	getConnectionsBetweenNodes(
		sources: string[],
		targets: string[],
	): Array<[IConnection, IConnection]> {
		const result: Array<[IConnection, IConnection]> = [];

		for (const source of sources) {
			for (const type of Object.keys(this.connectionsBySourceNode[source] ?? {})) {
				for (const sourceIndex of Object.keys(this.connectionsBySourceNode[source][type])) {
					for (const connectionIndex of Object.keys(
						this.connectionsBySourceNode[source][type][parseInt(sourceIndex, 10)] ?? [],
					)) {
						const targetConnectionData =
							this.connectionsBySourceNode[source][type][parseInt(sourceIndex, 10)]?.[
								parseInt(connectionIndex, 10)
							];
						if (targetConnectionData && targets.includes(targetConnectionData?.node)) {
							result.push([
								{
									node: source,
									index: parseInt(sourceIndex, 10),
									type: type as NodeConnectionType,
								},
								targetConnectionData,
							]);
						}
					}
				}
			}
		}

		return result;
	}
}
