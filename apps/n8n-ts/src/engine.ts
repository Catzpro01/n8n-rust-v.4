/**
 * Jembatan runtime → LEGO engine (kontrak §4 + §9).
 *
 * ATURAN KERAS: file ini DILARANG berisi loop eksekusi (BFS). Satu-satunya engine
 * adalah `WorkflowExecutionEngine` di `packages/reconstructed-engine/runner.mjs`,
 * dipakai via adapter beku `ts-runtime-adapter.mjs` (Worker 4).
 *
 * Adapter dimuat via dynamic import agar kompilasi `tsc` tetap flat ke `dist/`
 * (adapter .mjs di luar `src/` tidak ditarik ke program TS).
 */
import { logger } from './logger.js';

/* ----- Tipe lokal (cermin adapter — TIDAK mengimpor kode LEGO langsung) ----- */

export interface ValidationIssue {
  message: string;
  hint: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
}

export interface ExecutionLogEntry {
  node: string;
  type: string;
  inputCount: number;
  outputCount: number;
  durationMs: number;
  status: string;
  [key: string]: unknown; // field human-facing tambahan (nodeLabel, ...) diizinkan
}

export interface BaselineExecutionResult {
  status: string;
  finished: boolean;
  executionLog: ExecutionLogEntry[];
  data: Record<string, Array<{ json: Record<string, unknown> }>>;
  [key: string]: unknown; // field locale tambahan diizinkan (additive-only)
}

interface Adapter {
  validateBaselineWorkflow: (
    workflow: unknown,
    opts?: { startNode?: unknown },
  ) => ValidationResult;
  createBaselineEngine: (
    workflow: Record<string, unknown>,
    opts?: { locale?: string },
  ) => {
    runWorkflow: (
      startNodeName?: string | null,
      initialData?: unknown,
      options?: Record<string, unknown>,
    ) => Promise<BaselineExecutionResult>;
  };
  BASELINE_KNOWN_NODE_TYPES: readonly string[];
}

let adapterPromise: Promise<Adapter> | null = null;

/** Muat adapter sekali (cache promise) — path sama valid dari src/ maupun dist/. */
export function loadAdapter(): Promise<Adapter> {
  if (!adapterPromise) {
    const url = new URL(
      '../../../packages/reconstructed-engine/ts-runtime-adapter.mjs',
      import.meta.url,
    );
    adapterPromise = import(url.href) as Promise<Adapter>;
  }
  return adapterPromise;
}

/** Validasi workflow via adapter (kontrak §3). */
export async function validateWorkflow(
  workflow: unknown,
  startNode: unknown,
): Promise<ValidationResult> {
  const adapter = await loadAdapter();
  return adapter.validateBaselineWorkflow(workflow, { startNode });
}

export interface ExecuteArgs {
  workflow: Record<string, unknown>;
  input: unknown; // array item atau satu object (sudah divalidasi di route)
  startNode: string | null;
  locale: string;
  timeoutMs: number;
}

/** Eksekusi via SATU-SATUNYA engine (runner.mjs). Timeout via Promise.race. */
export async function executeWorkflow(args: ExecuteArgs): Promise<BaselineExecutionResult> {
  const adapter = await loadAdapter();

  // Peringatan oprek: type tanpa handler = passthrough (kontrak §4).
  warnUnknownNodeTypes(adapter, args.workflow);

  const engine = adapter.createBaselineEngine(args.workflow, { locale: args.locale });

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('execution timeout')), args.timeoutMs);
      timer.unref?.();
    });
    return await Promise.race([
      engine.runWorkflow(args.startNode, args.input as never),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function warnUnknownNodeTypes(adapter: Adapter, workflow: Record<string, unknown>): void {
  const nodes = (workflow as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return;
  const known = new Set<string>(adapter.BASELINE_KNOWN_NODE_TYPES);
  const warned = new Set<string>();
  for (const node of nodes) {
    const type = (node as { type?: unknown })?.type;
    if (typeof type === 'string' && !known.has(type) && !warned.has(type)) {
      warned.add(type);
      logger.warn(`unknown node type "${type}" — passthrough`);
    }
  }
}
