/**
 * Display conditions + features — `NodeHelpers` condition surface.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/workflow/src/node-helpers.ts
 *     - checkConditions   L330-401  (exactly-one-key `_cnd` conditions, empty-array rule)
 *     - evaluateFeature   L265-267
 *     - getNodeFeatures   L275-287
 *   Oracle: node-helpers.conditions.test.ts drives these through getNodeParameters;
 *   this module pins the same rules directly (the parameter resolver itself is a
 *   later slice, see README §Surface).
 */

import { isEqual } from './lodash-lite.mjs';

/**
 * `checkConditions(conditions, actualValues)` — true when **any** condition matches.
 * A condition is either a literal compared with `includes`, or a single-key `_cnd`
 * object whose operator is applied to **every** actual value.
 */
export function checkConditions(conditions, actualValues) {
	return conditions.some((condition) => {
		if (condition && typeof condition === 'object' && condition._cnd && Object.keys(condition).length === 1) {
			const [key, targetValue] = Object.entries(condition._cnd)[0];

			// Special case: empty array handling
			if (actualValues.length === 0) {
				if (key === 'not') return true; // Value is not present, so 'not' is true
				return false; // For all other keys, empty array means condition is not met
			}

			return actualValues.every((propertyValue) => {
				if (key === 'eq') return isEqual(propertyValue, targetValue);
				if (key === 'not') return !isEqual(propertyValue, targetValue);
				if (key === 'gte') return propertyValue >= targetValue;
				if (key === 'lte') return propertyValue <= targetValue;
				if (key === 'gt') return propertyValue > targetValue;
				if (key === 'lt') return propertyValue < targetValue;
				if (key === 'between') {
					const { from, to } = targetValue;
					return propertyValue >= from && propertyValue <= to;
				}
				if (key === 'includes') return String(propertyValue).includes(targetValue);
				if (key === 'startsWith') return String(propertyValue).startsWith(targetValue);
				if (key === 'endsWith') return String(propertyValue).endsWith(targetValue);
				if (key === 'regex') return new RegExp(targetValue).test(String(propertyValue));
				if (key === 'exists') {
					return propertyValue !== null && propertyValue !== undefined && propertyValue !== '';
				}
				return false;
			});
		}

		return actualValues.includes(condition);
	});
}

/** `evaluateFeature(featureDef, nodeVersion)` — the `@version` condition of a feature. */
function evaluateFeature(featureDef, nodeVersion) {
	return checkConditions(featureDef['@version'], [nodeVersion]);
}

/** `getNodeFeatures(featuresDef, nodeVersion)` — `{ [feature]: enabled }`, `{}` without defs. */
export function getNodeFeatures(featuresDef, nodeVersion) {
	if (!featuresDef) return {};

	const features = {};
	for (const [featureName, condition] of Object.entries(featuresDef)) {
		features[featureName] = evaluateFeature(condition, nodeVersion);
	}
	return features;
}
