/**
 * Error types thrown by the Workflow aggregate.
 *
 * Two distinct reference sources, reconstructed structurally because this LEGO is dependency-free
 * (pulling `@n8n/errors` in would add a runtime dependency; `tools/execution-engine-gate.mjs`
 * gate `E01` asserts that posture for the execution LEGO and this package follows it):
 *
 * | type | reference source |
 * | :--- | :--- |
 * | `UserError` | `reference/n8n/packages/workflow/src/errors/base/user.error.ts` → `base.error.ts` |
 * | `ApplicationError` | `reference/n8n/packages/@n8n/errors/src/application.error.ts` |
 *
 * **Neither reference class assigns `this.name`.** Both therefore report the inherited
 * `name === 'Error'`, while `constructor.name` stays the class name. That split is observable and
 * pinned: `tests/reference/workflow-rust/fixtures.json` records
 * `errorName: error.constructor?.name` (`build-fixtures.mjs:255`), and the differential in
 * `test/static-data-queries.test.mjs` compares `error.name` against the published build — which is
 * exactly what caught an earlier version of this file setting `name` to the class name.
 *
 * One documented substitution: both reference constructors derive `tags.packageName` from
 * `callsites()[2].getFileName()`. That needs the `callsites` package and reads the *caller's*
 * path, so it is not reproduced; no fixture or differential observes it.
 */

export interface BaseErrorOptions {
	description?: string | null;
	level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
	shouldReport?: boolean;
	tags?: Record<string, string | undefined>;
	extra?: Record<string, unknown>;
	cause?: unknown;
}

/** `reference/n8n/packages/workflow/src/errors/base/base.error.ts:34-60`. */
abstract class BaseError extends Error {
	level: 'fatal' | 'error' | 'warning' | 'info' | 'debug';

	readonly shouldReport: boolean;

	readonly description: string | null | undefined;

	readonly tags: Record<string, string | undefined>;

	readonly extra?: Record<string, unknown>;

	constructor(
		message: string,
		{
			level = 'error',
			description,
			shouldReport,
			tags = {},
			extra,
			...rest
		}: BaseErrorOptions = {},
	) {
		super(message, rest as { cause?: unknown });

		this.level = level;
		this.shouldReport = shouldReport ?? (level === 'error' || level === 'fatal');
		this.description = description;
		this.tags = tags;
		this.extra = extra;
	}
}

/**
 * Thrown by `Workflow.renameNode` for the 13 restricted names.
 *
 * `reference/.../user.error.ts:16-25`: `UserError` forces `level` to `'info'` when the caller did
 * not set one, which — through `BaseError` — makes `shouldReport` default to `false`. Both are
 * observable fields, so both are reproduced.
 */
export class UserError extends BaseError {
	declare readonly description: string | null | undefined;

	constructor(message: string, opts: BaseErrorOptions = {}) {
		super(message, { ...opts, level: opts.level ?? 'info' });
		Object.setPrototypeOf(this, UserError.prototype);
	}
}

/**
 * Thrown by `getParentMainInputNode` (a connected node it resolved by name is missing) and by
 * `getStaticData` (unknown context type, or `'node'` without a node).
 *
 * `reference/n8n/packages/@n8n/errors/src/application.error.ts:9-32`: `level` defaults to
 * `'error'`, `tags` defaults to `{}`, `extra` is carried through, and `this.name` is never set.
 */
export class ApplicationError extends Error {
	level: 'fatal' | 'error' | 'warning' | 'info' | 'debug';

	readonly tags: Record<string, string | undefined>;

	readonly extra?: Record<string, unknown>;

	constructor(message: string, { level, tags = {}, extra, ...rest }: BaseErrorOptions = {}) {
		super(message, rest as { cause?: unknown });
		this.level = level ?? 'error';
		this.tags = tags;
		this.extra = extra;
		Object.setPrototypeOf(this, ApplicationError.prototype);
	}
}
