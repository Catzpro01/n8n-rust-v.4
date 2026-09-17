function cronKey(context) {
  const sorted = Object.fromEntries(Object.entries(context).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify(sorted);
}

/** Dependency-free schedule registry. A host scheduler supplies actual timers. */
export class ScheduledTaskManager {
  constructor({ isLeader = () => true, registerJob, onDuplicate = () => {} } = {}) {
    this.isLeader = isLeader;
    this.registerJob = registerJob ?? (() => ({ stop() {} }));
    this.onDuplicate = onDuplicate;
    this.cronsByWorkflow = new Map();
  }

  registerCron(context, onTick) {
    const workflows = this.cronsByWorkflow.get(context.workflowId) ?? new Map();
    const key = cronKey(context);
    if (workflows.has(key)) {
      this.onDuplicate(context);
      return false;
    }
    const guardedTick = () => this.isLeader() ? onTick() : undefined;
    const job = this.registerJob(context, guardedTick) ?? { stop() {} };
    workflows.set(key, { context, job, onTick: guardedTick });
    this.cronsByWorkflow.set(context.workflowId, workflows);
    return true;
  }

  deregisterCrons(workflowId) {
    const crons = this.cronsByWorkflow.get(workflowId);
    if (!crons) return;
    for (const { job } of crons.values()) job.stop?.();
    this.cronsByWorkflow.delete(workflowId);
  }

  deregisterAllCrons() {
    for (const workflowId of [...this.cronsByWorkflow.keys()]) this.deregisterCrons(workflowId);
  }
}
