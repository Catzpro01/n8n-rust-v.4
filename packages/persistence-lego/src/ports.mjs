/**
 * Declared ports for the Persistence LEGO reconstruction (contract §12.3).
 * Every dependency the reference resolves through DI / Container is injected
 * here instead — no hidden dependency (LEGO Parallel Rule 5).
 *
 *   P-PERSIST-CONFIG    : GlobalConfig.database.type / executions.save*
 *   P-PERSIST-REPORTER  : ErrorReporter.error / Logger.info edge calls
 *
 * P-PERSIST-WORKFLOW is the consumed.mjs seam (jsonParse / migrateRunExecutionData).
 */

/** Reference defaults: packages/@n8n/config/src/configs/executions.config.ts +
 *  database.config.ts (database.type default 'sqlite'; saveDataOnError/Success 'all';
 *  saveDataManualExecutions true; saveExecutionProgress true). */
const defaultConfig = Object.freeze({
	database: { type: 'sqlite' },
	executions: {
		saveDataOnError: 'all',
		saveDataOnSuccess: 'all',
		saveDataManualExecutions: true,
		saveExecutionProgress: true,
	},
});

let current = {
	database: { ...defaultConfig.database },
	executions: { ...defaultConfig.executions },
};

/** Independent collector: records reporter/logger edge calls without a Sink. */
const silentReporter = { error: () => {}, info: () => {} };
let reporter = silentReporter;

export function setPersistenceConfig(cfg = {}) {
	current = {
		database: { ...defaultConfig.database, ...(cfg.database ?? {}) },
		executions: { ...defaultConfig.executions, ...(cfg.executions ?? {}) },
	};
}

export function getPersistenceConfig() {
	return current;
}

export function getDbType() {
	return current.database.type;
}

/** Inject the reporter port. Pass a collector { error(messageOrError, extra?), info(...) }. */
export function setPersistenceReporter(instance) {
	reporter = instance ?? silentReporter;
}

export function getPersistenceReporter() {
	return reporter;
}

/** Test helper: restore reference defaults for both ports. */
export function resetPersistencePorts() {
	setPersistenceConfig({});
	reporter = silentReporter;
}
