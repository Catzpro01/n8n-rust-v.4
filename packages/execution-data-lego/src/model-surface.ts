// Execution Data LEGO — public surface
// 1:1 dari n8n 2.9.4 interfaces.ts + run-execution-data-factory.ts

export const BINARY_ENCODING = 'base64';
export const BINARY_IN_JSON_PROPERTY = '_files';
export const BINARY_MODE_SEPARATE = 'separate';
export const BINARY_MODE_COMBINED = 'combined';

export type GenericValue = string | object | number | boolean | undefined | null;
export interface IDataObject { [key: string]: GenericValue | IDataObject | GenericValue[] | IDataObject[]; }

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

export interface IBinaryKeyData { [key: string]: IBinaryData; }

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
  metadata?: { subExecution: any };
  evaluationData?: Record<string, GenericValue>;
  index?: number;
}

export type NodeOutput = INodeExecutionData[][];

export interface ITaskDataConnections { [connectionType: string]: Array<INodeExecutionData[] | null>; }

export interface ITaskData {
  startTime: number;
  executionIndex: number;
  executionTime: number;
  source: Array<ISourceData | null>;
  executionStatus?: string;
  data?: ITaskDataConnections;
  inputOverride?: ITaskDataConnections;
  error?: any;
  metadata?: any;
}

export interface IRunData { [nodeName: string]: ITaskData[]; }

export interface IExecuteData {
  node: any;
  data: ITaskDataConnections;
  source: any | null;
  metadata?: any;
  runIndex?: number;
}

export interface IRunExecutionData {
  version: 1;
  startData?: any;
  resultData: {
    error?: any;
    runData: IRunData;
    pinData?: any;
    lastNodeExecuted?: string;
    metadata?: Record<string, string>;
  };
  executionData?: {
    contextData: any;
    nodeExecutionStack: IExecuteData[];
    metadata: Record<string, any[]>;
    waitingExecution: any;
    waitingExecutionSource: any | null;
  };
}

// Factories — only sanctioned way to build branded type
export function createRunExecutionData(data?: Partial<IRunExecutionData>): IRunExecutionData {
  return {
    version: 1,
    resultData: { runData: {}, ...data?.resultData },
    ...data,
  } as IRunExecutionData;
}

export function createEmptyRunExecutionData(): IRunExecutionData {
  return {
    version: 1,
    resultData: { runData: {} },
    executionData: {
      contextData: {},
      nodeExecutionStack: [],
      metadata: {},
      waitingExecution: {},
      waitingExecutionSource: null,
    },
  };
}

export function createErrorExecutionData(error: any): IRunExecutionData {
  return {
    version: 1,
    resultData: { runData: {}, error },
  };
}

// Pure helpers
export function normalizeItems(items: any[]): INodeExecutionData[] {
  return items.map((item, index) => {
    if (item && typeof item === 'object' && 'json' in item) return item as INodeExecutionData;
    if (item && typeof item === 'object') return { json: item as IDataObject };
    return { json: { value: item } };
  });
}

export function returnJsonArray(jsonArray: IDataObject[]): INodeExecutionData[] {
  return jsonArray.map((json) => ({ json }));
}

export function constructExecutionMetaData(inputData: INodeExecutionData[], options: { itemData: IPairedItemData | IPairedItemData[] }): INodeExecutionData[] {
  return inputData.map((item) => ({
    ...item,
    pairedItem: options.itemData,
  }));
}

export function copyInputItems(items: INodeExecutionData[], properties: string[]): INodeExecutionData[] {
  return items.map((item) => {
    const newItem: INodeExecutionData = { json: {} };
    for (const prop of properties) {
      if (prop === 'json') newItem.json = { ...item.json };
      else if (prop === 'binary' && item.binary) newItem.binary = { ...item.binary };
    }
    return newItem;
  });
}

export const LEGO_PROVENANCE = {
  lego: 'execution-data',
  phase: 'phase-3-verified',
  referenceVersion: '2.9.4',
  rustImplementation: 'not-started',
} as const;
