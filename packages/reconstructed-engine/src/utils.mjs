/**
 * Utils — reconstructed 1:1 from the pinned reference (n8n 2.9.4).
 *
 * Provenance:
 *   packages/workflow/src/utils.ts:53-92          deepCopy
 *   packages/workflow/src/utils.ts:152-178        jsonParse (acceptJSObject/repairJSON deferred)
 *   packages/workflow/src/type-guards.ts:15-19    isResourceLocatorValue
 *   lodash.get (behaviour, not implementation)    get  — pinned by test/01-utils.test.mjs
 *
 * `get` is the one symbol here that is NOT a transcription: the reference uses
 * `lodash/get`. It is reconstructed to the documented lodash behaviour and the
 * equivalence test fuzzes it against the real `lodash/get` from the reference
 * runtime over the corpus in `fixtures/get-paths.json`.
 */

/** packages/workflow/src/utils.ts:53 */
export const deepCopy = (source, hash = new WeakMap(), path = '') => {
	const hasOwnProp = Object.prototype.hasOwnProperty.bind(source);

	// Primitives & Null & Function
	if (typeof source !== 'object' || source === null || typeof source === 'function') {
		return source;
	}

	// Date and other objects with toJSON method
	if (typeof source.toJSON === 'function') {
		return source.toJSON();
	}

	if (hash.has(source)) {
		return hash.get(source);
	}

	if (Array.isArray(source)) {
		const clone = [];
		const len = source.length;
		for (let i = 0; i < len; i++) {
			clone[i] = deepCopy(source[i], hash, `${path}[${i}]`);
		}
		return clone;
	}

	const clone = Object.create(Object.getPrototypeOf({}));
	hash.set(source, clone);
	for (const i in source) {
		if (hasOwnProp(i)) {
			clone[i] = deepCopy(source[i], hash, `${path}.${i}`);
		}
	}
	return clone;
};

/** packages/workflow/src/utils.ts:152 (acceptJSObject / repairJSON are NOT PORTED) */
export const jsonParse = (jsonString, options) => {
	try {
		return JSON.parse(jsonString);
	} catch (error) {
		if (options?.acceptJSObject || options?.repairJSON) {
			throw new Error(
				'jsonParse: options.acceptJSObject / options.repairJSON are not ported (see manifest/port-surface.json)',
				{ cause: error },
			);
		}
		if (options?.fallbackValue !== undefined) {
			if (options.fallbackValue instanceof Function) {
				return options.fallbackValue();
			}
			return options.fallbackValue;
		} else if (options?.errorMessage) {
			throw new ApplicationErrorRef(options.errorMessage);
		}
		throw error;
	}
};

// Late-bound to avoid an import cycle (errors.mjs imports jsonParse from here).
let ApplicationErrorRef = class extends Error {};
export const bindApplicationError = (Ctor) => {
	ApplicationErrorRef = Ctor;
};

/** packages/workflow/src/type-guards.ts:15 */
export function isResourceLocatorValue(value) {
	return Boolean(
		typeof value === 'object' && value && 'mode' in value && 'value' in value && '__rl' in value,
	);
}

const KEY_PATH = /[^.[\]]+/g;

/**
 * lodash-compatible `get(object, path, defaultValue)`.
 *
 * Supports the path forms n8n actually uses for node parameters:
 * `a.b.c`, `a[0].b`, `a["b.c"]`, `a['b'].c`. Divergence from lodash on exotic
 * paths is impossible to hide: fixtures/get-paths.json is executed against the
 * real `lodash/get` in test/01-utils.test.mjs.
 */
export function get(object, path, defaultValue) {
	if (object === null || object === undefined) {
		return defaultValue === undefined ? undefined : defaultValue;
	}

	let keys;
	if (typeof path === 'string') {
		keys = path.match(KEY_PATH) ?? [];
	} else if (Array.isArray(path)) {
		keys = path;
	} else {
		keys = [path];
	}

	let value = object;
	for (const key of keys) {
		if (value === null || value === undefined) return defaultValue;
		value = value[key];
	}

	return value === undefined ? defaultValue : value;
}
