/**
 * Error workflow execution and execution progress persistence.
 *
 * Reconstruction targets (n8n 2.9.4):
 *   reference/n8n/packages/cli/src/execution-lifecycle/execute-error-workflow.ts
 *   reference/n8n/packages/cli/src/execution-lifecycle/save-execution-progress.ts
 */

/**
 * Checks if there was an error in execution and dispatches the configured error workflow.
 *
 * @param {object} workflowData The workflow which got executed (IWorkflowBase)
 * @param {object} fullRunData The run which produced the error (IRun)
 * @param {string} mode WorkflowExecuteMode
 * @param {string} [executionId] The id the execution got saved as
 * @param {string} [retryOf]
 * @param {object} [context={}] Dependencies: logger, urlService, workflowExecutionService, ownershipService, errorTriggerType
 */
export function executeErrorWorkflow(
	workflowData,
	fullRunData,
	mode,
	executionId,
	retryOf,
	context = {},
) {
	const logger = context.logger ?? { debug() {}, info() {}, warn() {}, error() {} };
	const urlService = context.urlService ?? { getWebhookBaseUrl: () => 'http://localhost:5678/' };
	const workflowExecutionService = context.workflowExecutionService;
	const ownershipService = context.ownershipService;
	const errorTriggerType = context.errorTriggerType ?? 'n8n-nodes-base.errorTrigger';
	const errorReporter = context.errorReporter ?? { error() {} };

	let pastExecutionUrl;
	if (executionId !== undefined) {
		pastExecutionUrl = `${urlService.getWebhookBaseUrl()}workflow/${workflowData?.id}/executions/${executionId}`;
	}

	if (fullRunData?.data?.resultData?.error !== undefined) {
		let workflowErrorData;
		const workflowId = workflowData?.id;

		if (executionId) {
			workflowErrorData = {
				execution: {
					id: executionId,
					url: pastExecutionUrl,
					error: fullRunData.data.resultData.error,
					lastNodeExecuted: fullRunData.data.resultData.lastNodeExecuted,
					mode,
					retryOf,
					executionContext: fullRunData.data.executionData?.runtimeData,
				},
				workflow: {
					id: workflowId,
					name: workflowData?.name,
				},
			};
		} else {
			workflowErrorData = {
				trigger: {
					error: fullRunData.data.resultData.error,
					mode,
				},
				workflow: {
					id: workflowId,
					name: workflowData?.name,
				},
			};
		}

		const errorWorkflow = workflowData?.settings?.errorWorkflow;
		// To avoid infinite loops: do not run error workflow if the error-workflow itself failed and is its own error-workflow
		if (errorWorkflow && !(mode === 'error' && workflowId && errorWorkflow === workflowId)) {
			logger.debug('Start external error workflow', {
				executionId,
				errorWorkflowId: errorWorkflow,
				workflowId,
			});

			// Manual executions without a saved workflow id do not trigger error workflows
			if (!workflowId) {
				return;
			}

			const runErrorWf = (project) => {
				if (workflowExecutionService?.executeErrorWorkflow) {
					workflowExecutionService
						.executeErrorWorkflow(errorWorkflow, workflowErrorData, project)
						?.catch?.((err) => {
							errorReporter.error(err);
							logger.error(
								`Could not execute ErrorWorkflow for execution ID ${executionId} because of error`,
								{ executionId, errorWorkflowId: errorWorkflow, workflowId, error: err },
							);
						});
				}
			};

			if (ownershipService?.getWorkflowProjectCached) {
				ownershipService
					.getWorkflowProjectCached(workflowId)
					.then((project) => runErrorWf(project))
					.catch((error) => {
						errorReporter.error(error);
						logger.error(
							`Could not execute ErrorWorkflow for execution ID ${executionId} because of error querying the workflow owner`,
							{ executionId, errorWorkflowId: errorWorkflow, workflowId, error },
						);
					});
			} else {
				runErrorWf(undefined);
			}
		} else if (
			mode !== 'error' &&
			workflowId !== undefined &&
			workflowData?.nodes?.some?.((node) => node.type === errorTriggerType)
		) {
			logger.debug('Start internal error workflow', { executionId, workflowId });

			const runInternalErrorWf = (project) => {
				if (workflowExecutionService?.executeErrorWorkflow) {
					workflowExecutionService
						.executeErrorWorkflow(workflowId, workflowErrorData, project)
						?.catch?.((err) => {
							errorReporter.error(err);
							logger.error(
								`Could not execute internal ErrorWorkflow for execution ID ${executionId}`,
								{ executionId, workflowId, error: err },
							);
						});
				}
			};

			if (ownershipService?.getWorkflowProjectCached) {
				ownershipService
					.getWorkflowProjectCached(workflowId)
					.then((project) => runInternalErrorWf(project))
					.catch((error) => {
						errorReporter.error(error);
					});
			} else {
				runInternalErrorWf(undefined);
			}
		}
	}
}

/**
 * Saves execution progress to database after each node executes.
 *
 * @param {string} workflowId
 * @param {string} executionId
 * @param {string} nodeName
 * @param {object} _data ITaskData
 * @param {object} executionData IRunExecutionData
 * @param {object} [options={}]
 */
export async function saveExecutionProgress(
	workflowId,
	executionId,
	nodeName,
	_data,
	executionData,
	options = {},
) {
	const logger = options.logger ?? { debug() {}, info() {}, warn() {}, error() {} };
	const executionRepository = options.executionRepository;
	const errorReporter = options.errorReporter ?? { error() {} };

	try {
		logger.debug(`Save execution progress to database for execution ID ${executionId} `, {
			executionId,
			nodeName,
		});

		if (executionData?.resultData) {
			executionData.resultData.lastNodeExecuted = nodeName;
		}

		if (executionRepository?.updateExistingExecution) {
			const updated = await executionRepository.updateExistingExecution(
				executionId,
				{ data: executionData, status: 'running' },
				{ requireNotFinished: true, requireNotCanceled: true },
			);

			if (!updated) {
				logger.debug(
					`Skipped saving execution progress to database for execution ID ${executionId} - execution already finished or canceled`,
					{ executionId, nodeName },
				);
			}
		}
	} catch (e) {
		const error = e instanceof Error ? e : new Error(`${e}`);
		errorReporter.error(error);
		logger.error(
			`Failed saving execution progress to database for execution ID ${executionId} (hookFunctionsSaveProgress, nodeExecuteAfter)`,
			{ error, executionId, workflowId },
		);
	}
}
