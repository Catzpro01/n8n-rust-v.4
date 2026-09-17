
export interface IConnection {
  node: string;
  type: string;
  index: number;
}

export type NodeConnectionType = 'main' | 'ai_tool' | 'ai_memory' | 'ai_languageModel' | string;

export const NodeConnectionTypes = {
  Main: 'main' as NodeConnectionType,
  AiTool: 'ai_tool' as NodeConnectionType,
  AiMemory: 'ai_memory' as NodeConnectionType,
  AiLanguageModel: 'ai_languageModel' as NodeConnectionType,
};

export type IConnections = {
  [key: string]: {
    [type in NodeConnectionType]?: Array<Array<IConnection> | null> | null;
  } & {
    [key: string]: Array<Array<IConnection> | null> | null;
  };
};

export interface INode {
  name: string;
  [key: string]: any;
}

export type INodes = {
  [key: string]: INode;
};

export type IConnectionAdjacencyList = any;
export type ExtractableSubgraphData = any;
export type ExtractableErrorResult = any;
