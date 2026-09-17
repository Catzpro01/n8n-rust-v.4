/**
 * lodash-lite — the dependency-free replacements for the three lodash helpers the
 * Node Model reference uses (`lodash/get`, `lodash/isEqual`, `lodash/cloneDeep`).
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

/** `cloneDeep(value)` for JSON-shaped values; Dates and arrays keep their type. */
export function cloneDeep(value) {
	if (value === null || typeof value !== 'object') return value;
	if (value instanceof Date) return new Date(value.getTime());
	if (Array.isArray(value)) return value.map((entry) => cloneDeep(entry));

	const result = {};
	for (const [key, entry] of Object.entries(value)) result[key] = cloneDeep(entry);
	return result;
}
