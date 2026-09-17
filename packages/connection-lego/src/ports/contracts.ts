/**
 * Port contracts for Connection LEGO — P-CONNECTION-GRAPH
 *
 * Defines the outer boundary that Workflow LEGO consumes.
 * Phase 3 Option A: Connection owns graph/** + connections-diff,
 * Workflow re-exports via port.
 */

export type NodeConnectionType =
  | 'main'
  | 'ai_agent'
  | 'ai_chain'
  | 'ai_document'
  | 'ai_embedding'
  | 'ai_languageModel'
  | 'ai_memory'
  | 'ai_outputParser'
  | 'ai_retriever'
  | 'ai_reranker'
  | 'ai_textSplitter'
  | 'ai_tool'
  | 'ai_vectorStore';

export interface IConnection {
  node: string;
  type: NodeConnectionType;
  index: number;
}

export type IConnections = Record<string, Record<NodeConnectionType, Array<IConnection[] | null>>>;

export interface INodeConnection {
  sourceIndex: number;
  destinationIndex: number;
}

export interface IConnectionAdjacencyList extends Map<string, Set<IConnection>> {}

export interface ExtractableErrorResult {
  errorCode: string;
  message: string;
}

export interface ExtractableSubgraphData {
  start?: string;
  end?: string;
}

export type ConnectionsDiff = {
  added: Record<string, Record<string, Array<{ sourceIndex: number; value: { index: number; connection: IConnection } | null }>>>;
  removed: Record<string, Record<string, Array<{ sourceIndex: number; value: { index: number; connection: IConnection } | null }>>>;
};

export interface GraphPort {
  buildAdjacencyList: (connections: IConnections) => IConnectionAdjacencyList;
  getRootNodes: (nodes: Set<string>, adjacency: IConnectionAdjacencyList) => Set<string>;
  getLeafNodes: (nodes: Set<string>, adjacency: IConnectionAdjacencyList) => Set<string>;
  getInputEdges: (nodes: Set<string>, adjacency: IConnectionAdjacencyList) => Array<[string, IConnection]>;
  getOutputEdges: (nodes: Set<string>, adjacency: IConnectionAdjacencyList) => Array<[string, IConnection]>;
  hasPath: (start: string, end: string, adjacency: IConnectionAdjacencyList) => boolean;
  parseExtractableSubgraphSelection: (nodes: Set<string>, adjacency: IConnectionAdjacencyList) => ExtractableSubgraphData | ExtractableErrorResult[];
  getChildNodes: (connections: IConnections, nodeName: string, type?: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN', depth?: number) => string[];
  getParentNodes: (connectionsByDestination: IConnections, nodeName: string, type?: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN', depth?: number) => string[];
  getConnectedNodes: (connections: IConnections, nodeName: string, type?: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN', depth?: number, checked?: string[]) => string[];
  getNodeByName: (nodes: any[], name: string) => any | undefined;
  mapConnectionsByDestination: (connections: IConnections) => IConnections;
}

export interface DiffPort {
  compareConnections: (prev: IConnections, next: IConnections) => ConnectionsDiff;
}

export interface CommonPort extends GraphPort {}

export interface VocabularyPort {
  NodeConnectionTypes: Record<string, string>;
}

export interface ConnectionLegoPorts {
  graph: GraphPort;
  diff: DiffPort;
  common: CommonPort;
  vocabulary: VocabularyPort;
}
