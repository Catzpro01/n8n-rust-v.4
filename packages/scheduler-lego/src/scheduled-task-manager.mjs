import { toCronKey } from './cron.mjs';

const NOOP_LOGGER = Object.freeze({ debug() {}, info() {} });

/** Timer creation is injected; the host may adapt the upstream `cron` CronJob. */
export class ScheduledTaskManager {
  constructor({
    isLeader = () => true,
    instanceRole = 'leader',
    createJob,
    registerJob,
    onDuplicate = () => {},
    errorReporter = { error() {} },
    logger = NOOP_LOGGER,
  } = {}) {
    this.isLeader = isLeader;
    this.instanceRole = instanceRole;
    this.createJob = createJob ?? registerJob ?? ((_context, _tick) => ({ stop() {} }));
    this.onDuplicate = onDuplicate;
    this.errorReporter = errorReporter;
    this.logger = logger;
    this.cronsByWorkflow = new Map();
  }

  registerCron(context, onTick) {
    const summary = context.recurrence?.activated
      ? `${context.expression} (every ${context.recurrence.intervalSize} ${context.recurrence.typeInterval})`
      : context.expression;
    const key = toCronKey(context);
    const existing = this.cronsByWorkflow.get(context.workflowId);
    if (existing?.has(key)) {
      this.errorReporter.error('Skipped registration for already registered cron', {
        tags: { cron: 'duplicate' },
        extra: { ...context, instanceRole: this.instanceRole },
      });
      this.onDuplicate(context);
      return false;
    }

    const tick = () => {
      if (!this.isLeader()) return;
      this.logger.debug('Executing cron for workflow', {
        workflowId: context.workflowId,
        nodeId: context.nodeId,
        cron: summary,
        instanceRole: this.instanceRole,
      });
      // Deliberately fire-and-forget, matching CronJob's callback contract.
      onTick();
    };
    // Invalid expressions propagate synchronously from the host adapter.
    const job = this.createJob(context, tick);
    const entry = { job, summary, context, onTick: tick };
    if (existing) existing.set(key, entry);
    else this.cronsByWorkflow.set(context.workflowId, new Map([[key, entry]]));
    return true;
  }

  deregisterCrons(workflowId) {
    const crons = this.cronsByWorkflow.get(workflowId);
    if (!crons?.size) return false;
    const summaries = [];
    for (const cron of crons.values()) { summaries.push(cron.summary); cron.job.stop?.(); }
    this.cronsByWorkflow.delete(workflowId);
    this.logger.info('Deregistered all crons for workflow', {
      workflowId, crons: summaries, instanceRole: this.instanceRole,
    });
    return true;
  }

  deregisterAllCrons() {
    for (const workflowId of [...this.cronsByWorkflow.keys()]) this.deregisterCrons(workflowId);
  }
}

export function getSchedulingFunctions(manager, workflowId, timezone, nodeId) {
  return {
    registerCron(cron, onTick) {
      return manager.registerCron({ workflowId, timezone, nodeId, ...cron }, onTick);
    },
  };
}
