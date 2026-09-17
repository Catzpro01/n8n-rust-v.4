/**
 * WaitTracker — schedules and resumes waiting executions.
 *
 * Reconstruction target: n8n 2.9.4
 *   reference/n8n/packages/cli/src/wait-tracker.ts
 *
 * Scope:
 * - Periodically queries execution repository for upcoming waiting executions
 * - Sets timers to resume executions at the specified waitTill timestamp
 * - Executes executions via workflowRunner
 * - Handles duplicate resume suppression via ExecutionAlreadyResumingError
 * - Manages parent workflow resumption when sub-workflows complete
 * - Respects instance leadership (leader tracks, followers do not)
 */

import { UnexpectedError, ExecutionAlreadyResumingError } from './errors.mjs';
import {
	shouldRestartParentExecution,
	updateParentExecutionWithChildResults,
} from './workflow-helpers.mjs';

const NO_OP_LOGGER = {
	debug: () => {},
	error: () => {},
	info: () => {},
	warn: () => {},
	scoped: () => NO_OP_LOGGER,
};

export class WaitTracker {
	#waitingExecutions = new Map();
	#mainTimer = null;
	#logger;
	#executionRepository;
	#ownershipService;
	#activeExecutions;
	#workflowRunner;
	#instanceSettings;
	#pollIntervalMs;
	#setTimeoutFn;
	#clearTimeoutFn;
	#setIntervalFn;
	#clearIntervalFn;
	#nowFn;

	/**
	 * @param {object|*} loggerOrOptions
	 * @param {object} [executionRepository]
	 * @param {object} [ownershipService]
	 * @param {object} [activeExecutions]
	 * @param {object} [workflowRunner]
	 * @param {object} [instanceSettings]
	 * @param {object} [timerOptions]
	 */
	constructor(
		loggerOrOptions,
		executionRepository,
		ownershipService,
		activeExecutions,
		workflowRunner,
		instanceSettings,
		timerOptions = {},
	) {
		let opts = {};
		if (loggerOrOptions && (executionRepository !== undefined || ownershipService !== undefined)) {
			opts = {
				logger: loggerOrOptions,
				executionRepository,
				ownershipService,
				activeExecutions,
				workflowRunner,
				instanceSettings,
				...timerOptions,
			};
		} else if (loggerOrOptions && typeof loggerOrOptions === 'object') {
			opts = loggerOrOptions;
		}

		const logger = opts.logger ?? NO_OP_LOGGER;
		this.#logger = typeof logger.scoped === 'function' ? logger.scoped('waiting-executions') : logger;
		this.#executionRepository = opts.executionRepository;
		this.#ownershipService = opts.ownershipService ?? {
			getWorkflowProjectCached: async () => ({ id: 'default' }),
		};
		this.#activeExecutions = opts.activeExecutions ?? {
			getPostExecutePromise: async () => null,
		};
		this.#workflowRunner = opts.workflowRunner;
		this.#instanceSettings = opts.instanceSettings ?? { isLeader: true };
		this.#pollIntervalMs = opts.pollIntervalMs ?? 60000;
		this.#setTimeoutFn = opts.setTimeoutFn ?? setTimeout;
		this.#clearTimeoutFn = opts.clearTimeoutFn ?? clearTimeout;
		this.#setIntervalFn = opts.setIntervalFn ?? setInterval;
		this.#clearIntervalFn = opts.clearIntervalFn ?? clearInterval;
		this.#nowFn = opts.nowFn ?? (() => Date.now());
	}

	get mainTimer() {
		return this.#mainTimer;
	}

	get waitingExecutionsCount() {
		return this.#waitingExecutions.size;
	}

	has(executionId) {
		return this.#waitingExecutions.has(String(executionId));
	}

	init() {
		if (this.#instanceSettings?.isLeader) {
			this.startTracking();
		}
	}

	startTracking() {
		if (this.#mainTimer) return;

		this.#mainTimer = this.#setIntervalFn(() => {
			void this.getWaitingExecutions();
		}, this.#pollIntervalMs);

		void this.getWaitingExecutions();

		this.#logger.debug('Started tracking waiting executions');
	}

	async getWaitingExecutions() {
		this.#logger.debug('Querying database for waiting executions');

		const executions = await this.#executionRepository.getWaitingExecutions();
		if (!executions || executions.length === 0) {
			return;
		}

		const executionIds = executions.map((e) => e.id).join(', ');
		this.#logger.debug(
			`Found ${executions.length} executions. Setting timer for IDs: ${executionIds}`,
		);

		const now = this.#nowFn();
		for (const execution of executions) {
			const executionId = String(execution.id);
			if (!this.#waitingExecutions.has(executionId)) {
				const waitTillDate = execution.waitTill instanceof Date
					? execution.waitTill
					: new Date(execution.waitTill);
				const triggerTime = Math.max(0, waitTillDate.getTime() - now);
				const timer = this.#setTimeoutFn(() => {
					void this.startExecution(executionId);
				}, triggerTime);

				this.#waitingExecutions.set(executionId, {
					executionId,
					timer,
				});
			}
		}
	}

	stopExecution(executionId) {
		const strId = String(executionId);
		const entry = this.#waitingExecutions.get(strId);
		if (!entry) return;

		this.#clearTimeoutFn(entry.timer);
		this.#waitingExecutions.delete(strId);
	}

	async startExecution(executionId) {
		const strId = String(executionId);
		this.#logger.debug(`Resuming execution ${strId}`, { executionId: strId });
		this.#waitingExecutions.delete(strId);

		const fullExecutionData = await this.#executionRepository.findSingleExecution(strId, {
			includeData: true,
			unflattenData: true,
		});

		if (!fullExecutionData) {
			throw new UnexpectedError('Execution does not exist.', { extra: { executionId: strId } });
		}
		if (fullExecutionData.finished) {
			throw new UnexpectedError('The execution did succeed and can so not be started again.');
		}
		if (!fullExecutionData.workflowData?.id) {
			throw new UnexpectedError('Only saved workflows can be resumed.');
		}

		const workflowId = fullExecutionData.workflowData.id;
		const project = await this.#ownershipService.getWorkflowProjectCached(workflowId);

		const data = {
			executionMode: fullExecutionData.mode,
			executionData: fullExecutionData.data,
			workflowData: fullExecutionData.workflowData,
			projectId: project?.id,
			pushRef: fullExecutionData.data?.pushRef,
		};
		if (fullExecutionData.startedAt !== undefined) {
			data.startedAt = fullExecutionData.startedAt;
		}

		try {
			await this.#workflowRunner.run(data, false, false, strId);
		} catch (error) {
			if (error instanceof ExecutionAlreadyResumingError || error?.name === 'ExecutionAlreadyResumingError') {
				this.#logger.debug(
					`Execution ${strId} is already being resumed, skipping duplicate resume`,
					{ executionId: strId },
				);
				return;
			}
			throw error;
		}

		const parentExecution = fullExecutionData.data?.parentExecution;
		if (shouldRestartParentExecution(parentExecution)) {
			void Promise.resolve(this.#activeExecutions.getPostExecutePromise(strId))
				.then(async (subworkflowResults) => {
					if (!subworkflowResults) return;
					if (subworkflowResults.status === 'waiting') return;
					await updateParentExecutionWithChildResults(
						this.#executionRepository,
						parentExecution.executionId,
						subworkflowResults,
					);
					return subworkflowResults;
				})
				.then((subworkflowResults) => {
					if (!subworkflowResults) return;
					if (subworkflowResults.status === 'waiting') return;
					void this.startExecution(parentExecution.executionId);
				});
		}
	}

	stopTracking() {
		if (!this.#mainTimer) return;

		this.#clearIntervalFn(this.#mainTimer);
		this.#mainTimer = null;

		for (const entry of this.#waitingExecutions.values()) {
			this.#clearTimeoutFn(entry.timer);
		}
		this.#waitingExecutions.clear();

		this.#logger.debug('Stopped tracking waiting executions');
	}
}
