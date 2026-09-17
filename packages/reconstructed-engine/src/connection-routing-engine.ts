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

export interface ExtractableErrorResult {
  errorCode: 'Multiple Input Nodes' | 'Multiple Output Nodes' | 'Input Edge To Non-Root Node' | 'Output Edge From Non-Leaf Node' | 'No Continuous Path From Root To Leaf In Selection';
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
    for (const slots of Object.values(destMap as any)) {
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
export function buildAdjacencyList(connections: IConnections): IConnectionAdjacencyList {
  const adj = new Map<string, Set<IConnection>>();
  for (const [source, typeMap] of Object.entries(connections)) {
    for (const slots of Object.values(typeMap as any)) {
      for (const slot of slots) {
        if (!slot) continue;
        for (const conn of slot) {
          if (!conn) continue;
          if (!adj.has(source)) adj.set(source, new Set());
          adj.get(source)!.add(conn);
          if (!adj.has(conn.node)) adj.set(conn.node, new Set());
        }
      }
    }
  }
  return adj;
}

export function getRootNodes(nodes: Set<string>, adjacency: IConnectionAdjacencyList): Set<string> {
  const roots = new Set<string>();
  const hasIncoming = new Set<string>();
  for (const [, conns] of adjacency.entries()) {
    for (const conn of conns) {
      if (conn.type !== 'main') continue;
      if (nodes.has(conn.node)) hasIncoming.add(conn.node);
    }
  }
  for (const node of nodes) {
    // Self-loops ignored for root detection (per C6)
    let selfLoopOnly = true;
    const outgoing = adjacency.get(node);
    if (outgoing) {
      for (const conn of outgoing) {
        if (conn.type === 'main' && conn.node !== node && nodes.has(conn.node)) {
          selfLoopOnly = false;
          break;
        }
      }
    }
    if (!hasIncoming.has(node)) roots.add(node);
  }
  return roots;
}

export function getLeafNodes(nodes: Set<string>, adjacency: IConnectionAdjacencyList): Set<string> {
  const leaves = new Set<string>();
  for (const node of nodes) {
    const outgoing = adjacency.get(node);
    if (!outgoing) {
      leaves.add(node);
      continue;
    }
    let hasMainOutgoing = false;
    for (const conn of outgoing) {
      if (conn.type !== 'main') continue;
      if (conn.node === node) continue; // self-loop ignored
      if (nodes.has(conn.node)) {
        hasMainOutgoing = true;
        break;
      }
    }
    if (!hasMainOutgoing) leaves.add(node);
  }
  return leaves;
}

export function getInputEdges(nodes: Set<string>, adjacency: IConnectionAdjacencyList): Array<[string, IConnection]> {
  const edges: Array<[string, IConnection]> = [];
  for (const [source, conns] of adjacency.entries()) {
    for (const conn of conns) {
      if (nodes.has(conn.node)) edges.push([source, conn]);
    }
  }
  return edges;
}

export function getOutputEdges(nodes: Set<string>, adjacency: IConnectionAdjacencyList): Array<[string, IConnection]> {
  const edges: Array<[string, IConnection]> = [];
  for (const node of nodes) {
    const conns = adjacency.get(node);
    if (!conns) continue;
    for (const conn of conns) {
      edges.push([node, conn]);
    }
  }
  return edges;
}

export function hasPath(start: string, end: string, adjacency: IConnectionAdjacencyList): boolean {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === end) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    const conns = adjacency.get(current);
    if (!conns) continue;
    for (const conn of conns) {
      if (conn.type !== 'main') continue;
      if (!seen.has(conn.node)) queue.push(conn.node);
    }
  }
  return false;
}

export function parseExtractableSubgraphSelection(
  nodes: Set<string>,
  adjacency: IConnectionAdjacencyList,
): ExtractableSubgraphData | ExtractableErrorResult[] {
  const errors: ExtractableErrorResult[] = [];
  const roots = getRootNodes(nodes, adjacency);
  const leaves = getLeafNodes(nodes, adjacency);

  if (roots.size > 1) {
    errors.push({ errorCode: 'Multiple Input Nodes', message: 'Selection has multiple input nodes' });
  }
  if (leaves.size > 1) {
    errors.push({ errorCode: 'Multiple Output Nodes', message: 'Selection has multiple output nodes' });
  }

  // Input edge to non-root
  for (const node of nodes) {
    if (roots.has(node)) continue;
    for (const [source, conns] of adjacency.entries()) {
      if (nodes.has(source)) continue;
      for (const conn of conns) {
        if (conn.type !== 'main') continue;
        if (conn.node === node) {
          errors.push({ errorCode: 'Input Edge To Non-Root Node', message: `Input edge to non-root node ${node}` });
        }
      }
    }
  }

  // Output edge from non-leaf
  for (const node of nodes) {
    if (leaves.has(node)) continue;
    const conns = adjacency.get(node);
    if (!conns) continue;
    for (const conn of conns) {
      if (conn.type !== 'main') continue;
      if (!nodes.has(conn.node)) {
        errors.push({ errorCode: 'Output Edge From Non-Leaf Node', message: `Output edge from non-leaf node ${node}` });
      }
    }
  }

  if (errors.length > 0) return errors;

  if (roots.size === 1 && leaves.size === 1) {
    const root = [...roots][0];
    const leaf = [...leaves][0];
    if (!hasPath(root, leaf, adjacency)) {
      return [{ errorCode: 'No Continuous Path From Root To Leaf In Selection', message: 'No continuous path from root to leaf' }];
    }
    return { start: root, end: leaf };
  }

  return {};
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
        const prevMap = new Map(prevConnections.map((conn: any, idx: number) => [JSON.stringify(conn), { index: idx, connection: conn }]));
        const nextMap = new Map(nextConnections.map((conn: any, idx: number) => [JSON.stringify(conn), { index: idx, connection: conn }]));

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
