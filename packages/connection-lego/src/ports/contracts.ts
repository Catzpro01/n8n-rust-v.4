/**
 * Connection LEGO — the seam contract (P-CONNECTION-GRAPH), typed exactly as the reference declares it.
 * Signatures are copied from n8n 2.9.4:
 *   common/get-connected-nodes.ts, common/get-child-nodes.ts, common/get-parent-nodes.ts,
 *   common/map-connections-by-destination.ts, graph/graph-utils.ts, connections-diff.ts
 * Prose contract: contracts/connection.contract.md §2, §3, §8.
 */
import type { IConnection, IConnections, NodeConnectionType } from './vocabulary.ts';

export type TraversalTypeFilter = NodeConnectionType | 'ALL' | 'ALL_NON_MAIN';

/* graph/graph-utils.ts:29-36,165 */
export type IConnectionAdjacencyList = Map<string, Set<IConnection>>;
export type ExtractableSubgraphData = { start?: string; end?: string };
export type ExtractableErrorResult =
	| { errorCode: 'Multiple Input Nodes'; nodes: Set<string> }
	| { errorCode: 'Multiple Output Nodes'; nodes: Set<string> }
	| { errorCode: 'Input Edge To Non-Root Node'; node: string }
	| { errorCode: 'Output Edge From Non-Leaf Node'; node: string }
	| { errorCode: 'No Continuous Path From Root To Leaf In Selection'; start: string; end: string };

/* connections-diff.ts:3-13 */
export type ConnectionEntry = { sourceIndex: number; value: { index: number; connection: IConnection } | null };
export type INodeConnectionsDiff = Record<string, ConnectionEntry[]>;
export type ConnectionsDiff = {
	added: Record<string, INodeConnectionsDiff>;
	removed: Record<string, INodeConnectionsDiff>;
};

export interface ConnectionTraversalPort {
	getConnectedNodes(
		connections: IConnections,
		nodeName: string,
		connectionType?: TraversalTypeFilter,
		depth?: number,
		checkedNodesIncoming?: string[],
	): string[];
	getChildNodes(connectionsBySourceNode: IConnections, nodeName: string, type?: TraversalTypeFilter, depth?: number): string[];
	getParentNodes(connectionsByDestinationNode: IConnections, nodeName: string, type?: TraversalTypeFilter, depth?: number): string[];
	mapConnectionsByDestination(connections: IConnections): IConnections;
}

export interface ConnectionGraphPort {
	buildAdjacencyList(connectionsBySourceNode: IConnections): IConnectionAdjacencyList;
	getInputEdges(graphIds: Set<string>, adjacencyList: IConnectionAdjacencyList): Array<[string, IConnection]>;
	getOutputEdges(graphIds: Set<string>, adjacencyList: IConnectionAdjacencyList): Array<[string, IConnection]>;
	getRootNodes(graphIds: Set<string>, adjacencyList: IConnectionAdjacencyList): Set<string>;
	getLeafNodes(graphIds: Set<string>, adjacencyList: IConnectionAdjacencyList): Set<string>;
	hasPath(start: string, end: string, adjacencyList: IConnectionAdjacencyList): boolean;
	parseExtractableSubgraphSelection(
		graphIds: Set<string>,
		adjacencyList: IConnectionAdjacencyList,
	): ExtractableSubgraphData | ExtractableErrorResult[];
}

export interface ConnectionDiffPort {
	compareConnections(prev: IConnections, next: IConnections): ConnectionsDiff;
}

export interface ConnectionLegoPorts {
	traversal: ConnectionTraversalPort;
	graph: ConnectionGraphPort;
	diff: ConnectionDiffPort;
}
