/**
 * @lego/queue — QUEUE (scaling / queue mode) LEGO entry point.
 *
 * Boundary: this package may only depend on the published ports above
 * (see `./model-surface.ts`) and on `@lego/reconstructed-engine`'s queue engine.
 * Rust: NOT STARTED — ZERO RUST per PROJECT_RULES.md §1.
 */

export {
	QUEUE_NAME,
	JOB_TYPE_NAME,
	COMMAND_PUBSUB_CHANNEL,
	WORKER_RESPONSE_PUBSUB_CHANNEL,
	MCP_RELAY_PUBSUB_CHANNEL,
	SELF_SEND_COMMANDS,
	IMMEDIATE_COMMANDS,
	QUEUE_RECOVERY_DEFAULTS,
	WORKER_SERVER_ENDPOINTS,
	Publisher,
	Subscriber,
	MemoryPubSubBroker,
	MemoryJobQueue,
	MemoryExecutionRepository,
	MemoryWorkflowRepository,
	JobProcessor,
	ScalingService,
	UnexpectedError,
	createQueueRuntime,
	toError,
} from '../../reconstructed-engine/src/queue-engine.ts';

export type {
	AbortJobMessage,
	ExecutionRecord,
	ExecutionStatus,
	InstanceType,
	Job,
	JobData,
	JobFinishedMessage,
	JobFinishedProps,
	JobMessage,
	JobResult,
	JobStatus,
	McpResponseMessage,
	PubSubCommand,
	PubSubWorkerResponse,
	QueueRecoveryConfig,
	QueueRecoveryContext,
	QueueRuntime,
	RespondToWebhookMessage,
	SendChunkMessage,
	WorkerServerEndpointsConfig,
} from '../../reconstructed-engine/src/queue-engine.ts';

export * from './model-surface.ts';
