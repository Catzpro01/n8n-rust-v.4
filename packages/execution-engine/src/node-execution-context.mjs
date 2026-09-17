/**
 * ExecuteContext — the object a node's `execute()` receives as `this`/argument.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/core/src/execution-engine/node-execution-context/execute-context.ts
 *   .../base-execute-context.ts (getInputItems / getInputData)
 *   .../utils/{return-json-array,normalize-items,construct-execution-metadata,copy-input-items}.ts
 */

import { createRunExecutionData } from './run-execution-data.mjs';
import { ApplicationError } from './errors.mjs';
import { WorkflowDataProxy } from './data-proxy.mjs';
import { evaluateExpressionValue, isExpression, resolveParameterValue } from './expression.mjs';

/** `get` from lodash for dotted/bracketed parameter paths (`a.b[0].c`). */
export function getParameterValue(source, path) {
	if (source === undefined || source === null) return undefined;
	if (typeof path !== 'string') return undefined;

	const segments = path
		.replace(/\[(\d+)\]/g, '.$1')
		.replace(/\["([^"]+)"\]/g, '.$1')
		.replace(/\['([^']+)'\]/g, '.$1')
		.split('.')
		.filter((segment) => segment.length > 0);

	let current = source;
	for (const segment of segments) {
		if (current === undefined || current === null) return undefined;
		current = current[segment];
	}
	return current;
}

/** `returnJsonArray` — verbatim (packages/core/.../utils/return-json-array.ts). */
export function returnJsonArray(jsonData) {
	const returnData = [];
	const input = Array.isArray(jsonData) ? jsonData : [jsonData];

	for (const data of input) {
		if (data?.json) {
			// Already in the json key format, avoid double wrapping
			returnData.push({ ...data, json: data.json });
		} else {
			returnData.push({ json: data });
		}
	}

	return returnData;
}

/** `normalizeItems` — verbatim, including the 'Inconsistent item format' errors. */
export function normalizeItems(executionData) {
	if (typeof executionData === 'object' && !Array.isArray(executionData)) {
		executionData = executionData.json ? [executionData] : [{ json: executionData }];
	}

	if (executionData.every((item) => typeof item === 'object' && 'json' in item)) return executionData;

	if (executionData.some((item) => typeof item === 'object' && 'json' in item)) {
		throw new ApplicationError('Inconsistent item format');
	}

	if (executionData.every((item) => typeof item === 'object' && 'binary' in item)) {
		return executionData.map((item) => {
			const json = Object.keys(item).reduce((acc, key) => {
				if (key === 'binary') return acc;
				return { ...acc, [key]: item[key] };
			}, {});
			return { json, binary: item.binary };
		});
	}

	if (executionData.some((item) => typeof item === 'object' && 'binary' in item)) {
		throw new ApplicationError('Inconsistent item format');
	}

	return executionData.map((item) => ({ json: item }));
}

/** `constructExecutionMetaData` — verbatim. */
export function constructExecutionMetaData(inputData, options) {
	const { itemData } = options;
	return inputData.map((data) => {
		const { json, ...rest } = data;
		return { json, pairedItem: itemData, ...rest };
	});
}

/** `copyInputItems` — verbatim (deep copy via structuredClone). */
export function copyInputItems(items, properties) {
	return items.map((item) => {
		const newItem = {};
		for (const property of properties) {
			newItem[property] =
				item.json[property] === undefined ? null : structuredClone(item.json[property]);
		}
		return newItem;
	});
}

export const NO_OP_LOGGER = {
	debug() {},
	info() {},
	warn() {},
	error() {},
};

export class ExecuteContext {
	constructor({
		workflow,
		node,
		runExecutionData,
		runIndex = 0,
		inputData = {},
		connectionInputData = [],
		executionData,
		mode = 'manual',
		additionalData = {},
		closeFunctions = [],
		logger = NO_OP_LOGGER,
	} = {}) {
		this.workflow = workflow;
		this.node = node;
		this.runExecutionData = runExecutionData ?? createRunExecutionData();
		this.runIndex = runIndex;
		this.inputData = inputData;
		this.connectionInputData = connectionInputData;
		this.executionData = executionData;
		this.mode = mode;
		this.additionalData = additionalData;
		this.closeFunctions = closeFunctions;
		this.logger = logger;
		this.hints = [];

		this.helpers = {
			returnJsonArray,
			normalizeItems,
			constructExecutionMetaData,
			copyInputItems,
		};
	}

	/**
	 * `getInputData(inputIndex, connectionType)`:
	 * base-execute-context returns the item array of that input; execute-context
	 * returns `[]` when the connection type is not wired at all.
	 */
	getInputData(inputIndex = 0, connectionType = 'main') {
		if (!Object.hasOwn(this.inputData, connectionType)) return [];

		const inputData = this.inputData[connectionType];
		if (inputData.length < inputIndex) {
			throw new ApplicationError('Could not get input with given index', {
				extra: { inputIndex, connectionType },
			});
		}

		const allItems = inputData[inputIndex] ?? [];
		if (allItems === null) {
			throw new ApplicationError('Input index was not set', { extra: { inputIndex, connectionType } });
		}

		return allItems;
	}

	/** `getInputSourceData` — `{ previousNode, previousNodeOutput, previousNodeRun }`. */
	getInputSourceData(inputIndex = 0, connectionType = 'main') {
		return this.executionData?.source?.[connectionType]?.[inputIndex] ?? {};
	}

	getNode() {
		return this.node;
	}

	getWorkflow() {
		return this.workflow;
	}

	getMode() {
		return this.mode;
	}

	getExecutionId() {
		return this.additionalData.executionId ?? null;
	}

	getRunIndex() {
		return this.runIndex;
	}

	getNodeParameter(parameterName, itemIndex = 0, fallbackValue) {
		const parameterValue = getParameterValue(this.node.parameters ?? {}, parameterName);

		if (parameterValue === undefined) {
			if (fallbackValue !== undefined) return fallbackValue;
			throw new ApplicationError(`Could not get parameter "${parameterName}"`, {
				extra: { nodeName: this.node.name, parameterName },
			});
		}

		if (isExpression(parameterValue) || containsExpression(parameterValue)) {
			return resolveParameterValue(parameterValue, this.getWorkflowDataProxy(itemIndex).proxy, { itemIndex });
		}

		return evaluateExpressionValue(parameterValue, this.getWorkflowDataProxy(itemIndex).proxy, { itemIndex });
	}

	getWorkflowStaticData(_type) {
		return (this.workflow.staticData ??= {});
	}

	getWorkflowDataProxy(itemIndex = 0) {
		return new WorkflowDataProxy({
			workflow: this.workflow,
			runExecutionData: this.runExecutionData,
			runIndex: this.runIndex,
			itemIndex,
			activeNodeName: this.node.name,
			connectionInputData: this.connectionInputData,
			inputData: this.inputData,
			executionData: this.executionData,
			mode: this.mode,
			additionalData: this.additionalData,
		});
	}

	evaluateExpression(expression, itemIndex = 0) {
		const value = isExpression(expression) ? expression : `=${expression}`;
		return evaluateExpressionValue(value, this.getWorkflowDataProxy(itemIndex).proxy, { itemIndex });
	}

	/** `getCredentials` lives in the Credentials LEGO (contracts/credentials.contract.md). */
	getCredentials() {
		throw new ApplicationError(
			'getCredentials() is not part of the reconstructed execution engine — it belongs to the credentials LEGO',
			{ level: 'warning', extra: { nodeName: this.node?.name } },
		);
	}
}

/** True when any string inside the value is an `=`-prefixed expression. */
export function containsExpression(value) {
	if (isExpression(value)) return true;
	if (Array.isArray(value)) return value.some((entry) => containsExpression(entry));
	if (value !== null && typeof value === 'object' && value.constructor === Object) {
		return Object.values(value).some((entry) => containsExpression(entry));
	}
	return false;
}
