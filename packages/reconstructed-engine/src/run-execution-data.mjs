/**
 * Run Execution Data — reconstructed 1:1 from the pinned reference (n8n 2.9.4).
 *
 * Provenance:
 *   packages/workflow/src/run-execution-data/run-execution-data.v0.ts:19-57  (shape)
 *   packages/workflow/src/run-execution-data/run-execution-data.v1.ts:20-56  (shape)
 *   packages/workflow/src/run-execution-data/run-execution-data.v1.ts:58-84  runExecutionDataV0ToV1
 *   packages/workflow/src/run-execution-data/run-execution-data.ts:25-47    migrateRunExecutionData
 *   packages/workflow/src/run-execution-data-factory.ts:48-96               createRunExecutionData
 *   packages/workflow/src/run-execution-data-factory.ts:101-111             createEmptyRunExecutionData
 *   packages/workflow/src/run-execution-data-factory.ts:113-166             createErrorExecutionData
 *
 * TS-only artefacts that carry no runtime behaviour and are therefore NOT part of
 * this port: the `__brand` symbol on `IRunExecutionData` (run-execution-data.ts:20,23-25)
 * and the `as unknown as` casts. The brand exists purely so the compiler forces
 * construction through the factory; the JS port reproduces the enforcement that
 * matters at runtime by exporting no other construction path.
 */

import { ApplicationError } from './errors.mjs';

/**
 * packages/workflow/src/run-execution-data/run-execution-data.v1.ts:58
 *
 * DIFF (v0 → v1): `startData.destinationNode` / `startData.originalDestinationNode`
 * become structured `{ nodeName, mode }` objects instead of bare node names.
 */
export function runExecutionDataV0ToV1(data) {
	const destinationNodeV0 = data.startData?.destinationNode;
	const originalDestinationNodeV0 = data.startData?.originalDestinationNode;

	return {
		...data,
		version: 1,
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
 * packages/workflow/src/run-execution-data/run-execution-data.ts:29
 *
 * Note the deliberate fall-through: version 0 (and a *missing* version, which
 * means 0) migrates and is then validated as version 1. Any other version
 * throws with the exact reference message.
 */
export function migrateRunExecutionData(data) {
	switch (data.version) {
		case 0:
		case undefined: // Missing version means version 0
			data = runExecutionDataV0ToV1(data);
		// Fall through to subsequent versions as they're added.
	}

	if (data.version !== 1) {
		throw new Error(`Unsupported IRunExecutionData version: ${data.version}`);
	}

	return data;
}

/**
 * packages/workflow/src/run-execution-data-factory.ts:48
 *
 * Every `??` / `=== null` branch below is behavioural, not stylistic:
 *  - `executionData: null`        → `executionData` is `undefined` (not `{}`)
 *  - `resultData.runData: null`   → `runData` is `undefined` (not `{}`)
 *  - `waitingExecutionSource`     → defaults to `{}`, NOT `null`, even though the
 *                                   interface says `IWaitingForExecutionSource | null`
 *                                   (reference bug kept verbatim; see the
 *                                   `@ts-expect-error CAT-752` on the line above
 *                                   the `runData` default).
 */
export function createRunExecutionData(options = {}) {
	return {
		version: 1,
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
 * packages/workflow/src/run-execution-data-factory.ts:101
 * Used by expression evaluation when nothing is executing yet.
 */
export function createEmptyRunExecutionData() {
	return {
		version: 1,
		resultData: {
			runData: {},
		},
	};
}

/**
 * packages/workflow/src/run-execution-data-factory.ts:113
 * Run data for "the node failed and we must store an execution record" scenarios.
 */
export function createErrorExecutionData(node, error) {
	return {
		version: 1,
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
						main: [
							[
								{
									json: {},
									pairedItem: {
										item: 0,
									},
								},
							],
						],
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
 * packages/workflow/src/node-helpers.ts:505 (getContext) — the run-data accessor
 * the node execution context needs. Kept next to the run data because it reads
 * `runExecutionData.executionData.contextData` and, like the reference, MUTATES
 * the run data on read: a missing key is created before being returned.
 */
export function getContext(runExecutionData, type, node) {
	if (runExecutionData.executionData === undefined) {
		// TODO: Should not happen leave it for test now
		throw new ApplicationError('`executionData` is not initialized');
	}

	let key;
	if (type === 'flow') {
		key = 'flow';
	} else if (type === 'node') {
		if (node === undefined) {
			// @TODO: What does this mean?
			throw new ApplicationError(
				'The request data of context type "node" the node parameter has to be set!',
			);
		}
		key = `node:${node.name}`;
	} else {
		throw new ApplicationError('Unknown context type. Only `flow` and `node` are supported.', {
			extra: { contextType: type },
		});
	}

	if (runExecutionData.executionData.contextData[key] === undefined) {
		runExecutionData.executionData.contextData[key] = {};
	}

	return runExecutionData.executionData.contextData[key];
}
