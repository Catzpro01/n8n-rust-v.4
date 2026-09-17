/**
 * Expression LEGO — error taxonomy.
 * 1:1 behavioral port of n8n-workflow 2.9.4:
 *   src/errors/abstract/execution-base.error.ts
 *   src/errors/expression.error.ts
 *   src/errors/expression-extension.error.ts
 *   src/errors/expression-sandboxing.error.ts (class/with/destructuring/reserved)
 *
 * `context` fields are part of the public contract (contracts/expression.contract.md §6)
 * and are asserted verbatim by the golden reference tests.
 */

const ALLOWED_CONTEXT_KEYS = new Set([
	'causeDetailed',
	'descriptionTemplate',
	'descriptionKey',
	'itemIndex',
	'messageTemplate',
	'nodeCause',
	'parameter',
	'runIndex',
	'type',
]);

export class ExecutionBaseError extends Error {
	constructor(message, options = {}) {
		super(message);
		this.name = this.constructor.name;
		this.level = options.level ?? 'warning';
		this.timestamp = new Date().toISOString();
		this.context = {};
		if (options.cause !== undefined) this.cause = options.cause;
	}
}

export class ExpressionError extends ExecutionBaseError {
	constructor(message, options = {}) {
		super(message, { cause: options?.cause, level: 'warning' });
		if (options?.description !== undefined) this.description = options.description;
		if (options?.functionality !== undefined) this.functionality = options.functionality;
		if (options) {
			for (const key of Object.keys(options)) {
				if (ALLOWED_CONTEXT_KEYS.has(key)) this.context[key] = options[key];
			}
		}
	}
}

/** n8n @n8n/errors ApplicationError (as used by expression.ts). */
export class ApplicationError extends ExecutionBaseError {
	constructor(message, options = {}) {
		super(message, { level: options?.level ?? 'error', cause: options?.cause });
		if (options?.extra !== undefined) this.extra = options.extra;
	}
}

export class ExpressionExtensionError extends ExecutionBaseError {
	constructor(message, functionName, options = {}) {
		super(message, { cause: options?.cause, level: 'warning' });
		if (functionName !== undefined) this.functionality = functionName;
		if (options) {
			for (const key of Object.keys(options)) {
				if (ALLOWED_CONTEXT_KEYS.has(key)) this.context[key] = options[key];
			}
		}
	}
}

export class ExpressionClassExtensionError extends ExpressionError {
	constructor(baseClassName) {
		super(`Class extends "${baseClassName}" is not allowed`, {
			description:
				'Extending this class is not allowed in expressions for security reasons. Please remove the extends clause.',
		});
	}
}

export class ExpressionWithStatementError extends ExpressionError {
	constructor() {
		super('Using "with" statements is not allowed', {
			description: 'The with statement is not allowed in expressions for security reasons.',
		});
	}
}

export class ExpressionDestructuringError extends ExpressionError {
	constructor(keyName) {
		super(`Destructuring "${keyName}" is not allowed`, {
			description: `Destructuring the property "${keyName}" is not allowed in expressions for security reasons.`,
		});
	}
}

export class ExpressionComputedDestructuringError extends ExpressionError {
	constructor() {
		super('Computed destructuring is not allowed', {
			description: 'Computed destructuring is not allowed in expressions for security reasons.',
		});
	}
}

export class ExpressionReservedVariableError extends ExpressionError {
	constructor(variableName) {
		super(`Reserved variable "${variableName}" cannot be used`, {
			description: `The name "${variableName}" is reserved for internal use and cannot be used in expressions.`,
		});
	}
}
