/**
 * Execution save settings resolution.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/cli/src/execution-lifecycle/to-save-settings.ts
 */

export const DEFAULT_SAVE_CONFIG = Object.freeze({
	saveDataOnError: 'all',
	saveDataOnSuccess: 'all',
	saveDataManualExecutions: true,
	saveExecutionProgress: false,
});

/**
 * Resolves whether an execution should be persisted to storage based on
 * workflow settings and global defaults.
 *
 * @param {object|null} [workflowSettings={}] Workflow-specific settings
 * @param {object} [config={}] Global execution config defaults
 * @returns {{ error: boolean, success: boolean, manual: boolean, progress: boolean }}
 */
export function toSaveSettings(workflowSettings = {}, config = {}) {
	const DEFAULTS = {
		ERROR: config?.executions?.saveDataOnError ?? DEFAULT_SAVE_CONFIG.saveDataOnError,
		SUCCESS: config?.executions?.saveDataOnSuccess ?? DEFAULT_SAVE_CONFIG.saveDataOnSuccess,
		MANUAL: config?.executions?.saveDataManualExecutions ?? DEFAULT_SAVE_CONFIG.saveDataManualExecutions,
		PROGRESS: config?.executions?.saveExecutionProgress ?? DEFAULT_SAVE_CONFIG.saveExecutionProgress,
	};

	const {
		saveDataErrorExecution = DEFAULTS.ERROR,
		saveDataSuccessExecution = DEFAULTS.SUCCESS,
		saveManualExecutions = DEFAULTS.MANUAL,
		saveExecutionProgress = DEFAULTS.PROGRESS,
	} = workflowSettings ?? {};

	return {
		error:
			saveDataErrorExecution === 'DEFAULT'
				? DEFAULTS.ERROR === 'all'
				: saveDataErrorExecution === 'all',
		success:
			saveDataSuccessExecution === 'DEFAULT'
				? DEFAULTS.SUCCESS === 'all'
				: saveDataSuccessExecution === 'all',
		manual:
			saveManualExecutions === 'DEFAULT'
				? Boolean(DEFAULTS.MANUAL)
				: Boolean(saveManualExecutions),
		progress:
			saveExecutionProgress === 'DEFAULT'
				? Boolean(DEFAULTS.PROGRESS)
				: Boolean(saveExecutionProgress),
	};
}
