import { getGlobalState } from './global-state';
import { resolveGraphPort } from './graph-port';
import {
	NODES_WITH_RENAMABLE_CONTENT,
	NODES_WITH_RENAMABLE_FORM_HTML_CONTENT,
	NODES_WITH_RENAMEABLE_TOPLEVEL_HTML_CONTENT,
	renameFormFields,
} from './rename-constants';
import { applyAccessPatterns } from './node-reference-utils';
import { UserError } from './errors';
import * as ObservableObject from './observable-object';
import { NodeConnectionTypes } from './interfaces';
import type {
	GraphPort,
	IConnection,
	IConnections,
	IDataObject,
	INode,
	INodeParameters,
	INodeTypes,
	IPinData,
	IWorkflowSettings,
	NodeConnectionType,
	NodeParameterValueType,
	NodeParametersPort,
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
	/** CD-05 — `NodeHelpers.getNodeParameters`. Required only when a node type resolves. */
	nodeParametersPort?: NodeParametersPort;
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

	private readonly nodeParametersPort: NodeParametersPort | undefined;

	constructor(parameters: WorkflowParameters) {
		this.id = parameters.id as string; // @tech_debt Ensure this is not optional
		this.name = parameters.name;
		this.nodeTypes = parameters.nodeTypes;
		this.graph = resolveGraphPort(parameters.graphPort);
		this.nodeParametersPort = parameters.nodeParametersPort;

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

			if (this.nodeParametersPort === undefined) {
				throw new Error(
					`Node type "${node.type}" resolved, but no nodeParametersPort (CD-05: ` +
						'NodeHelpers.getNodeParameters) was injected. Inject it, or pass a nodeTypes ' +
						'registry that returns undefined for this type.',
				);
			}

			// Add default values
			const nodeParameters = this.nodeParametersPort(node, nodeType);
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
}
