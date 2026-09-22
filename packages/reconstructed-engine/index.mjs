/**
 * EXECUTION ENGINE LEGO — the frozen entrypoint consumed by apps/n8n-ts.
 *
 * Contract: contracts/runtime-api.contract.md §5
 *
 *   ENGINE_PACKAGE, ENGINE_VERSION, NODE_REGISTRY_VERSION
 *   createNodeRegistry, createWorkflowEngine, runWorkflowDefinition,
 *   validateWorkflowDefinition, listNodeTypes, WorkflowRunError
 *
 * Rules honoured here:
 *   - the reconstructed DAG engine (`runner.mjs`) stays the single execution
 *     engine; this module only wraps it with validation, the node registry and
 *     a locale policy that never rewrites executed data
 *   - no I/O, no HTTP, no filesystem access
 */
import { WorkflowExecutionEngine } from './runner.mjs';
import { createNodeRegistry, NODE_REGISTRY_VERSION, registryNodeTypes } from './node-registry.mjs';
import {
  WorkflowRunError,
  assertRunnableDefinition,
  normalize,
  validateWorkflowDefinition,
} from './validation.mjs';
import packageJson from './package.json' with { type: 'json' };

export const ENGINE_PACKAGE = '@lego/reconstructed-engine';
export const ENGINE_VERSION = packageJson.version;

export {
  WorkflowRunError,
  validateWorkflowDefinition,
  assertRunnableDefinition,
  normalize,
  createNodeRegistry,
  NODE_REGISTRY_VERSION,
};

export { nodeAliasOf, getNodeCatalogEntry, registerBuiltInNodeCatalog } from './node-catalog.mjs';
export { SUPPORTED_LOCALE_CODES, normalizeSupportedLocale } from './localization.mjs';

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Keep executed data pristine.
 *
 * `runner.mjs` applies the LEGO locale layer to the whole response, which can
 * translate string values inside user payloads when their key looks
 * human-facing (e.g. `json.message`).  The locale layer is a presentation
 * concern, so the entrypoint restricts it to the response metadata and leaves
 * `data` exactly as the node handlers produced it.
 */
function restrictLocalizationToMetadata(engine) {
  const enforcer = engine.localeEnforcer;
  if (!enforcer || typeof enforcer.enforceExecutionResponse !== 'function') return engine;
  const original = enforcer.enforceExecutionResponse.bind(enforcer);
  enforcer.enforceExecutionResponse = (payload, locale) => {
    if (!isPlainObject(payload)) return payload;
    const localizedMetadata = original({ status: payload.status, executionLog: payload.executionLog }, locale);
    const out = { ...payload };
    if (isPlainObject(localizedMetadata)) {
      if (localizedMetadata.statusText !== undefined) out.statusText = localizedMetadata.statusText;
      if (Array.isArray(localizedMetadata.executionLog)) out.executionLog = localizedMetadata.executionLog;
    }
    return out;
  };
  return engine;
}

/**
 * Build an engine instance with the built-in node handlers registered.
 *
 * @param {object} definition validated workflow definition
 * @param {{ locale?: string, allowCodeEval?: boolean, registry?: object }} [options]
 */
export function createWorkflowEngine(definition, options = {}) {
  const locale = options.locale ?? 'id';
  const registry =
    options.registry ??
    createNodeRegistry({ locale, allowCodeEval: options.allowCodeEval === true, onWarning: options.onWarning });
  const engine = new WorkflowExecutionEngine(definition, { locale });
  for (const [type, handler] of registry.handlers) {
    engine.registerNodeType(type, (node, items) => handler(node, items, registry.context));
  }
  return restrictLocalizationToMetadata(engine);
}

/** Accept `[{json: …}]`, a bare object, or a plain array of JSON values. */
export function normalizeRunInput(input) {
  if (input === undefined || input === null) return [{}];
  const list = Array.isArray(input) ? input : [input];
  const items = list.map((entry) => (isPlainObject(entry) && Object.hasOwn(entry, 'json') ? entry.json : entry));
  return items.length > 0 ? items : [{}];
}

function dedupeWarnings(warnings) {
  const seen = new Set();
  const out = [];
  for (const warning of warnings) {
    if (!warning || typeof warning !== 'object' || typeof warning.code !== 'string') continue;
    const key = `${warning.code}|${warning.node ?? ''}|${warning.message ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...warning });
  }
  return out;
}

/**
 * Validate and execute a workflow definition in one call.
 *
 * @param {object} definition
 * @param {{ startNode?: string|null, input?: unknown, locale?: string,
 *           allowCodeEval?: boolean, registry?: object,
 *           onWarning?: (w: object) => void }} [options]
 * @returns {Promise<{status:string, finished:boolean, executionLog:object[],
 *                    data:Record<string, object[]>, warnings:object[], statusText?:string, locale:string}>}
 * @throws {WorkflowRunError} for pre-execution failures (EMPTY_WORKFLOW | INVALID_WORKFLOW)
 */
export async function runWorkflowDefinition(definition, options = {}) {
  const locale = options.locale ?? definition?.activeLocale ?? 'id';
  const registry =
    options.registry ??
    createNodeRegistry({
      locale,
      allowCodeEval: options.allowCodeEval === true,
      onWarning: options.onWarning,
    });

  const { definition: runnable, warnings } = assertRunnableDefinition(definition, { registry });
  const engine = createWorkflowEngine(runnable, { locale, registry });
  const input = normalizeRunInput(options.input);
  const result = await engine.runWorkflow(options.startNode ?? null, input, { locale });

  return {
    ...result,
    finished: result.finished ?? result.status === 'COMPLETED',
    warnings: dedupeWarnings([...warnings, ...registry.takeWarnings()]),
    locale: engine.getLocale?.() ?? locale,
  };
}

/** Registered node types of the built-in registry (stable, sorted). */
export function listNodeTypes(options = {}) {
  return registryNodeTypes({ locale: options.locale ?? 'en' });
}

export default {
  ENGINE_PACKAGE,
  ENGINE_VERSION,
  NODE_REGISTRY_VERSION,
  createNodeRegistry,
  createWorkflowEngine,
  runWorkflowDefinition,
  validateWorkflowDefinition,
  listNodeTypes,
  WorkflowRunError,
};
