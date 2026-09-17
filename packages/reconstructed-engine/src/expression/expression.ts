/**
 * Expression LEGO — Reconstructed 1:1 from n8n v2.9.4
 * Source: reference/n8n/packages/workflow/src/expression.ts, workflow-data-proxy.ts
 *
 * This implements the expression evaluator {{ ... }} with full data-proxy semantics.
 */

export interface IDataObject {
  [key: string]: any;
}

export interface INodeExecutionData {
  json: IDataObject;
  binary?: Record<string, any>;
  pairedItem?: { item: number; input?: number } | { item: number; input?: number }[] | number;
  error?: any;
  metadata?: any;
}

export interface IWorkflowDataProxyAdditionalKeys {
  $execution?: { id: string; mode: string; resumeUrl?: string; customData?: any };
  $vars?: IDataObject;
  $secrets?: IDataObject;
  $executionId?: string;
  $resumeWebhookUrl?: string;
  [key: string]: any;
}

export function isExpression(value: unknown): boolean {
  return typeof value === 'string' && value.charAt(0) === '=';
}

export class ExpressionError extends Error {
  context: any;
  constructor(message: string, context: any = {}) {
    super(message);
    this.name = 'ExpressionError';
    this.context = context;
  }
}

function isSimpleExpression(template: string): boolean {
  const trimmed = template.trim();
  if (!trimmed.startsWith('{{') || !trimmed.endsWith('}}')) return false;
  const inner = trimmed.slice(2, -2);
  return !inner.includes('{{') && !inner.includes('}}');
}

function extractExpressionContent(template: string): string {
  const match = template.match(/^{{\s*([\s\S]*?)\s*}}$/);
  return match ? match[1] : template;
}

export class WorkflowDataProxy {
  private workflow: any;
  private runExecutionData: any;
  private runIndex: number;
  private itemIndex: number;
  private activeNodeName: string;
  private connectionInputData: INodeExecutionData[];
  private siblingParameters: IDataObject;
  private mode: string;
  private additionalKeys: IWorkflowDataProxyAdditionalKeys;
  private executeData: any;
  private selfData: IDataObject;
  private contextNodeName: string;

  constructor(
    workflow: any,
    runExecutionData: any,
    runIndex: number,
    itemIndex: number,
    activeNodeName: string,
    connectionInputData: INodeExecutionData[],
    siblingParameters: IDataObject,
    mode: string,
    additionalKeys: IWorkflowDataProxyAdditionalKeys,
    executeData?: any,
    selfData: IDataObject = {},
    contextNodeName: string = activeNodeName
  ) {
    this.workflow = workflow;
    this.runExecutionData = runExecutionData;
    this.runIndex = runIndex;
    this.itemIndex = itemIndex;
    this.activeNodeName = activeNodeName;
    this.connectionInputData = connectionInputData;
    this.siblingParameters = siblingParameters;
    this.mode = mode;
    this.additionalKeys = additionalKeys;
    this.executeData = executeData;
    this.selfData = selfData;
    this.contextNodeName = contextNodeName;
  }

  getDataProxy(): any {
    const self = this;

    const proxy: any = {
      $json: this.connectionInputData[this.itemIndex]?.json ?? {},
      $binary: (() => {
        const binary = this.connectionInputData[this.itemIndex]?.binary;
        if (!binary) return {};
        const result: any = {};
        for (const [key, value] of Object.entries(binary)) {
          const { data, ...rest } = value as any;
          result[key] = rest;
        }
        return result;
      })(),
      $input: {
        item: this.connectionInputData[this.itemIndex],
        first: () => {
          if (arguments.length > 0) throw new Error('$input.first() takes no arguments');
          return self.connectionInputData[0];
        },
        last: () => {
          if (arguments.length > 0) throw new Error('$input.last() takes no arguments');
          return self.connectionInputData[self.connectionInputData.length - 1];
        },
        all: () => {
          if (arguments.length > 0) throw new Error('$input.all() takes no arguments');
          return self.connectionInputData;
        },
      },
      $items: (nodeName?: string, outputIndex?: number, runIndex?: number) => {
        const targetNode = nodeName || self.contextNodeName;
        const runData = self.runExecutionData?.resultData?.runData?.[targetNode];
        if (!runData) throw new ExpressionError(`No execution data for node ${targetNode}`, { type: 'no_execution_data' });
        const run = runIndex ?? runData.length - 1;
        const taskData = runData[run];
        if (!taskData) throw new ExpressionError(`Run ${run} of node "${targetNode}" not found`);
        const branch = outputIndex ?? 0;
        const data = taskData.data?.main?.[branch];
        if (!data) throw new ExpressionError(`Node "${targetNode}" has no branch with index ${branch}.`);
        return data;
      },
      $node: new Proxy(
        {},
        {
          get: (_, prop: string) => {
            const runData = self.runExecutionData?.resultData?.runData?.[prop];
            if (!runData) throw new ExpressionError(`Node ${prop} not found`, { descriptionKey: 'nodeNotFound' });
            const lastRun = runData[runData.length - 1];
            const data = lastRun?.data?.main?.[0]?.[self.itemIndex];
            return {
              json: data?.json ?? {},
              binary: data?.binary ?? {},
              data: lastRun?.data,
            };
          },
        }
      ),
      $: (nodeName: string) => {
        const runData = self.runExecutionData?.resultData?.runData?.[nodeName];
        if (!runData) {
          if (self.mode === 'manual' && self.workflow?.pinData?.[nodeName]) {
            const pinData = self.workflow.pinData[nodeName];
            return {
              first: () => pinData[0],
              last: () => pinData[pinData.length - 1],
              all: () => pinData,
              item: pinData[self.itemIndex],
              isExecuted: true,
              params: self.workflow.nodes[nodeName]?.parameters ?? {},
            };
          }
          throw new ExpressionError(`Node ${nodeName} not found`, { descriptionKey: 'nodeNotFound' });
        }
        const lastRun = runData[runData.length - 1];
        return {
          first: (branchIndex?: number, runIdx?: number) => {
            const run = runIdx ?? runData.length - 1;
            const branch = branchIndex ?? 0;
            const taskData = runData[run];
            return taskData?.data?.main?.[branch]?.[0];
          },
          last: (branchIndex?: number, runIdx?: number) => {
            const run = runIdx ?? runData.length - 1;
            const branch = branchIndex ?? 0;
            const taskData = runData[run];
            const items = taskData?.data?.main?.[branch];
            return items?.[items.length - 1];
          },
          all: (branchIndex?: number, runIdx?: number) => {
            const run = runIdx ?? runData.length - 1;
            const branch = branchIndex ?? 0;
            const taskData = runData[run];
            return taskData?.data?.main?.[branch] ?? [];
          },
          item: self.connectionInputData[self.itemIndex],
          isExecuted: true,
          params: self.workflow?.nodes?.[nodeName]?.parameters ?? {},
          isExecutedProxy: true,
        };
      },
      $workflow: {
        id: self.workflow?.id,
        name: self.workflow?.name,
        active: self.workflow?.active,
      },
      $runIndex: self.runIndex,
      $itemIndex: self.itemIndex,
      $mode: self.mode,
      $now: new Date(),
      $today: new Date(new Date().setHours(0, 0, 0, 0)),
      $execution: self.additionalKeys.$execution,
      $vars: self.additionalKeys.$vars,
      $secrets: self.additionalKeys.$secrets,
      $env: new Proxy(
        {},
        {
          get: (_, prop: string) => {
            if (process.env.N8N_BLOCK_ENV_ACCESS_IN_NODE === 'false') {
              return process.env[prop];
            }
            throw new ExpressionError('access to env vars denied', { type: 'env_access_denied' });
          },
        }
      ),
      $jmespath: (obj: any, path: string) => {
        return obj;
      },
      $fromAI: (key: string) => {
        return self.additionalKeys.$tool?.[key] ?? '';
      },
    };

    return proxy;
  }
}

export class Expression {
  private workflow: any;

  constructor(workflow: any) {
    this.workflow = workflow;
  }

  static resolveWithoutWorkflow(expression: string, data: IDataObject = {}): any {
    if (!isExpression(expression)) return expression;
    const content = expression.slice(1).trim();
    if (content.startsWith('{{') && content.endsWith('}}')) {
      const inner = content.slice(2, -2).trim();
      try {
        const func = new Function(...Object.keys(data), `return (${inner})`);
        return func(...Object.values(data));
      } catch {
        return expression;
      }
    }
    return content;
  }

  getParameterValue(
    parameterValue: any,
    runExecutionData: any,
    runIndex: number,
    itemIndex: number,
    activeNodeName: string,
    connectionInputData: INodeExecutionData[],
    mode: string,
    additionalKeys: IWorkflowDataProxyAdditionalKeys,
    executeData?: any,
    returnObjectAsString = false,
    selfData: IDataObject = {},
    contextNodeName: string = activeNodeName
  ): any {
    if (parameterValue === null || parameterValue === undefined) return parameterValue;

    if (typeof parameterValue === 'string') {
      if (!isExpression(parameterValue)) return parameterValue;
      if (parameterValue === '=') return '';

      const hasMultipleExpressions = (parameterValue.match(/{{/g) || []).length > 1;
      const isSingleFullExpression = /^\s*=\s*{{\s*[\s\S]+\s*}}\s*$/.test(parameterValue);

      if (isSingleFullExpression && !hasMultipleExpressions) {
        const content = extractExpressionContent(parameterValue.slice(1).trim());
        if (content === '') return '';
        return this.evaluateExpression(
          content,
          runExecutionData,
          runIndex,
          itemIndex,
          activeNodeName,
          connectionInputData,
          mode,
          additionalKeys,
          executeData,
          returnObjectAsString,
          selfData,
          contextNodeName
        );
      } else {
        return parameterValue.replace(/{{\s*([\s\S]*?)\s*}}/g, (match, expr) => {
          try {
            const result = this.evaluateExpression(
              expr,
              runExecutionData,
              runIndex,
              itemIndex,
              activeNodeName,
              connectionInputData,
              mode,
              additionalKeys,
              executeData,
              true,
              selfData,
              contextNodeName
            );
            if (result === null || result === undefined) return '';
            if (typeof result === 'object') return JSON.stringify(result);
            return String(result);
          } catch {
            return '';
          }
        });
      }
    }

    if (Array.isArray(parameterValue)) {
      return parameterValue.map((item) =>
        this.getParameterValue(
          item,
          runExecutionData,
          runIndex,
          itemIndex,
          activeNodeName,
          connectionInputData,
          mode,
          additionalKeys,
          executeData,
          returnObjectAsString,
          selfData,
          contextNodeName
        )
      );
    }

    if (typeof parameterValue === 'object') {
      const newObj: any = {};
      for (const [key, value] of Object.entries(parameterValue)) {
        newObj[key] = this.getParameterValue(
          value,
          runExecutionData,
          runIndex,
          itemIndex,
          activeNodeName,
          connectionInputData,
          mode,
          additionalKeys,
          executeData,
          returnObjectAsString,
          selfData,
          contextNodeName
        );
      }
      return newObj;
    }

    return parameterValue;
  }

  private evaluateExpression(
    expression: string,
    runExecutionData: any,
    runIndex: number,
    itemIndex: number,
    activeNodeName: string,
    connectionInputData: INodeExecutionData[],
    mode: string,
    additionalKeys: IWorkflowDataProxyAdditionalKeys,
    executeData?: any,
    returnObjectAsString = false,
    selfData: IDataObject = {},
    contextNodeName: string = activeNodeName
  ): any {
    if (/\.\s*constructor/.test(expression)) {
      throw new ExpressionError('Expression contains disallowed constructor access');
    }

    const dataProxy = new WorkflowDataProxy(
      this.workflow,
      runExecutionData,
      runIndex,
      itemIndex,
      activeNodeName,
      connectionInputData,
      {},
      mode,
      additionalKeys,
      executeData,
      selfData,
      contextNodeName
    ).getDataProxy();

    try {
      const func = new Function(...Object.keys(dataProxy), `return (${expression})`);
      const result = func(...Object.values(dataProxy));

      if (returnObjectAsString && typeof result === 'object' && result !== null) {
        return `[Object: ${JSON.stringify(result)}]`;
      }

      return result;
    } catch (error: any) {
      if (error instanceof ExpressionError) throw error;
      if (error.name === 'SyntaxError') {
        throw new Error('invalid syntax');
      }
      return undefined;
    }
  }
}
