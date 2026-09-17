export class ApplicationError extends Error {
	constructor(message, options = {}) {
		super(message);
		this.name = this.constructor.name;
		this.extra = options.extra;
		if (options.cause) this.cause = options.cause;
	}
}

export class NodeOperationError extends ApplicationError {
	constructor(message, options = {}) {
		super(message, options);
	}
}
