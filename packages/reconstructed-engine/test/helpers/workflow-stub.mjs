/**
 * WorkflowStub — a stand-in for the Workflow Model LEGO, used by the OFFLINE
 * (no-reference-runtime) tests only.
 *
 * It implements exactly the methods the node-side data surface calls, and any
 * method it does not model THROWS rather than returning undefined. A permissive
 * stub would let the reconstruction "pass" against a host that n8n never has.
 *
 * The oracle test (test/oracle/10-reference-equivalence.test.mjs) does NOT use
 * this stub: it drives the real `Workflow` from n8n-workflow@2.9.1, so a stub
 * bug cannot make a wrong port look right.
 */
import { getPinDataIfManualExecution } from '../../src/workflow-data-proxy.mjs';
import { ApplicationError } from '../../src/errors.mjs';

const EXPR = /^\{\{\s*([\s\S]*?)\s*\}\}$/;

/**
 * Literal expressions the corpus needs, with the values the reference returns for
 * them (recorded from the runtime, not guessed).
 */
const EXPRESSION_ALLOW_LIST = new Map([
	['1 + 1', 2],
	['$json.n', 5],
	['$json.n * 2', 10],
]);

function stubResolve(value) {
	if (typeof value !== 'string' || value.charAt(0) !== '=') return value;
	const body = value.slice(1);
	const single = EXPR.exec(body.trim());
	if (!single) return body;
	if (EXPRESSION_ALLOW_LIST.has(single[1])) return EXPRESSION_ALLOW_LIST.get(single[1]);
	throw new UnmodelledError(`expression: ${single[1]}`);
}

class UnmodelledError extends Error {
	constructor(name) {
		super(`WorkflowStub: "${name}" is not modelled — add it or use the reference runtime`);
		this.name = 'UnmodelledError';
	}
}

const destIndex = (connections) => {
	const out = {};
	for (const [source, byType] of Object.entries(connections)) {
		for (const [type, branches] of Object.entries(byType)) {
			for (const [outputIndex, list] of (branches ?? []).entries()) {
				for (const c of list ?? []) {
					out[c.node] ??= {};
					out[c.node][type] ??= [];
					const idx = c.index ?? 0;
					out[c.node][type][idx] ??= [];
					out[c.node][type][idx].push({ node: source, type, index: outputIndex });
				}
			}
		}
	}
	return out;
};

export class WorkflowStub {
	constructor({ nodes, connections, settings = {}, pinData, id = 'wf-oracle', name }) {
		this.nodes = {};
		for (const node of nodes) this.nodes[node.name] = node;
		this.id = id;
		this.name = name;
		this.active = false;
		this.settings = settings;
		this.pinData = pinData;
		this.connectionsBySourceNode = connections ?? {};
		this.connectionsByDestinationNode = destIndex(connections ?? {});
		this.timezone = settings.timezone ?? 'America/New_York';
		this.nodeTypes = { getByNameAndVersion: () => undefined, getKnownTypes: () => ({}) };
		this.expression = {
			/**
			 * Rules taken from contracts/expression.contract.md (E-01…E-07), which the
			 * Expression LEGO owns and has verified: a non-expression input is identity,
			 * `=` alone is "", `=text` is "text", and a template whose entire content is
			 * one `{{ }}` yields the raw JS value. Anything outside that table throws:
			 * the stub refuses to invent evaluation semantics that are not its LEGO.
			 */
			getParameterValue: (value) => stubResolve(value),
			resolveSimpleParameterValue: (value) => stubResolve(value),
		};
	}

	getNode(name) {
		return this.nodes[name] ?? null;
	}

	/** Mirrors workflow.ts:218-243 — the two supported keys, and the errors. */
	getStaticData(type, node) {
		let key;
		if (type === 'global') {
			key = 'global';
		} else if (type === 'node') {
			if (node === undefined) {
				throw new ApplicationError(
					'The request data of context type "node" the node parameter has to be set!',
				);
			}
			key = `node:${node.name}`;
		} else {
			throw new ApplicationError('Unknown context type. Only `global` and `node` are supported.', {
				extra: { contextType: type },
			});
		}

		this.staticData ??= {};
		if (this.staticData[key] === undefined) this.staticData[key] = {};
		return this.staticData[key];
	}

	getPinDataOfNode(name) {
		return this.pinData ? this.pinData[name] : undefined;
	}

	/**
	 * Mirrors the reference for the one behaviour the corpus exercises: pin data is
	 * manual-mode only (workflow-data-proxy-helpers.ts:3).
	 */
	getPinDataIfManual(name, mode) {
		return getPinDataIfManualExecution(this, name, mode);
	}

	getParentNodes(name, type = 'main', depth = -1) {
		void type;
		void depth;
		const out = [];
		for (const [source, byType] of Object.entries(this.connectionsBySourceNode)) {
			for (const list of byType[type] ?? []) {
				if (list?.some((c) => c?.node === name) && !out.includes(source)) out.push(source);
			}
		}
		return out;
	}

	getChildNodes(name, type = 'main') {
		const out = [];
		for (const list of this.connectionsBySourceNode[name]?.[type] ?? []) {
			for (const c of list ?? []) {
				if (c?.node && !out.includes(c.node)) out.push(c.node);
			}
		}
		return out;
	}

	getParentMainInputNode(node) {
		return node;
	}

	/**
	 * Mirrors workflow.ts:746-810 exactly, including the BFS through intermediate
	 * nodes: `$('A')` from a node two steps downstream must still find A's output
	 * index. A direct-edges-only stub silently diverges here (and did).
	 */
	getNodeConnectionIndexes(nodeName, parentNodeName, type = 'main') {
		const parentNode = this.getNode(parentNodeName);
		if (parentNode === null) {
			return undefined;
		}

		const visitedNodes = new Set();
		const queue = [nodeName];
		const connectionsByDest = this.connectionsByDestinationNode;

		while (queue.length > 0) {
			const currentNodeName = queue.shift();

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
						return { sourceIndex: connection.index, destinationIndex };
					}

					if (!visitedNodes.has(connection.node)) {
						queue.push(connection.node);
					}
				}
			}
		}

		return undefined;
	}

	queryNodes() {
		throw new UnmodelledError('queryNodes');
	}
}
