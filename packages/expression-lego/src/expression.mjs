/**
 * Expression LEGO — Expression class + evaluator.
 * 1:1 behavioral port of n8n-workflow 2.9.4 src/expression.ts,
 * src/expression-evaluator-proxy.ts, src/expressions/expression-helpers.ts.
 *
 * The reference evaluates with @n8n/tournament (esprima AST → generated code,
 * identifier polyfills via a data-context lookup). This reconstruction
 * evaluates with a `with(...)` scope bound to the very same data proxy — the
 * observable behavior is identical: unqualified identifiers resolve against
 * the data context first, unknown ones read as `undefined`, runtime TypeErrors
 * are swallowed by the error handler (backend), compile-time SyntaxErrors
 * become ApplicationError('invalid syntax').
 *
 * Contract: contracts/expression.contract.md §3/§5/§6.
 */

import { ApplicationError, ExpressionError, ExpressionExtensionError } from './errors.mjs';
import {
	extend,
	extendOptional,
	extendedFunctions,
	extendSyntax,
	hasExpressionExtension,
} from './extensions.mjs';
import { assertExpressionSourceIsSafe, initializeGlobalContext, sanitizer } from './sandbox.mjs';
import { WorkflowDataProxy } from './data-proxy.mjs';
import { getGlobalState } from './support.mjs';
import { DateTime } from 'luxon';

const IS_FRONTEND = false; // backend runtime (expression.ts: typeof process !== 'undefined')

const isSyntaxError = (error) =>
	error instanceof SyntaxError || (error instanceof Error && error.name === 'SyntaxError');

const isExpressionError = (error) =>
	error instanceof ExpressionError || error instanceof ExpressionExtensionError;

const isTypeError = (error) =>
	error instanceof TypeError || (error instanceof Error && error.name === 'TypeError');

/**
 * expression-evaluator-proxy.ts setErrorHandler — ExpressionErrors are forwarded.
 * Returns true when the error was swallowed (evaluation continues with undefined).
 */
const errorHandler = (error) => {
	if (isExpressionError(error)) throw error;
	return true;
};

/**
 * The evaluator (expression-evaluator-proxy.ts evaluateExpression).
 * Renders a `{{ ... }}` template against `data`:
 *  - exactly one expression spanning the whole template ⇒ raw JS value
 *  - otherwise ⇒ concatenated string (null/undefined → '', objects → String(v))
 */
export function evaluateExpression(expression, data) {
	const parts = splitTemplate(expression);

	if (parts.length === 1 && parts[0].type === 'expression') {
		return evaluatePart(parts[0].code, data);
	}

	if (parts.length === 1 && parts[0].type === 'text') {
		return parts[0].code;
	}

	let out = '';
	for (const part of parts) {
		if (part.type === 'text') {
			out += part.code;
		} else {
			const value = evaluatePart(part.code, data);
			out += renderItem(value);
		}
	}
	return out;
}

/** Tournament's string rendering of interpolated values. */
function renderItem(value) {
	if (typeof value === 'string') return value;
	if (value === undefined || value === null) return '';
	if (typeof value === 'object') return String(value); // [object Object] / DateTime.toString()
	return String(value);
}

/** Split `a {{ b }} c` into text/expression chunks (quote-aware). */
function splitTemplate(expression) {
	const parts = [];
	let text = '';
	let i = 0;
	const n = expression.length;
	while (i < n) {
		if (expression[i] === '{' && expression[i + 1] === '{') {
			if (text) {
				parts.push({ type: 'text', code: text });
				text = '';
			}
			i += 2;
			let code = '';
			let inStr = null;
			let closed = false;
			while (i < n) {
				const c = expression[i];
				if (inStr) {
					code += c;
					if (c === '\\') {
						code += expression[i + 1] ?? '';
						i += 2;
						continue;
					}
					if (c === inStr) inStr = null;
					i++;
					continue;
				}
				if (c === '"' || c === "'" || c === '`') {
					inStr = c;
					code += c;
					i++;
					continue;
				}
				if (c === '}' && expression[i + 1] === '}') {
					closed = true;
					i += 2;
					break;
				}
				code += c;
				i++;
			}
			if (!closed) {
				// unterminated template → treat the remainder as text (reference: parse yields text)
				text += '{{' + code;
				break;
			}
			parts.push({ type: 'expression', code: code.trim() });
			continue;
		}
		text += expression[i];
		i++;
	}
	if (text) parts.push({ type: 'text', code: text });
	return parts;
}

/**
 * Compile + run one expression chunk with the data proxy as the only scope.
 * Mirrors tournament + setErrorHandler semantics:
 *  - compile SyntaxError → thrown (renderExpression maps to ApplicationError)
 *  - runtime errors: ExpressionError rethrown, everything else swallowed → undefined
 *
 * The `with` scope is the only body content (no helpers inside it — with-object
 * properties shadow function parameters), and the error handler lives outside
 * so it can never be shadowed by the data proxy.
 */
function evaluatePart(code, data) {
	if (code === '') return undefined;
	let compiled;
	try {
		compiled = new Function('___n8n_data', `with (___n8n_data) { return (${code}); }`);
	} catch (error) {
		// Reference: tournament evaluates the whole program (statements allowed,
		// completion value of the last expression statement is the result). This
		// reconstruction falls back to statement mode when the leaf is not a pure
		// expression; the completion value of non-expression statements is
		// undefined — matching a program that ends in a declaration.
		if (!errorHandler(error)) throw error;
		if (isSyntaxError(error)) {
			try {
				compiled = new Function('___n8n_data', `with (___n8n_data) { ${code} }`);
			} catch (statementError) {
				errorHandler(statementError);
				throw statementError; // renderExpression maps SyntaxError → invalid syntax
			}
		} else {
			throw error;
		}
	}
	try {
		return compiled(data);
	} catch (error) {
		if (errorHandler(error)) return undefined;
		throw error;
	}
}

export class Expression {
	constructor(workflow) {
		this.workflow = workflow;
	}

	static initializeGlobalContext(data) {
		initializeGlobalContext(data);
	}

	static resolveWithoutWorkflow(expression, data = {}) {
		return evaluateExpression(expression, data);
	}

	/** expression.ts convertObjectValueToString */
	convertObjectValueToString(value) {
		if (DateTime.isDateTime(value) && value.invalidReason !== null) {
			throw new ApplicationError('invalid DateTime');
		}

		if (value === null) {
			return 'null';
		}

		let typeName = value?.constructor?.name ?? 'Object';
		if (DateTime.isDateTime(value)) {
			typeName = 'DateTime';
		}

		let result;
		if (value instanceof Date) {
			result = value.toISOString();
		} else if (DateTime.isDateTime(value)) {
			result = value.toString();
		} else {
			result = JSON.stringify(value);
		}

		result = result.replace(/,"/g, ', "').replace(/":/g, '": ');

		return `[${typeName}: ${result}]`;
	}

	/** expression.ts resolveSimpleParameterValue */
	resolveSimpleParameterValue(
		parameterValue,
		siblingParameters,
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
		contextNodeName,
	) {
		if (typeof parameterValue !== 'string' || parameterValue.charAt(0) !== '=') {
			return parameterValue;
		}

		parameterValue = parameterValue.substr(1);

		const dataProxy = new WorkflowDataProxy(
			this.workflow,
			runExecutionData,
			runIndex,
			itemIndex,
			activeNodeName,
			connectionInputData,
			siblingParameters,
			mode,
			additionalKeys,
			executeData,
			-1,
			selfData,
			contextNodeName,
		);
		const data = dataProxy.getDataProxy();

		// Support only a subset of process properties
		data.process =
			typeof process !== 'undefined'
				? {
						arch: process.arch,
						env: process.env.N8N_BLOCK_ENV_ACCESS_IN_NODE !== 'false' ? {} : process.env,
						platform: process.platform,
						pid: process.pid,
						ppid: process.ppid,
						release: process.release,
						version: process.pid,
						versions: process.versions,
					}
				: {};

		Expression.initializeGlobalContext(data);

		// expression extensions
		data.extend = extend;
		data.extendOptional = extendOptional;
		Object.defineProperty(data, '__extend', { value: extend, writable: false, configurable: false });
		Object.defineProperty(data, '__n8n', { value: { $if: (t, c, a) => (t ? c : a) }, writable: false, configurable: false });
		Object.defineProperty(data, '__sanitize', { value: sanitizer, writable: false, configurable: false });

		Object.assign(data, extendedFunctions);

		const constructorValidation = new RegExp(/\.(\s|\n)*constructor/gm);
		if (parameterValue.match(constructorValidation)) {
			throw new ExpressionError('Expression contains invalid constructor function call', {
				causeDetailed: 'Constructor override attempt is not allowed due to security concerns',
				runIndex,
				itemIndex,
			});
		}

		// Sandbox source checks (AST-hook equivalents) — after the constructor
		// regex so error precedence matches the reference for that vector.
		assertExpressionSourceIsSafe(parameterValue);

		// Execute the expression
		const extendedExpression = extendSyntax(parameterValue);
		const returnValue = this.renderExpression(extendedExpression, data);
		if (typeof returnValue === 'function') {
			if (returnValue.name === 'DateTime') {
				throw new ApplicationError('this is a DateTime, please access its methods');
			}
			throw new ApplicationError('this is a function, please add ()');
		} else if (typeof returnValue === 'string') {
			return returnValue;
		} else if (returnValue !== null && returnValue !== undefined && typeof returnValue === 'object') {
			if (returnObjectAsString) {
				return this.convertObjectValueToString(returnValue);
			}
		}

		return returnValue;
	}

	/** expression.ts renderExpression */
	renderExpression(expression, data) {
		try {
			return evaluateExpression(expression, data);
		} catch (error) {
			if (isExpressionError(error)) throw error;

			if (isSyntaxError(error)) throw new ApplicationError('invalid syntax');

			if (isTypeError(error) && IS_FRONTEND && error.message.endsWith('is not a function')) {
				const match = error.message.match(/(?<msg>[^.]+is not a function)/);
				if (!match?.groups?.msg) return null;
				throw new ApplicationError(match.groups.msg);
			}
		}

		return null;
	}

	/** expression.ts getSimpleParameterValue */
	getSimpleParameterValue(node, parameterValue, mode, additionalKeys, executeData, defaultValue) {
		if (parameterValue === undefined) return defaultValue;

		const runIndex = 0;
		const itemIndex = 0;
		const connectionInputData = [];
		const runData = createEmptyRunExecutionData();

		return this.getParameterValue(
			parameterValue,
			runData,
			runIndex,
			itemIndex,
			node.name,
			connectionInputData,
			mode,
			additionalKeys,
			executeData,
		);
	}

	/** expression.ts getComplexParameterValue */
	getComplexParameterValue(
		node,
		parameterValue,
		mode,
		additionalKeys,
		executeData,
		defaultValue = undefined,
		selfData = {},
	) {
		if (parameterValue === undefined) return defaultValue;

		const runIndex = 0;
		const itemIndex = 0;
		const connectionInputData = [];
		const runData = createEmptyRunExecutionData();

		const returnData = this.getParameterValue(
			parameterValue,
			runData,
			runIndex,
			itemIndex,
			node.name,
			connectionInputData,
			mode,
			additionalKeys,
			executeData,
			false,
			selfData,
		);

		return this.getParameterValue(
			returnData,
			runData,
			runIndex,
			itemIndex,
			node.name,
			connectionInputData,
			mode,
			additionalKeys,
			executeData,
			false,
			selfData,
		);
	}

	/** expression.ts getParameterValue */
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
		contextNodeName,
	) {
		const isComplexParameter = (value) => typeof value === 'object' && value !== null;

		const resolveParameterValue = (value, siblingParameters) => {
			if (Array.isArray(value) || isComplexParameter(value)) {
				return this.getParameterValue(
					value,
					runExecutionData,
					runIndex,
					itemIndex,
					activeNodeName,
					connectionInputData,
					mode,
					additionalKeys,
					executeData,
					returnObjectAsString,
					selfData,
					contextNodeName,
				);
			}

			return this.resolveSimpleParameterValue(
				value,
				siblingParameters,
				runExecutionData,
				runIndex,
				itemIndex,
				activeNodeName,
				connectionInputData,
				mode,
				additionalKeys,
				executeData,
				returnObjectAsString,
				selfData,
				contextNodeName,
			);
		};

		if (!isComplexParameter(parameterValue) && !Array.isArray(parameterValue)) {
			return this.resolveSimpleParameterValue(
				parameterValue,
				{},
				runExecutionData,
				runIndex,
				itemIndex,
				activeNodeName,
				connectionInputData,
				mode,
				additionalKeys,
				executeData,
				returnObjectAsString,
				selfData,
				contextNodeName,
			);
		}

		if (Array.isArray(parameterValue)) {
			const returnData = parameterValue.map((item) => resolveParameterValue(item, {}));
			return returnData;
		}

		if (parameterValue === null || parameterValue === undefined) {
			return parameterValue;
		}

		if (typeof parameterValue !== 'object') {
			return {};
		}

		const returnData = {};
		for (const [key, value] of Object.entries(parameterValue)) {
			returnData[key] = resolveParameterValue(value, parameterValue);
		}

		if (returnObjectAsString && typeof returnData === 'object') {
			return this.convertObjectValueToString(returnData);
		}

		return returnData;
	}
}

/** run-execution-data-factory.ts createEmptyRunExecutionData */
export function createEmptyRunExecutionData() {
	return { resultData: { runData: {} }, executionData: {} };
}

export { hasExpressionExtension, getGlobalState };
export const isExpression = (expr) => typeof expr === 'string' && expr.charAt(0) === '=';
