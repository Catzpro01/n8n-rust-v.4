import test from 'node:test';
import assert from 'node:assert/strict';

import { WorkflowExecutionEngine } from '../runner.mjs';

const linearWorkflow = (extraNodes = [], extraConnections = {}) => ({
	nodes: [
		{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
		...extraNodes,
	],
	connections: {
		'Manual Trigger': { main: [[{ node: extraNodes[0]?.name, type: 'main', index: 0 }]] },
		...extraConnections,
	},
});

test('engine: node di-retry sesuai retryOnFail lalu workflow sukses (L1600-L1680)', async () => {
	let calls = 0;
	const engine = new WorkflowExecutionEngine(
		linearWorkflow([{ name: 'Flaky', type: 'test.flaky', retryOnFail: true, maxTries: 3, waitBetweenTries: 5 }]),
	);
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [{ json: { go: true } }]);
	engine.registerNodeType('test.flaky', async (node, items, tryIndex) => {
		calls++;
		if (tryIndex < 2) throw new Error(`upstream ${tryIndex} failed`);
		return items.map((item) => ({ json: { ...item.json, attempts: calls } }));
	});

	const result = await engine.runWorkflow();
	assert.equal(calls, 3);
	assert.equal(result.status, 'COMPLETED');
	assert.equal(result.errors.length, 0);
	assert.equal(result.executionLog.find((e) => e.node === 'Flaky').tries, 3);
	assert.equal(result.data.Flaky[0].json.attempts, 3);
});

test('engine: tanpa pengaturan error, kegagalan menghentikan workflow (stopWorkflow)', async () => {
	const engine = new WorkflowExecutionEngine(
		linearWorkflow(
			[
				{ name: 'Boom', type: 'test.boom' },
				{ name: 'Never Runs', type: 'test.sink' },
			],
			{ Boom: { main: [[{ node: 'Never Runs', type: 'main', index: 0 }]] } },
		),
	);
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [{ json: { go: true } }]);
	engine.registerNodeType('test.boom', async () => {
		throw new Error('hard failure');
	});
	let downstreamRan = false;
	engine.registerNodeType('test.sink', async (node, items) => {
		downstreamRan = true;
		return items;
	});

	const result = await engine.runWorkflow();
	assert.equal(result.status, 'ERROR');
	assert.equal(downstreamRan, false);
	assert.equal(result.errors[0].node, 'Boom');
	assert.equal(result.errors[0].error, 'hard failure');
	assert.deepEqual(result.data.Boom, []);
});

test('engine: continueOnFail meneruskan data input dan workflow tetap COMPLETED (L1839-L1855)', async () => {
	const engine = new WorkflowExecutionEngine(
		linearWorkflow(
			[
				{ name: 'Boom', type: 'test.boom', continueOnFail: true },
				{ name: 'After', type: 'test.sink' },
			],
			{ Boom: { main: [[{ node: 'After', type: 'main', index: 0 }]] } },
		),
	);
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [{ json: { user: 'catz' } }]);
	engine.registerNodeType('test.boom', async () => {
		throw new Error('soft-ish failure');
	});
	engine.registerNodeType('test.sink', async (node, items) =>
		items.map((item) => ({ json: { ...item.json, passedThrough: true } })),
	);

	const result = await engine.runWorkflow();
	assert.equal(result.status, 'COMPLETED');
	assert.equal(result.errors.length, 1);
	assert.equal(result.executionLog.find((e) => e.node === 'Boom').status, 'error');
	assert.equal(result.data.After[0].json.passedThrough, true);
	assert.equal(result.data.After[0].json.user, 'catz');
});

test('engine: continueErrorOutput memisahkan item error ke output "Error" (L1720 + L2463-L2561)', async () => {
	const engine = new WorkflowExecutionEngine(
		linearWorkflow(
			[
				{ name: 'Splitter', type: 'test.splitter', onError: 'continueErrorOutput' },
				{ name: 'Success Branch', type: 'test.sink' },
				{ name: 'Error Branch', type: 'test.sink' },
			],
			{
				Splitter: {
					main: [
						[{ node: 'Success Branch', type: 'main', index: 0 }],
						[{ node: 'Error Branch', type: 'main', index: 0 }],
					],
				},
			},
		),
	);
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [{ json: { go: true } }]);
	engine.registerNodeType('test.splitter', async () => [
		[{ json: { ok: 1 } }, { json: { error: 'row failed' } }],
	]);
	engine.registerNodeType('test.sink', async (node, items) => items);

	const result = await engine.runWorkflow();
	assert.equal(result.status, 'COMPLETED');
	assert.equal(result.data['Success Branch'].length, 1);
	assert.equal(result.data['Success Branch'][0].json.ok, 1);
	assert.equal(result.data['Error Branch'].length, 1);
	assert.equal(result.data['Error Branch'][0].json.error, 'row failed');
});

test('engine: regresi — workflow linear tanpa error tetap COMPLETED (kompatibel test-run.mjs)', async () => {
	const engine = new WorkflowExecutionEngine({
		nodes: [
			{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
			{ name: 'Code Node', type: 'n8n-nodes-base.code', parameters: {} },
			{ name: 'Transform Output', type: 'n8n-nodes-base.set', parameters: {} },
		],
		connections: {
			'Manual Trigger': { main: [[{ node: 'Code Node', type: 'main', index: 0 }]] },
			'Code Node': { main: [[{ node: 'Transform Output', type: 'main', index: 0 }]] },
		},
	});
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [{ json: { triggeredAt: 'now' } }]);
	engine.registerNodeType('n8n-nodes-base.code', async (node, items) =>
		items.map((item) => ({ json: { ...item.json, reconstructed: true } })),
	);
	engine.registerNodeType('n8n-nodes-base.set', async (node, items) =>
		items.map((item) => ({ json: { finalResult: 'PASS', data: item.json } })),
	);

	const result = await engine.runWorkflow();
	assert.equal(result.status, 'COMPLETED');
	assert.equal(result.data['Transform Output'][0].json.finalResult, 'PASS');
	assert.equal(result.errors.length, 0);
});

test('engine: continueErrorOutput membawa provenance item asal ke output Error ($getPairedItem)', async () => {
	const engine = new WorkflowExecutionEngine(
		linearWorkflow(
			[
				{ name: 'Splitter', type: 'test.splitter', onError: 'continueErrorOutput' },
				{ name: 'Error Branch', type: 'test.sink' },
			],
			{ Splitter: { main: [[], [{ node: 'Error Branch', type: 'main', index: 0 }]] } },
		),
	);
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [{ json: { userId: 42 } }]);
	engine.registerNodeType('test.splitter', async () => [
		{ json: { ok: 1 } },
		{ json: { error: 'row failed' }, pairedItem: { item: 0 } },
	]);
	engine.registerNodeType('test.sink', async (node, items) => items);

	const result = await engine.runWorkflow();
	assert.equal(result.status, 'COMPLETED');
	// Item error mewarisi JSON item asalnya: { ...sourceJson, ...errorJson }
	assert.deepEqual(result.data['Error Branch'][0].json, { userId: 42, error: 'row failed' });
});
