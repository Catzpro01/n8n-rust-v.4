/**
 * Parameter utilities — path resolution, value lookup, renames and the value guards.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/workflow/src/node-parameters/path-utils.ts (24 ln, whole file)
 *   reference/n8n/packages/workflow/src/node-parameters/rename-node-utils.ts (29 ln)
 *   reference/n8n/packages/workflow/src/node-parameters/node-parameter-value-type-guard.ts (127 ln)
 *   reference/n8n/packages/workflow/src/node-helpers.ts getParameterValueByPath L1369-1375
 *   reference/n8n/packages/workflow/src/type-guards.ts L15-19, L60-68, L93-97 (the three guards
 *     the value guard composes: isResourceLocatorValue / isResourceMapperValue / isFilterValue)
 *   Oracles: node-parameters/path-utils.test.ts, node-parameter-value-type-guard.test.ts,
 *            rename-node-utils.test.ts
 */

import { get } from './lodash-lite.mjs';

/**
 * Resolve relative paths starting in & in the context of a given full path including parameters,
 * which will be dropped in the process.
 * If `candidateRelativePath` is not relative, it is returned unchanged.
 *
 * `parameters.a.b.c`, `&d` -> `a.b.d`
 * `parameters.a.b[0].c`, `&d` -> `a.b[0].d`
 * `parameters.a.b.c`, `d` -> `d`
 */
export function resolveRelativePath(fullPathWithParameters, candidateRelativePath) {
	if (candidateRelativePath.startsWith('&')) {
		const resolvedLeaf = candidateRelativePath.slice(1);
		const pathToLeaf = fullPathWithParameters.split('.').slice(1, -1).join('.');

		if (!pathToLeaf) return resolvedLeaf;

		return `${pathToLeaf}.${resolvedLeaf}`;
	}

	return candidateRelativePath;
}

/** `getParameterValueByPath(nodeValues, parameterName, path)` — `get(values, path + '.' + name)`. */
export function getParameterValueByPath(nodeValues, parameterName, path) {
	return get(nodeValues, path ? `${path}.${parameterName}` : parameterName);
}

/** `renameFormFields(node, renameField)` — rewrites `formFields.values[].html` in place. */
export function renameFormFields(node, renameField) {
	const formFields = node.parameters?.formFields;

	const values =
		formFields &&
		typeof formFields === 'object' &&
		'values' in formFields &&
		typeof formFields.values === 'object' &&
		Array.isArray(formFields.values)
			? (formFields.values ?? [])
			: [];

	for (const formFieldValue of values) {
		if (!formFieldValue || typeof formFieldValue !== 'object') continue;
		if ('fieldType' in formFieldValue && formFieldValue.fieldType === 'html') {
			if ('html' in formFieldValue) {
				formFieldValue.html = renameField(formFieldValue.html);
			}
		}
	}
}

/* --- value guards (type-guards.ts + node-parameter-value-type-guard.ts) ------ */

/** `isResourceLocatorValue(value)` — type-guards.ts L15-19. */
export function isResourceLocatorValue(value) {
	return Boolean(
		typeof value === 'object' && value && 'mode' in value && 'value' in value && '__rl' in value,
	);
}

/** `isResourceMapperValue(value)` — type-guards.ts L60-68. */
export function isResourceMapperValue(value) {
	return (
		typeof value === 'object' && value !== null && 'mappingMode' in value && 'schema' in value && 'value' in value
	);
}

/** `isFilterValue(value)` — type-guards.ts L93-97. */
export function isFilterValue(value) {
	return typeof value === 'object' && value !== null && 'conditions' in value && 'combinator' in value;
}

/** Primitive `NodeParameterValue` guard (string | number | boolean | undefined | null). */
export function isNodeParameterValue(value) {
	return (
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		value === undefined ||
		value === null
	);
}

/** `AssignmentCollectionValue` guard (`{ assignments: [{ id, name, value }] }`). */
export function isAssignmentCollectionValue(value) {
	if (typeof value !== 'object' || value === null || !('assignments' in value)) return false;

	const assignments = value.assignments;
	if (!Array.isArray(assignments)) return false;

	return assignments.every(
		(assignment) =>
			typeof assignment === 'object' &&
			assignment !== null &&
			'id' in assignment &&
			'name' in assignment &&
			'value' in assignment &&
			typeof assignment.id === 'string' &&
			typeof assignment.name === 'string' &&
			isNodeParameterValue(assignment.value),
	);
}

/**
 * `isNodeParameters(value)` — plain objects only (prototype check), every value
 * recursively a valid `NodeParameterValueType`.
 */
export function isNodeParameters(value) {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

	// Reject built-in class instances (Date, RegExp, etc.)
	// Only accept plain objects created with {} or Object.create(null)
	if (Object.prototype.toString.call(value) !== '[object Object]') return false;

	return Object.values(value).every((val) => isValidNodeParameterValueType(val));
}

/** `isValidNodeParameterValueType(value)` — the composed guard, in the reference's order. */
export function isValidNodeParameterValueType(value) {
	return (
		// Primitives (most common case)
		isNodeParameterValue(value) ||
		// Special object types
		isResourceLocatorValue(value) ||
		isResourceMapperValue(value) ||
		isFilterValue(value) ||
		isAssignmentCollectionValue(value) ||
		// Arrays - all items should be valid NodeParameterValueType
		(Array.isArray(value) &&
			(value.length === 0 ||
				value.every(isNodeParameterValue) ||
				value.every(isNodeParameters) ||
				value.every(isResourceLocatorValue) ||
				value.every(isResourceMapperValue))) ||
		// INodeParameters (must be last to avoid infinite recursion on first check)
		isNodeParameters(value)
	);
}

/** `assertIsValidNodeParameterValueType(value, message?)`. */
export function assertIsValidNodeParameterValueType(value, errorMessage = 'Value is not a valid NodeParameterValueType') {
	if (!isValidNodeParameterValueType(value)) throw new Error(errorMessage);
}
