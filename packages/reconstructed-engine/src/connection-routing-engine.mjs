// Connection Routing Engine — JS version for runner.mjs (ESM)
// 1:1 dari n8n 2.9.4 packages/workflow/src/common/* + graph/* + connections-diff

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
};

export function mapConnectionsByDestination(connections) {
  const byDest = {};
  for (const [sourceName, typeMap] of Object.entries(connections)) {
    for (const [type, outputSlots] of Object.entries(typeMap)) {
      for (let outputIndex = 0; outputIndex < outputSlots.length; outputIndex++) {
        const slot = outputSlots[outputIndex];
        if (!slot) continue;
        for (const conn of slot) {
          if (!conn) continue;
          const destName = conn.node;
          const destType = conn.type;
          const destIndex = conn.index;
          if (!byDest[destName]) byDest[destName] = {};
          if (!byDest[destName][destType]) byDest[destName][destType] = [];
          while (byDest[destName][destType].length <= destIndex) {
            byDest[destName][destType].push([]);
          }
          if (!byDest[destName][destType][destIndex]) byDest[destName][destType][destIndex] = [];
          byDest[destName][destType][destIndex].push({
            node: sourceName,
            type,
            index: outputIndex,
          });
        }
      }
    }
  }
  for (const destMap of Object.values(byDest)) {
    for (const slots of Object.values(destMap)) {
      for (let i = 0; i < slots.length; i++) {
        if (!slots[i]) slots[i] = [];
      }
    }
  }
  return byDest;
}

export function getConnectedNodes(connections, nodeName, connectionType = NodeConnectionTypes.Main, depth = -1, checkedNodesIncoming) {
  const newDepth = depth === -1 ? depth : depth - 1;
  if (depth === 0) return [];
  if (!Object.prototype.hasOwnProperty.call(connections, nodeName)) return [];

  let types;
  if (connectionType === 'ALL') types = Object.keys(connections[nodeName]);
  else if (connectionType === 'ALL_NON_MAIN') types = Object.keys(connections[nodeName]).filter(t => t !== 'main');
  else types = [connectionType];

  const returnNodes = [];

  types.forEach(type => {
    if (!Object.prototype.hasOwnProperty.call(connections[nodeName], type)) return;
    const checkedNodes = checkedNodesIncoming ? [...checkedNodesIncoming] : [];
    if (checkedNodes.includes(nodeName)) return;
    checkedNodes.push(nodeName);

    connections[nodeName][type].forEach(connectionsByIndex => {
      connectionsByIndex?.forEach(connection => {
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

export function getChildNodes(connections, nodeName, type = NodeConnectionTypes.Main, depth = -1) {
  return getConnectedNodes(connections, nodeName, type, depth);
}

export function getParentNodes(connectionsByDestination, nodeName, type = NodeConnectionTypes.Main, depth = -1) {
  return getConnectedNodes(connectionsByDestination, nodeName, type, depth);
}

export function getNodeByName(nodes, name) {
  return nodes.find(n => n.name === name);
}

export function buildAdjacencyList(connections) {
  const adj = new Map();
  for (const [source, typeMap] of Object.entries(connections)) {
    for (const slots of Object.values(typeMap)) {
      for (const slot of slots) {
        if (!slot) continue;
        for (const conn of slot) {
          if (!conn) continue;
          if (!adj.has(source)) adj.set(source, new Set());
          adj.get(source).add(conn);
          if (!adj.has(conn.node)) adj.set(conn.node, new Set());
        }
      }
    }
  }
  return adj;
}

export function getRootNodes(nodes, adjacency) {
  const roots = new Set();
  const hasIncoming = new Set();
  for (const [, conns] of adjacency.entries()) {
    for (const conn of conns) {
      if (conn.type !== 'main') continue;
      if (nodes.has(conn.node)) hasIncoming.add(conn.node);
    }
  }
  for (const node of nodes) {
    if (!hasIncoming.has(node)) roots.add(node);
  }
  return roots;
}

export function getLeafNodes(nodes, adjacency) {
  const leaves = new Set();
  for (const node of nodes) {
    const outgoing = adjacency.get(node);
    if (!outgoing) { leaves.add(node); continue; }
    let hasMainOutgoing = false;
    for (const conn of outgoing) {
      if (conn.type !== 'main') continue;
      if (conn.node === node) continue;
      if (nodes.has(conn.node)) { hasMainOutgoing = true; break; }
    }
    if (!hasMainOutgoing) leaves.add(node);
  }
  return leaves;
}

export function hasPath(start, end, adjacency) {
  const seen = new Set();
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift();
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

export function parseExtractableSubgraphSelection(nodes, adjacency) {
  const errors = [];
  const roots = getRootNodes(nodes, adjacency);
  const leaves = getLeafNodes(nodes, adjacency);

  if (roots.size > 1) errors.push({ errorCode: 'Multiple Input Nodes', message: 'Selection has multiple input nodes' });
  if (leaves.size > 1) errors.push({ errorCode: 'Multiple Output Nodes', message: 'Selection has multiple output nodes' });

  for (const node of nodes) {
    if (roots.has(node)) continue;
    for (const [source, conns] of adjacency.entries()) {
      if (nodes.has(source)) continue;
      for (const conn of conns) {
        if (conn.type !== 'main') continue;
        if (conn.node === node) errors.push({ errorCode: 'Input Edge To Non-Root Node', message: `Input edge to non-root node ${node}` });
      }
    }
  }

  for (const node of nodes) {
    if (leaves.has(node)) continue;
    const conns = adjacency.get(node);
    if (!conns) continue;
    for (const conn of conns) {
      if (conn.type !== 'main') continue;
      if (!nodes.has(conn.node)) errors.push({ errorCode: 'Output Edge From Non-Leaf Node', message: `Output edge from non-leaf node ${node}` });
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

export function compareConnections(prev, next) {
  const added = {};
  const removed = {};
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
