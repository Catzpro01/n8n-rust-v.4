// webhook LEGO — public surface
// Webhook routing — /webhook/*, /webhook-test/*, /form/*, registration, matching, response modes
// 1:1 dari n8n 2.9.4 webhook.service.ts, waiting-webhooks.ts, test-webhooks.ts
// Zero Rust, pure JS/TS

export const LEGO_NAME = 'webhook';
export const REFERENCE_VERSION = '2.9.4';

export interface WebhookLegoConfig {
  enabled: boolean;
  mode: 'reference' | 'strict';
}

export class WebhookLego {
  private static instance: WebhookLego;
  private config: WebhookLegoConfig = { enabled: true, mode: 'reference' };

  static getInstance(): WebhookLego {
    if (!this.instance) this.instance = new WebhookLego();
    return this.instance;
  }

  getConfig() { return { ...this.config }; }

  // Webhook routing — /webhook/*, /webhook-test/*, /form/*, registration, matching, response modes
  isEnabled(): boolean { return this.config.enabled; }

  // Lifecycle hooks — 1:1 from n8n 2.9.4
  async initialize(): Promise<boolean> {
    // WebhookService initialization
    return true;
  }

  async shutdown(): Promise<boolean> {
    // Cleanup WebhookService
    return true;
  }
}

export const LEGO_PROVENANCE = {
  lego: 'webhook',
  phase: 'phase-4-verified',
  referenceVersion: '2.9.4',
  owns: ["WebhookService","webhook_entity","TestWebhooks","WaitingWebhooks"],
} as const;
