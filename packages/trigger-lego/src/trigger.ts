/**
 * Trigger LEGO — Reconstructed 1:1 from n8n v2.9.4
 * Source: reference/n8n/packages/core/src/execution-engine/triggers-and-pollers.ts
 */

export interface ITriggerResponse {
  closeFunction?: () => Promise<void>;
  manualTriggerFunction?: () => Promise<void>;
}

export interface IPollResponse {
  closeFunction?: () => Promise<void>;
}

export class TriggerManager {
  private triggers: Map<string, ITriggerResponse> = new Map();
  private pollers: Map<string, IPollResponse> = new Map();

  async addTrigger(workflowId: string, nodeName: string, triggerFn: () => Promise<ITriggerResponse>): Promise<void> {
    const response = await triggerFn();
    this.triggers.set(`${workflowId}:${nodeName}`, response);
  }

  async removeTrigger(workflowId: string, nodeName: string): Promise<void> {
    const key = `${workflowId}:${nodeName}`;
    const trigger = this.triggers.get(key);
    if (trigger?.closeFunction) {
      await trigger.closeFunction();
    }
    this.triggers.delete(key);
  }

  async addPoller(workflowId: string, nodeName: string, pollFn: () => Promise<IPollResponse>): Promise<void> {
    const response = await pollFn();
    this.pollers.set(`${workflowId}:${nodeName}`, response);
  }

  async removePoller(workflowId: string, nodeName: string): Promise<void> {
    const key = `${workflowId}:${nodeName}`;
    const poller = this.pollers.get(key);
    if (poller?.closeFunction) {
      await poller.closeFunction();
    }
    this.pollers.delete(key);
  }

  async removeAllForWorkflow(workflowId: string): Promise<void> {
    for (const key of [...this.triggers.keys()].filter((k) => k.startsWith(workflowId))) {
      const trigger = this.triggers.get(key);
      if (trigger?.closeFunction) await trigger.closeFunction();
      this.triggers.delete(key);
    }
    for (const key of [...this.pollers.keys()].filter((k) => k.startsWith(workflowId))) {
      const poller = this.pollers.get(key);
      if (poller?.closeFunction) await poller.closeFunction();
      this.pollers.delete(key);
    }
  }
}

export function isTriggerNode(nodeType: string): boolean {
  return nodeType.toLowerCase().includes('trigger');
}

export function isPollingNode(nodeType: string): boolean {
  return nodeType.toLowerCase().includes('poll') || nodeType.toLowerCase().includes('trigger');
}
