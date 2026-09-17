/**
 * @lego/execution-data — Execution Data LEGO (Phase 2 structural isolation)
 *
 * OWNERSHIP:
 *   owns         : run-execution-data/**, run-execution-data-factory.ts,
 *                  execution-context.ts, execution-status.ts
 *                  plus interfaces for execution data (from shared kernel)
 *   does NOT own : workflow-execute.ts (engine), binary-data service, persistence
 *
 * This LEGO implements:
 * - Passive data model for execution: INodeExecutionData, ITaskData, IRunData, IRunExecutionData
 * - Paired item tracking, source tracking
 * - Binary payload representation
 * - Run execution data versioning and factories
 * - Pure helpers: normalizeItems, returnJsonArray, constructExecutionMetaData, copyInputItems
 *
 * Reference: n8n 2.9.4, n8n-workflow@2.9.1 + n8n-core@2.9.1
 */

export * from './run-execution-data-factory';
export * from './run-execution-data/run-execution-data';
export * from './execution-context';
export * from './execution-status';

// Constants from reference
export const BINARY_ENCODING = 'base64' as const;
export const BINARY_IN_JSON_PROPERTY = '_files' as const;
export const BINARY_MODE_SEPARATE = 'separate' as const;
export const BINARY_MODE_COMBINED = 'combined' as const;

// Pure helpers (copied from n8n-core execution-engine/node-execution-context/utils/)
export function normalizeItems(items: any[]): any[] {
  if (!items) return [];
  return items.map((item) => {
    if (item && typeof item === 'object' && 'json' in item) {
      return item;
    }
    return { json: item };
  });
}

export function returnJsonArray(jsonData: any | any[]): any[] {
  if (!Array.isArray(jsonData)) {
    return [{ json: jsonData }];
  }
  return jsonData.map((data) => {
    if (data && typeof data === 'object' && 'json' in data) {
      return data;
    }
    return { json: data };
  });
}

export function constructExecutionMetaData(inputData: any[], options: { itemData?: any } = {}): any[] {
  return inputData.map((item, index) => {
    const pairedItem = options.itemData ? options.itemData : { item: index };
    return {
      ...item,
      pairedItem,
    };
  });
}

export function copyInputItems(items: any[], properties: string[]): any[] {
  return items.map((item) => {
    const newItem: any = { json: { ...item.json } };
    for (const prop of properties) {
      if (prop in item) {
        (newItem as any)[prop] = (item as any)[prop];
      }
    }
    return newItem;
  });
}

export const LEGO_PROVENANCE = {
  lego: 'execution-data',
  phase: 'phase-2-isolation',
  referenceVersion: '2.9.4',
  referenceCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
  behaviorChange: 'none-detected',
  rustImplementation: 'not-started',
} as const;
