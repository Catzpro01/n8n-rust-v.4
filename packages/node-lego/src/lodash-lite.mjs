/**
 * lodash-lite — the dependency-free replacements for the two lodash helpers the Node
 * Model reference imports (`lodash/get`, `lodash/isEqual`; `deepCopy` is the reference's
 * own `utils.ts` helper and is reconstructed verbatim in `deep-copy.mjs`).
 *
 * This is an explicit, documented delta (`README.md` §Deltas): the reference imports
 * lodash; a LEGO package must stay dependency-free (gate `N01`), so the subset the
 * Node Model actually exercises is reimplemented and pinned by tests.
 */

/**
 * `get(object, path, defaultValue)` for the path forms node parameters can use:
 * dotted segments, bracketed indexes (`a[0].b`), quoted segments (`a["b"]`),
 * leading `$` in data-proxy paths, and array indexes on arrays.
 */
export function get(object, path, defaultValue) {
	if (object == null) return defaultValue;
	const segments = toPath(path);
	let current = object;

	for (const segment of segments) {
		if (current == null) return defaultValue;
		if (typeof current !== 'object' && typeof current !== 'string') return defaultValue;
		if (!(segment in Object(current))) return defaultValue;
		current = current[segment];
	}

	return current === undefined ? defaultValue : current;
}

/** Splits `a.b[0].c` / `a["b"].c` into `['a','b','0','c']`. */
export function toPath(path) {
	if (Array.isArray(path)) return path.map(String);
	if (typeof path !== 'string') return [String(path)];

	const segments = [];

	for (const match of path.matchAll(/[^.[\]]+|\[(?:(\d+)|"([^"]*)"|'([^']*)')\]/g)) {
		const raw = match[0];
		if (raw.startsWith('[')) {
			segments.push(match[1] ?? match[2] ?? match[3] ?? '');
		} else {
			segments.push(raw);
		}
	}

	return segments;
}

/** `isEqual(a, b)` over JSON-shaped values (objects, arrays, primitives, Date). */
export function isEqual(a, b) {
	if (a === b) return true;
	if (a instanceof Date || b instanceof Date) {
		return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
	}
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;

	if (Array.isArray(a)) {
		if (a.length !== b.length) return false;
		return a.every((entry, index) => isEqual(entry, b[index]));
	}

	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) return false;

	return aKeys.every((key) => Object.hasOwn(b, key) && isEqual(a[key], b[key]));
}

/**
 * lodash `isObject` — the reference's `type-validation.ts` uses it for the `object` field
 * type check. Same verdicts: objects, arrays and functions are objects, `null` is not.
 */
export function isObject(value) {
	return value !== null && (typeof value === 'object' || typeof value === 'function');
}

/**
 * lodash `escapeRegExp` — escapes the regexp special characters in a string
 * (`^$.*+?()[]{}|`). Used by the node-reference parser to build its name alternation.
 */
export function escapeRegExp(string) {
	return string.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

/**
 * lodash `mapValues` — returns a new object with the same keys and every value passed through
 * `iteratee(value, key, object)`. Like lodash, the result is always a plain object (an array
 * input produces numeric string keys) and inherited properties are ignored.
 */
export function mapValues(object, iteratee) {
	const result = {};
	for (const key of Object.keys(object)) {
		result[key] = iteratee(object[key], key, object);
	}
	return result;
}

/**
 * lodash `cloneDeep` — the deep clone `node-reference-parser-utils.ts` imports. This is NOT the
 * same helper as `utils.deepCopy` (`./deep-copy.mjs`): upstream `deepCopy` is `toJSON`-first and
 * turns a `Date` into a string, while lodash's `cloneDeep` preserves `Date`, `RegExp`, `Map` and
 * `Set` instances and their prototypes. The parser needs lodash's semantics, so both exist here,
 * each used by the call sites the reference uses it at.
 */
export function cloneDeep(value, seen = new WeakMap()) {
	if (value === null || typeof value !== 'object') return value;
	if (seen.has(value)) return seen.get(value);

	let copy;
	if (value instanceof Date) {
		copy = new Date(value.getTime());
	} else if (value instanceof RegExp) {
		copy = new RegExp(value.source, value.flags);
	} else if (value instanceof Map) {
		copy = new Map();
		seen.set(value, copy);
		for (const [key, entryValue] of value) copy.set(cloneDeep(key, seen), cloneDeep(entryValue, seen));
		return copy;
	} else if (value instanceof Set) {
		copy = new Set();
		seen.set(value, copy);
		for (const entry of value) copy.add(cloneDeep(entry, seen));
		return copy;
	} else if (Array.isArray(value)) {
		copy = new Array(value.length);
	} else {
		// plain objects and class instances keep their prototype, like lodash
		copy = Object.create(Object.getPrototypeOf(value));
	}

	seen.set(value, copy);
	for (const key of Object.keys(value)) {
		copy[key] = cloneDeep(value[key], seen);
	}
	return copy;
}
