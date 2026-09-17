/**
 * @lego/connection — SEAM FACADE (P-CONNECTION-GRAPH).
 *
 * The only file other LEGOs may import from this package. Every runtime symbol resolves through the
 * port runtime (reference mode = pinned n8n-workflow; strict mode = verbatim vendored reference source).
 * Symbol list = contracts/connection.contract.md §8 + manifest/ownership.json providedPort.
 */
import type { ConnectionLegoPorts } from './ports/contracts.ts';
import { impl } from './ports/runtime.ts';

const p = () => impl<ConnectionLegoPorts>();

/* traversal (common/**) — typed, cycle-safe BFS over IConnections */
export const getConnectedNodes: ConnectionLegoPorts['traversal']['getConnectedNodes'] = (...a) => p().traversal.getConnectedNodes(...a);
export const getChildNodes: ConnectionLegoPorts['traversal']['getChildNodes'] = (...a) => p().traversal.getChildNodes(...a);
export const getParentNodes: ConnectionLegoPorts['traversal']['getParentNodes'] = (...a) => p().traversal.getParentNodes(...a);
export const mapConnectionsByDestination: ConnectionLegoPorts['traversal']['mapConnectionsByDestination'] = (...a) =>
	p().traversal.mapConnectionsByDestination(...a);

/* graph (graph/graph-utils) — main-only adjacency + subgraph selection */
export const buildAdjacencyList: ConnectionLegoPorts['graph']['buildAdjacencyList'] = (...a) => p().graph.buildAdjacencyList(...a);
export const getInputEdges: ConnectionLegoPorts['graph']['getInputEdges'] = (...a) => p().graph.getInputEdges(...a);
export const getOutputEdges: ConnectionLegoPorts['graph']['getOutputEdges'] = (...a) => p().graph.getOutputEdges(...a);
export const getRootNodes: ConnectionLegoPorts['graph']['getRootNodes'] = (...a) => p().graph.getRootNodes(...a);
export const getLeafNodes: ConnectionLegoPorts['graph']['getLeafNodes'] = (...a) => p().graph.getLeafNodes(...a);
export const hasPath: ConnectionLegoPorts['graph']['hasPath'] = (...a) => p().graph.hasPath(...a);
export const parseExtractableSubgraphSelection: ConnectionLegoPorts['graph']['parseExtractableSubgraphSelection'] = (...a) =>
	p().graph.parseExtractableSubgraphSelection(...a);

/* content (connections-diff) */
export const compareConnections: ConnectionLegoPorts['diff']['compareConnections'] = (...a) => p().diff.compareConnections(...a);

export type {
	IConnectionAdjacencyList,
	ExtractableErrorResult,
	ExtractableSubgraphData,
	ConnectionsDiff,
	INodeConnectionsDiff,
	TraversalTypeFilter,
} from './ports/contracts.ts';
export type { IConnection, IConnections, NodeConnectionType } from './ports/vocabulary.ts';
