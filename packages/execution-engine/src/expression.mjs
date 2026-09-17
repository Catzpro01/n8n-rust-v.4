/**
 * Node parameter resolution + expression evaluation (subset).
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/workflow/src/expression.ts        (isExpression / resolveSimpleParameterValue)
 *   reference/n8n/packages/core/src/execution-engine/node-execution-context/base-execute-context.ts (getNodeParameter)
 *
 * SUBSET — documented in contracts/expression.contract.md and
 * docs/isolation/execution.md §"Known deltas":
 *   - `=`-prefixed strings resolve `={{ ... }}` templates, including mixed text.
 *   - Evaluation runs in a fresh node:vm context with code generation disabled,
 *     a read-only execution-data membrane, a prototype/global deny-list, and a
 *     bounded synchronous timeout. This reconstructs the upstream security
 *     invariants without importing the upstream tournament/JEXL dependencies.
 *   - Multi-statement expressions, `$variables`, `$secrets` and the Luxon surface
 *     beyond the shim in data-proxy.mjs are not implemented.
 */

import { ApplicationError } from './errors.mjs';
import { ExpressionSandboxError, runExpressionInSandbox } from './expression-sandbox.mjs';

export class ExpressionError extends ApplicationError {
	constructor(message, options = {}) {
		super(message, options);
		this.name = 'ExpressionError';
		this.description = options.description ?? 'Expression could not be evaluated';
		if (options.code !== undefined) this.code = options.code;
	}
}

const TEMPLATE_PATTERN = /{{([\s\S]*?)}}/g;

/** `isExpression()` — a string that starts with `=` is an expression upstream. */
export function isExpression(value) {
	return typeof value === 'string' && value.startsWith('=');
}

/**
 * `resolveSimpleParameterValue()` subset: evaluate `={{ ... }}` / `=expression`
 * and leave everything else untouched.
 */
export function evaluateExpressionValue(rawValue, scope, { itemIndex = 0 } = {}) {
	if (!isExpression(rawValue)) return rawValue;

	const code = rawValue.slice(1);
	const matches = [...code.matchAll(TEMPLATE_PATTERN)];

	// Pure single expression → the evaluated value keeps its type. Checking the
	// match boundaries avoids treating `{{ a }} {{ b }}` as one greedy expression.
	if (
		matches.length === 1 &&
		code.slice(0, matches[0].index).trim() === '' &&
		code.slice(matches[0].index + matches[0][0].length).trim() === ''
	) {
		return evaluateCode(matches[0][1], scope, { itemIndex });
	}

	// Mixed template → string interpolation. Upstream JavaScript coercion turns
	// objects into "[object Object]" rather than serialising them as JSON.
	return code.replace(TEMPLATE_PATTERN, (_match, expression) => {
		const value = evaluateCode(expression, scope, { itemIndex });
		if (value === undefined || value === null) return '';
		return String(value);
	});
}

/**
 * Evaluates one synchronous expression in an isolated node:vm context. The
 * context has no process/module loader, disables string/wasm code generation,
 * enforces a short timeout, and wraps execution data in a read-only membrane.
 */
export function evaluateCode(code, scope = {}, { itemIndex = 0, timeoutMs = 100 } = {}) {
	try {
		return runExpressionInSandbox(code, scope, { timeoutMs });
	} catch (error) {
		throw new ExpressionError(
			`[item ${itemIndex}] ${error.message}`,
			{
				description: `Error evaluating expression "${code.trim()}"`,
				cause: error,
				...(error instanceof ExpressionSandboxError ? { code: error.code } : {}),
			},
		);
	}
}

/**
 * `resolveParameterValue()` — recursively resolve expressions inside parameter
 * values (objects and arrays included), which is what makes nested node
 * parameters (`values.string[].value`) work.
 */
export function resolveParameterValue(value, scope, options = {}) {
	if (typeof value === 'string') return evaluateExpressionValue(value, scope, options);
	if (Array.isArray(value)) return value.map((entry) => resolveParameterValue(entry, scope, options));

	if (value !== null && typeof value === 'object' && value.constructor === Object) {
		const resolved = {};
		for (const [key, entry] of Object.entries(value)) {
			resolved[key] = resolveParameterValue(entry, scope, options);
		}
		return resolved;
	}

	return value;
}
