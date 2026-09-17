/**
 * Integrasi Error Recovery LEGO pada engine TypeScript (`src/execution-engine/workflow-execute.ts`).
 *
 * Engine TS dikompilasi ke CJS dulu (tsconfig paket ini memakai `module: commonjs`
 * dan `moduleResolution: node`, impor relatifnya tanpa ekstensi). Jalankan:
 *
 *   npm --prefix packages/reconstructed-engine run emit:cjs
 *   npm --prefix packages/reconstructed-engine run test:ts-integration
 *
 * Bila `dist-cjs/` belum ada, berkas ini SKIP (exit 0) supaya `npm test` tetap hijau
 * tanpa perlu build — sementara `test/*.test.mjs` (unit test) tidak butuh build sama sekali.
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const distCjs = process.env.RE_DIST_CJS || path.join(here, '..', 'dist-cjs');
const entry = path.join(distCjs, 'execution-engine', 'runner.js');

if (!existsSync(entry)) {
	console.log(`SKIP: ${path.relative(process.cwd(), entry)} belum ada.`);
	console.log('Jalankan: npm --prefix packages/reconstructed-engine run emit:cjs');
	process.exit(0);
}

const require = createRequire(import.meta.url);
const { ReconstructedWorkflowEngine } = require(entry);

// 1) retryOnFail: gagal 2x lalu sukses -> 3 percobaan (workflow-execute.ts L1600-L1680)
let calls = 0;
const engine = new ReconstructedWorkflowEngine({ mode: 'manual' });
engine.loadWorkflow({
	nodes: [
		{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
		{ name: 'Flaky', type: 'test.flaky', parameters: {}, retryOnFail: true, maxTries: 3, waitBetweenTries: 5 },
	],
	connections: { 'Manual Trigger': { main: [[{ node: 'Flaky', type: 'main', index: 0 }]] } },
});
engine.registerNodeType('n8n-nodes-base.manualTrigger', async function () {
	return [{ json: { go: true } }];
});
engine.registerNodeType('test.flaky', async function (items) {
	calls++;
	if (calls < 3) throw new Error(`upstream attempt ${calls} failed`);
	return items.map((item) => ({ json: { ...item.json, attempts: calls } }));
});

const result = await engine.executeWorkflow('Manual Trigger');
const flakyRun = result.resultData.runData.Flaky.at(-1);
assert.equal(calls, 3, 'handler harus dipanggil 3 kali');
assert.equal(flakyRun.tries, 3, 'taskData.tries harus 3');
assert.equal(flakyRun.executionStatus, 'success');
console.log(`TS engine retry integration: PASS (tries=${flakyRun.tries})`);

// 2) continueErrorOutput: item error dipindah ke output "Error" (L1720 + L2463-L2561)
const engine2 = new ReconstructedWorkflowEngine({ mode: 'manual' });
engine2.loadWorkflow({
	nodes: [
		{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
		{ name: 'Splitter', type: 'test.splitter', parameters: {}, onError: 'continueErrorOutput' },
		{ name: 'Error Branch', type: 'test.sink', parameters: {} },
	],
	connections: {
		'Manual Trigger': { main: [[{ node: 'Splitter', type: 'main', index: 0 }]] },
		Splitter: { main: [[], [{ node: 'Error Branch', type: 'main', index: 0 }]] },
	},
});
engine2.registerNodeType('n8n-nodes-base.manualTrigger', async function () {
	return [{ json: { go: true } }];
});
engine2.registerNodeType('test.splitter', async function () {
	return [[{ json: { ok: 1 } }, { json: { error: 'row failed' } }]];
});
engine2.registerNodeType('test.sink', async function (items) {
	return items.map((item) => ({ json: { ...item.json, handled: true } }));
});

const result2 = await engine2.executeWorkflow('Manual Trigger');
const splitRun = result2.resultData.runData.Splitter.at(-1);
assert.equal(splitRun.data.main[0].length, 1, 'output 0 hanya berisi item sukses');
assert.equal(splitRun.data.main[1].length, 1, 'output 1 (Error) berisi item error');
assert.ok(result2.resultData.runData['Error Branch'], 'cabang error harus dieksekusi');
console.log('TS engine continueErrorOutput integration: PASS');

console.log('ALL TS ENGINE INTEGRATION CHECKS PASSED');
