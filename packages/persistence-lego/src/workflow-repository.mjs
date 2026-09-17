import { randomUUID } from 'node:crypto';

const clone = (value) => structuredClone(value);
const contentChanged = (current, patch) =>
  ('nodes' in patch && JSON.stringify(current.nodes) !== JSON.stringify(patch.nodes)) ||
  ('connections' in patch && JSON.stringify(current.connections) !== JSON.stringify(patch.connections));

export class WorkflowConflictError extends Error {}

export class WorkflowRepository {
  constructor({ idFactory = (() => randomUUID().replaceAll('-', '').slice(0, 16)), versionFactory = randomUUID } = {}) {
    this.idFactory = idFactory;
    this.versionFactory = versionFactory;
    this.workflows = new Map();
    this.history = [];
    this.publishHistory = [];
  }

  create(data, { projectId = 'personal', userId } = {}) {
    const id = data.id ?? this.idFactory();
    if (this.workflows.has(id)) throw new WorkflowConflictError(`Workflow with id ${id} exists already.`);
    const versionId = data.versionId ?? this.versionFactory();
    const workflow = {
      ...clone(data), id, versionId, versionCounter: 1,
      active: false, activeVersionId: null, isArchived: false,
      createdAt: new Date(), updatedAt: new Date(), projectId,
    };
    this.workflows.set(id, workflow);
    this.#saveHistory(workflow, userId);
    return clone(workflow);
  }

  findById(id) { const value = this.workflows.get(id); return value ? clone(value) : null; }
  getAllActiveIds() { return [...this.workflows.values()].filter((w) => w.activeVersionId !== null).map((w) => w.id); }
  getActiveTriggerCount() { return [...this.workflows.values()].filter((w) => w.activeVersionId !== null).reduce((sum, w) => sum + (w.triggerCount ?? 0), 0); }

  update(id, patch, { expectedVersionId, userId } = {}) {
    const current = this.workflows.get(id);
    if (!current) return null;
    if (expectedVersionId && current.versionId !== expectedVersionId) throw new WorkflowConflictError('Workflow was changed before this update could be applied.');
    const changed = contentChanged(current, patch);
    const next = { ...current, ...clone(patch), updatedAt: new Date() };
    if (changed) {
      next.versionId = this.versionFactory();
      next.versionCounter = current.versionCounter + 1;
      this.#saveHistory(next, userId);
    }
    this.workflows.set(id, next);
    return clone(next);
  }

  activate(id, { userId } = {}) {
    const workflow = this.workflows.get(id);
    if (!workflow) return null;
    workflow.active = true;
    workflow.activeVersionId = workflow.versionId;
    workflow.updatedAt = new Date();
    this.publishHistory.push({ workflowId: id, versionId: workflow.versionId, event: 'activated', userId, createdAt: new Date() });
    return clone(workflow);
  }

  deactivate(id, { userId } = {}) {
    const workflow = this.workflows.get(id);
    if (!workflow) return null;
    workflow.active = false;
    workflow.activeVersionId = null;
    workflow.updatedAt = new Date();
    this.publishHistory.push({ workflowId: id, versionId: workflow.versionId, event: 'deactivated', userId, createdAt: new Date() });
    return clone(workflow);
  }

  archive(id) { return this.update(id, { isArchived: true }); }
  delete(id) {
    const workflow = this.workflows.get(id);
    if (!workflow) return false;
    if (!workflow.isArchived) throw new Error('Workflow must be archived before it can be deleted.');
    this.workflows.delete(id);
    return true;
  }

  #saveHistory(workflow, userId) {
    this.history.push({
      workflowId: workflow.id, versionId: workflow.versionId, versionCounter: workflow.versionCounter,
      name: workflow.name, nodes: clone(workflow.nodes ?? []), connections: clone(workflow.connections ?? {}),
      userId, createdAt: new Date(),
    });
  }
}
