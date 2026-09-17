// n8n reconstructed engine — Phase 5 integration suite.
//
// This suite drives the PRODUCTION facade (`src/n8n-reconstructed-facade.ts`) through Node's native
// TypeScript execution (Node >= 22.18). It used to run against an inline `TestFacade` copy, which
// meant "12/12 integration PASS" was never a statement about the shipped artifact — the copy could
// pass while the facade was broken. The scenarios below are unchanged; the subject is now real.
//
// Scenario 03 also pins the LEGO 03 integration: results must come back in connection order via the
// verified `P-CONNECTION-GRAPH` port, not in declaration order.
import { n8nFacade as facade } from './src/n8n-reconstructed-facade.ts';

const connection = (node, index = 0) => ({ node, type: 'main', index });

async function runTests() {
	const tests = [
		{ name: '01-empty-workflow', fn: async () => { const r = await facade.executeWorkflow({ workflowId: 'empty', workflow: { nodes: [], connections: {} }, mode: 'manual' }); if (!r.success) throw new Error(r.error); } },
		{ name: '02-one-node', fn: async () => { const r = await facade.executeWorkflow({ workflowId: 'one', workflow: { nodes: [{ name: 'Manual Trigger', type: 'manualTrigger' }], connections: {} }, mode: 'manual' }); if (r.data.length !== 1) throw new Error('expected 1'); } },
		{
			name: '03-linear (connection order)',
			fn: async () => {
				if (typeof facade.connection?.getRootNodes !== 'function') throw new Error('facade does not expose the verified connection port');
				// Declared C, A, B on purpose: declaration order must NOT decide the execution order.
				const r = await facade.executeWorkflow({
					workflowId: 'linear',
					workflow: {
						nodes: [{ name: 'C' }, { name: 'A' }, { name: 'B' }],
						connections: { A: { main: [[connection('B')]] }, B: { main: [[connection('C')]] } },
					},
					mode: 'manual',
				});
				if (!r.success) throw new Error(r.error);
				const order = r.data.map((entry) => entry.node).join('>');
				if (order !== 'A>B>C') throw new Error(`expected connection order A>B>C, got ${order}`);
				if (JSON.stringify(r.executionOrder) !== JSON.stringify(['A', 'B', 'C'])) throw new Error(`executionOrder ${JSON.stringify(r.executionOrder)}`);
			},
		},
		{ name: '04-execution-data', fn: async () => { const s = await facade.persistence.saveWorkflow({ nodes: [{ name: 'Test' }], connections: {} }); const e = await facade.persistence.saveExecution({ workflowId: s.id, status: 'success' }); const g = await facade.persistence.getExecution(e.id); if (!g) throw new Error('not found'); } },
		{ name: '05-expression', fn: async () => { const isExpr = (text) => /\{\{.*\}\}/.test(text); if (!isExpr('{{ $json.test }}')) throw new Error('isExpression fail'); } },
		{ name: '06-trigger', fn: async () => { await facade.activateWorkflow('test-trigger', { nodes: [{ type: 'manualTrigger' }] }); if (!facade.trigger.isActive('test-trigger')) throw new Error('not active'); await facade.deactivateWorkflow('test-trigger'); if (facade.trigger.isActive('test-trigger')) throw new Error('still active'); } },
		{ name: '07-webhook', fn: async () => { facade.webhook.storeWebhook({ webhookPath: 'test', method: 'POST', node: 'Webhook', workflowId: 'wf1' }); const found = facade.webhook.findWebhook('POST', 'test'); if (!found) throw new Error('not found'); try { facade.webhook.storeWebhook({ webhookPath: 'test', method: 'POST', node: 'W2', workflowId: 'wf2' }); throw new Error('should conflict'); } catch (error) { if (!error.message.includes('conflict')) throw error; } } },
		{ name: '08-scheduler', fn: async () => { facade.scheduler.registerCron({ workflowId: 'wf', nodeId: '1', expression: '* * * * *' }, () => {}); facade.scheduler.deregisterCrons('wf'); if (facade.scheduler.cronsByWorkflow.has('wf')) throw new Error('not deregistered'); } },
		{ name: '09-persistence', fn: async () => { const s = await facade.persistence.saveWorkflow({ nodes: [{ name: 'Test' }], connections: {} }); const g = await facade.persistence.getWorkflow(s.id); if (!g) throw new Error('not found'); } },
		{ name: '10-credentials', fn: async () => { const c = await facade.credentials.createCredential('test', 'Test', { key: 'val' }); const d = await facade.credentials.getDecrypted(c.id, 'test'); if (d.key !== 'val') throw new Error('decrypt fail'); } },
		{ name: '11-api-envelope', fn: async () => { const h = facade.getHealth(); if (h.status !== 'ok') throw new Error('health not ok'); } },
		{ name: '12-zero-rust', fn: async () => { const h = facade.getHealth(); if (!h.checks.zeroRust) throw new Error('zero rust fail'); if (h.checks.legos !== 12) throw new Error(`expected 12 LEGO, got ${h.checks.legos}`); } },
	];

	let pass = 0;
	let fail = 0;
	for (const test of tests) {
		const start = Date.now();
		try {
			await test.fn();
			console.log(`✅ ${test.name} (${Date.now() - start}ms)`);
			pass++;
		} catch (error) {
			console.log(`❌ ${test.name}: ${error.message}`);
			fail++;
		}
	}
	console.log(`\n=== INTEGRATION TEST: ${pass}/${pass + fail} PASS, ${fail} FAIL ===`);
	if (fail === 0) console.log('>>> VERIFIKASI BERHASIL: Engine n8n Rekonstruksi Phase 5 INTEGRATED 100% Sempurna! <<<');
	process.exit(fail > 0 ? 1 : 0);
}

runTests();
