/**
 * ActiveWorkflows + the cron-free part of ScheduledTaskManager — activating and
 * deactivating trigger/poller-based workflows in memory.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/core/src/execution-engine/active-workflows.ts
 *     - isActive / allActiveWorkflows / get            L53-70
 *     - add                                            L81-145
 *     - activatePolling                                L150-186
 *     - remove                                         L189-208
 *     - removeAllTriggerAndPollerBasedWorkflows        L210-222
 *     - closeTrigger                                   L224-249
 *     - createPollExecuteFn                            L255-288
 *   reference/n8n/packages/core/src/execution-engine/scheduled-task-manager.ts
 *     - toCronKey L139-161, registerCron L60-105 (keying + duplicate guard),
 *       deregisterCrons L107-126  (the `cron` CronJob itself is the caller's adapter)
 *   reference/n8n/packages/workflow/src/cron.ts
 *     - toCronExpression L52-72 (random second/minute, `*`-interval UserError guard)
 *   Oracle: .../execution-engine/__tests__/active-workflows.test.ts (299 ln)
 *
 * Boundaries:
 *   - The `cron` package is a runtime dependency and gate `E01` forbids dependencies,
 *     so scheduling is an injected adapter: anything with
 *     `registerCron(ctx, onTick)` / `deregisterCrons(workflowId)` works, and
 *     `ScheduledTaskManager` below is the dependency-free reference implementation
 *     (keying + summaries + duplicate guard) with an injectable timer.
 *   - Logger, error reporter and tracing are injected too (the engine never imports
 *     telemetry); `tracing.startSpan` defaults to "run the callback with a no-op span".
 *   - The poll/trigger function objects come from the caller's factories, exactly like
 *     `IGetExecuteTriggerFunctions` / `IGetExecutePollFunctions` in the reference.
 */

import { TriggerCloseError, UserError, WorkflowActivationError, WorkflowDeactivationError } from './errors.mjs';

const NO_OP_LOGGER = { debug() {}, info() {}, warn() {}, error() {} };
const NO_OP_ERROR_REPORTER = { error() {} };
const NO_OP_TRACING = {
	startSpan(_options, callback) {
		return callback({ setStatus() {}, setAttribute() {}, end() {} });
	},
	pickWorkflowAttributes: () => ({}),
	pickNodeAttributes: () => ({}),
};

/** `toCronExpression(item)` — reference cron.ts L52-72 (5-field expressions for `cron`). */
export function toCronExpression(item, randomInt = (max) => Math.floor(Math.random() * max)) {
	const randomSecond = randomInt(60);

	if (item.mode === 'everyMinute') return `${randomSecond} * * * * *`;
	if (item.mode === 'everyHour') return `${randomSecond} ${item.minute} * * * *`;

	if (item.mode === 'everyX') {
		if (item.unit === 'minutes') return `${randomSecond} */${item.value} * * * *`;

		const randomMinute = randomInt(60);
		if (item.unit === 'hours') return `${randomSecond} ${randomMinute} */${item.value} * * *`;
	}
	if (item.mode === 'everyDay') return `${randomSecond} ${item.minute} ${item.hour} * * *`;
	if (item.mode === 'everyWeek') return `${randomSecond} ${item.minute} ${item.hour} * * ${item.weekday}`;

	if (item.mode === 'everyMonth') return `${randomSecond} ${item.minute} ${item.hour} ${item.dayOfMonth} * *`;

	return item.cronExpression.trim();
}

/**
 * The cron-free part of `ScheduledTaskManager` (reference L17-161): crons keyed by
 * workflow, duplicate registration reported instead of scheduled, deregistration by
 * workflow id. No timer is started unless a `timer` factory is injected, so an offline
 * process does not hold a handle open; when a timer *is* injected the callback receives
 * the ctx and can drive `onTick()` itself.
 */
export class ScheduledTaskManager {
	constructor({ logger = NO_OP_LOGGER, errorReporter = NO_OP_ERROR_REPORTER, timer = null } = {}) {
		this.cronsByWorkflow = new Map();
		this.logger = logger;
		this.errorReporter = errorReporter;
		this.timer = timer;
	}

	registerCron(ctx, onTick) {
		const { workflowId, timezone, nodeId, expression, recurrence } = ctx;

		const summary = recurrence?.activated
			? `${expression} (every ${recurrence.intervalSize} ${recurrence.typeInterval})`
			: expression;

		const workflowCrons = this.cronsByWorkflow.get(workflowId);
		const key = this.toCronKey(ctx);

		if (workflowCrons?.has(key)) {
			this.errorReporter.error('Skipped registration for already registered cron', {
				tags: { cron: 'duplicate' },
				extra: { workflowId, timezone, nodeId, expression, recurrence },
			});
			return;
		}

		const job = this.timer ? this.timer(ctx, onTick) : { stop() {}, tick: onTick };
		const cron = { job, summary, ctx };

		if (!workflowCrons) {
			this.cronsByWorkflow.set(workflowId, new Map([[key, cron]]));
		} else {
			workflowCrons.set(key, cron);
		}

		this.logger.debug('Registered cron for workflow', { workflowId, cron: summary });
	}

	deregisterCrons(workflowId) {
		const workflowCrons = this.cronsByWorkflow.get(workflowId);

		if (!workflowCrons || workflowCrons.size === 0) return;

		const summaries = [];

		for (const cron of workflowCrons.values()) {
			summaries.push(cron.summary);
			void cron.job.stop();
		}

		this.cronsByWorkflow.delete(workflowId);

		this.logger.info('Deregistered all crons for workflow', { workflowId, crons: summaries });
	}

	deregisterAllCrons() {
		for (const workflowId of this.cronsByWorkflow.keys()) {
			this.deregisterCrons(workflowId);
		}
	}

	/** `toCronKey` — reference L139-161: recurrence flattened, keys sorted, JSON identity. */
	toCronKey(ctx) {
		const { recurrence, ...rest } = ctx;
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

export class ActiveWorkflows {
	constructor({
		logger = NO_OP_LOGGER,
		scheduledTaskManager,
		triggersAndPollers,
		errorReporter = NO_OP_ERROR_REPORTER,
		tracing = NO_OP_TRACING,
		randomInt,
	} = {}) {
		this.logger = logger;
		this.scheduledTaskManager = scheduledTaskManager;
		this.triggersAndPollers = triggersAndPollers;
		this.errorReporter = errorReporter;
		this.tracing = tracing;
		this.randomInt = randomInt;
		this.activeWorkflows = {};
	}

	/** Returns if the workflow is active in memory. */
	isActive(workflowId) {
		return Object.hasOwn(this.activeWorkflows, workflowId);
	}

	/** Returns the IDs of the currently active workflows in memory. */
	allActiveWorkflows() {
		return Object.keys(this.activeWorkflows);
	}

	/** Returns the workflow data for the given ID if currently active in memory. */
	get(workflowId) {
		return this.activeWorkflows[workflowId];
	}

	/**
	 * Makes a workflow active: every trigger node is started, then polling is
	 * activated for every poll node.
	 */
	async add(workflowId, workflow, additionalData, mode, activation, getTriggerFunctions, getPollFunctions) {
		const triggerNodes = workflow.getTriggerNodes();

		const triggerResponses = [];

		for (const triggerNode of triggerNodes) {
			try {
				const triggerResponse = await this.triggersAndPollers.runTrigger(
					workflow,
					triggerNode,
					getTriggerFunctions,
					additionalData,
					mode,
					activation,
				);
				if (triggerResponse !== undefined) {
					triggerResponses.push(triggerResponse);
				}
			} catch (e) {
				const error = e instanceof Error ? e : new Error(`${e}`);

				throw new WorkflowActivationError(
					`There was a problem activating the workflow: "${error.message}"`,
					{ cause: error, node: triggerNode },
				);
			}
		}

		this.activeWorkflows[workflowId] = { triggerResponses };

		const pollingNodes = workflow.getPollNodes();

		if (pollingNodes.length === 0) return;

		for (const pollNode of pollingNodes) {
			try {
				await this.activatePolling(
					pollNode,
					workflow,
					additionalData,
					getPollFunctions,
					mode,
					activation,
				);
			} catch (e) {
				// Do not mark this workflow as active if there are no triggerResponses,
				// and any polling activation failed
				if (triggerResponses.length === 0) {
					delete this.activeWorkflows[workflowId];
				}

				const error = e instanceof Error ? e : new Error(`${e}`);

				throw new WorkflowActivationError(
					`There was a problem activating the workflow: "${error.message}"`,
					{ cause: error, node: pollNode },
				);
			}
		}
	}

	/** Activates polling for the given node. */
	async activatePolling(node, workflow, additionalData, getPollFunctions, mode, activation) {
		const pollFunctions = getPollFunctions(workflow, node, additionalData, mode, activation);

		const pollTimes = pollFunctions.getNodeParameter('pollTimes');

		// Get all the trigger times
		const cronExpressions = (pollTimes.item || []).map((item) =>
			this.randomInt ? toCronExpression(item, this.randomInt) : toCronExpression(item),
		);
		// The trigger function to execute when the cron-time got reached
		const executeTrigger = this.createPollExecuteFn(workflow, node, pollFunctions);

		// Execute the trigger directly to be able to know if it works
		await executeTrigger(true);

		for (const expression of cronExpressions) {
			if (expression.split(' ').at(0)?.includes('*')) {
				throw new UserError('The polling interval is too short. It has to be at least a minute.');
			}

			const ctx = {
				workflowId: workflow.id,
				timezone: workflow.timezone,
				nodeId: node.id,
				expression,
			};

			this.scheduledTaskManager.registerCron(ctx, executeTrigger);
		}
	}

	/** Makes a workflow inactive in memory. */
	async remove(workflowId) {
		if (!this.isActive(workflowId)) {
			this.logger.warn(`Cannot deactivate already inactive workflow ID "${workflowId}"`);
			return false;
		}

		this.scheduledTaskManager.deregisterCrons(workflowId);

		const w = this.activeWorkflows[workflowId];
		for (const r of w.triggerResponses ?? []) {
			await this.closeTrigger(r, workflowId);
		}

		delete this.activeWorkflows[workflowId];

		return true;
	}

	async removeAllTriggerAndPollerBasedWorkflows() {
		const activeWorkflowIds = Object.keys(this.activeWorkflows);

		if (activeWorkflowIds.length === 0) return;

		for (const workflowId of activeWorkflowIds) {
			await this.remove(workflowId);
		}

		this.logger.debug('Deactivated all trigger- and poller-based workflows', {
			workflowIds: activeWorkflowIds,
		});
	}

	async closeTrigger(response, workflowId) {
		if (!response.closeFunction) return;

		try {
			await response.closeFunction();
		} catch (e) {
			if (e instanceof TriggerCloseError) {
				this.logger.error(
					`There was a problem calling "closeFunction" on "${e.node.name}" in workflow "${workflowId}"`,
				);
				this.errorReporter.error(e, { extra: { workflowId } });
				return;
			}

			const error = e instanceof Error ? e : new Error(`${e}`);

			throw new WorkflowDeactivationError(
				`Failed to deactivate trigger of workflow ID "${workflowId}": "${error.message}"`,
				{ cause: error, workflowId },
			);
		}
	}

	/**
	 * Creates a function that executes the poll function for a given workflow and node
	 * and triggers a workflow execution based on the output.
	 */
	createPollExecuteFn(workflow, node, pollFunctions) {
		return async (testingTrigger = false) => {
			return await this.tracing.startSpan(
				{
					name: 'Workflow Trigger Poll',
					op: 'trigger.poll',
					attributes: {
						...this.tracing.pickWorkflowAttributes(workflow),
						...this.tracing.pickNodeAttributes(node),
					},
				},
				async (span) => {
					this.logger.debug(`Polling trigger initiated for workflow "${workflow.name}"`, {
						workflowName: workflow.name,
						workflowId: workflow.id,
					});

					try {
						const pollResponse = await this.triggersAndPollers.runPoll(
							workflow,
							node,
							pollFunctions,
						);

						if (pollResponse !== null) {
							pollFunctions.__emit(pollResponse);
						}

						span.setStatus({ code: 'ok' });
					} catch (error) {
						span.setStatus({ code: 'error' });
						// If the poll function fails in the first activation
						// throw the error back so we let the user know there is
						// an issue with the trigger.
						if (testingTrigger) {
							throw error;
						}
						pollFunctions.__emitError(error);
					}
				},
			);
		};
	}
}
