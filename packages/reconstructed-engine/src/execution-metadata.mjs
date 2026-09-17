/**
 * Execution metadata ($execution.customData) — reconstructed 1:1 from the
 * pinned reference (n8n 2.9.4).
 *
 * Provenance:
 *   packages/core/src/execution-engine/node-execution-context/utils/execution-metadata.ts:7-75
 *   packages/core/src/execution-engine/node-execution-context/utils/construct-execution-metadata.ts:8-17
 *   packages/core/src/errors/invalid-execution-metadata.error.ts:3-16
 *
 * Two reference quirks are preserved verbatim because n8n's observable behaviour
 * depends on them:
 *   1. `setWorkflowExecutionMetadata` silently RETURNS when the key is new and
 *      10 keys already exist (KV_LIMIT) — it does not throw. A caller in manual
 *      mode only sees an error for the *other* failure paths.
 *   2. the length guard and the truncation disagree: `val.length > 255` logs the
 *      warning, `val.slice(0, 512)` does the cutting (execution-metadata.ts:43-46).
 *      Values of 256–512 characters therefore pass through unlogged but uncut.
 *      Any "cleaner" port would silently change what a workflow can store.
 */

import { ApplicationError } from './errors.mjs';

/** execution-metadata.ts:7 */
export const KV_LIMIT = 10;

/** packages/core/src/errors/invalid-execution-metadata.error.ts:3 */
export class InvalidExecutionMetadataError extends ApplicationError {
	constructor(type, key, message, options) {
		super(message ?? `Custom data ${type}s must be a string (key "${key}")`, options);
		this.type = type;
	}
}

/**
 * The reference writes the two truncation warnings through `LoggerProxy`.
 * Nothing branches on them, so the default sink only captures the last message
 * (that is what test/04-execution-metadata.test.mjs asserts); a host may
 * install a real logger with `setLogger`.
 */
let logger = {
	lastError: null,
	error(message) {
		this.lastError = message;
	},
};

export function setLogger(next) {
	logger = next ?? { lastError: null, error() {} };
}

export function getCapturedLog() {
	return logger.lastError;
}


/** execution-metadata.ts:9 */
export function setWorkflowExecutionMetadata(executionData, key, value) {
	if (!executionData.resultData.metadata) {
		executionData.resultData.metadata = {};
	}
	// Currently limited to 10 metadata KVs
	if (
		!(key in executionData.resultData.metadata) &&
		Object.keys(executionData.resultData.metadata).length >= KV_LIMIT
	) {
		return;
	}
	if (typeof key !== 'string') {
		throw new InvalidExecutionMetadataError('key', key);
	}
	if (key.replace(/[A-Za-z0-9_]/g, '').length !== 0) {
		throw new InvalidExecutionMetadataError(
			'key',
			key,
			`Custom date key can only contain characters "A-Za-z0-9_" (key "${key}")`,
		);
	}
	if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
		throw new InvalidExecutionMetadataError('value', key);
	}
	const val = String(value);
	if (key.length > 50) {
		logger.error(
			'Custom data key over 50 characters long. Truncating to 50 characters.',
		);
	}
	if (val.length > 255) {
		logger.error(
			'Custom data value over 512 characters long. Truncating to 512 characters.',
		);
	}
	executionData.resultData.metadata[key.slice(0, 50)] = val.slice(0, 512);
}

/** execution-metadata.ts:52 */
export function setAllWorkflowExecutionMetadata(executionData, obj) {
	const errors = [];
	for (const [key, value] of Object.entries(obj)) {
		try {
			setWorkflowExecutionMetadata(executionData, key, value);
		} catch (e) {
			errors.push(e);
		}
	}
	if (errors.length) {
		throw errors[0];
	}
}

/** execution-metadata.ts:66 — returns a COPY so the run data cannot be modified directly. */
export function getAllWorkflowExecutionMetadata(executionData) {
	return executionData.resultData.metadata ? { ...executionData.resultData.metadata } : {};
}

/** execution-metadata.ts:73 */
export function getWorkflowExecutionMetadata(executionData, key) {
	return getAllWorkflowExecutionMetadata(executionData)[String(key).slice(0, 50)];
}

/**
 * packages/core/.../utils/construct-execution-metadata.ts:8-17 — wraps generic
 * node output in the `{ json, pairedItem, ...rest }` shape n8n passes around.
 *
 * The spread order is the reference's, and it is load-bearing: `...rest` comes
 * LAST, so an input item that already carries `pairedItem` keeps its own value and
 * the `itemData` argument only acts as the default. Reordering this would rewrite
 * paired-item links for every node that sets them itself. The paired-item
 * resolution algorithm is NOT ported (see manifest deferred[]); this function only
 * moves the data, which is why it is safe to port.
 */
export function constructExecutionMetaData(inputData, options) {
	const { itemData } = options;
	return inputData.map((data) => {
		const { json, ...rest } = data;
		return { json, pairedItem: itemData, ...rest };
	});
}
