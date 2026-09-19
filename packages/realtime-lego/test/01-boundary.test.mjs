import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const PUSH = path.join(REPO, 'reference/n8n/packages/cli/src/push');

const engine = fs.readFileSync(
	path.join(REPO, 'packages/reconstructed-engine/src/realtime-engine.ts'),
	'utf8',
);
const surface = fs.readFileSync(path.join(__dirname, '../src/model-surface.ts'), 'utf8');

const readPush = (rel) => {
	const file = path.join(PUSH, rel);
	return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
};

test('surface pins provenance + invariants R1..R13', () => {
	assert.ok(surface.includes('b6dc2787c45677a29a9612cd27eb911302961a83'));
	for (let i = 1; i <= 13; i += 1) {
		assert.ok(surface.includes(`R${i} `), `missing invariant R${i}`);
	}
	for (const port of ['P-PUSH-SERVICE', 'P-PUSH-BACKENDS', 'P-PUSH-ORIGIN']) {
		assert.ok(surface.includes(port), `missing port ${port}`);
	}
});

test('R1 — backend default, payload ceiling and ping interval match the reference', (t) => {
	const config = readPush('push.config.ts');
	const index = readPush('index.ts');
	const abstract = readPush('abstract.push.ts');
	if (!config || !index || !abstract) return t.skip('reference runtime not present');

	assert.ok(config.includes("@Env('N8N_PUSH_BACKEND')"));
	assert.ok(config.includes("'sse' | 'websocket' = 'websocket'"));
	assert.ok(index.includes('const MAX_PAYLOAD_SIZE_BYTES = 5 * 1024 * 1024;'));
	assert.ok(abstract.includes('setInterval(() => this.pingAll(), 60 * 1000);'));

	assert.ok(engine.includes("export const DEFAULT_PUSH_BACKEND: PushBackend = 'websocket';"));
	assert.ok(engine.includes('export const MAX_PAYLOAD_SIZE_BYTES = 5 * 1024 * 1024;'));
	assert.ok(engine.includes('export const PING_INTERVAL_MS = 60 * 1000;'));
});

test('R6/R7 — SSE wire format is byte-exact vs sse.push.ts', (t) => {
	const sse = readPush('sse.push.ts');
	if (!sse) return t.skip('reference runtime not present');

	for (const literal of [
		"res.setHeader('Content-Type', 'text/event-stream; charset=UTF-8');",
		"res.setHeader('Cache-Control', 'no-cache');",
		"res.setHeader('Connection', 'keep-alive');",
		"res.write(':ok\\n\\n');",
		"res.write('data: ' + data + '\\n\\n');",
		"res.write(':ping\\n\\n');",
	]) {
		assert.ok(sse.includes(literal), `reference drifted: ${literal}`);
	}

	assert.ok(engine.includes("res.setHeader('Content-Type', 'text/event-stream; charset=UTF-8')"));
	assert.ok(engine.includes("res.write(':ok\\n\\n')"));
	assert.ok(engine.includes("res.write('data: ' + data + '\\n\\n')"));
	assert.ok(engine.includes("res.write(':ping\\n\\n')"));
});

test('R9/R10 — websocket heartbeat semantics match websocket.push.ts', (t) => {
	const ws = readPush('websocket.push.ts');
	if (!ws) return t.skip('reference runtime not present');

	assert.ok(ws.includes('connection.isAlive = true;'));
	assert.ok(ws.includes("connection.on('pong', heartbeat);"));
	assert.ok(ws.includes('if (!connection.isAlive) {'));
	assert.ok(ws.includes('return connection.terminate();'));
	assert.ok(ws.includes('connection.isAlive = false;'));
	assert.ok(ws.includes('connection.ping();'));
	assert.ok(ws.includes('heartbeatMessageSchema'));
	assert.ok(ws.includes("UnexpectedError('Error parsing push message'"));

	assert.ok(engine.includes('connection.isAlive = true;'));
	assert.ok(engine.includes("connection.on('pong', heartbeat)"));
	assert.ok(engine.includes('connection.terminate();'));
	assert.ok(engine.includes('connection.isAlive = false;'));
	assert.ok(engine.includes('isHeartbeatMessage(msg)'));
});

test('R11 — origin validation precedence matches origin-validator.ts', (t) => {
	const validator = readPush('origin-validator.ts');
	if (!validator) return t.skip('reference runtime not present');

	assert.ok(validator.includes('parseForwardedHeader'));
	assert.ok(validator.includes("headers['x-forwarded-host']"));
	assert.ok(validator.includes('rawExpectedHost = headers.host;'));
	assert.ok(validator.includes("error: 'Origin header is missing or malformed'"));
	assert.ok(validator.includes("error: isValid ? undefined : 'Origin header does not match expected host'"));

	assert.ok(engine.includes('parseForwardedHeader'));
	assert.ok(engine.includes("headers['x-forwarded-host']"));
	assert.ok(engine.includes("error: 'Origin header is missing or malformed'"));
});

test('R12/R13 — push service guards and relay rules match index.ts', (t) => {
	const index = readPush('index.ts');
	if (!index) return t.skip('reference runtime not present');

	assert.ok(index.includes('The query parameter "pushRef" is missing!'));
	assert.ok(index.includes("connectionError = 'Invalid origin!';"));
	assert.ok(index.includes("res.status(401).send('Unauthorized');"));
	assert.ok(index.includes('shouldRelayViaPubSub'));
	assert.ok(index.includes("this.publisher.publishCommand({"));
	assert.ok(index.includes("command: 'relay-execution-lifecycle-event',"));

	assert.ok(engine.includes('The query parameter "pushRef" is missing!'));
	assert.ok(engine.includes("this.warnings.push('Invalid origin!'") || engine.includes("connectionError = 'Invalid origin!';"));
	assert.ok(engine.includes("return { ok: false, error: 'Unauthorized', status: 401 };"));
	assert.ok(engine.includes("command: 'relay-execution-lifecycle-event',"));
});

test('zero Rust inside the LEGO and the engine', () => {
	assert.ok(!/\b(cargo|rustc|#\[derive)\b/.test(engine));
	assert.ok(!/\b(cargo|rustc|#\[derive)\b/.test(surface));
});
