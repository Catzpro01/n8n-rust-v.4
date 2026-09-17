import { WorkflowExecutionEngine } from './runner.mjs';

// 1. Workflow Definition persis format n8n
const workflow = {
  nodes: [
    {
      name: "Manual Trigger",
      type: "n8n-nodes-base.manualTrigger",
      parameters: {}
    },
    {
      name: "Code Node",
      type: "n8n-nodes-base.code",
      parameters: {
        mode: "runOnceForEachItem"
      }
    },
    {
      name: "Transform Output",
      type: "n8n-nodes-base.set",
      parameters: {
        keepOnlySet: true
      }
    }
  ],
  connections: {
    "Manual Trigger": {
      main: [
        [{ node: "Code Node", type: "main", index: 0 }]
      ]
    },
    "Code Node": {
      main: [
        [{ node: "Transform Output", type: "main", index: 0 }]
      ]
    }
  }
};

// 2. Inisialisasi engine
const engine = new WorkflowExecutionEngine(workflow);

// 3. Daftarkan node handlers murni
engine.registerNodeType("n8n-nodes-base.manualTrigger", async (node, items) => {
  return [{ json: { triggeredAt: new Date().toISOString(), status: "ACTIVE" } }];
});

engine.registerNodeType("n8n-nodes-base.code", async (node, items) => {
  return items.map(item => ({
    json: {
      ...item.json,
      reconstructed: true,
      engine: "n8n-reconstructed-v2.9.4",
      timestamp: Date.now()
    }
  }));
});

engine.registerNodeType("n8n-nodes-base.set", async (node, items) => {
  return items.map(item => ({
    json: {
      finalResult: "PASS",
      processedItems: items.length,
      data: item.json
    }
  }));
});

// 4. Jalankan workflow
console.log("=== MEMULAI TEST RUN ENGINE REKONSTRUKSI n8n ===");
const start = performance.now();
const result = await engine.runWorkflow();
const duration = (performance.now() - start).toFixed(2);

console.log(`Eksekusi Selesai dalam ${duration}ms!`);
console.log("Hasil Eksekusi Node:");
console.log(JSON.stringify(result, null, 2));

// `status` sekarang memakai ExecutionStatus n8n asli ('success' | 'error'),
// lihat reference/n8n/packages/workflow/src/execution-status.ts — bukan 'COMPLETED' lagi.
// Skrip ini hanya demo console; kontrak yang sesungguhnya ada di test/engine.test.mjs
// dan test/reference-equivalence.test.mjs (`npm run engine:test`).
if (result.status === "success" && result.data["Transform Output"]) {
  console.log("\n>>> Demo berhasil. Verifikasi yang sebenarnya: npm run engine:test <<<");
} else {
  console.error("Eksekusi gagal");
  process.exit(1);
}
