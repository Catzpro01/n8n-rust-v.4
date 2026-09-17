/**
 * Stable serializer shared by the golden recorder, the golden test and the live
 * oracle comparison. One definition, so a golden can never be recorded under
 * looser equality rules than the gate enforces.
 *
 * Key properties:
 *  - object key ORDER is preserved (n8n returns objects whose order is observable)
 *  - `2` and `"2"` differ (`number:2` vs `"2"`), so type drift cannot hide
 *  - `undefined` is distinguishable from an absent key in the value position
 *  - Date / luxon DateTime / functions are tagged instead of stringified away
 */

const CIRCULAR = new WeakSet();

/**
 * `undefined` has no JSON representation, and `JSON.stringify([undefined])` yields
 * `[null]` — which silently changed a probe's fallbackValue from `undefined` to
 * `null` (a different, non-throwing branch in getNodeParameter). Args are written
 * through this sentinel so goldens round-trip exactly.
 */
export const UNDEFINED_SENTINEL = '__undefined__';
export const encodeArgs = (args) =>
	args.map((a) => (a === undefined ? UNDEFINED_SENTINEL : a));
export const decodeArgs = (args) =>
	args.map((a) => (a === UNDEFINED_SENTINEL ? undefined : a));

export function serialize(value) {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';

	if (typeof value === 'function') return '[fn]';
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
		return `${typeof value}:${String(value)}`;
	}
	if (typeof value === 'symbol') return `symbol:${String(value)}`;

	if (value instanceof Date) return `date:${value.toISOString()}`;
	if (value instanceof Error) return `error:${value.name}:${value.message}`;

	if (typeof value === 'object' && value.isLuxonDateTime === true) {
		return `luxon:${value.isValid ? value.toISO() : `invalid(${value.invalidReason})`}`;
	}

	if (CIRCULAR.has(value)) return '[circular]';
	CIRCULAR.add(value);
	try {
		if (Array.isArray(value)) {
			return `[${value.map((v) => serialize(v)).join(',')}]`;
		}
		// Proxy-backed accessor objects are indistinguishable from plain objects here:
		// only own enumerable keys, in insertion order, are observable to an expression.
		let keys;
		try {
			keys = Object.keys(value);
		} catch {
			return `[unserializable:${value.constructor?.name ?? 'unknown'}]`;
		}
		return `{${keys.map((k) => `${JSON.stringify(k)}:${serialize(value[k])}`).join(',')}}`;
	} finally {
		CIRCULAR.delete(value);
	}
}

/** Resolves a probe path against a root, awaiting anything thenable on the way. */
export async function resolvePath(root, path) {
	let current = root;
	let receiver;
	for (const step of path) {
		if (typeof step === 'string') {
			receiver = current;
			current = current?.[step];
			continue;
		}
		if (step && typeof step === 'object' && '()' in step) {
			if (typeof current !== 'function') {
				throw new TypeError(`not-callable (typeof ${typeof current})`);
			}
			// methods must keep their receiver: `const fn = ctx.getNode; fn()` loses
			// `this`, and every reference method reads `this.*`
			current = current.apply(receiver, decodeArgs(step['()']));
			receiver = undefined;
			continue;
		}
		if (step && typeof step === 'object' && 'sideEffect' in step) {
			continue; // recorded by the test itself, nothing to resolve
		}
		throw new Error(`bad probe step: ${JSON.stringify(step)}`);
	}
	if (current && typeof current.then === 'function') current = await current;
	return current;
}

export function describeError(error) {
	const descriptor = {
		name: error?.name,
		message: error?.message,
		description: error?.description,
		level: error?.level,
		functionality: error?.functionality,
	};
	if (Array.isArray(error?.messages)) descriptor.messages = error.messages;
	if (error?.context !== undefined) {
		descriptor.context = JSON.parse(
			JSON.stringify(error.context, (key, value) => (typeof value === 'function' ? '[fn]' : value)),
		);
	}
	return descriptor;
}

/** One probe → a JSON-able record: `{ok:true, serialized}` or `{ok:false, error}`. */
export async function comparable(root, path) {
	try {
		const value = await resolvePath(root, path);
		return { ok: true, serialized: serialize(value) };
	} catch (error) {
		return { ok: false, error: describeError(error) };
	}
}

export const probeKey = (path) =>
	path
		.map((step) =>
			typeof step === 'string'
				? step
				: `(${(step['()'] ?? []).map((a) => JSON.stringify(a) ?? 'undefined').join(',')})`,
		)
		.join('.');
