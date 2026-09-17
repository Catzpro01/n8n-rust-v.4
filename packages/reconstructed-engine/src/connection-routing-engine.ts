// Connection Routing Engine — 1:1 dari n8n 2.9.4 packages/workflow/src/common/* + graph/* + connections-diff
// Owner: Agent 3 — LEGO connection
// Zero Rust, pure JS/TS, frontend UI untouched

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

export type IConnectionAdjacencyList = Map<string, Set<IConnection>>;

export type MultipleInputNodesError = { errorCode: 'Multiple Input Nodes'; nodes: Set<string> };
export type MultipleOutputNodesError = { errorCode: 'Multiple Output Nodes'; nodes: Set<string> };
export type InputEdgeToNonRootNodeError = { errorCode: 'Input Edge To Non-Root Node'; node: string };
export type OutputEdgeFromNonLeafNodeError = { errorCode: 'Output Edge From Non-Leaf Node'; node: string };
export type NoContinuousPathFromRootToLeafError = {
  errorCode: 'No Continuous Path From Root To Leaf In Selection';
  start: string;
  end: string;
};
/** Same union as `n8n-workflow` `ExtractableErrorResult`. */
export type ExtractableErrorResult =
  | MultipleInputNodesError
  | MultipleOutputNodesError
  | InputEdgeToNonRootNodeError
  | OutputEdgeFromNonLeafNodeError
  | NoContinuousPathFromRootToLeafError;

export interface ExtractableSubgraphData {
  start?: string;
  end?: string;
}

/** Same shape as `n8n-workflow` `INodeConnectionsDiff` / `ConnectionsDiff`. */
export type INodeConnectionsDiff = Record<
  string,
  Array<{ sourceIndex: number; value: { index: number; connection: IConnection } | null }>
>;
export type ConnectionsDiff = {
  added: Record<string, INodeConnectionsDiff>;
  removed: Record<string, INodeConnectionsDiff>;
};

export const NodeConnectionTypes = {
  AiAgent: 'ai_agent',
  AiChain: 'ai_chain',
  AiDocument: 'ai_document',
  AiEmbedding: 'ai_embedding',
  AiLanguageModel: 'ai_languageModel',
  AiMemory: 'ai_memory',
  AiOutputParser: 'ai_outputParser',
  AiRetriever: 'ai_retriever',
  AiReranker: 'ai_reranker',
  AiTextSplitter: 'ai_textSplitter',
  AiTool: 'ai_tool',
  AiVectorStore: 'ai_vectorStore',
  Main: 'main',
} as const;

/**
 * mapConnectionsByDestination — inversion source->dest, padded with []
 * 1:1 dari reference/n8n/packages/workflow/src/common/map-connections-by-destination.ts (49 lines)
 */
export function mapConnectionsByDestination(connections: IConnections): IConnections {
  const byDest: IConnections = {} as IConnections;

  for (const [sourceName, typeMap] of Object.entries(connections)) {
    for (const [type, outputSlots] of Object.entries(typeMap as Record<string, any>)) {
      for (let outputIndex = 0; outputIndex < outputSlots.length; outputIndex++) {
        const slot = outputSlots[outputIndex];
        if (!slot) continue;
        for (const conn of slot) {
          if (!conn) continue;
          const destName = conn.node;
          const destType = conn.type as NodeConnectionType;
          const destIndex = conn.index;

          if (!byDest[destName]) byDest[destName] = {} as any;
          if (!byDest[destName][destType]) byDest[destName][destType] = [];

          while (byDest[destName][destType].length <= destIndex) {
            byDest[destName][destType].push([]);
          }
          if (!byDest[destName][destType][destIndex]) {
            byDest[destName][destType][destIndex] = [];
          }
          byDest[destName][destType][destIndex].push({
            node: sourceName,
            type: type as NodeConnectionType,
            index: outputIndex,
          });
        }
      }
    }
  }

  // Pad missing indexes
  for (const destMap of Object.values(byDest)) {
    for (const slots of Object.values(destMap as Record<string, Array<IConnection[] | null>>)) {
      for (let i = 0; i < slots.length; i++) {
        if (!slots[i]) slots[i] = [];
      }
    }
  }

  return byDest;
}

/**
 * getConnectedNodes — traversal primitive, farthest-first, deduped, cycle-safe
 * 1:1 dari reference/n8n/packages/workflow/src/common/get-connected-nodes.ts (98 lines)
 */
export function getConnectedNodes(
  connections: IConnections,
  nodeName: string,
  connectionType: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = NodeConnectionTypes.Main as NodeConnectionType,
  depth = -1,
  checkedNodesIncoming?: string[],
): string[] {
  const newDepth = depth === -1 ? depth : depth - 1;
  if (depth === 0) return [];
  if (!Object.prototype.hasOwnProperty.call(connections, nodeName)) return [];

  let types: NodeConnectionType[];
  if (connectionType === 'ALL') {
    types = Object.keys(connections[nodeName]) as NodeConnectionType[];
  } else if (connectionType === 'ALL_NON_MAIN') {
    types = Object.keys(connections[nodeName]).filter((t) => t !== 'main') as NodeConnectionType[];
  } else {
    types = [connectionType as NodeConnectionType];
  }

  const returnNodes: string[] = [];

  types.forEach((type) => {
    if (!Object.prototype.hasOwnProperty.call(connections[nodeName], type)) return;

    const checkedNodes = checkedNodesIncoming ? [...checkedNodesIncoming] : [];
    if (checkedNodes.includes(nodeName)) return;
    checkedNodes.push(nodeName);

    (connections[nodeName] as any)[type].forEach((connectionsByIndex: any) => {
      connectionsByIndex?.forEach((connection: IConnection) => {
        if (checkedNodes.includes(connection.node)) return;
        returnNodes.unshift(connection.node);

        const addNodes = getConnectedNodes(connections, connection.node, connectionType, newDepth, checkedNodes);

        for (let i = addNodes.length - 1; i >= 0; i--) {
          const parentNodeName = addNodes[i];
          const nodeIndex = returnNodes.indexOf(parentNodeName);
          if (nodeIndex !== -1) returnNodes.splice(nodeIndex, 1);
          returnNodes.unshift(parentNodeName);
        }
      });
    });
  });

  return returnNodes;
}

export function getChildNodes(
  connections: IConnections,
  nodeName: string,
  type: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = NodeConnectionTypes.Main as NodeConnectionType,
  depth = -1,
): string[] {
  return getConnectedNodes(connections, nodeName, type, depth);
}

export function getParentNodes(
  connectionsByDestination: IConnections,
  nodeName: string,
  type: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = NodeConnectionTypes.Main as NodeConnectionType,
  depth = -1,
): string[] {
  return getConnectedNodes(connectionsByDestination, nodeName, type, depth);
}

export function getNodeByName(nodes: any[], name: string): any | undefined {
  return nodes.find((n) => n.name === name);
}

/**
 * buildAdjacencyList — 1:1 dari graph/graph-utils.ts
 */
/* ------------------------------------------------------------------ *
 * Graph analysis — reference-exact port of `packages/workflow/src/graph/graph-utils.ts`
 * (n8n 2.9.4). The differential gate (`tools/connection-isolation-gate.mjs`) executes every
 * function below against the pinned `n8n-workflow@2.9.1` artifact; the port deliberately
 * keeps the reference's helpers, iteration order and error payloads so the comparison is
 * byte-for-byte.
 * ------------------------------------------------------------------ */

function union<T>(a: Set<T>, b: Set<T>): Set<T> {
  const result = new Set<T>();
  for (const x of a) result.add(x);
  for (const x of b) result.add(x);
  return result;
}

function intersection<T>(a: Set<T>, b: Set<T>): Set<T> {
  const result = new Set<T>();
  for (const x of a) if (b.has(x)) result.add(x);
  return result;
}

function difference<T>(minuend: Set<T>, subtrahend: Set<T>): Set<T> {
  const result = new Set<T>(minuend.values());
  for (const x of subtrahend) result.delete(x);
  return result;
}

export function buildAdjacencyList(connections: IConnections): IConnectionAdjacencyList {
  const result = new Map<string, Set<IConnection>>();
  const addOrCreate = (k: string, v: IConnection) => result.set(k, union(result.get(k) ?? new Set<IConnection>(), new Set([v])));

  for (const sourceNode of Object.keys(connections)) {
    for (const type of Object.keys(connections[sourceNode] as any)) {
      for (const sourceIndex of Object.keys((connections[sourceNode] as any)[type])) {
        for (const connectionIndex of Object.keys((connections[sourceNode] as any)[type][parseInt(sourceIndex, 10)] ?? [])) {
          const connection = (connections[sourceNode] as any)[type][parseInt(sourceIndex, 10)]?.[parseInt(connectionIndex, 10)];
          if (connection) addOrCreate(sourceNode, connection);
        }
      }
    }
  }
  return result;
}

/** Find all edges leading into the graph described in `graphIds`. */
export function getInputEdges(nodes: Set<string>, adjacency: IConnectionAdjacencyList): Array<[string, IConnection]> {
  const result: Array<[string, IConnection]> = [];
  for (const [from, tos] of adjacency.entries()) {
    if (nodes.has(from)) continue;
    for (const to of tos) if (nodes.has(to.node)) result.push([from, to]);
  }
  return result;
}

/** Find all edges leading out of the graph described in `graphIds`. */
export function getOutputEdges(nodes: Set<string>, adjacency: IConnectionAdjacencyList): Array<[string, IConnection]> {
  const result: Array<[string, IConnection]> = [];
  for (const [from, tos] of adjacency.entries()) {
    if (!nodes.has(from)) continue;
    for (const to of tos) if (!nodes.has(to.node)) result.push([from, to]);
  }
  return result;
}

export function getRootNodes(nodes: Set<string>, adjacency: IConnectionAdjacencyList): Set<string> {
  // Inner nodes are all nodes with an incoming edge from another node in the graph
  let innerNodes = new Set<string>();
  for (const nodeId of nodes) {
    innerNodes = union(
      innerNodes,
      new Set(
        [...(adjacency.get(nodeId) ?? [])]
          .filter((x) => x.type === 'main' && x.node !== nodeId)
          .map((x) => x.node),
      ),
    );
  }
  return difference(nodes, innerNodes);
}

export function getLeafNodes(nodes: Set<string>, adjacency: IConnectionAdjacencyList): Set<string> {
  const result = new Set<string>();
  for (const nodeId of nodes) {
    if (
      intersection(
        new Set(
          [...(adjacency.get(nodeId) ?? [])]
            .filter((x) => x.type === 'main' && x.node !== nodeId)
            .map((x) => x.node),
        ),
        nodes,
      ).size === 0
    ) {
      result.add(nodeId);
    }
  }
  return result;
}

export function hasPath(start: string, end: string, adjacency: IConnectionAdjacencyList): boolean {
  const seen = new Set<string>();
  const paths: string[] = [start];
  while (true) {
    const next = paths.pop();
    if (next === end) return true;
    if (next === undefined) return false;
    seen.add(next);
    paths.push(
      ...difference(
        new Set([...(adjacency.get(next) ?? [])].filter((x) => x.type === 'main').map((x) => x.node)),
        seen,
      ),
    );
  }
}

export function parseExtractableSubgraphSelection(
  nodes: Set<string>,
  adjacency: IConnectionAdjacencyList,
): ExtractableSubgraphData | ExtractableErrorResult[] {
  const errors: ExtractableErrorResult[] = [];

  // 0-1 Input nodes
  const inputEdges = getInputEdges(nodes, adjacency);
  const inputNodes = new Set(inputEdges.filter((x) => x[1].type === 'main').map((x) => x[1].node));
  let rootNodes = getRootNodes(nodes, adjacency);
  if (rootNodes.size === 0 && inputNodes.size === 1) rootNodes = inputNodes;
  for (const inputNode of difference(inputNodes, rootNodes).values()) {
    errors.push({ errorCode: 'Input Edge To Non-Root Node', node: inputNode });
  }
  const rootInputNodes = intersection(rootNodes, inputNodes);
  if (rootInputNodes.size > 1) {
    errors.push({ errorCode: 'Multiple Input Nodes', nodes: rootInputNodes });
  }

  // 0-1 Output nodes
  const outputEdges = getOutputEdges(nodes, adjacency);
  const outputNodes = new Set(outputEdges.filter((x) => x[1].type === 'main').map((x) => x[0]));
  let leafNodes = getLeafNodes(nodes, adjacency);
  if (leafNodes.size === 0 && outputNodes.size === 1) leafNodes = outputNodes;
  for (const outputNode of difference(outputNodes, leafNodes).values()) {
    errors.push({ errorCode: 'Output Edge From Non-Leaf Node', node: outputNode });
  }
  const leafOutputNodes = intersection(leafNodes, outputNodes);
  if (leafOutputNodes.size > 1) {
    errors.push({ errorCode: 'Multiple Output Nodes', nodes: leafOutputNodes });
  }

  const start = rootInputNodes.values().next().value as string | undefined;
  const end = leafOutputNodes.values().next().value as string | undefined;

  if (start && end && !hasPath(start, end, adjacency)) {
    errors.push({ errorCode: 'No Continuous Path From Root To Leaf In Selection', start, end } as unknown as ExtractableErrorResult);
  }

  return errors.length > 0 ? errors : { start, end };
}

/**
 * compareConnections — 1:1 dari connections-diff.ts
 */
export function compareConnections(prev: IConnections, next: IConnections): ConnectionsDiff {
  const added: ConnectionsDiff['added'] = {};
  const removed: ConnectionsDiff['removed'] = {};
  const allNodeNames = new Set([...Object.keys(prev), ...Object.keys(next)]);

  for (const nodeName of allNodeNames) {
    const prevNodeConnections = (prev as any)[nodeName] ?? {};
    const nextNodeConnections = (next as any)[nodeName] ?? {};
    const allInputNames = new Set([...Object.keys(prevNodeConnections), ...Object.keys(nextNodeConnections)]);

    for (const inputName of allInputNames) {
      const prevInputConnections = prevNodeConnections[inputName] ?? [];
      const nextInputConnections = nextNodeConnections[inputName] ?? [];
      const maxLength = Math.max(prevInputConnections.length, nextInputConnections.length);

      for (let sourceIndex = 0; sourceIndex < maxLength; sourceIndex++) {
        const prevConnections = prevInputConnections[sourceIndex] ?? [];
        const nextConnections = nextInputConnections[sourceIndex] ?? [];
        const prevMap = new Map<string, { index: number; connection: IConnection }>(
          (prevConnections as any[]).map((conn: any, idx: number) => [JSON.stringify(conn), { index: idx, connection: conn }]),
        );
        const nextMap = new Map<string, { index: number; connection: IConnection }>(
          (nextConnections as any[]).map((conn: any, idx: number) => [JSON.stringify(conn), { index: idx, connection: conn }]),
        );

        for (const [key, value] of nextMap) {
          if (!prevMap.has(key)) {
            if (!added[nodeName]) added[nodeName] = {};
            if (!added[nodeName][inputName]) added[nodeName][inputName] = [];
            added[nodeName][inputName].push({ sourceIndex, value });
          }
        }
        for (const [key, value] of prevMap) {
          if (!nextMap.has(key)) {
            if (!removed[nodeName]) removed[nodeName] = {};
            if (!removed[nodeName][inputName]) removed[nodeName][inputName] = [];
            removed[nodeName][inputName].push({ sourceIndex, value });
          }
        }
      }
    }
  }

  return { added, removed };
}

/**
 * Workflow wrapper methods — consumed, not owned (CD-04, Agent 1)
 * These are provided here for completeness and testing, but ownership stays with Workflow LEGO.
 * Pinned by tests/reference/connection fixtures 01-04.
 */

export function getNodeConnectionIndexes(
  connectionsByDestination: IConnections,
  nodeName: string,
  parentNodeName: string,
  type: NodeConnectionType = 'main',
  getNode?: (name: string) => any | null,
): INodeConnection | undefined {
  if (getNode && getNode(parentNodeName) === null) return undefined;

  const visited = new Set<string>();
  const queue: string[] = [nodeName];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const typeConnections = (connectionsByDestination as any)[current]?.[type];
    if (!typeConnections) continue;

    for (let typedConnectionIdx = 0; typedConnectionIdx < typeConnections.length; typedConnectionIdx++) {
      const slot = typeConnections[typedConnectionIdx];
      if (!slot) continue;
      for (let destinationIndex = 0; destinationIndex < slot.length; destinationIndex++) {
        const connection = slot[destinationIndex];
        if (!connection) continue;
        if (connection.node === parentNodeName) {
          return { sourceIndex: connection.index, destinationIndex };
        }
        if (!visited.has(connection.node)) queue.push(connection.node);
      }
    }
  }

  return undefined;
}

export function getHighestNode(
  connectionsByDestination: IConnections,
  nodes: Record<string, any>,
  nodeName: string,
  nodeConnectionIndex?: number,
  checkedNodes?: string[],
): string[] {
  let currentHighest: string[] = [];
  if (nodes[nodeName] && nodes[nodeName].disabled === false) {
    currentHighest.push(nodeName);
  }

  if (!connectionsByDestination[nodeName] || !(connectionsByDestination as any)[nodeName].main) {
    return currentHighest;
  }

  const checked = checkedNodes || [];
  if (checked.includes(nodeName)) return currentHighest;
  checked.push(nodeName);

  const returnNodes: string[] = [];

  const mainConnections = (connectionsByDestination as any)[nodeName].main;
  for (let connectionIndex = 0; connectionIndex < mainConnections.length; connectionIndex++) {
    if (nodeConnectionIndex !== undefined && nodeConnectionIndex !== connectionIndex) continue;
    const slot = mainConnections[connectionIndex];
    if (!slot) continue;
    for (const connection of slot) {
      if (!connection) continue;
      if (checked.includes(connection.node)) continue;
      if (!nodes[connection.node]) continue;

      let addNodes = getHighestNode(connectionsByDestination, nodes, connection.node, undefined, checked);
      if (addNodes.length === 0 && nodes[connection.node].disabled !== true) {
        addNodes = [connection.node];
      }
      for (const name of addNodes) {
        if (!returnNodes.includes(name)) returnNodes.push(name);
      }
    }
  }

  return returnNodes;
}
