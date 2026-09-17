/**
 * WorkflowRunner — central coordinator for workflow execution lifecycle.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/cli/src/workflow-runner.ts
 *     - processError        L72-137
 *     - run                 L139-214
 *     - runMainProcess      L217-375
 *     - enqueueExecution    L378-545
 *     - needsFullExecutionData L558-566
 *
 * Connects ActiveExecutions, WorkflowExecute, ExecutionLifecycleHooks, and
 * ExecutionRepository with timeouts, cancellation, credentials validation,
 * and streaming responses.
 */

import {
	ExecutionCancelledError,
	ExecutionNotFoundError,
	ManualExecutionCancelledError,
	MaxStalledCountError,
	TimeoutExecutionCancelledError,
} from './errors.mjs';
import { ExecutionLifecycleHooks } from './lifecycle-hooks.mjs';
import { createRunExecutionData } from './run-execution-data.mjs';
import { WorkflowExecute } from './workflow-execute.mjs';
import { ReconstructedWorkflow } from './workflow.mjs';
import { FailedRunFactory } from './failed-run-factory.mjs';

export class WorkflowRunner {
	#logger;
	#errorReporter;
	#activeExecutions;
	#executionRepository;
	#workflowStaticDataService;
	#nodeTypes;
	#credentialsPermissionChecker;
	#instanceSettings;
	#manualExecutionService;
	#failedRunFactory;
	#eventService;
	#executionsConfig;
	#storageConfig;
	#externalHooks;
	#scalingService;
	#lifecycleHooksFactory;
	#workflowExecuteFactory;
	#workflowFactory;

	constructor(options = {}) {
		this.#logger = options.logger ?? {
			debug: () => {},
			info: () => {},
			warn: () => {},
			error: () => {},
		};
		this.#errorReporter = options.errorReporter ?? {
			error: () => {},
		};
		this.#activeExecutions = options.activeExecutions;
		this.#executionRepository = options.executionRepository ?? {
			findSingleExecution: async () => null,
			setRunning: async () => {},
		};
		this.#workflowStaticDataService = options.workflowStaticDataService ?? {
			getStaticDataById: async () => ({}),
		};
		this.#nodeTypes = options.nodeTypes ?? {
			getByNameAndVersion: () => ({}),
		};
		this.#credentialsPermissionChecker = options.credentialsPermissionChecker ?? {
			check: async () => {},
		};
		this.#instanceSettings = options.instanceSettings ?? {
			instanceType: 'main',
			hostId: 'default',
		};
		this.#manualExecutionService = options.manualExecutionService ?? null;
		this.#failedRunFactory =
			options.failedRunFactory ?? new FailedRunFactory(this.#storageConfig);
		this.#eventService = options.eventService ?? {
			emit: () => {},
		};
		this.#executionsConfig = {
			mode: 'regular',
			timeout: -1,
			maxTimeout: 3600,
			...options.executionsConfig,
		};
		this.#storageConfig = {
			modeTag: 'default',
			...options.storageConfig,
		};
		this.#externalHooks = options.externalHooks ?? {
			hasHook: () => false,
		};
		this.#scalingService = options.scalingService ?? null;
		this.#lifecycleHooksFactory = options.lifecycleHooksFactory ?? ((data, executionId) =>
			new ExecutionLifecycleHooks(data.executionMode, executionId, data.workflowData)
		);
		this.#workflowExecuteFactory = options.workflowExecuteFactory ?? ((additionalData, executionMode, executionData) =>
			new WorkflowExecute(additionalData, executionMode, executionData)
		);
		this.#workflowFactory = options.workflowFactory ?? ((params) => new ReconstructedWorkflow(params));
	}

	get activeExecutions() {
		return this.#activeExecutions;
	}

	get executionsConfig() {
		return this.#executionsConfig;
	}

	/**
	 * Process an error that occurred during workflow execution.
	 * Mirrors workflow-runner.ts:72-137.
	 */
	async processError(error, startedAt, executionMode, executionId, hooks) {
		if (
			error instanceof ExecutionNotFoundError ||
			error instanceof ExecutionCancelledError ||
			(typeof error?.message === 'string' && error.message.includes('cancelled'))
		) {
			return;
		}

		this.#logger.error(`Problem with execution ${executionId}: ${error.message}. Aborting.`);
		this.#errorReporter.error(error, { executionId });

		const isQueueMode = this.#executionsConfig.mode === 'queue';

		if (isQueueMode) {
			const executionWithoutData = await this.#executionRepository.findSingleExecution(executionId, {
				includeData: false,
			});
			if (executionWithoutData?.finished === true && executionWithoutData?.status === 'success') {
				// False positive, execution was successful
				return;
			}
		}

		const fullRunData = {
			data: createRunExecutionData({
				resultData: {
					error: {
						...error,
						message: error.message,
						stack: error.stack,
					},
					runData: {},
				},
			}),
			finished: false,
			mode: executionMode,
			startedAt,
			stoppedAt: new Date(),
			status: 'error',
			storedAt: this.#storageConfig.modeTag,
		};

		this.#activeExecutions.finalizeExecution(executionId, fullRunData);

		await hooks?.runHook('workflowExecuteAfter', [fullRunData]);
	}

	/**
	 * Run the workflow.
	 * Mirrors workflow-runner.ts:139-214.
	 */
	async run(
		data,
		loadStaticData = false,
		realtime = false,
		restartExecutionId = undefined,
		responsePromise = undefined,
	) {
		const executionId = await this.#activeExecutions.add(data, restartExecutionId);

		const workflowId = data.workflowData?.id;
		const nodes = data.workflowData?.nodes ?? [];
		try {
			await this.#credentialsPermissionChecker.check(workflowId, nodes);
		} catch (error) {
			const runData = this.#failedRunFactory.generateFailedExecutionFromError(
				data.executionMode,
				error,
				error.node,
			);
			const lifecycleHooks = this.#lifecycleHooksFactory(data, executionId);
			await lifecycleHooks.runHook('workflowExecuteBefore', [undefined, data.executionData]);
			await lifecycleHooks.runHook('workflowExecuteAfter', [runData]);
			responsePromise?.reject(error);
			this.#activeExecutions.finalizeExecution(executionId);
			return executionId;
		}

		if (responsePromise) {
			this.#activeExecutions.attachResponsePromise(executionId, responsePromise);
		}

		const shouldEnqueue =
			process.env.OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS === 'true'
				? this.#executionsConfig.mode === 'queue'
				: this.#executionsConfig.mode === 'queue' && data.executionMode !== 'manual';

		if (shouldEnqueue) {
			await this.enqueueExecution(
				executionId,
				workflowId,
				data,
				loadStaticData,
				realtime,
				restartExecutionId,
			);
		} else {
			await this.runMainProcess(executionId, data, loadStaticData, restartExecutionId);
		}

		if (
			this.#executionsConfig.mode !== 'queue' ||
			this.#instanceSettings.instanceType === 'worker' ||
			data.executionMode === 'manual' ||
			data.executionMode === 'chat'
		) {
			const postExecutePromise = this.#activeExecutions.getPostExecutePromise(executionId);
			postExecutePromise?.catch?.((error) => {
				if (error instanceof ExecutionCancelledError) return;
				this.#errorReporter.error(error, {
					extra: { executionId, workflowId },
				});
				this.#logger.error('There was an error in the post-execution promise', {
					error,
					executionId,
					workflowId,
				});
			});
		}

		return executionId;
	}

	/**
	 * Run the workflow in the current process.
	 * Mirrors workflow-runner.ts:217-375.
	 */
	async runMainProcess(
		executionId,
		data,
		loadStaticData = false,
		restartExecutionId = undefined,
	) {
		const workflowId = data.workflowData?.id;
		if (loadStaticData === true && workflowId) {
			data.workflowData.staticData =
				await this.#workflowStaticDataService.getStaticDataById(workflowId);
		}

		let executionTimeout;

		const workflowSettings = data.workflowData?.settings ?? {};
		let workflowTimeout = workflowSettings.executionTimeout ?? this.#executionsConfig.timeout;
		if (workflowTimeout > 0) {
			workflowTimeout = Math.min(workflowTimeout, this.#executionsConfig.maxTimeout);
		}

		let pinData;
		if (['manual', 'evaluation'].includes(data.executionMode)) {
			pinData = data.pinData ?? data.workflowData?.pinData;
		}

		const workflow = this.#workflowFactory({
			id: workflowId,
			name: data.workflowData?.name,
			nodes: data.workflowData?.nodes ?? [],
			connections: data.workflowData?.connections ?? {},
			active: data.workflowData?.activeVersionId !== null && data.workflowData?.activeVersionId !== undefined,
			nodeTypes: this.#nodeTypes,
			staticData: data.workflowData?.staticData,
			settings: workflowSettings,
			pinData,
		});

		const additionalData = {
			userId: data.userId,
			workflowId: workflow.id,
			executionTimeoutTimestamp:
				workflowTimeout <= 0 ? undefined : Date.now() + workflowTimeout * 1000,
			workflowSettings,
			restartExecutionId,
			streamingEnabled: data.streamingEnabled,
			executionId,
			restApiUrl: '',
			encryptionKey: '',
			timezone: workflowSettings.timezone ?? 'UTC',
			hooks: undefined,
			setExecutionStatus: (status) => {
				this.#activeExecutions.setStatus(executionId, status);
			},
			sendDataToUI: (type, msgData) => {
				this.#eventService.emit('sendDataToUI', { pushRef: data.pushRef, type, data: msgData });
			},
		};

		this.#logger.debug(
			`Execution for workflow ${data.workflowData?.name} was assigned id ${executionId}`,
			{ executionId },
		);

		let workflowExecution;
		await this.#executionRepository.setRunning(executionId);

		try {
			const lifecycleHooks = this.#lifecycleHooksFactory(data, executionId);
			additionalData.hooks = lifecycleHooks;

			lifecycleHooks.addHandler('sendResponse', (response) => {
				this.#activeExecutions.resolveResponsePromise(executionId, response);
			});

			if (data.streamingEnabled) {
				lifecycleHooks.addHandler('sendChunk', (chunk) => {
					data.httpResponse?.write?.(JSON.stringify(chunk) + '\n');
					data.httpResponse?.flush?.();
				});
			}

			if (data.executionData !== undefined) {
				this.#logger.debug(`Execution ID ${executionId} had Execution data. Running with payload.`, {
					executionId,
				});
				const workflowExecute = this.#workflowExecuteFactory(
					additionalData,
					data.executionMode,
					data.executionData,
				);
				workflowExecution = workflowExecute.processRunExecutionData(workflow);
			} else if (this.#manualExecutionService) {
				workflowExecution = this.#manualExecutionService.runManually(
					data,
					workflow,
					additionalData,
					executionId,
					pinData,
				);
			} else {
				const workflowExecute = this.#workflowExecuteFactory(
					additionalData,
					data.executionMode,
				);
				workflowExecution = workflowExecute.run(workflow);
			}

			this.#activeExecutions.attachWorkflowExecution(executionId, workflowExecution);

			if (workflowTimeout > 0) {
				let timeout = Math.min(workflowTimeout, this.#executionsConfig.maxTimeout) * 1000;
				if (data.startedAt && data.startedAt instanceof Date) {
					const now = Date.now();
					timeout = Math.max(timeout - (now - data.startedAt.getTime()), 0);
				}
				if (timeout === 0) {
					this.#activeExecutions.stopExecution(
						executionId,
						new TimeoutExecutionCancelledError(executionId),
					);
				} else {
					executionTimeout = setTimeout(() => {
						void this.#activeExecutions.stopExecution(
							executionId,
							new TimeoutExecutionCancelledError(executionId),
						);
					}, timeout);
				}
			}

			const executionPromise = Promise.resolve(workflowExecution);
			executionPromise
				.then((fullRunData) => {
					if (executionTimeout) {
						clearTimeout(executionTimeout);
					}
					if (workflowExecution?.isCanceled) {
						fullRunData.finished = false;
					}

					this.#activeExecutions.resolveExecutionResponsePromise(executionId);
					this.#activeExecutions.finalizeExecution(executionId, fullRunData);
				})
				.catch(async (error) => {
					if (executionTimeout) {
						clearTimeout(executionTimeout);
					}
					await this.processError(
						error,
						new Date(),
						data.executionMode,
						executionId,
						additionalData.hooks,
					);
				});
		} catch (error) {
			if (executionTimeout) {
				clearTimeout(executionTimeout);
			}
			await this.processError(
				error,
				new Date(),
				data.executionMode,
				executionId,
				additionalData.hooks,
			);
			throw error;
		}
	}

	/**
	 * Enqueue workflow execution in queue mode.
	 * Mirrors workflow-runner.ts:378-545.
	 */
	async enqueueExecution(
		executionId,
		workflowId,
		data,
		loadStaticData = false,
		realtime = false,
		restartExecutionId = undefined,
	) {
		if (!this.#scalingService) {
			throw new Error('ScalingService is not configured for queue mode');
		}

		const jobData = {
			workflowId,
			executionId,
			loadStaticData: !!loadStaticData,
			pushRef: data.pushRef,
			streamingEnabled: data.streamingEnabled,
			restartExecutionId,
			isMcpExecution: data.isMcpExecution,
			mcpType: data.mcpType,
			mcpSessionId: data.mcpSessionId,
			mcpMessageId: data.mcpMessageId,
			mcpToolCall: data.mcpToolCall,
		};

		let job;
		let lifecycleHooks;
		try {
			job = await this.#scalingService.addJob(jobData, { priority: realtime ? 50 : 100 });
			lifecycleHooks = this.#lifecycleHooksFactory(data, executionId);
			await lifecycleHooks.runHook('workflowExecuteBefore', [undefined, data.executionData]);
		} catch (error) {
			const workerHooks = this.#lifecycleHooksFactory(data, executionId);
			await this.processError(error, new Date(), data.executionMode, executionId, workerHooks);
			throw error;
		}

		let isCanceled = false;
		let cancelHandler = null;

		const executionPromise = new Promise(async (resolve, reject) => {
			cancelHandler = async () => {
				isCanceled = true;
				await this.#scalingService.stopJob(job);
				const error = new ManualExecutionCancelledError(executionId);
				await this.processError(
					error,
					new Date(),
					data.executionMode,
					executionId,
					lifecycleHooks,
				);
				reject(error);
			};

			try {
				await job.finished();
			} catch (error) {
				if (
					error instanceof Error &&
					typeof error.message === 'string' &&
					error.message.includes('job stalled more than maxStalledCount')
				) {
					error = new MaxStalledCountError(error);
					this.#eventService.emit('job-stalled', {
						executionId: job.data.executionId,
						workflowId: job.data.workflowId,
						hostId: this.#instanceSettings.hostId,
						jobId: job.id?.toString(),
					});
				}

				await this.processError(
					error,
					new Date(),
					data.executionMode,
					executionId,
					lifecycleHooks,
				);
				this.#scalingService.popJobResult?.(executionId);
				return reject(error);
			}

			const jobResult = this.#scalingService.popJobResult?.(executionId);
			let runData;
			if (!jobResult || this.needsFullExecutionData(data.executionMode, executionId)) {
				const fullExecutionData = await this.#executionRepository.findSingleExecution(
					executionId,
					{ includeData: true, unflattenData: true },
				);
				if (!fullExecutionData) {
					return reject(new Error(`Could not find execution with id "${executionId}"`));
				}
				runData = {
					finished: fullExecutionData.finished,
					mode: fullExecutionData.mode,
					startedAt: fullExecutionData.startedAt,
					stoppedAt: fullExecutionData.stoppedAt,
					status: fullExecutionData.status,
					data: fullExecutionData.data,
					jobId: job.id?.toString(),
					storedAt: fullExecutionData.storedAt,
				};
			} else {
				runData = {
					finished: jobResult.success,
					mode: data.executionMode,
					startedAt: jobResult.startedAt,
					stoppedAt: jobResult.stoppedAt,
					status: jobResult.status,
					data: createRunExecutionData({
						resultData: {
							runData: {},
							lastNodeExecuted: jobResult.lastNodeExecuted,
							error: jobResult.error,
							metadata: jobResult.metadata,
						},
					}),
					jobId: job.id?.toString(),
					storedAt: this.#storageConfig.modeTag,
				};
			}

			this.#activeExecutions.finalizeExecution(executionId, runData);
			await lifecycleHooks.runHook('workflowExecuteAfter', [runData]);
			resolve(runData);
		});

		executionPromise.cancel = () => {
			if (cancelHandler) {
				void cancelHandler();
			}
		};
		Object.defineProperty(executionPromise, 'isCanceled', {
			get: () => isCanceled,
		});

		executionPromise.catch(() => {});
		this.#activeExecutions.attachWorkflowExecution(executionId, executionPromise);
	}

	/**
	 * Whether main must retrieve full execution data from DB on job completion.
	 * Mirrors workflow-runner.ts:558-566.
	 */
	needsFullExecutionData(executionMode, executionId) {
		if (!process.env.N8N_MINIMIZE_EXECUTION_DATA_FETCHING) return true;
		return (
			executionMode === 'integrated' ||
			this.#activeExecutions.getResponseMode?.(executionId) === 'lastNode' ||
			this.#externalHooks.hasHook('workflow.postExecute')
		);
	}
}
