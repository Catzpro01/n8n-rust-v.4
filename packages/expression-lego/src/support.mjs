/**
 * Expression LEGO — shared support types/helpers.
 * Ports of n8n-workflow 2.9.4: constants.ts (subset), workflow-data-proxy-helpers.ts,
 * workflow-data-proxy-env-provider.ts, utils.ts (subset), type-guards.ts (subset).
 */

import { ExpressionError } from './errors.mjs';
import { augmentArray, augmentObject } from './augment-object.mjs';

export const SCRIPTING_NODE_TYPES = [
	'n8n-nodes-base.function',
	'n8n-nodes-base.functionItem',
	'n8n-nodes-base.code',
	'@n8n/n8n-nodes-langchain.aiTransform',
];

export const BINARY_MODE_COMBINED = 'combined';

export const AGENT_LANGCHAIN_NODE_TYPE = '@n8n/n8n-nodes-langchain.agent';

export const PAIRED_ITEM_METHOD = {
	PAIRED_ITEM: 'pairedItem',
	ITEM_MATCHING: 'itemMatching',
	ITEM: 'item',
	$GET_PAIRED_ITEM: '$getPairedItem',
};

export const isScriptingNode = (nodeName, workflow) => {
	const node = workflow.getNode(nodeName);
	return node && SCRIPTING_NODE_TYPES.includes(node.type);
};

/** workflow-data-proxy-helpers.ts */
export function getPinDataIfManualExecution(workflow, nodeName, mode) {
	if (mode !== 'manual') return undefined;
	return workflow.getPinDataOfNode(nodeName);
}

/** workflow-data-proxy-env-provider.ts */
export function createEnvProviderState() {
	const isProcessAvailable = typeof process !== 'undefined';
	const isEnvAccessBlocked = isProcessAvailable
		? process.env.N8N_BLOCK_ENV_ACCESS_IN_NODE !== 'false'
		: false;
	const env =
		!isProcessAvailable || isEnvAccessBlocked ? {} : { ...process.env };
	return { isProcessAvailable, isEnvAccessBlocked, env };
}

export function createEnvProvider(runIndex, itemIndex, providerState) {
	return new Proxy(
		{},
		{
			has() {
				return true;
			},
			get(_, name) {
				if (name === 'isProxy') return true;
				if (!providerState.isProcessAvailable) {
					throw new ExpressionError('not accessible via UI, please run node', { runIndex, itemIndex });
				}
				if (providerState.isEnvAccessBlocked) {
					throw new ExpressionError('access to env vars denied', {
						causeDetailed:
							'If you need access please contact the administrator to remove the environment variable ‘N8N_BLOCK_ENV_ACCESS_IN_NODE‘',
						runIndex,
						itemIndex,
					});
				}
				return providerState.env[name.toString()];
			},
		},
	);
}

/** type-guards.ts */
export function isResourceLocatorValue(value) {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		value.__rl !== undefined
	);
}

/** utils.ts */
export function deepCopy(value) {
	if (value === null || typeof value !== 'object') return value;
	if (value instanceof Date) return new Date(value);
	return JSON.parse(JSON.stringify(value));
}

export function isObjectEmpty(obj) {
	return obj && Object.keys(obj).length === 0;
}

/** expression.ts — copy-on-write views for scripting nodes (invariant E15). */
export { augmentObject, augmentArray };

/** global-state.ts (subset) */
let globalState = { defaultTimezone: 'America/New_York' };
export const getGlobalState = () => globalState;
export const setGlobalState = (patch) => (globalState = { ...globalState, ...patch });
