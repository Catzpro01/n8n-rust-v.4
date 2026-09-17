/**
 * Workflow Model LEGO — public surface (the seam).
 *
 * This is what downstream LEGOs (02 Node Model, 03 Connection, 04 Validation)
 * and the native JavaScript/TypeScript reconstruction consume. Nothing else of
 * this package is part of the boundary.
 *
 * PHASE 2 STATUS
 *   - The model is ISOLATED: its sources are import-closed behind the declared
 *     ports in `src/ports/`, proven by the isolated build in `.extract/`.
 *   - The running implementation is still the pinned reference runtime
 *     (`n8n-workflow@2.9.1` — the artifact n8n 2.9.4 ships). This file is the
 *     single place that must change when a replacement lands.
 *   - RUST: FORBIDDEN by PROJECT_RULES.md #1. “Isolated” does not mean “reconstructed”.
 *
 * Surface parity is enforced by test/surface-parity.test.mjs: these exports must
 * equal manifest.publicSurface and the isolated unit's generated model-api.
 */
export { compareConnections, type ConnectionsDiff, type INodeConnectionsDiff } from 'n8n-workflow/dist/cjs/connections-diff';
export {
	buildAdjacencyList,
	getInputEdges,
	getLeafNodes,
	getOutputEdges,
	getRootNodes,
	hasPath,
	parseExtractableSubgraphSelection,
	type IConnectionAdjacencyList,
	type ExtractableErrorResult,
	type ExtractableSubgraphData,
} from 'n8n-workflow/dist/cjs/graph/graph-utils';
export {
	Workflow,
	getChildNodes,
	getConnectedNodes,
	getNodeByName,
	getParentNodes,
	mapConnectionsByDestination,
	calculateWorkflowChecksum,
	type WorkflowParameters,
	type WorkflowSnapshot,
} from 'n8n-workflow';
