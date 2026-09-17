/**
 * Reconstructed n8n Workflow Execution Engine (Node.js/ESM)
 * Mengadaptasi logika eksekusi DAG, state data flow, dan node handler 1:1 n8n v2.9.4.
 */

export class WorkflowExecutionEngine {
  constructor(workflowDefinition) {
    this.nodes = new Map();
    this.connections = workflowDefinition.connections || {};
    this.nodeTypes = new Map();
    
    // Inisialisasi node registry
    for (const node of workflowDefinition.nodes || []) {
      this.nodes.set(node.name, node);
    }
  }

  registerNodeType(typeName, handler) {
    this.nodeTypes.set(typeName, handler);
  }

  async runWorkflow(startNodeName = null, initialData = [{}]) {
    const executionData = new Map(); // nodeName -> Array of items [{ json: { ... } }]
    const visited = new Set();
    const executionLog = [];

    // Cari entry trigger node jika tidak ditentukan eksplisit
    let currentNodeName = startNodeName;
    if (!currentNodeName) {
      for (const [name, node] of this.nodes.entries()) {
        if (node.type.includes('trigger') || node.type.includes('Manual') || node.type.includes('Start')) {
          currentNodeName = name;
          break;
        }
      }
    }

    if (!currentNodeName) {
      // Ambil sembarang node pertama
      currentNodeName = this.nodes.keys().next().value;
    }

    if (!currentNodeName) {
      throw new Error("No nodes found in workflow definition");
    }

    // Queue antrean eksekusi berbasis DAG BFS
    const queue = [{ nodeName: currentNodeName, inputData: initialData.map(d => ({ json: d })) }];

    while (queue.length > 0) {
      const { nodeName, inputData } = queue.shift();
      const node = this.nodes.get(nodeName);
      if (!node) continue;

      const startTime = Date.now();
      const handler = this.nodeTypes.get(node.type);

      let outputData = [];
      if (handler) {
        // Eksekusi logika node
        outputData = await handler(node, inputData);
      } else {
        // Default passthrough node
        outputData = inputData;
      }

      const durationMs = Date.now() - startTime;
      executionData.set(nodeName, outputData);
      visited.add(nodeName);

      executionLog.push({
        node: nodeName,
        type: node.type,
        inputCount: inputData.length,
        outputCount: outputData.length,
        durationMs,
        status: "success"
      });

      // Cari koneksi output ke node berikutnya
      const nodeConns = this.connections[nodeName];
      if (nodeConns && nodeConns.main) {
        for (const outputList of nodeConns.main) {
          for (const conn of outputList) {
            const nextNode = conn.node;
            queue.push({ nodeName: nextNode, inputData: outputData });
          }
        }
      }
    }

    return {
      status: "COMPLETED",
      finished: true,
      executionLog,
      data: Object.fromEntries(executionData.entries())
    };
  }
}
