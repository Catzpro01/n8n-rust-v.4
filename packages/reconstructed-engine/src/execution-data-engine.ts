// Execution Data Engine — 1:1 dari n8n 2.9.4 execution-data + workflow-execute
// Owner: Agent 3 — execution-data LEGO
// Zero Rust, pure JS/TS

export const BINARY_ENCODING = 'base64';

export interface INodeExecutionData {
  json: Record<string, any>;
  binary?: Record<string, any>;
  pairedItem?: any;
  error?: any;
}

export interface ITaskDataConnections {
  [type: string]: Array<INodeExecutionData[] | null>;
}

export interface ISourceData {
  previousNode: string;
  previousNodeOutput?: number;
  previousNodeRun?: number;
}

export function normalizeItems(items: any[]): INodeExecutionData[] {
  return items.map((item) => {
    if (item && typeof item === 'object' && 'json' in item) return item as INodeExecutionData;
    if (item && typeof item === 'object') return { json: item };
    return { json: { value: item } };
  });
}

export function returnJsonArray(jsonArray: Record<string, any>[]): INodeExecutionData[] {
  return jsonArray.map((json) => ({ json }));
}

export function assignPairedItems(
  inputData: INodeExecutionData[],
  outputData: INodeExecutionData[][],
): INodeExecutionData[][] {
  // I4: Output pairedItem auto-assignment — 1:1 dari workflow-execute.ts L2581
  return outputData.map((outputBranch) => {
    if (!outputBranch) return outputBranch;
    return outputBranch.map((item, itemIndex) => {
      if (item.pairedItem !== undefined) return item; // I5 explicit never overwritten
      if (inputData.length === 1) return { ...item, pairedItem: { item: 0 } };
      if (outputData.length === 1 && outputBranch.length === inputData.length) {
        return { ...item, pairedItem: { item: itemIndex } };
      }
      if (outputData.length === 1 && outputBranch.length === 1 && inputData.length > 1) {
        return { ...item, pairedItem: { item: 0 } };
      }
      return item; // otherwise undefined
    });
  });
}

export function prepareInputPairedItems(inputData: INodeExecutionData[], inputIndex: number): INodeExecutionData[] {
  // I3: Before node executes, each input item's pairedItem replaced
  return inputData.map((item, idx) => ({
    ...item,
    pairedItem: { item: idx, input: inputIndex || undefined },
  }));
}

export function createRunExecutionData() {
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

export function isEmptyOutput(data: ITaskDataConnections | undefined): boolean {
  if (!data) return true;
  const main = data.main;
  if (!main) return true;
  return main.length === 0 || (main.length === 1 && main[0] && main[0].length === 0);
}

export function applyAlwaysOutputData(
  data: ITaskDataConnections,
  inputData: INodeExecutionData[],
  alwaysOutputData: boolean,
): ITaskDataConnections {
  if (!alwaysOutputData) return data;
  if (!isEmptyOutput(data)) return data;
  // I9: alwaysOutputData true converts empty to one item with pairedItem for every input
  const pairedItems = inputData.map((_, idx) => ({ item: idx, input: 0 }));
  return {
    main: [[{ json: {}, pairedItem: pairedItems }]],
  };
}
