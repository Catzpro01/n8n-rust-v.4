import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const SCALING = path.join(REPO, 'reference/n8n/packages/cli/src/scaling');

const surface = fs.readFileSync(path.join(__dirname, '../src/model-surface.ts'), 'utf8');
const engine = fs.readFileSync(
	path.join(REPO, 'packages/reconstructed-engine/src/queue-engine.ts'),
	'utf8',
);

const readReference = (rel) => {
	const file = path.join(SCALING, rel);
	return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
};

test('surface pins the reference provenance (n8n 2.9.4 @ b6dc2787)', () => {
	assert.ok(surface.includes('b6dc2787c45677a29a9612cd27eb911302961a83'));
	assert.ok(surface.includes('2.9.4'));
	for (const sym of [
		'Q1',
		'Q2',
		'Q3',
		'Q4',
		'Q5',
		'Q6',
		'Q7',
		'Q8',
		'Q9',
		'Q10',
		'Q11',
		'Q12',
		'Q13',
		'Q14',
	]) {
		assert.ok(surface.includes(sym), `missing invariant ${sym}`);
	}
	for (const port of ['P-QUEUE-SCALING', 'P-QUEUE-PUBSUB', 'P-QUEUE-STATUS']) {
		assert.ok(surface.includes(port), `missing provided port ${port}`);
	}
});

test('constants are byte-exact vs reference source (scaling/constants.ts)', (t) => {
	const reference = readReference('constants.ts');
	if (!reference) return t.skip('reference runtime not present');

	for (const literal of [
		"export const QUEUE_NAME = 'jobs';",
		"export const JOB_TYPE_NAME = 'job';",
		"export const COMMAND_PUBSUB_CHANNEL = 'n8n.commands';",
		"export const WORKER_RESPONSE_PUBSUB_CHANNEL = 'n8n.worker-response';",
		"export const MCP_RELAY_PUBSUB_CHANNEL = 'n8n.mcp-relay';",
	]) {
		assert.ok(reference.includes(literal), `reference drifted: ${literal}`);
	}

	// the reconstruction must carry the same literals
	assert.ok(engine.includes("export const QUEUE_NAME = 'jobs';"));
	assert.ok(engine.includes("export const JOB_TYPE_NAME = 'job';"));
	assert.ok(engine.includes("export const COMMAND_PUBSUB_CHANNEL = 'n8n.commands';"));
	assert.ok(engine.includes("export const WORKER_RESPONSE_PUBSUB_CHANNEL = 'n8n.worker-response';"));
	assert.ok(engine.includes("export const MCP_RELAY_PUBSUB_CHANNEL = 'n8n.mcp-relay';"));
});

test('SELF_SEND / IMMEDIATE command sets match the reference source', (t) => {
	const reference = readReference('constants.ts');
	if (!reference) return t.skip('reference runtime not present');

	for (const command of [
		'add-webhooks-triggers-and-pollers',
		'remove-triggers-and-pollers',
		'relay-execution-lifecycle-event',
		'relay-chat-stream-event',
	]) {
		assert.ok(reference.includes(`'${command}'`), `reference lost command ${command}`);
		assert.ok(engine.includes(`'${command}'`), `reconstruction lost command ${command}`);
	}

	// the immediate set is a superset of the self-send set
	const selfSend = [...engine.matchAll(/SELF_SEND_COMMANDS[\s\S]*?\]\);/g)][0][0];
	const immediate = [...engine.matchAll(/IMMEDIATE_COMMANDS[\s\S]*?\]\);/g)][0][0];
	const names = (block) => [...block.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
	for (const command of names(selfSend)) {
		assert.ok(names(immediate).includes(command), `${command} missing from IMMEDIATE_COMMANDS`);
	}
});

test('queue settings force maxStalledCount: 0 like the reference', (t) => {
	const reference = readReference('scaling.service.ts');
	if (!reference) return t.skip('reference runtime not present');
	assert.ok(reference.includes('maxStalledCount: 0'));
	assert.ok(engine.includes('maxStalledCount: 0'));
});

test('worker error strings are byte-exact vs job-processor.ts / scaling.service.ts', (t) => {
	const processor = readReference('job-processor.ts');
	const scaling = readReference('scaling.service.ts');
	if (!processor || !scaling) return t.skip('reference runtime not present');

	assert.ok(processor.includes('`Worker failed to find data for execution ${executionId} (job ${job.id})`'));
	assert.ok(processor.includes('crashed'));
	assert.ok(scaling.includes("'Worker received invalid job'"));
	assert.ok(engine.includes('`Worker failed to find data for execution ${executionId} (job ${job.id})`'));
	assert.ok(engine.includes("'Worker received invalid job'"));
});

test('job message kinds match scaling.types.ts', (t) => {
	const reference = readReference('scaling.types.ts');
	if (!reference) return t.skip('reference runtime not present');
	for (const kind of [
		'respond-to-webhook',
		'job-finished',
		'job-failed',
		'abort-job',
		'send-chunk',
		'mcp-response',
	]) {
		assert.ok(reference.includes(`'${kind}'`), `reference lost kind ${kind}`);
		assert.ok(engine.includes(`'${kind}'`), `reconstruction lost kind ${kind}`);
	}
});

test('zero Rust inside the LEGO and the engine', () => {
	for (const file of ['src/index.ts', 'src/model-surface.ts']) {
		const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
		assert.ok(!/\b(cargo|rustc|#\[derive)\b/.test(source), `${file} contains Rust artifacts`);
	}
	assert.ok(!engine.includes('use std::'));
});
