/**
 * The ONLY module in apps/n8n-ts that talks to the execution engine LEGO.
 *
 * Single-engine rule (contract §5): the runtime never implements a DAG loop, a
 * node handler or a scheduler — it validates the request, calls
 * `runWorkflowDefinition`, and maps the outcome to HTTP.
 */
import { randomUUID } from 'node:crypto';
import {
  ENGINE_PACKAGE,
  ENGINE_VERSION,
  NODE_REGISTRY_VERSION,
  createNodeRegistry,
  listNodeTypes,
  runWorkflowDefinition,
  validateWorkflowDefinition,
} from '../../../../packages/reconstructed-engine/index.mjs';
import type { RuntimeConfig } from '../config.ts';
import {
  HttpError,
  emptyWorkflow,
  executionTimeout,
  internalError,
  invalidWorkflow,
  unknownConnection,
  unknownNode,
  validationError,
} from '../http/errors.ts';
import type { ExecutionRecord, ExecutionWarning } from '../store/execution-store.ts';
import type { Logger } from '../logger.ts';

export type EngineMetadata = { package: string; version: string; registryVersion: string };

export function engineMetadata(): EngineMetadata {
  return { package: ENGINE_PACKAGE, version: ENGINE_VERSION, registryVersion: NODE_REGISTRY_VERSION };
}

export function nodeTypes(locale = 'en'): ReturnType<typeof listNodeTypes> {
  return listNodeTypes({ locale });
}

export function createRegistry(config: RuntimeConfig, warn?: (warning: ExecutionWarning) => void) {
  return createNodeRegistry({
    locale: config.locale,
    allowCodeEval: config.allowCodeEval,
    onWarning: warn ? (warning: object) => warn(warning as ExecutionWarning) : undefined,
  });
}

export type PreflightResult = {
  definition: Record<string, unknown>;
  warnings: ExecutionWarning[];
};

/**
 * Static pre-flight: validation errors become HTTP errors, suspicious-but-legal
 * findings follow the configured policy.
 */
export function preflight(
  rawDefinition: unknown,
  config: RuntimeConfig,
  registry: ReturnType<typeof createNodeRegistry>,
  startNode: string | null,
): PreflightResult {
  const validation = validateWorkflowDefinition(rawDefinition, { registry });
  if (!validation.ok) {
    const first = validation.errors[0] as { code: string; message: string };
    if (first.code === 'EMPTY_WORKFLOW') throw emptyWorkflow({ errors: validation.errors });
    throw invalidWorkflow(first.message, { errors: validation.errors });
  }

  const warnings = [...validation.warnings] as ExecutionWarning[];
  const unknownNodes = warnings.filter((warning) => warning.code === 'UNKNOWN_NODE_TYPE');
  const unknownConnections = warnings.filter((warning) => warning.code === 'UNKNOWN_CONNECTION_TARGET');

  if (unknownNodes.length > 0 && config.unknownNodePolicy === 'error') {
    throw unknownNode(
      `unknown node type(s): ${unknownNodes.map((warning) => warning.type ?? warning.node).join(', ')}`,
      { nodes: unknownNodes },
    );
  }
  if (unknownConnections.length > 0 && config.unknownConnectionPolicy === 'error') {
    throw unknownConnection(
      `connection target(s) not found: ${unknownConnections.map((warning) => warning.node).join(', ')}`,
      { connections: unknownConnections },
    );
  }

  if (startNode !== null) {
    const normalizedNodes = ((validation.normalized as { nodes?: { name?: unknown }[] } | null)?.nodes ?? []);
    const names = new Set(normalizedNodes.map((node) => node.name));
    if (!names.has(startNode)) {
      throw new HttpError(400, 'UNKNOWN_START_NODE', `start node "${startNode}" is not part of this workflow`, {
        available: [...names].filter((name): name is string => typeof name === 'string'),
      });
    }
  }

  return { definition: validation.normalized as Record<string, unknown>, warnings };
}

export type RunRequest = {
  definition: unknown;
  startNode?: string | null;
  input?: unknown;
  locale?: string;
  mode?: string;
  workflowId?: string | null;
  requestedBy?: 'http' | 'console';
};

export type EngineRunResult = {
  status: string;
  finished: boolean;
  executionLog: ExecutionRecord['executionLog'];
  data: Record<string, unknown>;
  warnings: ExecutionWarning[];
  statusText?: string;
};

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: (error: HttpError) => void,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = executionTimeout(timeoutMs);
      onTimeout(error);
      reject(error);
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function newExecutionId(): string {
  return `exec_${randomUUID().replaceAll('-', '')}`;
}

/**
 * Validate, execute and record a workflow run.
 *
 * Always persists an execution record — including failures — so the operator
 * console and `scripts/doctor.sh` can explain what happened. HTTP errors are
 * re-thrown for the route layer.
 */
export async function executeWorkflowRun(
  options: RunRequest & { config: RuntimeConfig; logger: Logger; store: { add(record: ExecutionRecord): Promise<void> } },
): Promise<ExecutionRecord> {
  const { config, logger, store } = options;
  const locale = options.locale ?? config.locale;
  const executionId = newExecutionId();
  const requestedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const registry = createRegistry(config);

  const record: ExecutionRecord = {
    executionId,
    workflowId: options.workflowId ?? null,
    status: 'FAILED',
    finished: false,
    startedAt: requestedAt,
    stoppedAt: null,
    durationMs: 0,
    requestedAt,
    requestedBy: options.requestedBy ?? 'http',
    mode: options.mode ?? 'manual',
    nodeCount: Array.isArray((options.definition as { nodes?: unknown[] })?.nodes)
      ? ((options.definition as { nodes: unknown[] }).nodes.length as number)
      : 0,
    ok: false,
    executionLog: [],
    data: {},
    warnings: [],
  };

  let preflightWarnings: ExecutionWarning[] = [];
  try {
    const startNode = options.startNode ?? null;
    if (startNode !== null && typeof startNode !== 'string') {
      throw validationError('startNode must be a string', { path: 'startNode' });
    }
    const prepared = preflight(options.definition, config, registry, startNode);
    preflightWarnings = prepared.warnings;
    record.nodeCount = ((prepared.definition.nodes as unknown[]) ?? []).length;

    const engineRun = runWorkflowDefinition(prepared.definition, {
      startNode,
      input: options.input,
      locale,
      registry,
    }) as Promise<EngineRunResult>;

    const result = await withTimeout(engineRun, config.executionTimeoutMs, (error) => {
      logger.error('execution timed out — the run keeps going in the background and its result is discarded', {
        executionId,
        timeoutMs: config.executionTimeoutMs,
        cause: error.message,
      });
    });

    const warnings = dedupeWarnings([...preflightWarnings, ...(result.warnings ?? [])]);
    Object.assign(record, {
      status: typeof result.status === 'string' ? result.status : 'COMPLETED',
      finished: result.finished !== false,
      executionLog: Array.isArray(result.executionLog) ? result.executionLog : [],
      data: result.data && typeof result.data === 'object' ? result.data : {},
      warnings,
      statusText: result.statusText,
      stoppedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      ok: true,
    });
    await store.add(record);
    return record;
  } catch (error) {
    const httpError =
      error instanceof HttpError
        ? error
        : internalError(error instanceof Error ? error.message : String(error), {
            cause: error instanceof Error ? error.stack : undefined,
          });
    if (httpError.code === 'EXECUTION_TIMEOUT') {
      httpError.details = {
        ...(typeof httpError.details === 'object' && httpError.details !== null ? httpError.details : {}),
        executionId,
      };
    }
    record.status = httpError.code === 'EXECUTION_TIMEOUT' ? 'TIMED_OUT' : 'FAILED';
    record.finished = false;
    record.warnings = preflightWarnings;
    record.error = { code: httpError.code, message: httpError.message };
    record.stoppedAt = new Date().toISOString();
    record.durationMs = Date.now() - startedAtMs;
    await store.add(record);
    logger.warn('workflow run failed', {
      executionId,
      code: httpError.code,
      message: httpError.message,
      workflowId: record.workflowId,
    });
    throw httpError;
  }
}

function dedupeWarnings(warnings: ExecutionWarning[]): ExecutionWarning[] {
  const seen = new Set<string>();
  const out: ExecutionWarning[] = [];
  for (const warning of warnings) {
    if (!warning || typeof warning.code !== 'string') continue;
    const key = `${warning.code}|${warning.node ?? ''}|${warning.message ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...warning });
  }
  return out;
}
