/**
 * TASK-PIPE-02 conformance tests — encode the behavioral invariants from
 * docs/isolation/execution-loop-spec.md §7 (POOL-001, source: n8n 2.9.4
 * workflow-execute.ts). Run: node --test test/execution-loop.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { WorkflowExecute } from '../src/workflow-execute.mjs';
import { createWorkflow } from '../src/workflow-scaffold.mjs';
import { createLifecycleHooks } from '../src/hooks.mjs';
import { createRunExecutionData } from '../src/run-execution-data.mjs';

// ---------------------------------------------------------------- helpers ----

function nodeType({ execute, ...rest }) {
	return {
		description: { name: 'test', outputs: ['main'], inputs: [{ type: 'main' }], ...rest.description },
		execute,
		...rest,
	};
}

/** standard passthrough: returns its first input items */
const pass = () =>
	nodeType({
		execute: async function () {
			return [this.getInputData()];
		},
	});

/**
 * @param {object} params
 * @param {Array} params.nodes
 * @param {object} params.connections
 * @param {object} params.nodeTypes
 * @param {object} [params.settings]
 * @param {object} [params.runOptions] { startNode, destinationNode, pinData }
 */
async function execute(params) {
	const workflow = createWorkflow({
		nodes: params.nodes,
		connections: params.connections,
		nodeTypes: params.nodeTypes,
		settings: params.settings ?? {},
		id: 'wf-test',
	});

	// Default start node: first node without incoming main connections (the
	// reference getStartNode() only auto-detects trigger/poll/manual-trigger
	// nodes; plain test workflows pass the entry node explicitly).
	const runOptions = { ...params.runOptions };
	if (runOptions.startNode === undefined) {
		runOptions.startNode =
			params.nodes.find(
				(n) =>
					!(workflow.connectionsByDestinationNode[n.name]?.main?.length > 0) ||
					workflow.connectionsByDestinationNode[n.name].main.every(
						(inputs) => !inputs || inputs.length === 0,
					),
			) ?? params.nodes[0];
	}

	const hookCalls = [];
	const hooks = createLifecycleHooks({
		workflowExecuteBefore: () => hookCalls.push('workflowExecuteBefore'),
		workflowExecuteResume: () => hookCalls.push('workflowExecuteResume'),
		workflowExecuteAfter: () => hookCalls.push('workflowExecuteAfter'),
		nodeExecuteBefore: (name) => hookCalls.push(`nodeExecuteBefore:${name}`),
		nodeExecuteAfter: (name) => hookCalls.push(`nodeExecuteAfter:${name}`),
		sendChunk: (chunk) => hookCalls.push(`sendChunk:${chunk?.type}`),
	});

	const executeData = new WorkflowExecute(
		{ hooks, currentNodeExecutionIndex: 0, executionId: 'test-execution' },
		'manual',
	);

	const fullRunData = await executeData.run({ workflow, ...runOptions });

	const executedOrder = Object.entries(fullRunData.data.resultData.runData)
		.flatMap(([name, runs]) => runs.map((r) => ({ name, executionIndex: r.executionIndex })))
		.sort((a, b) => a.executionIndex - b.executionIndex)
		.map((r) => r.name);

	return { fullRunData, executedOrder, hookCalls, workflow, executeData };
}

const N = (name, type = 'test', extra = {}) => ({
	id: name,
	name,
	type,
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
	disabled: false,
	...extra,
});

/** connect([source, target, outputIndex?, inputIndex?], ...) -> workflow JSON connections */
function connect(...specs) {
	const connections = {};
	for (const [source, target, outputIndex = 0, inputIndex = 0] of specs) {
		connections[source] ??= { main: [] };
		const outputs = connections[source].main;
		while (outputs.length <= outputIndex) outputs.push([]);
		outputs[outputIndex].push({ node: target, type: 'main', index: inputIndex });
	}
	return connections;
}

// ------------------------------------------------------------------ tests ----

test('1. linear workflow: pop shift, run, route downstream (spec §4.1)', async () => {
	const { fullRunData, executedOrder } = await execute({
		nodes: [N('A'), N('B'), N('C')],
		connections: connect(['A', 'B'], ['B', 'C']),
		nodeTypes: { test: pass() },
	});

	assert.deepEqual(executedOrder, ['A', 'B', 'C']);
	assert.equal(fullRunData.status, 'success');
	assert.equal(fullRunData.finished, true);
	for (const name of ['A', 'B', 'C']) {
		const runs = fullRunData.data.resultData.runData[name];
		assert.equal(runs.length, 1);
		assert.equal(runs[0].executionStatus, 'success');
		assert.ok(runs[0].data.main[0].length >= 1);
	}
	assert.equal(fullRunData.data.resultData.runData.A[0].source.length, 0); // start node: no source
	assert.equal(fullRunData.data.resultData.runData.B[0].source[0].previousNode, 'A');
	assert.equal(fullRunData.data.resultData.runData.C[0].source[0].previousNode, 'B');
});

test('2. v0 (legacy) ordering: breadth-first via push (spec §6)', async () => {
	// B sits BELOW C on the canvas (y=300 vs y=100)
	const { executedOrder } = await execute({
		nodes: [N('A'), N('B', 'test', { position: [100, 300] }), N('C', 'test', { position: [100, 100] }), N('D')],
		connections: connect(['A', 'B'], ['A', 'C'], ['B', 'D', 0, 1], ['C', 'D']),
		nodeTypes: { test: pass() },
		settings: { executionOrder: 'v0' },
	});
	// v0: A enqueues B then C (push, FIFO) → B, C, then D after join
	assert.deepEqual(executedOrder, ['A', 'B', 'C', 'D']);
});

test('3. v1 ordering: top-left sibling first via unshift (spec §6)', async () => {
	// same graph as v0 test: B below (y=300), C above (y=100)
	const { executedOrder } = await execute({
		nodes: [N('A'), N('B', 'test', { position: [100, 300] }), N('C', 'test', { position: [100, 100] }), N('D')],
		connections: connect(['A', 'B'], ['A', 'C'], ['B', 'D', 0, 1], ['C', 'D']),
		nodeTypes: { test: pass() },
		settings: { executionOrder: 'v1' },
	});
	// v1: C (top-left) executes before B; D joins after both
	assert.deepEqual(executedOrder, ['A', 'C', 'B', 'D']);
});

test('4. v1 sibling sort comparator (WEX:2027-2040)', async () => {
	const { executedOrder } = await execute({
		nodes: [N('A'), N('Top', 'test', { position: [0, 100] }), N('Bottom', 'test', { position: [0, 300] })],
		connections: connect(['A', 'Top'], ['A', 'Bottom']),
		nodeTypes: { test: pass() },
		settings: { executionOrder: 'v1' },
	});
	// smaller y (higher on canvas) pops first under v1 unshift ordering
	assert.deepEqual(executedOrder, ['A', 'Top', 'Bottom']);
});

test('5. null output kills the branch and is not recorded (spec invariant 3)', async () => {
	const { fullRunData, executedOrder } = await execute({
		nodes: [N('A'), N('Dead', 'dead'), N('After', 'test')],
		connections: connect(['A', 'Dead'], ['Dead', 'After']),
		nodeTypes: {
			test: pass(),
			dead: nodeType({ execute: async () => null }),
		},
	});
	assert.deepEqual(executedOrder, ['A']);
	assert.equal(fullRunData.status, 'success');
	assert.equal(fullRunData.finished, true);
	// null-output node records NO run data (WEX:1771-1776 continues before recording)
	assert.equal(fullRunData.data.resultData.runData.Dead, undefined);
	assert.equal(fullRunData.data.resultData.runData.After, undefined);
	assert.equal(fullRunData.data.resultData.lastNodeExecuted, 'A');
});

test('6. empty output array records run but does not enqueue downstream (spec invariant 3)', async () => {
	const { fullRunData, executedOrder } = await execute({
		nodes: [N('A'), N('Empty', 'empty'), N('After', 'test')],
		connections: connect(['A', 'Empty'], ['Empty', 'After']),
		nodeTypes: {
			test: pass(),
			empty: nodeType({ execute: async () => [[]] }),
		},
	});
	assert.deepEqual(executedOrder, ['A', 'Empty']);
	assert.equal(fullRunData.data.resultData.runData.After, undefined);
	assert.deepEqual(fullRunData.data.resultData.runData.Empty[0].data.main, [[]]);
});

test('7. alwaysOutputData synthesizes {json:{}} on empty output (spec §4.1k)', async () => {
	const { fullRunData } = await execute({
		nodes: [N('A'), N('B', 'empty', { alwaysOutputData: true })],
		connections: connect(['A', 'B']),
		nodeTypes: {
			test: pass(),
			empty: nodeType({ execute: async () => null }),
		},
	});
	const bRun = fullRunData.data.resultData.runData.B[0];
	assert.deepEqual(bRun.data.main[0], [{ json: {}, pairedItem: [{ item: 0, input: 0 }] }]);
});

test('8. multi-input join: waits for all inputs then runs with both (spec invariant 4)', async () => {
	let seenInputs = null;
	const { executedOrder } = await execute({
		nodes: [N('Start'), N('A'), N('B'), N('Merge', 'merge')],
		connections: connect(
			['Start', 'A'],
			['Start', 'B'],
			['A', 'Merge'],
			['B', 'Merge', 0, 1],
		),
		nodeTypes: {
			test: nodeType({
				execute: async function () {
					return [[{ json: { from: this.node.name } }]];
				},
			}),
			merge: nodeType({
				description: { name: 'merge', outputs: ['main'], inputs: [{ type: 'main' }, { type: 'main' }] },
				execute: async function () {
					seenInputs = this.inputData.main;
					return [this.inputData.main[0]];
				},
			}),
		},
		settings: { executionOrder: 'v1' },
	});
	assert.deepEqual(executedOrder, ['Start', 'B', 'A', 'Merge']);
	assert.equal(seenInputs.length, 2);
	assert.deepEqual(seenInputs[0].map((i) => i.json.from), ['A']);
	assert.deepEqual(seenInputs[1].map((i) => i.json.from), ['B']);
});

test('9. empty branch counts as delivered: join completes with padded empty input (spec §4.2)', async () => {
	let seenInputs = null;
	const { executedOrder } = await execute({
		nodes: [N('Start'), N('A'), N('Empty', 'empty'), N('Merge', 'merge')],
		connections: connect(
			['Start', 'A'],
			['Start', 'Empty'],
			['A', 'Merge'],
			['Empty', 'Merge', 0, 1],
		),
		nodeTypes: {
			test: nodeType({
				execute: async function () {
					return [[{ json: { from: this.node.name } }]];
				},
			}),
			empty: nodeType({ execute: async () => [[]] }),
			merge: nodeType({
				description: { name: 'merge', outputs: ['main'], inputs: [{ type: 'main' }, { type: 'main' }] },
				execute: async function () {
					seenInputs = this.inputData.main;
					return [this.inputData.main[0]];
				},
			}),
		},
		settings: { executionOrder: 'v1' },
	});
	assert.deepEqual(executedOrder, ['Start', 'Empty', 'A', 'Merge']);
	assert.deepEqual(seenInputs[0].map((i) => i.json.from), ['A']);
	assert.deepEqual(seenInputs[1], []);
});

test('10. pinData short-circuits execution, runIndex 0 (spec invariant 5)', async () => {
	let executed = false;
	const { fullRunData } = await execute({
		nodes: [N('A'), N('B', 'counting')],
		connections: connect(['A', 'B']),
		nodeTypes: {
			test: pass(),
			counting: nodeType({
				execute: async () => {
					executed = true;
					return [[{ json: {} }]];
				},
			}),
		},
		runOptions: { pinData: { B: [{ json: { pinned: true } }] } },
	});
	assert.equal(executed, false);
	// assignPairedItems runs on pinned data too (single input+output → item 0)
	assert.deepEqual(fullRunData.data.resultData.runData.B[0].data.main[0], [
		{ json: { pinned: true }, pairedItem: { item: 0 } },
	]);
});

test('11. hard error: recorded, node re-queued at stack front, downstream stops (spec invariant 7)', async () => {
	const { fullRunData, executedOrder, executeData } = await execute({
		nodes: [N('A'), N('Bad', 'bad'), N('C')],
		connections: connect(['A', 'Bad'], ['Bad', 'C']),
		nodeTypes: {
			test: pass(),
			bad: nodeType({
				execute: async () => {
					throw new Error('node exploded');
				},
			}),
		},
	});
	assert.deepEqual(executedOrder, ['A', 'Bad']);
	assert.equal(fullRunData.status, 'error');
	assert.equal(fullRunData.finished, undefined);
	const badRun = fullRunData.data.resultData.runData.Bad[0];
	assert.equal(badRun.executionStatus, 'error');
	assert.equal(badRun.error.message, 'node exploded');
	assert.equal(fullRunData.data.resultData.lastNodeExecuted, 'Bad');
	const stack = executeData.runExecutionData.executionData.nodeExecutionStack;
	assert.equal(stack.length, 1);
	assert.equal(stack[0].node.name, 'Bad'); // unshifted to FRONT for restart
	assert.equal(fullRunData.data.resultData.runData.C, undefined);
});

test('12. continueOnFail: input passes through, workflow continues (spec invariant 6)', async () => {
	const { fullRunData, executedOrder } = await execute({
		nodes: [N('A'), N('Bad', 'bad', { continueOnFail: true }), N('C', 'echo')],
		connections: connect(['A', 'Bad'], ['Bad', 'C']),
		nodeTypes: {
			test: nodeType({
				execute: async function () {
					return [[{ json: { from: this.node.name } }]];
				},
			}),
			echo: nodeType({ execute: async function () { return [this.getInputData()]; } }),
			bad: nodeType({
				execute: async () => {
					throw new Error('soft fail');
				},
			}),
		},
	});
	const cRun = fullRunData.data.resultData.runData.C;
	assert.ok(cRun, 'C should have executed');
	assert.deepEqual(cRun[0].data.main[0].map((i) => i.json.from), ['A']); // A's items passed through Bad
	assert.equal(executedOrder.join(','), 'A,Bad,C');
	assert.equal(fullRunData.status, 'success');
	assert.equal(fullRunData.data.resultData.runData.Bad[0].executionStatus, 'error');
});

test('13. onError=continueRegularOutput behaves like continueOnFail (spec invariant 6)', async () => {
	const { fullRunData } = await execute({
		nodes: [N('A'), N('Bad', 'bad', { onError: 'continueRegularOutput' }), N('C')],
		connections: connect(['A', 'Bad'], ['Bad', 'C']),
		nodeTypes: {
			test: nodeType({
				execute: async function () {
					return [[{ json: { from: this.node.name } }]];
				},
			}),
			bad: nodeType({
				execute: async () => {
					throw new Error('soft fail');
				},
			}),
		},
	});
	assert.ok(fullRunData.data.resultData.runData.C);
	assert.equal(fullRunData.status, 'success');
});

test('14. onError=continueErrorOutput records error status but continues (spec §4.1k)', async () => {
	const { fullRunData } = await execute({
		nodes: [N('A'), N('Err', 'err', { onError: 'continueErrorOutput' }), N('C')],
		connections: connect(['A', 'Err'], ['Err', 'C']),
		nodeTypes: {
			test: nodeType({
				execute: async function () {
					return [[{ json: { from: this.node.name } }]];
				},
			}),
			err: nodeType({
				description: { name: 'err', outputs: ['main', 'main'], inputs: [{ type: 'main' }] },
				execute: async () => {
					throw new Error('err out');
				},
			}),
		},
	});
	const errRun = fullRunData.data.resultData.runData.Err[0];
	assert.equal(errRun.executionStatus, 'error');
	assert.equal(fullRunData.status, 'success');
	assert.ok(fullRunData.data.resultData.runData.C, 'C should have executed');
});

test('15. retryOnFail: retries then succeeds (spec §4.1j)', async () => {
	let calls = 0;
	const { fullRunData } = await execute({
		nodes: [N('A'), N('Flaky', 'flaky', { retryOnFail: true, maxTries: 3, waitBetweenTries: 0 })],
		connections: connect(['A', 'Flaky']),
		nodeTypes: {
			test: pass(),
			flaky: nodeType({
				execute: async () => {
					calls++;
					if (calls < 3) throw new Error(`attempt ${calls} failed`);
					return [[{ json: { attempts: calls } }]];
				},
			}),
		},
	});
	assert.equal(calls, 3);
	assert.equal(fullRunData.status, 'success');
	assert.equal(fullRunData.data.resultData.runData.Flaky.length, 1);
	assert.equal(fullRunData.data.resultData.runData.Flaky[0].executionStatus, 'success');
});

test('16. endless-loop guard fires on repeated same-run deferral (spec invariant 2, WEX:1562-1568)', async () => {
	const workflow = createWorkflow({
		nodes: [N('A'), N('B')],
		connections: connect(['A', 'B']),
		nodeTypes: { test: pass() },
		id: 'wf-guard',
	});

	// B waits for input data that never arrives: first pop defers (push back),
	// second pop of the same node:runIndex trips the endless-loop guard.
	const runExecutionData = createRunExecutionData({
		executionData: {
			nodeExecutionStack: [{ node: N('B'), data: { main: [null] }, source: null }],
		},
	});

	const executor = new WorkflowExecute(
		{ hooks: createLifecycleHooks({}), currentNodeExecutionIndex: 0, executionId: 'guard' },
		'manual',
		runExecutionData,
	);
	const fullRunData = await executor.processRunExecutionData(workflow);
	assert.equal(
		fullRunData.data.resultData.error.message,
		'Stopped execution because it seems to be in an endless loops',
	);
});

test('17. destinationNode (exclusive): parents run, destination + leaves do not (spec invariant 9/10)', async () => {
	const { fullRunData, executedOrder } = await execute({
		nodes: [N('A'), N('B'), N('D'), N('Side')],
		connections: connect(['A', 'B'], ['B', 'D'], ['A', 'Side']),
		nodeTypes: { test: pass() },
		runOptions: { destinationNode: { nodeName: 'D', mode: 'exclusive' } },
	});
	assert.deepEqual(executedOrder, ['A', 'B']);
	assert.equal(fullRunData.data.resultData.runData.D, undefined);
	assert.equal(fullRunData.data.resultData.runData.Side, undefined);
});

test('18. destinationNode (inclusive): destination runs, downstream does not (spec invariant 9)', async () => {
	const { fullRunData, executedOrder } = await execute({
		nodes: [N('A'), N('B'), N('D'), N('After')],
		connections: connect(['A', 'B'], ['B', 'D'], ['D', 'After']),
		nodeTypes: { test: pass() },
		runOptions: { destinationNode: { nodeName: 'D', mode: 'inclusive' } },
	});
	assert.deepEqual(executedOrder, ['A', 'B', 'D']);
	assert.equal(fullRunData.data.resultData.runData.After, undefined);
	assert.equal(fullRunData.finished, true);
});

test('19. waitTill: status waiting, node re-queued at front (spec invariant 8)', async () => {
	const { fullRunData, executeData } = await execute({
		nodes: [N('A'), N('Waiter', 'waiter'), N('C')],
		connections: connect(['A', 'Waiter'], ['Waiter', 'C']),
		nodeTypes: {
			test: pass(),
			waiter: nodeType({
				execute: async function () {
					this.runExecutionData.waitTill = new Date('2030-01-01T00:00:00.000Z');
					return [[{ json: { waited: true } }]];
				},
			}),
		},
	});
	assert.equal(fullRunData.status, 'waiting');
	assert.equal(fullRunData.finished, undefined);
	assert.ok(fullRunData.waitTill);
	const stack = executeData.runExecutionData.executionData.nodeExecutionStack;
	assert.equal(stack.length, 1);
	assert.equal(stack[0].node.name, 'Waiter');
	assert.equal(fullRunData.data.resultData.runData.Waiter[0].executionStatus, 'waiting');
});

test('20. executeOnce truncates inputs to first item (spec invariant 13)', async () => {
	let seen = null;
	const { fullRunData } = await execute({
		nodes: [N('A', 'multi'), N('B', 'once', { executeOnce: true })],
		connections: connect(['A', 'B']),
		nodeTypes: {
			multi: nodeType({
				execute: async () => [[{ json: { n: 1 } }, { json: { n: 2 } }, { json: { n: 3 } }]],
			}),
			once: nodeType({
				execute: async function () {
					seen = this.getInputData();
					return [seen];
				},
			}),
		},
	});
	assert.equal(seen.length, 1);
	assert.equal(fullRunData.data.resultData.runData.B[0].data.main[0].length, 1);
});

test('21. pairedItem pre-assignment on inputs (spec invariant 11)', async () => {
	let seen = null;
	await execute({
		nodes: [N('A', 'multi'), N('B')],
		connections: connect(['A', 'B']),
		nodeTypes: {
			multi: nodeType({ execute: async () => [[{ json: { n: 1 } }, { json: { n: 2 } }]] }),
			test: nodeType({
				execute: async function () {
					seen = this.getInputData();
					return [seen];
				},
			}),
		},
	});
	// reference: `input: inputIndex || undefined` → input 0 becomes undefined
	assert.deepEqual(
		seen.map((i) => ({ item: i.pairedItem.item, input: i.pairedItem.input ?? null })),
		[{ item: 0, input: null }, { item: 1, input: null }],
	);
});

test('22. assignPairedItems: same item count maps index-to-index (spec invariant 11)', async () => {
	const { fullRunData } = await execute({
		nodes: [N('A', 'multi'), N('B', 'transform')],
		connections: connect(['A', 'B']),
		nodeTypes: {
			multi: nodeType({
				execute: async () => [[{ json: { n: 1 } }, { json: { n: 2 } }, { json: { n: 3 } }]],
			}),
			transform: nodeType({
				execute: async () => [[{ json: { out: 1 } }, { json: { out: 2 } }, { json: { out: 3 } }]],
			}),
		},
	});
	const bItems = fullRunData.data.resultData.runData.B[0].data.main[0];
	assert.deepEqual(
		bItems.map((i) => i.pairedItem),
		[{ item: 0 }, { item: 1 }, { item: 2 }],
	);
});

test('23. disabled node passes main[0] through (spec invariant 12)', async () => {
	const { fullRunData, executedOrder } = await execute({
		nodes: [N('A'), N('B', 'test', { disabled: true }), N('C', 'echo')],
		connections: connect(['A', 'B'], ['B', 'C']),
		nodeTypes: {
			test: nodeType({
				execute: async function () {
					return [[{ json: { from: this.node.name } }]];
				},
			}),
			echo: nodeType({ execute: async function () { return [this.getInputData()]; } }),
		},
	});
	assert.deepEqual(executedOrder, ['A', 'B', 'C']);
	assert.deepEqual(
		fullRunData.data.resultData.runData.B[0].data.main[0].map((i) => i.json.from),
		['A'],
	);
	assert.deepEqual(
		fullRunData.data.resultData.runData.C[0].data.main[0].map((i) => i.json.from),
		['A'],
	);
});

test('24. hooks fire in reference order (spec invariant 15)', async () => {
	const { hookCalls } = await execute({
		nodes: [N('A'), N('B')],
		connections: connect(['A', 'B']),
		nodeTypes: { test: pass() },
	});
	assert.deepEqual(hookCalls, [
		'workflowExecuteBefore',
		'nodeExecuteBefore:A',
		'nodeExecuteAfter:A',
		'nodeExecuteBefore:B',
		'nodeExecuteAfter:B',
		'workflowExecuteAfter',
	]);
});

test('25. unknown node type fails before execution (spec §4.0)', async () => {
	// reference throws WorkflowHasIssuesError synchronously out of run()
	// (checkForWorkflowIssues runs before the PCancelable is created, WEX:1405)
	await assert.rejects(
		execute({
			nodes: [N('A', 'nonexistent-type')],
			connections: {},
			nodeTypes: { test: pass() },
		}),
		/Workflow has issues/,
	);
});

test('26. engine request: sub-node scheduled, requester resumes with nodeWasResumed (spec §4.1k)', async () => {
	let agentCalls = 0;
	const { fullRunData, executedOrder, hookCalls } = await execute({
		nodes: [N('Start'), N('Agent', 'agent'), N('Tool', 'tool'), N('End')],
		connections: connect(['Start', 'Agent'], ['Agent', 'End']),
		nodeTypes: {
			test: nodeType({
				execute: async function () {
					return [[{ json: { from: this.node.name } }]];
				},
			}),
			agent: nodeType({
				execute: async function () {
					agentCalls++;
					if (agentCalls === 1) {
						// engine request: run the tool sub-node, then resume me
						return { actions: [{ nodeName: 'Tool', type: 'ai_tool', actionType: 'call' }] };
					}
					return [[{ json: { from: 'Agent', resumed: true } }]];
				},
			}),
			tool: nodeType({
				execute: async function () {
					return [[{ json: { from: 'Tool' } }]];
				},
			}),
		},
		settings: { executionOrder: 'v1' },
	});
	assert.equal(agentCalls, 2);
	// the first Agent pass issues the request and records NO run data (WEX:1705-1719)
	assert.deepEqual(executedOrder, ['Start', 'Tool', 'Agent', 'End']);
	// nodeExecuteBefore skipped for the resumed Agent run (AI-1414)
	assert.equal(hookCalls.filter((c) => c === 'nodeExecuteBefore:Agent').length, 1);
	const agentRuns = fullRunData.data.resultData.runData.Agent;
	assert.equal(agentRuns.length, 1);
	assert.equal(agentRuns[0].metadata?.nodeWasResumed, true);
});

test('27. cancellation: cancel() stops the loop and reports canceled (spec §4.1a)', async () => {
	const workflow = createWorkflow({
		nodes: [N('A', 'slow'), N('B')],
		connections: connect(['A', 'B']),
		nodeTypes: {
			slow: nodeType({
				execute: async function () {
					await new Promise((r) => setTimeout(r, 100));
					return [[{ json: {} }]];
				},
			}),
			test: pass(),
		},
		id: 'wf-cancel',
	});

	const executor = new WorkflowExecute(
		{ hooks: createLifecycleHooks({}), currentNodeExecutionIndex: 0, executionId: 'cancel' },
		'manual',
	);
	const promise = executor.run({ workflow, startNode: workflow.nodes.A });
	setTimeout(() => promise.cancel(), 10);
	const fullRunData = await promise;

	assert.equal(executor.status, 'canceled');
	assert.equal(fullRunData.status, 'canceled');
});

test('28. v0 legacy force-execution: unexecuted sibling ancestor pulled in for second input (spec §6)', async () => {
	let seenInputs = null;
	const { executedOrder } = await execute({
		nodes: [N('A'), N('Empty', 'empty'), N('Merge', 'merge')],
		connections: connect(['A', 'Merge'], ['Empty', 'Merge', 0, 1]),
		nodeTypes: {
			test: nodeType({
				execute: async function () {
					return [[{ json: { from: this.node.name } }]];
				},
			}),
			empty: nodeType({ execute: async () => [[]] }),
			merge: nodeType({
				description: { name: 'merge', outputs: ['main'], inputs: [{ type: 'main' }, { type: 'main' }] },
				execute: async function () {
					seenInputs = this.inputData.main;
					return [this.inputData.main[0]];
				},
			}),
		},
		settings: { executionOrder: 'v0' },
	});
	// v0 pull-in forces Empty to execute even though nothing routed to it
	assert.deepEqual(executedOrder, ['A', 'Empty', 'Merge']);
	assert.equal(seenInputs.length, 2);
	assert.deepEqual(seenInputs[0].map((i) => i.json.from), ['A']);
	assert.deepEqual(seenInputs[1], []);
});

test('29. runData recording shape: executionIndex monotonic, timings, status (spec §4.1 l/n)', async () => {
	const { fullRunData } = await execute({
		nodes: [N('A'), N('B'), N('C')],
		connections: connect(['A', 'B'], ['B', 'C']),
		nodeTypes: { test: pass() },
	});
	const runData = fullRunData.data.resultData.runData;
	const indexes = ['A', 'B', 'C'].map((n) => runData[n][0].executionIndex);
	assert.deepEqual(indexes, [0, 1, 2]);
	for (const n of ['A', 'B', 'C']) {
		assert.equal(typeof runData[n][0].executionTime, 'number');
		assert.equal(runData[n][0].executionStatus, 'success');
		assert.ok(Array.isArray(runData[n][0].source));
	}
});

test('30. source provenance recorded on routed executions (spec §5)', async () => {
	const { fullRunData } = await execute({
		nodes: [N('A'), N('B'), N('C')],
		connections: connect(['A', 'B'], ['B', 'C']),
		nodeTypes: { test: pass() },
	});
	const cSource = fullRunData.data.resultData.runData.C[0].source[0];
	assert.equal(cSource.previousNode, 'B');
	assert.equal(cSource.previousNodeOutput, 0);
	assert.equal(cSource.previousNodeRun, 0);
});
