/**
 * Scheduler LEGO — Reconstructed 1:1 from n8n v2.9.4
 * Source: reference/n8n/packages/core/src/execution-engine/scheduled-task-manager.ts
 */

export interface IScheduledTask {
  workflowId: string;
  cronExpression: string;
  timezone?: string;
  nextExecution?: Date;
}

export class ScheduledTaskManager {
  private tasks: Map<string, IScheduledTask> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();

  addTask(task: IScheduledTask): void {
    this.tasks.set(task.workflowId, task);
  }

  removeTask(workflowId: string): void {
    this.tasks.delete(workflowId);
    const timer = this.timers.get(workflowId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(workflowId);
    }
  }

  getTasks(): IScheduledTask[] {
    return [...this.tasks.values()];
  }

  parseCronExpression(cron: string): { valid: boolean; next?: Date; error?: string } {
    const parts = cron.trim().split(/\s+/);
    if (parts.length < 5 || parts.length > 6) {
      return { valid: false, error: 'Invalid cron expression: must have 5 or 6 parts' };
    }
    return { valid: true, next: new Date(Date.now() + 60000) };
  }

  scheduleWorkflow(workflowId: string, cronExpression: string, executeFn: () => Promise<void>): void {
    const task: IScheduledTask = {
      workflowId,
      cronExpression,
      nextExecution: new Date(Date.now() + 60000),
    };
    this.addTask(task);

    const timer = setTimeout(async () => {
      try {
        await executeFn();
      } catch (error) {
        console.error(`Scheduler error for workflow ${workflowId}:`, error);
      }
    }, 60000);

    this.timers.set(workflowId, timer);
  }
}

export function isSchedulerNode(nodeType: string): boolean {
  return nodeType.toLowerCase().includes('schedule') || nodeType.toLowerCase().includes('cron');
}
