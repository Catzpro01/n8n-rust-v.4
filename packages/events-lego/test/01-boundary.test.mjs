import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const EVENTS = path.join(REPO, 'reference/n8n/packages/cli/src/events');

const engine = fs.readFileSync(
	path.join(REPO, 'packages/reconstructed-engine/src/events-engine.ts'),
	'utf8',
);
const surface = fs.readFileSync(path.join(__dirname, '../src/model-surface.ts'), 'utf8');

const readReference = (rel) => {
	const file = path.join(EVENTS, rel);
	return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
};

const extractMapKeys = (source) =>
	[...source.matchAll(/\n\t'([a-z0-9-]+)':/g)].map((match) => match[1]);

test('surface pins provenance + invariants E1..E12', () => {
	assert.ok(surface.includes('b6dc2787c45677a29a9612cd27eb911302961a83'));
	for (let i = 1; i <= 12; i += 1) {
		assert.ok(surface.includes(`E${i} `), `missing invariant E${i}`);
	}
});

test('E1 — the relay catalogue matches relay.event-map.ts key-for-key', (t) => {
	const reference = readReference('maps/relay.event-map.ts');
	if (!reference) return t.skip('reference runtime not present');

	const referenceNames = extractMapKeys(reference);
	const reconstruction = JSON.parse(
		JSON.stringify(
			[...engine.matchAll(/\n\t'([a-z0-9-]+)',/g)].map((match) => match[1]),
		),
	);

	const missing = referenceNames.filter((name) => !reconstruction.includes(name));
	assert.deepEqual(missing, [], `catalogue is missing ${missing.length} event name(s)`);

	const extra = reconstruction.filter((name) => !referenceNames.includes(name));
	assert.deepEqual(
		extra.filter((name) => !name.startsWith('ai-') && name !== 'job-counts-updated'),
		[],
		'catalogue has names the reference does not define',
	);
	assert.equal(referenceNames.length, 93, 'reference event count changed');
});

test('E1b — queue-metrics and ai event maps match the reference', (t) => {
	const metrics = readReference('maps/queue-metrics.event-map.ts');
	const ai = readReference('maps/ai.event-map.ts');
	if (!metrics || !ai) return t.skip('reference runtime not present');

	assert.deepEqual(extractMapKeys(metrics), ['job-counts-updated']);
	assert.ok(engine.includes("export const QUEUE_METRICS_EVENT_NAMES = ['job-counts-updated'] as const;"));

	const aiNames = extractMapKeys(ai);
	for (const name of aiNames) {
		assert.ok(engine.includes(`'${name}'`), `AI catalogue missing ${name}`);
	}
	assert.equal(aiNames.length, 14);
});

test('E2 — the reference EventService is a TypedEmitter of the merged event maps', (t) => {
	const reference = readReference('event.service.ts');
	if (!reference) return t.skip('reference runtime not present');
	assert.ok(reference.includes('export class EventService extends TypedEmitter<EventMap> {}'));
	assert.ok(reference.includes('RelayEventMap'));
	assert.ok(reference.includes('QueueMetricsEventMap'));
	assert.ok(reference.includes('AiEventMap'));
	assert.ok(engine.includes('export class EventService extends TypedEmitter'));
});

test('E10 — session-started is emitted with { pushRef } by the controller', (t) => {
	const reference = readReference('events.controller.ts');
	if (!reference) return t.skip('reference runtime not present');
	assert.ok(reference.includes("@Get('/session-started')"));
	assert.ok(reference.includes("this.eventService.emit('session-started', { pushRef });"));
	assert.ok(engine.includes("this.emit('session-started', { pushRef })"));
});

test('E12 — the bus exposes one sender helper per message class', (t) => {
	const busPath = path.join(REPO, 'reference/n8n/packages/cli/src/eventbus/message-event-bus/message-event-bus.ts');
	const reference = fs.existsSync(busPath) ? fs.readFileSync(busPath, 'utf8') : null;
	if (!reference) return t.skip('reference runtime not present');

	for (const helper of [
		'sendAuditEvent',
		'sendWorkflowEvent',
		'sendNodeEvent',
		'sendAiNodeEvent',
		'sendExecutionEvent',
		'sendRunnerEvent',
		'sendQueueEvent',
		'confirmSent',
	]) {
		assert.ok(reference.includes(helper), `reference lost ${helper}`);
		assert.ok(engine.includes(helper), `reconstruction lost ${helper}`);
	}
});

test('zero Rust inside the LEGO and the engine', () => {
	assert.ok(!/\b(cargo|rustc|#\[derive)\b/.test(engine));
	assert.ok(!/\b(cargo|rustc|#\[derive)\b/.test(surface));
});
