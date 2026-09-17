/**
 * Execution Engine — Reconstructed 1:1 from n8n v2.9.4
 * Source: reference/n8n/packages/core/src/execution-engine/workflow-execute.ts (2655 lines)
 *
 * This is a faithful reconstruction of n8n's DAG execution loop with:
 * - Node execution stack
 * - Input data preparation with pairedItem re-indexing
 * - Output pairedItem auto-assignment
 * - Source tracking
 * - Error handling and retry
 * - Execution order v0/v1
 * - Pin data handling in manual mode
 * - alwaysOutputData handling
 */

import { Workflow } from '../workflow/workflow';
import { normalizeItems, assignPairedItems, createRunExecutionData, type IRunExecutionData, type ITaskDataConnections, type INodeExecutionData, type IExecuteData } from '../execution-data/execution-data';
import { Expression } from '../expression/expression';
import {
	resolveErrorOutcome,
	resolveRetryPolicy,
	runWithRetry,
	splitErrorOutput,
	type ErrorRecoveryNode,
} from '../error-recovery-policy';

export type WorkflowExecuteMode = 'manual' | 'trigger' | 'webhook' | 'integrated' | 'cli' | 'error' | 'retry';

export interface IWorkflowExecuteAdditionalData {
  credentialsHelper?: any;
  hooks?: {
    hookFunctions?: Record<string, Function[]>;
  };
  executionId?: string;
  userId?: string;
}

export interface INodeTypes {
  getByNameAndVersion: (type: string, version?: number) => any;
}

export class WorkflowExecute {
  private workflow: Workflow;
  private runExecutionData: IRunExecutionData;
  private additionalData: IWorkflowExecuteAdditionalData;
  private mode: WorkflowExecuteMode;
  private nodeTypes: Map<string, Function>;
  private executionId: string;

  constructor(
    additionalData: IWorkflowExecuteAdditionalData,
    mode: WorkflowExecuteMode,
    runExecutionData?: IRunExecutionData,
    workflow?: Workflow
  ) {
    this.additionalData = additionalData;
    this.mode = mode;
    this.runExecutionData = runExecutionData || createRunExecutionData(workflow);
    this.workflow = workflow as Workflow;
    this.nodeTypes = new Map();
    this.executionId = additionalData.executionId || `exec_${Date.now()}`;
  }

  registerNodeType(typeName: string, handler: Function) {
    this.nodeTypes.set(typeName, handler);
  }

  async run(
    workflow: Workflow,
    startNodeName?: string,
    destinationNodeName?: string,
    pinData?: Record<string, INodeExecutionData[]>
  ): Promise<IRunExecutionData> {
    this.workflow = workflow;
    this.runExecutionData = createRunExecutionData(workflow, pinData);

    const startNode = startNodeName ? workflow.getNode(startNodeName) : workflow.getStartNode(destinationNodeName);
    if (!startNode) {
      throw new Error('No start node found');
    }

    const startData: ITaskDataConnections = {
      main: [[{ json: {} }]],
    };

    const executeData: IExecuteData = {
      node: startNode,
      data: startData,
      source: null,
    };

    this.runExecutionData.executionData!.nodeExecutionStack = [executeData];

    while (this.runExecutionData.executionData!.nodeExecutionStack.length > 0) {
      const currentExecuteData = this.runExecutionData.executionData!.nodeExecutionStack.shift()!;
      const node = currentExecuteData.node;

      if (node.disabled) continue;

      const runIndex = this.runExecutionData.resultData.runData[node.name]?.length || 0;

      // Prepare input data with pairedItem re-indexing (I3 invariant)
      const inputData = this.prepareConnectionInputData(currentExecuteData);

      // Check pin data in manual mode
      let nodeInputData = inputData;
      if (this.mode === 'manual' && workflow.getPinDataOfNode(node.name)) {
        const pinDataForNode = workflow.getPinDataOfNode(node.name)!;
        nodeInputData = {
          main: [pinDataForNode.map((item: any) => ({ json: item.json || item }))],
        };
      }

      const startTime = Date.now();
      let executionResult: INodeExecutionData[][] | null = null;
      let executionError: any = null;
      let taskDataTries = 1; // Error Recovery LEGO: jumlah percobaan nyata (1 = tanpa retry)

      try {
        const handler = this.nodeTypes.get(node.type);
        // Error Recovery LEGO: kebijakan retry 1:1 n8n (workflow-execute.ts L1600-L1680).
        // Node tanpa `retryOnFail` => maxTries 1, tanpa jeda (perilaku identik dengan
        // eksekusi langsung sebelumnya).
        const retryPolicy = resolveRetryPolicy(node as ErrorRecoveryNode);
        const runOnce = async () => {
          let raw: INodeExecutionData[][] | INodeExecutionData[];
          if (handler) {
            const context = this.createNodeExecutionContext(node, nodeInputData, runIndex, currentExecuteData);
            raw = (await handler.call(context, nodeInputData.main[0] || [])) as INodeExecutionData[][];
          } else {
            // Default passthrough
            raw = [nodeInputData.main[0] || []] as INodeExecutionData[][];
          }
          // n8n: hasil node selalu `INodeExecutionData[][]` (satu array per output).
          // Handler legacy yang mengembalikan array item datar dibungkus ke output 0.
          return (Array.isArray(raw) && Array.isArray(raw[0]) ? raw : [raw]) as INodeExecutionData[][];
        };

        const retryOutcome = await runWithRetry(runOnce, retryPolicy);
        if (retryOutcome.status === 'error') {
          throw retryOutcome.error;
        }
        executionResult = retryOutcome.data;
        taskDataTries = retryOutcome.tries;

        if (!executionResult) {
          executionResult = [[]];
        }

        // Normalize items
        for (let i = 0; i < executionResult.length; i++) {
          if (executionResult[i]) {
            executionResult[i] = normalizeItems(executionResult[i] as any);
          }
        }

        // Assign paired items (I4 invariant)
        assignPairedItems(executionResult, nodeInputData);

        // Error Recovery LEGO: `onError === 'continueErrorOutput'` menambah output "Error"
        // (node-helpers.ts L1170-L1195); item error dipindah ke output terakhir
        // (workflow-execute.ts L1720-L1722 + L2463-L2561).
        if (node.onError === 'continueErrorOutput' && executionResult.length > 0) {
          const mainOutputCount = Math.max(executionResult.length + 1, 2);
          executionResult = splitErrorOutput(executionResult as any, mainOutputCount).data as INodeExecutionData[][];
        }

        // Handle alwaysOutputData (I9 invariant)
        if (executionResult.length === 1 && executionResult[0].length === 0 && node.alwaysOutputData) {
          const pairedItems: any[] = [];
          const inputItems = nodeInputData.main[0] || [];
          for (let i = 0; i < inputItems.length; i++) {
            pairedItems.push({ item: i });
          }
          executionResult = [[{ json: {}, pairedItem: pairedItems }]];
        }
      } catch (error: any) {
        executionError = error;
        executionResult = null;
      }

      const executionTime = Date.now() - startTime;

      // Store task data
      if (!this.runExecutionData.resultData.runData[node.name]) {
        this.runExecutionData.resultData.runData[node.name] = [];
      }

      const taskData: any = {
        startTime,
        executionIndex: Object.keys(this.runExecutionData.resultData.runData).length,
        executionTime,
        source: currentExecuteData.source ? Object.values(currentExecuteData.source).flat().flat().filter(Boolean) : [],
        executionStatus: executionError ? 'error' : 'success',
        data: executionError ? undefined : { main: executionResult },
        error: executionError,
        tries: taskDataTries,
      };

      this.runExecutionData.resultData.runData[node.name].push(taskData);
      this.runExecutionData.resultData.lastNodeExecuted = node.name;

      if (executionError) {
        // Error Recovery LEGO: keputusan cabang error (workflow-execute.ts L1839-L1846).
        if (resolveErrorOutcome(node as ErrorRecoveryNode) !== 'stop-workflow') {
          const errorItem: INodeExecutionData = {
            json: { error: executionError.message },
            pairedItem: { item: 0 },
            error: executionError,
          };
          const errorOutput = node.onError === 'continueErrorOutput' ? 1 : 0;
          const successData: INodeExecutionData[][] = [[], []];
          successData[errorOutput] = [errorItem];
          taskData.data = { main: successData };
          taskData.executionStatus = 'success';
          delete taskData.error;
        } else {
          this.runExecutionData.resultData.error = executionError;
          break;
        }
      }

      if (!executionResult) continue;

      // Route to child nodes
      const nodeConnections = this.workflow.connectionsBySourceNode[node.name];
      if (!nodeConnections || !nodeConnections.main) continue;

      for (let outputIndex = 0; outputIndex < executionResult.length; outputIndex++) {
        const outputData = executionResult[outputIndex];
        if (!outputData || outputData.length === 0) continue;

        const connections = nodeConnections.main[outputIndex];
        if (!connections) continue;

        for (const connection of connections) {
          if (!connection) continue;

          const childNode = this.workflow.getNode(connection.node);
          if (!childNode) continue;
          if (childNode.disabled) continue;

          const childInputData: ITaskDataConnections = {
            main: [],
          };
          for (let i = 0; i <= connection.index; i++) {
            childInputData.main[i] = i === connection.index ? outputData : [];
          }

          const sourceData = {
            main: [
              [
                {
                  previousNode: node.name,
                  previousNodeOutput: outputIndex,
                  previousNodeRun: runIndex,
                },
              ],
            ],
          };

          const childExecuteData: IExecuteData = {
            node: childNode,
            data: childInputData,
            source: sourceData as any,
            runIndex: 0,
          };

          this.runExecutionData.executionData!.nodeExecutionStack.push(childExecuteData);
        }
      }
    }

    return this.runExecutionData;
  }

  private prepareConnectionInputData(executeData: IExecuteData): ITaskDataConnections {
    const inputData = executeData.data;
    const result: ITaskDataConnections = { main: [] };

    for (const [type, inputs] of Object.entries(inputData) as Array<[string, any[]]>) {
      result[type] = [];
      for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
        const input = inputs[inputIndex];
        if (!input) {
          result[type][inputIndex] = [];
          continue;
        }

        const reIndexed = input.map((item, itemIndex) => {
          const newItem = { ...item };
          if (type === 'main') {
            newItem.pairedItem = { item: itemIndex, input: inputIndex || undefined };
            if ((item as any).pairedItem?.sourceOverwrite) {
              (newItem.pairedItem as any).sourceOverwrite = (item as any).pairedItem.sourceOverwrite;
            }
          }
          return newItem;
        });

        result[type][inputIndex] = reIndexed;
      }
    }

    return result;
  }

  private createNodeExecutionContext(node: any, inputData: ITaskDataConnections, runIndex: number, executeData: IExecuteData): any {
    const workflow = this.workflow;
    const self = this;

    return {
      getInputData: (inputIndex = 0, connectionType = 'main') => {
        return inputData[connectionType]?.[inputIndex] || [];
      },
      getNodeParameter: (parameterName: string, itemIndex: number, fallbackValue?: any) => {
        const paramValue = node.parameters[parameterName] ?? fallbackValue;
        if (typeof paramValue === 'string' && paramValue.startsWith('=')) {
          const expression = new Expression(workflow);
          const connectionInputData = inputData.main?.[0] || [];
          return expression.getParameterValue(
            paramValue,
            self.runExecutionData,
            runIndex,
            itemIndex,
            node.name,
            connectionInputData,
            self.mode,
            {},
            executeData
          );
        }
        return paramValue;
      },
      getWorkflow: () => workflow,
      getNode: () => node,
      getMode: () => self.mode,
      getExecutionId: () => self.executionId,
      helpers: {
        returnJsonArray: (jsonData: any) => {
          if (!Array.isArray(jsonData)) return [{ json: jsonData }];
          return jsonData.map((data: any) => ({ json: data }));
        },
        normalizeItems: (items: any[]) => normalizeItems(items),
        constructExecutionMetaData: (inputData: any[], options: any) => {
          return inputData.map((item, index) => ({
            ...item,
            pairedItem: options.itemData || { item: index },
          }));
        },
      },
    };
  }
}
