/**
 * QUEUE LEGO — port surface.
 *
 * The surface is a *frozen list of what other LEGOs may consume*. Anything not
 * listed here is internal to the queue subsystem (docs/isolation/queue.md §2).
 *
 * Provenance is enforced: `tools/queue-isolation-gate.mjs` re-reads the reference
 * source and fails when a symbol below stops matching n8n 2.9.4.
 */

export const QUEUE_REFERENCE = {
	package: 'n8n (cli)',
	upstreamCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
	version: '2.9.4',
	files: [
		'packages/cli/src/scaling/constants.ts',
		'packages/cli/src/scaling/scaling.types.ts',
		'packages/cli/src/scaling/scaling.service.ts',
		'packages/cli/src/scaling/job-processor.ts',
		'packages/cli/src/scaling/worker-server.ts',
		'packages/cli/src/scaling/worker-status.service.ee.ts',
		'packages/cli/src/scaling/pubsub/publisher.service.ts',
		'packages/cli/src/scaling/pubsub/subscriber.service.ts',
		'packages/cli/src/scaling/pubsub/pubsub.types.ts',
		'packages/cli/src/scaling/pubsub/pubsub.event-map.ts',
	],
} as const;

/** Ports consumed from other LEGOs (declared, never hidden). */
export const QUEUE_CONSUMED_PORTS = [
	{ port: '@lego/events', symbols: ['EventService'], kind: 'value' },
	{ port: '@lego/persistence', symbols: ['ExecutionRepository', 'WorkflowRepository'], kind: 'value' },
	{ port: '@lego/realtime', symbols: ['Push.sendToUsers'], kind: 'value' },
	{ port: '@lego/execution', symbols: ['WorkflowExecute', 'ManualExecutionService'], kind: 'value' },
] as const;

/** Ports provided to other LEGOs. */
export const QUEUE_PROVIDED_PORTS = [
	{ port: 'P-QUEUE-SCALING', symbols: ['ScalingService', 'JobProcessor', 'MemoryJobQueue'] },
	{ port: 'P-QUEUE-PUBSUB', symbols: ['Publisher', 'Subscriber', 'MemoryPubSubBroker'] },
	{ port: 'P-QUEUE-STATUS', symbols: ['WorkerServer endpoints', 'WorkerStatusService'] },
] as const;

/** Invariants enforced by the gate and the package tests. */
export const QUEUE_INVARIANTS = [
	'Q1 queue/channel names are byte-exact (jobs, job, n8n.commands, n8n.worker-response, n8n.mcp-relay)',
	'Q2 SELF_SEND_COMMANDS = {add-webhooks-triggers-and-pollers, remove-triggers-and-pollers}',
	'Q3 IMMEDIATE_COMMANDS = {add-webhooks-triggers-and-pollers, remove-triggers-and-pollers, relay-execution-lifecycle-event, relay-chat-stream-event}',
	'Q4 job message kinds: respond-to-webhook, job-finished (v1|v2), job-failed, abort-job, send-chunk, mcp-response',
	'Q5 publisher decorates {senderId, selfSend, debounce} and is inert outside queue mode',
	'Q6 bus channels are prefixed with the redis prefix (n8n:<channel>)',
	'Q7 subscriber drops self-messages unless selfSend, honours targets, debounces non-immediate commands',
	'Q8 queue settings force maxStalledCount: 0',
	'Q9 worker rejects invalid job data with "Worker received invalid job"',
	'Q10 crashed executions are skipped without running (success: false)',
	'Q11 missing execution → "Worker failed to find data for execution <id> (job <id>)"',
	'Q12 queue recovery marks dangling new/running executions as crashed and halves the wait on a full batch',
	'Q13 get-worker-status round trip → response-to-get-worker-status → push sendWorkerStatusMessage to the requester',
	'Q14 queue metrics emit job-counts-updated then reset the completed/failed counters',
] as const;
