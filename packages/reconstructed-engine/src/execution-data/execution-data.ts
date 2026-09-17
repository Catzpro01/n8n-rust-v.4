/**
 * Execution Data LEGO — Reconstructed 1:1 from n8n v2.9.4
 * Source: reference/n8n/packages/workflow/src/interfaces.ts, run-execution-data/*
 */

export interface IDataObject {
  [key: string]: any;
}

export interface IBinaryData {
  data: string;
  mimeType: string;
  fileType?: 'text' | 'json' | 'image' | 'audio' | 'video' | 'pdf' | 'html';
  fileName?: string;
  directory?: string;
  fileExtension?: string;
  fileSize?: string;
  bytes?: number;
  id?: string;
}

export interface IBinaryKeyData {
  [key: string]: IBinaryData;
}

export interface ISourceData {
  previousNode: string;
  previousNodeOutput?: number;
  previousNodeRun?: number;
}

export interface IPairedItemData {
  item: number;
  input?: number;
  sourceOverwrite?: ISourceData;
}

export interface INodeExecutionData {
  json: IDataObject;
  binary?: IBinaryKeyData;
  error?: any;
  pairedItem?: IPairedItemData | IPairedItemData[] | number;
  metadata?: any;
  evaluationData?: Record<string, any>;
  index?: number;
}

export interface ITaskDataConnections {
  [type: string]: Array<INodeExecutionData[] | null>;
}

export interface ITaskStartedData {
  startTime: number;
  executionIndex: number;
  source: Array<ISourceData | null>;
  hints?: any[];
}

export interface ITaskData extends ITaskStartedData {
  executionTime: number;
  executionStatus?: 'success' | 'error' | 'canceled' | 'running' | 'waiting';
  data?: ITaskDataConnections;
  inputOverride?: ITaskDataConnections;
  error?: any;
  metadata?: any;
}

export interface IRunData {
  [nodeName: string]: ITaskData[];
}

export interface IExecuteData {
  node: any;
  data: ITaskDataConnections;
  source: ITaskDataConnectionsSource | null;
  metadata?: any;
  runIndex?: number;
}

export interface ITaskDataConnectionsSource {
  [type: string]: Array<Array<ISourceData | null> | null> | null;
}

export interface IRunExecutionData {
  version: 1;
  startData?: {
    startNodes?: any[];
    destinationNode?: any;
    runNodeFilter?: string[];
  };
  resultData: {
    error?: any;
    runData: IRunData;
    pinData?: Record<string, INodeExecutionData[]>;
    lastNodeExecuted?: string;
    metadata?: Record<string, string>;
  };
  executionData?: {
    contextData: any;
    nodeExecutionStack: IExecuteData[];
    metadata: Record<string, any[]>;
    waitingExecution: any;
    waitingExecutionSource: any;
  };
}

export const BINARY_ENCODING = 'base64';
export const BINARY_IN_JSON_PROPERTY = '_files';
export const BINARY_MODE_SEPARATE = 'separate';
export const BINARY_MODE_COMBINED = 'combined';

export function createRunExecutionData(
  workflow: any,
  pinData?: Record<string, INodeExecutionData[]>
): IRunExecutionData {
  return {
    version: 1,
    resultData: {
      runData: {},
      pinData,
    },
    executionData: {
      contextData: {},
      nodeExecutionStack: [],
      metadata: {},
      waitingExecution: {},
      waitingExecutionSource: null,
    },
  };
}

export function createEmptyRunExecutionData(): IRunExecutionData {
  return {
    version: 1,
    resultData: {
      runData: {},
    },
    executionData: {
      contextData: {},
      nodeExecutionStack: [],
      metadata: {},
      waitingExecution: {},
      waitingExecutionSource: null,
    },
  };
}

export function normalizeItems(items: any[]): INodeExecutionData[] {
  if (!items) return [];
  return items.map((item) => {
    if (item && typeof item === 'object' && 'json' in item) {
      return item as INodeExecutionData;
    }
    return { json: item as IDataObject };
  });
}

export function returnJsonArray(jsonData: any | any[]): INodeExecutionData[] {
  if (!Array.isArray(jsonData)) {
    return [{ json: jsonData as IDataObject }];
  }
  return jsonData.map((data) => {
    if (data && typeof data === 'object' && 'json' in data) {
      return data as INodeExecutionData;
    }
    return { json: data as IDataObject };
  });
}

export function assignPairedItems(
  outputData: INodeExecutionData[][],
  inputData: ITaskDataConnections
): void {
  const mainInput = inputData.main?.[0] || [];
  if (mainInput.length === 0) return;

  for (let outputIndex = 0; outputIndex < outputData.length; outputIndex++) {
    const outputItems = outputData[outputIndex];
    if (!outputItems) continue;

    for (let itemIndex = 0; itemIndex < outputItems.length; itemIndex++) {
      const item = outputItems[itemIndex];
      if (item.pairedItem !== undefined) continue;

      if (mainInput.length === 1) {
        item.pairedItem = { item: 0 };
      } else if (outputData.length === 1 && outputItems.length === mainInput.length) {
        item.pairedItem = { item: itemIndex };
      } else if (outputData.length === 1 && outputItems.length === 1 && mainInput.length > 1) {
        item.pairedItem = { item: 0 };
      }
    }
  }
}
