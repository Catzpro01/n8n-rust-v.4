/**
 * Assigns pairedItem information to node output items by matching them with input items.
 * Implements the exact 2.9.4 rules from WorkflowExecute.assignPairedItems (L2581-2638).
 *
 * Rules:
 * 1. Output items that already have pairedItem set are NOT modified (Invariant I5).
 * 2. isSingleInputAndOutput: 1 input branch, exactly 1 input item -> unassigned outputs get { item: 0 }.
 * 3. isSameNumberOfItems: 1 output branch, 1 input branch, out.length === in.length -> output[i] gets { item: i }.
 * 4. isSingleOutput: 1 output branch with 1 item, from >1 input items -> gets { item: 0 }.
 * 5. In all other cases (e.g. N inputs -> 2N outputs without explicit pairedItem), unassigned items remain undefined.
 */
export function assignPairedItems(nodeSuccessData, executionData) {
	if (nodeSuccessData?.length && executionData?.data?.main) {
		const mainInputs = executionData.data.main;
		const isSingleInputAndOutput =
			mainInputs.length === 1 && mainInputs[0]?.length === 1;

		const isSameNumberOfItems =
			nodeSuccessData.length === 1 &&
			mainInputs.length === 1 &&
			mainInputs[0]?.length === nodeSuccessData[0]?.length;

		const isSingleOutput =
			nodeSuccessData.length === 1 &&
			nodeSuccessData[0]?.length === 1 &&
			mainInputs.length === 1 &&
			(mainInputs[0]?.length ?? 0) > 1;

		checkOutputData: for (const outputData of nodeSuccessData) {
			if (outputData === null) {
				continue;
			}
			for (const [index, item] of outputData.entries()) {
				if (item.pairedItem === undefined) {
					if (isSingleInputAndOutput) {
						item.pairedItem = { item: 0 };
					} else if (isSameNumberOfItems) {
						item.pairedItem = { item: index };
					} else if (isSingleOutput) {
						item.pairedItem = { item: 0 };
					} else {
						break checkOutputData;
					}
				}
			}
		}
	}

	return nodeSuccessData ?? null;
}

/**
 * Prepares input items before a node executes by stamping pairedItem: { item: itemIndex, input: inputIndex || undefined }.
 * Preserves sourceOverwrite if provided.
 */
export function prepareInputPairedItems(executionData, resolveSourceOverwrite) {
	if (!executionData?.data) return executionData;
	const newTaskDataConnections = {};

	for (const connectionType of Object.keys(executionData.data)) {
		const connData = executionData.data[connectionType];
		if (!Array.isArray(connData)) {
			newTaskDataConnections[connectionType] = connData;
			continue;
		}

		newTaskDataConnections[connectionType] = connData.map((input, inputIndex) => {
			if (input === null || !Array.isArray(input)) {
				return input;
			}

			return input.map((item, itemIndex) => {
				const sourceOverwrite = resolveSourceOverwrite
					? resolveSourceOverwrite(item, executionData)
					: item.pairedItem?.sourceOverwrite;

				if (sourceOverwrite) {
					return {
						...item,
						pairedItem: {
							item: itemIndex,
							input: inputIndex || undefined,
							sourceOverwrite,
						},
					};
				}

				return {
					...item,
					pairedItem: {
						item: itemIndex,
						input: inputIndex || undefined,
					},
				};
			});
		});
	}

	return {
		...executionData,
		data: newTaskDataConnections,
	};
}

/**
 * When node.alwaysOutputData === true and no output is produced,
 * generates a single empty item with pairedItem containing every input item.
 */
export function applyAlwaysOutputData(nodeSuccessData, executionData) {
	if (!nodeSuccessData?.[0]?.[0] && executionData?.node?.alwaysOutputData === true) {
		const pairedItem = [];

		if (executionData.data?.main) {
			executionData.data.main.forEach((inputData, inputIndex) => {
				if (!inputData) return;
				inputData.forEach((_item, itemIndex) => {
					pairedItem.push({
						item: itemIndex,
						input: inputIndex,
					});
				});
			});
		}

		const result = nodeSuccessData ? [...nodeSuccessData] : [];
		result[0] = [
			{
				json: {},
				pairedItem,
			},
		];
		return result;
	}

	return nodeSuccessData;
}
