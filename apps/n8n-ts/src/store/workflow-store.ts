/**
 * Workflow store — the baseline persistence for workflow definitions.
 *
 * `file`   : `<dataDir>/workflows.json`, written atomically (tmp + rename)
 * `memory` : nothing touches the disk (tests / throwaway runs)
 *
 * Stored definitions are kept verbatim (only id/name are guaranteed), because
 * the console is meant to be a place where a workflow can be pasted, saved,
 * fixed and re-run without the runtime "helpfully" rewriting it.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isPlainObject } from '../http/body.ts';
import { storageError, validationError } from '../http/errors.ts';
import type { Logger } from '../logger.ts';
import type { StorageKind } from '../config.ts';

export type StoredWorkflow = {
  id: string;
  name: string;
  nodes: unknown[];
  connections: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};

type StoreFile = { version: 1; workflows: Record<string, StoredWorkflow> };

const STORE_VERSION = 1;

export function newWorkflowId(): string {
  return `wf_${randomUUID().replaceAll('-', '')}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Stable id for workflows imported without one (content addressed). */
export function derivedWorkflowId(definition: Record<string, unknown>): string {
  const hash = createHash('sha256').update(JSON.stringify({ name: definition.name ?? '', nodes: definition.nodes ?? [] })).digest('hex');
  return `wf_${hash.slice(0, 24)}`;
}

export class WorkflowStore {
  readonly #file: string | null;
  readonly #logger: Logger;
  #workflows = new Map<string, StoredWorkflow>();

  private constructor(file: string | null, logger: Logger) {
    this.#file = file;
    this.#logger = logger;
  }

  static async create(options: { dataDir: string; storage: StorageKind; logger: Logger }): Promise<WorkflowStore> {
    const file = options.storage === 'file' ? join(options.dataDir, 'workflows.json') : null;
    const store = new WorkflowStore(file, options.logger);
    if (file) {
      await mkdir(dirname(file), { recursive: true });
      await store.#load();
    }
    return store;
  }

  get filePath(): string | null {
    return this.#file;
  }

  async #load(): Promise<void> {
    if (!this.#file) return;
    try {
      const raw = await readFile(this.#file, 'utf8');
      const parsed = JSON.parse(raw) as StoreFile;
      if (!isPlainObject(parsed?.workflows)) return;
      for (const [id, workflow] of Object.entries(parsed.workflows)) {
        if (isPlainObject(workflow)) this.#workflows.set(id, workflow as StoredWorkflow);
      }
      this.#logger.debug('workflow store loaded', { file: this.#file, count: this.#workflows.size });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      if (error instanceof SyntaxError) {
        throw storageError(`workflow store ${this.#file} is not valid JSON — fix or remove the file`, {
          cause: (error as Error).message,
        });
      }
      throw storageError(`cannot read workflow store ${this.#file}`, { cause: (error as Error).message });
    }
  }

  async #persist(): Promise<void> {
    if (!this.#file) return;
    const payload: StoreFile = { version: STORE_VERSION, workflows: Object.fromEntries(this.#workflows) };
    const tmp = `${this.#file}.tmp`;
    try {
      await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      await rename(tmp, this.#file);
    } catch (error) {
      throw storageError(`cannot write workflow store ${this.#file}`, { cause: (error as Error).message });
    }
  }

  list(): StoredWorkflow[] {
    return [...this.#workflows.values()]
      .map((workflow) => ({ ...workflow }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  }

  summaries(): { id: string; name: string; nodeCount: number; createdAt: string; updatedAt: string }[] {
    return this.list().map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      nodeCount: Array.isArray(workflow.nodes) ? workflow.nodes.length : 0,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
    }));
  }

  get(id: string): StoredWorkflow | null {
    const workflow = this.#workflows.get(id);
    return workflow ? { ...workflow } : null;
  }

  has(id: string): boolean {
    return this.#workflows.has(id);
  }

  /** Create (id absent/unknown) or update (known id) a stored workflow. */
  async save(definition: Record<string, unknown>, options: { id?: string } = {}): Promise<{ workflow: StoredWorkflow; created: boolean }> {
    const name = typeof definition.name === 'string' && definition.name.trim() !== '' ? definition.name : 'Untitled workflow';
    if (definition.nodes !== undefined && !Array.isArray(definition.nodes)) {
      throw validationError('workflow.nodes must be an array', { path: 'workflow.nodes' });
    }
    if (definition.connections !== undefined && !isPlainObject(definition.connections)) {
      throw validationError('workflow.connections must be an object', { path: 'workflow.connections' });
    }

    const requestedId =
      options.id ?? (typeof definition.id === 'string' && definition.id.trim() !== '' ? definition.id : undefined);
    const existing = requestedId ? this.#workflows.get(requestedId) : undefined;
    const id = requestedId ?? newWorkflowId();
    const timestamp = nowIso();

    const workflow: StoredWorkflow = {
      ...(existing ?? {}),
      ...definition,
      id,
      name,
      nodes: Array.isArray(definition.nodes) ? definition.nodes : (existing?.nodes ?? []),
      connections: isPlainObject(definition.connections) ? definition.connections : (existing?.connections ?? {}),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    this.#workflows.set(id, workflow);
    await this.#persist();
    return { workflow: { ...workflow }, created: existing === undefined };
  }

  async delete(id: string): Promise<boolean> {
    if (!this.#workflows.delete(id)) return false;
    await this.#persist();
    return true;
  }
}
