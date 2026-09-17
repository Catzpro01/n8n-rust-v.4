/**
 * Persistence LEGO — Reconstructed 1:1 from n8n v2.9.4
 * Source: reference/n8n/packages/@n8n/db/src/repositories/execution.repository.ts
 */

export interface IExecutionBase {
  id: string;
  workflowId: string;
  mode: string;
  status: 'new' | 'running' | 'success' | 'error' | 'canceled' | 'crashed' | 'waiting';
  startedAt: Date;
  stoppedAt?: Date;
  data: any;
  workflowData: any;
}

export class ExecutionRepository {
  private executions: Map<string, IExecutionBase> = new Map();

  async saveExecution(execution: IExecutionBase): Promise<IExecutionBase> {
    this.executions.set(execution.id, execution);
    return execution;
  }

  async findExecution(id: string): Promise<IExecutionBase | undefined> {
    return this.executions.get(id);
  }

  async updateExecution(id: string, data: Partial<IExecutionBase>): Promise<void> {
    const existing = this.executions.get(id);
    if (existing) {
      this.executions.set(id, { ...existing, ...data });
    }
  }

  async findAllByWorkflowId(workflowId: string): Promise<IExecutionBase[]> {
    return [...this.executions.values()].filter((e) => e.workflowId === workflowId);
  }
}

export class ExecutionDataPruner {
  static pruneExecutionData(data: any, maxSize = 1024 * 1024): any {
    const json = JSON.stringify(data);
    if (json.length <= maxSize) return data;
    return { truncated: true, originalSize: json.length };
  }
}

export function migrateRunExecutionData(data: any): any {
  if (!data) return data;
  if (data.version === 1) return data;
  if (data.version === 0 || !data.version) {
    return {
      version: 1,
      resultData: data.resultData || { runData: {} },
      executionData: data.executionData || {
        contextData: {},
        nodeExecutionStack: [],
        metadata: {},
        waitingExecution: {},
        waitingExecutionSource: null,
      },
    };
  }
  throw new Error(`Unsupported IRunExecutionData version: ${data.version}`);
}
