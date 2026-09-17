/**
 * @lego/webhook — Webhook LEGO (Webhook routing, registration, sanitization, HTTP handling)
 * Reference: n8n 2.9.4
 */
export * from './webhook';

export const LEGO_PROVENANCE = {
  lego: 'webhook',
  phase: 'phase-2-isolation',
  referenceVersion: '2.9.4',
  referenceCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
  behaviorChange: 'none-detected',
  rustImplementation: 'not-started',
} as const;
