/**
 * Shared fakes for the Scheduler LEGO tests.
 *
 * `FakeCronJob` mirrors the `cron@4.4.0` constructor signature
 * `(cronTime, onTick, onComplete, start, timeZone)` so the same assertions run
 * against the injected fake and — in test/04 — against the real package.
 */

export class FakeCronJob {
	constructor(expression, onTick, onComplete, start, timezone) {
		this.expression = expression;
		// A real timer stops invoking its callback once `stop()` has been called,
		// so the fake models that too — otherwise "a stopped job cannot record
		// another execution" would be untestable through the fake.
		this.onTick = (...args) => {
			if (this.stopped) return undefined;
			return onTick?.(...args);
		};
		this.rawOnTick = onTick;
		this.onComplete = onComplete;
		this.start = start;
		this.timezone = timezone;
		this.stopped = false;
	}

	stop() {
		this.stopped = true;
	}
}

export function makeLogger() {
	const calls = [];
	const logger = {
		calls,
		scope: undefined,
		scoped(scope) {
			logger.scope = scope;
			return logger;
		},
		debug(message, meta) {
			calls.push(['debug', message, meta]);
		},
		info(message, meta) {
			calls.push(['info', message, meta]);
		},
	};
	return logger;
}

export function makeInstanceSettings({ isLeader = true, instanceRole = 'leader' } = {}) {
	return { isLeader, instanceRole };
}

export function makeErrorReporter() {
	return {
		errors: [],
		error(message, options) {
			this.errors.push([message, options]);
		},
	};
}

/** Reaches the tick callback on either a FakeCronJob or a real cron@4 CronJob. */
export function tickOf(job) {
	return job.onTick ?? job._callbacks?.[0];
}

/** Snapshot of the registry that is safe to deep-compare. */
export function snapshot(manager) {
	return Array.from(manager.cronsByWorkflow.entries()).map(([workflowId, crons]) => [
		workflowId,
		Array.from(crons.entries()).map(([key, cron]) => [key, cron.summary, cron.ctx]),
	]);
}

export const FAR_FUTURE = '0 0 1 1 *'; // Jan 1, 00:00 — valid, and months away
