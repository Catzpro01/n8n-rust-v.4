/**
 * Creates a complete IRunExecutionData object with all properties initialized.
 */
export function createRunExecutionData(options = {}) {
	return {
		version: 1,
		startData: options.startData ?? {},
		resultData: {
			error: options.resultData?.error,
			runData:
				options.resultData?.runData === null
					? undefined
					: (options.resultData?.runData ?? {}),
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
 * Creates a minimal IRunExecutionData object with an empty runData field.
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
 * Creates an IRunExecutionData object for error execution scenarios.
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
 * Migrates older IRunExecutionData versions to version 1.
 */
export function migrateRunExecutionData(data) {
	if (!data || typeof data !== 'object') {
		throw new Error('Invalid run execution data');
	}

	let current = data;
	if (current.version === 0 || current.version === undefined) {
		const destinationNodeV0 = current.startData?.destinationNode;
		const originalDestinationNodeV0 = current.startData?.originalDestinationNode;

		current = {
			...current,
			version: 1,
			startData: {
				...current.startData,
				destinationNode:
					typeof destinationNodeV0 === 'string'
						? { nodeName: destinationNodeV0, mode: 'inclusive' }
						: destinationNodeV0,
				originalDestinationNode:
					typeof originalDestinationNodeV0 === 'string'
						? { nodeName: originalDestinationNodeV0, mode: 'inclusive' }
						: originalDestinationNodeV0,
			},
		};
	}

	if (current.version !== 1) {
		throw new Error(`Unsupported IRunExecutionData version: ${current.version}`);
	}

	return current;
}
