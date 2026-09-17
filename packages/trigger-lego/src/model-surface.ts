// Trigger LEGO — model surface 1:1 dari n8n 2.9.4
// Owner: Agent 4 (spec) — implemented Phase 4-13, b104 track
// Provenance (read-only reference, DO NOT EDIT reference/):
//   R1 core/src/execution-engine/active-workflows.ts:71-130  (ActiveWorkflows.add, T1/T2)
//   R2 core/src/execution-engine/active-workflows.ts:159-165  (immediate poll run T3, seconds guard T4)
//   R3 core/src/execution-engine/active-workflows.ts:186-...  (ActiveWorkflows.remove, T9/T10)
//   R4 core/src/execution-engine/triggers-and-pollers.ts      (runTrigger manual one-shot T8)
//   R5 cli/src/active-workflow-manager.ts:291-437              (__emit/__emitError, emit/emitError, T7)
//   R6 cli/src/active-workflow-manager.ts:588,963              (add/addTriggersAndPollers, leader gate T5)
// Contract: contracts/trigger.contract.md §2-§11. Isolation: docs/isolation/trigger.md §2.
// Zero Rust, pure TS, dependency-free.

/** R6 — activation modes (WorkflowActivateMode). */
export type WorkflowActivateMode =
  | 'init'
  | 'create'
  | 'update'
  | 'activate'
  | 'manual'
  | 'leadershipChange';

/** R1 — trigger handle kept in memory per active workflow. */
export interface ITriggerResponse {
  closeFunction?: () => Promise<void> | void;
  manualTriggerFunction?: () => Promise<void> | void;
  manualTriggerResponse?: Promise<unknown[][]>;
}

/** R1 — poll handle kept in memory per active workflow. */
export interface IPollResponse {
  closeFunction?: () => Promise<void> | void;
}

/** R1/R3 — in-memory registry shape: activeWorkflows[workflowId]. */
export interface ActiveWorkflowRecord {
  triggerResponses: ITriggerResponse[];
  pollResponses: IPollResponse[];
}
export type ActiveWorkflowsShape = Record<string, ActiveWorkflowRecord>;

/** R1 active-workflows.ts:100,131 — exact activation-failure envelope (T1). */
export function buildActivationError(nodeMessage: string): string {
  return `There was a problem activating the workflow: "${nodeMessage}"`;
}

/** Contract §7 — no trigger-like node guard (checked before add). */
export const NO_TRIGGER_NODE_MESSAGE =
  'Workflow cannot be activated because it has no trigger node. ' +
  'At least one trigger, webhook, or polling node is required.';

/** R2 active-workflows.ts:165 — exact poll-interval rejection (T4). */
export const POLL_INTERVAL_TOO_SHORT_MESSAGE =
  'The polling interval is too short. It has to be at least a minute.';

/** R6 — only the leader owns in-memory triggers/pollers (T5). */
export function isLeaderActivation(isLeader: boolean): boolean {
  return isLeader === true;
}

/** R2 — pollers run once immediately at activation so broken pollers fail fast (T3). */
export function shouldRunPollImmediately(): boolean {
  return true;
}

/**
 * R2 — reject a poll cron whose seconds field is `*` (T4).
 * Returns the exact UserError message when invalid, else null.
 */
export function rejectShortPollInterval(secondsField: string): string | null {
  if (secondsField.trim() === '*') return POLL_INTERVAL_TOO_SHORT_MESSAGE;
  return null;
}

/** Contract §4 — disabled nodes are never registered (T6). */
export function isRegistrableNode(disabled: boolean | undefined): boolean {
  return disabled !== true;
}

/**
 * R5 — emit-after-remove guard (T7): emit after close is dropped, never throws.
 * `closed` mirrors the registry entry being deleted by remove().
 */
export function guardedEmit(closed: boolean, deliver: () => void): 'delivered' | 'dropped' {
  if (closed) return 'dropped';
  deliver();
  return 'delivered';
}

export interface ManualEmitBox {
  /** Resolves with the FIRST emitted data only; later emits are ignored (T8). */
  emit: (data: unknown[][]) => void;
  response: Promise<unknown[][]>;
}

/** R4 — manual-mode one-shot emit into manualTriggerResponse (T8). */
export function createManualEmit(): ManualEmitBox {
  let settled = false;
  let resolve!: (data: unknown[][]) => void;
  const response = new Promise<unknown[][]>((res) => {
    resolve = res;
  });
  return {
    response,
    emit: (data: unknown[][]) => {
      if (settled) return;
      settled = true;
      resolve(data);
    },
  };
}

export type CloseOutcome = 'closed' | 'trigger-close-swallowed' | 'deactivation-error';

/**
 * R3 — deactivation close semantics (T10): TriggerCloseError is logged and
 * swallowed; any other close error becomes WorkflowDeactivationError (thrown).
 * Pure decision function: caller performs logging / throwing.
 */
export function closeTriggerOutcome(errorName: string | null): CloseOutcome {
  if (errorName === null) return 'closed';
  if (errorName === 'TriggerCloseError') return 'trigger-close-swallowed';
  return 'deactivation-error';
}

/** R3 — remove of an unknown id returns false silently (T9). */
export function removeWorkflow(
  registry: ActiveWorkflowsShape,
  workflowId: string,
): boolean {
  if (registry[workflowId] === undefined) return false;
  delete registry[workflowId];
  return true;
}

/** R1 — poll failure with zero trigger responses deletes the fresh entry (T2). */
export function shouldDeleteEntryAfterPollFailure(triggerResponseCount: number): boolean {
  return triggerResponseCount === 0;
}

export const TRIGGER_PROVENANCE = {
  pinnedVersion: '2.9.4',
  pinnedCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
  invariants: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'],
} as const;
