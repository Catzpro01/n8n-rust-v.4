/**
 * Small pure helpers the credential core leans on.
 *
 * Each one is a 1:1 port of an n8n helper that lives in a SHARED package
 * (`n8n-workflow` / `@n8n/backend-common`). This LEGO keeps **zero runtime
 * dependencies**, so they are reproduced here verbatim in behaviour instead of
 * being imported.
 */

/**
 * Minimal stand-in for `n8n-workflow`'s `ApplicationError`.
 * The full class carries severity, tags, packages and reporting hooks; only the
 * fields the credential core actually sets are reproduced: `message`, `extra`
 * and `cause`.
 */
export class ApplicationError extends Error {
	constructor(message, options = {}) {
		super(message, { cause: options.cause });
		this.name = new.target.name;
		this.extra = options.extra;
		// `Error.cause` is already set by super(); keep `level` because
		// ApplicationError defaults it and consumers branch on it.
		this.level = options.level ?? 'error';
	}
}

/**
 * Port of `@n8n/backend-common`'s `isObjectLiteral`.
 *
 * Pinned by differential testing against the reference (see
 * `test/04-parity.test.mjs`): arrays, `Date` instances, class instances and
 * null-prototype objects are all **rejected**; only plain literals pass.
 */
export function isObjectLiteral(item) {
	if (typeof item !== 'object' || item === null || Array.isArray(item)) return false;
	return Object.getPrototypeOf(item) === Object.prototype;
}

/**
 * Port of `n8n-workflow`'s `jsonParse` **without options** — which is exactly
 * how the credential core calls it. With no options the helper has no
 * `acceptJSObject` / `repairJSON` / `fallbackValue` / `errorMessage` branch to
 * take, so the original `SyntaxError` from `JSON.parse` propagates untouched.
 */
export function jsonParse(jsonString) {
	return JSON.parse(jsonString);
}

/**
 * Port of `n8n-workflow`'s `deepCopy`, restricted to the JSON-shaped values the
 * credential core copies (plain objects, arrays and primitives).
 *
 * DELTA (documented): the upstream helper also clones `Date`, `RegExp`, `Map`,
 * `Set`, `Buffer` and `Error` instances, and preserves prototype chains.
 * Credential data is JSON by construction, so those branches are unreachable
 * here. `deepCopy(undefined)` returns `undefined`, like upstream.
 */
export function deepCopy(value) {
	if (value === null || typeof value !== 'object') return value;
	if (Array.isArray(value)) return value.map(deepCopy);
	const out = {};
	for (const [key, entry] of Object.entries(value)) out[key] = deepCopy(entry);
	return out;
}

/**
 * Port of `n8n-workflow`'s `isINodePropertyCollection` behaviour: a
 * `fixedCollection` option is a collection when it carries a `values` array.
 */
export function isINodePropertyCollection(value) {
	return typeof value === 'object' && value !== null && 'values' in value;
}
