import { parseExecutionData, stringify } from './flatted.mjs';

const clone = (value) => structuredClone(value);
const snapshotWorkflow = (workflow = {}) => Object.fromEntries(
  ['id', 'name', 'nodes', 'connections', 'settings', 'active', 'activeVersionId', 'isArchived', 'createdAt', 'updatedAt', 'staticData']
    .filter((key) => workflow[key] !== undefined)
    .map((key) => [key, clone(workflow[key])]),
);

export const EXECUTION_STATUSES = Object.freeze(['new', 'running', 'success', 'error', 'crashed', 'canceled', 'waiting', 'unknown']);

export class ExecutionRepository {
  constructor() { this.entities = new Map(); this.data = new Map(); this.nextId = 1; }

  create(payload) {
    const id = String(this.nextId++);
    const now = new Date();
    const entity = {
      id, workflowId: payload.workflowId ?? payload.workflowData?.id,
      mode: payload.mode, status: payload.status ?? 'new', finished: false,
      retryOf: payload.retryOf, retrySuccessId: undefined,
      createdAt: now, startedAt: payload.startedAt, stoppedAt: undefined,
      waitTill: payload.waitTill, deletedAt: null, storedAt: payload.storedAt ?? 'db',
    };
    this.entities.set(id, entity);
    this.data.set(id, {
      executionId: id,
      data: stringify(payload.data ?? {}),
      workflowData: snapshotWorkflow(payload.workflowData),
      workflowVersionId: payload.workflowData?.versionId,
    });
    return id;
  }

  setRunning(id, now = new Date()) { return this.#patch(id, { status: 'running', startedAt: now }); }
  markAsCrashed(ids, now = new Date()) { return ids.map((id) => this.#patch(id, { status: 'crashed', stoppedAt: now })); }
  cancel(id, now = new Date()) { return this.#patch(id, { status: 'canceled', stoppedAt: now }); }

  updateExistingExecution(id, patch, conditions = {}) {
    const entity = this.entities.get(String(id));
    if (!entity) return false;
    if (conditions.requireNotFinished && entity.finished) return false;
    if (conditions.requireNotCanceled && entity.status === 'canceled') return false;
    const entityPatch = { ...patch };
    delete entityPatch.data;
    delete entityPatch.workflowData;
    if ('status' in entityPatch && !EXECUTION_STATUSES.includes(entityPatch.status)) throw new Error(`Unknown execution status: ${entityPatch.status}`);
    Object.assign(entity, clone(entityPatch));
    if ('finished' in patch) entity.finished = Boolean(patch.finished);
    const stored = this.data.get(String(id));
    if (patch.data !== undefined) stored.data = stringify(patch.data);
    if (patch.workflowData !== undefined) stored.workflowData = snapshotWorkflow(patch.workflowData);
    return true;
  }

  findSingleExecution(id, { includeData = false, unflattenData = false, includeDeleted = false } = {}) {
    const entity = this.entities.get(String(id));
    if (!entity || (!includeDeleted && entity.deletedAt)) return undefined;
    const result = clone(entity);
    if (includeData) {
      const stored = this.data.get(String(id));
      Object.assign(result, { workflowData: clone(stored.workflowData), data: unflattenData ? parseExecutionData(stored.data) : stored.data });
    }
    return result;
  }

  softDelete(id, now = new Date()) { return this.#patch(id, { deletedAt: now }); }
  hardDelete(id) { const existed = this.entities.delete(String(id)); this.data.delete(String(id)); return existed; }
  getInProgressExecutionIds() { return [...this.entities.values()].filter((e) => e.status === 'new' || e.status === 'running').map((e) => e.id); }

  #patch(id, patch) { const entity = this.entities.get(String(id)); if (!entity) return false; Object.assign(entity, patch); return true; }
}

export class ExecutionPersistence {
  constructor(repository = new ExecutionRepository()) { this.repository = repository; }
  create(payload) { return this.repository.create({ ...payload, status: 'new', finished: false }); }
  hardDelete(id) { return this.repository.hardDelete(id); }
}
