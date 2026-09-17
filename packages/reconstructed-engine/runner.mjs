/**
 * Reconstructed n8n Workflow Execution Engine (Node.js/ESM)
 * Mengadaptasi logika eksekusi DAG, state data flow, dan node handler 1:1 n8n v2.9.4.
 *
 * Penanganan error/retry mengikuti sumber referensi:
 *  - packages/core/src/execution-engine/workflow-execute.ts L1600-L1872, L1900-L1918, L2463-L2561
 *  - packages/workflow/src/node-helpers.ts L1170-L1195 (output "Error" ekstra saat
 *    `onError === 'continueErrorOutput'`)
 * Implementasinya berada di modul terisolasi `src/error-recovery-policy.ts`
 * (kontrak: contracts/error-recovery.contract.md) supaya bisa dipakai ulang oleh
 * engine ini maupun port Rust nanti.
 */

import {
	createPairedItemResolver,
	resolveErrorOutcome,
	resolveRetryPolicy,
	runWithRetry,
	splitErrorOutput,
	toExecutionError,
} from './src/error-recovery-policy.ts';

export class WorkflowExecutionEngine {
	constructor(workflowDefinition) {
		this.nodes = new Map();
		this.connections = workflowDefinition.connections || {};
		this.nodeTypes = new Map();

		// Inisialisasi node registry
		for (const node of workflowDefinition.nodes || []) {
			this.nodes.set(node.name, node);
		}
	}

	registerNodeType(typeName, handler) {
		this.nodeTypes.set(typeName, handler);
	}

	/**
	 * Jumlah output "main" sebuah node (node-helpers.ts L1170-L1195):
	 * `onError === 'continueErrorOutput'` selalu menambah satu output khusus "Error".
	 */
	mainOutputCount(nodeName, node) {
		const declared = Math.max(this.connections[nodeName]?.main?.length ?? 1, 1);
		return node?.onError === 'continueErrorOutput' ? Math.max(declared, 2) : declared;
	}

	/** Tidur antar-percobaan retry (bisa di-override pada tes). */
	async #sleep(ms) {
		if (ms <= 0) return;
		await new Promise((resolve) => setTimeout(resolve, ms));
	}

	async runWorkflow(startNodeName = null, initialData = [{}]) {
		const executionData = new Map(); // nodeName -> item output utama (bentuk lama, kompatibel)
		const runData = new Map(); // nodeName -> INodeExecutionData[][] (bentuk kanonis n8n, per-output)
		const visited = new Set();
		const executionLog = [];
		const errors = [];

		// Cari entry trigger node jika tidak ditentukan eksplisit
		let currentNodeName = startNodeName;
		if (!currentNodeName) {
			for (const [name, node] of this.nodes.entries()) {
				if (node.type.includes('trigger') || node.type.includes('Manual') || node.type.includes('Start')) {
					currentNodeName = name;
					break;
				}
			}
		}

		if (!currentNodeName) {
			// Ambil sembarang node pertama
			currentNodeName = this.nodes.keys().next().value;
		}

		if (!currentNodeName) {
			throw new Error('No nodes found in workflow definition');
		}

		// Queue antrean eksekusi berbasis DAG BFS
		const queue = [
			{ nodeName: currentNodeName, inputData: initialData.map((d) => ({ json: d })), sourceNode: null },
		];

		let status = 'COMPLETED';

		while (queue.length > 0) {
			const { nodeName, inputData, sourceNode } = queue.shift();
			const node = this.nodes.get(nodeName);
			if (!node) continue;

			const startTime = Date.now();
			const handler = this.nodeTypes.get(node.type);
			const policy = resolveRetryPolicy(node);

			let outputData = []; // selalu INodeExecutionData[][]
			let executionError;
			let tries = 1;

			if (handler) {
				// Eksekusi logika node dengan kebijakan retry n8n (workflow-execute.ts L1600-L1680)
				const outcome = await runWithRetry(
					(tryIndex) => handler(node, inputData, tryIndex),
					policy,
					{ sleep: (ms) => this.#sleep(ms) },
				);
				tries = outcome.tries;
				if (outcome.status === 'error') {
					executionError = outcome.error;
				} else {
					outputData = toOutputBranches(outcome.data);
				}
			} else {
				// Default passthrough node
				outputData = toOutputBranches(inputData);
			}

			const durationMs = Date.now() - startTime;
			const logEntry = { node: nodeName, type: node.type, inputCount: inputData.length, tries };
			let logged = false;

			if (executionError) {
				const errorOutcome = resolveErrorOutcome(node); // workflow-execute.ts L1839-L1846

				if (errorOutcome === 'stop-workflow') {
					// Node execution did fail -> catat error dan hentikan eksekusi (L1857+)
					executionData.set(nodeName, []);
					visited.add(nodeName);
					executionLog.push({
						...logEntry,
						outputCount: 0,
						durationMs,
						status: 'error',
						errorOutcome,
						error: executionError.message,
					});
					logged = true;
					errors.push({ node: nodeName, error: executionError.message, stack: executionError.stack });
					status = 'ERROR';
					break;
				}

				// Cabang lanjut (L1848-L1855): data input diteruskan ke output reguler.
				// CATATAN 1:1 — pada jalur hard-throw upstream, item error TIDAK dikirim ke
				// output "Error"; ini perilaku n8n yang terdokumentasi (issue n8n#23224).
				outputData = toOutputBranches(inputData);
				executionLog.push({
					...logEntry,
					outputCount: inputData.length,
					durationMs,
					status: 'error',
					errorOutcome,
					error: executionError.message,
				});
				logged = true;
				errors.push({ node: nodeName, error: executionError.message, stack: executionError.stack });
			}

			// Jalur sukses: normalisasi item error lalu pindahkan ke output "Error"
			// (workflow-execute.ts L1720-L1722 + L2463-L2561) bila node memilikinya.
			if (!executionError && node.onError === 'continueErrorOutput') {
				// Error Recovery LEGO: item error diperkaya JSON item asalnya lewat
				// `$getPairedItem` (workflow-execute.ts L2524-L2560). `runData` disusun
				// dari hasil node yang sudah dieksekusi (satu run per node di engine ini).
				const resolver = createPairedItemResolver(
					Object.fromEntries(
						[...runData.entries()].map(([name, branches]) => [
							name,
							[{ data: { main: branches }, source: [] }],
						]),
					),
				);
				const source = {
					main: [
						sourceNode
							? { previousNode: sourceNode, previousNodeOutput: 0, previousNodeRun: 0 }
							: null,
					],
				};
				const split = splitErrorOutput(outputData, this.mainOutputCount(nodeName, node), {
					resolver,
					source,
				});
				outputData = split.data;
			}

			executionData.set(nodeName, outputData[0] ?? []);
			runData.set(nodeName, outputData);
			visited.add(nodeName);

			if (!logged) {
				executionLog.push({
					...logEntry,
					outputCount: outputData[0]?.length ?? 0,
					durationMs,
					status: executionError ? 'error' : 'success',
				});
			}

			// Cari koneksi output ke node berikutnya.
			// workflow-execute.ts L2020-L2026: node tujuan hanya dieksekusi bila output
			// pada index tersebut berisi data.
			const nodeConns = this.connections[nodeName];
			if (nodeConns && nodeConns.main) {
				nodeConns.main.forEach((outputList, outputIndex) => {
					const branchData = outputData?.[outputIndex];
					if (!branchData || branchData.length === 0) return;
					for (const conn of outputList) {
						queue.push({
							nodeName: conn.node,
							inputData: branchData,
							sourceNode: nodeName,
							sourceOutputIndex: outputIndex,
						});
					}
				});
			}
		}

		return {
			status,
			finished: true,
			executionLog,
			errors,
			data: Object.fromEntries(executionData.entries()),
			runData: Object.fromEntries(runData.entries()),
		};
	}
}

/**
 * Normalisasi hasil handler ke bentuk kanonis n8n `INodeExecutionData[][]`
 * (array per-output). Handler lama mengembalikan array item datar untuk satu
 * output, sehingga dibungkus otomatis — kompatibilitas mundur terjaga.
 */
function toOutputBranches(raw) {
	if (Array.isArray(raw) && Array.isArray(raw[0])) return raw;
	return [Array.isArray(raw) ? raw : []];
}

/** Ekspor ulang utilitas error supaya bisa dipakai node handler kustom. */
export { toExecutionError, toOutputBranches };
