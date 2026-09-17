/**
 * REALTIME LEGO — port surface (frozen).
 *
 * `tools/realtime-isolation-gate.mjs` re-reads `packages/cli/src/push/**` and fails when
 * this surface drifts from n8n 2.9.4.
 */

export const REALTIME_REFERENCE = {
	package: 'n8n (cli)',
	upstreamCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
	version: '2.9.4',
	files: [
		'packages/cli/src/push/push.config.ts',
		'packages/cli/src/push/types.ts',
		'packages/cli/src/push/abstract.push.ts',
		'packages/cli/src/push/sse.push.ts',
		'packages/cli/src/push/websocket.push.ts',
		'packages/cli/src/push/origin-validator.ts',
		'packages/cli/src/push/index.ts',
		'packages/@n8n/api-types/src/push/**',
	],
} as const;

export const REALTIME_CONSUMED_PORTS = [
	{ port: '@lego/queue', symbols: ['Publisher.publishCommand'], kind: 'value' },
	{ port: '@lego/events', symbols: ['EventService'], kind: 'value' },
	{ port: '@lego/credentials', symbols: ['AuthService.createAuthMiddleware'], kind: 'value' },
] as const;

export const REALTIME_PROVIDED_PORTS = [
	{ port: 'P-PUSH-SERVICE', symbols: ['PushService', 'PushMessage', 'MAX_PAYLOAD_SIZE_BYTES'] },
	{ port: 'P-PUSH-BACKENDS', symbols: ['SSEPush', 'WebSocketPush', 'AbstractPush'] },
	{ port: 'P-PUSH-ORIGIN', symbols: ['validateOriginHeaders'] },
] as const;

export const REALTIME_INVARIANTS = [
	'R1 N8N_PUSH_BACKEND defaults to websocket; MAX_PAYLOAD_SIZE_BYTES = 5 MiB; ping interval = 60 s',
	'R2 the PushMessage catalogue groups execution/workflow/webhook/worker/hotReload/collaboration messages',
	'R3 a session is keyed by pushRef and mapped to a user id',
	'R4 sendToAll/sendToOne/sendToUsers serialize {type, data} with circular refs replaced',
	'R5 registering an existing pushRef closes the previous connection first',
	'R6 SSE handshake is byte-exact: text/event-stream; charset=UTF-8, no-cache, keep-alive, ":ok" then flush',
	'R7 SSE frames are "data: <json>\\n\\n"; pings are ":ping\\n\\n"',
	'R8 SSE sessions are removed on req end/close and res finish',
	'R9 WebSocket connections keep isAlive, ping every 60 s and terminate after a missed pong',
	'R10 client heartbeat frames ({type:"heartbeat"}) are swallowed; malformed frames are reported, not thrown',
	'R11 origin validation order is Forwarded → X-Forwarded-Host/X-Forwarded-Proto → Host, default ports stripped',
	'R12 production mode rejects missing pushRef ("The query parameter \\"pushRef\\" is missing!") and bad origins ("Invalid origin!")',
	'R13 a worker / non-holding main relays via pubsub and drops nodeExecuteAfterData payloads above 5 MiB',
] as const;
