/**
 * Error strategy of the execute loop — POOL-003.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/core/src/execution-engine/workflow-execute.ts
 *     - L1707 (`onError === 'continueErrorOutput'` → handleNodeErrorOutput)
 *     - L1843-1865 (continueOnFail / continueRegularOutput / continueErrorOutput)
 *     - L1934-1958 ("Merge error information to default output")
 *     - L2463-2570 (handleNodeErrorOutput)
 */

export const ERROR_STRATEGIES = Object.freeze(['stopWorkflow', 'continueRegularOutput', 'continueErrorOutput']);

/**
 * Resolution order is upstream's: the deprecated `continueOnFail` flag wins over
 * `onError`, and both "continue" strategies behave identically *while a node
 * throws* — they only differ for items that carry error information
 * (`continueErrorOutput` splits them onto the last output).
 */
export function resolveErrorStrategy(node = {}) {
	if (node.continueOnFail === true) {
		return { strategy: 'continueRegularOutput', source: 'continueOnFail', continueOnFail: true };
	}

	if (node.onError === 'continueRegularOutput' || node.onError === 'continueErrorOutput') {
		return { strategy: node.onError, source: 'onError', continueOnFail: false };
	}

	return { strategy: 'stopWorkflow', source: 'default', continueOnFail: false };
}

export function continuesOnError(node) {
	return resolveErrorStrategy(node).strategy !== 'stopWorkflow';
}

/**
 * Pass-through used when a node throws but is allowed to continue:
 * "Simply get the input data of the node if it has any and pass it through to
 * the next node" (workflow-execute.ts L1848-1852). Only `main[0]` is considered.
 */
export function errorPassThrough(executionData) {
	const mainInput = executionData?.data?.main;
	if (!mainInput || mainInput.length === 0) return null;
	if (mainInput[0] === null || mainInput[0] === undefined) return null;
	return [mainInput[0]];
}

/**
 * `handleNodeErrorOutput` — moves items that carry error information from every
 * main output onto the *last* main output (the error output).
 *
 * An item counts as an error item when (L2500-2506):
 *   - `item.error` is set, or
 *   - `item.json.error` is the only key, or
 *   - `item.json.error` + `item.json.message` are the only keys.
 *
 * When the paired item can be resolved through the data proxy, the source item's
 * json is merged *under* the error json (L2540-2548); otherwise the item is moved
 * as-is.
 */
export function splitErrorOutputs(nodeSuccessData, { mainOutputCount, resolvePairedItem } = {}) {
	if (!nodeSuccessData) return nodeSuccessData;

	const outputCount = mainOutputCount ?? nodeSuccessData.length;
	const errorItems = [];

	for (let outputIndex = 0; outputIndex < outputCount - 1; outputIndex++) {
		const successItems = [];
		const items = nodeSuccessData[outputIndex]?.length ? [...nodeSuccessData[outputIndex]] : [];

		while (items.length) {
			const item = items.shift();
			if (item === undefined) continue;

			let errorData;
			if (item.error) {
				errorData = item.error;
			} else if (item.json?.error && Object.keys(item.json).length === 1) {
				errorData = item.json.error;
			} else if (item.json?.error && item.json.message && Object.keys(item.json).length === 2) {
				errorData = item.json.error;
			}

			if (!errorData) {
				successItems.push(item);
				continue;
			}

			const pairedItemData =
				item.pairedItem && typeof item.pairedItem === 'object'
					? Array.isArray(item.pairedItem)
						? item.pairedItem[0]
						: item.pairedItem
					: undefined;

			const pairedJson = resolvePairedItem ? resolvePairedItem(item, pairedItemData) : null;

			if (pairedJson === null || pairedJson === undefined) {
				errorItems.push(item);
			} else {
				errorItems.push({ ...item, json: { ...pairedJson, ...item.json } });
			}
		}

		nodeSuccessData[outputIndex] = successItems;
	}

	nodeSuccessData[outputCount - 1] = errorItems;
	return nodeSuccessData;
}

/**
 * "Merge error information to default output": items that were returned with an
 * `error` property (instead of thrown) are normalised to `{ json: { error } }`
 * with the error object kept alongside (L1934-1958).
 */
export function mergeErrorInformation(nodeSuccessData) {
	if (!nodeSuccessData) return nodeSuccessData;

	for (const output of nodeSuccessData) {
		for (const item of output ?? []) {
			if (item.json !== undefined && item.json.$error !== undefined && item.json.$json !== undefined) {
				item.error = item.json.$error;
				item.json = { error: item.json.$error.message };
			} else if (item.error !== undefined) {
				item.json = { error: item.error.message };
			}
		}
	}

	return nodeSuccessData;
}

/**
 * Builds the `{ json: { error }, pairedItem }` item n8n produces for nodes that
 * use `continueOnFail` *inside* their own implementation.
 */
export function buildErrorItem(error, pairedItem) {
	return { json: { error: error?.message ?? String(error) }, pairedItem };
}
