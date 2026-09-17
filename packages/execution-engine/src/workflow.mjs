/**
 * The minimal Workflow surface the execute loop consumes.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/workflow/src/workflow.ts
 *     - connectionsByDestinationNode  (getter, L~230)
 *     - getHighestNode                (L~700)
 *     - getParentNodes / getChildNodes (graph/graph-utils.ts)
 *     - nodeTypes.getByNameAndVersion  (interfaces.ts INodeTypes)
 *
 * The Workflow *model* is owned by the Phase-2 isolated LEGO
 * (`packages/workflow-lego`, contract `contracts/workflow.contract.md`); this
 * class exists only because the execution LEGO needs a concrete, dependency-free
 * carrier for the fields the loop reads. It must not grow model responsibilities:
 * anything that belongs to the model is re-used from the LEGO, not reimplemented.
 */

export class NodeTypesRegistry {
	#types = new Map();

	static key(type, version) {
		return `${type}@${version}`;
	}

	/** `register(type, version, definition)` — definition: INodeTypeLike. */
	register(type, version = 1, definition) {
		this.#types.set(NodeTypesRegistry.key(type, version), definition);
		return this;
	}

	/**
	 * `getByNameAndVersion(nodeType, version?)`:
	 * exact version wins, otherwise the highest registered version of that type,
	 * otherwise a minimal pass-through description — never throw, because the
	 * engine (like upstream in manual mode) must keep executing unknown types.
	 */
	getByNameAndVersion(nodeType, version) {
		if (this.#types.has(NodeTypesRegistry.key(nodeType, version))) {
			return this.#types.get(NodeTypesRegistry.key(nodeType, version));
		}

		const candidates = [...this.#types.entries()]
			.filter(([key]) => key.startsWith(`${nodeType}@`))
			.map(([key, definition]) => ({ version: Number(key.split('@').pop()), definition }))
			.sort((a, b) => b.version - a.version);

		if (candidates.length > 0) return candidates[0].definition;

		return { description: { name: nodeType, properties: [], inputs: ['main'], outputs: ['main'], group: [] } };
	}

	has(type, version) {
		return this.#types.has(NodeTypesRegistry.key(type, version));
	}

	get size() {
		return this.#types.size;
	}
}

export class ReconstructedWorkflow {
	constructor({ id = 'reconstructed', name = 'Reconstructed Workflow', active = false, nodes = [], connections = {}, settings = {}, nodeTypes } = {}) {
		this.id = id;
		this.name = name;
		this.active = active;
		this.settings = { ...settings };
		this.nodeTypes = nodeTypes ?? new NodeTypesRegistry();

		/** `workflow.nodes` is a by-name record upstream (not an array). */
		this.nodes = {};
		for (const node of nodes) {
			this.nodes[node.name] = { disabled: false, ...node, position: node.position ?? [0, 0] };
		}

		this.connections = connections;
		this._connectionsByDestinationNode = undefined;
	}

	/**
	 * Upstream builds this once in the constructor by inverting every
	 * `connections[source].main[outputIndex] = [{ node, index }]` entry into
	 * `connectionsByDestinationNode[target].main[inputIndex] = [{ node: source, index: outputIndex }]`.
	 */
	get connectionsByDestinationNode() {
		if (this._connectionsByDestinationNode === undefined) {
			const byDestination = {};
			for (const [sourceName, connectionTypes] of Object.entries(this.connections ?? {})) {
				for (const [connectionType, outputs] of Object.entries(connectionTypes ?? {})) {
					if (!Array.isArray(outputs)) continue;
					outputs.forEach((outputConnections, outputIndex) => {
						for (const connection of outputConnections ?? []) {
							byDestination[connection.node] ??= {};
							byDestination[connection.node][connectionType] ??= [];
							const inputIndex = connection.index ?? 0;
							byDestination[connection.node][connectionType][inputIndex] ??= [];
							byDestination[connection.node][connectionType][inputIndex].push({
								node: sourceName,
								type: connection.type ?? connectionType,
								index: outputIndex,
							});
						}
					});
				}
			}
			this._connectionsByDestinationNode = byDestination;
		}

		return this._connectionsByDestinationNode;
	}

	get connectionsBySourceNode() {
		return this.connections ?? {};
	}

	getNode(nodeName) {
		return this.nodes[nodeName];
	}

	getNodes() {
		return Object.values(this.nodes);
	}

	/**
	 * `getStartNode()`: trigger nodes (or explicitly start-able node types) in
	 * declaration order; upstream returns `undefined` when there is none, and the
	 * engine then falls back to the first node in the list.
	 */
	getStartNode() {
		for (const node of this.getNodes()) {
			const definition = this.nodeTypes.getByNameAndVersion(node.type, node.typeVersion);
			if (isTriggerLike(definition, node)) return node;
		}
		return undefined;
	}

	/**
	 * `getHighestNode(nodeName, nodeConnectionIndex?)` — verbatim recursion from
	 * workflow.ts, including the "disabled === false" quirk (only nodes that
	 * explicitly declare `disabled: false` count as highest).
	 */
	getHighestNode(nodeName, nodeConnectionIndex, checkedNodes) {
		const currentHighest = [];
		const node = this.nodes[nodeName];
		if (node && node.disabled === false) currentHighest.push(nodeName);

		if (!Object.hasOwn(this.connectionsByDestinationNode, nodeName)) return currentHighest;
		if (!Object.hasOwn(this.connectionsByDestinationNode[nodeName], 'main')) return currentHighest;

		checkedNodes = checkedNodes ?? [];
		if (checkedNodes.includes(nodeName)) return currentHighest;
		checkedNodes.push(nodeName);

		const returnNodes = [];
		const mainConnections = this.connectionsByDestinationNode[nodeName].main ?? [];

		for (let connectionIndex = 0; connectionIndex < mainConnections.length; connectionIndex++) {
			if (nodeConnectionIndex !== undefined && nodeConnectionIndex !== connectionIndex) continue;

			for (const connection of mainConnections[connectionIndex] ?? []) {
				if (checkedNodes.includes(connection.node)) continue;
				if (!(connection.node in this.nodes)) continue;

				const addNodes = this.getHighestNode(connection.node, undefined, checkedNodes);

				if (addNodes.length === 0) {
					// The checked node has no further parents, so it is a highest one
					if (this.nodes[connection.node]?.disabled !== true) returnNodes.push(connection.node);
				} else {
					returnNodes.push(...addNodes);
				}
			}
		}

		if (returnNodes.length === 0) {
			// No highest nodes above this one: nothing to return besides `currentHighest`
			return currentHighest;
		}

		return [...new Set(returnNodes)];
	}

	/** `getParentNodes(nodeName, type, depth)` — graph/graph-utils.ts semantics. */
	getParentNodes(nodeName, type = 'main', depth = -1) {
		return traverse(this.connectionsByDestinationNode, nodeName, type, depth, 'node');
	}

	/** `getChildNodes(nodeName, type, depth)`. */
	getChildNodes(nodeName, type = 'main', depth = -1) {
		return traverse(
			Object.fromEntries(
				Object.entries(this.connections ?? {}).map(([name, connectionTypes]) => [name, connectionTypes]),
			),
			nodeName,
			type,
			depth,
			'node',
		);
	}

	isNodeDisabled(nodeName) {
		return this.nodes[nodeName]?.disabled === true;
	}

	/**
	 * `settings.executionOrder` is optional upstream; `!== 'v1'` therefore means
	 * "legacy". This is the single predicate the engine keeps asking.
	 */
	isLegacyExecutionOrder() {
		return this.settings.executionOrder !== 'v1';
	}
}

function traverse(graph, startNode, type, depth, key) {
	if (depth === 0) return [];
	const connections = graph[startNode];
	if (!connections) return [];

	const types = type === 'ALL' ? Object.keys(connections) : [type];
	const found = new Set();
	for (const connectionType of types) {
		for (const group of connections[connectionType] ?? []) {
			for (const connection of group ?? []) {
				const nextNode = connection[key];
				if (nextNode === startNode || found.has(nextNode)) continue;
				found.add(nextNode);
				if (depth !== 1) {
					for (const indirect of traverse(graph, nextNode, type, depth === -1 ? -1 : depth - 1, key)) {
						found.add(indirect);
					}
				}
			}
		}
	}

	return [...found];
}

/**
 * `NodeHelpers.isTrigger`-style detection as the engine needs it for start-node
 * discovery: node type declares a trigger/webhook/poll hook or lists itself in a
 * trigger group.
 */
export function isTriggerLike(definition, node) {
	const description = definition?.description ?? {};
	if (definition?.trigger || definition?.poll || definition?.webhook) return true;
	if (Array.isArray(description.group) && description.group.includes('trigger')) return true;
	if (/(?:trigger|webhook|start)/i.test(node?.type ?? '')) return true;
	return false;
}
