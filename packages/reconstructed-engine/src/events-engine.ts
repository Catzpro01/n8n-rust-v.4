/**
 * EVENTS LEGO — internal event bus + relays reconstruction.
 *
 * Reference: n8n 2.9.4
 *   packages/cli/src/events/event.service.ts            (EventService = TypedEmitter<EventMap>)
 *   packages/cli/src/events/events.controller.ts        (GET /events/session-started)
 *   packages/cli/src/events/maps/relay.event-map.ts     (93 relay event names)
 *   packages/cli/src/events/maps/queue-metrics.event-map.ts
 *   packages/cli/src/events/maps/ai.event-map.ts
 *   packages/cli/src/events/relays/event-relay.ts       (base relay)
 *   packages/cli/src/events/relays/log-streaming.event-relay.ts
 *   packages/cli/src/events/relays/workflow-failure-notification.event-relay.ts
 *   packages/cli/src/eventbus/message-event-bus/message-event-bus.ts
 *   packages/cli/src/eventbus/event-message-classes/**
 * Upstream commit pinned by the reference manifest: b6dc2787c45677a29a9612cd27eb911302961a83
 *
 * ZERO RUST: JavaScript/TypeScript only, per PROJECT_RULES.md §1.
 * Invariants defined in docs/isolation/events.md: E1..E12.
 */

import { TypedEmitter } from './emitter.ts';

/* ------------------------------------------------------------------ *
 * E1 — relay event map (events/maps/relay.event-map.ts)
 *
 * The catalogue below is the *name* set only; payload shapes stay open like the
 * reference map (each key maps to an object literal type). The gate
 * `tools/events-isolation-gate.mjs` re-parses the reference file and fails if the
 * catalogue here drifts from the pinned source.
 * ------------------------------------------------------------------ */

export const RELAY_EVENT_NAMES = [
	'server-started',
	'session-started',
	'instance-stopped',
	'instance-owner-setup',
	'first-production-workflow-succeeded',
	'instance-first-production-workflow-failed',
	'first-workflow-data-loaded',
	'workflow-created',
	'workflow-deleted',
	'workflow-archived',
	'workflow-unarchived',
	'workflow-saved',
	'workflow-activated',
	'workflow-deactivated',
	'workflow-pre-execute',
	'workflow-post-execute',
	'workflow-sharing-updated',
	'workflow-executed',
	'workflow-version-updated',
	'node-pre-execute',
	'node-post-execute',
	'user-submitted-personalization-survey',
	'user-deleted',
	'user-invited',
	'user-reinvited',
	'user-updated',
	'user-mfa-enabled',
	'user-mfa-disabled',
	'user-signed-up',
	'user-logged-in',
	'user-login-failed',
	'user-changed-role',
	'user-retrieved-user',
	'user-retrieved-all-users',
	'user-retrieved-execution',
	'user-retrieved-all-executions',
	'user-retried-execution',
	'user-retrieved-workflow',
	'user-retrieved-workflow-version',
	'user-retrieved-all-workflows',
	'user-invite-email-click',
	'user-password-reset-email-click',
	'user-password-reset-request-click',
	'user-transactional-email-sent',
	'public-api-key-created',
	'public-api-key-deleted',
	'public-api-invoked',
	'email-failed',
	'credentials-created',
	'credentials-shared',
	'credentials-updated',
	'credentials-deleted',
	'community-package-installed',
	'community-package-updated',
	'community-package-deleted',
	'execution-throttled',
	'execution-started-during-bootup',
	'execution-cancelled',
	'execution-deleted',
	'team-project-updated',
	'team-project-deleted',
	'team-project-created',
	'source-control-settings-updated',
	'source-control-user-started-pull-ui',
	'source-control-user-finished-pull-ui',
	'source-control-user-pulled-api',
	'source-control-user-started-push-ui',
	'source-control-user-finished-push-ui',
	'license-renewal-attempted',
	'license-community-plus-registered',
	'variable-created',
	'variable-updated',
	'variable-deleted',
	'external-secrets-provider-settings-saved',
	'external-secrets-provider-reloaded',
	'external-secrets-connection-created',
	'external-secrets-connection-updated',
	'external-secrets-connection-deleted',
	'external-secrets-connection-tested',
	'external-secrets-connection-reloaded',
	'ldap-general-sync-finished',
	'ldap-settings-updated',
	'ldap-login-sync-failed',
	'login-failed-due-to-ldap-disabled',
	'sso-user-project-access-updated',
	'sso-user-instance-role-updated',
	'runner-task-requested',
	'runner-response-received',
	'job-enqueued',
	'job-dequeued',
	'job-stalled',
	'history-compacted',
	'instance-policies-updated',
] as const;

/** events/maps/queue-metrics.event-map.ts */
export const QUEUE_METRICS_EVENT_NAMES = ['job-counts-updated'] as const;

/** events/maps/ai.event-map.ts */
export const AI_EVENT_NAMES = [
	'ai-messages-retrieved-from-memory',
	'ai-message-added-to-memory',
	'ai-output-parsed',
	'ai-documents-retrieved',
	'ai-document-embedded',
	'ai-query-embedded',
	'ai-document-processed',
	'ai-text-split',
	'ai-tool-called',
	'ai-vector-store-searched',
	'ai-llm-generated-output',
	'ai-llm-errored',
	'ai-vector-store-populated',
	'ai-vector-store-updated',
] as const;

export type EventMapNames =
	| (typeof RELAY_EVENT_NAMES)[number]
	| (typeof QUEUE_METRICS_EVENT_NAMES)[number]
	| (typeof AI_EVENT_NAMES)[number];

/**
 * E2 — EventService. `@Service()` in the reference; here a plain class so the LEGO
 * has no DI-container dependency. Semantics: TypedEmitter<EventMap>, sync emit.
 */
export class EventService extends TypedEmitter {
	/** Convenience twin of `EventsController.sessionStarted` (GET /events/session-started). */
	sessionStarted(pushRef?: string) {
		this.emit('session-started', { pushRef });
	}
}

/* ------------------------------------------------------------------ *
 * E3 — message types + envelope (eventbus/event-message-classes/**)
 * ------------------------------------------------------------------ */

export type EventMessageType =
	| 'audit'
	| 'confirm'
	| 'execution'
	| 'generic'
	| 'node'
	| 'queue'
	| 'runner'
	| 'workflow'
	| 'ai-node';

export type EventMessagePayload = {
	__type: string;
	[property: string]: unknown;
};

export type EventMessageConfirmSource = {
	received: Date;
	msgId: string;
	mainId?: string;
};

/** abstract-event-message.ts */
export class AbstractEventMessage {
	readonly __type: EventMessageType | 'event';

	eventName = '';

	payload: EventMessagePayload = { __type: '' };

	id = '';

	ts = new Date().toISOString();

	constructor(__type: EventMessageType | 'event') {
		this.__type = __type;
	}

	setPayload(payload: Record<string, unknown>): this {
		this.payload = { __type: this.eventName, ...payload };
		return this;
	}

	toJSON(): Record<string, unknown> {
		return {
			__type: this.__type,
			eventName: this.eventName,
			payload: this.payload,
			id: this.id,
			ts: this.ts,
		};
	}
}

/** event-message-workflow.ts / -node.ts / -execution.ts / -queue.ts / -audit.ts / -generic.ts */
export class EventMessageWorkflow extends AbstractEventMessage {
	constructor(eventName: string, payload: Record<string, unknown> = {}) {
		super('workflow');
		this.eventName = eventName;
		this.setPayload(payload);
	}
}

export class EventMessageNode extends AbstractEventMessage {
	constructor(eventName: string, payload: Record<string, unknown> = {}) {
		super('node');
		this.eventName = eventName;
		this.setPayload(payload);
	}
}

export class EventMessageExecution extends AbstractEventMessage {
	constructor(eventName: string, payload: Record<string, unknown> = {}) {
		super('execution');
		this.eventName = eventName;
		this.setPayload(payload);
	}
}

export class EventMessageQueue extends AbstractEventMessage {
	constructor(eventName: string, payload: Record<string, unknown> = {}) {
		super('queue');
		this.eventName = eventName;
		this.setPayload(payload);
	}
}

export class EventMessageAudit extends AbstractEventMessage {
	constructor(eventName: string, payload: Record<string, unknown> = {}) {
		super('audit');
		this.eventName = eventName;
		this.setPayload(payload);
	}
}

export class EventMessageGeneric extends AbstractEventMessage {
	constructor(eventName: string, payload: Record<string, unknown> = {}) {
		super('generic');
		this.eventName = eventName;
		this.setPayload(payload);
	}
}

export type EventMessage =
	| EventMessageWorkflow
	| EventMessageNode
	| EventMessageExecution
	| EventMessageQueue
	| EventMessageAudit
	| EventMessageGeneric;

/* ------------------------------------------------------------------ *
 * E4 — MessageEventBus (eventbus/message-event-bus/message-event-bus.ts)
 * ------------------------------------------------------------------ */

export type EventDestination = {
	/** Destination id as stored by the reference (`IDestination.id`). */
	id: string;
	type: string;
	enabled: boolean;
	sendMessage: (msg: EventMessage) => void | Promise<void>;
};

export type EventBusLogWriter = {
	storeMessage: (msg: EventMessage) => Promise<void> | void;
	fetchMessages: () => Promise<EventMessage[]> | EventMessage[];
};

export type MessageEventBusOptions = {
	/** `logs.streamingManagedBy` — when false the bus does not write logs itself. */
	managedByInstance?: boolean;
	writer?: EventBusLogWriter;
	destinations?: EventDestination[];
	retryWaitMs?: number;
};

/**
 * E5 — the unconfirmed-retry queue. The reference keeps non-confirmed messages and
 * retries them on a timer; the reconstruction keeps the same state machine and lets
 * the caller drive the clock (`processRetryQueue()`), so behaviour is testable.
 */
export class MessageEventBus {
	readonly destinations: EventDestination[] = [];

	readonly unconfirmedMessages: Record<string, { msg: EventMessage; waitMs: number }> = {};

	private readonly writer?: EventBusLogWriter;

	private readonly managedByInstance: boolean;

	readonly retryWaitMs: number;

	/** Messages handed to destinations/log writer, in order (evidence for tests). */
	readonly sentMessages: EventMessage[] = [];

	private retryTimer?: ReturnType<typeof setInterval>;

	constructor(options: MessageEventBusOptions = {}) {
		this.managedByInstance = options.managedByInstance ?? true;
		this.writer = options.writer;
		this.retryWaitMs = options.retryWaitMs ?? 1000;
		for (const destination of options.destinations ?? []) this.destinations.push(destination);
	}

	addDestination(destination: EventDestination) {
		this.destinations.push(destination);
	}

	async send(msgs: EventMessage | EventMessage[]): Promise<void> {
		for (const msg of Array.isArray(msgs) ? msgs : [msgs]) {
			this.sentMessages.push(msg);

			if (this.managedByInstance && this.writer) {
				await this.writer.storeMessage(msg);
			}

			for (const destination of this.destinations) {
				if (!destination.enabled) continue;
				await destination.sendMessage(msg);
			}

			if (!msg.id) {
				msg.id = createEventMessageId();
			}

			// E6 — unconfirmed messages wait for `confirmSent` (message-event-bus confirm flow)
			this.unconfirmedMessages[msg.id] = { msg, waitMs: this.retryWaitMs };
		}
	}

	/** `confirmSent` — removes the message from the retry queue. */
	confirmSent(msg: EventMessage, _source?: EventMessageConfirmSource): void {
		if (msg.id) delete this.unconfirmedMessages[msg.id];
	}

	/** `startLogWriter`/`rewriteAdminLoggingConfig` twin: the retry loop. */
	startRetryLoop(intervalMs = this.retryWaitMs): void {
		if (this.retryTimer) return;
		this.retryTimer = setInterval(() => void this.processRetryQueue(), intervalMs);
		this.retryTimer.unref?.();
	}

	async processRetryQueue(): Promise<void> {
		for (const [id, entry] of Object.entries(this.unconfirmedMessages)) {
			for (const destination of this.destinations) {
				if (!destination.enabled) continue;
				await destination.sendMessage(entry.msg);
			}
			entry.waitMs += this.retryWaitMs;
			void id;
		}
	}

	stopRetryLoop(): void {
		if (this.retryTimer) clearInterval(this.retryTimer);
		this.retryTimer = undefined;
	}

	/** `sendAuditEvent` — the reference exposes one helper per payload class. */
	async sendAuditEvent(options: { eventName: string; [key: string]: unknown }) {
		const { eventName, ...payload } = options;
		return await this.send(new EventMessageAudit(eventName, payload));
	}

	async sendWorkflowEvent(options: { eventName: string; [key: string]: unknown }) {
		const { eventName, ...payload } = options;
		return await this.send(new EventMessageWorkflow(eventName, payload));
	}

	async sendNodeEvent(options: { eventName: string; [key: string]: unknown }) {
		const { eventName, ...payload } = options;
		return await this.send(new EventMessageNode(eventName, payload));
	}

	async sendExecutionEvent(options: { eventName: string; [key: string]: unknown }) {
		const { eventName, ...payload } = options;
		return await this.send(new EventMessageExecution(eventName, payload));
	}

	async sendQueueEvent(options: { eventName: string; [key: string]: unknown }) {
		const { eventName, ...payload } = options;
		return await this.send(new EventMessageQueue(eventName, payload));
	}

	async sendAiNodeEvent(options: { eventName: string; [key: string]: unknown }) {
		const { eventName, ...payload } = options;
		const msg = new EventMessageGeneric(eventName, payload);
		msg.eventName = eventName;
		return await this.send(msg);
	}

	async sendRunnerEvent(options: { eventName: string; [key: string]: unknown }) {
		const { eventName, ...payload } = options;
		return await this.send(new EventMessageGeneric(eventName, payload));
	}

	async close(): Promise<void> {
		this.stopRetryLoop();
	}
}

let eventMessageCounter = 0;

export function createEventMessageId(): string {
	eventMessageCounter += 1;
	return `event-msg-${eventMessageCounter}`;
}

/* ------------------------------------------------------------------ *
 * E7 — relays (events/relays/*)
 * ------------------------------------------------------------------ */

export type RelayEvents = {
	/** The event name this relay subscribes to. */
	event: string;
	/** The message the relay produces. */
	message: EventMessage;
};

/** events/relays/event-relay.ts — base relay, `onEvent` → `eventBus.send`. */
export class EventRelay {
	protected readonly eventBus: MessageEventBus;

	constructor(eventBus: MessageEventBus) {
		this.eventBus = eventBus;
	}

	/** Overridden by concrete relays; the base only documents the seam. */
	protected async onEvent(_event: unknown): Promise<EventMessage | undefined> {
		return undefined;
	}

	async relay(event: unknown): Promise<void> {
		const message = await this.onEvent(event);
		if (message) await this.eventBus.send(message);
	}
}

/**
 * events/relays/log-streaming.event-relay.ts — subscribes to *every* event on the
 * EventService and forwards it to the message event bus.
 */
export class LogStreamingEventRelay extends EventRelay {
	private readonly eventService: EventService;

	readonly subscriptionCount: number;

	constructor(eventService: EventService, eventBus: MessageEventBus, eventNames: readonly string[]) {
		super(eventBus);
		this.eventService = eventService;

		for (const eventName of eventNames) {
			this.eventService.on(eventName, (payload) => {
				void this.relayToBus(eventName, payload);
			});
		}

		this.subscriptionCount = eventNames.length;
	}

	private async relayToBus(eventName: string, payload: unknown): Promise<void> {
		const message = new EventMessageGeneric(eventName, (payload ?? {}) as Record<string, unknown>);
		const header = classifyEventName(eventName);
		message.eventName = eventName;
		(message as unknown as { __type: EventMessageType }).__type = header;
		await this.eventBus.send(message);
	}
}

/** E8 — event name → message class mapping used by the log-streaming relay. */
export function classifyEventName(eventName: string): EventMessageType {
	if (eventName.startsWith('workflow-') || eventName.startsWith('first-workflow')) return 'workflow';
	if (eventName.startsWith('node-')) return 'node';
	if (eventName.startsWith('execution-') || eventName.startsWith('instance-first-production')) {
		return 'execution';
	}
	if (eventName.startsWith('job-')) return 'queue';
	if (eventName.startsWith('user-') || eventName.startsWith('public-api-')) return 'audit';
	if (eventName.startsWith('ai-')) return 'ai-node';
	return 'generic';
}

/**
 * events/relays/workflow-failure-notification.event-relay.ts — `workflow-post-execute`
 * with a failed execution is turned into an error notification push message.
 */
export class WorkflowFailureNotificationEventRelay {
	private readonly eventService: EventService;

	readonly notifications: Array<{ workflowId: string; message: string; type: 'error' }> = [];

	constructor(eventService: EventService) {
		this.eventService = eventService;
		this.eventService.on('workflow-post-execute', (event: unknown) => this.onPostExecute(event));
	}

	private onPostExecute(event: unknown): void {
		const payload = (event ?? {}) as {
			workflow?: { id?: string };
			execution?: { status?: string };
		};
		if (payload.execution?.status !== 'crashed' && payload.execution?.status !== 'error') return;
		this.notifications.push({
			workflowId: payload.workflow?.id ?? 'unknown',
			message: 'Workflow execution failed',
			type: 'error',
		});
	}
}

/* ------------------------------------------------------------------ *
 * E9 — wiring helper used by the facade / integration runner
 * ------------------------------------------------------------------ */

export type EventRuntime = {
	eventService: EventService;
	eventBus: MessageEventBus;
	logStreaming: LogStreamingEventRelay;
	failureNotifications: WorkflowFailureNotificationEventRelay;
};

export function createEventRuntime(options: { writer?: EventBusLogWriter } = {}): EventRuntime {
	const eventService = new EventService();
	const eventBus = new MessageEventBus({ writer: options.writer });

	const allNames = [...RELAY_EVENT_NAMES, ...QUEUE_METRICS_EVENT_NAMES, ...AI_EVENT_NAMES];
	const logStreaming = new LogStreamingEventRelay(eventService, eventBus, allNames);
	const failureNotifications = new WorkflowFailureNotificationEventRelay(eventService);

	return { eventService, eventBus, logStreaming, failureNotifications };
}
