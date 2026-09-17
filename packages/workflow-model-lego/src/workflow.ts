import { getGlobalState } from './global-state';
import { resolveGraphPort } from './graph-port';
import {
	NODES_WITH_RENAMABLE_CONTENT,
	NODES_WITH_RENAMABLE_FORM_HTML_CONTENT,
	NODES_WITH_RENAMEABLE_TOPLEVEL_HTML_CONTENT,
	renameFormFields,
} from './rename-constants';
import { applyAccessPatterns } from './node-reference-utils';
import { ApplicationError, UserError } from './errors';
import { resolveNodeHelpersPort } from './node-port';
import { dedupe } from './utils';
import * as ObservableObject from './observable-object';
import {
	getHighestNode as highestNode,
	__getStartNode as resolveStartNodeOf,
	getStartNode as resolveStartNode,
	type NodeTypesLike,
} from './start-node-navigation';
import { NodeConnectionTypes } from './interfaces';
import type {
	GraphPort,
	IConnection,
	IConnections,
	IConnectedNode,
	IDataObject,
	INode,
	INodeConnection,
	INodeParameters,
	INodeTypes,
	IPinData,
	IWorkflowSettings,
	NodeConnectionType,
	NodeParameterValueType,
	NodeHelpersPort,
} from './interfaces';

/**
 * The Workflow Model aggregate — Phase-3 Node.js/TypeScript reconstruction.
 *
 * 1:1 against `reference/n8n/packages/workflow/src/workflow.ts`
 * (n8n 2.9.4, commit `b6dc2787c45677a29a9612cd27eb911302961a83`), restricted to the members the
 * frozen 15-symbol surface exposes (`contracts/workflow.contract.md` §6). Accepted by the
 * `toJSON` (6) and `rename` (6) fixture groups in `tests/reference/workflow-rust/fixtures.json`.
 *
 * ## Behaviour the contract forbids "fixing"
 *
 * - **`nodes` is a name-keyed map in memory** while the persisted/API shape carries an array
 *   (`setNodes`, `workflow.ts:137-143`). `Object.keys(wf.nodes)` order is insertion order.
 * - **Duplicate node names silently overwrite** — `setNodes` assigns by name with no collision
 *   check, so the *last* node wins (`toJSON/duplicate-node-name`).
 * - **A node named `__proto__` never becomes an own key** of the plain object
 *   (`toJSON/restricted-name-overwrite`); `getNodeByName` therefore cannot return it either.
 * - **`renameNode` does not rebuild `connectionsByDestinationNode`** — defect **D-08**. It
 *   re-keys and rewrites the *source* map only, so `getParentNodes(newName)` answers `[]` while
 *   `getParentNodes(oldName)` still answers the old parents, until `setConnections` re-derives the
 *   index (`rename/d-08-stale-destination-index`).
 * - **`renameNode` has no collision guard** — renaming `D` onto an existing `C` replaces the node
 *   object under `C` (last write wins) and does *not* touch `C`'s edges
 *   (`rename/collision-overwrites`).
 * - **Restricted names throw `UserError`** (13 JS-prototype keys, compared case-insensitively),
 *   and the error's `constructor.name` is observable.
 *
 * ## Ports (dependencies, not ownership)
 *
 * | Port | Contract | Implementation |
 * | :--- | :--- | :--- |
 * | graph traversal + destination index | CD-02, `connection.contract.md` §7 | `packages/connection-lego` (resolved at runtime, see `graph-port.ts`) |
 * | `NodeHelpers.getNodeParameters` | CD-05, `node.contract.md` §2 | injected via `WorkflowParameters.nodeParametersPort` |
 * | `Expression` | `expression.contract.md` | `packages/expression-lego` — not instantiated here |
 *
 * Two additive, behaviour-preserving extensions versus the reference constructor: the optional
 * `graphPort` and `nodeParametersPort` parameters. `expression` is deliberately **not** created —
 * the Expression LEGO owns it, and constructing one here would couple two LEGOs for a member no
 * fixture observes. If a node's type *is* resolvable and no `nodeParametersPort` was injected, the
 * constructor throws rather than silently skipping default-parameter application.
 */

export interface WorkflowParameters {
	id?: string;
	name?: string;
	nodes: INode[];
	connections: IConnections;
	active: boolean;
	nodeTypes: INodeTypes;
	settings?: IWorkflowSettings;
	staticData?: IDataObject;
	pinData?: IPinData;
	/** CD-02 — defaults to `packages/connection-lego`. */
	graphPort?: GraphPort;
	/** CD-05 — `NodeHelpers.getNodeParameters` / `getNodeOutputs`. Defaults to `packages/node-lego`. */
	nodeHelpersPort?: NodeHelpersPort;
	/** @deprecated kept as an alias of `nodeHelpersPort.getNodeParameters`. */
	nodeParametersPort?: NodeHelpersPort['getNodeParameters'];
}

/** The 13 names `renameNode` refuses, verbatim from `workflow.ts:394-408`. */
const RESTRICTED_NODE_NAMES = [
	'hasOwnProperty',
	'isPrototypeOf',
	'propertyIsEnumerable',
	'toLocaleString',
	'toString',
	'valueOf',
	'constructor',
	'prototype',
	'__proto__',
	'__defineGetter__',
	'__defineSetter__',
	'__lookupGetter__',
	'__lookupSetter__',
];

export class Workflow {
	id: string;

	name: string | undefined;

	nodes: Record<string, INode> = {};

	connectionsBySourceNode: IConnections = {};

	connectionsByDestinationNode: IConnections = {};

	nodeTypes: INodeTypes;

	active: boolean;

	settings: IWorkflowSettings = {};

	readonly timezone: string;

	// To save workflow specific static data like for example
	// ids of registered webhooks of nodes
	staticData: IDataObject;

	testStaticData: IDataObject | undefined;

	pinData?: IPinData;

	private readonly graph: GraphPort;

	private readonly nodeHelpers: NodeHelpersPort | undefined;

	constructor(parameters: WorkflowParameters) {
		this.id = parameters.id as string; // @tech_debt Ensure this is not optional
		this.name = parameters.name;
		this.nodeTypes = parameters.nodeTypes;
		this.graph = resolveGraphPort(parameters.graphPort);
		this.nodeHelpers =
			resolveNodeHelpersPort(parameters.nodeHelpersPort) ??
			(parameters.nodeParametersPort ? { getNodeOutputs: () => [], getNodeParameters: parameters.nodeParametersPort } : undefined);

		let nodeType;
		for (const node of parameters.nodes) {
			nodeType = this.nodeTypes.getByNameAndVersion(node.type, node.typeVersion);

			if (nodeType === undefined) {
				// Go on to next node when its type is not known.
				// For now do not error because that causes problems with
				// expression resolution also then when the unknown node
				// does not get used.
				continue;
			}

			if (this.nodeHelpers?.getNodeParameters === undefined) {
				throw new Error(
					`Node type "${node.type}" resolved, but no nodeParametersPort (CD-05: ` +
						'NodeHelpers.getNodeParameters) was injected. Inject it, or pass a nodeTypes ' +
						'registry that returns undefined for this type.',
				);
			}

			// Add default values
			const nodeParameters = this.nodeHelpers.getNodeParameters(node, nodeType);
			node.parameters = nodeParameters !== null ? nodeParameters : {};
		}

		this.setNodes(parameters.nodes);
		this.setConnections(parameters.connections);
		this.setPinData(parameters.pinData);
		this.setSettings(parameters.settings ?? {});

		this.active = parameters.active || false;

		this.staticData = ObservableObject.create(parameters.staticData || {}, undefined, {
			ignoreEmptyOnFirstChild: true,
		});

		this.timezone = this.settings.timezone ?? getGlobalState().defaultTimezone;
	}

	// Save nodes in workflow as object to be able to get the nodes easily by their name.
	setNodes(nodes: INode[]) {
		this.nodes = {};
		for (const node of nodes) {
			this.nodes[node.name] = node;
		}
	}

	setConnections(connections: IConnections) {
		this.connectionsBySourceNode = connections;
		this.connectionsByDestinationNode = this.graph.mapConnectionsByDestination(
			this.connectionsBySourceNode,
		);
	}

	setPinData(pinData: IPinData | undefined) {
		this.pinData = pinData;
	}

	setSettings(settings: IWorkflowSettings) {
		this.settings = settings;
	}

	overrideStaticData(staticData?: IDataObject) {
		this.staticData = ObservableObject.create(staticData || {}, undefined, {
			ignoreEmptyOnFirstChild: true,
		});
		(this.staticData as { __dataChanged: boolean }).__dataChanged = true;
	}

	/**
	 * Returns the node with the given name if it exists else null.
	 * Note: the reference reads the map directly (`this.nodes[nodeName] ?? null`), which is why a
	 * node named `__proto__` is unreachable — the assignment in `setNodes` never created an own key.
	 */
	getNode(nodeName: string): INode | null {
		return this.nodes[nodeName] ?? null;
	}

	/**
	 * Returns the nodes with the given names if they exist.
	 * If a node cannot be found it will be ignored, meaning the returned array
	 * of nodes can be smaller than the array of names.
	 */
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

	/**
	 * Returns the pinData of the node with the given name if it exists
	 */
	getPinDataOfNode(nodeName: string): Array<Record<string, unknown>> | undefined {
		return this.pinData ? this.pinData[nodeName] : undefined;
	}

	renameNodeInParameterValue(
		parameterValue: NodeParameterValueType,
		currentName: string,
		newName: string,
		{ hasRenamableContent } = { hasRenamableContent: false },
	): NodeParameterValueType {
		if (typeof parameterValue !== 'object') {
			// Reached the actual value
			if (
				typeof parameterValue === 'string' &&
				(parameterValue.charAt(0) === '=' || hasRenamableContent)
			) {
				parameterValue = applyAccessPatterns(parameterValue, currentName, newName);
			}

			return parameterValue;
		}

		if (parameterValue === null) {
			// `typeof null === 'object'` in the reference, so `null` falls into the object branch
			// and comes back as `{}` (because `Object.keys(null || {})` is empty). Reproduced.
		} else if (Array.isArray(parameterValue)) {
			const returnArray: NodeParameterValueType[] = [];

			for (const currentValue of parameterValue) {
				returnArray.push(
					this.renameNodeInParameterValue(
						currentValue as NodeParameterValueType,
						currentName,
						newName,
					),
				);
			}

			return returnArray;
		}

		const returnData: Record<string, NodeParameterValueType> = {};

		for (const parameterName of Object.keys(parameterValue || {})) {
			returnData[parameterName] = this.renameNodeInParameterValue(
				(parameterValue as INodeParameters)[parameterName],
				currentName,
				newName,
				{ hasRenamableContent },
			);
		}

		return returnData;
	}

	/**
	 * Rename a node in the workflow.
	 *
	 * @param currentName The current name of the node
	 * @param newName The new name
	 */
	renameNode(currentName: string, newName: string) {
		// These keys are excluded to prevent accidental modification of inherited properties and
		// to avoid any issues related to JavaScript's built-in methods that can cause unexpected behavior
		if (RESTRICTED_NODE_NAMES.map((k) => k.toLowerCase()).includes(newName.toLowerCase())) {
			throw new UserError(`Node name "${newName}" is a restricted name.`, {
				description: `Node names cannot be any of the following: ${RESTRICTED_NODE_NAMES.join(', ')}`,
			});
		}
		// Rename the node itself
		if (this.nodes[currentName] !== undefined) {
			this.nodes[newName] = this.nodes[currentName];
			this.nodes[newName].name = newName;
			delete this.nodes[currentName];
		}

		// Update the expressions which reference the node
		// with its old name
		for (const node of Object.values(this.nodes)) {
			node.parameters = this.renameNodeInParameterValue(
				node.parameters,
				currentName,
				newName,
			) as INodeParameters;

			if (NODES_WITH_RENAMABLE_CONTENT.has(node.type)) {
				node.parameters.jsCode = this.renameNodeInParameterValue(
					node.parameters.jsCode,
					currentName,
					newName,
					{ hasRenamableContent: true },
				);
			}
			if (NODES_WITH_RENAMEABLE_TOPLEVEL_HTML_CONTENT.has(node.type)) {
				node.parameters.html = this.renameNodeInParameterValue(
					node.parameters.html,
					currentName,
					newName,
					{ hasRenamableContent: true },
				);
			}
			if (NODES_WITH_RENAMABLE_FORM_HTML_CONTENT.has(node.type)) {
				renameFormFields(node, (p) =>
					this.renameNodeInParameterValue(p, currentName, newName, {
						hasRenamableContent: true,
					}),
				);
			}
		}

		// Change all source connections
		if (this.connectionsBySourceNode.hasOwnProperty(currentName)) {
			this.connectionsBySourceNode[newName] = this.connectionsBySourceNode[currentName];
			delete this.connectionsBySourceNode[currentName];
		}

		// Change all destination connections
		//
		// NOTE (defect D-08, reproduced on purpose): the reference only rewrites the *edge targets*
		// inside the source map. `connectionsByDestinationNode` is NOT re-derived here, so it keeps
		// answering under the old node name until `setConnections` runs again.
		let sourceNode: string;
		let type: string;
		let sourceIndex: string;
		let connectionIndex: string;
		let connectionData: IConnection | undefined;
		for (sourceNode of Object.keys(this.connectionsBySourceNode)) {
			for (type of Object.keys(this.connectionsBySourceNode[sourceNode])) {
				for (sourceIndex of Object.keys(this.connectionsBySourceNode[sourceNode][type])) {
					for (connectionIndex of Object.keys(
						this.connectionsBySourceNode[sourceNode][type][parseInt(sourceIndex, 10)] || [],
					)) {
						connectionData =
							this.connectionsBySourceNode[sourceNode][type][parseInt(sourceIndex, 10)]?.[
								parseInt(connectionIndex, 10)
							];
						if (connectionData?.node === currentName) {
							connectionData.node = newName;
						}
					}
				}
			}
		}
	}

	/** Returns all the nodes after the given one. */
	getChildNodes(
		nodeName: string,
		type: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = NodeConnectionTypes.Main,
		depth = -1,
	): string[] {
		return this.graph.getChildNodes(this.connectionsBySourceNode, nodeName, type, depth);
	}

	/** Returns all the nodes before the given one. */
	getParentNodes(
		nodeName: string,
		type: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = NodeConnectionTypes.Main,
		depth = -1,
	): string[] {
		return this.graph.getParentNodes(this.connectionsByDestinationNode, nodeName, type, depth);
	}

	/**
	 * Gets all the nodes which are connected nodes starting from the given one.
	 */
	getConnectedNodes(
		nodeName: string,
		connectionType: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = NodeConnectionTypes.Main,
		depth = -1,
		checkedNodesIncoming?: string[],
	): string[] {
		return this.graph.getConnectedNodes(
			this.connectionsBySourceNode,
			nodeName,
			connectionType,
			depth,
			checkedNodesIncoming,
		);
	}
	/**
	 * Finds the highest parent nodes of the node with the given name.
	 *
	 * 1:1 from `workflow.ts:491-570`. Reference quirks that the `getHighestNode` golden probes pin:
	 *
	 * - a node whose `disabled === false` **exactly** (not merely "not disabled") is pushed onto
	 *   `currentHighest` before the incoming-connection checks, and that partial result is what is
	 *   returned when the node has no incoming `main` connections;
	 * - edges pointing at nodes that are not in `this.nodes` are skipped
	 *   (`if (!(connection.node in this.nodes)) return;`);
	 * - when the recursion finds nothing above a parent, that parent is used **unless** it is
	 *   `disabled === true` — so `disabled: undefined` counts as enabled;
	 * - results are de-duplicated with `indexOf` while preserving first-seen order.
	 */
	getHighestNode(
		nodeName: string,
		nodeConnectionIndex?: number,
		checkedNodes?: string[],
	): string[] {
		// Single source of truth: the pure port in `./start-node-navigation` (landed by
		// TASK-DGRAPH-01). The class method is the reference's aggregate entry point; the
		// traversal itself exists exactly once on this branch.
		return highestNode(
			this.nodes,
			this.connectionsByDestinationNode,
			nodeName,
			nodeConnectionIndex,
			checkedNodes,
		);
	}

	/**
	 * Returns all the nodes before the given one.
	 *
	 * @param maxDepth `-1` for unlimited
	 */
	getParentNodesByDepth(nodeName: string, maxDepth = -1): IConnectedNode[] {
		return this.searchNodesBFS(this.connectionsByDestinationNode, nodeName, maxDepth);
	}

	/**
	 * Gets all the nodes which are connected nodes starting from the given one.
	 * Uses BFS traversal.
	 *
	 * 1:1 from `workflow.ts:630-686`. The BFS is level-synchronous (`toAdd = [...queue]`, then the
	 * queue is drained), `depth` is incremented **before** the level is expanded, the source node
	 * itself is recorded in `visited` but excluded from the result, and a node reached twice has
	 * its `indicies` merged through `dedupe`. All four behaviours are pinned by the
	 * `getParentNodesByDepth` golden probe (`[{A,[0],1},{Loop,[0],1},{IF,[1,0],1},{Trigger,[0],2}]`).
	 */
	searchNodesBFS(connections: IConnections, sourceNode: string, maxDepth = -1): IConnectedNode[] {
		const returnConns: IConnectedNode[] = [];

		const type: NodeConnectionType = NodeConnectionTypes.Main;
		let queue: IConnectedNode[] = [];
		queue.push({
			name: sourceNode,
			depth: 0,
			indicies: [],
		});

		const visited: { [key: string]: IConnectedNode } = {};

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

	/**
	 * Walks a non-main output chain (e.g. an AI agent's tool sub-nodes) down to the node that owns
	 * the `main` input.
	 *
	 * 1:1 from `workflow.ts:687-738`. Both `sort()` calls are in the reference specifically to make
	 * the choice deterministic when several non-main outputs exist; they are kept. The recursion
	 * terminates because a node with no non-main connections returns itself.
	 */
	getParentMainInputNode(node: INode): INode {
		if (node) {
			const nodeType = this.nodeTypes.getByNameAndVersion(node.type, node.typeVersion);
			if (!nodeType?.description) {
				return node;
			}
			if (!(nodeType.description as { outputs?: unknown }).outputs) {
				return node;
			}

			if (this.nodeHelpers?.getNodeOutputs === undefined) {
				throw new Error(
					'getParentMainInputNode needs NodeHelpers.getNodeOutputs (CD-05), but no Node LEGO ' +
						'port was resolved. Install packages/node-lego or inject nodeHelpersPort.',
				);
			}

			// The reference passes `nodeType.description`, not the node type itself
			// (`workflow.ts:695`): `getNodeOutputs` reads `nodeTypeData.outputs`.
			const outputs = this.nodeHelpers.getNodeOutputs(
				this,
				node,
				nodeType.description as { outputs?: unknown; [key: string]: unknown },
			);
			const nonMainConnectionTypes: NodeConnectionType[] = [];

			for (const output of outputs) {
				// The reference types both branches as NodeConnectionType; a bare string output is
				// the short form of `{ type, displayName }`.
				const type = (typeof output === 'string' ? output : output.type) as NodeConnectionType;
				if (type !== NodeConnectionTypes.Main) {
					nonMainConnectionTypes.push(type);
				}
			}

			// Sort for deterministic behavior: prevents non-deterministic selection when multiple
			// non-main outputs exist (AI agents with multiple tools). Object.keys() ordering
			// can vary across runs, causing inconsistent first-choice selection.
			nonMainConnectionTypes.sort();

			if (nonMainConnectionTypes.length > 0) {
				const nonMainNodesConnected: string[] = [];
				const nodeConnections = this.connectionsBySourceNode[node.name];

				for (const type of nonMainConnectionTypes) {
					// Only include connection types that exist in actual execution data
					if (nodeConnections?.[type]) {
						const childNodes = this.getChildNodes(node.name, type);
						if (childNodes.length > 0) {
							nonMainNodesConnected.push(...childNodes);
						}
					}
				}

				if (nonMainNodesConnected.length) {
					// Sort for deterministic behavior, then get first node
					nonMainNodesConnected.sort();
					const returnNode = this.getNode(nonMainNodesConnected[0]);
					if (!returnNode) {
						throw new ApplicationError(`Node "${nonMainNodesConnected[0]}" not found`);
					}
					return this.getParentMainInputNode(returnNode);
				}
			}
		}

		return node;
	}

	/**
	 * Returns via which output of the parent-node and index the current node
	 * they are connected.
	 *
	 * 1:1 from `workflow.ts:746-810`, including the BFS-over-destination-index walk and its
	 * "optimized for performance — do not degrade" comment. Returning `undefined` for an
	 * unconnected pair is part of the contract (pinned by the
	 * `Merge <- Sparse (not connected)` and `Agent<-Tool default main` golden probes).
	 */
	getNodeConnectionIndexes(
		nodeName: string,
		parentNodeName: string,
		type: NodeConnectionType = NodeConnectionTypes.Main,
	): INodeConnection | undefined {
		// This method has been optimized for performance. If you make any changes to it,
		// make sure the performance is not degraded.
		const parentNode = this.getNode(parentNodeName);
		if (parentNode === null) {
			return undefined;
		}

		const visitedNodes = new Set<string>();
		const queue: string[] = [nodeName];

		// Cache the connections by destination node to avoid reference lookups
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

			for (
				let typedConnectionIdx = 0;
				typedConnectionIdx < typeConnections.length;
				typedConnectionIdx++
			) {
				const connectionsByIndex = typeConnections[typedConnectionIdx];
				if (!connectionsByIndex) {
					continue;
				}

				for (
					let destinationIndex = 0;
					destinationIndex < connectionsByIndex.length;
					destinationIndex++
				) {
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

	/**
	 * Returns from which of the given nodes the workflow should get started from.
	 *
	 * 1:1 from `workflow.ts:817-864`. Three-stage search: single-candidate shortcut, then the first
	 * trigger/poll node type, then `STARTING_NODE_TYPES` order. `MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE`
	 * is skipped in stage 2. Note the final sort compares `STARTING_NODE_TYPES.indexOf(type)`,
	 * which is `-1` for every unrelated type — so unknown types sort *first* and the subsequent
	 * `includes` filter is what actually decides. Reproduced as written.
	 */
	__getStartNode(nodeNames: string[]): INode | undefined {
		return resolveStartNodeOf(this.nodes, this.nodeTypes as unknown as NodeTypesLike, nodeNames);
	}

	/**
	 * Returns the start node to start the workflow from.
	 * 1:1 from `workflow.ts:866-890`.
	 */
	getStartNode(destinationNode?: string): INode | undefined {
		return resolveStartNode(
			this.nodes,
			this.connectionsByDestinationNode,
			this.nodeTypes as unknown as NodeTypesLike,
			destinationNode,
		);
	}
}
