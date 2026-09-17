/**
 * Scheduler LEGO — `ScheduledTaskManager`.
 *
 * 1:1 port of `packages/core/src/execution-engine/scheduled-task-manager.ts`
 * (n8n 2.9.4), minus the `@Service()` DI decorator (a no-op at runtime).
 *
 * BOUNDARY (declared, per the precedent set by POOL-004/POOL-005): the `cron`
 * package's real timer is INJECTED, not imported, so this LEGO keeps zero
 * runtime dependencies and no test ever waits on a wall-clock tick. Pass the
 * real `CronJob` from `cron@4.4.0` to exercise production behaviour; the A/B
 * parity suite does exactly that.
 */

/**
 * Minutes→milliseconds. `@n8n/constants` `Time.minutes.toMilliseconds`.
 * Kept as an injectable default so the port stays dependency-free without
 * changing a single computed value.
 */
export const DEFAULT_TIME = { minutes: { toMilliseconds: 60_000 } };

/**
 * @typedef {object} CronContext
 * @property {string} workflowId
 * @property {string} nodeId
 * @property {string} expression
 * @property {string} timezone
 * @property {{ activated?: boolean, index?: number, intervalSize?: number, typeInterval?: string }} [recurrence]
 */

export class ScheduledTaskManager {
	/**
	 * @param {{ isLeader: boolean, instanceRole: string }} instanceSettings
	 * @param {{ scoped: (s: string) => any, debug: Function, info: Function }} logger
	 * @param {{ activeInterval: number }} cronLoggingConfig
	 * @param {{ error: Function }} errorReporter
	 * @param {{ CronJob?: any, Time?: typeof DEFAULT_TIME }} [deps]
	 */
	constructor(instanceSettings, logger, { activeInterval }, errorReporter, deps = {}) {
		this.instanceSettings = instanceSettings;
		this.logger = logger;
		this.errorReporter = errorReporter;

		this.cronsByWorkflow = new Map();
		this.logInterval = undefined;

		this.CronJob = deps.CronJob;
		this.Time = deps.Time ?? DEFAULT_TIME;

		// upstream: `this.logger = this.logger.scoped('cron')`
		this.logger = this.logger.scoped('cron');

		// FROZEN QUIRK (S-07): only the literal `0` disables the debug interval.
		// `undefined`, `null` or a negative value all START an interval.
		if (activeInterval === 0) return;

		this.logInterval = setInterval(() => {
			if (Object.keys(this.loggableCrons).length === 0) return;
			this.logger.debug('Currently active crons', { active: this.loggableCrons });
		}, activeInterval * this.Time.minutes.toMilliseconds);
	}

	/** Crons currently active instance-wide, to display in logs. */
	get loggableCrons() {
		const loggableCrons = {};
		for (const [workflowId, crons] of this.cronsByWorkflow) {
			loggableCrons[`workflowId-${workflowId}`] = Array.from(crons.values()).map(
				({ summary }) => summary,
			);
		}
		return loggableCrons;
	}

	/**
	 * @param {CronContext} ctx
	 * @param {() => void} onTick
	 */
	registerCron(ctx, onTick) {
		const { workflowId, timezone, nodeId, expression, recurrence } = ctx;

		const summary = recurrence?.activated
			? `${expression} (every ${recurrence.intervalSize} ${recurrence.typeInterval})`
			: expression;

		// FROZEN QUIRK (S-08): the map is read BEFORE the duplicate check, so the
		// `workflowCrons` used for the later `set` is the pre-existing one.
		const workflowCrons = this.cronsByWorkflow.get(workflowId);
		const key = this.toCronKey({ workflowId, nodeId, expression, timezone, recurrence });

		if (workflowCrons?.has(key)) {
			// T-1: a duplicate is a SILENT no-op — reported, never thrown.
			this.errorReporter.error('Skipped registration for already registered cron', {
				tags: { cron: 'duplicate' },
				extra: {
					workflowId,
					timezone,
					nodeId,
					expression,
					recurrence,
					instanceRole: this.instanceSettings.instanceRole,
				},
			});
			return;
		}

		if (typeof this.CronJob !== 'function') {
			throw new Error(
				'ScheduledTaskManager requires a CronJob implementation — inject `deps.CronJob` (the boundary of this LEGO)',
			);
		}

		const job = new this.CronJob(
			expression,
			() => {
				// T-2: followers keep the registration but never fire.
				if (!this.instanceSettings.isLeader) return;

				this.logger.debug('Executing cron for workflow', {
					workflowId,
					nodeId,
					cron: summary,
					instanceRole: this.instanceSettings.instanceRole,
				});

				onTick();
			},
			undefined,
			true,
			timezone,
		);

		/** @type {{ job: any, summary: string, ctx: CronContext }} */
		const cron = { job, summary, ctx };

		if (!workflowCrons) {
			this.cronsByWorkflow.set(workflowId, new Map([[key, cron]]));
		} else {
			workflowCrons.set(key, cron);
		}

		this.logger.debug('Registered cron for workflow', {
			workflowId,
			cron: summary,
			instanceRole: this.instanceSettings.instanceRole,
		});
	}

	deregisterCrons(workflowId) {
		const workflowCrons = this.cronsByWorkflow.get(workflowId);

		// FROZEN QUIRK (S-09): an existing but EMPTY entry short-circuits BEFORE
		// the delete, so the empty Map stays behind in `cronsByWorkflow`.
		if (!workflowCrons || workflowCrons.size === 0) return;

		const summaries = [];
		for (const cron of workflowCrons.values()) {
			summaries.push(cron.summary);
			void cron.job.stop();
		}

		this.cronsByWorkflow.delete(workflowId);

		this.logger.info('Deregistered all crons for workflow', {
			workflowId,
			crons: summaries,
			instanceRole: this.instanceSettings.instanceRole,
		});
	}

	deregisterAllCrons() {
		// deleting the current entry while iterating is safe for Map iterators
		for (const workflowId of this.cronsByWorkflow.keys()) {
			this.deregisterCrons(workflowId);
		}

		clearInterval(this.logInterval);
		this.logInterval = undefined;
	}

	/**
	 * Normalised, key-sorted JSON identity of a cron context.
	 * `private` in TypeScript — compile-time only, so it is a normal method here.
	 */
	toCronKey(ctx) {
		const { recurrence, ...rest } = ctx;

		// FROZEN QUIRK (S-10): `recurrence` is FLATTENED into `recurrence*`
		// scalars, and the interval fields are only folded in when
		// `recurrence.activated` is truthy. `recurrence.index` is therefore
		// dropped for an inactive recurrence, so two contexts that differ only
		// by `recurrence.index` collide on the same key.
		const flattened = !recurrence
			? rest
			: {
					...rest,
					recurrenceActivated: recurrence.activated,
					...(recurrence.activated && {
						recurrenceIndex: recurrence.index,
						recurrenceIntervalSize: recurrence.intervalSize,
						recurrenceTypeInterval: recurrence.typeInterval,
					}),
				};

		const sorted = Object.keys(flattened)
			.sort()
			.reduce((result, key) => {
				result[key] = flattened[key];
				return result;
			}, {});

		return JSON.stringify(sorted);
	}
}
