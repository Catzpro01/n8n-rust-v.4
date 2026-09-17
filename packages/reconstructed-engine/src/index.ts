/**
 * Reconstructed n8n Engine — Main Entry Point
 * Reconstructs n8n v2.9.4 backend data flow modular LEGO structure in pure TypeScript/Node.js
 *
 * This is the central integration point for all LEGOs:
 * - Workflow (DAG Graph, Stack, Execution flow)
 * - Node (Node catalog, loader, registry)
 * - Connection (Pin connection routing, slot validation)
 * - Expression (Expression evaluator {{ ... }}, variable proxy scoping)
 * - Execution Data (Run data, pairedItem tracking)
 * - Execution Engine (DAG execution loop)
 * - Persistence (Run data hooks, execution logger, database state)
 * - Trigger (Trigger lifecycle)
 * - Webhook (Webhook routing)
 * - Scheduler (Cron scheduling)
 * - Credentials (Credential management)
 * - API (REST API)
 * - Settings (Localization, personal settings)
 * - Binary (Binary data handling)
 * - Validation (Graph cycle & schema validation)
 *
 * Reference: n8n 2.9.4 (commit b6dc2787c45677a29a9612cd27eb911302961a83)
 * Contracts: contracts/*.contract.md
 * Isolation: docs/isolation/*.md
 *
 * ZERO RUST: Pure JS/TS 1:1 from n8n v2.9.4 source
 * Frontend UI: 100% original n8n (Vue Canvas / editor-ui untouched)
 */

// Workflow LEGO
export * from './workflow/workflow';

// Connection LEGO
export * from './connection/connection';

// Node LEGO
export * from './node/node-model';

// Validation LEGO
export * from './validation/validation';

// Expression LEGO
export * from './expression/expression';

// Execution Data LEGO
export * from './execution-data/execution-data';

// Execution Engine LEGO
export * from './execution-engine/workflow-execute';

// Persistence LEGO
export * from './persistence/persistence';

// Trigger LEGO
export * from './trigger/trigger';

// Webhook LEGO
export * from './webhook/webhook';

// Scheduler LEGO
export * from './scheduler/scheduler';

// Credentials LEGO
export * from './credentials/credentials';

// API LEGO
export * from './api/api';

// Settings LEGO
export * from './settings/settings';

// Binary LEGO
export * from './binary/binary-data';

// Dynamic form validator (legacy)
export * from './dynamic-form-validator';

// Core engine class (legacy compatibility)
export { WorkflowExecutionEngine } from '../runner.mjs';

export const ENGINE_PROVENANCE = {
  name: 'n8n-reconstructed-engine',
  version: '2.9.4',
  referenceCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
  reconstruction: 'typescript-pure-1-1',
  frontend: 'original-vue-canvas-untouched',
  backend: 'modular-lego-data-flow',
  rust: 'zero-rust',
} as const;
