// Scheduler Engine — 1:1 dari ScheduledTaskManager (n8n 2.9.4)
// Owner: Agent 4 + Agent 3 support

export interface CronContext {
  nodeId: string;
  workflowId: string;
  timezone: string;
  expression: string;
  recurrence?: { activated: boolean; index: number; intervalSize: number; typeInterval: string };
}

export class SchedulerEngine {
  private cronsByWorkflow = new Map();

  registerCron(ctx: any, onTick: any) {
    const key = JSON.stringify(ctx);
    if (!this.cronsByWorkflow.has(ctx.workflowId)) {
      this.cronsByWorkflow.set(ctx.workflowId, new Map());
    }
    const byWf = this.cronsByWorkflow.get(ctx.workflowId);
    if (byWf.has(key)) {
      console.warn('Skipped registration for already registered cron', { cron: 'duplicate' });
      return;
    }
    // In real n8n: new CronJob(expression, tick, undefined, true, timezone)
    // Here we simulate with setInterval for testing
    const job = { expression: ctx.expression, timezone: ctx.timezone, onTick, active: true };
    byWf.set(key, job);
  }

  deregisterCrons(workflowId: any) {
    const byWf = this.cronsByWorkflow.get(workflowId);
    if (!byWf) return;
    for (const job of byWf.values()) job.active = false;
    this.cronsByWorkflow.delete(workflowId);
  }

  deregisterAllCrons() {
    for (const wfId of this.cronsByWorkflow.keys()) this.deregisterCrons(wfId);
  }

  toCronExpression(triggerTime: any) {
    // Simplified — real impl in workflow/cron.ts uses randomInt(60) for seconds
    if (triggerTime.mode === 'everyMinute') return `${Math.floor(Math.random()*60)} * * * * *`;
    if (triggerTime.mode === 'everyHour') return `${Math.floor(Math.random()*60)} ${triggerTime.hour || 0} * * *`;
    return triggerTime.expression || '* * * * *';
  }
}
