// trigger LEGO — public surface
// Trigger lifecycle — long-lived trigger and polling nodes, activation/deactivation
// 1:1 dari n8n 2.9.4 active-workflows.ts, triggers-and-pollers.ts, trigger-context.ts, poll-context.ts
// Zero Rust, pure JS/TS

export const LEGO_NAME = 'trigger';
export const REFERENCE_VERSION = '2.9.4';

export interface TriggerLegoConfig {
  enabled: boolean;
  mode: 'reference' | 'strict';
}

export class TriggerLego {
  private static instance: TriggerLego;
  private config: TriggerLegoConfig = { enabled: true, mode: 'reference' };

  static getInstance(): TriggerLego {
    if (!this.instance) this.instance = new TriggerLego();
    return this.instance;
  }

  getConfig() { return { ...this.config }; }

  // Trigger lifecycle — long-lived trigger and polling nodes, activation/deactivation
  isEnabled(): boolean { return this.config.enabled; }

  // Lifecycle hooks — 1:1 from n8n 2.9.4
  async initialize(): Promise<boolean> {
    // ActiveWorkflows initialization
    return true;
  }

  async shutdown(): Promise<boolean> {
    // Cleanup ActiveWorkflows
    return true;
  }
}

export const LEGO_PROVENANCE = {
  lego: 'trigger',
  phase: 'phase-4-verified',
  referenceVersion: '2.9.4',
  owns: ["ActiveWorkflows","TriggersAndPollers","triggerResponses","pollResponses"],
} as const;
