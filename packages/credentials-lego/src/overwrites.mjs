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
 * Applies credentials overwrites to decrypted credential data.
 * Per n8n reference, only overwrites if there is currently no data set (null, undefined, or '').
 */
export function applyCredentialOverwrites(data, overwrites = {}) {
	if (!overwrites || Object.keys(overwrites).length === 0) {
		return data;
	}

	const returnData = deepCopy(data);
	for (const key of Object.keys(overwrites)) {
		if ([null, undefined, ''].includes(returnData[key])) {
			returnData[key] = overwrites[key];
		}
	}
	return returnData;
}
