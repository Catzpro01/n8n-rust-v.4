/**
 * LEGO integration adapter (Worker 4 surface used by Worker 1).
 *
 * SINGLE ENGINE RULE:
 *   Workflow DAG execution MUST go through packages/reconstructed-engine/runner.mjs.
 *   Do not invent a second execution engine here.
 *
 * Wiring:
 *   - reconstructed-engine → WorkflowExecutionEngine (run path)
 *   - execution-lego       → provenance + optional ActiveExecutions ports
 *   - workflow-lego        → provenance marker (structural model lives there)
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const ENGINE_RUNNER = path.join(REPO_ROOT, 'packages/reconstructed-engine/runner.mjs');
const EXECUTION_ENGINE_TS = path.join(
  REPO_ROOT,
  'packages/reconstructed-engine/src/execution-engine.ts',
);

export const LEGO_INTEGRATION = Object.freeze({
  engine: 'reconstructed-engine',
  runnerPath: ENGINE_RUNNER,
  workflowLego: '@lego/workflow',
  executionLego: '@lego/execution',
  secondEngineForbidden: true,
  contract: 'contracts/ts-runtime-baseline.contract.md',
});

let runnerModulePromise;

/**
 * Dynamic-import the reconstructed engine runner (ESM).
 * @returns {Promise<typeof import('../../../packages/reconstructed-engine/runner.mjs')>}
 */
export async function loadEngineRunner() {
  if (!runnerModulePromise) {
    runnerModulePromise = import(pathToFileURL(ENGINE_RUNNER).href);
  }
  return runnerModulePromise;
}

/**
 * Try to surface execution-lego / reconstructed-engine ActiveExecutions factory.
 * Baseline does not require it for the hot path; presence is recorded for doctor.
 */
export async function probeExecutionLego() {
  const result = {
    available: false,
    symbols: [],
    error: null,
  };
  try {
    // Prefer the reconstructed-engine TS source via Node strip-types when possible;
    // otherwise report path presence only (no second engine).
    const require = createRequire(import.meta.url);
    const fs = require('node:fs');
    if (fs.existsSync(EXECUTION_ENGINE_TS)) {
      result.available = true;
      result.symbols = [
        'ActiveExecutions',
        'createExecutionRuntime',
        'ExecutionRecoveryService',
      ];
      result.source = EXECUTION_ENGINE_TS;
    }
    const executionLegoIndex = path.join(REPO_ROOT, 'packages/execution-lego/src/index.ts');
    if (fs.existsSync(executionLegoIndex)) {
      result.executionLegoIndex = executionLegoIndex;
      result.reExportsEngine = true;
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  return result;
}

/**
 * Probe workflow-lego package presence (model surface).
 */
export async function probeWorkflowLego() {
  const require = createRequire(import.meta.url);
  const fs = require('node:fs');
  const pkg = path.join(REPO_ROOT, 'packages/workflow-lego/package.json');
  const index = path.join(REPO_ROOT, 'packages/workflow-lego/src/index.ts');
  return {
    available: fs.existsSync(pkg) && fs.existsSync(index),
    packageJson: pkg,
    index,
  };
}

/**
 * Built-in baseline node handlers.
 * Safe: no user-code eval. Unknown types handled by caller policy.
 */
export function createBuiltinHandlers() {
  return {
    'n8n-nodes-base.manualTrigger': async (_node, items) => {
      if (Array.isArray(items) && items.length > 0) {
        return items.map((item) => ({
          json: {
            ...(item?.json ?? {}),
            triggered: true,
            at: new Date().toISOString(),
          },
        }));
      }
      return [{ json: { triggered: true, at: new Date().toISOString() } }];
    },

    'n8n-nodes-base.noOp': async (_node, items) => items,

    'n8n-nodes-base.set': async (node, items) => {
      const params = node?.parameters ?? {};
      const values = params.values ?? params.assignments?.assignments ?? null;
      return (items ?? []).map((item) => {
        const base = { ...(item?.json ?? {}) };
        if (Array.isArray(values)) {
          for (const entry of values) {
            const name = entry?.name ?? entry?.id;
            if (typeof name === 'string' && name.length > 0) {
              base[name] = entry.value;
            }
          }
        } else if (params.keepOnlySet === true && values == null) {
          // keep input when no assignments provided
        }
        if (params.fields && typeof params.fields === 'object') {
          Object.assign(base, params.fields);
        }
        return { json: base };
      });
    },

    /**
     * Baseline Code node: NO eval. Marks the item and optionally merges static preview.
     * Full JS execution is deferred to a later, sandboxed migration step.
     */
    'n8n-nodes-base.code': async (node, items) => {
      const params = node?.parameters ?? {};
      return (items ?? []).map((item) => ({
        json: {
          ...(item?.json ?? {}),
          codeNode: true,
          engine: 'n8n-ts-baseline',
          // surface that user JS was not executed (debuggable, honest)
          codeExecuted: false,
          mode: params.mode ?? null,
        },
      }));
    },

    'n8n-nodes-base.if': async (_node, items) => {
      // Baseline: all items to branch 0 (engine connections use main[0] first).
      return items;
    },

    'n8n-nodes-base.merge': async (_node, items) => items,

    'n8n-nodes-base.httpRequest': async (node, items) => {
      // Baseline stub — does not perform real HTTP (safe default).
      return (items ?? []).map((item) => ({
        json: {
          ...(item?.json ?? {}),
          httpRequestStub: true,
          url: node?.parameters?.url ?? null,
        },
      }));
    },
  };
}

/**
 * Create a WorkflowExecutionEngine bound to a workflow definition and register builtins.
 * @param {object} workflowDefinition
 * @param {{ locale?: string, strictTypes?: boolean, extraHandlers?: Record<string, Function> }} [options]
 */
export async function createBoundEngine(workflowDefinition, options = {}) {
  const { WorkflowExecutionEngine } = await loadEngineRunner();
  const engine = new WorkflowExecutionEngine(workflowDefinition, {
    locale: options.locale,
    activeLocale: options.locale,
    translations: options.translations,
  });

  const handlers = {
    ...createBuiltinHandlers(),
    ...(options.extraHandlers ?? {}),
  };

  for (const [type, handler] of Object.entries(handlers)) {
    engine.registerNodeType(type, handler);
  }

  return { engine, handlers, lego: LEGO_INTEGRATION };
}

/**
 * Collect unknown node types present in the workflow vs registered handlers.
 * @param {object} workflow
 * @param {Record<string, Function>} handlers
 * @returns {string[]}
 */
export function findUnknownNodeTypes(workflow, handlers) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  const unknown = [];
  const seen = new Set();
  for (const node of nodes) {
    const type = node?.type;
    if (typeof type !== 'string' || type.length === 0) {
      if (!seen.has('<missing-type>')) {
        seen.add('<missing-type>');
        unknown.push('<missing-type>');
      }
      continue;
    }
    if (!handlers[type] && !seen.has(type)) {
      seen.add(type);
      unknown.push(type);
    }
  }
  return unknown;
}

/**
 * Run a workflow through the single reconstructed engine.
 * @param {object} workflow
 * @param {{ startNode?: string|null, inputData?: unknown, locale?: string, strictTypes?: boolean }} [options]
 */
export async function runWorkflowViaLego(workflow, options = {}) {
  const strictTypes = options.strictTypes !== false;
  const { engine, handlers } = await createBoundEngine(workflow, {
    locale: options.locale,
  });

  if (strictTypes) {
    const unknown = findUnknownNodeTypes(workflow, handlers);
    if (unknown.length > 0) {
      const err = new Error(`Unknown node type: ${unknown[0]}`);
      err.code = 422;
      err.details = { unknownNodeTypes: unknown };
      throw err;
    }
  }

  const inputData = normalizeInputData(options.inputData);
  const result = await engine.runWorkflow(options.startNode ?? null, inputData, {
    locale: options.locale,
  });

  return {
    result,
    engineMeta: {
      engine: LEGO_INTEGRATION.engine,
      locale: engine.getLocale?.() ?? options.locale ?? null,
    },
  };
}

function normalizeInputData(inputData) {
  if (inputData === undefined || inputData === null) return [{}];
  if (Array.isArray(inputData)) return inputData.length ? inputData : [{}];
  if (typeof inputData === 'object') return [inputData];
  return [{ value: inputData }];
}
