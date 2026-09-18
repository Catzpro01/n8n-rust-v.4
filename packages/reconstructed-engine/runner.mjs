/**
 * Reconstructed n8n Workflow Execution Engine (Node.js/ESM)
 * Mengadaptasi logika eksekusi DAG, state data flow, dan node handler 1:1 n8n v2.9.4.
 *
 * Locale enforcement happens at this backend boundary.  The engine keeps
 * machine-facing execution fields canonical and adds localized human-facing
 * status text to the response.
 */

import {
  UniversalLocaleEnforcer,
  normalizeSupportedLocale,
} from './localization.mjs';
import {
  registerBuiltInNodeCatalog,
  localizeNodeMetadata,
  nodeAliasOf,
  getNodeCatalogEntry,
} from './node-catalog.mjs';

export { registerBuiltInNodeCatalog, localizeNodeMetadata, nodeAliasOf, getNodeCatalogEntry };

export class WorkflowExecutionEngine {
  constructor(workflowDefinition = {}, options = {}) {
    const definition = workflowDefinition ?? {};
    const requestedLocale =
      options.activeLocale ??
      options.locale ??
      definition.activeLocale ??
      process.env.N8N_LOCALE ??
      'id';

    this.localeEnforcer = new UniversalLocaleEnforcer({
      locale: normalizeSupportedLocale(requestedLocale),
    });
    // The built-in node catalog is a default: user-supplied translations are
    // registered afterwards so they win on key conflicts.
    registerBuiltInNodeCatalog(this.localeEnforcer);
    for (const [locale, catalog] of Object.entries(options.translations ?? {})) {
      if (catalog && typeof catalog === 'object') this.localeEnforcer.registerTranslations(locale, catalog);
    }
    this.activeLocale = this.localeEnforcer.getLocale();
    this.nodes = new Map();
    this.connections = definition.connections || {};
    this.nodeTypes = new Map();

    // Inisialisasi node registry.  Node objects are retained as execution
    // definitions; the locale layer only copies response data and never edits
    // these machine values.
    for (const node of definition.nodes || []) {
      if (node && typeof node.name === 'string') this.nodes.set(node.name, node);
    }
  }

  registerNodeType(typeName, handler) {
    this.nodeTypes.set(typeName, handler);
  }

  setLocale(locale) {
    this.activeLocale = this.localeEnforcer.setLocale(locale);
    return this.activeLocale;
  }

  getLocale() {
    return this.activeLocale;
  }

  /** API response interceptor for workflow, chat and execution payloads. */
  interceptApiResponse(payload, locale = this.activeLocale) {
    return this.localeEnforcer.enforceExecutionResponse(payload, locale);
  }

  /** Register built-in/community human-facing catalog entries at load time. */
  registerNodeTranslations(locale, translations) {
    this.localeEnforcer.registerTranslations(locale, translations);
  }

  /** Pure node-metadata localizer backed by the registered catalog. */
  localizeNodeMetadata(node, locale = this.activeLocale) {
    return localizeNodeMetadata(node, locale, this.localeEnforcer);
  }

  async runWorkflow(startNodeName = null, initialData = [{}], options = {}) {
    if (options?.locale !== undefined || options?.activeLocale !== undefined) {
      this.setLocale(options.activeLocale ?? options.locale);
    }
    const locale = this.activeLocale;
    const executionData = new Map(); // nodeName -> Array of items [{ json: { ... } }]
    const visited = new Set();
    const executionLog = [];

    // Cari entry trigger node jika tidak ditentukan eksplisit
    let currentNodeName = startNodeName;
    if (!currentNodeName) {
      for (const [name, node] of this.nodes.entries()) {
        if (
          typeof node.type === 'string' &&
          (node.type.includes('trigger') || node.type.includes('Manual') || node.type.includes('Start'))
        ) {
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
      throw new Error('No nodes found in workflow definition');
    }

    // Queue antrean eksekusi berbasis DAG BFS
    const queue = [{
      nodeName: currentNodeName,
      inputData: (Array.isArray(initialData) ? initialData : [initialData]).map((data) => ({ json: data })),
    }];

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

      const logEntry = {
        node: nodeName,
        type: node.type,
        inputCount: inputData.length,
        outputCount: outputData.length,
        durationMs,
        status: 'success',
      };
      // Additive human-facing surface: the node type's native label when the
      // type is a known built-in core node. User-chosen node names stay as-is.
      const alias = nodeAliasOf(node.type);
      if (alias && getNodeCatalogEntry(alias, locale)) {
        logEntry.nodeLabel = this.localeEnforcer.translate(`node.${alias}.label`, locale);
      }
      executionLog.push(logEntry);

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

    const response = {
      status: 'COMPLETED',
      finished: true,
      executionLog,
      data: Object.fromEntries(executionData.entries()),
    };

    // The interceptor is deliberately last: all workflow data has already
    // been produced, and the sanitizer can preserve machine fields while
    // translating only human-facing response fields.
    return this.localeEnforcer.enforceExecutionResponse(response, locale);
  }
}

/** Standalone interceptor for API handlers that do not own an engine instance. */
export function interceptApiResponse(payload, locale = 'id') {
  return new UniversalLocaleEnforcer({ locale }).enforceExecutionResponse(payload);
}
