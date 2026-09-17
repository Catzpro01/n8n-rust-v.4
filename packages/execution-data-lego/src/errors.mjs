/**
 * Execution Data LEGO — error surface.
 *
 * 1:1 reconstruction of `@n8n/errors` `ApplicationError` as used by the
 * reconstructed helpers
 * (`packages/core/src/execution-engine/node-execution-context/utils/normalize-items.ts:2`).
 * Ported from `@n8n/errors/dist/application.error.js` (2.9.x) rather than
 * re-imagined, because the class carries two non-obvious behaviours that
 * callers and tests can observe.
 *
 * FROZEN QUIRK (E-01): `name` is NOT assigned, so `err.name` stays `'Error'`
 * even though the class is `ApplicationError`. Anything matching on the class
 * name is therefore wrong in n8n 2.9.4.
 *
 * FROZEN QUIRK (E-02): the constructor stamps `tags.packageName` from the
 * CALLER's file path by regex-matching `packages/([^/]+)/` two frames up
 * (`callsites()[2]`), wrapped in a silent `try {} catch {}`.
 *   - called from `packages/core/...`        -> `tags.packageName === 'core'`
 *   - called from `packages/execution-data-lego/...` -> 'execution-data-lego'
 *   - called from anywhere else               -> the tag is simply absent
 * The tag is DIAGNOSTIC, not behavioural: it is part of the error contract
 * (test/06-parity compares it), so it is reproduced rather than dropped.
 *
 * FROZEN QUIRK (E-03): `extra` is always assigned, so it is an own enumerable
 * key even when it is `undefined`.
 */

/**
 * File name of the frame two levels above the error construction — the exact
 * frame `callsites()[2].getFileName()` returns inside
 * `@n8n/errors/ApplicationError`.
 *
 * `Error.captureStackTrace(holder, ApplicationError)` hides every frame from
 * the top down to and including the `ApplicationError` constructor, so:
 *   frames[0] = the function that threw (e.g. `normalizeItems`)
 *   frames[1] = its caller                  == `callsites()[2]`
 */
function callerFileName(ctor) {
	const originalPrepare = Error.prepareStackTrace;
	const originalLimit = Error.stackTraceLimit;
	try {
		Error.prepareStackTrace = (_error, frames) => frames;
		Error.stackTraceLimit = 8;
		const holder = {};
		Error.captureStackTrace(holder, ctor);
		const frames = /** @type {Array<{ getFileName: () => string | undefined }>} */ (holder.stack);
		return frames?.[1]?.getFileName?.() ?? '';
	} catch {
		return '';
	} finally {
		Error.prepareStackTrace = originalPrepare;
		Error.stackTraceLimit = originalLimit;
	}
}

export class ApplicationError extends Error {
	constructor(message, { level, tags = {}, extra, ...rest } = {}) {
		super(message, rest);

		this.level = level ?? 'error';
		this.tags = tags;
		this.extra = extra;

		try {
			const filePath = callerFileName(ApplicationError);
			const match = /packages\/([^/]+)\//.exec(filePath)?.[1];
			if (match) {
				this.tags.packageName = match;
			}
		} catch {
			// the upstream constructor swallows every failure here
		}
	}

	/**
	 * Structural comparison helper: true when `value` carries the
	 * ApplicationError contract (message + level + tags).
	 */
	static isApplicationError(value) {
		return (
			value instanceof Error &&
			typeof value.level === 'string' &&
			typeof value.tags === 'object' &&
			value.tags !== null
		);
	}
}

/**
 * Thrown by `migrateRunExecutionData` for a version outside {0, 1}.
 * 1:1 with packages/workflow/src/run-execution-data/run-execution-data.ts:36-38
 * — note it is a plain `Error`, not an `ApplicationError`.
 */
export class UnsupportedRunExecutionDataVersionError extends Error {
	constructor(version) {
		super(`Unsupported IRunExecutionData version: ${version}`);
	}
}
