/**
 * Execution Data LEGO — item helpers.
 *
 * 1:1 ports of the four pure helpers n8n 2.9.4 exposes to node code:
 *   packages/core/src/execution-engine/node-execution-context/utils/return-json-array.ts
 *   packages/core/src/execution-engine/node-execution-context/utils/normalize-items.ts
 *   packages/core/src/execution-engine/node-execution-context/utils/construct-execution-metadata.ts
 *   packages/core/src/execution-engine/node-execution-context/utils/copy-input-items.ts
 *
 * All four are pure: no I/O, no engine, no workflow object.
 */

import { ApplicationError } from './errors.mjs';
import { deepCopy } from './deep-copy.mjs';

/**
 * `return-json-array.ts` — verbatim.
 *
 * FROZEN QUIRK (H-01): the double-wrap guard is a TRUTHINESS test
 * (`if (data?.json)`), not an `in` test. `returnJsonArray([{ json: null }])`
 * therefore produces `{ json: { json: null } }`, and
 * `returnJsonArray([{ json: '' }])` produces `{ json: { json: '' } }`.
 * FROZEN QUIRK (H-02): keys other than `json` are preserved by the spread
 * (`{ ...data, json: data.json }`), so a `binary` key survives untouched.
 */
export function returnJsonArray(jsonData) {
	const returnData = [];

	if (!Array.isArray(jsonData)) {
		jsonData = [jsonData];
	}

	jsonData.forEach((data) => {
		if (data?.json) {
			// We already have the JSON key so avoid double wrapping
			returnData.push({ ...data, json: data.json });
		} else {
			returnData.push({ json: data });
		}
	});

	return returnData;
}

/**
 * `normalize-items.ts` — verbatim.
 *
 * FROZEN QUIRK (H-03): a bare (non-array) object is unwrapped by the same
 * truthiness test: `normalizeItems({ json: null })` -> `[{ json: { json: null } }]`.
 * FROZEN QUIRK (H-04): MIXED shapes throw `ApplicationError('Inconsistent item
 * format')` — this is the only error any of the four helpers can raise.
 * FROZEN QUIRK (H-05): an all-`binary` input is reshaped so that every key
 * except `binary` moves under `json`; a MIX of binary/non-binary throws.
 * FROZEN QUIRK (H-06): non-object members (strings, numbers) skip every
 * `'json' in item` probe (guarded by `typeof item === 'object'`) and end up
 * wrapped by the final `map` — `normalizeItems(['a', 1])` -> `[{ json: 'a' },
 * { json: 1 }]`. `null` DOES NOT survive: `typeof null === 'object'` passes the
 * guard, so `'json' in null` raises
 * `TypeError: Cannot use 'in' operator to search for 'json' in null`.
 * Verified against n8n-core@2.9.1 — this is upstream behaviour, not a bug in
 * the port, and it is pinned by test/02 and test/06.
 */
export function normalizeItems(executionData) {
	if (typeof executionData === 'object' && !Array.isArray(executionData)) {
		executionData = executionData.json ? [executionData] : [{ json: executionData }];
	}

	if (executionData.every((item) => typeof item === 'object' && 'json' in item)) return executionData;

	if (executionData.some((item) => typeof item === 'object' && 'json' in item)) {
		throw new ApplicationError('Inconsistent item format');
	}

	if (executionData.every((item) => typeof item === 'object' && 'binary' in item)) {
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

	if (executionData.some((item) => typeof item === 'object' && 'binary' in item)) {
		throw new ApplicationError('Inconsistent item format');
	}

	return executionData.map((item) => {
		return { json: item };
	});
}

/**
 * `construct-execution-metadata.ts` — verbatim.
 *
 * FROZEN QUIRK (H-07): **the `itemData` argument LOSES to an existing
 * `pairedItem`.** Only `json` is destructured out of the item, so `rest` still
 * contains the item's own `pairedItem`, and because `...rest` is spread LAST it
 * overwrites the `pairedItem: itemData` written on the line before it.
 *   constructExecutionMetaData([{ json: {}, pairedItem: { item: 9 } }],
 *                             { itemData: { item: 3 } })
 *     -> [{ json: {}, pairedItem: { item: 9 } }]     (NOT { item: 3 })
 * Verified against n8n-core@2.9.1. Callers that intend to stamp metadata must
 * strip `pairedItem` first — the helper does not do it for them.
 */
export function constructExecutionMetaData(inputData, options) {
	const { itemData } = options;
	return inputData.map((data) => {
		const { json, ...rest } = data;
		return { json, pairedItem: itemData, ...rest };
	});
}

/**
 * `copy-input-items.ts` — verbatim.
 *
 * FROZEN QUIRK (H-08): a missing property becomes `null`, not `undefined`.
 * FROZEN QUIRK (H-09): values are `deepCopy`-ed, so a `Date` in `json` comes
 * back as its `toJSON()` string (see DC-1 in deep-copy.mjs).
 */
export function copyInputItems(items, properties) {
	return items.map((item) => {
		const newItem = {};
		for (const property of properties) {
			if (item.json[property] === undefined) {
				newItem[property] = null;
			} else {
				newItem[property] = deepCopy(item.json[property]);
			}
		}
		return newItem;
	});
}
