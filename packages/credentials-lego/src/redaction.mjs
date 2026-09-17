import { deepCopy, isINodePropertyCollection } from './support.mjs';

/**
 * Values pinned by the golden recording (`tests/reference/agent-4/golden/
 * credentials.golden.json` → `constants`) and by
 * `packages/cli/src/constants.ts` / `packages/workflow/src/constants.ts`.
 */
export const CREDENTIAL_BLANKING_VALUE = '__n8n_BLANK_VALUE_e5362baf-c777-4d57-a609-6eaf1f9e87f6';
export const CREDENTIAL_EMPTY_VALUE = '__n8n_EMPTY_VALUE_7b1af746-3729-4c60-9b9b-e08eb29e58da';

/**
 * 1:1 ports of the redaction helpers in
 * `packages/cli/src/credentials/credentials.service.ts` (n8n 2.9.4).
 *
 * Scope note: `CredentialsService.redact(data, credential)` is **not** ported —
 * it resolves `ICredentialType` through `LoadNodesAndCredentials` (a SHARED,
 * registry-backed dependency) and swallows lookup failures. Only the pure half
 * that operates on an already-resolved property list is reconstructed:
 * `redactValues`, `redactCollectionOption`, `unredactRestoreValues`, `unredact`.
 *
 * R-01  `oauthTokenData` and `csrfSecret` are blanked **unconditionally**, even
 *       when the credential type declares no such property — and the value is
 *       stringified with `toString()` with no null guard, so `null` there throws.
 * R-02  A key with no matching property is left untouched (neither blanked nor
 *       removed) — redaction is property-driven, not data-driven.
 * R-03  For a `fixedCollection` the nested redaction runs **before** the
 *       password check, so a property can be both.
 * R-04  Password redaction is skipped for values that start with an expression
 *       (`={{`), unless the property sets `noDataExpression`. The guard calls
 *       `value.startsWith(...)` directly, so a non-string value throws.
 * R-05  `CREDENTIAL_EMPTY_VALUE` is used only when `toString().length === 0`
 *       (i.e. the empty string); everything else becomes the blanking value.
 * R-06  `props.find(...)` takes the **first** property with a matching name, so
 *       duplicate names shadow each other.
 * R-07  `redactValues` mutates and returns the same object; it does not copy.
 * R-08  `redactCollectionOption` handles array and single-object shapes, and
 *       explicitly skips `null` (which `typeof` would otherwise accept).
 * R-09  `unredactRestoreValues` recurses on any non-null object, arrays
 *       included, walking them with `Object.entries` (index keys).
 * R-10  A blanked key that is absent from `savedData` is restored as
 *       `undefined`, not left blanked and not removed.
 */

/** Port of `CredentialsService.redactValues`. */
export function redactValues(data, props) {
	for (const dataKey of Object.keys(data)) {
		// R-01
		if (dataKey === 'oauthTokenData' || dataKey === 'csrfSecret') {
			if (data[dataKey].toString().length > 0) {
				data[dataKey] = CREDENTIAL_BLANKING_VALUE;
			} else {
				data[dataKey] = CREDENTIAL_EMPTY_VALUE;
			}
			continue;
		}

		const prop = props.find((v) => v.name === dataKey); // R-06
		if (!prop) continue; // R-02

		// R-03
		if (prop.type === 'fixedCollection' && prop.options?.length) {
			const dataObject = data[dataKey];
			for (const option of prop.options) {
				if (isINodePropertyCollection(option)) {
					redactCollectionOption(dataObject, option);
				}
			}
		}

		// R-04 / R-05
		if (
			prop.typeOptions?.password &&
			(!data[dataKey].startsWith('={{') || prop.noDataExpression)
		) {
			if (data[dataKey].toString().length > 0) {
				data[dataKey] = CREDENTIAL_BLANKING_VALUE;
			} else {
				data[dataKey] = CREDENTIAL_EMPTY_VALUE;
			}
		}
	}

	return data; // R-07
}

/** Port of `CredentialsService.redactCollectionOption`. */
export function redactCollectionOption(data, option) {
	const collectionValuesKey = option.name;
	const values = data?.[collectionValuesKey];
	if (Array.isArray(values)) {
		for (let i = 0; i < values.length; i++) {
			values[i] = redactValues(values[i], option.values);
		}
	} else if (typeof values === 'object' && values !== null) {
		// R-08
		data[collectionValuesKey] = redactValues(values, option.values);
	}
}

/** Port of `CredentialsService.unredactRestoreValues`. */
export function unredactRestoreValues(unmerged, replacement) {
	for (const [key, value] of Object.entries(unmerged)) {
		if (value === CREDENTIAL_BLANKING_VALUE || value === CREDENTIAL_EMPTY_VALUE) {
			unmerged[key] = replacement[key]; // R-10
		} else if (
			typeof value === 'object' &&
			value !== null &&
			key in replacement &&
			typeof replacement[key] === 'object' &&
			replacement[key] !== null
		) {
			// R-09
			unredactRestoreValues(value, replacement[key]);
		}
	}
}

/**
 * Port of `CredentialsService.unredact`.
 * Returns a deep copy of `redactedData` with every sentinel replaced by the
 * stored plaintext — it never mutates the caller's redacted payload.
 */
export function unredact(redactedData, savedData) {
	const mergedData = deepCopy(redactedData);
	unredactRestoreValues(mergedData, savedData);
	return mergedData;
}
