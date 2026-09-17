
// Workflow LEGO
export * as WorkflowLEGO from './workflow/workflow';

// Connection LEGO
export * as ConnectionLEGO from './connection/connection';

// Node LEGO
export * as NodeLEGO from './node/node-model';

// Validation LEGO
export * as ValidationLEGO from './validation/validation';

// Expression LEGO
export * as ExpressionLEGO from './expression/expression';

// Execution Data LEGO
export * as ExecutionDataLEGO from './execution-data/execution-data';

// Execution Engine LEGO
export * as ExecutionEngineLEGO from './execution-engine/workflow-execute';

// Persistence LEGO
export * as PersistenceLEGO from './persistence/persistence';

// Trigger LEGO
export * as TriggerLEGO from './trigger/trigger';

// Webhook LEGO
export * as WebhookLEGO from './webhook/webhook';

// Scheduler LEGO
export * as SchedulerLEGO from './scheduler/scheduler';

// Credentials LEGO
export * as CredentialsLEGO from './credentials/credentials';

// API LEGO
export * as ApiLEGO from './api/api';

// Settings LEGO
export * as SettingsLEGO from './settings/settings';

// Binary LEGO
export * as BinaryLEGO from './binary/binary-data';

// Error Recovery LEGO (retry policy, onError routing, error-item split)
export * as ErrorRecoveryLEGO from './error-recovery-policy';

export const ENGINE_PROVENANCE = {
  name: 'n8n-reconstructed-engine',
  version: '2.9.4',
  referenceCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
  reconstruction: 'typescript-pure-1-1',
  frontend: 'original-vue-canvas-untouched',
  backend: 'modular-lego-data-flow',
  rust: 'zero-rust',
} as const;
