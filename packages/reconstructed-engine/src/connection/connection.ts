/**
 * Connection Model — Reconstructed 1:1 from n8n v2.9.4
 * Source: reference/n8n/packages/workflow/src/common/**, graph/graph-utils.ts, connections-diff.ts
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

export interface IConnections {
  [sourceNodeName: string]: {
    [type: string]: Array<Array<IConnection | null>>;
  };
}

export function mapConnectionsByDestination(connections: IConnections): IConnections {
  const returnConnection: IConnections = {};
  for (const sourceNode in connections) {
    if (!connections.hasOwnProperty(sourceNode)) continue;
    for (const type of Object.keys(connections[sourceNode])) {
      if (!connections[sourceNode].hasOwnProperty(type)) continue;
      for (const inputIndex in connections[sourceNode][type]) {
        if (!connections[sourceNode][type].hasOwnProperty(inputIndex)) continue;
        for (const connectionInfo of connections[sourceNode][type][inputIndex] ?? []) {
          if (!returnConnection.hasOwnProperty(connectionInfo.node)) {
            returnConnection[connectionInfo.node] = {};
          }
          if (!returnConnection[connectionInfo.node].hasOwnProperty(connectionInfo.type)) {
            returnConnection[connectionInfo.node][connectionInfo.type] = [];
          }
          const maxIndex = returnConnection[connectionInfo.node][connectionInfo.type].length - 1;
          for (let j = maxIndex; j < connectionInfo.index; j++) {
            returnConnection[connectionInfo.node][connectionInfo.type].push([]);
          }
          returnConnection[connectionInfo.node][connectionInfo.type][connectionInfo.index]?.push({
            node: sourceNode,
            type: type as NodeConnectionType,
            index: parseInt(inputIndex, 10),
          });
        }
      }
    }
  }
  return returnConnection;
}

export function getConnectedNodes(
  connections: IConnections,
  nodeName: string,
  connectionType: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = 'main',
  depth = -1,
  checkedNodesIncoming?: string[]
): string[] {
  const newDepth = depth === -1 ? depth : depth - 1;
  if (depth === 0) return [];
  if (!connections.hasOwnProperty(nodeName)) return [];

  let types: string[];
  if (connectionType === 'ALL') {
    types = Object.keys(connections[nodeName]);
  } else if (connectionType === 'ALL_NON_MAIN') {
    types = Object.keys(connections[nodeName]).filter((type) => type !== 'main');
  } else {
    types = [connectionType];
  }

  const returnNodes: string[] = [];
  types.forEach((type) => {
    if (!connections[nodeName].hasOwnProperty(type)) return;
    const checkedNodes = checkedNodesIncoming ? [...checkedNodesIncoming] : [];
    if (checkedNodes.includes(nodeName)) return;
    checkedNodes.push(nodeName);

    connections[nodeName][type].forEach((connectionsByIndex) => {
      connectionsByIndex?.forEach((connection) => {
        if (checkedNodes.includes(connection.node)) return;
        returnNodes.unshift(connection.node);
        const addNodes = getConnectedNodes(connections, connection.node, connectionType, newDepth, checkedNodes);
        for (let i = addNodes.length; i--; i > 0) {
          const parentNodeName = addNodes[i];
          const nodeIndex = returnNodes.indexOf(parentNodeName);
          if (nodeIndex !== -1) {
            returnNodes.splice(nodeIndex, 1);
          }
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
  type: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = 'main',
  depth = -1
): string[] {
  return getConnectedNodes(connections, nodeName, type, depth);
}

export function getParentNodes(
  connections: IConnections,
  nodeName: string,
  type: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = 'main',
  depth = -1
): string[] {
  return getConnectedNodes(connections, nodeName, type, depth);
}

export function getNodeByName(nodes: Record<string, any>, name: string): any | undefined {
  return nodes[name];
}

export type IConnectionAdjacencyList = Map<string, Set<IConnection>>;

export function buildAdjacencyList(connections: IConnections): IConnectionAdjacencyList {
  const adjacencyList: IConnectionAdjacencyList = new Map();
  for (const [from, byType] of Object.entries(connections)) {
    if (!adjacencyList.has(from)) adjacencyList.set(from, new Set());
    for (const [, outputs] of Object.entries(byType)) {
      for (const output of outputs) {
        if (!output) continue;
        for (const conn of output) {
          if (!conn) continue;
          adjacencyList.get(from)!.add(conn as IConnection);
          if (!adjacencyList.has(conn.node)) adjacencyList.set(conn.node, new Set());
        }
      }
    }
  }
  return adjacencyList;
}

export function getRootNodes(adjacencyList: IConnectionAdjacencyList): string[] {
  const allNodes = new Set(adjacencyList.keys());
  const hasIncoming = new Set<string>();
  for (const [, tos] of adjacencyList.entries()) {
    for (const to of tos) {
      if (to.type === 'main') hasIncoming.add(to.node);
    }
  }
  return [...allNodes].filter((n) => !hasIncoming.has(n));
}

export function getLeafNodes(adjacencyList: IConnectionAdjacencyList): string[] {
  const leaves: string[] = [];
  for (const [from, tos] of adjacencyList.entries()) {
    const hasMainOutgoing = [...tos].some((t) => t.type === 'main');
    if (!hasMainOutgoing) leaves.push(from);
  }
  return leaves;
}

export function hasPath(start: string, end: string, adjacencyList: IConnectionAdjacencyList): boolean {
  const visited = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === end) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const neighbors = adjacencyList.get(current);
    if (!neighbors) continue;
    for (const neighbor of neighbors) {
      if (neighbor.type === 'main' && !visited.has(neighbor.node)) {
        queue.push(neighbor.node);
      }
    }
  }
  return false;
}

export interface ConnectionsDiff {
  added: Record<string, Record<string, Array<{ sourceIndex: number; value: { index: number; connection: IConnection } | null }>>>;
  removed: Record<string, Record<string, Array<{ sourceIndex: number; value: { index: number; connection: IConnection } | null }>>>;
}

export function compareConnections(prev: IConnections, next: IConnections): ConnectionsDiff {
  const added: ConnectionsDiff['added'] = {};
  const removed: ConnectionsDiff['removed'] = {};
  const allNodeNames = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const nodeName of allNodeNames) {
    const prevNodeConnections = prev[nodeName] ?? {};
    const nextNodeConnections = next[nodeName] ?? {};
    const allInputNames = new Set([...Object.keys(prevNodeConnections), ...Object.keys(nextNodeConnections)]);
    for (const inputName of allInputNames) {
      const prevInputConnections = prevNodeConnections[inputName] ?? [];
      const nextInputConnections = nextNodeConnections[inputName] ?? [];
      const maxLength = Math.max(prevInputConnections.length, nextInputConnections.length);
      for (let sourceIndex = 0; sourceIndex < maxLength; sourceIndex++) {
        const prevConnections = prevInputConnections[sourceIndex] ?? [];
        const nextConnections = nextInputConnections[sourceIndex] ?? [];
        const prevMap = new Map(prevConnections.map((conn, idx) => [JSON.stringify(conn), { index: idx, connection: conn }]));
        const nextMap = new Map(nextConnections.map((conn, idx) => [JSON.stringify(conn), { index: idx, connection: conn }]));
        for (const [key, value] of nextMap) {
          if (!prevMap.has(key)) {
            if (!added[nodeName]) added[nodeName] = {};
            if (!added[nodeName][inputName]) added[nodeName][inputName] = [];
            added[nodeName][inputName].push({ sourceIndex, value: value as any });
          }
        }
        for (const [key, value] of prevMap) {
          if (!nextMap.has(key)) {
            if (!removed[nodeName]) removed[nodeName] = {};
            if (!removed[nodeName][inputName]) removed[nodeName][inputName] = [];
            removed[nodeName][inputName].push({ sourceIndex, value: value as any });
          }
        }
      }
    }
  }
  return { added, removed };
}
