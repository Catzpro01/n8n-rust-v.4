/**
 * EVENTS LEGO — port surface (frozen).
 *
 * `tools/events-isolation-gate.mjs` re-parses the reference event maps and fails when
 * this surface drifts from n8n 2.9.4.
 */

export const EVENTS_REFERENCE = {
	package: 'n8n (cli)',
	upstreamCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
	version: '2.9.4',
	files: [
		'packages/cli/src/events/event.service.ts',
		'packages/cli/src/events/events.controller.ts',
		'packages/cli/src/events/maps/relay.event-map.ts',
		'packages/cli/src/events/maps/queue-metrics.event-map.ts',
		'packages/cli/src/events/maps/ai.event-map.ts',
		'packages/cli/src/events/relays/event-relay.ts',
		'packages/cli/src/events/relays/log-streaming.event-relay.ts',
		'packages/cli/src/events/relays/workflow-failure-notification.event-relay.ts',
		'packages/cli/src/eventbus/message-event-bus/message-event-bus.ts',
		'packages/cli/src/eventbus/event-message-classes/**',
	],
} as const;

export const EVENTS_CONSUMED_PORTS = [
	{ port: '@lego/queue', symbols: ['job-counts-updated payload'], kind: 'type' },
	{ port: '@lego/realtime', symbols: ['Push.sendToUsers'], kind: 'value' },
	{ port: '@lego/persistence', symbols: ['ExecutionRepository'], kind: 'value' },
] as const;

export const EVENTS_PROVIDED_PORTS = [
	{ port: 'P-EVENTS-SERVICE', symbols: ['EventService', 'RELAY_EVENT_NAMES'] },
	{ port: 'P-EVENTS-BUS', symbols: ['MessageEventBus', 'EventMessage*', 'EventDestination'] },
	{ port: 'P-EVENTS-RELAYS', symbols: ['EventRelay', 'LogStreamingEventRelay', 'WorkflowFailureNotificationEventRelay'] },
] as const;

export const EVENTS_INVARIANTS = [
	'E1 the relay event catalogue matches relay.event-map.ts key-for-key (93 names at 2.9.4)',
	'E2 EventService is a TypedEmitter<EventMap>; `emit` is synchronous',
	'E3 event messages carry { __type, eventName, payload, id, ts } and payload.__type === eventName',
	'E4 the message event bus fans out to enabled destinations only',
	'E5 unconfirmed messages stay in the retry queue until confirmSent',
	'E6 retry ticks re-deliver every unconfirmed message and grow its waitMs',
	'E7 log-streaming relay subscribes to every event name in the catalogue',
	'E8 event name → message class mapping (workflow/node/execution/queue/audit/ai-node/generic)',
	'E9 workflow-post-execute with status error|crashed raises a failure notification',
	'E10 `session-started` is emitted by the events controller with { pushRef }',
	'E11 the bus logs through the log writer only when streaming is managed by the instance',
	'E12 helper senders (sendAuditEvent/sendWorkflowEvent/sendNodeEvent/sendExecutionEvent/sendQueueEvent) exist',
] as const;
