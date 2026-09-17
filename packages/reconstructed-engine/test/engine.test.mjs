/**
 * Regression suite — reconstructed Workflow Execution Engine (packages/reconstructed-engine).
 *
 * PROJECT_RULES.md rule 1 (ZERO RUST) makes this package the JavaScript reconstruction of the
 * n8n 2.9.4 execution semantics, so the assertions below are written against the reference
 * source, not against the old BFS behaviour. Each conformance case names the reference line
 * it comes from (`reference/n8n/packages/core/src/execution-engine/workflow-execute.ts`).
 *
 * run: npm run engine:test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WorkflowExecutionEngine, mapConnectionsByDestination } from '../runner.mjs';

const item = (json) => ({ json });
const conn = (node, index = 0) => ({ node, type: 'main', index });
/** Output items carry `pairedItem` like n8n does (:1736), so compare the payload by default. */
const payload = (items) => (items ?? []).map((i) => i.json);
const taskOf = (result, name, runIndex = 0) => result.resultData.runData[name]?.[runIndex];

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

test('linear chain: every node runs once, in order, items flow through', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine(linear());
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ start: true })]);
	engine.registerNodeType('n8n-nodes-base.code', async (_n, items) =>
		items.map((i) => item({ ...i.json, coded: true })),
	);
	engine.registerNodeType('n8n-nodes-base.set', async (_n, items) =>
		items.map((i) => item({ final: 'PASS', processedItems: items.length, data: i.json })),
	);

	const result = await engine.runWorkflow();

	assert.equal(result.status, 'success');
	assert.equal(result.finished, true);
	assert.equal(result.cyclic, false);
	assert.equal(result.resultData.error, undefined);
	assert.equal(result.resultData.lastNodeExecuted, 'Transform Output');
	assert.deepEqual(
		result.executionLog.map((e) => e.node),
		['Manual Trigger', 'Code Node', 'Transform Output'],
	);
	assert.deepEqual(payload(result.data['Transform Output']), [
		{ final: 'PASS', processedItems: 1, data: { start: true, coded: true } },
	]);
});

test('runData entry has the ITaskData shape (interfaces.ts:2675-2691)', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine(linear());
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ a: 1 }), item({ a: 2 })]);

	const result = await engine.runWorkflow();
	const task = taskOf(result, 'Manual Trigger');

	assert.deepEqual(Object.keys(task).sort(), [
		'data',
		'executionIndex',
		'executionStatus',
		'executionTime',
		'hints',
		'source',
		'startTime',
	]);
	assert.equal(task.executionStatus, 'success');
	assert.equal(task.executionIndex, 0);
	assert.deepEqual(task.source, [null], 'start node has no source (:170)');
	assert.deepEqual(payload(task.data.main[0]), [{ a: 1 }, { a: 2 }]);
	// one input item -> every output item pairs to it (:2589-2617)
	assert.deepEqual(task.data.main[0].map((i) => i.pairedItem), [{ item: 0 }, { item: 0 }]);
	assert.equal(typeof task.executionTime, 'number');

	// The downstream node records where its input came from (ISourceData, interfaces.ts:2693).
	assert.deepEqual(taskOf(result, 'Code Node').source, [
		{ node: 'Manual Trigger', type: 'main', index: 0 },
	]);
});

test('executionLog entry keeps the flat compatibility shape', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine(linear());
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ a: 1 }), item({ a: 2 })]);

	const first = (await engine.runWorkflow()).executionLog[0];

	assert.deepEqual(Object.keys(first).sort(), [
		'durationMs',
		'inputCount',
		'node',
		'outputCount',
		'status',
		'type',
	]);
	assert.equal(first.inputCount, 1); // default initialData = [{}] → one item (:157-168)
	assert.equal(first.outputCount, 2);
	assert.equal(first.status, 'success');
});

test('unregistered node type = passthrough (items unchanged)', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine(linear());
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ keep: 'me' })]);

	const result = await engine.runWorkflow();

	assert.deepEqual(payload(result.data['Code Node']), [{ keep: 'me' }]);
	assert.deepEqual(payload(result.data['Transform Output']), [{ keep: 'me' }]);
});

test('fan-out: one output reaches two downstream nodes', { timeout: 5000 }, async () => {
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

	assert.deepEqual(payload(result.data.B), [{ v: 1 }]);
	assert.deepEqual(payload(result.data.C), [{ v: 1 }]);
});

test('CONFORMANCE fan-in: a 2-input node runs ONCE with both inputs (:405-560)', { timeout: 5000 }, async () => {
	// This is the divergence that was locked as debt in TASK-308: the old BFS ran the merge
	// node once per arriving edge. n8n keeps it in waitingExecution until every input slot has
	// data and then enqueues it a single time with all inputs (:424-548).
	const engine = new WorkflowExecutionEngine({
		nodes: [
			{ name: 'A', type: 'n8n-nodes-base.manualTrigger' },
			{ name: 'B', type: 'n8n-nodes-base.set' },
			{ name: 'C', type: 'n8n-nodes-base.set' },
			{ name: 'Merge', type: 'n8n-nodes-base.merge' },
		],
		connections: {
			A: { main: [[conn('B'), conn('C')]] },
			B: { main: [[conn('Merge', 0)]] },
			C: { main: [[conn('Merge', 1)]] },
		},
	});
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ v: 1 })]);
	engine.registerNodeType('n8n-nodes-base.set', async (_n, items, ctx) => [
		item({ from: ctx.inputData[0][0].json.v, tag: 'x' }),
	]);
	let seenInputs;
	engine.registerNodeType('n8n-nodes-base.merge', async (_n, _items, ctx) => {
		seenInputs = ctx.inputData;
		return [item({ merged: ctx.inputData.length })];
	});

	const result = await engine.runWorkflow();

	assert.equal(result.cyclic, false, 'a diamond is not a cycle');
	assert.equal(result.executionLog.filter((e) => e.node === 'Merge').length, 1);
	assert.equal(seenInputs.length, 2, 'the merge node sees both input slots');
	assert.equal(seenInputs[0].length, 1);
	assert.equal(seenInputs[1].length, 1);
	assert.deepEqual(taskOf(result, 'Merge').source, [
		{ node: 'B', type: 'main', index: 0 },
		{ node: 'C', type: 'main', index: 0 },
	]);
});

test('CONFORMANCE fan-in: missing branch is filled with [] once the stack drains (:2079-2130)', { timeout: 5000 }, async () => {
	// IF-style graph: only one branch produces data, so the merge node would wait forever
	// without the release pass. n8n runs it anyway with [] for the inputs that never arrived.
	const engine = new WorkflowExecutionEngine({
		nodes: [
			{ name: 'If', type: 'n8n-nodes-base.if' },
			{ name: 'True', type: 'n8n-nodes-base.set' },
			{ name: 'False', type: 'n8n-nodes-base.set' },
			{ name: 'Merge', type: 'n8n-nodes-base.merge' },
		],
		connections: {
			If: { main: [[conn('True')], [conn('False')]] },
			True: { main: [[conn('Merge', 0)]] },
			False: { main: [[conn('Merge', 1)]] },
		},
	});
	engine.registerNodeType('n8n-nodes-base.if', async () => [item({ ok: true })]); // output 0 only
	engine.registerNodeType('n8n-nodes-base.set', async (_n, items) => items);
	engine.registerNodeType('n8n-nodes-base.merge', async (_n, _items, ctx) => [
		item({ input0: ctx.inputData[0].length, input1: ctx.inputData[1].length }),
	]);

	const result = await engine.runWorkflow('If', [{ ok: true }]);

	assert.equal(result.status, 'success');
	assert.equal(result.resultData.runData.False, undefined, 'the untaken branch never runs (:2013-2019)');
	assert.equal(result.executionLog.filter((e) => e.node === 'Merge').length, 1);
	assert.deepEqual(payload(result.data.Merge), [{ input0: 1, input1: 0 }]);
});

test('CONFORMANCE error: node error is recorded and the run stops with status error (:1823-1900, :2389)', { timeout: 5000 }, async () => {
	// Was locked as debt in TASK-308: the old engine rejected the whole promise and produced
	// no result at all. n8n records taskData.error / executionStatus 'error', puts the node
	// back on the stack so it can be restarted, breaks the loop, and finishes with 'error'.
	const engine = new WorkflowExecutionEngine({
		nodes: [
			{ name: 'T', type: 'n8n-nodes-base.manualTrigger' },
			{ name: 'Boom', type: 'n8n-nodes-base.code' },
			{ name: 'After', type: 'n8n-nodes-base.set' },
		],
		connections: {
			T: { main: [[conn('Boom')]] },
			Boom: { main: [[conn('After')]] },
		},
	});
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ v: 1 })]);
	engine.registerNodeType('n8n-nodes-base.code', async () => {
		throw new Error('node exploded');
	});

	const result = await engine.runWorkflow();

	assert.equal(result.status, 'error');
	assert.equal(result.finished, false);
	assert.equal(result.resultData.error.message, 'node exploded');
	assert.equal(result.resultData.lastNodeExecuted, 'Boom');
	const task = taskOf(result, 'Boom');
	assert.equal(task.executionStatus, 'error');
	assert.equal(task.error.message, 'node exploded');
	assert.equal(task.data, undefined, 'a failed node records no output data');
	assert.equal(result.resultData.runData.After, undefined, 'downstream nodes do not run');
});

test('CONFORMANCE continueOnFail: input passes through and the run continues (:1842-1860)', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine({
		nodes: [
			{ name: 'T', type: 'n8n-nodes-base.manualTrigger' },
			{ name: 'Flaky', type: 'n8n-nodes-base.httpRequest', continueOnFail: true },
			{ name: 'After', type: 'n8n-nodes-base.set' },
		],
		connections: {
			T: { main: [[conn('Flaky')]] },
			Flaky: { main: [[conn('After')]] },
		},
	});
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ v: 42 })]);
	engine.registerNodeType('n8n-nodes-base.httpRequest', async () => {
		throw new Error('503');
	});

	const result = await engine.runWorkflow();

	assert.equal(result.status, 'success', 'continueOnFail keeps the run alive');
	assert.equal(taskOf(result, 'Flaky').executionStatus, 'error', 'the error is still recorded');
	assert.equal(taskOf(result, 'Flaky').error.message, '503');
	assert.deepEqual(payload(result.data.After), [{ v: 42 }], 'the INPUT of the failed node is passed on');
});

test('CONFORMANCE onError=continueRegularOutput behaves like continueOnFail (:1843-1846)', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine({
		nodes: [
			{ name: 'Flaky', type: 'n8n-nodes-base.httpRequest', onError: 'continueRegularOutput' },
			{ name: 'After', type: 'n8n-nodes-base.set' },
		],
		connections: { Flaky: { main: [[conn('After')]] } },
	});
	engine.registerNodeType('n8n-nodes-base.httpRequest', async () => {
		throw new Error('boom');
	});

	const result = await engine.runWorkflow('Flaky', [{ v: 7 }]);

	assert.equal(result.status, 'success');
	assert.equal(taskOf(result, 'Flaky').executionStatus, 'error');
	assert.deepEqual(payload(result.data.After), [{ v: 7 }]);
});

test('onError=stopAndError does NOT continue (:1861-1893)', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine({
		nodes: [{ name: 'Flaky', type: 'n8n-nodes-base.httpRequest', onError: 'stopAndError' }],
		connections: {},
	});
	engine.registerNodeType('n8n-nodes-base.httpRequest', async () => {
		throw new Error('boom');
	});

	const result = await engine.runWorkflow('Flaky', [{ v: 1 }]);

	assert.equal(result.status, 'error');
});

test('CYCLE GUARD: A->B->A terminates and is reported, it does not hang', { timeout: 5000 }, async () => {
	// n8n rejects cycles at validation time (Validation LEGO); this engine still needs the
	// local bound, because a synchronous BFS on a cyclic graph never yields to the event loop
	// (verified against the pre-fix runner: still alive at 12 s, killed by `timeout`).
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
	assert.deepEqual(result.cycleSkips.map((s) => s.node), ['A']);
	assert.equal(result.executionLog.filter((e) => e.node === 'A').length, 1);
	assert.equal(result.executionLog.filter((e) => e.node === 'B').length, 1);
});

test('CYCLE GUARD: self-loop and 3-node cycle terminate', { timeout: 5000 }, async () => {
	const selfLoop = new WorkflowExecutionEngine({
		nodes: [{ name: 'A', type: 'n8n-nodes-base.manualTrigger' }],
		connections: { A: { main: [[conn('A')]] } },
	});
	selfLoop.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ v: 1 })]);
	const a = await selfLoop.runWorkflow('A');
	assert.equal(a.cyclic, true);
	assert.equal(a.executionLog.length, 1);

	const triangle = new WorkflowExecutionEngine({
		nodes: [
			{ name: 'A', type: 'n8n-nodes-base.manualTrigger' },
			{ name: 'B', type: 'n8n-nodes-base.set' },
			{ name: 'C', type: 'n8n-nodes-base.set' },
		],
		connections: { A: { main: [[conn('B')]] }, B: { main: [[conn('C')]] }, C: { main: [[conn('A')]] } },
	});
	triangle.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ v: 1 })]);
	const b = await triangle.runWorkflow('A');
	assert.equal(b.cyclic, true);
	assert.equal(b.executionLog.length, 3, 'each node still runs exactly once');
});

test('empty workflow throws "No nodes found"', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine({ nodes: [], connections: {} });
	await assert.rejects(() => engine.runWorkflow(), /No nodes found/);
});

test('explicit start node beats trigger auto-detection', { timeout: 5000 }, async () => {
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
	assert.deepEqual(payload(result.data.X), [{ seeded: true }]);
});

test('execution order: v1 (default) is LIFO, v0 is FIFO (:417)', { timeout: 5000 }, async () => {
	const wf = {
		nodes: [
			{ name: 'T', type: 'n8n-nodes-base.manualTrigger' },
			{ name: 'B', type: 'n8n-nodes-base.set' },
			{ name: 'C', type: 'n8n-nodes-base.set' },
		],
		connections: { T: { main: [[conn('B'), conn('C')]] } },
	};
	const collect = async (settings) => {
		const engine = new WorkflowExecutionEngine({ ...wf, settings });
		engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ v: 1 })]);
		return (await engine.runWorkflow()).executionLog.map((e) => e.node);
	};

	assert.deepEqual(await collect(undefined), ['T', 'C', 'B'], "v1 unshifts → last enqueued runs first");
	assert.deepEqual(await collect({ executionOrder: 'v0' }), ['T', 'B', 'C'], 'v0 pushes → FIFO');
});

test('CONFORMANCE: a connection to a missing destination node aborts the run (:2005-2012)', { timeout: 5000 }, async () => {
	// n8n does not ignore a dangling connection, it throws ApplicationError. Asserted because
	// the previous revision of this engine silently skipped it.
	const engine = new WorkflowExecutionEngine({
		nodes: [{ name: 'T', type: 'n8n-nodes-base.manualTrigger' }],
		connections: { T: { main: [[conn('Ghost')]] } },
	});
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ v: 1 })]);

	await assert.rejects(() => engine.runWorkflow(), (error) => {
		assert.equal(error.name, 'ApplicationError');
		assert.equal(error.message, 'Destination node not found');
		assert.deepEqual(error.extra, { sourceNodeName: 'T', destinationNodeName: 'Ghost' });
		return true;
	});
});

test('CONFORMANCE: an output that produced no items does not run its branch (:2013-2019)', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine({
		nodes: [
			{ name: 'T', type: 'n8n-nodes-base.manualTrigger' },
			{ name: 'Filter', type: 'n8n-nodes-base.filter' },
			{ name: 'After', type: 'n8n-nodes-base.set' },
		],
		connections: {
			T: { main: [[conn('Filter')]] },
			Filter: { main: [[conn('After')]] },
		},
	});
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ v: 1 })]);
	engine.registerNodeType('n8n-nodes-base.filter', async () => []); // drops everything

	const result = await engine.runWorkflow();

	assert.equal(result.status, 'success');
	assert.deepEqual(result.executionLog.map((e) => e.node), ['T', 'Filter']);
	assert.equal(result.resultData.runData.After, undefined, 'the empty branch never runs');
});

test('mapConnectionsByDestination pads input slots like the reference (map-connections-by-destination.ts:5-49)', () => {
	const byDestination = mapConnectionsByDestination({
		B: { main: [[conn('Merge', 1)]] }, // only input slot 1 is used
	});

	assert.equal(byDestination.Merge.main.length, 2, 'slot 0 exists and is empty');
	assert.deepEqual(byDestination.Merge.main[0], []);
	assert.deepEqual(byDestination.Merge.main[1], [{ node: 'B', type: 'main', index: 0 }]);
});

/* ------------------------------------------------------------------ *
 * releaseWaitingNodes — requiredInputs and the full ancestor rule
 * (workflow-execute.ts:2094-2160)
 * ------------------------------------------------------------------ */

/** IF-style graph: only output 0 fires, so `False` (and everything behind it) never runs. */
const partialGraph = () => ({
	nodes: [
		{ name: 'If', type: 'n8n-nodes-base.if' },
		{ name: 'True', type: 'n8n-nodes-base.set' },
		{ name: 'False', type: 'n8n-nodes-base.set' },
		{ name: 'Merge', type: 'n8n-nodes-base.merge' },
	],
	connections: {
		If: { main: [[conn('True')], [conn('False')]] },
		True: { main: [[conn('Merge', 0)]] },
		False: { main: [[conn('Merge', 1)]] },
	},
});

const runPartial = async (description, settings) => {
	const engine = new WorkflowExecutionEngine({ ...partialGraph(), settings });
	engine.registerNodeType('n8n-nodes-base.if', async () => [item({ ok: true })]);
	engine.registerNodeType('n8n-nodes-base.set', async (_n, items) => items);
	engine.registerNodeType('n8n-nodes-base.merge', async (_n, _i, ctx) => [item({ slots: ctx.inputData.length })], {
		inputs: ['main', 'main'],
		...description,
	});
	return engine.runWorkflow('If', [{ ok: true }]);
};

test('requiredInputs as a COUNT: 1 releases with partial data, 2 never does (:2107-2177)', { timeout: 5000 }, async () => {
	const one = await runPartial({ requiredInputs: 1 });
	assert.equal(one.resultData.runData.Merge?.length, 1, 'requiredInputs: 1 → released');
	assert.deepEqual(one.data.Merge, [item({ slots: 2 })]);

	const two = await runPartial({ requiredInputs: 2 });
	assert.equal(two.resultData.runData.Merge, undefined, 'requiredInputs === inputs.length → never released (:2119-2123)');
	assert.equal(two.status, 'success');
});

test('requiredInputs as INDEXES: only those slots must have data (:2160-2172)', { timeout: 5000 }, async () => {
	const zero = await runPartial({ requiredInputs: [0] });
	assert.equal(zero.resultData.runData.Merge?.length, 1, 'input 0 has data → released');

	const one = await runPartial({ requiredInputs: [1] });
	assert.equal(one.resultData.runData.Merge, undefined, 'input 1 never receives data → stays waiting');

	const both = await runPartial({ requiredInputs: [0, 1] });
	assert.equal(both.resultData.runData.Merge, undefined, 'all inputs required → never released');
});

test('requiredInputs is ignored for executionOrder v0 (:2107-2110)', { timeout: 5000 }, async () => {
	const v0 = await runPartial({ requiredInputs: 2 }, { executionOrder: 'v0' });
	assert.equal(v0.resultData.runData.Merge?.length, 1, 'v0 does not consult requiredInputs');
});

test('an EXPRESSION requiredInputs is treated as unspecified (needs the Expression LEGO)', { timeout: 5000 }, async () => {
	// Merge v3 in n8n 2.9.4 really uses this form:
	//   requiredInputs: '={{ $parameter["mode"] === "chooseBranch" ? [0, 1] : 1 }}'
	// Evaluating it is the Expression LEGO's job; documented gap, asserted so it cannot
	// silently change meaning.
	const result = await runPartial({ requiredInputs: '={{ 2 }}' });
	assert.equal(result.resultData.runData.Merge?.length, 1, 'string form falls back to "not specified"');
});

test('a node is NOT released while a distant ANCESTOR is still waiting (:2136-2142)', { timeout: 5000 }, async () => {
	// Discriminating case: Merge's DIRECT predecessors (Q, S) are not waiting, but its
	// ancestor P is. The old direct-predecessor check released Merge here; n8n does not.
	// P and Merge use different node types so their requiredInputs do not collide.
	const engine = new WorkflowExecutionEngine({
		nodes: [
			{ name: 'If', type: 'n8n-nodes-base.if' },
			{ name: 'True', type: 'n8n-nodes-base.set' },
			{ name: 'False', type: 'n8n-nodes-base.set' },
			{ name: 'P', type: 'n8n-nodes-base.mergeAll' }, // requires ALL inputs → waits forever
			{ name: 'S', type: 'n8n-nodes-base.set' },
			{ name: 'Q', type: 'n8n-nodes-base.set' },
			{ name: 'Merge', type: 'n8n-nodes-base.mergeAny' }, // one input is enough
		],
		connections: {
			If: { main: [[conn('True')], [conn('False')]] },
			True: { main: [[conn('P', 0), conn('Q')]] }, // one output feeds both P and Q
			False: { main: [[conn('P', 1)]] },
			P: { main: [[conn('S')]] },
			Q: { main: [[conn('Merge', 0)]] },
			S: { main: [[conn('Merge', 1)]] },
		},
	});
	engine.registerNodeType('n8n-nodes-base.if', async () => [item({ ok: true })]);
	engine.registerNodeType('n8n-nodes-base.set', async (_n, items) => items);
	engine.registerNodeType(
		'n8n-nodes-base.mergeAll',
		async (_n, _i, ctx) => [item({ slots: ctx.inputData.length })],
		{ inputs: ['main', 'main'], requiredInputs: 2 },
	);
	engine.registerNodeType(
		'n8n-nodes-base.mergeAny',
		async (_n, _i, ctx) => [item({ slots: ctx.inputData.length })],
		{ inputs: ['main', 'main'], requiredInputs: 1 },
	);

	const result = await engine.runWorkflow('If', [{ ok: true }]);

	assert.deepEqual(
		result.executionLog.map((e) => e.node),
		['If', 'True', 'Q'],
		'P never runs (needs both inputs) and Merge is held back because its ancestor P is still waiting',
	);
	assert.equal(result.resultData.runData.Merge, undefined);
	assert.equal(result.resultData.runData.P, undefined);
	assert.equal(result.status, 'success');
});

test('getParentNodes returns ALL ancestors, deepest-first, without looping on cycles', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine({
		nodes: ['If', 'True', 'Q', 'Merge'].map((name) => ({ name, type: 'n8n-nodes-base.set' })),
		connections: {
			If: { main: [[conn('True')]] },
			True: { main: [[conn('Q')]] },
			Q: { main: [[conn('Merge')]] },
			Merge: { main: [[conn('If')]] }, // cycle
		},
	});

	const parents = engine.getParentNodes('Merge');
	assert.deepEqual(parents, ['If', 'True', 'Q'], 'ancestors, not just the direct predecessor');
	assert.deepEqual(engine.getParentNodes('If'), ['True', 'Q', 'Merge'], 'cycle-safe: terminates');
	assert.deepEqual(engine.getParentNodes('NoSuchNode'), []);
});

/* ------------------------------------------------------------------ *
 * execution timeout (workflow-execute.ts:1486-1496, :2387-2389)
 * ------------------------------------------------------------------ */

test('TIMEOUT: a deadline that already passed cancels the run before any node runs', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine(linear());
	let called = 0;
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => {
		called += 1;
		return [item({ start: true })];
	});

	const result = await engine.runWorkflow(null, [{}], { executionTimeoutTimestamp: Date.now() - 1 });

	assert.equal(result.status, 'canceled');
	assert.equal(result.timedOut, true);
	assert.equal(result.finished, false);
	assert.equal(called, 0, 'the deadline is checked before the first node runs (:1486-1492)');
	assert.deepEqual(result.executionLog, []);
});

test('TIMEOUT: a node that outlives the deadline cancels the run after it, keeping its runData', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine(linear());
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => {
		await new Promise((resolve) => setTimeout(resolve, 30));
		return [item({ start: true })];
	});

	const result = await engine.runWorkflow(null, [{}], { executionTimeoutTimestamp: Date.now() + 10 });

	assert.equal(result.status, 'canceled');
	assert.equal(result.timedOut, true);
	assert.deepEqual(result.executionLog.map((e) => e.node), ['Manual Trigger'], 'the slow node still recorded');
	assert.equal(result.resultData.runData['Code Node'], undefined, 'the next node never starts');
});

test('no deadline set means no cancellation', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine(linear());
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ start: true })]);

	const result = await engine.runWorkflow();

	assert.equal(result.status, 'success');
	assert.equal(result.timedOut, false);
});

/* ------------------------------------------------------------------ *
 * pin data (workflow-execute.ts:1632-1637)
 * ------------------------------------------------------------------ */

test('PIN DATA: a pinned node is not executed and its pinned output flows downstream', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine({
		...linear(),
		pinData: { 'Code Node': [item({ pinned: true })] },
	});
	let triggerCalls = 0;
	let codeCalls = 0;
	let setCalls = 0;
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => {
		triggerCalls += 1;
		return [item({ start: true })];
	});
	engine.registerNodeType('n8n-nodes-base.code', async () => {
		codeCalls += 1;
		return [item({ computed: true })];
	});
	engine.registerNodeType('n8n-nodes-base.set', async (_n, items) => {
		setCalls += 1;
		return items;
	});

	const result = await engine.runWorkflow();

	assert.equal(triggerCalls, 1);
	assert.equal(codeCalls, 0, 'the pinned node handler is never called (:1634-1636)');
	assert.equal(setCalls, 1, 'downstream nodes still run');
	assert.deepEqual(payload(result.data['Code Node']), [{ pinned: true }]);
	assert.deepEqual(payload(result.data['Transform Output']), [{ pinned: true }]);
	assert.equal(taskOf(result, 'Code Node').executionStatus, 'success');
});

test('PIN DATA: a disabled node ignores its pin data (:1634)', { timeout: 5000 }, async () => {
	const wf = linear();
	wf.nodes[1].disabled = true;
	const engine = new WorkflowExecutionEngine({ ...wf, pinData: { 'Code Node': [item({ pinned: true })] } });
	let codeCalls = 0;
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ start: true })]);
	engine.registerNodeType('n8n-nodes-base.code', async () => {
		codeCalls += 1;
		return [item({ computed: true })];
	});

	const result = await engine.runWorkflow();

	assert.equal(codeCalls, 1, 'a disabled node falls through to the handler');
	assert.deepEqual(payload(result.data['Code Node']), [{ computed: true }]);
});

test('PIN DATA can also be passed per run, overriding the workflow definition', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine({ ...linear(), pinData: { 'Code Node': [item({ from: 'definition' })] } });
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ start: true })]);
	engine.registerNodeType('n8n-nodes-base.code', async () => [item({ computed: true })]);

	const result = await engine.runWorkflow(null, [{}], { pinData: { 'Code Node': [item({ from: 'options' })] } });

	assert.deepEqual(payload(result.data['Code Node']), [{ from: 'options' }]);
});

/* ------------------------------------------------------------------ *
 * alwaysOutputData (workflow-execute.ts:1746-1765)
 * ------------------------------------------------------------------ */

test('alwaysOutputData emits one empty paired item so the branch continues', { timeout: 5000 }, async () => {
	const wf = linear();
	wf.nodes[1].alwaysOutputData = true;
	const engine = new WorkflowExecutionEngine(wf);
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ a: 1 }), item({ a: 2 })]);
	engine.registerNodeType('n8n-nodes-base.code', async () => []); // drops everything

	const result = await engine.runWorkflow();

	assert.deepEqual(
		result.executionLog.map((e) => e.node),
		['Manual Trigger', 'Code Node', 'Transform Output'],
		'the branch does not end on empty output',
	);
	const out = result.data['Code Node'];
	assert.equal(out.length, 1);
	assert.deepEqual(out[0].json, {});
	assert.deepEqual(out[0].pairedItem, [
		{ item: 0, input: 0 },
		{ item: 1, input: 0 },
	]);
});

test('without alwaysOutputData the branch ends on empty output', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine(linear());
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ a: 1 })]);
	engine.registerNodeType('n8n-nodes-base.code', async () => []);

	const result = await engine.runWorkflow();

	assert.deepEqual(result.executionLog.map((e) => e.node), ['Manual Trigger', 'Code Node']);
	assert.equal(result.status, 'success');
});

test('lastNodeExecuted follows the last node that produced data, not the last one visited', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine(linear());
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ a: 1 })]);
	engine.registerNodeType('n8n-nodes-base.code', async () => []); // ends its branch, emits nothing

	const result = await engine.runWorkflow();

	assert.equal(result.resultData.lastNodeExecuted, 'Manual Trigger', 'workflow-execute.ts:1739');
});

/* ------------------------------------------------------------------ *
 * pairedItem auto-fix (workflow-execute.ts:2581-2641)
 * ------------------------------------------------------------------ */

const pairedRun = async (inputItems, outputItems, preset) => {
	const engine = new WorkflowExecutionEngine({
		nodes: [
			{ name: 'T', type: 'n8n-nodes-base.manualTrigger' },
			{ name: 'N', type: 'n8n-nodes-base.set' },
		],
		connections: { T: { main: [[conn('N')]] } },
	});
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => inputItems);
	engine.registerNodeType('n8n-nodes-base.set', async (_n, items) =>
		outputItems === 'passthrough' ? items : outputItems.map((json, i) => (preset ? preset(json, i) : { json })),
	);
	const result = await engine.runWorkflow();
	return result.data.N.map((i) => i.pairedItem);
};

test('pairedItem: one input item pairs every output item to {item:0} (:2589-2617)', { timeout: 5000 }, async () => {
	assert.deepEqual(await pairedRun([item({ a: 1 })], [{ x: 1 }, { x: 2 }]), [{ item: 0 }, { item: 0 }]);
});

test('pairedItem: equal input/output counts pair by index (:2619-2627)', { timeout: 5000 }, async () => {
	assert.deepEqual(await pairedRun([item({ a: 1 }), item({ a: 2 }), item({ a: 3 })], [{ x: 1 }, { x: 2 }, { x: 3 }]), [
		{ item: 0 },
		{ item: 1 },
		{ item: 2 },
	]);
});

test('pairedItem: many inputs aggregated into one output pair to {item:0} (:2629-2636)', { timeout: 5000 }, async () => {
	assert.deepEqual(await pairedRun([item({ a: 1 }), item({ a: 2 })], [{ x: 1 }]), [{ item: 0 }]);
});

test('pairedItem: an ambiguous mapping is left untouched (:2637-2640)', { timeout: 5000 }, async () => {
	// 2 inputs -> 3 outputs: not 1:1, not single-input, not a single output
	assert.deepEqual(await pairedRun([item({ a: 1 }), item({ a: 2 })], [{ x: 1 }, { x: 2 }, { x: 3 }]), [
		undefined,
		undefined,
		undefined,
	]);
});

test('pairedItem: a node that sets its own is never overwritten', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine({
		nodes: [{ name: 'N', type: 'n8n-nodes-base.set' }],
		connections: {},
	});
	engine.registerNodeType('n8n-nodes-base.set', async () => [
		{ json: { x: 1 }, pairedItem: { item: 7, input: 1 } },
	]);

	const result = await engine.runWorkflow('N', [{ a: 1 }]);

	assert.deepEqual(result.data.N[0].pairedItem, { item: 7, input: 1 });
});
