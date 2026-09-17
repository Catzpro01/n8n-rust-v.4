// Trigger Engine — 1:1 dari n8n 2.9.4 active-workflows.ts + triggers-and-pollers.ts
// Owner: Agent 4 (spec) — trigger LEGO, Phase 4-13
// Zero Rust, pure JS/TS. Registry in-memory, emit boundary aman.

export type WorkflowActivateMode =
  | 'init' | 'create' | 'update' | 'activate' | 'manual' | 'leadershipChange';

export interface TriggerHandle {
  closeFunction?: () => Promise<void> | void;
  manualTriggerFunction?: () => Promise<void> | void;
}

export interface PollHandle {
  closeFunction?: () => Promise<void> | void;
}

interface ActiveRecord {
  triggers: TriggerHandle[];
  polls: PollHandle[];
}

export const POLL_INTERVAL_TOO_SHORT =
  'The polling interval is too short. It has to be at least a minute.';

export function activationError(message: string): Error {
  const err = new Error(`There was a problem activating the workflow: "${message}"`);
  err.name = 'WorkflowActivationError';
  return err;
}

export class ActiveWorkflows {
  private records: Record<string, ActiveRecord> = {};
  private closedEmits: Set<string> = new Set();

  get activeIds(): string[] {
    return Object.keys(this.records);
  }

  isActive(workflowId: string): boolean {
    return this.records[workflowId] !== undefined;
  }

  /** T1: kegagalan satu node trigger menggagalkan seluruh aktivasi. */
  add(workflowId: string, triggerNodes: string[], startTrigger: (node: string) => TriggerHandle): void {
    if (this.records[workflowId] !== undefined) {
      throw activationError('Workflow is already active');
    }
    const record: ActiveRecord = { triggers: [], polls: [] };
    try {
      for (const node of triggerNodes) {
        record.triggers.push(startTrigger(node));
      }
    } catch (e: any) {
      throw activationError(e?.message ?? String(e));
    }
    this.records[workflowId] = record;
    this.closedEmits.delete(workflowId);
  }

  /** T3+T4: poller jalan sekali saat aktivasi; seconds '*' ditolak. */
  activatePolling(workflowId: string, pollNodes: string[], secondsField: string, runPoll: (node: string) => PollHandle): void {
    if (secondsField.trim() === '*') throw new Error(POLL_INTERVAL_TOO_SHORT);
    const record = this.records[workflowId];
    if (!record) throw activationError('workflow not active');
    try {
      for (const node of pollNodes) {
        record.polls.push(runPoll(node)); // executeTrigger(true) — gagal di sini = aktivasi gagal
      }
    } catch (e: any) {
      if (record.triggers.length === 0) delete this.records[workflowId]; // T2
      throw activationError(e?.message ?? String(e));
    }
  }

  /** T7: emit setelah remove di-drop, tidak pernah throw. */
  emit(workflowId: string, deliver: () => void): 'delivered' | 'dropped' {
    if (this.closedEmits.has(workflowId) || !this.records[workflowId]) return 'dropped';
    deliver();
    return 'delivered';
  }

  /** T9+T10: remove unknown = false senyap; TriggerCloseError ditelan. */
  async remove(workflowId: string): Promise<boolean> {
    const record = this.records[workflowId];
    if (!record) return false;
    for (const t of record.triggers) {
      try {
        await t.closeFunction?.();
      } catch (e: any) {
        if (e?.name !== 'TriggerCloseError') {
          const err = new Error(`Failed to deactivate workflow "${workflowId}"`);
          err.name = 'WorkflowDeactivationError';
          throw err;
        }
      }
    }
    for (const p of record.polls) {
      try {
        await p.closeFunction?.();
      } catch {
        /* cron deregister best-effort (Scheduler LEGO) */
      }
    }
    delete this.records[workflowId];
    this.closedEmits.add(workflowId);
    return true;
  }
}

/** T8: manual-mode one-shot — hanya emit pertama yang dipakai. */
export function createManualTrigger(): { emit: (data: unknown[][]) => void; response: Promise<unknown[][]> } {
  let settled = false;
  let resolve!: (data: unknown[][]) => void;
  const response = new Promise<unknown[][]>((res) => { resolve = res; });
  return {
    response,
    emit: (data) => { if (!settled) { settled = true; resolve(data); } },
  };
}

/** T5: hanya leader yang memegang trigger/poller in-memory. */
export function shouldAddTriggersAndPollers(isLeader: boolean): boolean {
  return isLeader === true;
}
