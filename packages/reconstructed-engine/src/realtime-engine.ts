/**
 * REALTIME LEGO — push (SSE / WebSocket) subsystem reconstruction.
 *
 * Reference: n8n 2.9.4 — `reference/n8n/packages/cli/src/push/**`
 *   push/push.config.ts        (N8N_PUSH_BACKEND, default 'websocket')
 *   push/types.ts              (PushRequest / PushResponse / OnPushMessage)
 *   push/abstract.push.ts      (session registry, sendToAll/One/Users, 60s ping)
 *   push/sse.push.ts           (server-sent events wire format)
 *   push/websocket.push.ts     (heartbeat/ping-pong, client heartbeat frames)
 *   push/origin-validator.ts   (RFC 7239 Forwarded → X-Forwarded-* → Host)
 *   push/index.ts              (Push service: backend selection, pubsub relay, 5 MiB guard)
 *   packages/@n8n/api-types/src/push/**  (PushMessage catalogue, heartbeat schema)
 * Upstream commit pinned by the reference manifest: b6dc2787c45677a29a9612cd27eb911302961a83
 *
 * ZERO RUST: JavaScript/TypeScript only, per PROJECT_RULES.md §1.
 * Invariants defined in docs/isolation/realtime.md: R1..R13.
 */

import { TypedEmitter } from './emitter.ts';

/* ------------------------------------------------------------------ *
 * R1 — configuration + constants (push.config.ts, push/index.ts)
 * ------------------------------------------------------------------ */

export type PushBackend = 'sse' | 'websocket';

/** `N8N_PUSH_BACKEND`, default `'websocket'` (push.config.ts). */
export const DEFAULT_PUSH_BACKEND: PushBackend = 'websocket';

/** `MAX_PAYLOAD_SIZE_BYTES = 5 * 1024 * 1024` (push/index.ts). */
export const MAX_PAYLOAD_SIZE_BYTES = 5 * 1024 * 1024;

/** Heartbeat of `AbstractPush` — ping every connection every 60 seconds. */
export const PING_INTERVAL_MS = 60 * 1000;

/* ------------------------------------------------------------------ *
 * R2 — message catalogue (packages/@n8n/api-types/src/push/**)
 * ------------------------------------------------------------------ */

export type PushMessage = { type: string; data?: unknown };

export const PUSH_MESSAGE_TYPE_GROUPS = {
	execution: [
		'executionStarted',
		'executionWaiting',
		'executionFinished',
		'executionRecovered',
		'nodeExecuteBefore',
		'nodeExecuteAfter',
		'nodeExecuteAfterData',
		'nodeExecuteAfterDataBatch',
	],
	workflow: [
		'workflowActivated',
		'workflowDeactivated',
		'workflowFailedToActivate',
		'transactionSuccessful',
		'documentVisibilityChange',
	],
	webhook: ['testWebhookReceived'],
	worker: ['sendWorkerStatusMessage'],
	hotReload: ['reloadNodeType', 'removeNodeType', 'nodeTypeIndexingProgress'],
	collaboration: ['collaboratorJoined', 'collaboratorLeft', 'collaboratorChanged', 'cursorMoved'],
} as const;

export type PushMessageType = (typeof PUSH_MESSAGE_TYPE_GROUPS)[keyof typeof PUSH_MESSAGE_TYPE_GROUPS][number];

/** heartbeat.ts — `{ type: 'heartbeat' }`, no extra keys allowed. */
export type HeartbeatMessage = { type: 'heartbeat' };

export function createHeartbeatMessage(): HeartbeatMessage {
	return { type: 'heartbeat' };
}

export function isHeartbeatMessage(msg: unknown): msg is HeartbeatMessage {
	return (
		typeof msg === 'object' &&
		msg !== null &&
		Object.keys(msg as object).length === 1 &&
		(msg as { type?: unknown }).type === 'heartbeat'
	);
}

/* ------------------------------------------------------------------ *
 * R3 — connection abstractions
 * ------------------------------------------------------------------ */

export type PushRequest = {
	query: { pushRef?: string };
	headers: Record<string, string | string[] | undefined>;
	user: { id: string };
	socket?: {
		setTimeout: (ms: number) => void;
		setNoDelay: (value: boolean) => void;
		setKeepAlive: (value: boolean) => void;
	};
	once?: (event: string, handler: () => void) => void;
	/** Test hook mirroring the socket's `emit` (production uses a real socket). */
	emit?: (event: string) => void;
};

export type PushResponse = {
	headers: Record<string, string>;
	statusCode?: number;
	chunks: string[];
	flushCount: number;
	ended: boolean;
	setHeader: (name: string, value: string) => void;
	writeHead: (statusCode: number) => void;
	write: (chunk: string) => void;
	flush: () => void;
	end: () => void;
	once?: (event: string, handler: () => void) => void;
	status?: (code: number) => { send: (body: string) => void };
};

/** Minimal WebSocket twin covering only what `websocket.push.ts` touches. */
export type WebSocketLike = {
	isAlive: boolean;
	received: string[];
	closed: boolean;
	terminated: boolean;
	pingCount: number;
	send: (data: string, options?: { binary?: boolean }) => void;
	close: (code?: number) => void;
	terminate: () => void;
	ping: () => void;
	on: (event: 'pong' | 'message', handler: (...args: any[]) => void) => void;
	once: (event: 'close', handler: (...args: any[]) => void) => void;
	off: (event: string, handler: (...args: any[]) => void) => void;
	emit: (event: string, ...args: unknown[]) => void;
};

export function createMemoryResponse(): PushResponse {
	const listeners = new Map<string, Array<() => void>>();
	const response: PushResponse = {
		headers: {},
		chunks: [],
		flushCount: 0,
		ended: false,
		setHeader(name, value) {
			this.headers[name] = value;
		},
		writeHead(statusCode) {
			this.statusCode = statusCode;
		},
		write(chunk) {
			this.chunks.push(chunk);
		},
		flush() {
			this.flushCount += 1;
		},
		end() {
			this.ended = true;
			for (const handler of listeners.get('finish') ?? []) handler();
		},
		once(event, handler) {
			const list = listeners.get(event) ?? [];
			list.push(handler);
			listeners.set(event, list);
		},
	};
	return response;
}

export function createMemoryRequest(
	options: { pushRef?: string; headers?: Record<string, string | string[] | undefined>; userId?: string } = {},
): PushRequest {
	const listeners = new Map<string, Array<() => void>>();
	const socket = { setTimeout: (_ms: number) => {}, setNoDelay: (_v: boolean) => {}, setKeepAlive: (_v: boolean) => {} };
	return {
		query: { pushRef: options.pushRef },
		headers: options.headers ?? {},
		user: { id: options.userId ?? 'user-1' },
		socket,
		once(event, handler) {
			const list = listeners.get(event) ?? [];
			list.push(handler);
			listeners.set(event, list);
		},
		emit(event) {
			for (const handler of [...(listeners.get(event) ?? [])]) handler();
		},
	};
}

export function createMemoryWebSocket(): WebSocketLike {
	const handlers = new Map<string, Array<(...args: any[]) => void>>();
	return {
		isAlive: true,
		received: [],
		closed: false,
		terminated: false,
		pingCount: 0,
		send(data: string) {
			this.received.push(data);
		},
		close(code?: number) {
			this.closed = true;
			void code;
			for (const handler of handlers.get('close') ?? []) handler();
		},
		terminate() {
			this.terminated = true;
			for (const handler of handlers.get('close') ?? []) handler();
		},
		ping() {
			this.pingCount += 1;
		},
		on(event, handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		once(event, handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		off(event, handler) {
			handlers.set(event, (handlers.get(event) ?? []).filter((item) => item !== handler));
		},
		emit(event, ...args) {
			for (const handler of [...(handlers.get(event) ?? [])]) handler.apply(this, args);
		},
	};
}

/* ------------------------------------------------------------------ *
 * R4 — jsonStringify twin (circular-ref safe, `replaceCircularRefs: true`)
 * ------------------------------------------------------------------ */

export function stringifyPushMessage(pushMsg: PushMessage): string {
	// `jsonStringify(..., { replaceCircularRefs: true })` only replaces *ancestor*
	// references. A DAG (the same array/object reachable twice) must serialize normally,
	// otherwise the frontend receives "[Circular Reference]" for legitimate repeated data.
	const ancestors: object[] = [];

	const serialize = (value: unknown): string | undefined => {
		if (value === null) return 'null';

		switch (typeof value) {
			case 'string':
				return JSON.stringify(value);
			case 'number':
				return Number.isFinite(value) ? JSON.stringify(value) : 'null';
			case 'boolean':
				return JSON.stringify(value);
			case 'bigint':
				return JSON.stringify(String(value));
			case 'undefined':
			case 'function':
			case 'symbol':
				return undefined;
			default:
				break;
		}

		const object = value as object;

		if (object instanceof Date) return JSON.stringify(object.toJSON());
		if (ancestors.includes(object)) return JSON.stringify('[Circular Reference]');

		ancestors.push(object);
		try {
			if (Array.isArray(object)) {
				const items = object.map((item) => serialize(item) ?? 'null');
				return `[${items.join(',')}]`;
			}

			const entries = Object.entries(object as Record<string, unknown>)
				.map(([key, item]) => {
					const serialized = serialize(item);
					return serialized === undefined ? undefined : `${JSON.stringify(key)}:${serialized}`;
				})
				.filter((entry): entry is string => entry !== undefined);
			return `{${entries.join(',')}}`;
		} finally {
			ancestors.pop();
		}
	};

	return serialize({ type: pushMsg.type, data: pushMsg.data }) ?? 'null';
}

/* ------------------------------------------------------------------ *
 * R5 — AbstractPush (push/abstract.push.ts)
 * ------------------------------------------------------------------ */

export type OnPushMessage = { pushRef: string; userId: string; msg: unknown };

export abstract class AbstractPush<Connection> extends TypedEmitter {
	protected connections: Record<string, Connection> = {};

	protected userIdByPushRef: Record<string, string> = {};

	readonly loggerPrefix = 'push';

	protected abstract close(connection: Connection): void;

	protected abstract sendToOneConnection(connection: Connection, data: string, isBinary?: boolean): void;

	protected abstract ping(connection: Connection): void;

	add(pushRef: string, userId: string, connection: Connection) {
		const existingConnection = this.connections[pushRef];
		if (existingConnection) this.close(existingConnection);
		this.connections[pushRef] = connection;
		this.userIdByPushRef[pushRef] = userId;
	}

	protected onMessageReceived(pushRef: string, msg: unknown) {
		const userId = this.userIdByPushRef[pushRef] as string;
		this.emit('message', { pushRef, userId, msg });
	}

	protected remove(pushRef?: string) {
		if (!pushRef) return;
		delete this.connections[pushRef];
		delete this.userIdByPushRef[pushRef];
	}

	private sendTo(pushMsg: PushMessage, pushRefs: string[], asBinary = false) {
		if (pushRefs.length === 0) return;

		const stringifiedPayload = stringifyPushMessage(pushMsg);

		for (const pushRef of pushRefs) {
			const connection = this.connections[pushRef];
			if (!connection) throw new Error('assertion failed: connection missing');
			this.sendToOneConnection(connection, stringifiedPayload, asBinary);
		}
	}

	pingAll() {
		for (const pushRef of Object.keys(this.connections)) this.ping(this.connections[pushRef]);
	}

	sendToAll(pushMsg: PushMessage) {
		this.sendTo(pushMsg, Object.keys(this.connections));
	}

	sendToOne(pushMsg: PushMessage, pushRef: string, asBinary = false) {
		if (this.connections[pushRef] === undefined) return;
		this.sendTo(pushMsg, [pushRef], asBinary);
	}

	sendToUsers(pushMsg: PushMessage, userIds: string[]) {
		const pushRefs = Object.keys(this.connections).filter((pushRef) =>
			userIds.includes(this.userIdByPushRef[pushRef]),
		);
		this.sendTo(pushMsg, pushRefs);
	}

	closeAllConnections() {
		for (const pushRef of Object.keys(this.connections)) this.close(this.connections[pushRef]);
	}

	hasPushRef(pushRef: string) {
		return this.connections[pushRef] !== undefined;
	}

	get connectionCount() {
		return Object.keys(this.connections).length;
	}
}

/* ------------------------------------------------------------------ *
 * R6 — SSEPush (push/sse.push.ts) — wire format is byte-exact
 * ------------------------------------------------------------------ */

export type SSEConnection = { req: PushRequest; res: PushResponse };

export class SSEPush extends AbstractPush<SSEConnection> {
	add(pushRef: string, userId: string, connection: SSEConnection) {
		const { req, res } = connection;

		req.socket?.setTimeout(0);
		req.socket?.setNoDelay(true);
		req.socket?.setKeepAlive(true);
		res.setHeader('Content-Type', 'text/event-stream; charset=UTF-8');
		res.setHeader('Cache-Control', 'no-cache');
		res.setHeader('Connection', 'keep-alive');
		res.writeHead(200);
		res.write(':ok\n\n');
		res.flush();

		super.add(pushRef, userId, connection);

		const removeClient = () => this.remove(pushRef);
		req.once?.('end', removeClient);
		req.once?.('close', removeClient);
		res.once?.('finish', removeClient);
	}

	protected close({ res }: SSEConnection) {
		res.end();
	}

	protected sendToOneConnection(connection: SSEConnection, data: string) {
		const { res } = connection;
		res.write('data: ' + data + '\n\n');
		res.flush();
	}

	protected ping({ res }: SSEConnection) {
		res.write(':ping\n\n');
		res.flush();
	}
}

/* ------------------------------------------------------------------ *
 * R7 — WebSocketPush (push/websocket.push.ts)
 * ------------------------------------------------------------------ */

export type PushErrorReporter = { error: (error: Error) => void };

export class WebSocketPush extends AbstractPush<WebSocketLike> {
	readonly errors: Error[] = [];

	private readonly errorReporter?: PushErrorReporter;

	constructor(errorReporter?: PushErrorReporter) {
		super();
		this.errorReporter = errorReporter;
	}

	add(pushRef: string, userId: string, connection: WebSocketLike) {
		connection.isAlive = true;
		connection.on('pong', heartbeat);

		super.add(pushRef, userId, connection);

		const onMessage = (data: unknown) => {
			try {
				const text = typeof data === 'string' ? data : String(data);
				const msg: unknown = JSON.parse(text);

				if (isHeartbeatMessage(msg)) return;

				this.onMessageReceived(pushRef, msg);
			} catch (error) {
				const wrapped = new Error('Error parsing push message');
				(wrapped as Error & { cause?: unknown }).cause = error;
				this.errors.push(wrapped);
				this.errorReporter?.error(wrapped);
			}
		};

		connection.once('close', () => {
			connection.off('pong', heartbeat);
			connection.off('message', onMessage);
			this.remove(pushRef);
		});

		connection.on('message', onMessage);
	}

	protected close(connection: WebSocketLike): void {
		connection.close();
	}

	protected sendToOneConnection(connection: WebSocketLike, data: string, asBinary = false): void {
		connection.send(data, { binary: asBinary });
	}

	protected ping(connection: WebSocketLike): void {
		// If a connection did not respond with a PONG in the last 60 seconds, disconnect
		if (!connection.isAlive) {
			connection.terminate();
			return;
		}
		connection.isAlive = false;
		connection.ping();
	}
}

function heartbeat(this: WebSocketLike) {
	this.isAlive = true;
}

/* ------------------------------------------------------------------ *
 * R8 — origin validator (push/origin-validator.ts)
 * ------------------------------------------------------------------ */

export type OriginValidationResult = {
	isValid: boolean;
	originInfo?: { protocol: 'http' | 'https'; host: string };
	expectedHost?: string;
	expectedProtocol?: 'http' | 'https';
	rawExpectedHost?: string;
	error?: string;
};

export function validateOriginHeaders(headers: Record<string, string | string[] | undefined>): OriginValidationResult {
	const originInfo = parseOrigin(getFirstHeaderValue(headers.origin) ?? '');

	if (!originInfo) {
		return { isValid: false, error: 'Origin header is missing or malformed' };
	}

	let rawExpectedHost: string | undefined;
	let expectedProtocol: 'http' | 'https' = originInfo.protocol;

	const forwarded = parseForwardedHeader(getFirstHeaderValue(headers.forwarded) ?? '');
	if (forwarded?.host) {
		rawExpectedHost = forwarded.host;
		const validatedProto = validateProtocol(forwarded.proto);
		if (validatedProto) expectedProtocol = validatedProto;
	} else {
		const xForwardedHost = getFirstHeaderValue(headers['x-forwarded-host']);
		if (xForwardedHost) {
			rawExpectedHost = xForwardedHost;
			const xForwardedProto = getFirstHeaderValue(headers['x-forwarded-proto']);
			if (xForwardedProto) {
				const validatedProto = validateProtocol(xForwardedProto.split(',')[0]?.trim());
				if (validatedProto) expectedProtocol = validatedProto;
			}
		} else {
			rawExpectedHost = getFirstHeaderValue(headers.host);
		}
	}

	const normalizedExpectedHost = normalizeHost(rawExpectedHost ?? '', expectedProtocol);
	const isValid = normalizedExpectedHost === originInfo.host;

	return {
		isValid,
		originInfo,
		expectedHost: normalizedExpectedHost,
		expectedProtocol,
		rawExpectedHost,
		error: isValid ? undefined : 'Origin header does not match expected host',
	};
}

function normalizeHost(host: string, protocol: 'http' | 'https'): string {
	if (!host) return host;
	try {
		const url = new URL(`${protocol}://${host}`);
		const defaultPort = protocol === 'https' ? '443' : '80';
		const actualPort = url.port || defaultPort;
		if (actualPort === defaultPort) return stripIPv6Brackets(url.hostname);
		return stripIPv6Brackets(url.host);
	} catch {
		return host;
	}
}

function stripIPv6Brackets(hostname: string): string {
	if (hostname.startsWith('[') && hostname.includes(']:')) {
		const closingBracket = hostname.indexOf(']:');
		const ipv6 = hostname.slice(1, closingBracket);
		const port = hostname.slice(closingBracket + 2);
		return `${ipv6}:${port}`;
	}
	if (hostname.startsWith('[') && hostname.endsWith(']')) return hostname.slice(1, -1);
	return hostname;
}

function getFirstHeaderValue(header: string | string[] | undefined): string | undefined {
	if (!header) return undefined;
	if (typeof header === 'string') return header;
	return header[0];
}

function validateProtocol(proto: string | undefined): 'http' | 'https' | undefined {
	if (!proto) return undefined;
	const normalized = proto.toLowerCase().trim();
	return normalized === 'http' || normalized === 'https' ? normalized : undefined;
}

function parseForwardedHeader(forwardedHeader: string): { host?: string; proto?: string } | null {
	if (!forwardedHeader || typeof forwardedHeader !== 'string') return null;
	try {
		const firstEntry = forwardedHeader.split(',')[0]?.trim();
		if (!firstEntry) return null;

		const result: { host?: string; proto?: string } = {};
		for (const pair of firstEntry.split(';')) {
			const [key, value] = pair.split('=', 2);
			if (!key || !value) continue;
			const cleanKey = key.trim().toLowerCase();
			const cleanValue = value.trim().replace(/^["']|["']$/g, '');
			if (cleanKey === 'host') result.host = cleanValue;
			else if (cleanKey === 'proto') result.proto = cleanValue;
		}
		return result;
	} catch {
		return null;
	}
}

function parseOrigin(origin: string): { protocol: 'http' | 'https'; host: string } | null {
	if (!origin || typeof origin !== 'string') return null;
	try {
		const url = new URL(origin);
		const protocol = url.protocol.toLowerCase();
		if (protocol !== 'http:' && protocol !== 'https:') return null;
		const protocolName: 'http' | 'https' = protocol === 'https:' ? 'https' : 'http';
		const defaultPort = protocolName === 'https' ? '443' : '80';
		const actualPort = url.port || defaultPort;
		const rawHost = actualPort === defaultPort ? url.hostname : url.host;
		return { protocol: protocolName, host: stripIPv6Brackets(rawHost) };
	} catch {
		return null;
	}
}

/* ------------------------------------------------------------------ *
 * R9 — Push service (push/index.ts)
 * ------------------------------------------------------------------ */

export type PushPublisher = {
	publishCommand: (msg: { command: string; payload: unknown }) => Promise<void>;
};

export type PushServiceOptions = {
	backend?: PushBackend;
	hostId?: string;
	isWorker?: boolean;
	isMultiMain?: boolean;
	/** Production mode gates the origin validation (`inProduction`). */
	inProduction?: boolean;
	publisher?: PushPublisher;
};

export class PushService {
	readonly backendType: PushBackend;

	readonly isBidirectional: boolean;

	readonly isWorker: boolean;

	readonly isMultiMain: boolean;

	readonly inProduction: boolean;

	readonly backend: SSEPush | WebSocketPush;

	readonly events = new TypedEmitter();

	readonly warnings: string[] = [];

	private readonly publisher?: PushPublisher;

	constructor(options: PushServiceOptions = {}) {
		this.backendType = options.backend ?? DEFAULT_PUSH_BACKEND;
		this.isBidirectional = this.backendType === 'websocket';
		this.isWorker = options.isWorker ?? false;
		this.isMultiMain = options.isMultiMain ?? false;
		this.inProduction = options.inProduction ?? false;
		this.publisher = options.publisher;
		this.backend = this.backendType === 'websocket' ? new WebSocketPush() : new SSEPush();
	}

	/** GET/POST `<restEndpoint>/push` handler. */
	handleRequest(req: PushRequest, res: PushResponse, ws?: WebSocketLike): { ok: boolean; error?: string; status?: number } {
		const pushRef = req.query.pushRef;
		let connectionError = '';

		if (!pushRef) {
			connectionError = 'The query parameter "pushRef" is missing!';
		} else if (this.inProduction) {
			const validation = validateOriginHeaders(req.headers);
			if (!validation.isValid) {
				this.warnings.push(
					'Origin header does NOT match the expected origin. ' +
						`(Origin: "${req.headers.origin}" -> "${validation.originInfo?.host ?? 'N/A'}", ` +
						`Expected: "${validation.rawExpectedHost}" -> "${validation.expectedHost}", ` +
						`Protocol: "${validation.expectedProtocol}")`,
				);
				connectionError = 'Invalid origin!';
			}
		}

		if (connectionError) {
			if (ws) {
				ws.send(connectionError);
				ws.close(1008);
				return { ok: false, error: connectionError };
			}
			return { ok: false, error: connectionError, status: 400 };
		}

		if (ws && this.backend instanceof WebSocketPush) {
			this.backend.add(pushRef as string, req.user.id, ws);
		} else if (!this.isBidirectional) {
			(this.backend as SSEPush).add(pushRef as string, req.user.id, { req, res });
		} else {
			return { ok: false, error: 'Unauthorized', status: 401 };
		}

		this.events.emit('editorUiConnected', pushRef);
		return { ok: true };
	}

	broadcast(pushMsg: PushMessage) {
		this.backend.sendToAll(pushMsg);
	}

	hasPushRef(pushRef: string) {
		return this.backend.hasPushRef(pushRef);
	}

	async send(pushMsg: PushMessage, pushRef: string, asBinary = false): Promise<void> {
		if (this.shouldRelayViaPubSub(pushRef)) {
			await this.relayViaPubSub(pushMsg, pushRef, asBinary);
			return;
		}
		this.backend.sendToOne(pushMsg, pushRef, asBinary);
	}

	sendToUsers(pushMsg: PushMessage, userIds: string[]) {
		this.backend.sendToUsers(pushMsg, userIds);
	}

	/** `@OnPubSubEvent('relay-execution-lifecycle-event')` (main only). */
	handleRelayExecutionLifecycleEvent(msg: PushMessage & { pushRef: string; asBinary?: boolean }) {
		const { pushRef, asBinary, ...pushMsg } = msg;
		if (!this.hasPushRef(pushRef)) return;
		void this.send(pushMsg as PushMessage, pushRef, asBinary ?? false);
	}

	onShutdown() {
		this.backend.closeAllConnections();
	}

	shouldRelayViaPubSub(pushRef: string): boolean {
		return this.isWorker || (this.isMultiMain && !this.hasPushRef(pushRef));
	}

	/** Relay a push message via `n8n.commands`, trimming oversized payloads. */
	async relayViaPubSub(pushMsg: PushMessage, pushRef: string, asBinary = false): Promise<void> {
		const { type } = pushMsg;

		if (type === 'nodeExecuteAfterData') {
			const eventSizeBytes = new TextEncoder().encode(JSON.stringify(pushMsg.data)).length;

			if (eventSizeBytes > MAX_PAYLOAD_SIZE_BYTES) {
				const toMb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(0);
				this.warnings.push(
					`Size of "${type}" (${toMb(eventSizeBytes)} MB) exceeds max size ${toMb(
						MAX_PAYLOAD_SIZE_BYTES,
					)} MB. Skipping...`,
				);
				return;
			}
		}

		await this.publisher?.publishCommand({
			command: 'relay-execution-lifecycle-event',
			payload: { ...pushMsg, pushRef, asBinary },
		});
	}
}
