/**
 * EXECUTION LEGO engine — n8n 2.9.4 execution runtime.
 *
 * Reconstructs the *runtime* half of the execution subsystem (anatomy `05-execution`), 1:1 with
 * the pinned reference:
 *
 *   packages/cli/src/active-executions.ts                       → ActiveExecutions
 *   packages/core/src/execution-engine/active-workflows.ts      → ActiveWorkflows
 *   packages/core/src/execution-engine/execution-context*.ts    → ExecutionContextHookRegistry,
 *                                                                 ExecutionContextService
 *   packages/cli/src/executions/execution-recovery.service.ts    → ExecutionRecoveryService
 *   packages/cli/src/errors/* + packages/workflow/src/errors/*   → error surface (byte-exact)
 *
 * Everything the reference reads from the DI container, the DB, Bull, Redis or the clock is an
 * injected port here (see `contracts/execution.contract.md` §3): the observable semantics are
 * preserved, the transport is replaceable, and the engine stays deterministic under test.
 *
 * Invariants are `X1..X17`; `packages/execution-lego/test/*` and `tools/phase7-isolation-gate.mjs`
 * re-read the reference on every run so a drift fails the build instead of shipping.
 */

/* ------------------------------------------------------------------ *
 * Reference pin
 * ------------------------------------------------------------------ */

export const EXECUTION_REFERENCE = {
	package: 'n8n (cli + core)',
	upstreamCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
	version: '2.9.4',
} as const;

/** `ARTIFICIAL_TASK_DATA` — cli/src/constants.ts (used when recovering an unfinished node). */
export const ARTIFICIAL_TASK_DATA = {
	main: [[{ json: { isArtificialRecoveredEventItem: true }, pairedItem: undefined }]],
} as const;

/** `RecoveryConfig` defaults — @n8n/config executions.config.ts. */
export const WORKFLOW_AUTODEACTIVATION_DEFAULTS = {
	maxLastExecutions: 3,
	workflowDeactivationEnabled: false,
} as const;

/** Delay between "editor UI connected" and the recovery/deactivation push (both services). */
export const PUSH_AFTER_UI_TIMEOUT_MS = 1000;

/* ------------------------------------------------------------------ *
 * Errors — messages and levels byte-exact vs the reference classes
 * ------------------------------------------------------------------ */

export type ErrorLevel = 'warning' | 'error';

export class UnexpectedError extends Error {
	level: ErrorLevel = 'error';
	extra: Record<string, unknown>;
	constructor(message: string, options: { extra?: Record<string, unknown>; level?: ErrorLevel; cause?: unknown } = {}) {
		super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
		this.name = this.constructor.name;
		this.extra = options.extra ?? {};
		if (options.level) this.level = options.level;
	}
}

export class OperationalError extends UnexpectedError {}
export class UserError extends UnexpectedError {}
export class ApplicationError extends UnexpectedError {}

/** cli/src/errors/execution-not-found-error.ts */
export class ExecutionNotFoundError extends UnexpectedError {
	constructor(executionId: string) {
		super('No active execution found', { extra: { executionId } });
	}
}

/** cli/src/errors/execution-already-resuming.error.ts */
export class ExecutionAlreadyResumingError extends OperationalError {
	constructor(executionId: string) {
		super('Execution is already being resumed by another process', { extra: { executionId } });
	}
}

export type CancellationReason = 'manual' | 'timeout' | 'shutdown';

/** packages/workflow/src/errors/execution-cancelled.error.ts */
export class ExecutionCancelledError extends UnexpectedError {
	reason: CancellationReason;
	constructor(executionId: string, reason: CancellationReason) {
		super('The execution was cancelled', { level: 'warning', extra: { executionId } });
		this.reason = reason;
	}
}

export class ManualExecutionCancelledError extends ExecutionCancelledError {
	constructor(executionId: string) {
		super(executionId, 'manual');
		this.message = 'The execution was cancelled manually';
	}
}

export class TimeoutExecutionCancelledError extends ExecutionCancelledError {
	constructor(executionId: string) {
		super(executionId, 'timeout');
		this.message = 'The execution was cancelled because it timed out';
	}
}

export class SystemShutdownExecutionCancelledError extends ExecutionCancelledError {
	constructor(executionId: string) {
		super(executionId, 'shutdown');
		this.message = 'The execution was cancelled because the system is shutting down';
	}
}

/** packages/workflow/src/errors/trigger-close.error.ts */
export class TriggerCloseError extends ApplicationError {
	node: { name: string };
	constructor(node: { name: string }, options: { cause?: unknown; level: ErrorLevel }) {
		super('Trigger Close Failed', { cause: options.cause, extra: { nodeName: node.name } });
		this.node = node;
		this.level = options.level;
	}
}

/** packages/workflow/src/errors/workflow-activation.error.ts (including the level heuristic) */
export class WorkflowActivationError extends UnexpectedError {
	node: { name: string } | undefined;
	workflowId: string | undefined;
	constructor(
		message: string,
		options: { cause?: unknown; node?: { name: string }; level?: ErrorLevel; workflowId?: string } = {},
	) {
		super(message, { cause: options.cause });
		this.node = options.node;
		this.workflowId = options.workflowId;
		this.message = message;
		this.setLevel(options.level);
	}

	private setLevel(level?: ErrorLevel) {
		if (level) {
			this.level = level;
			return;
		}
		const lowered = this.message.toLowerCase();
		if (
			[
				'etimedout', // Node.js
				'econnrefused', // Node.js
				'eauth', // OAuth
				'temporary authentication failure', // IMAP server
				'invalid credentials',
			].some((str) => lowered.includes(str))
		) {
			this.level = 'warning';
			return;
		}
		this.level = 'error';
	}
}

export class WorkflowDeactivationError extends WorkflowActivationError {}

/** cli/src/errors/node-crashed.error.ts */
export class NodeCrashedError extends UnexpectedError {
	node: { name: string };
	description: string;
	constructor(node: { name: string }) {
		super('Node crashed, possible out-of-memory issue');
		this.node = node;
		this.message = 'Execution stopped at this node';
		this.description =
			"n8n may have run out of memory while running this execution. More context and tips on how to avoid this <a href='https://docs.n8n.io/hosting/scaling/memory-errors/' target='_blank'>in the docs</a>";
	}
}

/** cli/src/errors/workflow-crashed.error.ts */
export class WorkflowCrashedError extends UnexpectedError {
	constructor() {
		super('Workflow did not finish, possible out-of-memory issue');
	}
}

/* ------------------------------------------------------------------ *
 * Small utilities (ports that keep the engine deterministic)
 * ------------------------------------------------------------------ */

export type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
};

export const createDeferred = <T>(): Deferred<T> => {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
};

/** cli/src/utils.ts — `isWorkflowIdValid` (X8) */
export function isWorkflowIdValid(id: string | null | undefined): boolean {
	return typeof id === 'string' && id.length > 0 && id.length <= 21;
}

export type Logger = {
	debug: (message: string, meta?: unknown) => void;
	info: (message: string, meta?: unknown) => void;
	warn: (message: string, meta?: unknown) => void;
	error: (message: string, meta?: unknown) => void;
};

export const noopLogger: Logger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

/** Collecting logger used by tests and by the isolation gate evidence. */
export function createRecordingLogger(): Logger & { lines: string[] } {
	const lines: string[] = [];
	const push = (level: string) => (message: string) => {
		lines.push(`${level}: ${message}`);
	};
	return { lines, debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') };
}

type Listener = (...args: unknown[]) => void;

/** Minimal `EventEmitter` port (`EventService` / `Push` in the reference). */
export class Emitter {
	private handlers = new Map<string, Listener[]>();

	on(event: string, handler: Listener) {
		const list = this.handlers.get(event) ?? [];
		list.push(handler);
		this.handlers.set(event, list);
	}

	once(event: string, handler: Listener) {
		const wrapped: Listener = (...args) => {
			this.off(event, wrapped);
			handler(...args);
		};
		this.on(event, wrapped);
	}

	off(event: string, handler: Listener) {
		this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== handler));
	}

	emit(event: string, ...args: unknown[]) {
		for (const handler of [...(this.handlers.get(event) ?? [])]) handler(...args);
	}

	listenerCount(event: string) {
		return (this.handlers.get(event) ?? []).length;
	}
}

/* ------------------------------------------------------------------ *
 * Ports (fakes/adapters live with the caller; these are the memory ones)
 * ------------------------------------------------------------------ */

export type ExecutionStatus = 'new' | 'running' | 'success' | 'error' | 'waiting' | 'canceled' | 'crashed';

export type ExecutionRow = {
	id: string;
	workflowId: string;
	status: ExecutionStatus;
	mode: string;
	startedAt: Date;
	stoppedAt?: Date | null;
	waitTill?: Date | null;
	data?: unknown;
	retryOf?: string | null;
	finished?: boolean;
};

/** `ExecutionRepository` subset used by the execution runtime. */
export interface ExecutionRepositoryPort {
	setRunning(executionId: string): Promise<void> | void;
	updateExistingExecution(
		executionId: string,
		payload: Partial<ExecutionRow>,
		options?: { requireStatus?: ExecutionStatus },
	): Promise<boolean> | boolean;
	exists(options: { where: { id: string } }): Promise<boolean> | boolean;
	findSingleExecution(
		executionId: string,
		options?: { includeData?: boolean },
	): Promise<ExecutionRow | null> | ExecutionRow | null;
	findMultipleExecutions(options: {
		select: string[];
		where: { workflowId: string };
		order: Record<string, 'DESC' | 'ASC'>;
		take: number;
	}): Promise<ExecutionRow[]> | ExecutionRow[];
	update(
		where: { workflowId?: string; status?: ExecutionStatus | { $in: ExecutionStatus[] } },
		patch: Partial<ExecutionRow>,
	): Promise<number> | number;
	markAsCrashed(executionId: string): Promise<void> | void;
}

/** `ExecutionPersistence` subset. */
export interface ExecutionPersistencePort {
	create(payload: Record<string, unknown>): Promise<string> | string;
}

/** `WorkflowRepository` subset used for auto-deactivation. */
export interface WorkflowRepositoryPort {
	findOne(options: { where: { id: string } }): Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
	updateActiveState(workflowId: string, active: boolean): Promise<void> | void;
}

/** `ConcurrencyControlService` subset (capacity reservations). */
export interface ConcurrencyControlPort {
	reserve(options: { mode: string; executionId: string }): Promise<void> | void;
	release(): void;
	disable(): void;
	removeAll(executionIds: string[]): Promise<void> | void;
}

export class MemoryExecutionRepository implements ExecutionRepositoryPort {
	rows = new Map<string, ExecutionRow>();

	constructor(seed: ExecutionRow[] = []) {
		for (const row of seed) this.rows.set(row.id, { ...row });
	}

	get(executionId: string): ExecutionRow {
		const row = this.rows.get(executionId);
		if (!row) throw new Error(`unknown execution ${executionId}`);
		return row;
	}

	setRunning(executionId: string) {
		this.get(executionId).status = 'running';
	}

	updateExistingExecution(
		executionId: string,
		payload: Partial<ExecutionRow>,
		options: { requireStatus?: ExecutionStatus } = {},
	) {
		const row = this.rows.get(executionId);
		if (!row) return false;
		if (options.requireStatus && row.status !== options.requireStatus) return false;
		Object.assign(row, payload, { id: executionId, waitTill: payload.waitTill ?? null });
		return true;
	}

	exists(options: { where: { id: string } }) {
		return this.rows.has(options.where.id);
	}

	findSingleExecution(executionId: string) {
		return this.rows.get(executionId) ?? null;
	}

	findMultipleExecutions(options: { where: { workflowId: string }; take: number }) {
		return [...this.rows.values()]
			.filter((row) => row.workflowId === options.where.workflowId)
			.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
			.slice(0, options.take);
	}

	update(where: { workflowId?: string; status?: ExecutionStatus | { $in: ExecutionStatus[] } }, patch: Partial<ExecutionRow>) {
		let updated = 0;
		for (const row of this.rows.values()) {
			if (where.workflowId && row.workflowId !== where.workflowId) continue;
			if (where.status) {
				const expected = Array.isArray(where.status)
					? where.status
					: '$in' in where.status
						? where.status.$in
						: [where.status];
				if (!expected.includes(row.status)) continue;
			}
			Object.assign(row, patch);
			updated++;
		}
		return updated;
	}

	markAsCrashed(executionId: string | string[]) {
		const ids = Array.isArray(executionId) ? executionId : [executionId];
		for (const id of ids) {
			const row = this.rows.get(id);
			if (row) row.status = 'crashed';
		}
	}
}

export class MemoryExecutionPersistence implements ExecutionPersistencePort {
	rows: Record<string, unknown>[] = [];
	private counter = 0;
	/** When given a repository the created row is visible to it, like the reference's DB write. */
	private repository?: MemoryExecutionRepository;

	constructor(repository?: MemoryExecutionRepository) {
		this.repository = repository;
	}

	create(payload: Record<string, unknown>) {
		const id = `exec-${++this.counter}`;
		const row = { id, ...payload };
		this.rows.push(row);
		if (this.repository) {
			this.repository.rows.set(id, {
				id,
				workflowId: String(payload.workflowId ?? ''),
				status: (payload.status as ExecutionStatus) ?? 'new',
				mode: String(payload.mode ?? 'trigger'),
				startedAt: new Date(),
				data: payload.data,
				retryOf: (payload.retryOf as string | null) ?? null,
				finished: Boolean(payload.finished),
			});
		}
		return id;
	}
}

export class MemoryWorkflowRepository implements WorkflowRepositoryPort {
	private workflows = new Map<string, Record<string, unknown>>();

	constructor(seed: Record<string, unknown>[] = []) {
		for (const workflow of seed) this.workflows.set(String(workflow.id), { ...workflow });
	}

	findOne(options: { where: { id: string } }) {
		return this.workflows.get(options.where.id) ?? null;
	}

	updateActiveState(workflowId: string, active: boolean) {
		const workflow = this.workflows.get(workflowId);
		if (workflow) workflow.active = active;
	}
}

export class MemoryConcurrencyControl implements ConcurrencyControlPort {
	reservations: string[] = [];
	disabled = false;

	reserve(options: { executionId: string }) {
		this.reservations.push(options.executionId);
	}

	release() {
		this.reservations.pop();
	}

	disable() {
		this.disabled = true;
	}

	removeAll(executionIds: string[]) {
		this.reservations = this.reservations.filter((id) => !executionIds.includes(id));
	}
}

/* ------------------------------------------------------------------ *
 * ActiveExecutions — cli/src/active-executions.ts
 * ------------------------------------------------------------------ */

export type IWorkflowExecutionDataProcess = {
	executionMode: string;
	workflowData: { id?: string; name?: string; nodes?: unknown[] };
	executionData?: unknown;
	retryOf?: string | null;
	httpResponse?: { write: (chunk: string) => void; flush?: () => void; end: () => void } | undefined;
};

export type IExecutingWorkflowData = {
	executionData: IWorkflowExecutionDataProcess;
	startedAt: Date;
	postExecutePromise: Deferred<unknown>;
	status: ExecutionStatus;
	responsePromise?: Deferred<unknown>;
	httpResponse?: IWorkflowExecutionDataProcess['httpResponse'];
	workflowExecution?: { cancel: () => void };
};

export type ExecutionsCurrentSummary = {
	id: string;
	retryOf?: string;
	startedAt: Date;
	mode: string;
	workflowId?: string;
	status: ExecutionStatus;
};

export type ActiveExecutionsOptions = {
	logger?: Logger;
	executionRepository: ExecutionRepositoryPort;
	executionPersistence: ExecutionPersistencePort;
	concurrencyControl?: ConcurrencyControlPort;
	eventService?: Emitter;
	executionsConfig?: { mode: 'regular' | 'queue' };
	sleep?: (ms: number) => Promise<void>;
};

export class ActiveExecutions {
	private activeExecutions: Record<string, IExecutingWorkflowData> = {};
	private responseModes = new Map<string, string>();
	private logger: Logger;
	private executionRepository: ExecutionRepositoryPort;
	private executionPersistence: ExecutionPersistencePort;
	private concurrencyControl: ConcurrencyControlPort;
	private eventService: Emitter;
	private executionsConfig: { mode: 'regular' | 'queue' };
	private sleep: (ms: number) => Promise<void>;

	constructor(options: ActiveExecutionsOptions) {
		this.logger = options.logger ?? noopLogger;
		this.executionRepository = options.executionRepository;
		this.executionPersistence = options.executionPersistence;
		this.concurrencyControl = options.concurrencyControl ?? new MemoryConcurrencyControl();
		this.eventService = options.eventService ?? new Emitter();
		this.executionsConfig = options.executionsConfig ?? { mode: 'regular' };
		this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
	}

	has(executionId: string) {
		return this.activeExecutions[executionId] !== undefined;
	}

	/** X1/X2 — add a new execution (or resume a waiting one). */
	async add(executionData: IWorkflowExecutionDataProcess, maybeExecutionId?: string): Promise<string> {
		let executionStatus: ExecutionStatus = maybeExecutionId ? 'running' : 'new';
		const mode = executionData.executionMode;

		try {
			if (maybeExecutionId === undefined) {
				const fullExecutionData: Record<string, unknown> = {
					data: executionData.executionData,
					mode,
					finished: false,
					workflowData: executionData.workflowData,
					status: executionStatus,
					workflowId: executionData.workflowData.id,
					retryOf: executionData.retryOf ?? undefined,
				};

				const workflowId = executionData.workflowData.id;
				if (workflowId !== undefined && isWorkflowIdValid(workflowId)) {
					fullExecutionData.workflowId = workflowId;
				}

				maybeExecutionId = await this.executionPersistence.create(fullExecutionData);
				if (!maybeExecutionId) throw new Error('Failed to create execution');

				await this.concurrencyControl.reserve({ mode, executionId: maybeExecutionId });

				if (this.executionsConfig.mode === 'regular') {
					await this.executionRepository.setRunning(maybeExecutionId);
				}
				executionStatus = 'running';
			} else {
				await this.concurrencyControl.reserve({ mode, executionId: maybeExecutionId });

				const execution: Partial<ExecutionRow> = {
					id: maybeExecutionId,
					data: executionData.executionData,
					waitTill: null,
					status: executionStatus,
				};
				const updateSucceeded = await this.executionRepository.updateExistingExecution(maybeExecutionId, execution, {
					requireStatus: 'waiting',
				});

				if (!updateSucceeded) {
					// Another process is already resuming this execution
					throw new ExecutionAlreadyResumingError(maybeExecutionId);
				}
			}
		} catch (error) {
			this.concurrencyControl.release();
			throw error;
		}

		const executionId = maybeExecutionId;
		const resumingExecution = this.activeExecutions[executionId];
		const postExecutePromise = createDeferred<unknown>();

		const execution: IExecutingWorkflowData = {
			executionData,
			startedAt: resumingExecution?.startedAt ?? new Date(),
			postExecutePromise,
			status: executionStatus,
			responsePromise: resumingExecution?.responsePromise,
			httpResponse: executionData.httpResponse ?? undefined,
		};
		this.activeExecutions[executionId] = execution;

		// Automatically remove execution once the postExecutePromise settles (X4)
		void postExecutePromise.promise
			.catch((error) => {
				if (error instanceof ExecutionCancelledError) return;
				throw error;
			})
			.finally(() => {
				this.concurrencyControl.release();
				if (execution.status === 'waiting') {
					// Do not hold on a reference to the previous WorkflowExecute instance
					delete execution.workflowExecution;
				} else {
					delete this.activeExecutions[executionId];
					this.responseModes.delete(executionId);
					this.logger.debug('Execution removed', { executionId });
				}
			});
		// the rejection above is observed by callers through getPostExecutePromise
		postExecutePromise.promise.catch(() => {});

		this.logger.debug('Execution added', { executionId });

		return executionId;
	}

	attachWorkflowExecution(executionId: string, workflowExecution: { cancel: () => void }) {
		this.getExecutionOrFail(executionId).workflowExecution = workflowExecution;
	}

	attachResponsePromise(executionId: string, responsePromise: Deferred<unknown>) {
		this.getExecutionOrFail(executionId).responsePromise = responsePromise;
	}

	resolveResponsePromise(executionId: string, response: unknown) {
		const execution = this.activeExecutions[executionId];
		execution?.responsePromise?.resolve(response);
	}

	sendChunk(executionId: string, chunkText: unknown) {
		const execution = this.activeExecutions[executionId];
		if (execution?.httpResponse) {
			execution.httpResponse.write(`${JSON.stringify(chunkText)}\n`);
			execution.httpResponse.flush?.();
		}
	}

	/** X5 — cancel an execution; unknown ids are a no-op. */
	stopExecution(executionId: string, cancellationError: ExecutionCancelledError) {
		const execution = this.activeExecutions[executionId];
		if (execution === undefined) {
			// There is no execution running with that id
			return;
		}

		this.logger.debug('Cancelling execution', { executionId, reason: cancellationError.reason });

		const workflowData = execution.executionData.workflowData;
		this.eventService.emit('execution-cancelled', {
			executionId,
			workflowId: workflowData?.id,
			workflowName: workflowData?.name,
			reason: cancellationError.reason,
		});
		execution.responsePromise?.reject(cancellationError);
		if (execution.status === 'waiting') {
			// A waiting execution has no valid workflowExecution / postExecutePromise to settle
			delete this.activeExecutions[executionId];
			this.responseModes.delete(executionId);
		} else {
			execution.workflowExecution?.cancel();
			execution.postExecutePromise.reject(cancellationError);
		}
		this.logger.debug('Execution cancelled', { executionId });
	}

	/** X6 — resolve the post-execution promise; missing id is a no-op. */
	finalizeExecution(executionId: string, fullRunData?: unknown) {
		if (!this.has(executionId)) return;
		const execution = this.getExecutionOrFail(executionId);

		if (execution.executionData.httpResponse) {
			try {
				this.logger.debug('Closing response for execution', { executionId });
				execution.executionData.httpResponse.end();
			} catch (error) {
				this.logger.error('Error closing streaming response', {
					executionId,
					error: (error as Error).message,
				});
			}
		}

		execution.postExecutePromise.resolve(fullRunData);
		this.logger.debug('Execution finalized', { executionId });
	}

	resolveExecutionResponsePromise(executionId: string) {
		if (!this.has(executionId)) return;
		const execution = this.getExecutionOrFail(executionId);

		if (execution.status !== 'waiting' && execution.responsePromise) {
			execution.responsePromise.resolve({});
			this.logger.debug('Execution response promise cleaned', { executionId });
		}
	}

	async getPostExecutePromise(executionId: string): Promise<unknown> {
		return await this.getExecutionOrFail(executionId).postExecutePromise.promise;
	}

	/** X3 — summary shape of everything active in this process. */
	getActiveExecutions(): ExecutionsCurrentSummary[] {
		const returnData: ExecutionsCurrentSummary[] = [];

		for (const id of Object.keys(this.activeExecutions)) {
			const data = this.activeExecutions[id];
			returnData.push({
				id,
				retryOf: data.executionData.retryOf ?? undefined,
				startedAt: data.startedAt,
				mode: data.executionData.executionMode,
				workflowId: data.executionData.workflowData.id,
				status: data.status,
			});
		}

		return returnData;
	}

	setStatus(executionId: string, status: ExecutionStatus) {
		this.getExecutionOrFail(executionId).status = status;
	}

	getStatus(executionId: string): ExecutionStatus {
		return this.getExecutionOrFail(executionId).status;
	}

	setResponseMode(executionId: string, responseMode: string) {
		this.responseModes.set(executionId, responseMode);
	}

	getResponseMode(executionId: string): string | undefined {
		return this.responseModes.get(executionId);
	}

	/** X7 — wait for all active executions to finish (optionally cancelling every one). */
	async shutdown(cancelAll = false) {
		const isRegularMode = this.executionsConfig.mode === 'regular';
		if (isRegularMode) {
			this.concurrencyControl.disable();
		}

		let executionIds = Object.keys(this.activeExecutions);
		const toCancel: string[] = [];
		for (const executionId of executionIds) {
			const { status } = this.activeExecutions[executionId];
			if (isRegularMode && cancelAll) {
				this.stopExecution(executionId, new SystemShutdownExecutionCancelledError(executionId));
				toCancel.push(executionId);
			} else if (status === 'waiting' || status === 'new') {
				delete this.activeExecutions[executionId];
			}
		}

		await this.concurrencyControl.removeAll(toCancel);

		let count = 0;
		executionIds = Object.keys(this.activeExecutions);
		while (executionIds.length !== 0) {
			if (count++ % 4 === 0) {
				this.logger.info(`Waiting for ${executionIds.length} active executions to finish...`);
			}

			await this.sleep(500);
			executionIds = Object.keys(this.activeExecutions);
		}
	}

	getExecutionOrFail(executionId: string): IExecutingWorkflowData {
		const execution = this.activeExecutions[executionId];
		if (!execution) {
			throw new ExecutionNotFoundError(executionId);
		}
		return execution;
	}
}

/* ------------------------------------------------------------------ *
 * ActiveWorkflows — packages/core/src/execution-engine/active-workflows.ts
 * ------------------------------------------------------------------ */

export type TriggerNode = { name: string; type?: string; id?: string; parameters?: Record<string, unknown> };
export type TriggerWorkflow = {
	id: string;
	name?: string;
	timezone?: string;
	getTriggerNodes: () => TriggerNode[];
	getPollNodes: () => TriggerNode[];
	getNode: (name: string) => { parameters?: Record<string, unknown> } | null;
};
export type TriggerResponse = { closeFunction?: () => Promise<void> | void };

export type ActiveWorkflowsOptions = {
	logger?: Logger;
	scheduledTaskManager?: { registerCron: (ctx: unknown, fn: () => Promise<void>) => void; deregisterCrons: (workflowId: string) => void };
	triggersAndPollers?: {
		runTrigger: (
			workflow: TriggerWorkflow,
			node: TriggerNode,
			additionalData: unknown,
			mode: string,
			activation: string,
		) => Promise<TriggerResponse | undefined>;
		runPoll: (workflow: TriggerWorkflow, node: TriggerNode, pollFunctions: PollFunctions) => Promise<unknown>;
	};
	getTriggerFunctions?: (workflow: TriggerWorkflow, node: TriggerNode, data: unknown, mode: string, activation: string) => TriggerFunctions;
	getPollFunctions?: (workflow: TriggerWorkflow, node: TriggerNode, data: unknown, mode: string, activation: string) => PollFunctions;
	toCronExpression?: (triggerTime: unknown) => string;
	errorReporter?: { error: (error: unknown, options?: unknown) => void };
};

export type TriggerFunctions = { __emit: (data: unknown) => void };
export type PollFunctions = { getNodeParameter: (name: string) => unknown; __emit: (data: unknown) => void; __emitError: (error: Error) => void };

export class ActiveWorkflows {
	private activeWorkflows: Record<string, { triggerResponses: TriggerResponse[] }> = {};
	private logger: Logger;
	private scheduledTaskManager: ActiveWorkflowsOptions['scheduledTaskManager'];
	private triggersAndPollers: ActiveWorkflowsOptions['triggersAndPollers'];
	private getTriggerFunctions: ActiveWorkflowsOptions['getTriggerFunctions'];
	private getPollFunctions: ActiveWorkflowsOptions['getPollFunctions'];
	private toCronExpression: (triggerTime: unknown) => string;
	private errorReporter: { error: (error: unknown, options?: unknown) => void };
	emittedPolls: unknown[] = [];

	constructor(options: ActiveWorkflowsOptions = {}) {
		this.logger = options.logger ?? noopLogger;
		this.scheduledTaskManager = options.scheduledTaskManager ?? { registerCron: () => {}, deregisterCrons: () => {} };
		this.triggersAndPollers =
			options.triggersAndPollers ??
			({
				runTrigger: async () => undefined,
				runPoll: async () => null,
			} as NonNullable<ActiveWorkflowsOptions['triggersAndPollers']>);
		this.getTriggerFunctions =
			options.getTriggerFunctions ?? (() => ({ __emit: () => {} }));
		this.getPollFunctions =
			options.getPollFunctions ??
			(() => ({ getNodeParameter: () => ({ item: [] }), __emit: () => {}, __emitError: () => {} }));
		this.toCronExpression = options.toCronExpression ?? ((triggerTime: unknown) => String((triggerTime as { expression?: string })?.expression ?? ''));
		this.errorReporter = options.errorReporter ?? { error: () => {} };
	}

	/** Returns if the workflow is active in memory. */
	isActive(workflowId: string) {
		return Object.prototype.hasOwnProperty.call(this.activeWorkflows, workflowId);
	}

	allActiveWorkflows() {
		return Object.keys(this.activeWorkflows);
	}

	get(workflowId: string) {
		return this.activeWorkflows[workflowId];
	}

	/** X9/X10/X11 — activate triggers and pollers. */
	async add(
		workflowId: string,
		workflow: TriggerWorkflow,
		additionalData: unknown,
		mode: string,
		activation: string,
	) {
		const triggerNodes = workflow.getTriggerNodes();
		const triggerResponses: TriggerResponse[] = [];

		for (const triggerNode of triggerNodes) {
			try {
				const triggerResponse = await this.triggersAndPollers!.runTrigger(
					workflow,
					triggerNode,
					additionalData,
					mode,
					activation,
				);
				if (triggerResponse !== undefined) {
					triggerResponses.push(triggerResponse);
				}
			} catch (e) {
				const error = e instanceof Error ? e : new Error(`${e}`);

				throw new WorkflowActivationError(`There was a problem activating the workflow: "${error.message}"`, {
					cause: error,
					node: triggerNode,
				});
			}
		}

		this.activeWorkflows[workflowId] = { triggerResponses };

		const pollingNodes = workflow.getPollNodes();
		if (pollingNodes.length === 0) return;

		for (const pollNode of pollingNodes) {
			try {
				await this.activatePolling(pollNode, workflow, additionalData, mode, activation);
			} catch (e) {
				// Do not mark this workflow as active if there are no triggerResponses and any polling activation failed
				if (triggerResponses.length === 0) {
					delete this.activeWorkflows[workflowId];
				}

				const error = e instanceof Error ? e : new Error(`${e}`);

				throw new WorkflowActivationError(`There was a problem activating the workflow: "${error.message}"`, {
					cause: error,
					node: pollNode,
				});
			}
		}
	}

	private async activatePolling(
		node: TriggerNode,
		workflow: TriggerWorkflow,
		additionalData: unknown,
		mode: string,
		activation: string,
	): Promise<void> {
		const pollFunctions = this.getPollFunctions!(workflow, node, additionalData, mode, activation);

		const pollTimes = pollFunctions.getNodeParameter('pollTimes') as { item: unknown[] };
		const cronExpressions = (pollTimes.item || []).map((triggerTime) => this.toCronExpression(triggerTime));
		const executeTrigger = this.createPollExecuteFn(workflow, node, pollFunctions);

		// Execute the trigger directly to be able to know if it works
		await executeTrigger(true);

		for (const expression of cronExpressions) {
			if (expression.split(' ').at(0)?.includes('*')) {
				throw new UserError('The polling interval is too short. It has to be at least a minute.');
			}

			const ctx = {
				workflowId: workflow.id,
				timezone: workflow.timezone,
				nodeId: node.id,
				expression,
			};

			this.scheduledTaskManager!.registerCron(ctx, executeTrigger);
		}
	}

	/** X12 — deactivate a workflow. */
	async remove(workflowId: string) {
		if (!this.isActive(workflowId)) {
			this.logger.warn(`Cannot deactivate already inactive workflow ID "${workflowId}"`);
			return false;
		}

		this.scheduledTaskManager!.deregisterCrons(workflowId);

		const w = this.activeWorkflows[workflowId];
		for (const r of w.triggerResponses ?? []) {
			await this.closeTrigger(r, workflowId);
		}

		delete this.activeWorkflows[workflowId];

		return true;
	}

	async removeAllTriggerAndPollerBasedWorkflows() {
		const activeWorkflowIds = Object.keys(this.activeWorkflows);

		if (activeWorkflowIds.length === 0) return;

		for (const workflowId of activeWorkflowIds) {
			await this.remove(workflowId);
		}

		this.logger.debug('Deactivated all trigger- and poller-based workflows', { workflowIds: activeWorkflowIds });
	}

	private async closeTrigger(response: TriggerResponse, workflowId: string) {
		if (!response.closeFunction) return;

		try {
			await response.closeFunction();
		} catch (e) {
			if (e instanceof TriggerCloseError) {
				this.logger.error(`There was a problem calling "closeFunction" on "${e.node.name}" in workflow "${workflowId}"`);
				this.errorReporter.error(e, { extra: { workflowId } });
				return;
			}

			const error = e instanceof Error ? e : new Error(`${e}`);

			throw new WorkflowDeactivationError(
				`Failed to deactivate trigger of workflow ID "${workflowId}": "${error.message}"`,
				{ cause: error, workflowId },
			);
		}
	}

	private createPollExecuteFn(workflow: TriggerWorkflow, node: TriggerNode, pollFunctions: PollFunctions) {
		return async (testingTrigger = false): Promise<void> => {
			this.logger.debug(`Polling trigger initiated for workflow "${workflow.name}"`, {
				workflowName: workflow.name,
				workflowId: workflow.id,
			});

			try {
				const pollResponse = await this.triggersAndPollers!.runPoll(workflow, node, pollFunctions);

				if (pollResponse !== null) {
					pollFunctions.__emit(pollResponse);
					this.emittedPolls.push(pollResponse);
				}
			} catch (error) {
				// If the poll function fails in the first activation
				// throw the error back so we let the user know there is an issue with the trigger.
				if (testingTrigger) {
					throw error;
				}
				pollFunctions.__emitError(error as Error);
			}
		};
	}
}

/* ------------------------------------------------------------------ *
 * Execution context hooks — core/src/execution-engine/execution-context*.ts
 * ------------------------------------------------------------------ */

export type ContextEstablishmentHook = {
	hookDescription: { name: string };
	init?: () => Promise<void> | void;
	isApplicableToTriggerNode: (triggerType: string) => boolean;
	execute: (options: {
		triggerNode: { name: string };
		workflow: unknown;
		triggerItems: unknown[] | null;
		context: Record<string, unknown>;
		options: unknown;
	}) => Promise<{ triggerItems?: unknown[]; contextUpdate?: Record<string, unknown> }>;
};

export class ExecutionContextHookRegistry {
	hookMap = new Map<string, ContextEstablishmentHook>();
	private hookClasses: Array<new () => ContextEstablishmentHook>;
	private logger: Logger;

	constructor(options: { hooks?: Array<new () => ContextEstablishmentHook>; logger?: Logger } = {}) {
		this.hookClasses = options.hooks ?? [];
		this.logger = options.logger ?? noopLogger;
	}

	/** X13 — (re)load every decorated hook; first registration wins. */
	async init() {
		this.hookMap.clear();

		this.logger.debug(`Registering ${this.hookClasses.length} execution context hooks.`);

		for (const HookClass of this.hookClasses) {
			let hook: ContextEstablishmentHook;
			try {
				hook = new HookClass();
			} catch (error) {
				this.logger.error(
					`Failed to instantiate execution context hook class "${HookClass.name}": ${(error as Error).message}`,
				);
				continue;
			}

			if (this.hookMap.has(hook.hookDescription.name)) {
				this.logger.warn(
					`Execution context hook with name "${hook.hookDescription.name}" is already registered. Conflicting classes are "${this.hookMap.get(hook.hookDescription.name)?.constructor.name}" and "${HookClass.name}". Skipping the latter.`,
				);
				continue;
			}

			if (hook.init) {
				try {
					await hook.init();
				} catch (error) {
					this.logger.error(
						`Failed to initialize execution context hook "${hook.hookDescription.name}": ${(error as Error).message}`,
					);
					continue;
				}
			}

			this.hookMap.set(hook.hookDescription.name, hook);
		}
	}

	getHookByName(name: string) {
		return this.hookMap.get(name);
	}

	getAllHooks() {
		return Array.from(this.hookMap.values());
	}

	getHookForTriggerType(triggerType: string) {
		return Array.from(this.hookMap.values()).filter((hook) => hook.isApplicableToTriggerNode(triggerType));
	}
}

export type ExecutionContextCipher = {
	encrypt: (value: unknown) => unknown;
	decrypt: (value: unknown) => unknown;
};

export const deepMerge = <T extends Record<string, unknown>>(target: T, source: Partial<T>): T => {
	const output = { ...target } as Record<string, unknown>;
	for (const [key, value] of Object.entries(source ?? {})) {
		const current = output[key];
		if (
			value !== null &&
			typeof value === 'object' &&
			!Array.isArray(value) &&
			current !== null &&
			typeof current === 'object' &&
			!Array.isArray(current)
		) {
			output[key] = deepMerge(current as Record<string, unknown>, value as Record<string, unknown>);
		} else if (value !== undefined) {
			output[key] = value;
		}
	}
	return output as T;
};

export type ExecutionContextServiceOptions = {
	logger?: Logger;
	registry: ExecutionContextHookRegistry;
	cipher?: ExecutionContextCipher;
	toHookParameters?: (parameters: Record<string, unknown>) =>
		| { data: { contextEstablishmentHooks: { hooks: Array<{ hookName: string; isAllowedToFail?: boolean }> } } }
		| { error: Error }
		| undefined;
	toCredentialContext?: (decrypted: unknown) => unknown;
};

export class ExecutionContextService {
	private logger: Logger;
	private executionContextHookRegistry: ExecutionContextHookRegistry;
	private cipher: ExecutionContextCipher;
	private toHookParameters: NonNullable<ExecutionContextServiceOptions['toHookParameters']>;
	private toCredentialContext: (decrypted: unknown) => unknown;

	constructor(options: ExecutionContextServiceOptions) {
		this.logger = options.logger ?? noopLogger;
		this.executionContextHookRegistry = options.registry;
		this.cipher = options.cipher ?? { encrypt: (value) => value, decrypt: (value) => value };
		this.toHookParameters =
			options.toHookParameters ??
			((parameters: Record<string, unknown>) => ({
				data: {
					contextEstablishmentHooks: {
						hooks: (parameters.contextEstablishmentHooks as { hooks?: unknown[] })?.hooks ?? [],
					},
				},
			}));
		this.toCredentialContext = options.toCredentialContext ?? ((decrypted) => decrypted);
	}

	/** X14 — decrypt/encrypt the context (credentials are the only encrypted member). */
	decryptExecutionContext(context: Record<string, unknown>) {
		let credentials = undefined;
		if (context.credentials) {
			const decrypted = this.cipher.decrypt(context.credentials);
			credentials = this.toCredentialContext(decrypted);
		}
		return { ...context, credentials };
	}

	encryptExecutionContext(context: Record<string, unknown>) {
		let credentials = undefined;
		if (context.credentials) {
			credentials = this.cipher.encrypt(context.credentials);
		}
		return { ...context, credentials };
	}

	mergeExecutionContexts(baseContext: Record<string, unknown>, contextToMerge: Record<string, unknown>) {
		return deepMerge(baseContext, contextToMerge);
	}

	/** X15 — run the establishment hooks configured on the start node. */
	async augmentExecutionContextWithHooks(
		workflow: { getNode: (name: string) => { parameters?: Record<string, unknown> } | null },
		startItem: { node: { name: string; parameters?: Record<string, unknown> }; data: Record<string, unknown[]> },
		contextToAugment: Record<string, unknown>,
	): Promise<{ context: Record<string, unknown>; triggerItems: unknown[] | null }> {
		let currentTriggerItems = (startItem.data['main'] as unknown[])[0];

		const contextEstablishmentHookParameters = {
			...(workflow.getNode(startItem.node.name)?.parameters ?? {}),
			...startItem.node.parameters,
		};

		const startNodeParametersResult = this.toHookParameters(contextEstablishmentHookParameters);

		if (!startNodeParametersResult || 'error' in startNodeParametersResult) {
			if (startNodeParametersResult && 'error' in startNodeParametersResult) {
				this.logger.warn(
					`Failed to parse execution context establishment hook parameters for node ${startItem.node.name}: ${startNodeParametersResult.error.message}`,
				);
			}
			// no execution establishment hooks found, we just return the original context
			return { context: contextToAugment, triggerItems: currentTriggerItems };
		}

		const startNodeParameters = startNodeParametersResult.data;

		// decrypt the context to work with plaintext data
		let context = this.decryptExecutionContext(contextToAugment);

		for (const hookParameters of startNodeParameters.contextEstablishmentHooks.hooks) {
			const hook = this.executionContextHookRegistry.getHookByName(hookParameters.hookName);

			if (!hook) {
				this.logger.warn(`Execution context establishment hook ${hookParameters.hookName} not found, skipping this hook`);
				continue;
			}
			try {
				const result = await hook.execute({
					triggerNode: startItem.node,
					workflow,
					triggerItems: currentTriggerItems,
					context,
					options: hookParameters,
				});

				if (result.triggerItems !== undefined) {
					currentTriggerItems = result.triggerItems;
				}

				if (result.contextUpdate) {
					context = this.mergeExecutionContexts(context, result.contextUpdate);
				}
			} catch (error) {
				this.logger.warn(`Failed to execute context establishment hook ${hookParameters.hookName}`, { error });
				if (!hookParameters.isAllowedToFail) {
					// If the hook is not allowed to fail, rethrow the error
					throw error;
				}
			}
		}

		return { context: this.encryptExecutionContext(context), triggerItems: currentTriggerItems };
	}
}

/* ------------------------------------------------------------------ *
 * ExecutionRecoveryService — cli/src/executions/execution-recovery.service.ts
 * ------------------------------------------------------------------ */

export type RecoveryEventMessage = {
	eventName: string;
	payload: Record<string, unknown>;
	ts: {
		toUnixInteger: () => number;
		toJSDate: () => Date;
		diff: (other: RecoveryEventMessage['ts']) => { toMillis: () => number };
	};
};

const WORKFLOW_END_EVENTS = new Set(['n8n.workflow.success', 'n8n.workflow.crashed', 'n8n.workflow.failed']);

export type ExecutionRecoveryServiceOptions = {
	logger?: Logger;
	executionRepository: ExecutionRepositoryPort;
	workflowRepository: WorkflowRepositoryPort;
	executionsConfig?: { recovery?: { maxLastExecutions?: number; workflowDeactivationEnabled?: boolean } };
	push?: Emitter & { broadcast?: (message: unknown) => void };
	notifyWorkflowAutodeactivated?: (payload: { workflow: Record<string, unknown> }) => Promise<void> | void;
	sleep?: (ms: number) => Promise<void>;
	isFollower?: boolean;
	runLifecycleHooks?: (execution: ExecutionRow) => Promise<void> | void;
};

export class ExecutionRecoveryService {
	private logger: Logger;
	private executionRepository: ExecutionRepositoryPort;
	private workflowRepository: WorkflowRepositoryPort;
	private executionsConfig: { recovery: { maxLastExecutions: number; workflowDeactivationEnabled: boolean } };
	private push: Emitter & { broadcast?: (message: unknown) => void };
	private notifyWorkflowAutodeactivated: (payload: { workflow: Record<string, unknown> }) => Promise<void> | void;
	private sleep: (ms: number) => Promise<void>;
	private isFollower: boolean;
	private runLifecycleHooks: (execution: ExecutionRow) => Promise<void> | void;

	constructor(options: ExecutionRecoveryServiceOptions) {
		this.logger = options.logger ?? noopLogger;
		this.executionRepository = options.executionRepository;
		this.workflowRepository = options.workflowRepository;
		this.executionsConfig = {
			recovery: {
				maxLastExecutions: options.executionsConfig?.recovery?.maxLastExecutions ?? WORKFLOW_AUTODEACTIVATION_DEFAULTS.maxLastExecutions,
				workflowDeactivationEnabled:
					options.executionsConfig?.recovery?.workflowDeactivationEnabled ??
					WORKFLOW_AUTODEACTIVATION_DEFAULTS.workflowDeactivationEnabled,
			},
		};
		this.push = options.push ?? new Emitter();
		this.notifyWorkflowAutodeactivated = options.notifyWorkflowAutodeactivated ?? (() => {});
		this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
		this.isFollower = options.isFollower ?? false;
		this.runLifecycleHooks = options.runLifecycleHooks ?? (() => {});
	}

	/** X16 — deactivate workflows whose last N executions all crashed. */
	async autoDeactivateWorkflowsIfNeeded(workflowIds: Set<string>) {
		for (const workflowId of workflowIds) {
			const maxLastExecutions = this.executionsConfig.recovery.maxLastExecutions;
			const lastExecutions = await this.executionRepository.findMultipleExecutions({
				select: ['id', 'status'],
				where: { workflowId },
				order: { startedAt: 'DESC' },
				take: maxLastExecutions,
			});
			const numberOfCrashedExecutions = lastExecutions.filter((e) => e.status === 'crashed').length;

			// If all of the last N executions are crashed, deactivate the workflow
			if (lastExecutions.length >= maxLastExecutions && lastExecutions.length === numberOfCrashedExecutions) {
				const workflow = await this.workflowRepository.findOne({ where: { id: workflowId } });

				if (!workflow) {
					this.logger.warn(`Workflow ${workflowId} not found, skipping workflow auto-deactivation`);
					continue;
				}

				if (workflow.activeVersionId !== null) {
					await this.workflowRepository.updateActiveState(workflowId, false);
					this.logger.warn(`Autodeactivated workflow ${workflowId} due to too many crashed executions.`);

					await this.notifyWorkflowAutodeactivated({ workflow });

					this.push.once('editorUiConnected', async () => {
						await this.sleep(PUSH_AFTER_UI_TIMEOUT_MS);
						this.push.broadcast?.({ type: 'workflowAutoDeactivated', data: { workflowId } });
					});
				}

				await this.executionRepository.update(
					{ workflowId, status: { $in: ['running', 'new'] } },
					{ status: 'crashed', stoppedAt: new Date() },
				);
			}
		}
	}

	/** X17 — recover a truncated execution from its event logs. */
	async recoverFromLogs(executionId: string, messages: RecoveryEventMessage[]) {
		if (this.isFollower) return null;

		const amendedExecution = await this.amend(executionId, messages);

		if (!amendedExecution) return null;

		this.logger.info('[Recovery] Logs available, amended execution', { executionId: amendedExecution.id });

		await this.executionRepository.updateExistingExecution(executionId, amendedExecution as Partial<ExecutionRow>);

		await this.runLifecycleHooks(amendedExecution);

		this.push.once('editorUiConnected', async () => {
			await this.sleep(PUSH_AFTER_UI_TIMEOUT_MS);
			this.push.broadcast?.({ type: 'executionRecovered', data: { executionId } });
		});

		return amendedExecution;
	}

	private async amend(executionId: string, messages: RecoveryEventMessage[]) {
		if (messages.length === 0) return await this.amendWithoutLogs(executionId);

		const { nodeMessages, workflowMessages } = this.toRelevantMessages(messages);

		if (nodeMessages.length === 0) return null;

		const execution = await this.executionRepository.findSingleExecution(executionId, { includeData: true });

		/**
		 * The event bus is unable to correctly identify unfinished executions in workers,
		 * because execution lifecycle hooks cause worker event logs to be partitioned.
		 * Hence we need to filter out finished executions here.
		 */
		if (!execution || (['success', 'error', 'canceled'].includes(execution.status) && execution.data)) {
			return null;
		}

		const runExecutionData = (execution.data as Record<string, any>) ?? { resultData: { runData: {} } };

		let lastNodeRunTimestamp: RecoveryEventMessage['ts'] | undefined;

		const workflowNodes = ((execution as Record<string, any>).workflowData?.nodes ?? []) as Array<{ name: string }>;

		for (const node of workflowNodes) {
			const nodeStartedMessage = nodeMessages.find(
				(m) => m.payload.nodeName === node.name && m.eventName === 'n8n.node.started',
			);

			if (!nodeStartedMessage) continue;

			const nodeHasRunData = runExecutionData.resultData.runData[node.name] !== undefined;
			if (nodeHasRunData) continue; // when saving execution progress

			const nodeFinishedMessage = nodeMessages.find(
				(m) => m.payload.nodeName === node.name && m.eventName === 'n8n.node.finished',
			);

			const taskData: Record<string, unknown> = {
				startTime: nodeStartedMessage.ts.toUnixInteger(),
				executionIndex: 0,
				executionTime: -1,
				source: [null],
			};

			if (nodeFinishedMessage) {
				taskData.executionStatus = 'success';
				taskData.data ??= ARTIFICIAL_TASK_DATA;
				taskData.executionTime = nodeFinishedMessage.ts.diff(nodeStartedMessage.ts).toMillis();
				lastNodeRunTimestamp = nodeFinishedMessage.ts;
			} else {
				taskData.executionStatus = 'crashed';
				taskData.error = new NodeCrashedError(node);
				taskData.executionTime = 0;
				runExecutionData.resultData.error = new WorkflowCrashedError();
				lastNodeRunTimestamp = nodeStartedMessage.ts;
			}

			runExecutionData.resultData.lastNodeExecuted = node.name;
			runExecutionData.resultData.runData[node.name] = [taskData];
		}

		return {
			...execution,
			status: execution.status === 'error' ? 'error' : 'crashed',
			stoppedAt: this.toStoppedAt(lastNodeRunTimestamp, workflowMessages),
			data: runExecutionData,
		} as ExecutionRow;
	}

	private async amendWithoutLogs(executionId: string) {
		const exists = await this.executionRepository.exists({ where: { id: executionId } });

		if (!exists) return null;

		await this.executionRepository.markAsCrashed(executionId);

		const execution = await this.executionRepository.findSingleExecution(executionId, { includeData: true });

		return execution ?? null;
	}

	private toRelevantMessages(messages: RecoveryEventMessage[]) {
		return messages.reduce<{ nodeMessages: RecoveryEventMessage[]; workflowMessages: RecoveryEventMessage[] }>(
			(acc, cur) => {
				if (cur.eventName.startsWith('n8n.node.')) {
					acc.nodeMessages.push(cur);
				} else if (cur.eventName.startsWith('n8n.workflow.')) {
					acc.workflowMessages.push(cur);
				}

				return acc;
			},
			{ nodeMessages: [], workflowMessages: [] },
		);
	}

	private toStoppedAt(timestamp: RecoveryEventMessage['ts'] | undefined, messages: RecoveryEventMessage[]) {
		if (timestamp) return timestamp.toJSDate();

		return (
			messages.find((m) => WORKFLOW_END_EVENTS.has(m.eventName)) ??
			messages.find((m) => m.eventName === 'n8n.workflow.started')
		)?.ts.toJSDate();
	}
}

/* ------------------------------------------------------------------ *
 * Runtime factory — the ports a deployment plugs together
 * ------------------------------------------------------------------ */

export type ExecutionRuntimeOptions = {
	logger?: Logger;
	executionRepository?: ExecutionRepositoryPort;
	executionPersistence?: ExecutionPersistencePort;
	workflowRepository?: WorkflowRepositoryPort;
	concurrencyControl?: ConcurrencyControlPort;
	eventService?: Emitter;
	push?: Emitter & { broadcast?: (message: unknown) => void };
	executionsConfig?: { mode?: 'regular' | 'queue'; recovery?: { maxLastExecutions?: number; workflowDeactivationEnabled?: boolean } };
	hooks?: Array<new () => ContextEstablishmentHook>;
	scheduledTaskManager?: ActiveWorkflowsOptions['scheduledTaskManager'];
	triggersAndPollers?: ActiveWorkflowsOptions['triggersAndPollers'];
	toCronExpression?: (triggerTime: unknown) => string;
	sleep?: (ms: number) => Promise<void>;
};

export function createExecutionRuntime(options: ExecutionRuntimeOptions = {}) {
	const logger = options.logger ?? noopLogger;
	const executionRepository = options.executionRepository ?? new MemoryExecutionRepository();
	const workflowRepository = options.workflowRepository ?? new MemoryWorkflowRepository();
	const eventService = options.eventService ?? new Emitter();

	const activeExecutions = new ActiveExecutions({
		logger,
		executionRepository,
		executionPersistence:
			options.executionPersistence ??
			new MemoryExecutionPersistence(
				executionRepository instanceof MemoryExecutionRepository ? executionRepository : undefined,
			),
		concurrencyControl: options.concurrencyControl ?? new MemoryConcurrencyControl(),
		eventService,
		executionsConfig: { mode: options.executionsConfig?.mode ?? 'regular' },
		sleep: options.sleep,
	});

	const activeWorkflows = new ActiveWorkflows({
		logger,
		scheduledTaskManager: options.scheduledTaskManager,
		triggersAndPollers: options.triggersAndPollers,
		toCronExpression: options.toCronExpression,
	});

	const hookRegistry = new ExecutionContextHookRegistry({ hooks: options.hooks, logger });
	const executionContext = new ExecutionContextService({ logger, registry: hookRegistry });

	const executionRecovery = new ExecutionRecoveryService({
		logger,
		executionRepository,
		workflowRepository,
		executionsConfig: { recovery: options.executionsConfig?.recovery },
		push: options.push,
		sleep: options.sleep,
	});

	return { activeExecutions, activeWorkflows, hookRegistry, executionContext, executionRecovery, executionRepository, workflowRepository, eventService };
}
