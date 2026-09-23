/**
 * TS Baseline Runtime Adapter (Worker 4 — LEGO Integration).
 *
 * Satu-satunya jembatan resmi antara `apps/n8n-ts` dan LEGO engine.
 * Frozen interface (lihat contracts/ts-baseline-runtime.contract.md §9):
 *
 *   validateBaselineWorkflow(workflow, { startNode } = {})
 *   createBaselineEngine(workflow, { locale } = {})
 *   BASELINE_KNOWN_NODE_TYPES
 *
 * Aturan:
 * - Adapter ini TIDAK mengeksekusi workflow sendiri (tidak ada loop BFS di sini).
 *   Eksekusi tetap milik `WorkflowExecutionEngine` di `runner.mjs`.
 * - Adapter TIDAK mengimpor apps/*, deploy/*, tests/*, crates/*.
 * - Handler bawaan deterministik dan aman (tanpa eval, fs, net).
 */

import { WorkflowExecutionEngine } from './runner.mjs';

/** Node type yang memiliki handler bawaan baseline (kontrak §4). */
export const BASELINE_KNOWN_NODE_TYPES = Object.freeze([
  'n8n-nodes-base.manualTrigger',
  'n8n-nodes-base.noOp',
  'n8n-nodes-base.set',
  'n8n-nodes-base.code',
  'n8n-nodes-base.if',
]);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validasi struktur workflow baseline (kontrak §3).
 * Tidak pernah throw untuk input tidak valid — selalu kembalikan { ok, errors }.
 *
 * @param {unknown} workflow - nilai `body.workflow` dari request.
 * @param {{ startNode?: unknown }} [opts]
 * @returns {{ ok: boolean, errors: Array<{ message: string, hint: string }> }}
 */
export function validateBaselineWorkflow(workflow, opts = {}) {
  const errors = [];

  if (!isPlainObject(workflow)) {
    return {
      ok: false,
      errors: [{ message: "Field 'workflow' is required and must be an object", hint: 'MALFORMED_REQUEST' }],
    };
  }

  if (!Array.isArray(workflow.nodes)) {
    errors.push({ message: "Field 'workflow.nodes' must be an array", hint: 'MALFORMED_REQUEST' });
    return { ok: false, errors };
  }

  if (workflow.nodes.length === 0) {
    errors.push({ message: 'Workflow has no nodes', hint: 'EMPTY_WORKFLOW' });
    return { ok: false, errors };
  }

  // Kumpulkan nama node + validasi name/type per index.
  const names = new Set();
  for (let i = 0; i < workflow.nodes.length; i++) {
    const node = workflow.nodes[i];
    const nameOk = isPlainObject(node) && typeof node.name === 'string' && node.name.trim() !== '';
    const typeOk = isPlainObject(node) && typeof node.type === 'string' && node.type.trim() !== '';
    if (!nameOk || !typeOk) {
      errors.push({ message: `Node at index ${i} has invalid name/type`, hint: 'MALFORMED_REQUEST' });
      continue;
    }
    if (names.has(node.name)) {
      errors.push({ message: `Duplicate node name "${node.name}"`, hint: 'MALFORMED_REQUEST' });
    } else {
      names.add(node.name);
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  // connections: opsional, default {}. Jika ada harus object.
  const connections = workflow.connections ?? {};
  if (!isPlainObject(connections)) {
    errors.push({ message: "Field 'workflow.connections' must be an object", hint: 'MALFORMED_REQUEST' });
    return { ok: false, errors };
  }

  // Validasi referensi koneksi (source + target harus node yang dikenal).
  for (const [sourceName, nodeConns] of Object.entries(connections)) {
    if (!names.has(sourceName)) {
      errors.push({ message: `Connection references unknown node "${sourceName}"`, hint: 'UNKNOWN_NODE' });
      continue;
    }
    if (!isPlainObject(nodeConns)) continue; // lenient: abaikan bentuk aneh non-object
    const main = nodeConns.main;
    if (main === undefined) continue; // hanya `main` yang dibaca baseline
    if (!Array.isArray(main)) {
      errors.push({
        message: `Connections for node "${sourceName}" have invalid 'main' (must be an array)`,
        hint: 'MALFORMED_REQUEST',
      });
      continue;
    }
    for (const outputList of main) {
      if (!Array.isArray(outputList)) {
        errors.push({
          message: `Connections for node "${sourceName}" have invalid output list (must be an array)`,
          hint: 'MALFORMED_REQUEST',
        });
        break;
      }
      for (const conn of outputList) {
        const target = conn?.node;
        if (typeof target !== 'string' || target.trim() === '') {
          errors.push({
            message: `Connection from node "${sourceName}" has invalid target`,
            hint: 'MALFORMED_REQUEST',
          });
        } else if (!names.has(target)) {
          errors.push({ message: `Connection references unknown node "${target}"`, hint: 'UNKNOWN_NODE' });
        }
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  // startNode opsional: jika diisi harus string + menunjuk node yang ada.
  const { startNode } = opts ?? {};
  if (startNode !== undefined) {
    if (typeof startNode !== 'string' || startNode.trim() === '') {
      errors.push({ message: "Field 'startNode' must be a non-empty string", hint: 'MALFORMED_REQUEST' });
    } else if (!names.has(startNode)) {
      errors.push({ message: `Start node "${startNode}" not found`, hint: 'UNKNOWN_NODE' });
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] };
}

/* ------------------------------------------------------------------ */
/* Handler bawaan baseline (kontrak §4). Deterministik, tanpa IO.       */
/* ------------------------------------------------------------------ */

async function manualTriggerHandler(_node, _items) {
  return [{ json: { triggeredAt: new Date().toISOString(), status: 'ACTIVE' } }];
}

async function passthroughHandler(_node, items) {
  return items;
}

async function codeSkipHandler(_node, items) {
  // Baseline TIDAK mengeksekusi jsCode user (risiko keamanan).
  // Marker eksplisit agar perilaku mudah di-debug dan di-test.
  return items.map((item) => ({
    json: { ...(item?.json ?? {}), codeSkipped: true },
  }));
}

/**
 * Buat engine baseline siap pakai (handler bawaan terdaftar).
 * TIDAK menjalankan workflow — panggil `engine.runWorkflow()` di runtime.
 *
 * @param {object} workflow - definisi workflow tervalidasi.
 * @param {{ locale?: string }} [opts]
 * @returns {WorkflowExecutionEngine}
 */
export function createBaselineEngine(workflow, opts = {}) {
  const engine = new WorkflowExecutionEngine(workflow, {
    ...(opts?.locale !== undefined ? { locale: opts.locale } : {}),
  });

  engine.registerNodeType('n8n-nodes-base.manualTrigger', manualTriggerHandler);
  engine.registerNodeType('n8n-nodes-base.noOp', passthroughHandler);
  engine.registerNodeType('n8n-nodes-base.set', passthroughHandler);
  engine.registerNodeType('n8n-nodes-base.code', codeSkipHandler);
  engine.registerNodeType('n8n-nodes-base.if', passthroughHandler);

  return engine;
}
