/**
 * Shared application context — the object every route receives.
 * Kept in its own module so routes and the context do not import each other in
 * a cycle.
 */
import type { RuntimeConfig } from './config.ts';
import type { Logger } from './logger.ts';
import type { WorkflowStore } from './store/workflow-store.ts';
import type { ExecutionStore } from './store/execution-store.ts';
import type { EngineMetadata } from './engine/bridge.ts';
import type { Router } from './http/router.ts';

export type NodeTypeInfo = {
  type: string;
  alias?: string | null;
  group: string;
  label: string;
  description: string;
  implemented: boolean;
};

export type App = {
  config: RuntimeConfig;
  logger: Logger;
  workflows: WorkflowStore;
  executions: ExecutionStore;
  engine: EngineMetadata;
  nodeTypes: NodeTypeInfo[];
  router: Router;
  startedAt: string;
  startedAtMs: number;
  /** set by the signal handlers; readiness flips to 503 */
  shuttingDown: boolean;
};
