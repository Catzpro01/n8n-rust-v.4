/**
 * Display rules — `NodeHelpers.displayParameter` / `displayParameterPath`.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/workflow/src/node-helpers.ts
 *     - getPropertyValues      L290-328 (`/root`, `@version`, `@tool`, `@feature`, `__rl`)
 *     - displayParameter       L403-467 (show = all rules match, hide = any rule matches)
 *     - displayParameterPath   L469-503 (path resolution + `parameters`-root rule)
 */

import { checkConditions, getNodeFeatures } from './conditions.mjs';
import { get } from './lodash-lite.mjs';

/**
 * `getPropertyValues(nodeValues, propertyName, node, nodeTypeDescription, nodeValuesRoot)`.
 * Resolves the special property names and always answers with an array.
 */
export function getPropertyValues(nodeValues, propertyName, node, nodeTypeDescription, nodeValuesRoot) {
	let value;

	if (propertyName.charAt(0) === '/') {
		// Get the value from the root of the node
		value = get(nodeValuesRoot, propertyName.slice(1));
	} else if (propertyName === '@version') {
		value = node?.typeVersion || 0;
	} else if (propertyName === '@tool') {
		value = nodeTypeDescription?.name.endsWith('Tool') ?? false;
	} else if (propertyName === '@feature') {
		if (!nodeTypeDescription?.features || !node?.typeVersion) return [];

		const features = getNodeFeatures(nodeTypeDescription.features, node.typeVersion);
		return Object.entries(features)
			.filter(([, enabled]) => enabled)
			.map(([name]) => name);
	} else {
		// Get the value from current level
		value = get(nodeValues, propertyName);
	}

	if (value && typeof value === 'object' && '__rl' in value && value.__rl) {
		value = value.value;
	}

	return Array.isArray(value) ? value : [value];
}

/**
 * `displayParameter(nodeValues, parameter, node, nodeTypeDescription, nodeValuesRoot?, displayKey?)`.
 * A parameter without the display key is always shown; an expression-looking value
 * short-circuits `show` to true (L432-435).
 */
export function displayParameter(
	nodeValues,
	parameter,
	node,
	nodeTypeDescription,
	nodeValuesRoot,
	displayKey = 'displayOptions',
) {
	if (!parameter[displayKey]) return true;

	const { show, hide } = parameter[displayKey];

	nodeValuesRoot = nodeValuesRoot || nodeValues;

	if (show) {
		// All the defined rules have to match to display parameter
		for (const propertyName of Object.keys(show)) {
			const values = getPropertyValues(nodeValues, propertyName, node, nodeTypeDescription, nodeValuesRoot);

			if (values.some((v) => typeof v === 'string' && v.charAt(0) === '=')) {
				return true;
			}

			if (!checkConditions(show[propertyName], values)) {
				return false;
			}
		}
	}

	if (hide) {
		// Any of the defined hide rules have to match to hide the parameter
		for (const propertyName of Object.keys(hide)) {
			const values = getPropertyValues(nodeValues, propertyName, node, nodeTypeDescription, nodeValuesRoot);

			if (values.length !== 0 && checkConditions(hide[propertyName], values)) {
				return false;
			}
		}
	}

	return true;
}

/**
 * `displayParameterPath(nodeValues, parameter, path, node, nodeTypeDescription, displayKey?)`.
 * The values are taken from `path`, and when the path starts inside `parameters` the
 * root for `/`-prefixed rule targets becomes `nodeValues.parameters` (L480-491).
 */
export function displayParameterPath(
	nodeValues,
	parameter,
	path,
	node,
	nodeTypeDescription,
	displayKey = 'displayOptions',
) {
	let resolvedNodeValues = nodeValues;
	if (path !== '') resolvedNodeValues = get(nodeValues, path);

	// Get the root parameter data
	let nodeValuesRoot = nodeValues;
	if (path && path.split('.').indexOf('parameters') === 0) {
		nodeValuesRoot = get(nodeValues, 'parameters');
	}

	return displayParameter(
		resolvedNodeValues,
		parameter,
		node,
		nodeTypeDescription,
		nodeValuesRoot,
		displayKey,
	);
}
