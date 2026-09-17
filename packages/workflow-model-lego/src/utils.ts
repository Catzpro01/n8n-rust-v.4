/**
 * Small helpers copied verbatim from `reference/n8n/packages/workflow/src/utils.ts`.
 *
 * `dedupe` is used by `Workflow.searchNodesBFS` to merge the `indicies` of a node reached by more
 * than one path. Reference: `utils.ts:477-479`.
 */
export function dedupe<T>(arr: T[]): T[] {
	return [...new Set(arr)];
}
