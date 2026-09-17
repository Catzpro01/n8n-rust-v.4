/**
 * @lego/events — EVENTS (event service + message event bus + relays) LEGO entry point.
 *
 * Boundary: consumes only declared ports (./model-surface.ts). Rust: NOT STARTED.
 */

export {
	RELAY_EVENT_NAMES,
	QUEUE_METRICS_EVENT_NAMES,
	AI_EVENT_NAMES,
	EventService,
	AbstractEventMessage,
	EventMessageWorkflow,
	EventMessageNode,
	EventMessageExecution,
	EventMessageQueue,
	EventMessageAudit,
	EventMessageGeneric,
	MessageEventBus,
	EventRelay,
	LogStreamingEventRelay,
	WorkflowFailureNotificationEventRelay,
	classifyEventName,
	createEventMessageId,
	createEventRuntime,
} from '../../reconstructed-engine/src/events-engine.ts';

export type {
	EventMapNames,
	EventMessage,
	EventMessagePayload,
	EventMessageType,
	EventMessageConfirmSource,
	EventDestination,
	EventBusLogWriter,
	MessageEventBusOptions,
	EventRuntime,
} from '../../reconstructed-engine/src/events-engine.ts';

export * from './model-surface.ts';
