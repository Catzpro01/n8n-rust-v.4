/**
 * Parameter resolution — `NodeHelpers.getNodeParameters` and the two private
 * helpers that decide the order in which parameters may be resolved.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/workflow/src/node-helpers.ts
 *     - getParameterDependencies  L542-575
 *     - getParameterResolveOrder  L577-656 (incl. the max-iterations guard)
 *     - GetNodeParametersOptions  L592-598
 *     - getNodeParameters         L658-1056
 *   Oracles: test/node-helpers.test.ts `describe('getNodeParameters')` (L34-…) with its
 *   `noneDisplayed × returnDefaults` output matrix, and
 *   `describe('getNodeParameters - noDataExpression handling')` (L6321-6524).
 *
 * Behaviour worth naming (all differentially pinned):
 *   * `returnDefaults` adds defaults; `returnNoneDisplayed` keeps parameters whose
 *     `displayOptions` do not match (the editor needs both),
 *   * a *display-check* pass runs first (onlySimpleTypes + dataIsResolved) unless the
 *     caller already resolved the data,
 *   * duplicate parameter names are re-checked individually against `displayOptions`,
 *   * `boolean`/`number`/`options` keep `false`/`0` instead of falling back to defaults,
 *   * `resourceLocator` defaults become `{ __rl: true, ...default }`,
 *   * unknown/empty fixedCollections can abort the whole resolution (`return deepCopy(nodeValues)`)
 *     or be re-materialised as empty objects — the two "GitHub case" quirks,
 *   * `noDataExpression` parameters get their leading `=` stripped.
 *
 * Errors: the resolve-order guard throws the reference's `ApplicationError`
 * (`name === 'Error'`, `level === 'error'` — see src/errors.mjs).
 */

import { ApplicationError } from './errors.mjs';
import { displayParameter } from './display.mjs';
import { deepCopy } from './deep-copy.mjs';
import { isExpression } from './expression-helpers.mjs';
import { isEqual } from './lodash-lite.mjs';

/**
 * Returns which parameters are dependent on which
 */
export function getParameterDependencies(nodePropertiesArray) {
	const dependencies = {};

	for (const nodeProperties of nodePropertiesArray) {
		const { name, displayOptions } = nodeProperties;

		if (!dependencies[name]) {
			dependencies[name] = [];
		}

		if (!displayOptions) {
			// Does not have any dependencies
			continue;
		}

		for (const displayRule of Object.values(displayOptions)) {
			for (const parameterName of Object.keys(displayRule)) {
				if (!dependencies[name].includes(parameterName)) {
					if (parameterName.charAt(0) === '@') {
						// Is a special parameter so can be skipped
						continue;
					}
					dependencies[name].push(parameterName);
				}
			}
		}
	}

	return dependencies;
}

/**
 * Returns in which order the parameters should be resolved
 * to have the parameters available they depend on
 */
export function getParameterResolveOrder(nodePropertiesArray, parameterDependencies) {
	const executionOrder = [];
	const indexToResolve = Array.from({ length: nodePropertiesArray.length }, (_, k) => k);
	const resolvedParameters = [];

	let index;
	let property;

	let lastIndexLength = indexToResolve.length;
	let lastIndexReduction = -1;

	let iterations = 0;

	while (indexToResolve.length !== 0) {
		iterations += 1;

		index = indexToResolve.shift();
		property = nodePropertiesArray[index];

		if (parameterDependencies[property.name].length === 0) {
			// Does not have any dependencies so simply add
			executionOrder.push(index);
			resolvedParameters.push(property.name);
			continue;
		}

		// Parameter has dependencies
		for (const dependency of parameterDependencies[property.name]) {
			if (!resolvedParameters.includes(dependency)) {
				if (dependency.charAt(0) === '/') {
					// Assume that root level dependencies are resolved
					continue;
				}
				// Dependencies for that parameter are still missing so
				// try to add again later
				indexToResolve.push(index);
				continue;
			}
		}

		// All dependencies got found so add
		executionOrder.push(index);
		resolvedParameters.push(property.name);

		if (indexToResolve.length < lastIndexLength) {
			lastIndexReduction = iterations;
		}

		if (iterations > lastIndexReduction + nodePropertiesArray.length) {
			throw new ApplicationError(
				'Could not resolve parameter dependencies. Max iterations reached! Hint: If `displayOptions` are specified in any child parameter of a parent `collection` or `fixedCollection`, remove the `displayOptions` from the child parameter.',
			);
		}
		lastIndexLength = indexToResolve.length;
	}

	return executionOrder;
}

/**
 * Returns the node parameter values. Depending on the settings it either just returns the none
 * default values or it applies all the default values.
 *
 * @param {INodeProperties[]} nodePropertiesArray The properties which exist and their settings
 * @param {INodeParameters} nodeValues The node parameter data
 * @param {boolean} returnDefaults If default values get added or only none default values returned
 * @param {boolean} returnNoneDisplayed If also values which should not be displayed should be returned
 * @param {object} options Optional properties
 */
export function getNodeParameters(
	nodePropertiesArray,
	nodeValues,
	returnDefaults,
	returnNoneDisplayed,
	node,
	nodeTypeDescription,
	options,
) {
	let { nodeValuesRoot, parameterDependencies } = options ?? {};
	const { onlySimpleTypes = false, dataIsResolved = false, parentType } = options ?? {};
	if (parameterDependencies === undefined) {
		parameterDependencies = getParameterDependencies(nodePropertiesArray);
	}

	// Get the parameter names which get used multiple times as for this
	// ones we have to always check which ones get displayed and which ones not
	const duplicateParameterNames = [];
	const parameterNames = [];
	for (const nodeProperties of nodePropertiesArray) {
		if (parameterNames.includes(nodeProperties.name)) {
			if (!duplicateParameterNames.includes(nodeProperties.name)) {
				duplicateParameterNames.push(nodeProperties.name);
			}
		} else {
			parameterNames.push(nodeProperties.name);
		}
	}

	const nodeParameters = {};
	const nodeParametersFull = {};

	let nodeValuesDisplayCheck = nodeParametersFull;
	if (!dataIsResolved && !returnNoneDisplayed) {
		nodeValuesDisplayCheck = getNodeParameters(
			nodePropertiesArray,
			nodeValues,
			true,
			true,
			node,
			nodeTypeDescription,
			{
				onlySimpleTypes: true,
				dataIsResolved: true,
				nodeValuesRoot,
				parentType,
				parameterDependencies,
			},
		);
	}

	nodeValuesRoot = nodeValuesRoot || nodeValuesDisplayCheck;

	// Go through the parameters in order of their dependencies
	const parameterIterationOrderIndex = getParameterResolveOrder(nodePropertiesArray, parameterDependencies);

	for (const parameterIndex of parameterIterationOrderIndex) {
		const nodeProperties = nodePropertiesArray[parameterIndex];
		if (
			!nodeValues ||
			(nodeValues[nodeProperties.name] === undefined &&
				(!returnDefaults || parentType === 'collection'))
		) {
			// The value is not defined so go to the next
			continue;
		}

		if (
			!returnNoneDisplayed &&
			!displayParameter(
				nodeValuesDisplayCheck,
				nodeProperties,
				node,
				nodeTypeDescription,
				nodeValuesRoot,
			)
		) {
			if (!returnNoneDisplayed || !returnDefaults) {
				continue;
			}
		}

		if (!['collection', 'fixedCollection'].includes(nodeProperties.type)) {
			// Is a simple property so can be set as it is

			if (duplicateParameterNames.includes(nodeProperties.name)) {
				if (
					!displayParameter(
						nodeValuesDisplayCheck,
						nodeProperties,
						node,
						nodeTypeDescription,
						nodeValuesRoot,
					)
				) {
					continue;
				}
			}

			if (returnDefaults) {
				// Set also when it has the default value
				if (['boolean', 'number', 'options'].includes(nodeProperties.type)) {
					// Boolean, numbers and options are special as false and 0 are valid values
					// and should not be replaced with default value
					nodeParameters[nodeProperties.name] =
						nodeValues[nodeProperties.name] !== undefined
							? deepCopy(nodeValues[nodeProperties.name])
							: nodeProperties.default;
				} else if (nodeProperties.type === 'resourceLocator' && typeof nodeProperties.default === 'object') {
					nodeParameters[nodeProperties.name] =
						nodeValues[nodeProperties.name] !== undefined
							? deepCopy(nodeValues[nodeProperties.name])
							: { __rl: true, ...nodeProperties.default };
				} else {
					nodeParameters[nodeProperties.name] =
						deepCopy(nodeValues[nodeProperties.name]) ?? nodeProperties.default;
				}
				nodeParametersFull[nodeProperties.name] = nodeParameters[nodeProperties.name];
			} else if (
				(nodeValues[nodeProperties.name] !== nodeProperties.default &&
					typeof nodeValues[nodeProperties.name] !== 'object') ||
				(typeof nodeValues[nodeProperties.name] === 'object' &&
					!isEqual(nodeValues[nodeProperties.name], nodeProperties.default)) ||
				(nodeValues[nodeProperties.name] !== undefined && parentType === 'collection')
			) {
				// Set only if it is different to the default value
				nodeParameters[nodeProperties.name] = deepCopy(nodeValues[nodeProperties.name]);
				nodeParametersFull[nodeProperties.name] = nodeParameters[nodeProperties.name];
				continue;
			}

			// Strip expression prefix if noDataExpression is true
			if (nodeProperties.noDataExpression && nodeParameters[nodeProperties.name] !== undefined) {
				const value = nodeParameters[nodeProperties.name];
				if (isExpression(value)) {
					nodeParameters[nodeProperties.name] = value.slice(1);
					nodeParametersFull[nodeProperties.name] = nodeParameters[nodeProperties.name];
				}
			}
		}

		if (onlySimpleTypes) {
			// It is only supposed to resolve the simple types. So continue.
			continue;
		}

		// Is a complex property so check lower levels
		let tempValue;
		if (nodeProperties.type === 'collection') {
			// Is collection

			if (nodeProperties.typeOptions !== undefined && nodeProperties.typeOptions.multipleValues === true) {
				// Multiple can be set so will be an array

				// Return directly the values like they are
				if (nodeValues[nodeProperties.name] !== undefined) {
					nodeParameters[nodeProperties.name] = deepCopy(nodeValues[nodeProperties.name]);
				} else if (returnDefaults) {
					// Does not have values defined but defaults should be returned
					if (Array.isArray(nodeProperties.default)) {
						nodeParameters[nodeProperties.name] = deepCopy(nodeProperties.default);
					} else {
						// As it is probably wrong for many nodes, do we keep on returning an empty array if
						// anything else than an array is set as default
						nodeParameters[nodeProperties.name] = [];
					}
				}
				nodeParametersFull[nodeProperties.name] = nodeParameters[nodeProperties.name];
			} else if (nodeValues[nodeProperties.name] !== undefined) {
				// Has values defined so get them
				const tempNodeParameters = getNodeParameters(
					nodeProperties.options,
					nodeValues[nodeProperties.name],
					returnDefaults,
					returnNoneDisplayed,
					node,
					nodeTypeDescription,
					{
						onlySimpleTypes: false,
						dataIsResolved: false,
						nodeValuesRoot,
						parentType: nodeProperties.type,
					},
				);

				if (tempNodeParameters !== null) {
					nodeParameters[nodeProperties.name] = tempNodeParameters;
					nodeParametersFull[nodeProperties.name] = nodeParameters[nodeProperties.name];
				}
			} else if (returnDefaults) {
				// Does not have values defined but defaults should be returned
				nodeParameters[nodeProperties.name] = deepCopy(nodeProperties.default);
				nodeParametersFull[nodeProperties.name] = nodeParameters[nodeProperties.name];
			}
		} else if (nodeProperties.type === 'fixedCollection') {
			// Is fixedCollection

			const collectionValues = {};
			let tempNodeParameters;
			let tempNodePropertiesArray;
			let nodePropertyOptions;

			let propertyValues = deepCopy(nodeValues[nodeProperties.name]);
			if (returnDefaults) {
				if (propertyValues === undefined) {
					propertyValues = deepCopy(nodeProperties.default);
				}
			}

			if (
				!returnDefaults &&
				nodeProperties.typeOptions?.multipleValues === false &&
				propertyValues &&
				Object.keys(propertyValues).length === 0
			) {
				// For fixedCollections, which only allow one value, it is important to still return
				// the empty object which indicates that a value got added, even if it does not have
				// anything set. If that is not done, the value would get lost.
				return deepCopy(nodeValues);
			}

			// Track if any visible fields were processed across all collection items
			let hadAnyVisibleFields = false;

			// Iterate over all collections
			for (const itemName of Object.keys(propertyValues || {})) {
				if (
					nodeProperties.typeOptions !== undefined &&
					nodeProperties.typeOptions.multipleValues === true
				) {
					// Multiple can be set so will be an array

					const tempArrayValue = [];
					// Collection values should always be an object
					if (typeof propertyValues !== 'object' || Array.isArray(propertyValues)) {
						continue;
					}
					// Iterate over all items as it contains multiple ones
					for (const nodeValue of propertyValues[itemName]) {
						nodePropertyOptions = nodeProperties.options.find(
							(nodePropertyOptions) => nodePropertyOptions.name === itemName,
						);

						if (nodePropertyOptions === undefined) {
							throw new ApplicationError('Could not find property option', {
								extra: { propertyOption: itemName, property: nodeProperties.name },
							});
						}

						tempNodePropertiesArray = nodePropertyOptions.values;
						tempValue = getNodeParameters(
							tempNodePropertiesArray,
							nodeValue,
							returnDefaults,
							returnNoneDisplayed,
							node,
							nodeTypeDescription,
							{
								onlySimpleTypes: false,
								dataIsResolved: false,
								nodeValuesRoot,
								parentType: nodeProperties.type,
							},
						);
						if (tempValue !== null) {
							tempArrayValue.push(tempValue);
						}
					}
					collectionValues[itemName] = tempArrayValue;
				} else {
					// Only one can be set so is an object of objects
					tempNodeParameters = {};
					let hadVisibleFields = false;

					// Get the options of the current item

					const nodePropertyOptions = nodeProperties.options.find((data) => data.name === itemName);

					if (nodePropertyOptions !== undefined) {
						tempNodePropertiesArray = nodePropertyOptions.values;
						const itemNodeValues = nodeValues[nodeProperties.name][itemName];
						tempValue = getNodeParameters(
							tempNodePropertiesArray,
							itemNodeValues,
							returnDefaults,
							returnNoneDisplayed,
							node,
							nodeTypeDescription,
							{
								onlySimpleTypes: false,
								dataIsResolved: false,
								nodeValuesRoot,
								parentType: nodeProperties.type,
							},
						);
						if (tempValue !== null) {
							Object.assign(tempNodeParameters, tempValue);
							if (Object.keys(tempValue).length > 0) {
								// tempValue has content, so fields are visible
								hadVisibleFields = true;
								hadAnyVisibleFields = true;
							} else {
								// tempValue is empty. Check if user provided non-default values that got filtered
								const hasNonDefaultValues =
									itemNodeValues &&
									Object.keys(itemNodeValues).some((key) => {
										const field = tempNodePropertiesArray.find((f) => f.name === key);
										return field && !isEqual(itemNodeValues[key], field.default);
									});

								if (!hasNonDefaultValues) {
									// All values are defaults, so the collection is explicitly added with default values
									// We should preserve this (GitHub case)
									hadVisibleFields = true;
									hadAnyVisibleFields = true;
								}
								// If hasNonDefaultValues is true, values were filtered by displayOptions (test case)
								// So we don't set hadVisibleFields
							}
						}
					}

					if (Object.keys(tempNodeParameters).length !== 0) {
						collectionValues[itemName] = tempNodeParameters;
					} else if (
						!returnDefaults &&
						hadVisibleFields &&
						propertyValues &&
						propertyValues[itemName] !== undefined
					) {
						// Preserve explicitly set empty collections when the user added an option
						// that contains only default values. Only preserve if there were visible fields
						// (hadVisibleFields), otherwise the collection is empty because all fields
						// are hidden by displayOptions.
						collectionValues[itemName] = tempNodeParameters;
					}
				}
			}

			if (
				!returnDefaults &&
				hadAnyVisibleFields &&
				nodeProperties.typeOptions?.multipleValues === false &&
				collectionValues &&
				Object.keys(collectionValues).length === 0 &&
				propertyValues &&
				propertyValues?.constructor.name === 'Object' &&
				Object.keys(propertyValues).length !== 0
			) {
				// For fixedCollections, which only allow one value, it is important to still return
				// the object with an empty collection property which indicates that a value got added
				// which contains all default values. Only preserve if there were visible fields,
				// otherwise the collection is empty because all fields are hidden by displayOptions.
				const returnValue = {};
				Object.keys(propertyValues || {}).forEach((value) => {
					returnValue[value] = {};
				});
				nodeParameters[nodeProperties.name] = returnValue;
			}

			if (Object.keys(collectionValues).length !== 0 || returnDefaults) {
				// Set only if value got found
				if (returnDefaults) {
					// Set also when it has the default value
					if (collectionValues === undefined) {
						nodeParameters[nodeProperties.name] = deepCopy(nodeProperties.default);
					} else {
						nodeParameters[nodeProperties.name] = collectionValues;
					}
					nodeParametersFull[nodeProperties.name] = nodeParameters[nodeProperties.name];
				} else if (collectionValues !== nodeProperties.default) {
					// Set only if values got found and it is not the default
					nodeParameters[nodeProperties.name] = collectionValues;
					nodeParametersFull[nodeProperties.name] = nodeParameters[nodeProperties.name];
				}
			}
		}
	}
	return nodeParameters;
}
