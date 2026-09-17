/**
 * 1:1 port of reference/n8n/packages/cli/src/execution-lifecycle/to-save-settings.ts
 * (full file).
 *
 * Deviation D-PERSIST-05: the four `Container.get(GlobalConfig).executions.save*`
 * defaults are read from port P-PERSIST-CONFIG (`getPersistenceConfig().executions`).
 * Reference config defaults are `all / all / true / true` — identical via the port default.
 *
 * Return whether a workflow execution is configured to be saved or not:
 *
 * - `error`: Whether to save failed executions in production.
 * - `success`: Whether to successful executions in production.
 * - `manual`: Whether to save successful or failed manual executions.
 * - `progress`: Whether to save execution progress, i.e. after each node's execution.
 */
import { getPersistenceConfig } from '../ports.mjs';

export function toSaveSettings(workflowSettings = {}) {
	const DEFAULTS = {
		ERROR: getPersistenceConfig().executions.saveDataOnError,
		SUCCESS: getPersistenceConfig().executions.saveDataOnSuccess,
		MANUAL: getPersistenceConfig().executions.saveDataManualExecutions,
		PROGRESS: getPersistenceConfig().executions.saveExecutionProgress,
	};

	const {
		saveDataErrorExecution = DEFAULTS.ERROR,
		saveDataSuccessExecution = DEFAULTS.SUCCESS,
		saveManualExecutions = DEFAULTS.MANUAL,
		saveExecutionProgress = DEFAULTS.PROGRESS,
	} = workflowSettings ?? {};

	return {
		error: saveDataErrorExecution === 'DEFAULT' ? DEFAULTS.ERROR : saveDataErrorExecution === 'all',
		success:
			saveDataSuccessExecution === 'DEFAULT'
				? DEFAULTS.SUCCESS
				: saveDataSuccessExecution === 'all',
		manual: saveManualExecutions === 'DEFAULT' ? DEFAULTS.MANUAL : saveManualExecutions,
		progress: saveExecutionProgress === 'DEFAULT' ? DEFAULTS.PROGRESS : saveExecutionProgress,
	};
}
