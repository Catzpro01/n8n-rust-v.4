/**
 * Execution Data LEGO — `IRunExecutionData` factories and version migration.
 *
 * 1:1 ports of n8n 2.9.4:
 *   packages/workflow/src/run-execution-data-factory.ts:52-163
 *   packages/workflow/src/run-execution-data/run-execution-data.v1.ts:59-76
 *   packages/workflow/src/run-execution-data/run-execution-data.ts:26-41
 *
 * The upstream functions are the ONLY sanctioned way to build an
 * `IRunExecutionData` (contract invariant I11) — the type is branded precisely
 * so that hand-built literals are rejected at compile time.
 */

import { RUN_EXECUTION_DATA_VERSION } from './constants.mjs';
import { UnsupportedRunExecutionDataVersionError } from './errors.mjs';

/**
 * `run-execution-data-factory.ts:52-89` — verbatim.
 *
 * FROZEN QUIRK (R-01): `executionData` and `resultData.runData` are opt-OUT via
 * an explicit `null`, not via `undefined`: passing `null` yields `undefined`
 * (key present, value undefined), while omitting the key yields the default
 * (`{}` / a fully initialised `executionData` object).
 * FROZEN QUIRK (R-02): `resultData.error`, `pinData`, `lastNodeExecuted` and
 * `metadata` are written unconditionally, so they appear as explicit
 * `undefined` keys in the object even when not supplied (visible in
 * `Object.keys`, invisible in `JSON.stringify`).
 * FROZEN QUIRK (R-03): `executionData.waitingExecutionSource` defaults to `{}`
 * even though the declared type is `IWaitingForExecutionSource | null`.
 */
export function createRunExecutionData(options = {}) {
	return {
		version: RUN_EXECUTION_DATA_VERSION,
		startData: options.startData ?? {},
		resultData: {
			error: options.resultData?.error,
			runData:
				options.resultData?.runData === null ? undefined : (options.resultData?.runData ?? {}),
			pinData: options.resultData?.pinData,
			lastNodeExecuted: options.resultData?.lastNodeExecuted,
			metadata: options.resultData?.metadata,
		},
		executionData:
			options.executionData === null
				? undefined
				: {
						contextData: options.executionData?.contextData ?? {},
						nodeExecutionStack: options.executionData?.nodeExecutionStack ?? [],
						metadata: options.executionData?.metadata ?? {},
						waitingExecution: options.executionData?.waitingExecution ?? {},
						waitingExecutionSource: options.executionData?.waitingExecutionSource ?? {},
						runtimeData: options.executionData?.runtimeData,
					},
		parentExecution: options.parentExecution,
		validateSignature: options.validateSignature,
		waitTill: options.waitTill,
		manualData: options.manualData,
		pushRef: options.pushRef,
	};
}

/**
 * `run-execution-data-factory.ts:95-102` — verbatim.
 *
 * The minimal shape used when nothing is executing (e.g. expression
 * evaluation). Note the absence of `startData` and `executionData` — this is
 * the ONLY factory that omits them.
 */
export function createEmptyRunExecutionData() {
	return {
		version: RUN_EXECUTION_DATA_VERSION,
		resultData: {
			runData: {},
		},
	};
}

/**
 * `run-execution-data-factory.ts:110-163` — verbatim.
 *
 * FROZEN QUIRK (R-04): the synthetic stack entry hard-codes a single start item
 * `{ json: {}, pairedItem: { item: 0 } }` on output 0.
 * FROZEN QUIRK (R-05): `startData.destinationNode` is `{ nodeName, mode: 'inclusive' }`
 * and `runNodeFilter` is `[node.name]` — the error record is scoped to the
 * failing node only.
 * FROZEN QUIRK (R-06): all timings are `0` and `source` is `[]`.
 */
export function createErrorExecutionData(node, error) {
	return {
		version: RUN_EXECUTION_DATA_VERSION,
		startData: {
			destinationNode: {
				nodeName: node.name,
				mode: 'inclusive',
			},
			runNodeFilter: [node.name],
		},
		executionData: {
			contextData: {},
			metadata: {},
			nodeExecutionStack: [
				{
					node,
					data: {
						main: [[{ json: {}, pairedItem: { item: 0 } }]],
					},
					source: null,
				},
			],
			waitingExecution: {},
			waitingExecutionSource: {},
		},
		resultData: {
			runData: {
				[node.name]: [
					{
						startTime: 0,
						executionIndex: 0,
						executionTime: 0,
						error,
						source: [],
					},
				],
			},
			error,
			lastNodeExecuted: node.name,
		},
	};
}

/**
 * `run-execution-data.v1.ts:59-76` — verbatim.
 *
 * FROZEN QUIRK (R-07): the v0 -> v1 lift ALWAYS creates a `startData` object,
 * even when the v0 record had none, and always writes BOTH
 * `destinationNode` and `originalDestinationNode` keys — as explicit
 * `undefined` when the v0 strings were absent. A v0 record therefore gains
 * `{ startData: { destinationNode: undefined, originalDestinationNode: undefined } }`.
 * FROZEN QUIRK (R-08): the lift is a shallow spread — every other key
 * (including `resultData`, `executionData`, `manualData`) is carried over by
 * reference, and `version` is overwritten with `1`.
 */
export function runExecutionDataV0ToV1(data) {
	const destinationNodeV0 = data.startData?.destinationNode;
	const originalDestinationNodeV0 = data.startData?.originalDestinationNode;

	return {
		...data,
		version: RUN_EXECUTION_DATA_VERSION,
		startData: {
			...data.startData,
			destinationNode: destinationNodeV0
				? {
						nodeName: destinationNodeV0,
						mode: 'inclusive',
					}
				: undefined,
			originalDestinationNode: originalDestinationNodeV0
				? {
						nodeName: originalDestinationNodeV0,
						mode: 'inclusive',
					}
				: undefined,
		},
	};
}

/**
 * `run-execution-data.ts:26-41` — verbatim.
 *
 * FROZEN QUIRK (R-09): the `switch` has NO `break` between `case 0` and
 * `case undefined` — "missing version means version 0" — and then falls
 * through to the version check, so a v0 record is lifted and immediately
 * re-validated.
 * FROZEN QUIRK (R-10): an unknown version raises a plain `Error` with the
 * message `Unsupported IRunExecutionData version: <n>`; a record whose version
 * is `undefined` is ACCEPTED (it is treated as v0), never rejected.
 */
export function migrateRunExecutionData(data) {
	switch (data.version) {
		case 0:
		case undefined: // Missing version means version 0
			data = runExecutionDataV0ToV1(data);
		// Fall through to subsequent versions as they're added.
	}

	if (data.version !== RUN_EXECUTION_DATA_VERSION) {
		throw new UnsupportedRunExecutionDataVersionError(data.version);
	}

	return data;
}
