/**
 * Parameter-ISSUES engine — the validation half of `node-helpers.ts`: it turns node
 * parameters into the `INodeIssues` structure the editor renders and the workflow
 * validation pass consumes.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/workflow/src/node-helpers.ts
 *     - getContext                              L505-538
 *     - getNodeParametersIssues                 L1202-1225
 *     - validateResourceLocatorParameter        L1228-1255
 *     - validateResourceMapperParameter         L1257-1303
 *     - validateParameter                       L1305-1323
 *     - addToIssuesIfMissing                    L1325-1358
 *     - isINodeParameterResourceLocator         L1369-1371
 *     - getParameterIssues                      L1389-1580
 *     - mergeIssues                             L1600-1635
 *   reference/n8n/packages/workflow/src/type-guards.ts
 *     - isValidResourceLocatorParameterValue    L47-57
 *
 * Pinned reference behaviours (differentially verified — see the conformance suite):
 *   - disabled nodes and nodes listed in `pinDataNodeNames` always yield `null`
 *   - a `resourceLocator`/`workflowSelector` value that starts with `=` skips its regex
 *     validation entirely (expressions are validated at run time)
 *   - `typeOptions.multipleValues` loops over the single values of an array, otherwise the
 *     value is checked as-is
 *   - fixedCollection child checks run only for options whose value is defined, while the
 *     min/max field-count errors are raised even when the value is `undefined`
 *   - collection child parameters are checked against the *current* `path`, so a trailing
 *     dot is only added when `path` is non-empty
 *   - `mergeIssues` merges only `parameters`/`credentials`/`execution`/`typeUnknown`; every
 *     other key of the source object is ignored
 *
 * Boundaries: consumes the display, parameter-value and field-type helpers of this package.
 * `getNodeWebhookPath`/`getNodeWebhookUrl`/`cronNodeOptions` remain out of scope
 * (contract §12.2.5), as does the execution half of the filter parameter (§12.2.6).
 */

import { ApplicationError } from './errors.mjs';
import { getParameterValueByPath, isFilterValue, isResourceMapperValue } from './parameter-utils.mjs';
import { displayParameterPath } from './display.mjs';
import { validateFieldType } from './type-validation.mjs';
import { validateFilterParameter } from './filter-parameter.mjs';

/**
 * `getContext` — node-helpers.ts L505-538. The two `ApplicationError`s carry the reference's
 * `extra` payloads; `packageName` is not reconstructed (DELTA-03).
 */
export function getContext(runExecutionData, type, node) {
	if (runExecutionData.executionData === undefined) {
		// TODO: Should not happen leave it for test now
		throw new ApplicationError('`executionData` is not initialized');
	}

	let key;
	if (type === 'flow') {
		key = 'flow';
	} else if (type === 'node') {
		if (node === undefined) {
			// @TODO: What does this mean?
			throw new ApplicationError(
				'The request data of context type "node" the node parameter has to be set!',
			);
		}
		key = `node:${node.name}`;
	} else {
		throw new ApplicationError('Unknown context type. Only `flow` and `node` are supported.', {
			extra: { contextType: type },
		});
	}

	if (runExecutionData.executionData.contextData[key] === undefined) {
		runExecutionData.executionData.contextData[key] = {};
	}

	return runExecutionData.executionData.contextData[key];
}

/**
 * Returns all the issues of the given node (L1202-1225).
 *
 * A node that is disabled or has pinned data is never validated.
 */
export function getNodeParametersIssues(
	nodePropertiesArray,
	node,
	nodeTypeDescription,
	pinDataNodeNames,
) {
	const foundIssues = {};
	let propertyIssues;

	if (node.disabled === true || pinDataNodeNames?.includes(node.name)) {
		// Ignore issues on disabled and pindata nodes
		return null;
	}

	for (const nodeProperty of nodePropertiesArray) {
		propertyIssues = getParameterIssues(
			nodeProperty,
			node.parameters,
			'',
			node,
			nodeTypeDescription,
		);
		mergeIssues(foundIssues, propertyIssues);
	}

	if (Object.keys(foundIssues).length === 0) {
		return null;
	}

	return foundIssues;
}

/*
 * Validates resource locator node parameters based on validation ruled defined in each parameter mode
 */
const validateResourceLocatorParameter = (value, parameterMode) => {
	const valueToValidate = value?.value?.toString() || '';
	if (valueToValidate.startsWith('=')) {
		return [];
	}

	const validationErrors = [];
	// Each mode can have multiple validations specified
	if (parameterMode.validation) {
		for (const validation of parameterMode.validation) {
			if (validation && validation.type === 'regex') {
				const regexValidation = validation;
				const regex = new RegExp(`^${regexValidation.properties.regex}$`);

				if (!regex.test(valueToValidate)) {
					validationErrors.push(regexValidation.properties.errorMessage);
				}
			}
		}
	}

	return validationErrors;
};

/*
 * Validates resource mapper values based on service schema
 */
const validateResourceMapperParameter = (nodeProperties, value, skipRequiredCheck = false) => {
	// No issues to raise in automatic mapping mode, no user input to validate
	if (value.mappingMode === 'autoMapInputData') {
		return {};
	}

	const issues = {};
	let fieldWordSingular =
		nodeProperties.typeOptions?.resourceMapper?.fieldWords?.singular || 'Field';
	fieldWordSingular = fieldWordSingular.charAt(0).toUpperCase() + fieldWordSingular.slice(1);
	value.schema.forEach((field) => {
		const fieldValue = value.value ? value.value[field.id] : null;
		const key = `${nodeProperties.name}.${field.id}`;
		const fieldErrors = [];
		if (field.required && !skipRequiredCheck) {
			if (value.value === null || fieldValue === undefined) {
				const error = `${fieldWordSingular} "${field.id}" is required`;
				fieldErrors.push(error);
			}
		}
		if (!fieldValue?.toString().startsWith('=') && field.type) {
			const validationResult = validateFieldType(field.id, fieldValue, field.type, {
				valueOptions: field.options,
			});
			if (!validationResult.valid && validationResult.errorMessage) {
				fieldErrors.push(validationResult.errorMessage);
			}
		}
		if (fieldErrors.length > 0) {
			issues[key] = fieldErrors;
		}
	});
	return issues;
};

const validateParameter = (nodeProperties, value, type) => {
	const nodeName = nodeProperties.name;
	const options = type === 'options' ? nodeProperties.options : undefined;

	if (!value?.toString().startsWith('=')) {
		const validationResult = validateFieldType(nodeName, value, type, {
			valueOptions: options,
		});

		if (!validationResult.valid && validationResult.errorMessage) {
			return validationResult.errorMessage;
		}
	}

	return undefined;
};

/**
 * Adds an issue if the parameter is not defined
 */
function addToIssuesIfMissing(foundIssues, nodeProperties, value) {
	// TODO: Check what it really has when undefined
	if (
		(nodeProperties.type === 'string' && (value === '' || value === undefined)) ||
		(nodeProperties.type === 'multiOptions' && Array.isArray(value) && value.length === 0) ||
		(nodeProperties.type === 'dateTime' && (value === '' || value === undefined)) ||
		(nodeProperties.type === 'options' && (value === '' || value === undefined)) ||
		((nodeProperties.type === 'resourceLocator' || nodeProperties.type === 'workflowSelector') &&
			!isValidResourceLocatorParameterValue(value))
	) {
		// Parameter is required but empty
		if (foundIssues.parameters === undefined) {
			foundIssues.parameters = {};
		}
		if (foundIssues.parameters[nodeProperties.name] === undefined) {
			foundIssues.parameters[nodeProperties.name] = [];
		}

		foundIssues.parameters[nodeProperties.name].push(
			`Parameter "${nodeProperties.displayName}" is required.`,
		);
	}
}

/** type-guards.ts L47-57 */
const isValidResourceLocatorParameterValue = (value) => {
	if (typeof value === 'object') {
		if (typeof value.value === 'number') {
			return true; // Accept all numbers
		}
		return !!value.value;
	} else {
		return !!value;
	}
};

const isINodeParameterResourceLocator = (value) =>
	typeof value === 'object' && value !== null && 'value' in value && 'mode' in value;

/**
 * Returns all the issues with the given node-values (L1389-1580).
 *
 * Note: the child-parameter walk only runs when the parent parameter is a `collection` or a
 * displayed `fixedCollection`; every other parameter type returns early.
 */
export function getParameterIssues(nodeProperties, nodeValues, path, node, nodeTypeDescription) {
	const foundIssues = {};
	const isDisplayed = displayParameterPath(
		nodeValues,
		nodeProperties,
		path,
		node,
		nodeTypeDescription,
	);
	if (nodeProperties.required === true) {
		if (isDisplayed) {
			const value = getParameterValueByPath(nodeValues, nodeProperties.name, path);

			if (
				nodeProperties.typeOptions !== undefined &&
				nodeProperties.typeOptions.multipleValues !== undefined
			) {
				// Multiple can be set so will be an array
				if (Array.isArray(value)) {
					for (const singleValue of value) {
						addToIssuesIfMissing(foundIssues, nodeProperties, singleValue);
					}
				}
			} else {
				// Only one can be set so will be a single value
				addToIssuesIfMissing(foundIssues, nodeProperties, value);
			}
		}
	}

	if (
		(nodeProperties.type === 'resourceLocator' || nodeProperties.type === 'workflowSelector') &&
		isDisplayed
	) {
		const value = getParameterValueByPath(nodeValues, nodeProperties.name, path);
		if (isINodeParameterResourceLocator(value)) {
			const mode = nodeProperties.modes?.find((option) => option.name === value.mode);
			if (mode) {
				const errors = validateResourceLocatorParameter(value, mode);
				errors.forEach((error) => {
					if (foundIssues.parameters === undefined) {
						foundIssues.parameters = {};
					}
					if (foundIssues.parameters[nodeProperties.name] === undefined) {
						foundIssues.parameters[nodeProperties.name] = [];
					}

					foundIssues.parameters[nodeProperties.name].push(error);
				});
			}
		}
	} else if (nodeProperties.type === 'resourceMapper' && isDisplayed) {
		const skipRequiredCheck = nodeProperties.typeOptions?.resourceMapper?.mode !== 'add';
		const value = getParameterValueByPath(nodeValues, nodeProperties.name, path);
		if (isResourceMapperValue(value)) {
			const issues = validateResourceMapperParameter(nodeProperties, value, skipRequiredCheck);
			if (Object.keys(issues).length > 0) {
				if (foundIssues.parameters === undefined) {
					foundIssues.parameters = {};
				}
				if (foundIssues.parameters[nodeProperties.name] === undefined) {
					foundIssues.parameters[nodeProperties.name] = [];
				}
				foundIssues.parameters = { ...foundIssues.parameters, ...issues };
			}
		}
	} else if (nodeProperties.type === 'filter' && isDisplayed) {
		const value = getParameterValueByPath(nodeValues, nodeProperties.name, path);
		if (isFilterValue(value)) {
			const issues = validateFilterParameter(nodeProperties, value);
			if (Object.keys(issues).length > 0) {
				foundIssues.parameters = { ...foundIssues.parameters, ...issues };
			}
		}
	} else if (nodeProperties.validateType) {
		const value = getParameterValueByPath(nodeValues, nodeProperties.name, path);
		const error = validateParameter(nodeProperties, value, nodeProperties.validateType);
		if (error) {
			if (foundIssues.parameters === undefined) {
				foundIssues.parameters = {};
			}
			if (foundIssues.parameters[nodeProperties.name] === undefined) {
				foundIssues.parameters[nodeProperties.name] = [];
			}

			foundIssues.parameters[nodeProperties.name].push(error);
		}
	}

	// Check if there are any child parameters
	if (nodeProperties.options === undefined) {
		// There are none so nothing else to check
		return foundIssues;
	}

	// Check the child parameters

	// Important:
	// Checks the child properties only if the property is defined on current level.
	// That means that the required flag works only for the current level only. If
	// it is set on a lower level it means that the property is only required in case
	// the parent property got set.

	let basePath = path ? `${path}.` : '';

	const checkChildNodeProperties = [];

	// Collect all the properties to check
	if (nodeProperties.type === 'collection') {
		for (const option of nodeProperties.options) {
			checkChildNodeProperties.push({
				basePath,
				data: option,
			});
		}
	} else if (nodeProperties.type === 'fixedCollection' && isDisplayed) {
		basePath = basePath ? `${basePath}.` : `${nodeProperties.name}.`;

		let propertyOptions;
		for (propertyOptions of nodeProperties.options) {
			// Check if the option got set and if not skip it
			const value = getParameterValueByPath(
				nodeValues,
				propertyOptions.name,
				basePath.slice(0, -1),
			);

			// Validate allowed field counts
			const valueArray = Array.isArray(value) ? value : [];
			const { minRequiredFields, maxAllowedFields } = nodeProperties.typeOptions ?? {};
			let error = '';

			if (minRequiredFields && valueArray.length < minRequiredFields) {
				error = `At least ${minRequiredFields} ${minRequiredFields === 1 ? 'field is' : 'fields are'} required.`;
			}
			if (maxAllowedFields && valueArray.length > maxAllowedFields) {
				error = `At most ${maxAllowedFields} ${maxAllowedFields === 1 ? 'field is' : 'fields are'} allowed.`;
			}
			if (error) {
				foundIssues.parameters ??= {};
				foundIssues.parameters[nodeProperties.name] ??= [];
				foundIssues.parameters[nodeProperties.name].push(error);
			}

			if (value === undefined) {
				continue;
			}

			if (
				nodeProperties.typeOptions !== undefined &&
				nodeProperties.typeOptions.multipleValues !== undefined
			) {
				// Multiple can be set so will be an array of objects
				if (Array.isArray(value)) {
					for (let i = 0; i < value.length; i++) {
						for (const option of propertyOptions.values) {
							checkChildNodeProperties.push({
								basePath: `${basePath}${propertyOptions.name}[${i}]`,
								data: option,
							});
						}
					}
				}
			} else {
				// Only one can be set so will be an object
				for (const option of propertyOptions.values) {
					checkChildNodeProperties.push({
						basePath: basePath + propertyOptions.name,
						data: option,
					});
				}
			}
		}
	} else {
		// For all other types there is nothing to check so return
		return foundIssues;
	}

	let propertyIssues;

	for (const optionData of checkChildNodeProperties) {
		propertyIssues = getParameterIssues(
			optionData.data,
			nodeValues,
			optionData.basePath,
			node,
			nodeTypeDescription,
		);
		mergeIssues(foundIssues, propertyIssues);
	}

	return foundIssues;
}

/**
 * Merges multiple NodeIssues together (L1600-1635).
 *
 * Only the `execution`, `parameters`, `credentials` and `typeUnknown` keys are merged:
 * the reference copies issue *messages* by pushing the source arrays into the destination.
 */
export function mergeIssues(destination, source) {
	if (source === null) {
		// Nothing to merge
		return;
	}

	if (source.execution === true) {
		destination.execution = true;
	}

	const objectProperties = ['parameters', 'credentials'];

	let destinationProperty;
	for (const propertyName of objectProperties) {
		if (source[propertyName] !== undefined) {
			if (destination[propertyName] === undefined) {
				destination[propertyName] = {};
			}

			let parameterName;
			for (parameterName of Object.keys(source[propertyName])) {
				destinationProperty = destination[propertyName];
				if (destinationProperty[parameterName] === undefined) {
					destinationProperty[parameterName] = [];
				}
				destinationProperty[parameterName].push.apply(
					destinationProperty[parameterName],
					source[propertyName][parameterName],
				);
			}
		}
	}

	if (source.typeUnknown === true) {
		destination.typeUnknown = true;
	}
}
