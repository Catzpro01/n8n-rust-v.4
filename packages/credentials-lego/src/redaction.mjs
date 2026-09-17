import { CREDENTIAL_BLANKING_VALUE, CREDENTIAL_EMPTY_VALUE } from './constants.mjs';

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
 * Redacts sensitive fields in credential data using credential type property definitions.
 * Replaces password-type fields, oauthTokenData, and csrfSecret with CREDENTIAL_BLANKING_VALUE.
 */
export function redactCredentials(data, typeProperties = []) {
	const copied = deepCopy(data);
	return redactValues(copied, typeProperties);
}

function redactValues(data, properties = []) {
	if (!data || typeof data !== 'object') return data;

	for (const dataKey of Object.keys(data)) {
		// The frontend only cares that this value isn't falsy.
		if (dataKey === 'oauthTokenData' || dataKey === 'csrfSecret') {
			if (data[dataKey] && data[dataKey].toString().length > 0) {
				data[dataKey] = CREDENTIAL_BLANKING_VALUE;
			}
			continue;
		}

		const prop = properties.find((p) => p.name === dataKey);
		if (!prop) continue;

		if (prop.type === 'fixedCollection' && prop.options?.length) {
			const dataObject = data[dataKey];
			if (dataObject && typeof dataObject === 'object') {
				for (const option of prop.options) {
					const collectionValuesKey = option.name;
					const values = dataObject[collectionValuesKey];
					if (Array.isArray(values)) {
						for (let i = 0; i < values.length; i++) {
							values[i] = redactValues(values[i], option.values ?? []);
						}
					} else if (typeof values === 'object' && values !== null) {
						dataObject[collectionValuesKey] = redactValues(values, option.values ?? []);
					}
				}
			}
			continue;
		}

		if (
			prop.type === 'string' &&
			prop.typeOptions?.password === true &&
			data[dataKey] !== undefined &&
			data[dataKey] !== null &&
			data[dataKey] !== ''
		) {
			data[dataKey] = CREDENTIAL_BLANKING_VALUE;
		}
	}

	return data;
}

/**
 * Restores blanked fields from stored plaintext.
 */
export function unredactCredentials(redactedData, savedData) {
	const merged = deepCopy(redactedData);
	restoreValues(merged, savedData);
	return merged;
}

function restoreValues(unmerged, replacement) {
	if (!unmerged || !replacement || typeof unmerged !== 'object' || typeof replacement !== 'object') {
		return;
	}

	for (const [key, value] of Object.entries(unmerged)) {
		if (value === CREDENTIAL_BLANKING_VALUE || value === CREDENTIAL_EMPTY_VALUE) {
			unmerged[key] = replacement[key];
		} else if (
			value &&
			typeof value === 'object' &&
			replacement[key] &&
			typeof replacement[key] === 'object'
		) {
			restoreValues(value, replacement[key]);
		}
	}
}
