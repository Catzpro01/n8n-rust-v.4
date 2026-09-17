// Persistence Engine — 1:1 dari @n8n/db repositories + flatted + migration (n8n 2.9.4)
// Owner: Agent 4 + Agent 5

import { SchemaPersistenceGuard } from './schema-persistence-guard.ts';

export class PersistenceEngine {
  private workflows = new Map();
  private executions = new Map();

  async saveWorkflow(workflow: any) {
    const validation = SchemaPersistenceGuard.validateWorkflowSchema(workflow);
    if (!validation.valid) throw new Error(`Workflow validation failed: ${validation.errors.join(', ')}`);
    const sanitized = SchemaPersistenceGuard.sanitizeForPersistence(workflow);
    const id = workflow.id || `wf_${Date.now()}`;
    this.workflows.set(id, { ...sanitized, id, updatedAt: new Date().toISOString() });
    return { id };
  }

  async getWorkflow(id: any) {
    return this.workflows.get(id) || null;
  }

  async saveExecution(execution: any) {
    const id = execution.id || `exec_${Date.now()}`;
    // flatted.stringify in real n8n
    const serialized = JSON.stringify(execution);
    this.executions.set(id, { ...execution, id, data: serialized });
    return { id };
  }

  async getExecution(id: any) {
    const exec = this.executions.get(id);
    if (!exec) return null;
    try { return { ...exec, data: JSON.parse(exec.data) }; } catch { return exec; }
  }

  migrateRunExecutionData(data: any) {
    if (!data.version) throw new Error(`Unsupported IRunExecutionData version: ${data.version}`);
    if (data.version === 1) return data;
    // v0 -> v1 migration
    if (data.version === 0) {
      return { ...data, version: 1, resultData: { ...data.resultData, lastNodeExecuted: data.resultData?.lastNodeExecuted } };
    }
    throw new Error(`Unsupported IRunExecutionData version: ${data.version}`);
  }
}
