/**
 * Regression suite — reconstructed Workflow Execution Engine (packages/reconstructed-engine).
 *
 * Ini adalah pengujian regresi untuk artefak rekonstruksi JavaScript yang diwajibkan
 * PROJECT_RULES.md rule 1 (ZERO RUST). Sebelumnya satu-satunya "test" adalah
 * `test-run.mjs`, sebuah skrip console tanpa assertion yang mencetak
 * "Berfungsi 100% Sempurna!" selama `status === "COMPLETED"` — ia tidak bisa gagal
 * untuk apa pun selain crash, dan tidak pernah dijalankan oleh gate mana pun.
 *
 * Setiap kasus di sini menyatakan perilaku yang *benar-benar* terjadi, termasuk dua
 * titik di mana rekonstruksi ini menyimpang dari n8n 2.9.4 asli (ditandai DIVERGENCE).
 *
 * run: node --test packages/reconstructed-engine/test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WorkflowExecutionEngine } from '../runner.mjs';

const item = (json) => ({ json });
const conn = (node, index = 0) => ({ node, type: 'main', index });
const linear = () => ({
	nodes: [
		{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
		{ name: 'Code Node', type: 'n8n-nodes-base.code', parameters: {} },
		{ name: 'Transform Output', type: 'n8n-nodes-base.set', parameters: {} },
	],
	connections: {
		'Manual Trigger': { main: [[conn('Code Node')]] },
		'Code Node': { main: [[conn('Transform Output')]] },
	},
});

test('linear chain: setiap node dieksekusi sekali, berurutan, item mengalir', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine(linear());
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ start: true })]);
	engine.registerNodeType('n8n-nodes-base.code', async (_n, items) =>
		items.map((i) => item({ ...i.json, coded: true })),
	);
	engine.registerNodeType('n8n-nodes-base.set', async (_n, items) =>
		items.map((i) => item({ final: 'PASS', processedItems: items.length, data: i.json })),
	);

	const result = await engine.runWorkflow();

	assert.equal(result.status, 'COMPLETED');
	assert.equal(result.finished, true);
	assert.equal(result.cyclic, false);
	assert.deepEqual(
		result.executionLog.map((e) => e.node),
		['Manual Trigger', 'Code Node', 'Transform Output'],
	);
	assert.deepEqual(result.data['Transform Output'], [
		item({ final: 'PASS', processedItems: 1, data: { start: true, coded: true } }),
	]);
});

test('executionLog entry memiliki bentuk yang stabil', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine(linear());
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ a: 1 }), item({ a: 2 })]);

	const result = await engine.runWorkflow();
	const first = result.executionLog[0];

	assert.deepEqual(Object.keys(first).sort(), [
		'durationMs',
		'inputCount',
		'node',
		'outputCount',
		'status',
		'type',
	]);
	assert.equal(first.node, 'Manual Trigger');
	assert.equal(first.type, 'n8n-nodes-base.manualTrigger');
	assert.equal(first.inputCount, 1); // initialData default = [{}]
	assert.equal(first.outputCount, 2);
	assert.equal(first.status, 'success');
	assert.equal(typeof first.durationMs, 'number');
});

test('node tanpa handler terdaftar = passthrough (item tidak berubah)', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine(linear());
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ keep: 'me' })]);

	const result = await engine.runWorkflow();

	assert.deepEqual(result.data['Code Node'], [item({ keep: 'me' })]);
	assert.deepEqual(result.data['Transform Output'], [item({ keep: 'me' })]);
});

test('fan-out: satu output dikirim ke dua node downstream', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine({
		nodes: [
			{ name: 'T', type: 'n8n-nodes-base.manualTrigger' },
			{ name: 'B', type: 'n8n-nodes-base.set' },
			{ name: 'C', type: 'n8n-nodes-base.set' },
		],
		connections: { T: { main: [[conn('B'), conn('C')]] } },
	});
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ v: 1 })]);

	const result = await engine.runWorkflow();

	assert.deepEqual(result.executionLog.map((e) => e.node).sort(), ['B', 'C', 'T']);
	assert.deepEqual(result.data.B, [item({ v: 1 })]);
	assert.deepEqual(result.data.C, [item({ v: 1 })]);
});

test('DIVERGENCE: diamond fan-in mengeksekusi node tujuan sekali per edge masuk', { timeout: 5000 }, async () => {
	// n8n 2.9.4 asli MENUNGGU semua input masuk lalu mengeksekusi D sekali dengan
	// item gabungan. BFS rekonstruksi ini mengeksekusi D dua kali (sekali per
	// kedatangan) dan `data.D` menyimpan kedatangan terakhir. Perilaku ini
	// dikunci di sini supaya perubahan berikutnya sadar bahwa ia mengubahnya.
	const engine = new WorkflowExecutionEngine({
		nodes: [
			{ name: 'A', type: 'n8n-nodes-base.manualTrigger' },
			{ name: 'B', type: 'n8n-nodes-base.set' },
			{ name: 'C', type: 'n8n-nodes-base.set' },
			{ name: 'D', type: 'n8n-nodes-base.set' },
		],
		connections: {
			A: { main: [[conn('B'), conn('C')]] },
			B: { main: [[conn('D')]] },
			C: { main: [[conn('D')]] },
		},
	});
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ v: 1 })]);

	const result = await engine.runWorkflow();

	assert.equal(result.cyclic, false); // diamond bukan siklus: tidak boleh dianggap siklus
	assert.equal(
		result.executionLog.filter((e) => e.node === 'D').length,
		2,
		'D dieksekusi dua kali (sekali per edge masuk) — bukan sekali seperti n8n asli',
	);
});

test('CYCLE GUARD: siklus A->B->A berhenti dan dilaporkan, bukan menggantung', { timeout: 5000 }, async () => {
	// Sebelum guard ini, kasus di bawah tidak pernah selesai: loop BFS sinkron
	// membuat event loop kelaparan sehingga watchdog setTimeout pun tidak jalan
	// (terverifikasi: proses masih hidup setelah 12 detik, di-kill oleh `timeout`).
	const engine = new WorkflowExecutionEngine({
		nodes: [
			{ name: 'A', type: 'n8n-nodes-base.manualTrigger' },
			{ name: 'B', type: 'n8n-nodes-base.set' },
		],
		connections: { A: { main: [[conn('B')]] }, B: { main: [[conn('A')]] } },
	});
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ v: 1 })]);

	const result = await engine.runWorkflow('A');

	assert.equal(result.cyclic, true);
	assert.deepEqual(
		result.cycleSkips.map((s) => s.node),
		['A'],
	);
	assert.equal(result.executionLog.filter((e) => e.node === 'A').length, 1);
	assert.equal(result.executionLog.filter((e) => e.node === 'B').length, 1);
});

test('CYCLE GUARD: self-loop A->A berhenti', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine({
		nodes: [{ name: 'A', type: 'n8n-nodes-base.manualTrigger' }],
		connections: { A: { main: [[conn('A')]] } },
	});
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ v: 1 })]);

	const result = await engine.runWorkflow('A');

	assert.equal(result.cyclic, true);
	assert.equal(result.executionLog.length, 1);
});

test('CYCLE GUARD: siklus panjang A->B->C->A berhenti', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine({
		nodes: [
			{ name: 'A', type: 'n8n-nodes-base.manualTrigger' },
			{ name: 'B', type: 'n8n-nodes-base.set' },
			{ name: 'C', type: 'n8n-nodes-base.set' },
		],
		connections: {
			A: { main: [[conn('B')]] },
			B: { main: [[conn('C')]] },
			C: { main: [[conn('A')]] },
		},
	});
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ v: 1 })]);

	const result = await engine.runWorkflow('A');

	assert.equal(result.cyclic, true);
	assert.equal(result.executionLog.length, 3, 'tiap node tetap dieksekusi tepat satu kali');
});

test('workflow kosong melempar "No nodes found"', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine({ nodes: [], connections: {} });
	await assert.rejects(() => engine.runWorkflow(), /No nodes found/);
});

test('start node eksplisit mengalahkan deteksi trigger otomatis', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine({
		nodes: [
			{ name: 'T', type: 'n8n-nodes-base.manualTrigger' },
			{ name: 'X', type: 'n8n-nodes-base.set' },
		],
		connections: { T: { main: [[conn('X')]] } },
	});
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ from: 'trigger' })]);

	const result = await engine.runWorkflow('X', [{ seeded: true }]);

	assert.equal(result.executionLog.length, 1);
	assert.equal(result.executionLog[0].node, 'X');
	assert.deepEqual(result.data.X, [item({ seeded: true })]);
});

test('deteksi trigger otomatis: node pertama yang type-nya mengandung "trigger"', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine({
		nodes: [
			{ name: 'Plain', type: 'n8n-nodes-base.set' },
			{ name: 'Webhook', type: 'n8n-nodes-base.webhook' },
		],
		connections: {},
	});

	const result = await engine.runWorkflow();

	// 'Plain' dieksekusi: tidak ada node bertipe trigger, jadi engine memakai node
	// pertama sebagai fallback (perilaku lama yang dipertahankan).
	assert.equal(result.executionLog[0].node, 'Plain');
});

test('DIVERGENCE: handler yang melempar menolak seluruh run (n8n mencatat error node)', { timeout: 5000 }, async () => {
	// n8n 2.9.4 menangkap error node, menandainya `error`, dan menghentikan run dengan
	// status 'error' + runData yang tersimpan. Rekonstruksi ini membiarkan rejection
	// naik ke pemanggil dan TIDAK menghasilkan result sama sekali. Dikunci di sini
	// sebagai utang yang diketahui, bukan sebagai perilaku yang diinginkan.
	const engine = new WorkflowExecutionEngine({
		nodes: [{ name: 'Boom', type: 'n8n-nodes-base.code' }],
		connections: {},
	});
	engine.registerNodeType('n8n-nodes-base.code', async () => {
		throw new Error('node exploded');
	});

	await assert.rejects(() => engine.runWorkflow('Boom'), /node exploded/);
});

test('koneksi ke node yang tidak ada di graph diabaikan, bukan crash', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine({
		nodes: [{ name: 'T', type: 'n8n-nodes-base.manualTrigger' }],
		connections: { T: { main: [[conn('Ghost')]] } },
	});
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ v: 1 })]);

	const result = await engine.runWorkflow();

	assert.equal(result.status, 'COMPLETED');
	assert.deepEqual(result.executionLog.map((e) => e.node), ['T']);
	assert.equal(result.cyclic, false);
});
