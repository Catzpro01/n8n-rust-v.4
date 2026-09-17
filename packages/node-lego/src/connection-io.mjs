/**
 * Connection types + node IO resolution — `NodeHelpers` IO surface.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/workflow/src/node-helpers.ts
 *     - isSubNodeType        L247-258
 *     - getConnectionTypes   L1104-1114
 *     - getNodeInputs        L1117-1138
 *     - getNodeOutputs       L1140-1200  (incl. the `continueErrorOutput` append)
 *     - isTriggerNode        L1671-1673
 *     - isExecutable         L1675-1686
 *     - nodeAcceptsInputType L1921-1946
 *     - nodeHasOutputType    L1949-1966
 *   Oracle: node-helpers.test.ts (getNodeInputs/getNodeOutputs/nodeHasOutputType/…)
 */

import { deepCopy } from './deep-copy.mjs';

export const NodeConnectionTypes = Object.freeze({ Main: 'main', AiTool: 'ai_tool' });

/**
 * `getConnectionTypes(connections)` — strings pass through, configuration objects
 * contribute their `type`; entries whose `type` is `undefined` are dropped.
 *
 * Pinned quirk (reference L1104-1114): the `filter` runs **after** the `map`, so a
 * literal `undefined` entry throws `TypeError: Cannot read properties of
 * undefined (reading 'type')` — it is not silently dropped.
 */
export function getConnectionTypes(connections) {
	return connections
		.map((connection) => {
			if (typeof connection === 'string') return connection;
			return connection.type;
		})
		.filter((connection) => connection !== undefined);
}

/** `isSubNodeType(typeDescription)` — any output type other than `main`. */
export function isSubNodeType(typeDescription) {
	if (!typeDescription?.outputs || typeof typeDescription.outputs === 'string') return false;
	const outputTypes = getConnectionTypes(typeDescription.outputs);
	return outputTypes ? outputTypes.filter((output) => output !== NodeConnectionTypes.Main).length > 0 : false;
}

/** `isTriggerNode(nodeTypeData)` — the description declares the `trigger` group. */
export function isTriggerNode(nodeTypeData) {
	return nodeTypeData.group.includes('trigger');
}

/** `getNodeInputs(workflow, node, nodeTypeData)` — static array or expression-computed. */
export function getNodeInputs(workflow, node, nodeTypeData) {
	if (Array.isArray(nodeTypeData?.inputs)) return nodeTypeData.inputs;

	// Calculate the inputs dynamically
	try {
		return workflow.expression.getSimpleParameterValue(node, nodeTypeData.inputs, 'internal', {}) || [];
	} catch {
		console.warn('Could not calculate inputs dynamically for node: ', node.name);
		return [];
	}
}

/**
 * `getNodeOutputs(workflow, node, nodeTypeData)` — static array or expression-computed,
 * plus the appended error output for `onError: 'continueErrorOutput'`.
 */
export function getNodeOutputs(workflow, node, nodeTypeData) {
	let outputs = [];

	if (!nodeTypeData) return [];

	if (Array.isArray(nodeTypeData.outputs)) {
		outputs = nodeTypeData.outputs;
	} else {
		// Calculate the outputs dynamically
		try {
			const result = workflow.expression.getSimpleParameterValue(node, nodeTypeData.outputs, 'internal', {});
			outputs = Array.isArray(result) ? result : [];
		} catch {
			console.warn('Could not calculate outputs dynamically for node: ', node.name);
		}
	}

	if (node.onError === 'continueErrorOutput') {
		// Copy the data to make sure that we do not change the data of the
		// node type and so change the displayNames for all nodes in the flow
		outputs = deepCopy(outputs);
		if (outputs.length === 1) {
			// Set the displayName to "Success"
			if (typeof outputs[0] === 'string') outputs[0] = { type: outputs[0] };
			outputs[0].displayName = 'Success';
		}
		return [...outputs, { category: 'error', type: NodeConnectionTypes.Main, displayName: 'Error' }];
	}

	return outputs;
}

/**
 * `isExecutable(workflow, node, nodeTypeData)` — the node can start an execution:
 * it has a `main`/`ai_tool` output or is a trigger node.
 */
export function isExecutable(workflow, node, nodeTypeData) {
	if (!nodeTypeData) return false;
	const outputs = getNodeOutputs(workflow, node, nodeTypeData);
	const outputNames = getConnectionTypes(outputs);
	return (
		outputNames.includes(NodeConnectionTypes.Main) ||
		outputNames.includes(NodeConnectionTypes.AiTool) ||
		isTriggerNode(nodeTypeData)
	);
}

/** `nodeAcceptsInputType(nodeType, connectionType)` — string inputs use `includes`. */
export function nodeAcceptsInputType(nodeType, connectionType) {
	if (typeof nodeType.inputs === 'string') {
		return nodeType.inputs === connectionType || nodeType.inputs.includes(connectionType);
	}

	if (!nodeType.inputs || !Array.isArray(nodeType.inputs)) return false;

	return nodeType.inputs.some((input) => {
		if (typeof input === 'string') return input === connectionType || input.includes(connectionType);
		return input.type === connectionType;
	});
}

/** `nodeHasOutputType(nodeType, connectionType)` — string outputs use `includes`. */
export function nodeHasOutputType(nodeType, connectionType) {
	if (typeof nodeType.outputs === 'string') {
		return nodeType.outputs === connectionType || nodeType.outputs.includes(connectionType);
	}

	if (!nodeType.outputs || !Array.isArray(nodeType.outputs)) return false;

	return nodeType.outputs.some((output) => {
		if (typeof output === 'string') return output === connectionType || output.includes(connectionType);
		return output.type === connectionType;
	});
}
