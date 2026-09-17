/**
 * Expression predicate — verbatim reconstruction of
 * `reference/n8n/packages/workflow/src/expressions/expression-helpers.ts` L1-10.
 *
 * Boundary note: the Node Model only *detects* expression strings (to strip the
 * leading `=` for `noDataExpression` parameters and to skip validation of
 * expressions); it never evaluates them — evaluation stays in the expressions
 * LEGO. `isExpression` is therefore the whole expressions surface this package owns.
 */

/**
 * Checks if the given value is an expression. An expression is a string that
 * starts with '='.
 */
export const isExpression = (expr) => {
	if (typeof expr !== 'string') return false;

	return expr.charAt(0) === '=';
};
