/**
 * Execution Data LEGO — paired-item and source-data rules.
 *
 * These are the *rules* the engine enforces, lifted out of
 * `packages/core/src/execution-engine/workflow-execute.ts` (n8n 2.9.4) into
 * pure functions. The contract reserves ownership of the rules (not of the
 * `WorkflowExecute` loop) for this LEGO — contracts/execution-data.contract.md §7.
 *
 *   resolveSourceOverwrite  : .../utils/resolve-source-overwrite.ts
 *   rewriteInputPairedItems : workflow-execute.ts:1514-1557  (I3)
 *   assignPairedItems       : workflow-execute.ts:2581-2637  (I4)
 *   buildSourceData         : workflow-execute.ts:804-812 and :733-741 and :499-503 (I6/I7)
 *   alwaysOutputDataItem    : workflow-execute.ts:1741-1764  (I9)
 */

import { MAIN_CONNECTION_TYPE } from './constants.mjs';

/**
 * `resolve-source-overwrite.ts` — verbatim.
 *
 * Only tool executions carry a source overwrite; for everything else the
 * function returns `null` and the plain `{ item, input }` shape is written.
 */
export function resolveSourceOverwrite(item, executionData) {
	const isToolExecution = !!executionData?.metadata?.preserveSourceOverwrite;
	if (!isToolExecution) {
		return null;
	}
	if (executionData.metadata?.preservedSourceOverwrite) {
		return executionData.metadata.preservedSourceOverwrite;
	}
	if (typeof item?.pairedItem === 'object' && 'sourceOverwrite' in item.pairedItem) {
		return item.pairedItem.sourceOverwrite;
	}
	return null;
}

/**
 * I3 — `workflow-execute.ts:1514-1557`, verbatim.
 *
 * Immediately before a node runs, EVERY input item gets its `pairedItem`
 * replaced by `{ item: <index within that input>, input: <inputIndex || undefined> }`.
 *
 * FROZEN QUIRK (P-01): `input: inputIndex || undefined` — input 0 loses the
 * `input` key entirely (it becomes `undefined` and is dropped by JSON
 * serialisation), so input 0 yields `{ item: n }` while input 1 yields
 * `{ item: n, input: 1 }`.
 * FROZEN QUIRK (P-02): a `null` input branch is passed through untouched.
 * FROZEN QUIRK (P-03): `sourceOverwrite` is threaded in only for tool
 * executions; it is merged as a third key, never as a replacement.
 */
export function rewriteInputPairedItems(executionData) {
	const newTaskDataConnections = {};
	for (const connectionType of Object.keys(executionData.data)) {
		newTaskDataConnections[connectionType] = executionData.data[connectionType].map(
			(input, inputIndex) => {
				if (input === null) {
					return input;
				}

				return input.map((item, itemIndex) => {
					const sourceOverwrite = resolveSourceOverwrite(item, executionData);
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
			},
		);
	}
	return { ...executionData, data: newTaskDataConnections };
}

/**
 * I4 — `workflow-execute.ts:2581-2637`, verbatim.
 *
 * Auto-assignment applies ONLY to items whose `pairedItem` is `undefined`
 * (I5: an explicit `pairedItem` is never overwritten). Three rules, in order:
 *   (a) exactly one input holding exactly one item  -> `{ item: 0 }`
 *   (b) single output branch with the same item count -> `{ item: index }`
 *   (c) multiple inputs collapsed into a single output item -> `{ item: 0 }`
 *   otherwise -> left `undefined`.
 *
 * FROZEN QUIRK (P-04): the rules are evaluated once and cached in
 * `isSingleInputAndOutput` / `isSameNumberOfItems` / `isSingleOutput`, but the
 * `break checkOutputData` on the first unfixable item aborts the WHOLE loop —
 * remaining outputs/items keep `pairedItem: undefined` even if rule (a) would
 * have fixed them.
 * FROZEN QUIRK (P-05): rule (b) requires `nodeSuccessData.length === 1`, so a
 * node with two output branches never gets index pairing.
 * FROZEN QUIRK (P-06): the function MUTATES the items in place (it assigns
 * `item.pairedItem = ...`) and returns the same array.
 */
export function assignPairedItems(nodeSuccessData, executionData) {
	if (nodeSuccessData?.length) {
		const isSingleInputAndOutput =
			executionData.data.main.length === 1 && executionData.data.main[0]?.length === 1;

		const isSameNumberOfItems =
			nodeSuccessData.length === 1 &&
			executionData.data.main.length === 1 &&
			executionData.data.main[0]?.length === nodeSuccessData[0].length;

		// Multiple inputs → single output (e.g. aggregating items into one)
		const isSingleOutput =
			nodeSuccessData.length === 1 &&
			nodeSuccessData[0]?.length === 1 &&
			executionData.data.main.length === 1 &&
			(executionData.data.main[0]?.length ?? 0) > 1;

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
						// In all other cases autofixing is not possible
						break checkOutputData;
					}
				}
			}
		}
	}

	return nodeSuccessData ?? null;
}

/**
 * I6/I7 — `workflow-execute.ts:499-503, 733-741, 804-812`, verbatim.
 *
 * FROZEN QUIRK (P-07): `outputIndex`/`runIndex` are normalised with
 * `?? undefined`, so index 0 survives as `0` while `undefined` stays absent
 * from the JSON form. A start node records `source: []` (never
 * `[{ previousNode: undefined }]`).
 */
export function buildSourceData({ previousNode, previousNodeOutput, previousNodeRun }) {
	return {
		previousNode,
		previousNodeOutput: previousNodeOutput ?? undefined,
		previousNodeRun: previousNodeRun ?? undefined,
	};
}

/**
 * I9 — `workflow-execute.ts:1741-1764`.
 *
 * When a node produced no data at all and declares `alwaysOutputData: true`,
 * the engine synthesises one empty item whose `pairedItem` is an ARRAY covering
 * every input item of every input branch.
 *
 * FROZEN QUIRK (P-08): unlike I3, `input` is written unconditionally here
 * (`input: inputIndex`), so input 0 becomes `{ item: 0, input: 0 }` instead of
 * the bare `{ item: 0 }` produced by the I3 rewrite.
 */
export function alwaysOutputDataItem(executionData) {
	const pairedItem = [];

	executionData.data[MAIN_CONNECTION_TYPE].forEach((inputData, inputIndex) => {
		if (!inputData) {
			return;
		}
		inputData.forEach((_item, itemIndex) => {
			pairedItem.push({
				item: itemIndex,
				input: inputIndex,
			});
		});
	});

	return [{ json: {}, pairedItem }];
}

/**
 * Whether the engine treats a node result as "empty branch" (`[[]]` / `null`
 * / missing first item) — the precondition for the alwaysOutputData synthesis
 * at workflow-execute.ts:1740.
 */
export function isEmptyNodeResult(nodeSuccessData) {
	return !nodeSuccessData?.[0]?.[0];
}
