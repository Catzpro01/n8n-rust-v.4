export class ApplicationError extends Error {
	constructor(message, options = {}) {
		super(message);
		this.name = this.constructor.name;
		this.extra = options.extra;
		if (options.cause) this.cause = options.cause;
	}
}

export class CredentialDataError extends ApplicationError {
	constructor(credentials, message, cause) {
		super(message, {
			extra: credentials
				? { name: credentials.name, type: credentials.type, id: credentials.id }
				: undefined,
			cause,
		});
	}
}

export class CredentialNotFoundError extends ApplicationError {
	constructor(identifier, type) {
		super(
			type
				? `Credential with ID "${identifier}" does not exist for type "${type}"`
				: `Credential with ID "${identifier}" could not be found.`,
			{ extra: { identifier, type } },
		);
		this.httpStatusCode = 404;
	}
}

export class NodeOperationError extends ApplicationError {
	constructor(message, options = {}) {
		super(message, options);
	}
}
