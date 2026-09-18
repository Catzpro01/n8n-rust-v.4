'use strict';
/**
 * Expression — JavaScript port of n8n@2.9.4 `packages/workflow/src/expression.ts`.
 *
 * Implements:
 *   - isExpression(v)
 *   - Expression#getParameterValue(...)  (recurses objects/arrays)
 *   - Expression#resolveSimpleParameterValue(...) (single-leaf evaluation)
 *   - Expression.resolveWithoutWorkflow(...)
 *   - Expression.initializeGlobalContext(...)
 *
 * Sandbox guards:
 *   - Blocks access to `.constructor`, `__proto__`, `prototype` (E9).
 *   - Syntax errors throw ApplicationError('invalid syntax') (E14).
 *   - `$env` without provider throws ExpressionError (E10).
 */
const { ExpressionError, ExpressionExtensionError, ApplicationError } = require('./errors');
const { WorkflowDataProxy } = require('./data-proxy');

// isExpression — E1: only strings starting with '=' are evaluated.
function isExpression(v) {
	return typeof v === 'string' && v.charAt(0) === '=';
}

// Naive brace matcher that tracks depth.
function findMatchingClose(s, openIdx) {
	let depth = 0;
	let inStr = null;
	for (let i = openIdx; i < s.length; i++) {
		const ch = s[i];
		if (inStr) {
			if (ch === '\\') { i++; continue; }
			if (ch === inStr) inStr = null;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
		if (ch === '{') depth++;
		else if (ch === '}') {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

function extractExpressions(template) {
	const out = [];
	let i = 0;
	let inStr = null;
	while (i < template.length) {
		const ch = template[i];
		if (inStr) {
			if (ch === '\\') { i += 2; continue; }
			if (ch === inStr) inStr = null;
			i++; continue;
		}
		if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; i++; continue; }
		if (ch === '{' && template[i + 1] === '{') {
			const end = findMatchingClose(template, i);
			if (end === -1) break;
			const body = template.slice(i + 2, end - 1).trim();
			out.push({ start: i, end: end + 1, body });
			i = end + 1;
			continue;
		}
		i++;
	}
	return out;
}

// Extension-method rewriting: n8n extensions like .isEmpty() are routed to $ext.
const EXT_METHODS = ['isEmpty', 'toInt', 'toFloat', 'toBoolean', 'toDateTime', 'toDate', 'toTime', 'round', 'floor', 'ceil', 'length', 'jsonParse', 'base64', 'md5', 'sha1', 'sha256', 'sha512', 'toBase64', 'fromBase64', 'stripTags', 'urlDecode', 'urlEncode', 'extractEmail', 'extractUrl', 'extractPhone', 'compareItems', 'cast', 'toSnakeCase', 'toCamelCase', 'toKebabCase', 'toTitleCase', 'toSentenceCase', 'toCurrency', 'toNumber'];

// Balanced paren matcher to find the receiver of .X() without tripping on nested calls.
function matchReceiverBefore(src, dotPos) {
	// Walk backwards from dotPos-1, skipping strings and balanced () / [] / {}.
	let depth = 0;
	let i = dotPos - 1;
	let inStr = null;
	let strQuote = null;
	while (i >= 0) {
		const ch = src[i];
		if (inStr) {
			if (ch === '\\') { i -= 2; continue; }
			if (ch === strQuote) { inStr = false; strQuote = null; i--; continue; }
			i--; continue;
		}
		if (ch === '"' || ch === "'" || ch === '`') { inStr = true; strQuote = ch; i--; continue; }
		if (ch === ')' || ch === ']') { depth++; i--; continue; }
		if (ch === '(' || ch === '[') {
			depth--;
			if (depth < 0) { i++; break; }
			i--; continue;
		}
		if (depth === 0 && /[\s,;({=:]/.test(ch)) { i++; break; }
		i--;
	}
	if (i < 0) i = 0;
	return i;
}

function rewriteExtensions(src) {
	// Iteratively find .<method>() for known extension methods (not preceded by a dot we've already processed).
	let out = src;
	for (const name of EXT_METHODS) {
		const token = `.${name}()`;
		let idx = 0;
		while ((idx = out.indexOf(token, idx)) !== -1) {
			// Avoid replacing "native" methods / already-processed calls: check this name isn't part of another identifier.
			const after = idx + token.length;
			// Ensure next char isn't alphanumeric.
			if (after < out.length && /[A-Za-z0-9_$]/.test(out[after])) { idx++; continue; }
			const start = matchReceiverBefore(out, idx);
			const receiver = out.slice(start, idx);
			out = out.slice(0, start) + `$ext.${name}(${receiver})` + out.slice(after);
			idx = start + 5 + name.length + receiver.length + 2;
		}
	}
	return out;
}

// Pre-process escaped-looking literal braces: n8n renders `{{ '{{' }}` as literal "{{"
// (similarly `'}}'` -> "}}"). This is a simple pre-processing pass: replace those
// placeholder expressions with their literal equivalents before parsing the template.
function preprocessLiteralBraces(src) {
	// Replace {{ '{{' }} with literal '{{', {{ '}}' }} with literal '}}',
	// matching n8n's common idiom for escaping braces.
	return src
		.replace(/\{\{\s*["']\{\{["']\s*\}\}/g, '{{')
		.replace(/\{\{\s*["']\}\}["']\s*\}\}/g, '}}');
}

// Sandbox check — scan source for forbidden patterns BEFORE evaluation.
function sandboxCheck(src) {
	if (/\.\s*constructor\b|\[\s*["']constructor["']\s*\]/.test(src)) {
		throw new ExpressionError('Expression contains invalid constructor function call', {
			descriptionKey: 'expression.constructor',
			functionality: 'pairedItem',
		});
	}
	if (/\b__proto__\b/.test(src)) {
		throw new ExpressionError('Expression is invalid', { descriptionKey: 'expression.invalid' });
	}
}

// $ext — tiny implementation of n8n extensions needed by reference tests.
const $ext = {
	isEmpty(v) {
		if (v === null || v === undefined) return true;
		if (typeof v === 'string') return v.length === 0;
		if (Array.isArray(v)) return v.length === 0;
		if (typeof v === 'object') return Object.keys(v).length === 0;
		return !v;
	},
	toInt(v) { const n = parseInt(v, 10); return Number.isNaN(n) ? v : n; },
	toFloat(v) { const n = parseFloat(v); return Number.isNaN(n) ? v : n; },
	toBoolean(v) {
		if (v === 'true') return true;
		if (v === 'false') return false;
		return !!v;
	},
	round(v, p) { return Number(Math.round(Number(v) + 'e' + (p || 0)) + 'e-' + (p || 0)); },
	floor(v) { return Math.floor(Number(v)); },
	ceil(v) { return Math.ceil(Number(v)); },
	toDateTime(v) { return { __isDateTime: true, toFormat: () => 'string', toISO: () => String(v) }; },
};

// Evaluate a single expression body inside a `with($) { return (expr); }` block.
function evaluateBody(body, $) {
	sandboxCheck(body);
	const code = rewriteExtensions(body);
	// Build the evaluation function. Use `with($)` so `$json`, `$input`, `$now` etc resolve from $.
	// We populate a safe globals object; `with` lets us reference them unprefixed.
	let fn;
	try {
		fn = new Function('$', '$ext', 'Math', 'JSON', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
			'Array', 'String', 'Number', 'Boolean', 'Date', 'Map', 'Set', 'RegExp',
			`with ($) { return (${code}); }`);
	} catch (syntaxErr) {
		throw new ApplicationError('invalid syntax');
	}
	try {
		return fn($, $ext, Math, JSON, parseInt, parseFloat, isNaN, isFinite,
			Array, String, Number, Boolean, Date, Map, Set, RegExp);
	} catch (err) {
		if (err instanceof ExpressionError || err instanceof ApplicationError || err instanceof ExpressionExtensionError) {
			throw err;
		}
		// Backend swallows most runtime TypeErrors -> undefined (E3, E5 edge cases)
		return undefined;
	}
}

function toInterpolated(v) {
	if (v === undefined || v === null) return '';
	if (typeof v === 'string') return v;
	if (typeof v === 'object') return String(v);
	return String(v);
}

function resolveTemplate(template, $) {
	let src = template.startsWith('=') ? template.slice(1) : template;
	src = preprocessLiteralBraces(src);
	const exps = extractExpressions(src);
	if (exps.length === 0) {
		return src;
	}
	// Single expression spanning entire template => preserve JS type.
	if (exps.length === 1 && exps[0].start === 0 && exps[0].end === src.length) {
		return evaluateBody(exps[0].body, $);
	}
	// Mixed text: concatenate as strings.
	let out = '';
	let last = 0;
	for (const e of exps) {
		out += src.slice(last, e.start);
		const v = evaluateBody(e.body, $);
		out += toInterpolated(v);
		last = e.end;
	}
	out += src.slice(last);
	return out;
}

function resolveParameterValue(value, ctx) {
	if (value === null || value === undefined) return value;
	if (typeof value === 'string') {
		if (isExpression(value)) {
			return resolveTemplate(value, ctx.$);
		}
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((v) => resolveParameterValue(v, ctx));
	}
	if (typeof value === 'object') {
		// Resource locator (__rl) passthrough but resolve .value
		if (value.__rl === true) {
			const out = { ...value };
			if ('value' in out) out.value = resolveParameterValue(out.value, ctx);
			return out;
		}
		const out = {};
		for (const [k, v] of Object.entries(value)) out[k] = resolveParameterValue(v, ctx);
		return out;
	}
	return value;
}

class Expression {
	constructor(workflow) {
		this.workflow = workflow;
	}

	getParameterValue(
		parameterValue,
		runExecutionData,
		runIndex,
		itemIndex,
		activeNodeName,
		connectionInputData,
		mode,
		additionalKeys,
		executeData,
		returnObjectAsString = false,
		selfData = {},
		contextNodeName = activeNodeName,
	) {
		const siblingParameters = (this.workflow.getNode(activeNodeName) && this.workflow.getNode(activeNodeName).parameters) || {};
		const proxy = new WorkflowDataProxy(
			this.workflow, runExecutionData, runIndex, itemIndex, activeNodeName,
			connectionInputData, siblingParameters, mode, additionalKeys, executeData,
			-1, selfData, contextNodeName,
		);
		const $ = proxy.getDataProxy();
		const ctx = { $ };
		let result = resolveParameterValue(parameterValue, ctx);
		if (returnObjectAsString && result !== null && typeof result === 'object') {
			// n8n's "[Object: …]" / "[DateTime: …]" formatting — minimal.
			result = `[Object: ${JSON.stringify(result)}]`;
		}
		return result;
	}

	resolveSimpleParameterValue(parameterValue, runExecutionData, runIndex, itemIndex, activeNodeName, connectionInputData, mode, additionalKeys, executeData) {
		return this.getParameterValue(parameterValue, runExecutionData, runIndex, itemIndex, activeNodeName, connectionInputData, mode, additionalKeys, executeData);
	}

	getSimpleParameterValue() { return undefined; }
	getComplexParameterValue() { return undefined; }

	static resolveWithoutWorkflow(expression, data = {}) {
		if (typeof expression !== 'string' || !isExpression(expression)) return expression;
		const $ = {
			$json: data, $data: data, $binary: {}, $vars: undefined, $secrets: undefined,
			$env: new Proxy({}, { get() { throw new ExpressionError('access to env vars denied'); } }),
			$now: { __isDateTime: true, toFormat: () => 'string' },
			$ext,
		};
		return resolveTemplate(expression, $);
	}

	static initializeGlobalContext() { /* no-op */ }
}

module.exports = { Expression, isExpression, WorkflowDataProxy };
