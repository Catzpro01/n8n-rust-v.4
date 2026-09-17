// Trigger Engine — 1:1 port of the n8n 2.9.4 trigger layer.
//
// Two reference sources, both pinned and both differential-tested by
// `tools/trigger-isolation-gate.mjs` (`npm run trigger:check`):
//
//   1. `n8n-core` `execution-engine/active-workflows.ts` — `ActiveWorkflows`, the in-memory
//      registry of trigger responses per active workflow (state machine + error wrapping).
//   2. `n8n-workflow` `workflow-validation.ts` — `validateWorkflowHasTriggerLikeNode`, the check the
//      CLI/API layer runs before activating a workflow.
//
// Deliberate deviations (recorded in `packages/trigger-lego/manifest/ownership.json`):
//   * the polling branch of `ActiveWorkflows.add()` (cron registration via `ScheduledTaskManager`)
//     is delegated through the `polling` hook — scheduling is owned by the Scheduler LEGO;
//   * no OpenTelemetry span around poll executions (no tracing dependency in this reconstruction);
//   * errors are local classes with the reference names/fields instead of `n8n-workflow` classes,
//     because this module must stay dependency-free.
//
// Owner: Agent 4 (trigger LEGO) — hardening pass by Agent 3 (integration).
// Zero Rust, pure JS/TS, frontend UI untouched.

export type ErrorLevel = 'info' | 'warning' | 'error';

export interface TriggerResponse {
	closeFunction?: () => Promise<void>;
	manualTriggerFunction?: () => Promise<void>;
	manualTriggerResponse?: unknown;
}

export interface ActiveWorkflowData {
	triggerResponses: TriggerResponse[];
}

export interface INodeLike {
	name: string;
	type: string;
	id?: string;
	disabled?: boolean;
	parameters?: Record<string, any>;
}

export interface NodeTypesGetter {
	getByNameAndVersion(nodeType: string, version?: number): { trigger?: unknown; poll?: unknown; webhook?: unknown } | undefined;
}

/** Nodes that n8n does *not* accept as the reason to activate a workflow (`cli/src/constants.ts`). */
export const STARTING_NODES = ['@n8n/n8n-nodes-langchain.manualChatTrigger', 'n8n-nodes-base.manualTrigger'];

/* ------------------------------------------------------------------ */
/* errors — same names, messages and fields as `n8n-workflow`          */
/* ------------------------------------------------------------------ */

const WARNING_LEVEL_PATTERNS = ['etimedout', 'econnrefused', 'eauth', 'temporary authentication failure', 'invalid credentials'];

export interface WorkflowActivationErrorOptions {
	cause?: Error;
	node?: INodeLike;
	level?: ErrorLevel;
	workflowId?: string;
}

/** Port of `n8n-workflow` `WorkflowActivationError` (level inference included). */
export class WorkflowActivationError extends Error {
	readonly node: INodeLike | undefined;
	readonly workflowId: string | undefined;
	level: ErrorLevel;

	constructor(message: string, { node, level, workflowId }: WorkflowActivationErrorOptions = {}) {
		// The reference `ApplicationError` accepts a `cause` but does not expose it (`error.cause`
		// stays undefined) — reproduced here on purpose, pinned by gate check T03.
		super(message);
		this.name = 'WorkflowActivationError';
		this.node = node;
		this.workflowId = workflowId;
		this.message = message;
		this.level = level ?? (WARNING_LEVEL_PATTERNS.some((pattern) => message.toLowerCase().includes(pattern)) ? 'warning' : 'error');
	}
}

/** Port of `n8n-workflow` `WorkflowDeactivationError` (a `WorkflowActivationError` subclass). */
export class WorkflowDeactivationError extends WorkflowActivationError {
	constructor(message: string, options: WorkflowActivationErrorOptions = {}) {
		super(message, options);
		this.name = 'WorkflowDeactivationError';
	}
}

export interface TriggerCloseErrorOptions {
	cause?: Error;
	level: ErrorLevel;
}

/** Port of `n8n-workflow` `TriggerCloseError` (carries the node and the level). */
export class TriggerCloseError extends Error {
	readonly node: INodeLike;
	level: ErrorLevel;

	constructor(node: INodeLike, { cause, level }: TriggerCloseErrorOptions) {
		super('Trigger Close Failed', cause ? { cause } : undefined);
		// The reference class does not rename itself, so `name` stays 'Error' — pinned by T03.
		this.node = node;
		this.level = level;
	}
}

/** Port of `n8n-workflow` `UserError` for the one place `ActiveWorkflows` raises it. */
export class TriggerUserError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UserError';
	}
}

/* ------------------------------------------------------------------ */
/* cron expression helper (reference: `workflow/src/cron.ts`)          */
/* ------------------------------------------------------------------ */

export interface TriggerTime {
	mode: 'everyMinute' | 'everyHour' | 'everyX' | 'everyDay' | 'everyWeek' | 'everyMonth' | 'custom';
	minute?: number;
	hour?: number;
	dayOfMonth?: number;
	weekday?: number;
	value?: number;
	unit?: 'minutes' | 'hours';
	cronExpression?: string;
}

/**
 * Port of `n8n-workflow` `utils.randomInt` — crypto based, exactly like the reference (the gate
 * freezes `crypto.getRandomValues` to compare the cron helpers verbatim).
 */
export function randomInt(min: number, max?: number): number {
	if (max === undefined) {
		max = min;
		min = 0;
	}
	return min + (crypto.getRandomValues(new Uint32Array(1))[0] % (max - min));
}

/** Port of `n8n-workflow` `toCronExpression` (seconds — and a minute for `everyX`/hours — random). */
export const toCronExpression = (item: TriggerTime): string => {
	const randomSecond = randomInt(60);

	if (item.mode === 'everyMinute') return `${randomSecond} * * * * *`;
	if (item.mode === 'everyHour') return `${randomSecond} ${item.minute} * * * *`;

	if (item.mode === 'everyX') {
		if (item.unit === 'minutes') return `${randomSecond} */${item.value} * * * *`;
		if (item.unit === 'hours') return `${randomSecond} ${randomInt(60)} */${item.value} * * *`;
	}
	if (item.mode === 'everyDay') return `${randomSecond} ${item.minute} ${item.hour} * * *`;
	if (item.mode === 'everyWeek') return `${randomSecond} ${item.minute} ${item.hour} * * ${item.weekday}`;
	if (item.mode === 'everyMonth') return `${randomSecond} ${item.minute} ${item.hour} ${item.dayOfMonth} * *`;

	return (item.cronExpression ?? '').trim();
};

/* ------------------------------------------------------------------ */
/* activation validation (reference: `workflow/src/workflow-validation.ts`) */
/* ------------------------------------------------------------------ */

export interface TriggerLikeValidation {
	isValid: boolean;
	error?: string;
}

/**
 * Port of `validateWorkflowHasTriggerLikeNode`: a workflow can be activated if at least one enabled
 * node (skipping `ignoreNodeTypes`) has a `trigger`, `poll` or `webhook` handler. Unknown node types
 * are skipped instead of failing.
 */
export function validateWorkflowHasTriggerLikeNode(
	nodes: Record<string, INodeLike>,
	nodeTypes: NodeTypesGetter,
	ignoreNodeTypes?: string[],
): TriggerLikeValidation {
	for (const nodeName of Object.keys(nodes)) {
		const node = nodes[nodeName];

		if (node.disabled === true) continue;
		if (ignoreNodeTypes?.includes(node.type)) continue;

		const nodeType = nodeTypes.getByNameAndVersion(node.type, (node as any).typeVersion);
		if (nodeType === undefined) continue;

		if (nodeType.poll !== undefined || nodeType.trigger !== undefined || nodeType.webhook !== undefined) {
			return { isValid: true };
		}
	}

	return {
		isValid: false,
		error: 'Workflow cannot be activated because it has no trigger node. At least one trigger, webhook, or polling node is required.',
	};
}

/* ------------------------------------------------------------------ */
/* ActiveWorkflows                                                     */
/* ------------------------------------------------------------------ */

export interface LoggerLike {
	debug(message: string, meta?: unknown): void;
	warn(message: string, meta?: unknown): void;
	error(message: string, meta?: unknown): void;
}

export interface ScheduledTaskManagerLike {
	registerCron(ctx: { workflowId: string; timezone: string; nodeId: string; expression: string }, onTick: () => void | Promise<void>): void;
	deregisterCrons(workflowId: string): void;
}

export interface PollingAdapter {
	activate(node: INodeLike, workflow: any, getPollFunctions: (...args: any[]) => any, mode: string, activation: string): Promise<void>;
}

export interface TriggerEngineOptions {
	logger?: Partial<LoggerLike>;
	scheduledTaskManager?: ScheduledTaskManagerLike;
	triggersAndPollers?: { runTrigger(...args: any[]): Promise<TriggerResponse | undefined> };
	errorReporter?: { error(error: Error, options?: unknown): void };
	/** Scheduling of poll nodes belongs to the Scheduler LEGO (deviation, not a gap). */
	polling?: PollingAdapter;
}

const silentLogger: LoggerLike = { debug: () => {}, warn: () => {}, error: () => {} };

export class TriggerEngine {
	/** Plain object (not a Map): the reference returns `Object.keys(...)`, so integer-like ids sort first. */
	private activeWorkflows: Record<string, ActiveWorkflowData> = {};

	private readonly logger: LoggerLike;

	private readonly scheduledTaskManager: ScheduledTaskManagerLike;

	private readonly triggersAndPollers: TriggerEngineOptions['triggersAndPollers'];

	private readonly errorReporter: { error(error: Error, options?: unknown): void };

	private readonly polling: PollingAdapter | undefined;

	constructor(options: TriggerEngineOptions = {}) {
		this.logger = { ...silentLogger, ...(options.logger ?? {}) } as LoggerLike;
		this.scheduledTaskManager = options.scheduledTaskManager ?? { registerCron: () => {}, deregisterCrons: () => {} };
		this.triggersAndPollers = options.triggersAndPollers;
		this.errorReporter = options.errorReporter ?? { error: () => {} };
		this.polling = options.polling;
	}

	isActive(workflowId: string): boolean {
		return Object.prototype.hasOwnProperty.call(this.activeWorkflows, workflowId);
	}

	/** Reference name. `Object.keys` ordering is intentional (see the field comment). */
	allActiveWorkflows(): string[] {
		return Object.keys(this.activeWorkflows);
	}

	get(workflowId: string): ActiveWorkflowData | undefined {
		return this.activeWorkflows[workflowId];
	}

	/**
	 * Port of `ActiveWorkflows.add`. Note the reference semantics: re-adding an already active
	 * workflow is allowed (the triggers are started again and the entry is replaced), and a workflow
	 * without trigger nodes is stored with an empty response list instead of throwing.
	 */
	async add(
		workflowId: string,
		workflow: { getTriggerNodes(): INodeLike[]; getPollNodes(): INodeLike[] },
		_additionalData?: unknown,
		mode = 'trigger',
		activation = 'activate',
		getTriggerFunctions?: (...args: any[]) => any,
		getPollFunctions?: (...args: any[]) => any,
	): Promise<void> {
		const triggerNodes = workflow.getTriggerNodes();
		const triggerResponses: TriggerResponse[] = [];

		for (const triggerNode of triggerNodes) {
			try {
				const response = await this.triggersAndPollers?.runTrigger(workflow, triggerNode, getTriggerFunctions, _additionalData, mode, activation);
				if (response !== undefined) triggerResponses.push(response);
			} catch (error) {
				const wrapped = error instanceof Error ? error : new Error(`${error}`);
				throw new WorkflowActivationError(`There was a problem activating the workflow: "${wrapped.message}"`, { cause: wrapped, node: triggerNode });
			}
		}

		this.activeWorkflows[workflowId] = { triggerResponses };

		const pollingNodes = workflow.getPollNodes();
		if (pollingNodes.length === 0) return;

		for (const pollNode of pollingNodes) {
			try {
				if (!this.polling) {
					// Delegated to the Scheduler LEGO; without an adapter the node is simply noted.
					this.logger.debug(`Poll node "${pollNode.name}" left to the Scheduler LEGO`);
					continue;
				}
				await this.polling.activate(pollNode, workflow, getPollFunctions as any, mode, activation);
			} catch (error) {
				if (triggerResponses.length === 0) delete this.activeWorkflows[workflowId];
				const wrapped = error instanceof Error ? error : new Error(`${error}`);
				throw new WorkflowActivationError(`There was a problem activating the workflow: "${wrapped.message}"`, { cause: wrapped, node: pollNode });
			}
		}
	}

	/** Port of `ActiveWorkflows.remove`. */
	async remove(workflowId: string): Promise<boolean> {
		if (!this.isActive(workflowId)) {
			this.logger.warn(`Cannot deactivate already inactive workflow ID "${workflowId}"`);
			return false;
		}

		this.scheduledTaskManager.deregisterCrons(workflowId);

		const entry = this.activeWorkflows[workflowId];
		for (const response of entry.triggerResponses ?? []) {
			await this.closeTrigger(response, workflowId);
		}

		delete this.activeWorkflows[workflowId];
		return true;
	}

	/** Port of `ActiveWorkflows.removeAllTriggerAndPollerBasedWorkflows`. */
	async removeAllTriggerAndPollerBasedWorkflows(): Promise<void> {
		const activeWorkflowIds = Object.keys(this.activeWorkflows);
		if (activeWorkflowIds.length === 0) return;

		for (const workflowId of activeWorkflowIds) {
			await this.remove(workflowId);
		}

		this.logger.debug('Deactivated all trigger- and poller-based workflows', { workflowIds: activeWorkflowIds });
	}

	/** Port of `ActiveWorkflows.closeTrigger`. */
	async closeTrigger(response: TriggerResponse, workflowId: string): Promise<void> {
		if (!response.closeFunction) return;

		try {
			await response.closeFunction();
		} catch (error) {
			if (error instanceof TriggerCloseError) {
				this.logger.error(`There was a problem calling "closeFunction" on "${error.node.name}" in workflow "${workflowId}"`);
				this.errorReporter.error(error, { extra: { workflowId } });
				return;
			}
			const wrapped = error instanceof Error ? error : new Error(`${error}`);
			throw new WorkflowDeactivationError(`Failed to deactivate trigger of workflow ID "${workflowId}": "${wrapped.message}"`, {
				cause: wrapped,
				workflowId,
			});
		}
	}

	/* -------------------------------------------------------------- */
	/* Phase 5 facade adapters — JSON workflows, no node execution      */
	/* -------------------------------------------------------------- */

	/**
	 * Legacy facade entry point: stores an active workflow described by raw JSON. Trigger nodes are
	 * only *counted* (this engine starts no node execution), and — like the reference — a workflow
	 * without trigger nodes is accepted rather than rejected. Validation belongs to
	 * `validateWorkflowHasTriggerLikeNode` (the API layer), not to the registry.
	 */
	async addWorkflow(workflowId: string, workflow: { nodes?: any[]; name?: string; timezone?: string }, mode = 'activate'): Promise<{ triggerCount: number }> {
		const nodes: INodeLike[] = Array.isArray(workflow?.nodes) ? (workflow.nodes as INodeLike[]) : [];
		const triggerLike = (node: INodeLike) => String(node?.type ?? '').toLowerCase().includes('trigger');
		const triggerNodes = nodes.filter(triggerLike);

		await this.add(
			workflowId,
			{
				getTriggerNodes: () => triggerNodes,
				getPollNodes: () => [],
			},
			undefined,
			mode,
			'activate',
		);

		return { triggerCount: triggerNodes.length };
	}

	async removeWorkflow(workflowId: string): Promise<boolean> {
		return await this.remove(workflowId);
	}

	/** Legacy alias of `allActiveWorkflows()`. */
	allActive(): string[] {
		return this.allActiveWorkflows();
	}
}

/* ------------------------------------------------------------------ */
/* Phase 4-13 spec surface (other agent's track) — preserved verbatim  */
/* ------------------------------------------------------------------ */
//
// These exports come from the concurrent "trigger spec" track (invariants T1-T10 documented in
// `packages/trigger-lego/src/model-surface.ts`). They are kept so that track keeps compiling; the
// reference-exact registry above (`TriggerEngine`) is what the facade uses and what
// `npm run trigger:check` verifies against `n8n-core`'s `ActiveWorkflows`.
//
// The two disagreements once documented here (duplicate-activation rejection, silent
// TriggerCloseError swallow) were adjudicated against the reference in Phase 5-07 and the
// spec registry below was ALIGNED: re-add overwrites, close errors are reported. History
// preserved in `docs/isolation/trigger.md` §7.4.

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

export interface TriggerCloseReport {
  error: unknown;
  workflowId: string;
}

/** Spec-track registry (T1-T10). Not used by the facade — see the note above. */
export class ActiveWorkflows {
  private records: Record<string, ActiveRecord> = {};
  private closedEmits: Set<string> = new Set();
  /** Observable report hook — stands in for logger.error + errorReporter.error (active-workflows.ts:220-226). */
  readonly reportedCloseErrors: TriggerCloseReport[] = [];

  get activeIds(): string[] {
    return Object.keys(this.records);
  }

  isActive(workflowId: string): boolean {
    return this.records[workflowId] !== undefined;
  }

  /** T1: kegagalan satu node trigger menggagalkan seluruh aktivasi.
   * Adjudicated Phase 5-07: NO duplicate guard — a second add re-runs and
   * OVERWRITES (active-workflows.ts:70-110); no 'already active' error exists. */
  add(workflowId: string, triggerNodes: string[], startTrigger: (node: string) => TriggerHandle): void {
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

  /** T9+T10: remove unknown = false senyap; TriggerCloseError DILAPORKAN
   * (reportedCloseErrors), error lain -> WorkflowDeactivationError reference-exact
   * (active-workflows.ts:226-234). Adjudicated Phase 5-07. */
  async remove(workflowId: string): Promise<boolean> {
    const record = this.records[workflowId];
    if (!record) return false;
    for (const t of record.triggers) {
      try {
        await t.closeFunction?.();
      } catch (e: any) {
        if (e?.name === 'TriggerCloseError') {
          this.reportedCloseErrors.push({ error: e, workflowId });
        } else {
          const err = new Error(
            `Failed to deactivate trigger of workflow ID "${workflowId}": "${e?.message ?? e}"`,
          );
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
