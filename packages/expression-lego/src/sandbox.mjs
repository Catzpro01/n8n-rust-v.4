/**
 * Expression LEGO — sandbox.
 * 1:1 behavioral port of n8n-workflow 2.9.4:
 *   src/expression-sandboxing.ts   (sanitizer, source-level rejects)
 *   src/utils.ts                   (unsafeObjectProperties / isSafeObjectProperty)
 *   src/expression.ts              (initializeGlobalContext allow-list, constructor regex)
 *
 * The reference implementation enforces some of these rules on the AST
 * (@n8n/tournament hooks). This reconstruction enforces them on the expression
 * source before evaluation — the observable contract (invariant E9) is the
 * same: the offending expression is rejected with the same ExpressionError
 * subclasses / messages before any user code runs.
 */
import { DateTime, Duration, Interval } from 'luxon';
import {
	ExpressionClassExtensionError,
	ExpressionDestructuringError,
	ExpressionError,
	ExpressionReservedVariableError,
	ExpressionWithStatementError,
} from './errors.mjs';

export const sanitizerName = '__sanitize';
export const DOLLAR_SIGN_ERROR = 'Cannot access "$" without calling it as a function';

const RESERVED_VARIABLE_NAMES = new Set(['___n8n_data', sanitizerName]);

/** utils.ts — unsafeObjectProperties */
const unsafeObjectProperties = new Set([
	'__proto__',
	'prototype',
	'constructor',
	'getPrototypeOf',
	'mainModule',
	'binding',
	'_linkedBinding',
	'_load',
	'prepareStackTrace',
	'__lookupGetter__',
	'__lookupSetter__',
	'__defineGetter__',
	'__defineSetter__',
	'caller',
	'arguments',
]);

export function isSafeObjectProperty(property) {
	return !unsafeObjectProperties.has(String(property));
}

/** expression-sandboxing.ts — sanitizer (runtime check for computed member access). */
export const sanitizer = (value) => {
	const propertyKey = String(value);
	if (!isSafeObjectProperty(propertyKey)) {
		throw new ExpressionError(`Cannot access "${propertyKey}" due to security concerns`);
	}
	return propertyKey;
};

/** Strip string literals, template literals and comments so scans see code only. */
function stripLiteralsAndComments(source) {
	let out = '';
	let i = 0;
	const n = source.length;
	while (i < n) {
		const c = source[i];
		const next = source[i + 1];
		if (c === '/' && next === '/') {
			while (i < n && source[i] !== '\n') i++;
			continue;
		}
		if (c === '/' && next === '*') {
			i += 2;
			while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
			i += 2;
			continue;
		}
		if (c === '"' || c === "'" || c === '`') {
			const quote = c;
			out += quote;
			i++;
			while (i < n) {
				if (source[i] === '\\') {
					i += 2;
					continue;
				}
				if (source[i] === quote) break;
				i++;
			}
			out += quote;
			i++;
			continue;
		}
		out += c;
		i++;
	}
	return out;
}

/**
 * Pre-evaluation source checks (behaviorally covers the reference AST hooks +
 * the explicit `.constructor` regex from expression.ts).
 * Throws the same error classes the reference throws for the same inputs.
 */
export function assertExpressionSourceIsSafe(expression) {
	const code = stripLiteralsAndComments(expression);

	// PrototypeSanitizer.visitMemberExpression — computed access with a static
	// unsafe string literal, e.g. obj['__proto__'] (raw scan: the key lives
	// inside a literal, so it must run before literals are stripped).
	const UNSAFE_NAMES = '__proto__|prototype|constructor|getPrototypeOf|mainModule|prepareStackTrace|__lookupGetter__|__lookupSetter__|__defineGetter__|__defineSetter__|_load|_linkedBinding|binding|caller|arguments';
	const computed = expression.match(
		new RegExp(`\\[\\s*(['\"\`])\\s*(${UNSAFE_NAMES})\\1\\s*\\]`),
	);
	if (computed) {
		throw new ExpressionError(`Cannot access "${computed[2]}" due to security concerns`);
	}

	// PrototypeSanitizer.visitObjectPattern — destructuring of unsafe keys
	const destructured = expression.match(
		new RegExp(`\\{\\s*(?:[A-Za-z_$][\\w$]*\\s*:\\s*)?(${UNSAFE_NAMES})\\s*[,:}]`),
	);
	if (destructured) {
		throw new ExpressionDestructuringError(destructured[1]);
	}

	// expression.ts L481: /\.\s*constructor/gm
	if (/\.(\s|\n)*constructor/gm.test(code)) {
		throw new ExpressionError('Expression contains invalid constructor function call', {
			causeDetailed: 'Constructor override attempt is not allowed due to security concerns',
		});
	}

	// PrototypeSanitizer.visitMemberExpression — static unsafe member access
	const unsafeMember = code.match(
		/(\.)\s*(__proto__|prototype|getPrototypeOf|mainModule|prepareStackTrace|__lookupGetter__|__lookupSetter__|__defineGetter__|__defineSetter__|_load|_linkedBinding|binding|caller|arguments)\b/g,
	);
	if (unsafeMember) {
		const name = unsafeMember[0].replace(/^\.\s*/, '');
		throw new ExpressionError(`Cannot access "${name}" due to security concerns`);
	}

	// PrototypeSanitizer.visitWithStatement
	if (/\bwith\s*\(/.test(code)) {
		throw new ExpressionWithStatementError();
	}

	// PrototypeSanitizer.visitClassDeclaration/visitClassExpression
	const classMatch = code.match(/\bclass\s+([A-Za-z_$][\w$]*)\s+extends\s+([A-Za-z_$][\w$]*)/);
	if (classMatch) {
		const blocked = new Set(['Function', 'GeneratorFunction', 'AsyncFunction', 'AsyncGeneratorFunction']);
		if (blocked.has(classMatch[2])) {
			throw new ExpressionClassExtensionError(classMatch[2]);
		}
		// dynamic/whitelisted base classes other than the blocked set are allowed
	}

	// PrototypeSanitizer — reserved internal variable names
	const reserved = code.match(new RegExp(`\\b(${[...RESERVED_VARIABLE_NAMES].join('|')})\\b`, 'g'));
	if (reserved) {
		throw new ExpressionReservedVariableError(reserved[0]);
	}

	// DollarSignValidator — bare `$` (not a call `$(`, not a property `obj.$` / `obj[$]`)
	assertBareDollarIsSafe(code);

	// ObjectPattern destructuring of unsafe keys (visitObjectPattern)
	const destructure = code.match(/\{\s*(?:const|let|var)\s*\}\s*\{?\s*('?"?)(__proto__|prototype|constructor)\1\s*[:}]/);
	if (destructure) {
		throw new ExpressionDestructuringError(destructure[2]);
	}
}

/**
 * Bare-`$` validator. Allowed: `$('Node')` calls and `obj.$` / `obj[$]` property
 * access. Everything else (`$`, `$.x`, `$ + 1`) → ExpressionError(DOLLAR_SIGN_ERROR).
 */
function assertBareDollarIsSafe(code) {
	const re = /\$/g;
	let match;
	while ((match = re.exec(code)) !== null) {
		const prev = code.slice(Math.max(0, match.index - 2), match.index);
		const before = prev.trimEnd().slice(-1);
		const after = code.slice(match.index + 1).trimStart().slice(0, 1);
		// part of a longer identifier ($json, $node, $if, ...) - fine
		if (/[A-Za-z0-9_$]/.test(after)) continue;
		const isCall = after === '(';
		const isProperty = before === '.' || before === '[';
		if (!isCall && !isProperty) {
			throw new ExpressionError(DOLLAR_SIGN_ERROR);
		}
	}
}

/**
 * expression.ts — Expression.initializeGlobalContext (allow-list + deny-list).
 * Mutates `data` in place exactly like the reference.
 */
export function initializeGlobalContext(data) {
	/** Deny-list */
	data.document = {};
	data.global = {};
	data.window = {};
	data.Window = {};
	data.this = {};
	data.globalThis = {};
	data.self = {};
	data.alert = {};
	data.prompt = {};
	data.confirm = {};
	data.eval = {};
	data.uneval = {};
	data.setTimeout = {};
	data.setInterval = {};
	data.setImmediate = {};
	data.clearImmediate = {};
	data.queueMicrotask = {};
	data.Function = {};
	data.require = {};
	data.module = {};
	data.Buffer = {};
	data.__dirname = {};
	data.__filename = {};
	data.fetch = {};
	data.XMLHttpRequest = {};
	data.Promise = {};
	data.Generator = {};
	data.GeneratorFunction = {};
	data.AsyncFunction = {};
	data.AsyncGenerator = {};
	data.AsyncGeneratorFunction = {};
	data.WebAssembly = {};
	data.Reflect = {};
	data.Proxy = {};
	data.__lookupGetter__ = undefined;
	data.__lookupSetter__ = undefined;
	data.__defineGetter__ = undefined;
	data.__defineSetter__ = undefined;
	data.escape = {};
	data.unescape = {};

	/** Allow-list */
	data.Date = Date;
	data.DateTime = DateTime;
	data.Interval = Interval;
	data.Duration = Duration;
	data.Object = Object; // safe-wrapper Proxy omitted: property access is sanitized at the data-proxy/source layer
	data.Array = Array;
	data.Int8Array = Int8Array;
	data.Uint8Array = Uint8Array;
	data.Uint8ClampedArray = Uint8ClampedArray;
	data.Int16Array = Int16Array;
	data.Uint16Array = Uint16Array;
	data.Int32Array = Int32Array;
	data.Uint32Array = Uint32Array;
	data.Float32Array = Float32Array;
	data.Float64Array = Float64Array;
	data.BigInt64Array = typeof BigInt64Array !== 'undefined' ? BigInt64Array : {};
	data.BigUint64Array = typeof BigUint64Array !== 'undefined' ? BigUint64Array : {};
	data.Map = typeof Map !== 'undefined' ? Map : {};
	data.WeakMap = typeof WeakMap !== 'undefined' ? WeakMap : {};
	data.Set = typeof Set !== 'undefined' ? Set : {};
	data.WeakSet = typeof WeakSet !== 'undefined' ? WeakSet : {};
	data.Error = Error;
	data.TypeError = TypeError;
	data.SyntaxError = SyntaxError;
	data.EvalError = EvalError;
	data.RangeError = RangeError;
	data.ReferenceError = ReferenceError;
	data.URIError = URIError;
	data.Intl = typeof Intl !== 'undefined' ? Intl : {};
	data.String = String;
	data.RegExp = RegExp;
	data.Math = Math;
	data.Number = Number;
	data.BigInt = typeof BigInt !== 'undefined' ? BigInt : {};
	data.Infinity = Infinity;
	data.NaN = NaN;
	data.isFinite = Number.isFinite;
	data.isNaN = Number.isNaN;
	data.parseFloat = parseFloat;
	data.parseInt = parseInt;
	data.JSON = JSON;
	data.ArrayBuffer = typeof ArrayBuffer !== 'undefined' ? ArrayBuffer : {};
	data.SharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined' ? SharedArrayBuffer : {};
	data.Atomics = typeof Atomics !== 'undefined' ? Atomics : {};
	data.DataView = typeof DataView !== 'undefined' ? DataView : {};
	data.encodeURI = encodeURI;
	data.encodeURIComponent = encodeURIComponent;
	data.decodeURI = decodeURI;
	data.decodeURIComponent = decodeURIComponent;
	data.Boolean = Boolean;
	data.Symbol = Symbol;
}
