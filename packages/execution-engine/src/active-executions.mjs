/**
 * ActiveExecutions — in-memory registry and lifecycle manager for currently executing workflows.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/cli/src/active-executions.ts
 *
 * Responsibilities:
 *   - in-memory execution registry (`activeExecutions: { [executionId]: IExecutingWorkflowData }`)
 *   - new execution registration and persistence delegation
 *   - waiting execution resumption and optimistic lock enforcement (`requireStatus: 'waiting'`)
 *   - postExecutePromise lifecycle and automatic cleanup on settlement
 *   - cancellation handling (`stopExecution`) via cancelable workflow execution + event emission
 *   - streaming HTTP response chunking (`sendChunk`) and completion (`finalizeExecution`)
 *   - active execution status tracking (`setStatus`/`getStatus`/`getActiveExecutions`)
 *   - graceful shutdown and drain
 */

import { randomUUID } from 'node:crypto';
import {
	ExecutionAlreadyResumingError,
	ExecutionCancelledError,
	ExecutionNotFoundError,
	SystemShutdownExecutionCancelledError,
} from './errors.mjs';
import { createDeferredPromise } from './lifecycle-hooks.mjs';

const NO_OP_LOGGER = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

export class ActiveExecutions {
	/** Active executions in the current process, not globally. */
	activeExecutions = {};

	/** Response mode by execution ID, if webhook-initiated. */
	responseModes = new Map();

	constructor(dependencies = {}) {
		this.logger = dependencies.logger ?? NO_OP_LOGGER;
		this.executionRepository = dependencies.executionRepository ?? null;
		this.executionPersistence = dependencies.executionPersistence ?? null;
		this.concurrencyControl = dependencies.concurrencyControl ?? null;
		this.eventService = dependencies.eventService ?? null;
		this.executionsConfig = dependencies.executionsConfig ?? { mode: 'regular' };
	}

	has(executionId) {
		return this.activeExecutions[String(executionId)] !== undefined;
	}

	/**
	 * Add a new active execution
	 */
	async add(executionData, maybeExecutionId) {
		let executionStatus = maybeExecutionId ? 'running' : 'new';
		const mode = executionData.executionMode;
		let capacityReserved = false;

		const reserveCapacity = async (id) => {
			if (this.concurrencyControl && typeof this.concurrencyControl.reserve === 'function') {
				await this.concurrencyControl.reserve({ mode, executionId: id });
				capacityReserved = true;
			}
		};

		const releaseCapacity = () => {
			if (capacityReserved && this.concurrencyControl && typeof this.concurrencyControl.release === 'function') {
				this.concurrencyControl.release({ mode, executionId: maybeExecutionId });
				capacityReserved = false;
			}
		};

		try {
			if (maybeExecutionId === undefined) {
				const fullExecutionData = {
					data: executionData.executionData,
					mode,
					finished: false,
					workflowData: executionData.workflowData,
					status: executionStatus,
					workflowId: executionData.workflowData?.id,
					retryOf: executionData.retryOf ?? undefined,
				};

				if (this.executionPersistence && typeof this.executionPersistence.create === 'function') {
					maybeExecutionId = await this.executionPersistence.create(fullExecutionData);
				} else if (this.executionRepository && typeof this.executionRepository.create === 'function') {
					maybeExecutionId = await this.executionRepository.create(fullExecutionData);
				} else {
					maybeExecutionId = randomUUID();
				}

				if (!maybeExecutionId) {
					throw new Error('Failed to create execution ID');
				}

				await reserveCapacity(maybeExecutionId);

				if (this.executionsConfig.mode === 'regular' && this.executionRepository && typeof this.executionRepository.setRunning === 'function') {
					await this.executionRepository.setRunning(maybeExecutionId);
				}
				executionStatus = 'running';
			} else {
				// Resuming an existing execution from waiting state
				await reserveCapacity(maybeExecutionId);

				const execution = {
					id: maybeExecutionId,
					data: executionData.executionData,
					waitTill: null,
					status: executionStatus,
				};

				if (this.executionRepository && typeof this.executionRepository.updateExistingExecution === 'function') {
					const updateSucceeded = await this.executionRepository.updateExistingExecution(
						maybeExecutionId,
						execution,
						{ requireStatus: 'waiting' },
					);

					if (!updateSucceeded) {
						throw new ExecutionAlreadyResumingError(maybeExecutionId);
					}
				}
			}
		} catch (error) {
			releaseCapacity();
			throw error;
		}

		const executionId = String(maybeExecutionId);
		const resumingExecution = this.activeExecutions[executionId];
		const postExecutePromise = createDeferredPromise();

		const execution = {
			executionData,
			startedAt: resumingExecution?.startedAt ?? new Date(),
			postExecutePromise,
			status: executionStatus,
			responsePromise: resumingExecution?.responsePromise,
			httpResponse: executionData.httpResponse ?? undefined,
		};
		this.activeExecutions[executionId] = execution;

		// Automatically remove execution once the postExecutePromise settles
		void postExecutePromise.promise
			.catch((error) => {
				if (error instanceof ExecutionCancelledError) return;
				throw error;
			})
			.finally(() => {
				releaseCapacity();
				if (execution.status === 'waiting') {
					// Do not hold reference to previous WorkflowExecute instance
					delete execution.workflowExecution;
				} else {
					delete this.activeExecutions[executionId];
					this.responseModes.delete(executionId);
					this.logger.debug('Execution removed', { executionId });
				}
			});

		this.logger.debug('Execution added', { executionId });
		return executionId;
	}

	attachWorkflowExecution(executionId, workflowExecution) {
		this.getExecutionOrFail(executionId).workflowExecution = workflowExecution;
	}

	attachResponsePromise(executionId, responsePromise) {
		this.getExecutionOrFail(executionId).responsePromise = responsePromise;
	}

	resolveResponsePromise(executionId, response) {
		const execution = this.activeExecutions[String(executionId)];
		execution?.responsePromise?.resolve(response);
	}

	/** Used for sending a chunk to a streaming response */
	sendChunk(executionId, chunkText) {
		const execution = this.activeExecutions[String(executionId)];
		if (execution?.httpResponse) {
			execution.httpResponse.write(JSON.stringify(chunkText) + '\n');
			if (typeof execution.httpResponse.flush === 'function') {
				execution.httpResponse.flush();
			}
		}
	}

	/** Cancel the execution promise and reject its post-execution promise. */
	stopExecution(executionId, cancellationError) {
		const id = String(executionId);
		const execution = this.activeExecutions[id];
		if (execution === undefined) {
			return;
		}

		this.logger.debug('Cancelling execution', { executionId: id, reason: cancellationError.reason });

		const workflowData = execution.executionData?.workflowData;
		if (this.eventService && typeof this.eventService.emit === 'function') {
			this.eventService.emit('execution-cancelled', {
				executionId: id,
				workflowId: workflowData?.id,
				workflowName: workflowData?.name,
				reason: cancellationError.reason,
			});
		}

		execution.responsePromise?.reject(cancellationError);
		if (execution.status === 'waiting') {
			delete this.activeExecutions[id];
			this.responseModes.delete(id);
		} else {
			if (execution.workflowExecution && typeof execution.workflowExecution.cancel === 'function') {
				execution.workflowExecution.cancel();
			}
			execution.postExecutePromise.reject(cancellationError);
		}
		this.logger.debug('Execution cancelled', { executionId: id });
	}

	/** Resolve the post-execution promise in an execution. */
	finalizeExecution(executionId, fullRunData) {
		const id = String(executionId);
		if (!this.has(id)) return;
		const execution = this.getExecutionOrFail(id);

		if (execution.executionData?.httpResponse) {
			try {
				this.logger.debug('Closing response for execution', { executionId: id });
				execution.executionData.httpResponse.end();
			} catch (error) {
				this.logger.error('Error closing streaming response', {
					executionId: id,
					error: error.message,
				});
			}
		}

		execution.postExecutePromise.resolve(fullRunData);
		this.logger.debug('Execution finalized', { executionId: id });
	}

	/** Resolve the response promise in an execution (e.g. for Form nodes). */
	resolveExecutionResponsePromise(executionId) {
		const id = String(executionId);
		if (!this.has(id)) return;
		const execution = this.getExecutionOrFail(id);

		if (execution.status !== 'waiting' && execution?.responsePromise) {
			execution.responsePromise.resolve({});
			this.logger.debug('Execution response promise cleaned', { executionId: id });
		}
	}

	async getPostExecutePromise(executionId) {
		return await this.getExecutionOrFail(executionId).postExecutePromise.promise;
	}

	getActiveExecutions() {
		const returnData = [];
		for (const id of Object.keys(this.activeExecutions)) {
			const data = this.activeExecutions[id];
			returnData.push({
				id,
				retryOf: data.executionData?.retryOf ?? undefined,
				startedAt: data.startedAt,
				mode: data.executionData?.executionMode,
				workflowId: data.executionData?.workflowData?.id,
				status: data.status,
			});
		}
		return returnData;
	}

	setStatus(executionId, status) {
		this.getExecutionOrFail(executionId).status = status;
	}

	getStatus(executionId) {
		return this.getExecutionOrFail(executionId).status;
	}

	setResponseMode(executionId, responseMode) {
		this.responseModes.set(String(executionId), responseMode);
	}

	getResponseMode(executionId) {
		return this.responseModes.get(String(executionId));
	}

	/** Wait for all active executions to finish */
	async shutdown(cancelAll = false) {
		const isRegularMode = this.executionsConfig.mode === 'regular';
		if (isRegularMode && this.concurrencyControl && typeof this.concurrencyControl.disable === 'function') {
			this.concurrencyControl.disable();
		}

		const executionIds = Object.keys(this.activeExecutions);
		const toCancel = [];
		for (const executionId of executionIds) {
			const { status } = this.activeExecutions[executionId];
			if (isRegularMode && cancelAll) {
				this.stopExecution(executionId, new SystemShutdownExecutionCancelledError(executionId));
				toCancel.push(executionId);
			} else if (status === 'waiting' || status === 'new') {
				delete this.activeExecutions[executionId];
				this.responseModes.delete(executionId);
			}
		}

		if (this.concurrencyControl && typeof this.concurrencyControl.removeAll === 'function') {
			await this.concurrencyControl.removeAll(toCancel);
		}

		let count = 0;
		while (Object.keys(this.activeExecutions).length !== 0) {
			if (count++ % 4 === 0) {
				this.logger.info(`Waiting for ${Object.keys(this.activeExecutions).length} active executions to finish...`);
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}

	getExecutionOrFail(executionId) {
		const execution = this.activeExecutions[String(executionId)];
		if (!execution) {
			throw new ExecutionNotFoundError(String(executionId));
		}
		return execution;
	}
}
