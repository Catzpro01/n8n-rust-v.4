/**
 * Execution store — keeps the run history that makes the baseline debuggable.
 *
 * `file`   : `<dataDir>/executions/index.jsonl` (append-only summaries) plus
 *            `<dataDir>/executions/<id>.json` (full record)
 * `memory` : ring buffer only
 *
 * Records survive a restart (contract §3.4) and the store prunes itself to
 * `N8N_TS_EXECUTION_HISTORY` entries.
 */
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '../logger.ts';
import type { StorageKind } from '../config.ts';

export type ExecutionWarning = { code: string; message: string; node?: string; type?: string };

export type ExecutionLogEntry = {
  node: string;
  type: string;
  inputCount: number;
  outputCount: number;
  durationMs: number;
  status: string;
  nodeLabel?: string;
  message?: string;
};

export type ExecutionSummary = {
  executionId: string;
  workflowId: string | null;
  status: string;
  finished: boolean;
  startedAt: string;
  stoppedAt: string | null;
  durationMs: number;
  requestedAt: string;
  requestedBy: 'http' | 'console';
  mode: string;
  nodeCount: number;
  ok: boolean;
};

export type ExecutionRecord = ExecutionSummary & {
  executionLog: ExecutionLogEntry[];
  data: Record<string, unknown>;
  warnings: ExecutionWarning[];
  statusText?: string;
  error?: { code: string; message: string };
};

export class ExecutionStore {
  readonly #dir: string | null;
  readonly #indexFile: string | null;
  readonly #logger: Logger;
  readonly #history: number;
  #records = new Map<string, ExecutionRecord>();
  #order: string[] = [];

  private constructor(dir: string | null, history: number, logger: Logger) {
    this.#dir = dir;
    this.#indexFile = dir ? join(dir, 'index.jsonl') : null;
    this.#history = history;
    this.#logger = logger;
  }

  static async create(options: { dataDir: string; storage: StorageKind; history: number; logger: Logger }): Promise<ExecutionStore> {
    const dir = options.storage === 'file' ? join(options.dataDir, 'executions') : null;
    const store = new ExecutionStore(dir, options.history, options.logger);
    if (dir) {
      await mkdir(dir, { recursive: true });
      await store.#loadIndex();
    }
    return store;
  }

  get directory(): string | null {
    return this.#dir;
  }

  async #loadIndex(): Promise<void> {
    if (!this.#indexFile) return;
    try {
      const raw = await readFile(this.#indexFile, 'utf8');
      const lines = raw.split('\n').filter((line) => line.trim() !== '');
      const tail = lines.slice(-Math.max(this.#history, 1));
      for (const line of tail) {
        try {
          const summary = JSON.parse(line) as ExecutionSummary;
          if (summary && typeof summary.executionId === 'string') {
            this.#order.push(summary.executionId);
            this.#records.set(summary.executionId, { ...summary, executionLog: [], data: {}, warnings: [] });
          }
        } catch {
          this.#logger.warn('skipping corrupt execution index line', {});
        }
      }
      this.#logger.debug('execution store loaded', { count: this.#order.length });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.#logger.warn('cannot read execution index — starting with an empty history', {
        cause: (error as Error).message,
      });
    }
  }

  async add(record: ExecutionRecord): Promise<void> {
    this.#records.set(record.executionId, record);
    this.#order = this.#order.filter((id) => id !== record.executionId);
    this.#order.push(record.executionId);
    const evicted = this.#order.splice(0, Math.max(0, this.#order.length - this.#history));
    for (const id of evicted) this.#records.delete(id);

    if (!this.#dir) return;
    try {
      const { executionLog, data, warnings, statusText, error, ...summary } = record;
      void { executionLog, data, warnings, statusText, error };
      await writeFile(join(this.#dir, `${record.executionId}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
      await appendFile(this.#indexFile as string, `${JSON.stringify(summary)}\n`, 'utf8');
      for (const id of evicted) await rm(join(this.#dir, `${id}.json`), { force: true });
      await this.#trimIndex();
      await this.#pruneOrphanFiles();
    } catch (err) {
      this.#logger.warn('execution record could not be persisted', { cause: (err as Error).message });
    }
  }

  async #trimIndex(): Promise<void> {
    if (!this.#indexFile) return;
    const keep = new Set(this.#order);
    const summaries = this.#order
      .map((id) => this.#records.get(id))
      .filter((record): record is ExecutionRecord => record !== undefined)
      .map(({ executionLog: _l, data: _d, warnings: _w, statusText: _s, error: _e, ...summary }) => summary);
    void keep;
    await writeFile(this.#indexFile, summaries.map((summary) => `${JSON.stringify(summary)}\n`).join(''), 'utf8');
  }

  async #pruneOrphanFiles(): Promise<void> {
    if (!this.#dir) return;
    const entries = await readdir(this.#dir).catch(() => [] as string[]);
    const keep = new Set([...this.#order.map((id) => `${id}.json`), 'index.jsonl']);
    for (const entry of entries) {
      if (!entry.endsWith('.json') || keep.has(entry)) continue;
      await rm(join(this.#dir, entry), { force: true });
    }
  }

  async get(id: string): Promise<ExecutionRecord | null> {
    const cached = this.#records.get(id);
    if (cached && cached.executionLog.length > 0) return cached;
    if (this.#dir) {
      try {
        const raw = await readFile(join(this.#dir, `${id}.json`), 'utf8');
        const record = JSON.parse(raw) as ExecutionRecord;
        this.#records.set(id, record);
        return record;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return cached ?? null;
        this.#logger.warn('execution record could not be read', { executionId: id, cause: (error as Error).message });
      }
    }
    return cached ?? null;
  }

  list(limit: number): ExecutionSummary[] {
    const ids = [...this.#order].reverse().slice(0, limit);
    return ids
      .map((id) => this.#records.get(id))
      .filter((record): record is ExecutionRecord => record !== undefined)
      .map(({ executionLog: _l, data: _d, warnings: _w, statusText: _s, error: _e, ...summary }) => summary);
  }

  get size(): number {
    return this.#order.length;
  }
}
