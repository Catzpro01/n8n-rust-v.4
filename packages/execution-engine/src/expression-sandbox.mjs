import vm from 'node:vm';

const FORBIDDEN_PROPERTY = new Set(['constructor', '__proto__', 'prototype']);
const MUTATING_METHOD = new Set([
	'copyWithin', 'fill', 'pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift',
	'add', 'clear', 'delete', 'set', 'setDate', 'setFullYear', 'setHours', 'setMilliseconds',
	'setMinutes', 'setMonth', 'setSeconds', 'setTime', 'setUTCDate', 'setUTCFullYear',
	'setUTCHours', 'setUTCMilliseconds', 'setUTCMinutes', 'setUTCMonth', 'setUTCSeconds',
]);
const FORBIDDEN_SOURCE = [
	{ pattern: /(?:\.|\?\.|\[)\s*(?:constructor|prototype|__proto__)\b/, label: 'prototype access' },
	{ pattern: /["'`]\s*(?:constructor|prototype|__proto__)\s*["'`]/, label: 'prototype access' },
	{ pattern: /\b(?:process|globalThis|require|module|exports|Function|eval)\b/, label: 'restricted global' },
	{ pattern: /\b(?:import|class|with)\b/, label: 'restricted syntax' },
	{ pattern: /\bthis\b/, label: 'restricted global' },
];

export class ExpressionSandboxError extends Error {
	constructor(message, { cause, code = 'EXPRESSION_SANDBOX_DENIED' } = {}) {
		super(message, { cause });
		this.name = 'ExpressionSandboxError';
		this.code = code;
	}
}

function assertSafeSource(source) {
	for (const rule of FORBIDDEN_SOURCE) {
		if (rule.pattern.test(source)) {
			throw new ExpressionSandboxError(`Expression contains invalid ${rule.label}`);
		}
	}
}

/**
 * A read-only membrane for host values passed into node:vm. It is important to
 * deny prototype properties here as well as in the source scan: computed keys
 * can otherwise recover Function through `value[key]`.
 */
function createReadOnlyMembrane() {
	const wrapped = new WeakMap();
	const unwrapped = new WeakMap();
	const unwrap = (value) => unwrapped.get(value) ?? value;
	const wrap = (value) => {
		if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return value;
		if (wrapped.has(value)) return wrapped.get(value);

		const proxy = new Proxy(value, {
			get(target, property, receiver) {
				if (FORBIDDEN_PROPERTY.has(property)) {
					throw new ExpressionSandboxError(`Access to property "${String(property)}" is denied`);
				}
				if (MUTATING_METHOD.has(property) && typeof Reflect.get(target, property, receiver) === 'function') {
					return () => { throw new ExpressionSandboxError('Expressions cannot mutate execution data'); };
				}
				return wrap(Reflect.get(target, property, receiver));
			},
			getOwnPropertyDescriptor(target, property) {
				if (FORBIDDEN_PROPERTY.has(property)) {
					throw new ExpressionSandboxError(`Inspection of property "${String(property)}" is denied`);
				}
				return Reflect.getOwnPropertyDescriptor(target, property);
			},
			getPrototypeOf() { return null; },
			has(target, property) {
				return !FORBIDDEN_PROPERTY.has(property) && Reflect.has(target, property);
			},
			set() { throw new ExpressionSandboxError('Expressions cannot mutate execution data'); },
			deleteProperty() { throw new ExpressionSandboxError('Expressions cannot mutate execution data'); },
			defineProperty() { throw new ExpressionSandboxError('Expressions cannot mutate execution data'); },
			setPrototypeOf() { throw new ExpressionSandboxError('Expressions cannot mutate prototypes'); },
			apply(target, thisArg, argumentsList) {
				return wrap(Reflect.apply(target, unwrap(thisArg), argumentsList.map(unwrap)));
			},
		});
		wrapped.set(value, proxy);
		unwrapped.set(proxy, value);
		return proxy;
	};
	return wrap;
}

function materializeResult(value, seen = new WeakMap()) {
	if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return value;
	if (typeof value === 'function') {
		throw new ExpressionSandboxError('Expressions cannot return functions');
	}
	if (seen.has(value)) return seen.get(value);
	if (value instanceof Date) return new Date(value.getTime());
	const result = Array.isArray(value) ? [] : {};
	seen.set(value, result);
	for (const key of Object.keys(value)) result[key] = materializeResult(value[key], seen);
	return result;
}

/**
 * Evaluate a synchronous expression in a fresh, code-generation-free VM.
 * This is defense in depth, not a process security boundary (per Node.js vm docs).
 */
export function runExpressionInSandbox(source, scope = {}, { timeoutMs = 100 } = {}) {
	assertSafeSource(source);
	const wrap = createReadOnlyMembrane();
	const sandbox = Object.create(null);
	for (const [name, value] of Object.entries(scope)) sandbox[name] = wrap(value);

	// Explicit shadows document the denied surface and avoid accidental future
	// injection through a caller-provided scope.
	for (const name of ['process', 'require', 'module', 'exports', 'Function', 'eval']) sandbox[name] = undefined;

	const context = vm.createContext(sandbox, {
		name: 'n8n-expression',
		codeGeneration: { strings: false, wasm: false },
	});
	try {
		const script = new vm.Script(`"use strict"; (${source})`, { filename: 'n8n-expression.vm' });
		const value = script.runInContext(context, { timeout: timeoutMs, breakOnSigint: true });
		return materializeResult(value);
	} catch (error) {
		if (error instanceof ExpressionSandboxError) throw error;
		if (error?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
			throw new ExpressionSandboxError('Expression evaluation timed out', {
				cause: error,
				code: 'EXPRESSION_SANDBOX_TIMEOUT',
			});
		}
		throw error;
	}
}
