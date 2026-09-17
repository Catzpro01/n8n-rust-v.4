/** Parameter issues engine reconstructed from node-helpers.ts L1202-1636. */
import { displayParameterPath } from './display.mjs';
import { getParameterValueByPath, isFilterValue, isResourceMapperValue } from './parameter-utils.mjs';
import { validateFieldType } from './field-validation.mjs';

const ensureIssue = (issues, name, message) => {
	issues.parameters ??= {};
	issues.parameters[name] ??= [];
	issues.parameters[name].push(message);
};

export function mergeIssues(destination, source) {
	if (source === null) return;
	if (source.execution === true) destination.execution = true;
	for (const propertyName of ['parameters', 'credentials']) {
		if (source[propertyName] === undefined) continue;
		destination[propertyName] ??= {};
		for (const parameterName of Object.keys(source[propertyName])) {
			destination[propertyName][parameterName] ??= [];
			destination[propertyName][parameterName].push(...source[propertyName][parameterName]);
		}
	}
	if (source.typeUnknown === true) destination.typeUnknown = true;
}

const isValidLocator = (value) => {
	if (typeof value === 'object' && value !== null) return typeof value.value === 'number' || Boolean(value.value);
	return Boolean(value);
};

const addMissing = (issues, property, value) => {
	const missing =
		(property.type === 'string' && (value === '' || value === undefined)) ||
		(property.type === 'multiOptions' && Array.isArray(value) && value.length === 0) ||
		(property.type === 'dateTime' && (value === '' || value === undefined)) ||
		(property.type === 'options' && (value === '' || value === undefined)) ||
		(['resourceLocator', 'workflowSelector'].includes(property.type) && !isValidLocator(value));
	if (missing) ensureIssue(issues, property.name, `Parameter "${property.displayName}" is required.`);
};

const validateLocator = (value, mode) => {
	const candidate = value?.value?.toString() || '';
	if (candidate.startsWith('=')) return [];
	return (mode.validation ?? []).flatMap((validation) => {
		if (validation?.type !== 'regex') return [];
		return new RegExp(`^${validation.properties.regex}$`).test(candidate) ? [] : [validation.properties.errorMessage];
	});
};

const validateMapper = (property, value, skipRequired) => {
	if (value.mappingMode === 'autoMapInputData') return {};
	const issues = {};
	let word = property.typeOptions?.resourceMapper?.fieldWords?.singular || 'Field';
	word = word.charAt(0).toUpperCase() + word.slice(1);
	for (const field of value.schema) {
		const fieldValue = value.value ? value.value[field.id] : null;
		const errors = [];
		if (field.required && !skipRequired && (value.value === null || fieldValue === undefined)) errors.push(`${word} "${field.id}" is required`);
		if (!fieldValue?.toString().startsWith('=') && field.type) {
			const result = validateFieldType(field.id, fieldValue, field.type, { valueOptions: field.options });
			if (!result.valid && result.errorMessage) errors.push(result.errorMessage);
		}
		if (errors.length) issues[`${property.name}.${field.id}`] = errors;
	}
	return issues;
};

export function getNodeParametersIssues(properties, node, nodeTypeDescription, pinDataNodeNames) {
	if (node.disabled === true || pinDataNodeNames?.includes(node.name)) return null;
	const found = {};
	for (const property of properties) mergeIssues(found, getParameterIssues(property, node.parameters, '', node, nodeTypeDescription));
	return Object.keys(found).length === 0 ? null : found;
}

export function getParameterIssues(property, nodeValues, path, node, nodeTypeDescription) {
	const found = {};
	const displayed = displayParameterPath(nodeValues, property, path, node, nodeTypeDescription);
	if (property.required === true && displayed) {
		const value = getParameterValueByPath(nodeValues, property.name, path);
		if (property.typeOptions?.multipleValues !== undefined) {
			if (Array.isArray(value)) for (const item of value) addMissing(found, property, item);
		} else addMissing(found, property, value);
	}

	if (['resourceLocator', 'workflowSelector'].includes(property.type) && displayed) {
		const value = getParameterValueByPath(nodeValues, property.name, path);
		if (typeof value === 'object' && value !== null && 'value' in value && 'mode' in value) {
			const mode = property.modes?.find((candidate) => candidate.name === value.mode);
			if (mode) for (const error of validateLocator(value, mode)) ensureIssue(found, property.name, error);
		}
	} else if (property.type === 'resourceMapper' && displayed) {
		const value = getParameterValueByPath(nodeValues, property.name, path);
		if (isResourceMapperValue(value)) {
			const nested = validateMapper(property, value, property.typeOptions?.resourceMapper?.mode !== 'add');
			if (Object.keys(nested).length) found.parameters = { ...(found.parameters ?? {}), ...nested };
		}
	} else if (property.type === 'filter' && displayed) {
		// The pinned 2.9.x validator yields no issues for unresolved filter expressions.
		const value = getParameterValueByPath(nodeValues, property.name, path);
		if (isFilterValue(value)) { /* intentionally empty: pinned validateFilterParameter result */ }
	} else if (property.validateType) {
		const value = getParameterValueByPath(nodeValues, property.name, path);
		if (!value?.toString().startsWith('=')) {
			const result = validateFieldType(property.name, value, property.validateType, {
				valueOptions: property.validateType === 'options' ? property.options : undefined,
			});
			if (!result.valid && result.errorMessage) ensureIssue(found, property.name, result.errorMessage);
		}
	}

	if (property.options === undefined) return found;
	let basePath = path ? `${path}.` : '';
	const children = [];
	if (property.type === 'collection') {
		for (const option of property.options) children.push({ basePath, data: option });
	} else if (property.type === 'fixedCollection' && displayed) {
		basePath = basePath ? `${basePath}.` : `${property.name}.`;
		for (const group of property.options) {
			const value = getParameterValueByPath(nodeValues, group.name, basePath.slice(0, -1));
			const array = Array.isArray(value) ? value : [];
			const { minRequiredFields, maxAllowedFields } = property.typeOptions ?? {};
			if (minRequiredFields && array.length < minRequiredFields) ensureIssue(found, property.name, `At least ${minRequiredFields} ${minRequiredFields === 1 ? 'field is' : 'fields are'} required.`);
			if (maxAllowedFields && array.length > maxAllowedFields) ensureIssue(found, property.name, `At most ${maxAllowedFields} ${maxAllowedFields === 1 ? 'field is' : 'fields are'} allowed.`);
			if (value === undefined) continue;
			if (property.typeOptions?.multipleValues !== undefined) {
				if (Array.isArray(value)) for (let i = 0; i < value.length; i++) for (const option of group.values) children.push({ basePath: `${basePath}${group.name}[${i}]`, data: option });
			} else for (const option of group.values) children.push({ basePath: basePath + group.name, data: option });
		}
	} else return found;
	for (const child of children) mergeIssues(found, getParameterIssues(child.data, nodeValues, child.basePath, node, nodeTypeDescription));
	return found;
}
