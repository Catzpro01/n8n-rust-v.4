/**
 * Port adapter — strict mode (no reference runtime, no third-party deps).
 * Proves there is no hidden coupling — pure implementations only.
 */

import type { ConnectionLegoPorts, IConnections, IConnection, IConnectionAdjacencyList, ExtractableErrorResult, ExtractableSubgraphData } from '../../ports/contracts';

function mapConnectionsByDestination(connections: IConnections): IConnections {
  const byDest: IConnections = {};
  for (const [sourceName, typeMap] of Object.entries(connections)) {
    for (const [type, outputSlots] of Object.entries(typeMap as any)) {
      for (let outputIndex = 0; outputIndex < outputSlots.length; outputIndex++) {
        const slot = outputSlots[outputIndex];
        if (!slot) continue;
        for (const conn of slot) {
          if (!conn) continue;
          const destName = conn.node;
          const destType = conn.type;
          const destIndex = conn.index;
          if (!byDest[destName]) byDest[destName] = {} as any;
          if (!byDest[destName][destType]) byDest[destName][destType] = [];
          // Pad missing input indexes with []
          while (byDest[destName][destType].length <= destIndex) {
            byDest[destName][destType].push([]);
          }
          if (!byDest[destName][destType][destIndex]) byDest[destName][destType][destIndex] = [];
          byDest[destName][destType][destIndex].push({
            node: sourceName,
            type: type as any,
            index: outputIndex,
          });
        }
      }
    }
  }
  // Ensure destination arrays are padded
  for (const destMap of Object.values(byDest)) {
    for (const slots of Object.values(destMap as any)) {
      for (let i = 0; i < slots.length; i++) {
        if (!slots[i]) slots[i] = [];
      }
    }
  }
  return byDest;
}

function getConnectedNodes(
  connections: IConnections,
  nodeName: string,
  connectionType: any = 'main',
  depth = -1,
  checkedNodesIncoming?: string[],
): string[] {
  const newDepth = depth === -1 ? depth : depth - 1;
  if (depth === 0) return [];
  if (!connections.hasOwnProperty(nodeName)) return [];

  let types: string[];
  if (connectionType === 'ALL') {
    types = Object.keys(connections[nodeName]);
  } else if (connectionType === 'ALL_NON_MAIN') {
    types = Object.keys(connections[nodeName]).filter((t) => t !== 'main');
  } else {
    types = [connectionType];
  }

  const returnNodes: string[] = [];

  types.forEach((type) => {
    if (!connections[nodeName].hasOwnProperty(type)) return;
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

function getChildNodes(connections: IConnections, nodeName: string, type: any = 'main', depth = -1): string[] {
  return getConnectedNodes(connections, nodeName, type, depth);
}

function getParentNodes(connectionsByDestination: IConnections, nodeName: string, type: any = 'main', depth = -1): string[] {
  return getConnectedNodes(connectionsByDestination, nodeName, type, depth);
}

function getNodeByName(nodes: any[], name: string): any | undefined {
  return nodes.find((n) => n.name === name);
}

function buildAdjacencyList(connections: IConnections): IConnectionAdjacencyList {
  const adj = new Map<string, Set<IConnection>>();
  for (const [source, typeMap] of Object.entries(connections)) {
    for (const slots of Object.values(typeMap as any)) {
      for (const slot of slots) {
        if (!slot) continue;
        for (const conn of slot) {
          if (!conn) continue;
          if (!adj.has(source)) adj.set(source, new Set());
          adj.get(source)!.add(conn);
          // Ensure dest node exists in map even if it has no outgoing
          if (!adj.has(conn.node)) adj.set(conn.node, new Set());
        }
      }
    }
  }
  return adj as IConnectionAdjacencyList;
}

function getRootNodes(nodes: Set<string>, adjacency: IConnectionAdjacencyList): Set<string> {
  const roots = new Set<string>();
  const hasIncoming = new Set<string>();
  // Only consider main edges
  for (const [source, conns] of adjacency.entries()) {
    for (const conn of conns) {
      if (conn.type !== 'main') continue;
      if (conn.node === source) continue; // self-loops ignored
      if (nodes.has(conn.node)) hasIncoming.add(conn.node);
    }
  }
  for (const node of nodes) {
    if (!hasIncoming.has(node)) roots.add(node);
  }
  return roots;
}

function getLeafNodes(nodes: Set<string>, adjacency: IConnectionAdjacencyList): Set<string> {
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
      if (conn.node === node) continue;
      if (nodes.has(conn.node)) {
        hasMainOutgoing = true;
        break;
      }
    }
    if (!hasMainOutgoing) leaves.add(node);
  }
  return leaves;
}

function getInputEdges(nodes: Set<string>, adjacency: IConnectionAdjacencyList): Array<[string, IConnection]> {
  const edges: Array<[string, IConnection]> = [];
  for (const [source, conns] of adjacency.entries()) {
    for (const conn of conns) {
      if (nodes.has(conn.node)) edges.push([source, conn]);
    }
  }
  return edges;
}

function getOutputEdges(nodes: Set<string>, adjacency: IConnectionAdjacencyList): Array<[string, IConnection]> {
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

function hasPath(start: string, end: string, adjacency: IConnectionAdjacencyList): boolean {
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

function parseExtractableSubgraphSelection(nodes: Set<string>, adjacency: IConnectionAdjacencyList): ExtractableSubgraphData | ExtractableErrorResult[] {
  const errors: ExtractableErrorResult[] = [];
  const roots = getRootNodes(nodes, adjacency);
  const leaves = getLeafNodes(nodes, adjacency);

  if (roots.size > 1) {
    errors.push({ errorCode: 'Multiple Input Nodes', message: 'Selection has multiple input nodes' });
  }
  if (leaves.size > 1) {
    errors.push({ errorCode: 'Multiple Output Nodes', message: 'Selection has multiple output nodes' });
  }

  // Check for input edge to non-root
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

  // Check for output edge from non-leaf
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

  // Check continuous path
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

function compareConnections(prev: IConnections, next: IConnections): any {
  const added: Record<string, any> = {};
  const removed: Record<string, any> = {};
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

export const ports: ConnectionLegoPorts = {
  graph: {
    buildAdjacencyList,
    getRootNodes,
    getLeafNodes,
    getInputEdges,
    getOutputEdges,
    hasPath,
    parseExtractableSubgraphSelection,
    getChildNodes,
    getParentNodes,
    getConnectedNodes,
    getNodeByName,
    mapConnectionsByDestination,
  },
  diff: {
    compareConnections,
  },
  common: {
    buildAdjacencyList,
    getRootNodes,
    getLeafNodes,
    getInputEdges,
    getOutputEdges,
    hasPath,
    parseExtractableSubgraphSelection,
    getChildNodes,
    getParentNodes,
    getConnectedNodes,
    getNodeByName,
    mapConnectionsByDestination,
  },
  vocabulary: {
    NodeConnectionTypes: {
      Main: 'main',
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
    },
  },
};

export default ports;
