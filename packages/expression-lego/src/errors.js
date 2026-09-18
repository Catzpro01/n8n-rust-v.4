'use strict';
/**
 * Expression error hierarchy — matches contracts/expression.contract.md §6.
 *
 * Mirrors n8n@2.9.4:
 *   packages/workflow/src/errors/expression.error.ts
 *   packages/workflow/src/errors/expression-extension.error.ts
 *   @n8n/errors ApplicationError
 */

class ExpressionError extends Error {
	constructor(message, context = {}) {
		super(message);
		this.name = 'ExpressionError';
		this.context = {
			functionality: 'pairedItem',
			...context,
		};
		// Sugar accessors so callers can read e.type / e.descriptionKey etc directly.
		for (const k of Object.keys(this.context)) {
			if (!(k in this)) this[k] = this.context[k];
		}
	}
}

class ExpressionExtensionError extends ExpressionError {
	constructor(message, ctx) {
		super(message, ctx);
		this.name = 'ExpressionExtensionError';
	}
}

class ApplicationError extends Error {
	constructor(message, ctx = {}) {
		super(message);
		this.name = 'ApplicationError';
		this.context = ctx;
	}
}

module.exports = { ExpressionError, ExpressionExtensionError, ApplicationError };
