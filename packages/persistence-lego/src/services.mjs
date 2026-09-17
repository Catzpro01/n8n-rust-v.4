export class WorkflowStaticDataService {
  constructor(workflowRepository) { this.workflowRepository = workflowRepository; }
  saveStaticDataById(id, data) {
    const workflow = this.workflowRepository.findById(id);
    if (!workflow) return false;
    this.workflowRepository.update(id, { staticData: structuredClone(data) });
    return true;
  }
  saveStaticData(workflow, mode = 'trigger') {
    if (mode === 'manual' || workflow.staticData?.__dataChanged !== true) return false;
    const data = structuredClone(workflow.staticData);
    delete data.__dataChanged;
    return this.saveStaticDataById(workflow.id, data);
  }
}

export class SettingsRepository {
  constructor() { this.values = new Map(); }
  upsert(key, value, loadOnStartup = true) { const row = { key, value: String(value), loadOnStartup }; this.values.set(key, row); return { ...row }; }
  findByKey(key) { const row = this.values.get(key); return row ? { ...row } : null; }
  delete(key) { return this.values.delete(key); }
}

export function determineFinalExecutionStatus(run) {
  if (run.waitTill) return { status: 'waiting', finished: false };
  if (run.status === 'canceled') return { status: 'canceled', finished: false };
  if (run.status === 'crashed') return { status: 'crashed', finished: false };
  if (run.data?.resultData?.error || run.status === 'error') return { status: 'error', finished: true };
  return { status: 'success', finished: true };
}
