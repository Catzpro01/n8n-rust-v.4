/**
 * Error type used by `Workflow.renameNode` for restricted node names.
 *
 * The reference imports `UserError` from `@n8n/errors`
 * (`reference/n8n/packages/workflow/src/workflow.ts:18` → `./errors` → `@n8n/errors`).
 * `error.constructor.name` is observable — the `rename/restricted-*` fixtures record
 * `errorName: "UserError"` — so the class **name** is part of the contract, not just the message.
 *
 * This is a structural reconstruction (message + `description` option), not a re-export, because
 * pulling `@n8n/errors` in would give this LEGO a runtime dependency; the Phase-3 JavaScript
 * track is dependency-free (`tools/execution-engine-gate.mjs` gate `E01` asserts that posture for
 * the execution LEGO, and this package follows it).
 */
export interface UserErrorOptions {
	description?: string;
	level?: string;
	cause?: unknown;
	[key: string]: unknown;
}

export class UserError extends Error {
	readonly description: string | undefined;

	readonly level: string | undefined;

	constructor(message: string, options: UserErrorOptions = {}) {
		super(message);
		this.name = 'UserError';
		this.description = options.description;
		this.level = options.level;
		// Keep `instanceof` and stack traces correct on every supported runtime.
		Object.setPrototypeOf(this, UserError.prototype);
	}
}
