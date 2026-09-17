/**
 * Port adapter — `reference` mode (default).
 * Binds the seam to the pinned reference runtime (n8n-workflow@2.9.1, the artifact n8n 2.9.4 ships).
 * Nothing is reimplemented: each symbol is the compiled reference function.
 *
 * Deep paths are required because `graph/graph-utils` (partially) and `connections-diff` are not on the
 * n8n-workflow barrel (workflow-handoff.md §2; graph-ownership-plan §1).
 */
import { join } from 'node:path';
import type { ConnectionLegoPorts } from '../../ports/contracts.ts';
import { referencePackage, referenceRequire } from '../../ports/runtime.ts';

const req = referenceRequire();
const pkgDir = referencePackage();
const deep = (rel: string) => {
	const abs = join(pkgDir, rel);
	try {
		return req(abs) as Record<string, any>;
	} catch (error) {
		throw new Error(`connection reference adapter: cannot load ${abs} (${(error as Error).message}). Set LEGO_REFERENCE_PKG.`);
	}
};

const common = deep('dist/cjs/common/index.js');
const graph = deep('dist/cjs/graph/graph-utils.js');
const diff = deep('dist/cjs/connections-diff.js');

export const ports: ConnectionLegoPorts = {
	traversal: {
		getConnectedNodes: common.getConnectedNodes,
		getChildNodes: common.getChildNodes,
		getParentNodes: common.getParentNodes,
		mapConnectionsByDestination: common.mapConnectionsByDestination,
	},
	graph: {
		buildAdjacencyList: graph.buildAdjacencyList,
		getInputEdges: graph.getInputEdges,
		getOutputEdges: graph.getOutputEdges,
		getRootNodes: graph.getRootNodes,
		getLeafNodes: graph.getLeafNodes,
		hasPath: graph.hasPath,
		parseExtractableSubgraphSelection: graph.parseExtractableSubgraphSelection,
	},
	diff: { compareConnections: diff.compareConnections },
};
export default ports;
