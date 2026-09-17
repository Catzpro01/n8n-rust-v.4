import { ApplicationError } from './errors.mjs';

function deepCopy(obj) {
	if (obj === null || typeof obj !== 'object') return obj;
	if (Array.isArray(obj)) return obj.map(deepCopy);
	const copy = {};
	for (const key of Object.keys(obj)) {
		copy[key] = deepCopy(obj[key]);
	}
	return copy;
}

/**
 * Automatically put the objects under a 'json' key and don't error,
 * if some objects contain json/binary keys and others don't, throws error 'Inconsistent item format'
 */
export function normalizeItems(executionData) {
	if (typeof executionData === 'object' && !Array.isArray(executionData) && executionData !== null) {
		executionData = executionData.json ? [executionData] : [{ json: executionData }];
	}

	if (!Array.isArray(executionData)) {
		return [];
	}

	if (executionData.every((item) => typeof item === 'object' && item !== null && 'json' in item)) {
		return executionData;
	}

	if (executionData.some((item) => typeof item === 'object' && item !== null && 'json' in item)) {
		throw new ApplicationError('Inconsistent item format');
	}

	if (executionData.every((item) => typeof item === 'object' && item !== null && 'binary' in item)) {
		const normalizedItems = [];
		executionData.forEach((item) => {
			const json = Object.keys(item).reduce((acc, key) => {
				if (key === 'binary') return acc;
				return { ...acc, [key]: item[key] };
			}, {});

			normalizedItems.push({
				json,
				binary: item.binary,
			});
		});
		return normalizedItems;
	}

	if (executionData.some((item) => typeof item === 'object' && item !== null && 'binary' in item)) {
		throw new ApplicationError('Inconsistent item format');
	}

	return executionData.map((item) => ({ json: item }));
}

/**
 * Takes generic input data and brings it into the json format n8n uses.
 */
export function returnJsonArray(jsonData) {
	const returnData = [];

	if (!Array.isArray(jsonData)) {
		jsonData = [jsonData];
	}

	jsonData.forEach((data) => {
		if (data && typeof data === 'object' && data.json) {
			returnData.push({ ...data, json: data.json });
		} else {
			returnData.push({ json: data });
		}
	});

	return returnData;
}

/**
 * Returns a copy of the items which only contains the json data and
 * of that only the defined properties
 */
export function copyInputItems(items, properties) {
	return items.map((item) => {
		const newItem = {};
		for (const property of properties) {
			if (item.json?.[property] === undefined) {
				newItem[property] = null;
			} else {
				newItem[property] = deepCopy(item.json[property]);
			}
		}
		return newItem;
	});
}

/**
 * Takes generic input data and brings it into the new json, pairedItem format n8n uses.
 */
export function constructExecutionMetaData(inputData, options) {
	const { itemData } = options;
	return inputData.map((data) => {
		const { json, ...rest } = data;
		return { json, pairedItem: itemData, ...rest };
	});
}
