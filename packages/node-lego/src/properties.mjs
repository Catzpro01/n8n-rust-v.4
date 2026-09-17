/**
 * Property + name/tool helpers — merge, versioning, naming, descriptions.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/workflow/src/node-helpers.ts
 *     - mergeNodeProperties            L1641-1659
 *     - getVersionedNodeType           L1661-1669
 *     - isNodeWithWorkflowSelector     L1688-1690
 *     - resolveResourceAndOperation    L1692-1739 (private in the reference)
 *     - makeDescription                L1741-1759
 *     - isToolType / isHitlToolType / isTool L1761-1814
 *     - makeNodeName                   L1816-1847
 *     - isDefaultNodeName              L1849-1862
 *     - getUpdatedToolDescription      L1864-1888
 *     - getToolDescriptionForNode      L1890-1906
 *     - getSubworkflowId               L1908-1919
 *   Supporting guards: type-guards.ts isINodeProperties / isINodePropertyOptions /
 *     isINodePropertyOptionsList (L21-39).
 *   Oracles: node-helpers.test.ts (makeNodeName, isDefaultNodeName, tool helpers).
 */

import { NodeConnectionTypes } from './connection-io.mjs';

const EXECUTE_WORKFLOW_NODE_TYPE = 'n8n-nodes-base.executeWorkflow';
const WORKFLOW_TOOL_LANGCHAIN_NODE_TYPE = '@n8n/n8n-nodes-langchain.toolWorkflow';

/** `isINodeProperties(item)` — type-guards.ts L21-23. */
export const isINodeProperties = (item) => 'name' in item && 'type' in item && !('value' in item);

/** `isINodePropertyOptions(item)` — type-guards.ts L25-27. */
export const isINodePropertyOptions = (item) => 'value' in item && 'name' in item && !('displayName' in item);

/** `isINodePropertyOptionsList(items)` — type-guards.ts L37-39. */
export const isINodePropertyOptionsList = (items) =>
	Array.isArray(items) && items.every(isINodePropertyOptions);

/** `mergeNodeProperties(mainProperties, addProperties)` — in place; `doNotInherit` skips. */
export function mergeNodeProperties(mainProperties, addProperties) {
	for (const property of addProperties) {
		if (property.doNotInherit) continue;

		const existingIndex = mainProperties.findIndex((element) => element.name === property.name);

		if (existingIndex === -1) {
			// Property does not exist yet, so add
			mainProperties.push(property);
		} else {
			// Property exists already, so overwrite
			mainProperties[existingIndex] = property;
		}
	}
}

/** `getVersionedNodeType(object, version)` — resolves a `IVersionedNodeType` container. */
export function getVersionedNodeType(object, version) {
	if ('nodeVersions' in object) return object.getNodeType(version);
	return object;
}

/** `isNodeWithWorkflowSelector(node)` — execute-workflow or the workflow tool. */
export function isNodeWithWorkflowSelector(node) {
	return [EXECUTE_WORKFLOW_NODE_TYPE, WORKFLOW_TOOL_LANGCHAIN_NODE_TYPE].includes(node.type);
}

/**
 * @returns An object containing either the resolved operation's action if available,
 * else the resource and operation if both exist.
 * If neither can be resolved, returns an empty object.
 */
function resolveResourceAndOperation(nodeParameters, nodeTypeDescription) {
	if (nodeTypeDescription.name === 'n8n-nodes-base.code') {
		const language = nodeParameters.language;
		const langProp = nodeTypeDescription.properties.find((p) => p.name === 'language');
		if (langProp?.options && isINodePropertyOptionsList(langProp.options)) {
			const found = langProp.options.find((o) => o.value === language);
			if (found?.action) return { action: found.action };
		}
	}

	const resource = nodeParameters.resource;
	const operation = nodeParameters.operation;
	const nodeTypeOperation = nodeTypeDescription.properties.find(
		(p) => p.name === 'operation' && p.displayOptions?.show?.resource?.includes(resource),
	);

	if (nodeTypeOperation?.options && isINodePropertyOptionsList(nodeTypeOperation.options)) {
		const foundOperation = nodeTypeOperation.options.find((option) => option.value === operation);
		if (foundOperation?.action) {
			return { action: foundOperation.action };
		}
	}

	if (resource && operation) {
		return { operation, resource };
	}
	return {};
}

/**
 * Generates a human-readable description for a node based on its parameters and type definition.
 *
 * 1. "{action} in {displayName}" if the operation has a defined action
 * 2. "{operation} {resource} in {displayName}" if resource and operation exist
 * 3. The node type's description field as a fallback
 */
export function makeDescription(nodeParameters, nodeTypeDescription) {
	const { action, operation, resource } = resolveResourceAndOperation(nodeParameters, nodeTypeDescription);

	if (action) return `${action} in ${nodeTypeDescription.defaults.name}`;

	if (resource && operation) return `${operation} ${resource} in ${nodeTypeDescription.defaults.name}`;

	return nodeTypeDescription.description;
}

/** `isToolType(nodeType?, { includeHitl })` — `*Tool` / `tool*` suffix on the last segment. */
export function isToolType(nodeType, { includeHitl = true } = {}) {
	if (!nodeType) return false;
	const node = nodeType.split('.').pop();
	if (node?.endsWith('Tool') || node?.startsWith('tool')) {
		// don't check if it's hitl
		if (includeHitl) return true;
		return !isHitlToolType(nodeType);
	}
	return false;
}

/** `isHitlToolType(nodeType?)` — the `*HitlTool` suffix. */
export function isHitlToolType(nodeType) {
	if (!nodeType) return false;
	return nodeType.endsWith('HitlTool');
}

/** `isTool(nodeTypeDescription, parameters)` — vector-store tool mode or `ai_tool` output. */
export function isTool(nodeTypeDescription, parameters) {
	// Check if node is a vector store in retrieve-as-tool mode
	if (nodeTypeDescription.name.includes('vectorStore')) {
		const mode = parameters.mode;
		return mode === 'retrieve-as-tool';
	}

	// Check for other tool nodes
	if (Array.isArray(nodeTypeDescription.outputs)) {
		// Handle static outputs (array case)
		for (const output of nodeTypeDescription.outputs) {
			if (typeof output === 'string') {
				return output === NodeConnectionTypes.AiTool;
			} else if (output?.type && output.type === NodeConnectionTypes.AiTool) {
				return true;
			}
		}
	}

	return false;
}

/**
 * Generates a resource and operation aware node name.
 *
 * Appends `in {nodeTypeDisplayName}` if nodeType is a tool
 * 1. "{action}" if the operation has a defined action
 * 2. "{operation} {resource}" if resource and operation exist
 * 3. The node type's defaults.name field or displayName as a fallback
 */
export function makeNodeName(nodeParameters, nodeTypeDescription) {
	// If skipNameGeneration is set, skip resource/operation resolution
	if (nodeTypeDescription.skipNameGeneration) {
		return nodeTypeDescription.defaults.name ?? nodeTypeDescription.displayName;
	}

	const { action, operation, resource } = resolveResourceAndOperation(nodeParameters, nodeTypeDescription);

	const postfix = isTool(nodeTypeDescription, nodeParameters)
		? ` in ${nodeTypeDescription.defaults.name}`
		: '';

	if (action) return `${action}${postfix}`;

	if (resource && operation) {
		const operationProper = operation[0].toUpperCase() + operation.slice(1);
		return `${operationProper} ${resource}${postfix}`;
	}

	return nodeTypeDescription.defaults.name ?? nodeTypeDescription.displayName;
}

/**
 * Returns true if the node name is of format `<defaultNodeName>\d*` , which includes auto-renamed nodes
 */
export function isDefaultNodeName(name, nodeType, parameters) {
	const currentDefaultName = makeNodeName(parameters, nodeType);

	return name.startsWith(currentDefaultName) && /^\d*$/.test(name.slice(currentDefaultName.length));
}

/**
 * Determines whether a tool description should be updated and returns the new description if needed.
 * Returns undefined if no update is needed.
 */
export const getUpdatedToolDescription = (currentNodeType, newParameters, currentParameters) => {
	if (!currentNodeType) return;

	if (newParameters?.descriptionType === 'manual' && currentParameters) {
		const previousDescription = makeDescription(currentParameters, currentNodeType);
		const newDescription = makeDescription(newParameters, currentNodeType);

		if (
			newParameters.toolDescription === previousDescription ||
			!newParameters.toolDescription?.toString().trim() ||
			newParameters.toolDescription === currentNodeType.description
		) {
			return newDescription;
		}
	}
};

/** Generates a tool description for a given node based on its parameters and type. */
export function getToolDescriptionForNode(node, nodeType) {
	let toolDescription;
	if (node.parameters.descriptionType === 'auto' || !node?.parameters.toolDescription?.toString().trim()) {
		toolDescription = makeDescription(node.parameters, nodeType.description);
	} else if (node?.parameters.toolDescription) {
		toolDescription = node.parameters.toolDescription;
	} else {
		toolDescription = nodeType.description.description;
	}
	return toolDescription;
}

/** Attempts to retrieve the ID of a subworkflow from a execute workflow node. */
export function getSubworkflowId(node) {
	if (isNodeWithWorkflowSelector(node) && isResourceLocatorValue(node.parameters.workflowId)) {
		return node.parameters.workflowId.value;
	}
	return undefined;
}

/** `isResourceLocatorValue(value)` — inlined from type-guards.ts to avoid a cycle. */
function isResourceLocatorValue(value) {
	return Boolean(
		typeof value === 'object' && value && 'mode' in value && 'value' in value && '__rl' in value,
	);
}
