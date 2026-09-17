import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	MAX_PAYLOAD_SIZE_BYTES,
	PushService,
	SSEPush,
	WebSocketPush,
	createMemoryRequest,
	createMemoryResponse,
	createMemoryWebSocket,
	createHeartbeatMessage,
	isHeartbeatMessage,
	validateOriginHeaders,
} from '../src/index.ts';

const sseRequest = (pushRef = 'push-ref-1', userId = 'user-1') =>
	createMemoryRequest({ pushRef, userId });

test('R3/R4/R5 — sessions are keyed by pushRef and behave like the reference registry', () => {
	const push = new SSEPush();
	const res1 = createMemoryResponse();
	push.add('a', 'user-1', { req: sseRequest('a'), res: res1 });

	assert.equal(push.hasPushRef('a'), true);
	assert.equal(push.connectionCount, 1);

	push.sendToOne({ type: 'executionStarted', data: { executionId: 'e-1' } }, 'a');
	const frame = res1.chunks.at(-1);
	assert.equal(frame, 'data: {"type":"executionStarted","data":{"executionId":"e-1"}}\n\n');
	assert.equal(res1.flushCount, 2, 'handshake + message flush');

	// sending to an unknown push ref is a no-op (the reference logs and returns)
	push.sendToOne({ type: 'executionFinished' }, 'missing');
	assert.equal(res1.chunks.length, 2);

	// re-registering the same pushRef closes the previous connection first
	const stale = res1;
	const res2 = createMemoryResponse();
	push.add('a', 'user-1', { req: sseRequest('a'), res: res2 });
	assert.equal(stale.ended, true);
	assert.equal(push.connectionCount, 1);

	// sendToUsers filters by user id
	const res3 = createMemoryResponse();
	push.add('b', 'user-2', { req: sseRequest('b', 'user-2'), res: res3 });
	push.sendToUsers({ type: 'workflowActivated', data: { workflowId: 'wf-1' } }, ['user-2']);
	assert.equal(res2.chunks.length, 1, 'user-1 must not receive user-2 messages');
	assert.equal(res3.chunks.length, 2);

	// closeAllConnections ends every session
	push.closeAllConnections();
	assert.deepEqual([res2.ended, res3.ended], [true, true]);
});

test('R6/R7/R8 — SSE handshake, frames, ping and disconnect cleanup', () => {
	const push = new SSEPush();
	const req = sseRequest('x');
	const res = createMemoryResponse();

	let ended = 0;
	req.once('end', () => {
		ended += 1;
	});

	push.add('x', 'user-1', { req, res });

	assert.deepEqual(res.headers, {
		'Content-Type': 'text/event-stream; charset=UTF-8',
		'Cache-Control': 'no-cache',
		Connection: 'keep-alive',
	});
	assert.equal(res.statusCode, 200);
	assert.equal(res.chunks[0], ':ok\n\n');
	assert.equal(res.flushCount, 1);
	assert.equal(push.hasPushRef('x'), true);

	push.pingAll();
	assert.equal(res.chunks.at(-1), ':ping\n\n');

	// the reference relies on the socket events to drop the session
	req.emit('end');
	assert.equal(ended, 1);
	assert.equal(push.hasPushRef('x'), false);
	assert.equal(ended, 1);
});

test('R9/R10 — websocket liveness, heartbeat frames and parse-error isolation', () => {
	const push = new WebSocketPush();
	const ws = createMemoryWebSocket();
	const received = [];
	push.on('message', (msg) => received.push(msg));

	push.add('ws-1', 'user-1', ws);
	assert.equal(ws.isAlive, true);

	// a client heartbeat is swallowed (never surfaced as a push message)
	ws.emit('message', JSON.stringify(createHeartbeatMessage()));
	assert.equal(received.length, 0);
	assert.equal(isHeartbeatMessage({ type: 'heartbeat' }), true);
	assert.equal(isHeartbeatMessage({ type: 'heartbeat', extra: 1 }), false);

	// a real message is surfaced with pushRef + userId
	ws.emit('message', JSON.stringify({ type: 'heartbeat-like', data: {} }));
	ws.emit('message', JSON.stringify({ type: 'documentVisibilityChange', data: { visible: true } }));
	assert.equal(received.length, 2);
	assert.deepEqual(received[1], {
		pushRef: 'ws-1',
		userId: 'user-1',
		msg: { type: 'documentVisibilityChange', data: { visible: true } },
	});

	// malformed frames are reported, not thrown
	ws.emit('message', '{not json');
	assert.equal(push.errors.length, 1);
	assert.equal(push.errors[0].message, 'Error parsing push message');

	// first ping marks the connection as not-alive, a pong revives it
	push.pingAll();
	assert.equal(ws.pingCount, 1);
	assert.equal(ws.isAlive, false);
	ws.emit('pong');
	assert.equal(ws.isAlive, true);

	// a missed pong terminates the connection
	push.pingAll();
	assert.equal(ws.isAlive, false);
	push.pingAll();
	assert.equal(ws.terminated, true);
	assert.equal(push.hasPushRef('ws-1'), false, 'close removes the session');
});

test('R11 — origin validation matrix (Forwarded > X-Forwarded-Host > Host)', () => {
	assert.deepEqual(validateOriginHeaders({ origin: 'https://n8n.example.com', host: 'n8n.example.com' }), {
		isValid: true,
		originInfo: { protocol: 'https', host: 'n8n.example.com' },
		expectedHost: 'n8n.example.com',
		expectedProtocol: 'https',
		rawExpectedHost: 'n8n.example.com',
		error: undefined,
	});

	// default ports are stripped on both sides
	assert.equal(
		validateOriginHeaders({ origin: 'https://n8n.example.com:443', host: 'n8n.example.com:443' }).isValid,
		true,
	);
	// non-default ports are kept
	assert.equal(
		validateOriginHeaders({ origin: 'http://localhost:5678', host: 'localhost:5678' }).isValid,
		true,
	);
	assert.equal(
		validateOriginHeaders({ origin: 'http://localhost:5678', host: 'localhost:5679' }).isValid,
		false,
	);

	// X-Forwarded-Host wins over Host, and follows the forwarded protocol
	const proxied = validateOriginHeaders({
		origin: 'https://public.example.com',
		host: 'internal:5678',
		'x-forwarded-host': 'public.example.com',
		'x-forwarded-proto': 'https',
	});
	assert.equal(proxied.isValid, true);
	assert.equal(proxied.rawExpectedHost, 'public.example.com');

	// RFC 7239 Forwarded has precedence over X-Forwarded-*
	const forwarded = validateOriginHeaders({
		origin: 'https://rfc.example.com',
		host: 'internal',
		'x-forwarded-host': 'other.example.com',
		forwarded: 'for=192.0.2.60;proto=https;host="rfc.example.com"',
	});
	assert.equal(forwarded.isValid, true);
	assert.equal(forwarded.rawExpectedHost, 'rfc.example.com');

	// IPv6 brackets are stripped for comparison
	assert.equal(
		validateOriginHeaders({ origin: 'http://[::1]:5678', host: '[::1]:5678' }).isValid,
		true,
	);

	// malformed origin
	const malformed = validateOriginHeaders({ origin: 'not-a-url', host: 'n8n.example.com' });
	assert.equal(malformed.isValid, false);
	assert.equal(malformed.error, 'Origin header is missing or malformed');
});

test('R12 — push service guards: pushRef, origin and backend negotiation', () => {
	const push = new PushService({ backend: 'sse', inProduction: true });

	const missing = push.handleRequest(createMemoryRequest({}), createMemoryResponse());
	assert.deepEqual(missing, {
		ok: false,
		error: 'The query parameter "pushRef" is missing!',
		status: 400,
	});

	const badOrigin = push.handleRequest(
		createMemoryRequest({ pushRef: 'p1', headers: { origin: 'https://evil.example.com', host: 'n8n.example.com' } }),
		createMemoryResponse(),
	);
	assert.deepEqual(badOrigin, { ok: false, error: 'Invalid origin!', status: 400 });
	assert.equal(push.warnings.length, 1);
	assert.ok(push.warnings[0].startsWith('Origin header does NOT match the expected origin.'));

	// a WebSocket backend refuses a plain SSE request on the push endpoint
	const wsBackend = new PushService({ backend: 'websocket', inProduction: false });
	const refused = wsBackend.handleRequest(createMemoryRequest({ pushRef: 'p2' }), createMemoryResponse());
	assert.deepEqual(refused, { ok: false, error: 'Unauthorized', status: 401 });

	// a good request registers the session and emits editorUiConnected
	const connected = [];
	push.events.on('editorUiConnected', (pushRef) => connected.push(pushRef));
	const res = createMemoryResponse();
	const ok = push.handleRequest(
		createMemoryRequest({ pushRef: 'p3', headers: { origin: 'https://n8n.example.com', host: 'n8n.example.com' } }),
		res,
	);
	assert.equal(ok.ok, true);
	assert.deepEqual(connected, ['p3']);
	assert.equal(push.hasPushRef('p3'), true);
});

test('R13 — relay rules: worker relays via pubsub, oversized node data is dropped', async () => {
	const commands = [];
	const publisher = { publishCommand: async (msg) => commands.push(msg) };
	const push = new PushService({ backend: 'websocket', isWorker: true, publisher });

	await push.send({ type: 'executionStarted', data: { executionId: 'e-1' } }, 'push-ref-1');
	assert.equal(commands.length, 1);
	assert.equal(commands[0].command, 'relay-execution-lifecycle-event');
	assert.deepEqual(commands[0].payload, {
		type: 'executionStarted',
		data: { executionId: 'e-1' },
		pushRef: 'push-ref-1',
		asBinary: false,
	});

	// exactly at the ceiling: still relayed
	const atLimit = { type: 'nodeExecuteAfterData', data: { blob: 'x'.repeat(1024) } };
	await push.send(atLimit, 'push-ref-1');
	assert.equal(commands.length, 2);

	// above the ceiling: dropped with a warning (the FE refetches the data at the end)
	const oversized = { type: 'nodeExecuteAfterData', data: { blob: 'x'.repeat(MAX_PAYLOAD_SIZE_BYTES + 16) } };
	await push.send(oversized, 'push-ref-1');
	assert.equal(commands.length, 2, 'oversized payload must not be relayed');
	assert.equal(push.warnings.at(-1), 'Size of "nodeExecuteAfterData" (5 MB) exceeds max size 5 MB. Skipping...');

	// a main that holds the session pushes directly (no pubsub)
	const mainPush = new PushService({ backend: 'sse', isWorker: false });
	const req = sseRequest('direct');
	const res = createMemoryResponse();
	mainPush.handleRequest(req, res);
	mainPush.warnings.length = 0;
	await mainPush.send({ type: 'executionWaiting', data: { executionId: 'e-2' } }, 'direct');
	assert.equal(res.chunks.at(-1), 'data: {"type":"executionWaiting","data":{"executionId":"e-2"}}\n\n');

	// the relay consumer only pushes to the holder of the pushRef
	const holderPush = new PushService({ backend: 'sse', isWorker: false });
	const holderRes = createMemoryResponse();
	holderPush.handleRequest(sseRequest('holder'), holderRes);
	holderPush.handleRelayExecutionLifecycleEvent({
		type: 'executionFinished',
		data: { executionId: 'e-3', status: 'success', workflowId: 'wf-1' },
		pushRef: 'holder',
		asBinary: false,
	});
	assert.equal(
		holderRes.chunks.at(-1),
		'data: {"type":"executionFinished","data":{"executionId":"e-3","status":"success","workflowId":"wf-1"}}\n\n',
	);
	holderPush.handleRelayExecutionLifecycleEvent({
		type: 'executionFinished',
		data: { executionId: 'e-4' },
		pushRef: 'someone-else',
	});
	assert.equal(holderRes.chunks.length, 2, 'a non-holder ignores the relayed event');
});

test('R4b — circular references are replaced, repeated (non-ancestor) refs are kept', () => {
	const shared = ['a', 'b'];
	const repeated = { first: shared, second: shared };
	const pushDag = new SSEPush();
	const dagRes = createMemoryResponse();
	pushDag.add('dag', 'user-1', { req: sseRequest('dag'), res: dagRes });
	pushDag.sendToOne({ type: 'nodeExecuteAfter', data: repeated }, 'dag');
	assert.equal(
		dagRes.chunks.at(-1),
		'data: {"type":"nodeExecuteAfter","data":{"first":["a","b"],"second":["a","b"]}}\n\n',
		'a DAG must serialize normally — only ancestor cycles become "[Circular Reference]"',
	);

	const push = new SSEPush();
	const res = createMemoryResponse();
	push.add('c', 'user-1', { req: sseRequest('c'), res });

	const data = { executionId: 'e-1' };
	data.self = data;
	push.sendToOne({ type: 'executionStarted', data }, 'c');
	assert.equal(
		res.chunks.at(-1),
		'data: {"type":"executionStarted","data":{"executionId":"e-1","self":"[Circular Reference]"}}\n\n',
	);
});
