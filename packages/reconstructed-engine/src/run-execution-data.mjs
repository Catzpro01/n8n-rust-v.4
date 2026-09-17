/**
 * 1:1 port of reference/n8n/packages/workflow/src/run-execution-data-factory.ts
 * (n8n 2.9.4 / @n8n/workflow 2.9.1) — createRunExecutionData.
 *
 * TASK-PIPE-02 · spec: docs/isolation/execution-loop-spec.md §2.
 * Deviations: none (structure and defaults are identical).
 */

/**
 * @param {object} [options]
 * @param {object} [options.startData]
 * @param {object} [options.startData.destinationNode]
 * @param {string[]} [options.startData.runNodeFilter]
 * @param {object} [options.resultData]
 * @param {object} [options.resultData.error]
 * @param {object|null} [options.resultData.runData]
 * @param {object} [options.resultData.pinData]
 * @param {string} [options.resultData.lastNodeExecuted]
 * @param {object} [options.resultData.metadata]
 * @param {object|null} [options.executionData]
 * @param {object} [options.executionData.contextData]
 * @param {Array} [options.executionData.nodeExecutionStack]
 * @param {object} [options.executionData.metadata]
 * @param {object} [options.executionData.waitingExecution]
 * @param {object} [options.executionData.waitingExecutionSource]
 * @param {object} [options.parentExecution]
 * @param {Date} [options.waitTill]
 */
export function createRunExecutionData(options = {}) {
	const opts = options ?? {};
	return {
		version: 1,
		startData: opts.startData ?? {},
		resultData: {
			error: opts.resultData?.error,
			runData:
				opts.resultData?.runData === null ? undefined : (opts.resultData?.runData ?? {}),
			pinData: opts.resultData?.pinData,
			lastNodeExecuted: opts.resultData?.lastNodeExecuted,
			metadata: opts.resultData?.metadata,
		},
		executionData:
			opts.executionData === null
				? undefined
				: {
						contextData: opts.executionData?.contextData ?? {},
						nodeExecutionStack: opts.executionData?.nodeExecutionStack ?? [],
						metadata: opts.executionData?.metadata ?? {},
						waitingExecution: opts.executionData?.waitingExecution ?? {},
						waitingExecutionSource: opts.executionData?.waitingExecutionSource ?? {},
						runtimeData: opts.executionData?.runtimeData,
					},
		parentExecution: opts.parentExecution,
		validateSignature: opts.validateSignature,
		waitTill: opts.waitTill,
		manualData: opts.manualData,
		pushRef: opts.pushRef,
	};
}

/** Minimal run-execution-data (only empty runData) — for expression-only evaluation. */
export function createEmptyRunExecutionData() {
	return {
		version: 1,
		resultData: {
			runData: {},
		},
	};
}
