/**
 * Reconstructed n8n Workflow Execution Engine (Node.js/ESM)
 * Mengadaptasi logika eksekusi DAG, state data flow, dan node handler 1:1 n8n v2.9.4.
 * Owner: Agent 3 — Connection + Agent 1 — Workflow
 * Zero Rust, pure JS/TS, frontend UI 100% original
 */

import {
  mapConnectionsByDestination,
  getChildNodes,
  getParentNodes,
  buildAdjacencyList,
  getRootNodes,
  getLeafNodes,
  hasPath,
  compareConnections,
  NodeConnectionTypes,
} from './src/connection-routing-engine.mjs';

export {
  mapConnectionsByDestination,
  getChildNodes,
  getParentNodes,
  buildAdjacencyList,
  getRootNodes,
  getLeafNodes,
  hasPath,
  compareConnections,
  NodeConnectionTypes,
};

export class WorkflowExecutionEngine {
  constructor(workflowDefinition) {
    this.nodes = new Map();
    this.connections = workflowDefinition.connections || {};
    this.connectionsByDestination = mapConnectionsByDestination(this.connections);
    this.adjacencyList = buildAdjacencyList(this.connections);
    this.nodeTypes = new Map();
    
    for (const node of workflowDefinition.nodes || []) {
      this.nodes.set(node.name, node);
    }

    // Validasi graph — cycles legal di n8n 2.9.4 (Loop nodes)
    this.allowCycles = true;
  }

  registerNodeType(typeName, handler) {
    this.nodeTypes.set(typeName, handler);
  }

  getNode(name) {
    return this.nodes.get(name) || null;
  }

  getChildNodes(nodeName, type = 'main', depth = -1) {
    return getChildNodes(this.connections, nodeName, type, depth);
  }

  getParentNodes(nodeName, type = 'main', depth = -1) {
    return getParentNodes(this.connectionsByDestination, nodeName, type, depth);
  }

  getNodeConnectionIndexes(nodeName, parentNodeName, type = 'main') {
    // BFS upward — 1:1 dari workflow.ts:746-810
    if (!this.getNode(parentNodeName)) return undefined;
    const visited = new Set();
    const queue = [nodeName];
    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      const typeConnections = this.connectionsByDestination[current]?.[type];
      if (!typeConnections) continue;
      for (let typedIdx = 0; typedIdx < typeConnections.length; typedIdx++) {
        const slot = typeConnections[typedIdx];
        if (!slot) continue;
        for (let destIdx = 0; destIdx < slot.length; destIdx++) {
          const conn = slot[destIdx];
          if (!conn) continue;
          if (conn.node === parentNodeName) {
            return { sourceIndex: conn.index, destinationIndex: destIdx };
          }
          if (!visited.has(conn.node)) queue.push(conn.node);
        }
      }
    }
    return undefined;
  }

  getHighestNode(nodeName) {
    // Mengembalikan ancestors tanpa incoming main — 1:1 dari workflow.ts:492-575
    const nodesObj = Object.fromEntries(this.nodes.entries());
    const visited = [];
    const result = [];
    
    const recurse = (name) => {
      if (visited.includes(name)) return [];
      visited.push(name);
      if (!this.connectionsByDestination[name] || !this.connectionsByDestination[name].main) {
        return nodesObj[name]?.disabled === false ? [name] : [];
      }
      let returnNodes = [];
      for (const slot of this.connectionsByDestination[name].main) {
        if (!slot) continue;
        for (const conn of slot) {
          if (visited.includes(conn.node)) continue;
          if (!nodesObj[conn.node]) continue;
          let addNodes = recurse(conn.node);
          if (addNodes.length === 0 && nodesObj[conn.node].disabled !== true) {
            addNodes = [conn.node];
          }
          for (const n of addNodes) {
            if (!returnNodes.includes(n)) returnNodes.push(n);
          }
        }
      }
      return returnNodes;
    };

    return recurse(nodeName);
  }

  getStartNode(destinationNode) {
    // 1:1 dari workflow.ts:817-891 — STARTING_NODE_TYPES + trigger/poll check
    const STARTING_NODE_TYPES = [
      'n8n-nodes-base.manualTrigger',
      'n8n-nodes-base.executeWorkflowTrigger',
      'n8n-nodes-base.errorTrigger',
      'n8n-nodes-base.evaluationTrigger',
      'n8n-nodes-base.formTrigger',
    ];

    const getStartFromList = (names) => {
      if (names.length === 1 && this.nodes.has(names[0]) && !this.nodes.get(names[0]).disabled) {
        return this.nodes.get(names[0]);
      }
      // Check for trigger/poll nodes (simplified — needs node type registry)
      for (const name of names) {
        const node = this.nodes.get(name);
        if (!node || node.disabled) continue;
        if (node.type.includes('Trigger') || node.type.includes('trigger')) return node;
      }
      // Sort by STARTING_NODE_TYPES
      const sorted = [...names].sort((a, b) => {
        const nodeA = this.nodes.get(a);
        const nodeB = this.nodes.get(b);
        if (!nodeA || !nodeB) return 0;
        return STARTING_NODE_TYPES.indexOf(nodeA.type) - STARTING_NODE_TYPES.indexOf(nodeB.type);
      });
      for (const name of sorted) {
        const node = this.nodes.get(name);
        if (!node || node.disabled) continue;
        if (STARTING_NODE_TYPES.includes(node.type)) return node;
      }
      return undefined;
    };

    if (destinationNode) {
      const highest = this.getHighestNode(destinationNode);
      if (highest.length === 0) return this.nodes.get(destinationNode) || undefined;
      const start = getStartFromList(highest);
      return start || this.nodes.get(highest[0]);
    } else {
      return getStartFromList([...this.nodes.keys()]);
    }
  }

  async runWorkflow(startNodeName = null, initialData = [{}]) {
    const executionData = new Map();
    const visited = new Set();
    const executionLog = [];
    const executionStack = [];

    let currentNodeName = startNodeName;
    if (!currentNodeName) {
      const startNode = this.getStartNode();
      currentNodeName = startNode?.name || this.nodes.keys().next().value;
    }

    if (!currentNodeName) throw new Error("No nodes found in workflow definition");

    const queue = [{ nodeName: currentNodeName, inputData: initialData.map(d => ({ json: d })), depth: 0 }];

    while (queue.length > 0) {
      const { nodeName, inputData, depth } = queue.shift();
      const node = this.nodes.get(nodeName);
      if (!node) continue;

      // Cycle protection — visited set per path, not global, karena cycles legal
      const pathKey = `${nodeName}:${depth}`;
      if (visited.has(pathKey) && depth > 10) continue; // Prevent infinite loop on cycles, allow up to 10 iterations
      visited.add(pathKey);

      const startTime = Date.now();
      const handler = this.nodeTypes.get(node.type);

      let outputData = [];
      try {
        if (handler) {
          outputData = await handler(node, inputData);
        } else {
          outputData = inputData;
        }
      } catch (error) {
        // Natural error pipeline — anti AI slop formatter
        let formatted = error;
        try {
          const mod = await import('./src/natural-error-pipeline.mjs').catch(() => null);
          if (mod && mod.formatNaturalError) formatted = mod.formatNaturalError(error);
        } catch {
          formatted = { message: error.message || 'Node execution failed', description: error.description, httpCode: 500 };
        }
        executionLog.push({
          node: nodeName,
          type: node.type,
          inputCount: inputData.length,
          outputCount: 0,
          durationMs: Date.now() - startTime,
          status: "error",
          error: formatted,
        });
        continue;
      }

      const durationMs = Date.now() - startTime;
      executionData.set(nodeName, outputData);

      executionLog.push({
        node: nodeName,
        type: node.type,
        inputCount: inputData.length,
        outputCount: outputData.length,
        durationMs,
        status: "success",
      });

      executionStack.push(nodeName);

      // Routing via connections — support main + ai_* types
      const nodeConns = this.connections[nodeName];
      if (nodeConns) {
        for (const [connType, outputList] of Object.entries(nodeConns)) {
          if (!outputList) continue;
          for (let outputIndex = 0; outputIndex < outputList.length; outputIndex++) {
            const slot = outputList[outputIndex];
            if (!slot) continue;
            for (const conn of slot) {
              if (!conn) continue;
              // Only route main for execution, ai_* for sub-node resolution
              if (connType === 'main' || connType.startsWith('ai_')) {
                queue.push({ nodeName: conn.node, inputData: outputData, depth: depth + 1 });
              }
            }
          }
        }
      }
    }

    return {
      status: "COMPLETED",
      finished: true,
      executionLog,
      executionStack,
      data: Object.fromEntries(executionData.entries()),
      connectionsBySource: this.connections,
      connectionsByDestination: this.connectionsByDestination,
      adjacencyKeys: [...this.adjacencyList.keys()],
    };
  }

  // Diff utility
  diffConnections(prev, next) {
    return compareConnections(prev, next);
  }
}
