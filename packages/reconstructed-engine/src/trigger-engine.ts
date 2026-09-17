// Trigger Engine — 1:1 dari ActiveWorkflows + TriggersAndPollers (n8n 2.9.4)
// Owner: Agent 4 + Agent 3 support

export interface TriggerResponse {
  closeFunction?: () => Promise<void>;
  manualTriggerFunction?: () => Promise<void>;
}

export class TriggerEngine {
  private activeWorkflows = new Map();
  private triggerResponses = new Map();

  async addWorkflow(workflowId: any, workflow: any, mode = 'activate') {
    if (this.activeWorkflows.has(workflowId)) {
      throw new Error('Workflow is already active');
    }
    const triggerNodes = workflow.nodes?.filter((n: any) => n.type.includes('Trigger') || n.type.includes('trigger')) || [];
    if (triggerNodes.length === 0) {
      throw new Error('Workflow cannot be activated because it has no trigger node. At least one trigger, webhook, or polling node is required.');
    }
    this.activeWorkflows.set(workflowId, { workflow, mode, triggers: triggerNodes });
    return { triggerCount: triggerNodes.length };
  }

  async removeWorkflow(workflowId: any) {
    const responses = this.triggerResponses.get(workflowId) || [];
    for (const resp of responses) {
      try { await resp.closeFunction?.(); } catch (e) { console.warn('Failed to close trigger', e); }
    }
    this.triggerResponses.delete(workflowId);
    return this.activeWorkflows.delete(workflowId);
  }

  isActive(workflowId: any) { return this.activeWorkflows.has(workflowId); }
  allActive() { return [...this.activeWorkflows.keys()]; }
}
