/**
 * QUEUE LEGO — scaling (queue mode) subsystem reconstruction.
 *
 * Reference: n8n 2.9.4 — `reference/n8n/packages/cli/src/scaling/**`
 *   scaling/constants.ts          (QUEUE_NAME, JOB_TYPE_NAME, pubsub channels, command sets)
 *   scaling/scaling.types.ts      (JobData, JobMessage, JobFinishedProps, ...)
 *   scaling/scaling.service.ts    (queue setup, job dispatch, recovery, metrics)
 *   scaling/job-processor.ts      (job → execution, sendResponse/sendChunk, job-finished)
 *   scaling/worker-server.ts      (worker HTTP surface: health, overwrites, metrics)
 *   scaling/pubsub/*              (Publisher / Subscriber command bus)
 *   scaling/worker-status.service.ee.ts (get-worker-status round trip)
 * Upstream commit pinned by the reference manifest: b6dc2787c45677a29a9612cd27eb911302961a83
 *
 * ZERO RUST: JavaScript/TypeScript only, per PROJECT_RULES.md §1.
 * Boundary: this engine never touches `reference/**`; it only mirrors observable
 * semantics (constants, message shapes, error strings, lifecycle transitions).
 *
 * Invariants defined in docs/isolation/queue.md: Q1..Q14.
 */

import { TypedEmitter } from './emitter.ts';

/* ------------------------------------------------------------------ *
 * Q1 — channel + queue names (scaling/constants.ts, byte-exact)
 * ------------------------------------------------------------------ */

export const QUEUE_NAME = 'jobs';

export const JOB_TYPE_NAME = 'job';

/** Commands a main process sends to workers or to other main processes. */
export const COMMAND_PUBSUB_CHANNEL = 'n8n.commands';

/** Messages sent by workers in response to commands from main processes. */
export const WORKER_RESPONSE_PUBSUB_CHANNEL = 'n8n.worker-response';

/** MCP relay messages between main instances in multi-main queue mode. */
export const MCP_RELAY_PUBSUB_CHANNEL = 'n8n.mcp-relay';

/** Q2 — commands that must be echoed back to the sender (multi-main activation sync). */
export const SELF_SEND_COMMANDS: ReadonlySet<string> = new Set([
	'add-webhooks-triggers-and-pollers',
	'remove-triggers-and-pollers',
]);

/** Q3 — commands that must not be debounced on receipt (webhook handling). */
export const IMMEDIATE_COMMANDS: ReadonlySet<string> = new Set([
	'add-webhooks-triggers-and-pollers',
	'remove-triggers-and-pollers',
	'relay-execution-lifecycle-event',
	'relay-chat-stream-event',
]);

/* ------------------------------------------------------------------ *
 * Types (scaling.types.ts)
 * ------------------------------------------------------------------ */

export type InstanceType = 'main' | 'worker';

export type ExecutionStatus =
	| 'new'
	| 'running'
	| 'success'
	| 'error'
	| 'canceled'
	| 'crashed'
	| 'waiting'
	| 'unknown';

export type JobId = string | number;

export type JobData = {
	workflowId: string;
	executionId: string;
	loadStaticData: boolean;
	pushRef?: string;
	streamingEnabled?: boolean;
	restartExecutionId?: string;
	isMcpExecution?: boolean;
	mcpType?: 'service' | 'trigger';
	mcpSessionId?: string;
	mcpMessageId?: string;
};

export type JobResult = { success: boolean };

export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused';

export type Job<TData = JobData> = {
	id: JobId;
	name: string;
	data: TData;
	progress: (msg: JobMessage) => Promise<void>;
};

export type JobFinishedProps = {
	success: boolean;
	error?: { message: string; stack?: string };
	status: ExecutionStatus;
	lastNodeExecuted?: string;
	usedDynamicCredentials?: boolean;
	metadata?: Record<string, string>;
	startedAt: Date;
	stoppedAt: Date;
};

/** Q4 — worker → main / main → worker job messages (Bull internal pubsub). */
export type RespondToWebhookMessage = {
	kind: 'respond-to-webhook';
	executionId: string;
	response: unknown;
	workerId: string;
};

export type JobFinishedMessage =
	| { kind: 'job-finished'; executionId: string; workerId: string; success: boolean }
	| ({ kind: 'job-finished'; version: 2; executionId: string; workerId: string } & JobFinishedProps);

export type JobFailedMessage = {
	kind: 'job-failed';
	executionId: string;
	workerId: string;
	errorMsg: string;
	errorStack: string;
};

export type SendChunkMessage = {
	kind: 'send-chunk';
	executionId: string;
	chunkText: unknown;
	workerId: string;
};

export type McpResponseMessage = {
	kind: 'mcp-response';
	executionId: string;
	mcpType: 'service' | 'trigger';
	sessionId: string;
	messageId: string;
	response: unknown;
	workerId: string;
};

export type AbortJobMessage = { kind: 'abort-job' };

export type JobMessage =
	| RespondToWebhookMessage
	| JobFinishedMessage
	| JobFailedMessage
	| AbortJobMessage
	| SendChunkMessage
	| McpResponseMessage;

export type QueueRecoveryContext = {
	timeout?: ReturnType<typeof setTimeout>;
	batchSize: number;
	waitMs: number;
};

export type PubSubCommand = {
	command: string;
	senderId?: string;
	targets?: string[];
	selfSend?: boolean;
	debounce?: boolean;
	payload?: unknown;
};

export type PubSubWorkerResponse = {
	senderId: string;
	response: string;
	payload?: unknown;
};

/** Q13 — hard-coded recovery defaults mirroring `executions.queueRecovery`. */
export const QUEUE_RECOVERY_DEFAULTS = { batchSize: 5, intervalMinutes: 10 } as const;

export type QueueRecoveryConfig = { batchSize: number; interval: number };

/* ------------------------------------------------------------------ *
 * Errors — n8n-workflow's UnexpectedError surface (message byte-exact)
 * ------------------------------------------------------------------ */

export class UnexpectedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UnexpectedError';
	}
}

/* ------------------------------------------------------------------ *
 * Q5 — in-memory twin of Redis pubsub (scaling/pubsub/*)
 * ------------------------------------------------------------------ */

type Subscription = { channel: string; handler: (payload: string) => void };

export class MemoryPubSubBroker {
	private readonly channels = new Map<string, Set<Subscription>>();

	private readonly retained: Array<{ channel: string; payload: string }> = [];

	subscribe(channel: string, handler: (payload: string) => void): Subscription {
		const subscription = { channel, handler };
		const set = this.channels.get(channel) ?? new Set<Subscription>();
		set.add(subscription);
		this.channels.set(channel, set);
		return subscription;
	}

	publish(channel: string, payload: string): number {
		const set = this.channels.get(channel);
		this.retained.push({ channel, payload });
		if (!set) return 0;
		let delivered = 0;
		for (const subscription of set) {
			subscription.handler(payload);
			delivered += 1;
		}
		return delivered;
	}

	get subscriberCount() {
		let total = 0;
		for (const set of this.channels.values()) total += set.size;
		return total;
	}

	/** Test hook: everything that crossed the bus, in order. */
	get history() {
		return [...this.retained];
	}
}

export type PublisherOptions = {
	hostId: string;
	instanceType: InstanceType;
	mode: 'queue' | 'regular';
	redisPrefix?: string;
	broker?: MemoryPubSubBroker;
};

/**
 * Q5/Q6 — Publisher. Byte-exact payload decoration:
 *   { ...msg, senderId, selfSend: SELF_SEND.has(cmd), debounce: !IMMEDIATE.has(cmd) }
 * Publishing is a no-op unless the instance runs in `queue` mode.
 */
export class Publisher {
	readonly hostId: string;

	readonly instanceType: InstanceType;

	readonly mode: 'queue' | 'regular';

	readonly commandChannel: string;

	readonly workerResponseChannel: string;

	readonly mcpRelayChannel: string;

	readonly broker: MemoryPubSubBroker;

	constructor(options: PublisherOptions) {
		this.hostId = options.hostId;
		this.instanceType = options.instanceType;
		this.mode = options.mode;
		this.broker = options.broker ?? new MemoryPubSubBroker();
		const prefix = options.redisPrefix ?? 'n8n';
		this.commandChannel = `${prefix}:${COMMAND_PUBSUB_CHANNEL}`;
		this.workerResponseChannel = `${prefix}:${WORKER_RESPONSE_PUBSUB_CHANNEL}`;
		this.mcpRelayChannel = `${prefix}:${MCP_RELAY_PUBSUB_CHANNEL}`;
	}

	async publishCommand(msg: PubSubCommand): Promise<void> {
		if (this.mode !== 'queue') return;

		await this.broker.publish(
			this.commandChannel,
			JSON.stringify({
				...msg,
				senderId: this.hostId,
				selfSend: SELF_SEND_COMMANDS.has(msg.command),
				debounce: !IMMEDIATE_COMMANDS.has(msg.command),
			}),
		);
	}

	async publishWorkerResponse(msg: PubSubWorkerResponse): Promise<void> {
		if (this.mode !== 'queue') return;

		await this.broker.publish(this.workerResponseChannel, JSON.stringify(msg));
	}

	shutdown() {
		/* client.disconnect() twin — nothing to release for the in-memory broker */
	}
}

export type SubscriberOptions = {
	hostId: string;
	mode: 'queue' | 'regular';
	redisPrefix?: string;
	broker: MemoryPubSubBroker;
	debounceMs?: number;
	onError?: (error: unknown) => void;
};

/**
 * Q7 — Subscriber. Receipt rules (1:1 with scaling/pubsub/subscriber.service.ts):
 *  1. a message produced by the same host is dropped unless `selfSend`;
 *  2. when `targets` is set, the host must be listed;
 *  3. non-`IMMEDIATE_COMMANDS` are debounced per command key;
 *  4. handlers are dispatched per `command`, worker responses per `response`.
 */
export class Subscriber {
	readonly hostId: string;

	readonly mode: 'queue' | 'regular';

	readonly broker: MemoryPubSubBroker;

	private readonly debounceMs: number;

	private readonly onError?: (error: unknown) => void;

	private readonly handlers = new Map<string, Array<(payload: unknown) => void>>();

	private readonly responseHandlers = new Map<string, Array<(payload: unknown) => void>>();

	private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

	private readonly pending = new Map<string, unknown>();

	constructor(options: SubscriberOptions) {
		this.hostId = options.hostId;
		this.mode = options.mode;
		this.broker = options.broker;
		this.debounceMs = options.debounceMs ?? 10;
		this.onError = options.onError;

		if (this.mode !== 'queue') return;

		const prefix = options.redisPrefix ?? 'n8n';
		this.broker.subscribe(`${prefix}:${COMMAND_PUBSUB_CHANNEL}`, (payload) =>
			this.handleMessage(payload),
		);
		this.broker.subscribe(`${prefix}:${WORKER_RESPONSE_PUBSUB_CHANNEL}`, (payload) =>
			this.handleWorkerResponse(payload),
		);
	}

	onCommand(command: string, handler: (payload: unknown) => void) {
		const list = this.handlers.get(command) ?? [];
		list.push(handler);
		this.handlers.set(command, list);
	}

	onResponse(response: string, handler: (payload: unknown) => void) {
		const list = this.responseHandlers.get(response) ?? [];
		list.push(handler);
		this.responseHandlers.set(response, list);
	}

	/** Resolves once every debounced command has been flushed (test hook). */
	async drainDebounced(): Promise<void> {
		while (this.pending.size > 0) {
			for (const [key] of [...this.pending]) {
				const timer = this.debounceTimers.get(key);
				if (timer) clearTimeout(timer);
				this.flush(key);
			}
			await new Promise((resolve) => setImmediate(resolve));
		}
	}

	stop() {
		for (const timer of this.debounceTimers.values()) clearTimeout(timer);
		this.debounceTimers.clear();
		this.pending.clear();
	}

	private handleMessage(payload: string) {
		try {
			const msg = JSON.parse(payload) as PubSubCommand & { senderId: string; debounce: boolean };

			if (msg.senderId === this.hostId && !msg.selfSend) return;
			if (msg.targets && !msg.targets.includes(this.hostId)) return;

			if (msg.debounce) {
				const key = msg.command;
				this.pending.set(key, msg);
				const existing = this.debounceTimers.get(key);
				if (existing) clearTimeout(existing);
				this.debounceTimers.set(
					key,
					setTimeout(() => this.flush(key), this.debounceMs),
				);
				return;
			}

			this.dispatch(this.handlers, msg.command, msg.payload);
		} catch (error) {
			this.onError?.(error);
		}
	}

	private handleWorkerResponse(payload: string) {
		try {
			const msg = JSON.parse(payload) as PubSubWorkerResponse;
			this.dispatch(this.responseHandlers, msg.response, { ...msg, ...(msg.payload ?? {}) });
		} catch (error) {
			this.onError?.(error);
		}
	}

	private flush(key: string) {
		const msg = this.pending.get(key) as PubSubCommand | undefined;
		this.pending.delete(key);
		this.debounceTimers.delete(key);
		if (!msg) return;
		this.dispatch(this.handlers, msg.command, msg.payload);
	}

	private dispatch(
		registry: Map<string, Array<(payload: unknown) => void>>,
		key: string,
		payload: unknown,
	) {
		for (const handler of registry.get(key) ?? []) handler(payload);
	}
}

/* ------------------------------------------------------------------ *
 * Q8 — in-memory twin of the Bull queue (QUEUE_NAME / JOB_TYPE_NAME)
 * ------------------------------------------------------------------ */

type QueuedJob = Job & { status: JobStatus; options: Record<string, unknown> };

export class MemoryJobQueue {
	readonly name: string;

	readonly settings: Record<string, unknown>;

	private sequence = 0;

	private readonly jobs = new Map<string, QueuedJob>();

	private processor?: { concurrency: number; handler: (job: Job) => Promise<unknown> };

	constructor(name: string, options: { settings?: Record<string, unknown> } = {}) {
		this.name = name;
		// scaling.service.ts: `settings: { ...bull.settings, maxStalledCount: 0 }`
		this.settings = { maxStalledCount: 0, ...(options.settings ?? {}) };
	}

	async add(name: string, data: JobData, options: Record<string, unknown> = {}): Promise<Job> {
		this.sequence += 1;
		const id = String(this.sequence);
		const job: QueuedJob = {
			id,
			name,
			data,
			status: 'waiting',
			options,
			progress: async (msg: JobMessage) => {
				this.messages.push(msg);
			},
		};
		this.jobs.set(id, job);

		if (this.processor) await this.run(job);

		return job;
	}

	private readonly messages: JobMessage[] = [];

	get emittedMessages(): JobMessage[] {
		return [...this.messages];
	}

	process(name: string, concurrency: number, handler: (job: Job) => Promise<unknown>) {
		if (name !== JOB_TYPE_NAME) throw new Error(`Unknown job type "${name}"`);
		this.processor = { concurrency, handler };
	}

	private async run(job: QueuedJob) {
		const processor = this.processor;
		if (!processor) return;
		job.status = 'active';
		try {
			await processor.handler(job);
			job.status = 'completed';
		} catch {
			job.status = 'failed';
		}
	}

	async getJobs(statuses: JobStatus[]): Promise<Job[]> {
		return [...this.jobs.values()].filter((job) => statuses.includes(job.status));
	}

	async getJob(id: JobId): Promise<Job | undefined> {
		return this.jobs.get(String(id));
	}

	async getJobCounts(...statuses: JobStatus[]): Promise<Record<string, number>> {
		const wanted = statuses.length > 0 ? statuses : (['active', 'waiting'] as JobStatus[]);
		const counts: Record<string, number> = {};
		for (const status of wanted) counts[status] = 0;
		for (const job of this.jobs.values()) {
			if (job.status in counts) counts[job.status] += 1;
		}
		return counts;
	}
}

/* ------------------------------------------------------------------ *
 * Q9 — repository seams (only what the queue subsystem consumes)
 * ------------------------------------------------------------------ */

export type ExecutionRecord = {
	id: string;
	workflowId: string;
	status: ExecutionStatus;
	mode: string;
	workflowData: { id: string; name: string; staticData?: Record<string, unknown> };
};

export class MemoryExecutionRepository {
	private readonly executions = new Map<string, ExecutionRecord>();

	private readonly storedAt = new Map<string, Date>();

	seed(execution: ExecutionRecord) {
		this.executions.set(execution.id, execution);
		return execution;
	}

	async findSingleExecution(id: string): Promise<ExecutionRecord | undefined> {
		return this.executions.get(id);
	}

	async setRunning(id: string): Promise<Date> {
		const execution = this.executions.get(id);
		if (!execution) throw new UnexpectedError(`Execution ${id} not found`);
		execution.status = 'running';
		const startedAt = new Date();
		this.storedAt.set(id, startedAt);
		return startedAt;
	}

	async getInProgressExecutionIds(limit: number): Promise<string[]> {
		return [...this.executions.values()]
			.filter((execution) => execution.status === 'new' || execution.status === 'running')
			.slice(0, limit)
			.map((execution) => execution.id);
	}

	async markAsCrashed(ids: string[]): Promise<void> {
		for (const id of ids) {
			const execution = this.executions.get(id);
			if (execution) execution.status = 'crashed';
		}
	}

	get(id: string): ExecutionRecord | undefined {
		return this.executions.get(id);
	}
}

export class MemoryWorkflowRepository {
	private readonly staticData = new Map<string, Record<string, unknown>>();

	seedStaticData(workflowId: string, staticData: Record<string, unknown>) {
		this.staticData.set(workflowId, staticData);
	}

	async findOne(id: string): Promise<{ id: string; staticData?: Record<string, unknown> } | null> {
		if (!this.staticData.has(id)) return null;
		return { id, staticData: this.staticData.get(id) };
	}
}

/* ------------------------------------------------------------------ *
 * Q10 — JobProcessor (scaling/job-processor.ts)
 * ------------------------------------------------------------------ */

export type JobProcessorOptions = {
	hostId: string;
	executionRepository: MemoryExecutionRepository;
	workflowRepository: MemoryWorkflowRepository;
	eventService?: TypedEmitter;
	runExecution?: (context: { execution: ExecutionRecord; job: Job }) => Promise<JobFinishedProps>;
};

export class JobProcessor {
	private readonly runningJobs: Record<string, { executionId: string; startedAt: Date }> = {};

	private readonly hostId: string;

	private readonly executionRepository: MemoryExecutionRepository;

	private readonly workflowRepository: MemoryWorkflowRepository;

	private readonly eventService?: TypedEmitter;

	private readonly runExecution: (context: {
		execution: ExecutionRecord;
		job: Job;
	}) => Promise<JobFinishedProps>;

	constructor(options: JobProcessorOptions) {
		this.hostId = options.hostId;
		this.executionRepository = options.executionRepository;
		this.workflowRepository = options.workflowRepository;
		this.eventService = options.eventService;
		this.runExecution = options.runExecution ?? (async () => emptyRun());
	}

	async processJob(job: Job): Promise<JobResult> {
		const { executionId, loadStaticData } = job.data;

		const execution = await this.executionRepository.findSingleExecution(executionId);

		if (!execution) {
			throw new UnexpectedError(
				`Worker failed to find data for execution ${executionId} (job ${job.id})`,
			);
		}

		// Bull retries + n8n execution recovery can re-enqueue a crashed execution.
		if (execution.status === 'crashed') return { success: false };

		const workflowId = execution.workflowId;

		if (loadStaticData) {
			const workflowData = await this.workflowRepository.findOne(workflowId);
			if (workflowData === null) {
				throw new UnexpectedError(
					`Worker failed to find workflow ${workflowId} to run execution ${executionId} (job ${job.id})`,
				);
			}
		}

		const startedAt = await this.executionRepository.setRunning(executionId);
		this.runningJobs[String(job.id)] = { executionId, startedAt };

		const run = await this.runExecution({ execution, job });

		delete this.runningJobs[String(job.id)];

		execution.status = run.success ? 'success' : 'error';

		const msg: JobFinishedMessage = {
			kind: 'job-finished',
			version: 2,
			executionId,
			workerId: this.hostId,
			...run,
		};

		await job.progress(msg);

		this.eventService?.emit('job-finished', { executionId, workflowId, success: run.success });

		return { success: run.success };
	}

	getRunningJobsSummary() {
		return Object.entries(this.runningJobs).map(([jobId, runningJob]) => ({
			jobId,
			executionId: runningJob.executionId,
			startedAt: runningJob.startedAt,
		}));
	}
}

function emptyRun(): JobFinishedProps {
	const now = new Date();
	return { success: true, status: 'success', startedAt: now, stoppedAt: now };
}

/* ------------------------------------------------------------------ *
 * Q9b — emitter seam (shared, see ./emitter.ts)
 * ------------------------------------------------------------------ */

export { TypedEmitter, type EventHandler } from './emitter.ts';

/* ------------------------------------------------------------------ *
 * Q11 — ScalingService (scaling/scaling.service.ts)
 * ------------------------------------------------------------------ */

export type ScalingServiceOptions = {
	hostId: string;
	instanceType: InstanceType;
	isLeader?: boolean;
	mode?: 'queue' | 'regular';
	broker?: MemoryPubSubBroker;
	redisPrefix?: string;
	recovery?: Partial<QueueRecoveryConfig>;
	queueMetricsEnabled?: boolean;
	jobProcessor: JobProcessor;
	executionRepository?: MemoryExecutionRepository;
	eventService?: TypedEmitter;
	/** Bull seam — a real deployment injects a Redis-backed queue. */
	queueFactory?: () => MemoryJobQueue;
	/** Worker status payload factory (worker-status.service.ee.ts). */
	statusFactory?: () => Record<string, unknown>;
};

export class ScalingService {
	readonly hostId: string;

	readonly instanceType: InstanceType;

	readonly isLeader: boolean;

	readonly mode: 'queue' | 'regular';

	readonly broker: MemoryPubSubBroker;

	readonly publisher: Publisher;

	readonly subscriber: Subscriber;

	readonly queueRecoveryContext: QueueRecoveryContext;

	readonly jobCounters = { completed: 0, failed: 0 };

	private readonly jobProcessor: JobProcessor;

	private readonly executionRepository?: MemoryExecutionRepository;

	private readonly eventService?: TypedEmitter;

	private readonly queueFactory: () => MemoryJobQueue;

	private readonly statusFactory: () => Record<string, unknown>;

	private readonly queueMetricsEnabled: boolean;

	private queue?: MemoryJobQueue;

	private recoveryTimer?: ReturnType<typeof setTimeout>;

	private metricsTimer?: ReturnType<typeof setInterval>;

	constructor(options: ScalingServiceOptions) {
		this.hostId = options.hostId;
		this.instanceType = options.instanceType;
		this.isLeader = options.isLeader ?? false;
		this.mode = options.mode ?? 'queue';
		this.broker = options.broker ?? new MemoryPubSubBroker();
		this.jobProcessor = options.jobProcessor;
		this.executionRepository = options.executionRepository;
		this.eventService = options.eventService;
		this.queueFactory = options.queueFactory ?? (() => new MemoryJobQueue(QUEUE_NAME));
		this.statusFactory = options.statusFactory ?? (() => ({ senderId: this.hostId }));
		this.queueMetricsEnabled = options.queueMetricsEnabled ?? false;

		const recovery = { ...QUEUE_RECOVERY_DEFAULTS, ...(options.recovery ?? {}) };
		this.queueRecoveryContext = {
			batchSize: recovery.batchSize,
			waitMs: recovery.interval * 60 * 1000,
		};

		this.publisher = new Publisher({
			hostId: this.hostId,
			instanceType: this.instanceType,
			mode: this.mode,
			redisPrefix: options.redisPrefix,
			broker: this.broker,
		});

		this.subscriber = new Subscriber({
			hostId: this.hostId,
			mode: this.mode,
			redisPrefix: options.redisPrefix,
			broker: this.broker,
			onError: (error) => this.log('error', 'Failed to parse pubsub message', error),
		});

		// worker-status.service.ee.ts — the worker answers `get-worker-status`
		this.subscriber.onCommand('get-worker-status', (payload) => {
			if (this.instanceType !== 'worker') return;
			void this.publisher.publishWorkerResponse({
				senderId: this.hostId,
				response: 'response-to-get-worker-status',
				payload: { ...this.statusFactory(), ...(payload as Record<string, unknown>) },
			});
		});
	}

	// #region Lifecycle

	async setupQueue(): Promise<void> {
		if (this.queue) return;
		this.queue = this.queueFactory();
		if (this.isLeader) this.scheduleQueueRecovery(0);
		if (this.queueMetricsEnabled) this.scheduleQueueMetrics();
	}

	setupWorker(concurrency: number): void {
		this.assertWorker();
		this.assertQueue();

		const queue = this.queue as MemoryJobQueue;
		queue.process(JOB_TYPE_NAME, concurrency, async (job) => {
			try {
				this.hostId; // instance host id is part of the `job-dequeued` payload
				this.eventService?.emit('job-dequeued', {
					executionId: job.data.executionId,
					workflowId: job.data.workflowId,
					hostId: this.hostId,
					jobId: String(job.id),
				});

				if (!this.hasValidJobData(job)) {
					throw new UnexpectedError('Worker received invalid job');
				}

				const result = await this.jobProcessor.processJob(job);
				if (result.success) this.jobCounters.completed += 1;
				else this.jobCounters.failed += 1;
			} catch (error) {
				await this.reportJobProcessingError(toError(error), job);
			}
		});
	}

	async stopWorker(): Promise<void> {
		this.assertWorker();
		this.stopQueueRecovery();
	}

	/** Q12 — mark `new`/`running` executions absent from the queue as `crashed`. */
	async recoverFromQueue(): Promise<number> {
		const { waitMs, batchSize } = this.queueRecoveryContext;
		const repository = this.executionRepository;
		if (!repository) return waitMs;

		const storedIds = await repository.getInProgressExecutionIds(batchSize);
		if (storedIds.length === 0) return waitMs;

		const jobs = await (this.queue as MemoryJobQueue).getJobs(['active', 'waiting']);
		const queuedIds = new Set(jobs.map((job) => job.data.executionId));
		const danglingIds = storedIds.filter((id) => !queuedIds.has(id));

		if (danglingIds.length === 0) return waitMs;

		await repository.markAsCrashed(danglingIds);

		return storedIds.length >= batchSize ? waitMs / 2 : waitMs;
	}

	scheduleQueueRecovery(waitMs = this.queueRecoveryContext.waitMs): void {
		this.recoveryTimer = setTimeout(() => {
			void this.recoverFromQueue().finally(() => this.scheduleQueueRecovery());
		}, waitMs);
		// keep the process free — a real deployment owns the timer loop
		if (typeof this.recoveryTimer === 'object' && 'unref' in this.recoveryTimer) {
			this.recoveryTimer.unref?.();
		}
	}

	stopQueueRecovery(): void {
		if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
		this.recoveryTimer = undefined;
	}

	scheduleQueueMetrics(intervalMs = 1000): void {
		this.metricsTimer = setInterval(() => {
			void this.getPendingJobCounts().then((pendingJobCounts) => {
				this.eventService?.emit('job-counts-updated', {
					...pendingJobCounts,
					...this.jobCounters,
				});
				this.jobCounters.completed = 0;
				this.jobCounters.failed = 0;
			});
		}, intervalMs);
		this.metricsTimer.unref?.();
	}

	stopQueueMetrics(): void {
		if (this.metricsTimer) clearInterval(this.metricsTimer);
		this.metricsTimer = undefined;
	}

	// #endregion

	// #region Helpers

	async getPendingJobCounts(): Promise<Record<string, number>> {
		this.assertQueue();
		return (this.queue as MemoryJobQueue).getJobCounts('active', 'waiting');
	}

	getQueue(): MemoryJobQueue {
		this.assertQueue();
		return this.queue as MemoryJobQueue;
	}

	hasValidJobData(job: Job): boolean {
		const data = job?.data as unknown;
		return (
			typeof data === 'object' &&
			data !== null &&
			!Array.isArray(data) &&
			'executionId' in (data as object) &&
			'loadStaticData' in (data as object)
		);
	}

	async reportJobProcessingError(error: Error, job: Job): Promise<void> {
		const { executionId, workflowId } = job.data;
		const msg: JobFailedMessage = {
			kind: 'job-failed',
			executionId,
			workerId: this.hostId,
			errorMsg: error.message,
			errorStack: error.stack ?? '',
		};
		await job.progress(msg);
		this.jobCounters.failed += 1;
		this.eventService?.emit('job-failed', { executionId, workflowId, errorMsg: error.message });
	}

	// #endregion

	// #region Guards

	private assertWorker() {
		if (this.instanceType !== 'worker') {
			throw new UnexpectedError('Expected instance to be of type "worker"');
		}
	}

	private assertQueue() {
		if (!this.queue) {
			throw new UnexpectedError('Queue is not initialized. Call setupQueue() first.');
		}
	}

	private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: unknown) {
		if (level === 'error') this.eventService?.emit('queue-error', { message, meta });
	}

	// #endregion
}

/* ------------------------------------------------------------------ *
 * Q14 — WorkerServer endpoint contract (scaling/worker-server.ts)
 * ------------------------------------------------------------------ */

export type WorkerServerEndpointsConfig = {
	health: boolean;
	overwrites: boolean;
	metrics: boolean;
};

export const WORKER_SERVER_ENDPOINTS: WorkerServerEndpointsConfig = {
	health: true,
	overwrites: true,
	metrics: true,
};

/* ------------------------------------------------------------------ *
 * Factory — wiring used by the facade / integration runner
 * ------------------------------------------------------------------ */

export type QueueRuntimeOptions = {
	hostId?: string;
	broker?: MemoryPubSubBroker;
	concurrency?: number;
	leader?: boolean;
};

export type QueueRuntime = {
	broker: MemoryPubSubBroker;
	scaling: ScalingService;
	jobProcessor: JobProcessor;
	executions: MemoryExecutionRepository;
	workflows: MemoryWorkflowRepository;
	events: TypedEmitter;
};

export function createQueueRuntime(options: QueueRuntimeOptions = {}): QueueRuntime {
	const broker = options.broker ?? new MemoryPubSubBroker();
	const events = new TypedEmitter();
	const executions = new MemoryExecutionRepository();
	const workflows = new MemoryWorkflowRepository();

	const jobProcessor = new JobProcessor({
		hostId: options.hostId ?? 'worker-1',
		executionRepository: executions,
		workflowRepository: workflows,
		eventService: events,
	});

	const scaling = new ScalingService({
		hostId: options.hostId ?? 'worker-1',
		instanceType: 'worker',
		isLeader: options.leader ?? false,
		broker,
		jobProcessor,
		executionRepository: executions,
		eventService: events,
	});

	return { broker, scaling, jobProcessor, executions, workflows, events };
}

export function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
