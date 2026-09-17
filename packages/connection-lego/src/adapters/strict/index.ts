/**
 * Port adapter — `strict` mode.
 *
 * No reference runtime on the module graph. The six owned source files are vendored
 * VERBATIM from reference/n8n/packages/workflow/src (only the `../interfaces` import path
 * is rewritten to ../../../kernel/vocabulary). test/01-boundary.test.mjs proves the bodies are
 * byte-identical to the pinned reference. This is directory decoupling, not a rewrite.
 */
import type { ConnectionLegoPorts } from '../../ports/contracts.ts';
import { getConnectedNodes } from './vendored/get-connected-nodes.ts';
import { getChildNodes } from './vendored/get-child-nodes.ts';
import { getParentNodes } from './vendored/get-parent-nodes.ts';
import { mapConnectionsByDestination } from './vendored/map-connections-by-destination.ts';
import * as graph from './vendored/graph-utils.ts';
import { compareConnections } from './vendored/connections-diff.ts';

export const ports: ConnectionLegoPorts = {
	traversal: { getConnectedNodes, getChildNodes, getParentNodes, mapConnectionsByDestination },
	graph: {
		buildAdjacencyList: graph.buildAdjacencyList,
		getInputEdges: graph.getInputEdges,
		getOutputEdges: graph.getOutputEdges,
		getRootNodes: graph.getRootNodes,
		getLeafNodes: graph.getLeafNodes,
		hasPath: graph.hasPath,
		parseExtractableSubgraphSelection: graph.parseExtractableSubgraphSelection,
	},
	diff: { compareConnections },
};
export default ports;
