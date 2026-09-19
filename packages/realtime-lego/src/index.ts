/**
 * @lego/realtime — REALTIME (push: SSE + WebSocket) LEGO entry point.
 *
 * Boundary: consumes only declared ports (./model-surface.ts). Rust: NOT STARTED.
 */

export {
	DEFAULT_PUSH_BACKEND,
	MAX_PAYLOAD_SIZE_BYTES,
	PING_INTERVAL_MS,
	PUSH_MESSAGE_TYPE_GROUPS,
	AbstractPush,
	SSEPush,
	WebSocketPush,
	PushService,
	createHeartbeatMessage,
	isHeartbeatMessage,
	validateOriginHeaders,
	stringifyPushMessage,
	createMemoryResponse,
	createMemoryRequest,
	createMemoryWebSocket,
} from '../../reconstructed-engine/src/realtime-engine.ts';

export type {
	HeartbeatMessage,
	OnPushMessage,
	OriginValidationResult,
	PushBackend,
	PushMessage,
	PushMessageType,
	PushPublisher,
	PushRequest,
	PushResponse,
	PushServiceOptions,
	SSEConnection,
	WebSocketLike,
} from '../../reconstructed-engine/src/realtime-engine.ts';

export * from './model-surface.ts';
