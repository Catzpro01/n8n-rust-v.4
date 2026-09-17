/**
 * Node parameter resolution + expression evaluation (subset).
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/workflow/src/expression.ts        (isExpression / resolveSimpleParameterValue)
 *   reference/n8n/packages/core/src/execution-engine/node-execution-context/base-execute-context.ts (getNodeParameter)
 *
 * SUBSET — documented in contracts/expression.contract.md and
 * docs/isolation/execution.md §"Known deltas":
 *   - `=`-prefixed strings are evaluated as JavaScript expressions
 *     (`={{ ... }}` templates are supported, including mixed text+expressions).
 *   - The upstream sandbox (tourney/JEXL, `expression-sandboxing.ts`, allow-listed
 *     prototypes) is NOT part of this reconstruction yet. Expression input comes
 *     from workflow authors, exactly as it does upstream, but this subset must not
 *     be pointed at untrusted workflows until the sandbox LEGO lands.
 *   - Multi-statement expressions, `$variables`, `$secrets` and the Luxon surface
 *     beyond the shim in data-proxy.mjs are not implemented.
 */

import { ApplicationError } from './errors.mjs';

export class ExpressionError extends ApplicationError {
	constructor(message, options = {}) {
		super(message, options);
		this.name = 'ExpressionError';
		this.description = options.description ?? 'Expression could not be evaluated';
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

	// Pure single expression → the evaluated value keeps its type.
	const single = code.match(/^\s*{{([\s\S]*)}}\s*$/);
	if (single) return evaluateCode(single[1], scope, { itemIndex });

	// Mixed template → string interpolation.
	return code.replace(TEMPLATE_PATTERN, (_match, expression) => {
		const value = evaluateCode(expression, scope, { itemIndex });
		if (value === undefined || value === null) return '';
		if (typeof value === 'object') return JSON.stringify(value);
		return String(value);
	});
}

/**
 * Evaluates one JavaScript expression against the data-proxy scope.
 * Parameters (not `with`) keep the code in strict mode; the scope keys are
 * exactly the `$…` variables the data proxy exposes — same surface upstream
 * injects into the JEXL context.
 */
export function evaluateCode(code, scope = {}, { itemIndex = 0 } = {}) {
	const names = Object.keys(scope);
	const values = names.map((name) => scope[name]);

	try {
		// eslint-disable-next-line no-new-func
		const fn = new Function(...names, `"use strict"; return (${code});`);
		return fn(...values);
	} catch (error) {
		throw new ExpressionError(
			`[item ${itemIndex}] ${error.message}`,
			{ description: `Error evaluating expression "${code.trim()}"`, cause: error },
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
