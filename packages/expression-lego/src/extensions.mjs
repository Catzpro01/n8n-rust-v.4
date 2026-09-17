/**
 * Expression LEGO — n8n extension methods (invariant E12).
 * Behavioral port of n8n-workflow 2.9.4 src/extensions/* (core method set).
 *
 * Reference transform (expression-extension.ts `extendTransform`):
 *   receiver.method(args)  →  extend(receiver, 'method', [args])
 *   $if(test, a[, b])      →  test ? a : (b ?? false)
 * The reconstruction performs the same rewrites textually (string-literal
 * aware, paren balancing) instead of via recast/esprima.
 */

import { DateTime } from 'luxon';
import { ExpressionExtensionError } from './errors.mjs';

/* ── generic ──────────────────────────────────────────────────────────── */
function isEmpty(value) {
	return value === null || value === undefined || !value;
}
function isNotEmpty(value) {
	return !isEmpty(value);
}

/* ── array (array-extensions.ts) ──────────────────────────────────────── */
function unique(value) {
	if (!Array.isArray(value)) throw new TypeError();
	return [...new Set(value)];
}
function removeDuplicates(value) {
	if (!Array.isArray(value)) throw new TypeError();
	const seen = new Set();
	const out = [];
	for (const item of value) {
		const key = JSON.stringify(item);
		if (!seen.has(key)) {
			seen.add(key);
			out.push(item);
		}
	}
	return out;
}
function first(value) {
	if (!Array.isArray(value)) throw new TypeError();
	return value[0];
}
function last(value) {
	if (!Array.isArray(value)) throw new TypeError();
	return value[value.length - 1];
}
function pluck(value, args) {
	if (!Array.isArray(value)) throw new TypeError();
	return value.map((item) => item?.[args[0]]);
}
function randomItem(value) {
	if (!Array.isArray(value)) throw new TypeError();
	return value[Math.floor(Math.random() * value.length)];
}
function ensureNumberArray(value, fnName) {
	if (!Array.isArray(value)) throw new TypeError();
	const numbers = value.map(Number);
	if (numbers.some((n) => typeof n !== 'number' || Number.isNaN(n))) {
		throw new ExpressionExtensionError(`Can't get ${fnName}: not a number`, fnName);
	}
	return numbers;
}
function sum(value, args) {
	if (!Array.isArray(value)) throw new TypeError();
	if (args.length) return value.map((v) => v[args[0]]).reduce((a, b) => Number(a) + Number(b), 0);
	return ensureNumberArray(value, 'sum').reduce((a, b) => a + b, 0);
}
function min(value) {
	return Math.min(...ensureNumberArray(value, 'min'));
}
function max(value) {
	return Math.max(...ensureNumberArray(value, 'max'));
}
function average(value) {
	const arr = ensureNumberArray(value, 'average');
	return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function compact(value) {
	if (!Array.isArray(value)) throw new TypeError();
	return value.filter((i) => i !== null && i !== undefined && i !== '');
}
function chunk(value, args) {
	if (!Array.isArray(value)) throw new TypeError();
	const size = args[0] ?? 1;
	const out = [];
	for (let i = 0; i < value.length; i += size) out.push(value.slice(i, i + size));
	return out;
}
function union(value, args) {
	if (!Array.isArray(value)) throw new TypeError();
	return [...new Set([...value, ...args.flat()])];
}
function intersection(value, args) {
	if (!Array.isArray(value)) throw new TypeError();
	const other = new Set(args.flat());
	return [...new Set(value.filter((v) => other.has(v)))];
}
function difference(value, args) {
	if (!Array.isArray(value)) throw new TypeError();
	const other = new Set(args.flat());
	return value.filter((v) => !other.has(v));
}
function append(value, args) {
	if (!Array.isArray(value)) throw new TypeError();
	return [...value, ...args];
}

/* ── string (string-extensions.ts, subset) ────────────────────────────── */
function base64Encode(value) {
	if (typeof value !== 'string') throw new TypeError();
	return Buffer.from(value, 'utf-8').toString('base64');
}
function base64Decode(value) {
	if (typeof value !== 'string') throw new TypeError();
	return Buffer.from(value, 'base64').toString('utf-8');
}
function extractDomain(value) {
	if (typeof value !== 'string') throw new TypeError();
	return extractUrl(value).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}
function extractEmail(value) {
	if (typeof value !== 'string') throw new TypeError();
	const match = value.match(/[\w.-]+@[\w.-]+\.\w+/);
	return match ? match[0] : '';
}
function extractUrl(value) {
	if (typeof value !== 'string') throw new TypeError();
	const match = value.match(/https?:\/\/[^\s"']+/);
	return match ? match[0] : '';
}
function hash(value, args) {
	// placeholder kept intentionally unimplemented in the subset port
	throw new ExpressionExtensionError(`Unknown expression function: hash`);
}
function quote(value) {
	if (typeof value !== 'string') throw new TypeError();
	return `'${value.replaceAll("'", "\\'")}'`;
}
function toSnakeCase(value) {
	if (typeof value !== 'string') throw new TypeError();
	return value
		.replace(/([a-z])([A-Z])/g, '$1_$2')
		.replace(/[-\s]+/g, '_')
		.toLowerCase();
}
function toCamelCase(value) {
	if (typeof value !== 'string') throw new TypeError();
	return value
		.toLowerCase()
		.replace(/[-_ ]+/g, ' ')
		.replace(/ (.)/g, (_m, c) => c.toUpperCase())
		.replaceAll(' ', '');
}
function toTitleCase(value) {
	if (typeof value !== 'string') throw new TypeError();
	return value.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

/* ── number (number-extensions.ts) ────────────────────────────────────── */
function toInt(value) {
	const parsed = parseInt(String(value), 10);
	if (Number.isNaN(parsed)) throw new ExpressionExtensionError(`${value} is not a valid number`, 'toInt');
	return parsed;
}
function toFloat(value) {
	const parsed = parseFloat(String(value));
	if (Number.isNaN(parsed)) throw new ExpressionExtensionError(`${value} is not a valid number`, 'toFloat');
	return parsed;
}

/* ── boolean (boolean-extensions.ts) ──────────────────────────────────── */
function toBoolean(value) {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return value !== 0;
	const s = String(value).toLowerCase();
	if (s === 'true' || s === '1') return true;
	if (s === 'false' || s === '0') return false;
	throw new ExpressionExtensionError(`${value} is not a valid boolean`, 'toBoolean');
}

/* ── date (date-extensions.ts) ────────────────────────────────────────── */
function toDateTime(value) {
	if (DateTime.isDateTime(value)) return value;
	if (value instanceof Date) return DateTime.fromJSDate(value);
	if (typeof value === 'number') return DateTime.fromMillis(value);
	const dt = DateTime.fromISO(String(value));
	if (!dt.isValid) {
		const num = Number(value);
		if (!Number.isNaN(num)) return DateTime.fromMillis(num);
		throw new ExpressionExtensionError(`${value} is not a valid DateTime`, 'toDateTime');
	}
	return dt;
}
function toJsonString(value) {
	return JSON.stringify(value, null, 2);
}

/* ── object (object-extensions.ts, subset) ────────────────────────────── */
function removeMatches(value, args) {
	if (typeof value !== 'object' || value === null) throw new TypeError();
	const out = { ...value };
	for (const key of args) delete out[key];
	return out;
}
function renameKeys(value, args) {
	if (typeof value !== 'object' || value === null) throw new TypeError();
	const [map] = args;
	const out = {};
	for (const [k, v] of Object.entries(value)) out[map?.[k] ?? k] = v;
	return out;
}
function merge(value, args) {
	if (typeof value !== 'object' || value === null) throw new TypeError();
	return Object.assign({}, value, ...args);
}

/** Port of extensions/index.ts EXTENSION_OBJECTS — typeName-tagged method sets. */
export const EXTENSION_OBJECTS = [
	{
		typeName: 'Array',
		functions: {
			removeDuplicates, unique, first, last, pluck, randomItem, sum, min, max,
			average, isNotEmpty, isEmpty, compact, chunk, renameKeys, merge, union,
			difference, intersection, append, toJsonString, toInt, toFloat, toBoolean, toDateTime,
		},
	},
	{
		typeName: 'Date',
		functions: { toDateTime, isEmpty, isNotEmpty },
	},
	{
		typeName: 'Number',
		functions: { toInt, toFloat, toBoolean, toDateTime, isEmpty, isNotEmpty, toJsonString },
	},
	{
		typeName: 'Object',
		functions: { removeMatches, renameKeys, isEmpty, isNotEmpty, merge, toJsonString },
	},
	{
		typeName: 'String',
		functions: {
			base64Encode, base64Decode, extractDomain, extractEmail, extractUrl, quote,
			toSnakeCase, toCamelCase, toTitleCase, toBoolean, toDateTime, toInt, toFloat,
			isEmpty, isNotEmpty, toJsonString, hash,
		},
	},
	{
		typeName: 'Boolean',
		functions: { toBoolean, isEmpty, isNotEmpty },
	},
];

export const genericExtensions = { isEmpty, isNotEmpty };

export const extendedFunctions = {
	min: Math.min,
	max: Math.max,
	not: (value) => !value,
	average: (...args) => average(args.flat()),
	numberList: (start, end) => {
		const size = Math.abs(start - end) + 1;
		const arr = new Array(size);
		let curr = start;
		for (let i = 0; i < size; i++) {
			arr[i] = curr;
			curr = start < end ? curr + 1 : curr - 1;
		}
		return arr;
	},
	zip: (keys, values) => {
		if (keys.length !== values.length) {
			throw new ExpressionExtensionError('keys and values not of equal length');
		}
		return keys.reduce((p, c, i) => ((p[c] = values[i]), p), {});
	},
	$min: Math.min,
	$max: Math.max,
	$average: (...args) => average(args.flat()),
	$not: (value) => !value,
	$ifEmpty: (value, defaultValue) => {
		if (value === undefined || value === null || value === '') return defaultValue;
		if (typeof value === 'object') {
			if (Array.isArray(value) && !value.length) return defaultValue;
			if (!Object.keys(value).length) return defaultValue;
		}
		return value;
	},
};

const EXTENSION_METHODS = [
	...new Set([
		...EXTENSION_OBJECTS.flatMap((o) => Object.keys(o.functions)),
		...Object.keys(genericExtensions),
	]),
].sort();

/** expression-extension.ts EXPRESSION_EXTENSION_REGEX. */
export function hasExpressionExtension(str) {
	return new RegExp(`(\\$if|\\.(${EXTENSION_METHODS.join('|')})\\s*(\\?\\.)?)\\s*\\(`).test(str);
}

/** expression-extension.ts isDate (ISO string check). */
function isDate(input) {
	if (typeof input !== 'string' || !input.length) return false;
	if (!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/.test(input)) return false;
	const d = new Date(input);
	return d instanceof Date && !isNaN(d.valueOf()) && d.toISOString() === input;
}

const genericExtensionsByName = { isEmpty, isNotEmpty };

function byType(typeName, name) {
	return EXTENSION_OBJECTS.find((o) => o.typeName === typeName)?.functions[name];
}

/** utils.ts unsafeObjectProperties (subset needed for extension lookup) */
const UNSAFE_EXTENSION_NAMES = new Set([
	'__proto__', 'prototype', 'constructor', 'getPrototypeOf', 'mainModule', 'binding',
	'_linkedBinding', '_load', 'prepareStackTrace', '__lookupGetter__', '__lookupSetter__',
	'__defineGetter__', '__defineSetter__', 'caller', 'arguments',
]);
function isSafeObjectPropertyName(name) {
	return !UNSAFE_EXTENSION_NAMES.has(String(name));
}

/** expression-extension.ts findExtendedFunction */
function findExtendedFunction(input, functionName) {
	const name = typeof functionName === 'string' ? functionName : String(functionName);

	if (!isSafeObjectPropertyName(name)) {
		throw new ExpressionExtensionError(
			`Cannot access "${name}" via expression extension due to security concerns`,
		);
	}

	let foundFunction;
	let effectiveInput = input;
	if (Array.isArray(input)) {
		foundFunction = byType('Array', name);
	} else if (isDate(input) && name !== 'toDate' && name !== 'toDateTime') {
		effectiveInput = new Date(input);
		foundFunction = byType('Date', name);
	} else if (typeof input === 'string') {
		foundFunction = byType('String', name);
	} else if (typeof input === 'number') {
		foundFunction = byType('Number', name);
	} else if (input && (DateTime.isDateTime(input) || input instanceof Date)) {
		foundFunction = byType('Date', name);
	} else if (input !== null && typeof input === 'object') {
		foundFunction = byType('Object', name);
	} else if (typeof input === 'boolean') {
		foundFunction = byType('Boolean', name);
	}

	if (!foundFunction) {
		// Likely a builtin implemented for another type (e.g. $input.first())
		if (input && name && typeof input[name] === 'function') {
			return { type: 'native', function: input[name], input };
		}
		foundFunction = genericExtensionsByName[name];
	}

	if (!foundFunction) return undefined;
	return { type: 'extended', function: foundFunction, input: effectiveInput };
}

/** expression-extension.ts checkIfValueDefinedOrThrow */
function checkIfValueDefinedOrThrow(input, functionName) {
	if (input === undefined || input === null) {
		throw new ExpressionExtensionError(
			`You can't call '${functionName}' on '${input}' because it's ${input === null ? 'null' : 'undefined'}`,
		);
	}
}

/** Runtime resolver — expression-extension.ts `extend`. */
export function extend(input, functionName, args = []) {
	const foundFunction = findExtendedFunction(input, functionName);

	if (!foundFunction) {
		checkIfValueDefinedOrThrow(input, functionName);
		const haveFunction = EXTENSION_OBJECTS.filter((v) => functionName in v.functions);
		if (!haveFunction.length) {
			throw new ExpressionExtensionError(`Unknown expression function: ${functionName}`);
		}
		if (haveFunction.length > 1) {
			const lastType = `"${haveFunction.pop().typeName}"`;
			const typeNames = `${haveFunction.map((v) => `"${v.typeName}"`).join(', ')}, and ${lastType}`;
			throw new ExpressionExtensionError(`${functionName}() is only callable on types ${typeNames}`);
		}
		throw new ExpressionExtensionError(`${functionName}() is only callable on type "${haveFunction[0].typeName}"`);
	}

	if (foundFunction.type === 'native') {
		return foundFunction.function.apply(input, args);
	}
	return foundFunction.function(foundFunction.input, args);
}

/** expression-extension.ts extendOptional — optional-chain safe resolver. */
export function extendOptional(input, functionName) {
	if (input === undefined || input === null) return undefined;
	const found = findExtendedFunction(input, functionName);
	if (!found) return undefined;
	return (...callArgs) => {
		if (found.type === 'native') return found.function.apply(input, callArgs);
		return found.function(found.input, callArgs);
	};
}

/* -- textual transform helpers (port of the recast/esprima pass) --------- */

/** Walk source skipping string literals; stops when visit returns true. */
function scanCode(expression, visit) {
	let inStr = null;
	for (let i = 0; i < expression.length; i++) {
		const c = expression[i];
		if (inStr) {
			if (c === '\\') {
				i++;
				continue;
			}
			if (c === inStr) inStr = null;
			continue;
		}
		if (c === '"' || c === "'" || c === '`') {
			inStr = c;
			continue;
		}
		if (visit(c, i, expression) === true) return;
	}
}

function matchBracketBackward(src, position) {
	const pairs = { ')': '(', ']': '[', '}': '{' };
	const want = pairs[src[position]];
	let depth = 0;
	let inStr = null;
	for (let i = position; i >= 0; i--) {
		const c = src[i];
		if (inStr) {
			if (src[i - 1] === '\\') i--;
			else if (c === inStr) inStr = null;
			continue;
		}
		if (c === '"' || c === "'" || c === '`') inStr = c;
		else if (c === src[position]) depth++;
		else if (c === want) {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

function findCallClose(src, openIdx) {
	let depth = 0;
	let inStr = null;
	for (let i = openIdx; i < src.length; i++) {
		const c = src[i];
		if (inStr) {
			if (c === '\\') i++;
			else if (c === inStr) inStr = null;
			continue;
		}
		if (c === '"' || c === "'" || c === '`') inStr = c;
		else if (c === '(') depth++;
		else if (c === ')') {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

/** Find the start of the receiver expression ending just before dotIdx. */
function receiverStart(src, dotIdx) {
	let i = dotIdx - 1;
	while (i >= 0 && /\s/.test(src[i])) i--;
	if (i < 0) return -1;
	if (src[i] === ')' || src[i] === ']') {
		i = matchBracketBackward(src, i);
		if (i < 0) return -1;
		i--;
		while (i >= 0 && /[A-Za-z0-9_$]/.test(src[i])) i--;
		i++;
		return i < dotIdx ? i : -1;
	}
	while (i >= 0 && /[A-Za-z0-9_$.'"`\]]/.test(src[i])) {
		if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
			const quote = src[i];
			i--;
			while (i >= 0 && !(src[i] === quote && src[i - 1] !== '\\')) i--;
		}
		i--;
	}
	i++;
	return i < dotIdx ? i : -1;
}

const EXT_METHOD_RE = new RegExp(`^\\.\\s*(${EXTENSION_METHODS.join('|')})\\s*(\\?\\.)?\\s*\\(`);

export function extendSyntax(expression) {
	if (!hasExpressionExtension(expression)) return expression;

	let out = expression;
	// Iterate to convergence so nested extension calls (a.pluck(x).first()) are
	// rewritten inside-out.
	for (let pass = 0; pass < 32; pass++) {
		let target = null;
		scanCode(out, (c, i, src) => {
			if (c !== '.') return;
			const rest = src.slice(i, i + 80);
			const m = rest.match(EXT_METHOD_RE);
			if (!m) return;
			target = { dotIdx: i, match: m };
			return true; // left-most first; we rewrite left-to-right innermost chains
		});
		if (!target) break;

		const { dotIdx, match } = target;
		const openIdx = dotIdx + match[0].length - 1;
		const closeIdx = findCallClose(out, openIdx);
		if (closeIdx < 0) break;
		const rStart = receiverStart(out, dotIdx);
		if (rStart < 0) break;
		const receiver = out.slice(rStart, dotIdx).trim();
		const innerArgs = out.slice(openIdx + 1, closeIdx);
		const replacement = `__extend(${receiver},'${match[1]}',[${innerArgs}])`;
		out = out.slice(0, rStart) + replacement + out.slice(closeIdx + 1);
	}

	// $if(test, a[, b]) → __n8n.$if(test, a[, b]) — laziness is preserved by
	// deferring both branches inside the helper via thunks is unnecessary here:
	// the reference rewrites to a conditional expression; we splice one.
	for (let pass = 0; pass < 8; pass++) {
		let target = -1;
		scanCode(out, (c, i, src) => {
			if (c !== '$') return;
			if (src.startsWith('$if', i) && /\s*\(/.test(src.slice(i + 3, i + 5))) {
				target = i;
				return true;
			}
		});
		if (target < 0) break;
		const openIdx = out.indexOf('(', target);
		const closeIdx = findCallClose(out, openIdx);
		if (closeIdx < 0) break;
		const inner = out.slice(openIdx + 1, closeIdx);
		const args = splitTopLevelArgs(inner);
		if (args.length < 2) {
			throw new ExpressionExtensionError(
				'$if requires at least 2 parameters: test, value_if_true[, and value_if_false]',
			);
		}
		const alt = args[2] !== undefined && args.length > 2 ? args[2] : 'false';
		out = `${out.slice(0, target)}((${args[0]}) ? (${args[1]}) : (${alt}))${out.slice(closeIdx + 1)}`;
	}

	return out;
}

/** Split "a, b, c" on top-level commas (string/bracket aware). */
function splitTopLevelArgs(inner) {
	const args = [];
	let depth = 0;
	let inStr = null;
	let cur = '';
	for (let i = 0; i < inner.length; i++) {
		const c = inner[i];
		if (inStr) {
			cur += c;
			if (c === '\\') {
				cur += inner[i + 1] ?? '';
				i++;
			} else if (c === inStr) inStr = null;
			continue;
		}
		if (c === '"' || c === "'" || c === '`') {
			inStr = c;
			cur += c;
			continue;
		}
		if (c === '(' || c === '[' || c === '{') depth++;
		if (c === ')' || c === ']' || c === '}') depth--;
		if (c === ',' && depth === 0) {
			args.push(cur);
			cur = '';
			continue;
		}
		cur += c;
	}
	if (cur.trim() !== '' || args.length) args.push(cur);
	return args.map((a) => a.trim()).filter((a, idx) => !(a === '' && idx === args.length - 1));
}
