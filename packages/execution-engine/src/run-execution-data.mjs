/**
 * IRunExecutionData factories.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/workflow/src/run-execution-data-factory.ts
 *   reference/n8n/packages/workflow/src/run-execution-data/run-execution-data.v1.ts
 *
 * Contract: contracts/execution-data.contract.md §1 + invariant I11
 * ("IRunExecutionData is only created through the factories; version is 1").
 */

export const RUN_EXECUTION_DATA_VERSION = 1;

/**
 * `createEmptyRunExecutionData()` — the execution-side skeleton only.
 * Deliberately has no `resultData`: upstream builds it before the first node runs
 * and the engine adds `runData` entries lazily.
 */
export function createEmptyRunExecutionData() {
	return {
		version: RUN_EXECUTION_DATA_VERSION,
		startData: {},
		resultData: {
			runData: {},
			pinData: undefined,
			lastNodeExecuted: undefined,
			error: undefined,
		},
		executionData: {
			contextData: {},
			nodeExecutionStack: [],
			waitingExecution: {},
			waitingExecutionSource: {},
			metadata: {},
		},
	};
}

/**
 * `createRunExecutionData()` — merge user-supplied overrides onto the skeleton.
 * Shallow merge at the top level, then one level deeper for the two nested
 * containers, matching how upstream spreads its `Partial<IRunExecutionData>`.
 */
export function createRunExecutionData(overrides = {}) {
	const base = createEmptyRunExecutionData();
	const {
		resultData: resultOverrides,
		executionData: executionOverrides,
		startData: startOverrides,
		...rest
	} = overrides;

	return {
		...base,
		...rest,
		startData: { ...base.startData, ...(startOverrides ?? {}) },
		resultData: { ...base.resultData, ...(resultOverrides ?? {}) },
		executionData: {
			...base.executionData,
			...(executionOverrides ?? {}),
			contextData: {
				...base.executionData.contextData,
				...(executionOverrides?.contextData ?? {}),
			},
			metadata: executionOverrides?.metadata ?? base.executionData.metadata,
		},
	};
}

/**
 * `createErrorExecutionData()` — what the engine returns when the execution
 * could not even start (upstream `workflow-execute.ts` L1440-1470 sets the same
 * shape by hand before re-throwing).
 */
export function createErrorExecutionData(error, { executionData, startedAt = Date.now() } = {}) {
	const runExecutionData = createRunExecutionData();
	runExecutionData.resultData.error = error;
	runExecutionData.resultData.lastNodeExecuted = executionData?.node?.name;

	if (executionData) {
		runExecutionData.resultData.runData[executionData.node.name] = [
			{
				startTime: startedAt,
				executionIndex: 0,
				executionTime: 0,
				data: { main: executionData.data?.main ?? [] },
				source: [],
				executionStatus: 'error',
				error,
				hints: [],
			},
		];
	}

	return runExecutionData;
}

/** `startData.destinationNode` helper — `{ nodeName, mode? }` upstream. */
export function createDestinationNode(nodeName, mode = 'inclusive') {
	return { nodeName, mode };
}
