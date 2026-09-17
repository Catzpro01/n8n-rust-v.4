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

  /**
   * Jumlah eksekusi maksimum per node dalam satu run.
   *
   * n8n asli tidak pernah mengulang node tanpa batas: `workflow-validation.ts` /
   * `graph/graph-utils.ts` (LEGO Validation) menolak siklus pada graph umum, dan
   * engine aslinya mengeksekusi node sekali per kedatangan input. Rekonstruksi BFS
   * ini memakai aturan yang setara dan *dijamin berhenti*: sebuah node boleh
   * dieksekusi sebanyak jumlah edge masuknya (fan-in), minimal 1.
   *   - linear  A->B            : B 1x  (sama seperti sebelumnya)
   *   - diamond A->B,A->C,B&C->D: D 2x  (sama seperti sebelumnya)
   *   - siklus  A->B->A         : A 1x, B 1x, lalu A ditandai `cycleSkips` dan run berhenti
   */
  maxExecutionsFor(nodeName) {
    let inbound = 0;
    for (const source of Object.values(this.connections)) {
      for (const outputList of source?.main ?? []) {
        for (const conn of outputList ?? []) {
          if (conn?.node === nodeName) inbound += 1;
        }
      }
    }
    return Math.max(1, inbound);
  }

  async runWorkflow(startNodeName = null, initialData = [{}]) {
    const executionData = new Map(); // nodeName -> Array of items [{ json: { ... } }]
    const visited = new Set();
    const executionLog = [];
    const executionCounts = new Map(); // nodeName -> berapa kali sudah dieksekusi pada run ini
    const cycleSkips = []; // node yang ditolak karena sudah melewati batas fan-in (indikasi siklus)

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

      // CYCLE GUARD. Tanpa ini graph bersiklus membuat loop BFS tak berujung — dan
      // karena loop-nya sinkron, event loop ikut kelaparan sehingga setTimeout
      // watchdog di luar pun tidak pernah jalan (terverifikasi: run A->B->A masih
      // hidup setelah 12 detik dan harus di-kill oleh `timeout`).
      const executed = executionCounts.get(nodeName) ?? 0;
      if (executed >= this.maxExecutionsFor(nodeName)) {
        cycleSkips.push({ node: nodeName, executions: executed, droppedItems: inputData.length });
        continue;
      }
      executionCounts.set(nodeName, executed + 1);

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
      // `cyclic: true` berarti graph mengandung siklus dan beberapa kedatangan input
      // dibuang supaya run berhenti. Deteksi siklus yang sesungguhnya (menolak graph
      // sebelum dieksekusi) adalah tanggung jawab LEGO Validation — lihat
      // contracts/validation.contract.md §CycleDetection.
      cyclic: cycleSkips.length > 0,
      cycleSkips,
      executionLog,
      data: Object.fromEntries(executionData.entries())
    };
  }
}
