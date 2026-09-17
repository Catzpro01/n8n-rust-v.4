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
	// n8n workflows can contain intentional cycles (for example Loop nodes). Full loop/reset
	// semantics are not reconstructed yet, so this engine keeps a fail-safe bound: a malformed
	// cycle must not starve the event loop (the pre-fix runner was still alive after 12 seconds).
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

test('no executable start throws the reference ApplicationError', { timeout: 5000 }, async () => {
	for (const nodes of [
		[],
		[
			{ name: 'A', type: 'n8n-nodes-base.set' },
			{ name: 'B', type: 'n8n-nodes-base.noOp' },
		],
	]) {
		const engine = new WorkflowExecutionEngine({ nodes, connections: {} });
		await assert.rejects(() => engine.runWorkflow(), (error) => {
			assert.equal(error.name, 'ApplicationError');
			assert.equal(error.constructor.name, 'ApplicationError');
			assert.equal(error.message, 'No node to start the workflow from could be found');
			return true;
		});
	}
});

test('a single enabled ordinary node is a valid start; a disabled one is not (:822-827)', { timeout: 5000 }, async () => {
	const enabled = new WorkflowExecutionEngine({
		nodes: [{ name: 'Only', type: 'n8n-nodes-base.set' }],
		connections: {},
	});
	assert.equal(enabled.findStartNode(), 'Only');

	const disabled = new WorkflowExecutionEngine({
		nodes: [{ name: 'Only', type: 'n8n-nodes-base.set', disabled: true }],
		connections: {},
	});
	assert.equal(disabled.findStartNode(), undefined);
});

test('START NODE: exact fallback types beat array order and disabled starts are skipped (:817-860)', () => {
	const engine = new WorkflowExecutionEngine({
		nodes: [
			{ name: 'Ordinary first', type: 'n8n-nodes-base.set' },
			{ name: 'Disabled manual', type: 'n8n-nodes-base.manualTrigger', disabled: true },
			{ name: 'Form', type: 'n8n-nodes-base.formTrigger' },
			{ name: 'Error', type: 'n8n-nodes-base.errorTrigger' },
		],
		connections: {},
	});

	assert.equal(engine.findStartNode(), 'Error', 'fallback order follows constants.ts:53-59, not node order');
});

test('START NODE: registered trigger/poll flags win and disabled/manual-chat triggers are skipped', () => {
	const engine = new WorkflowExecutionEngine({
		nodes: [
			{ name: 'Disabled trigger', type: 'custom.disabled', disabled: true },
			{ name: 'Manual chat', type: '@n8n/n8n-nodes-langchain.manualChatTrigger' },
			{ name: 'Poll', type: 'custom.poll' },
			{ name: 'Manual', type: 'n8n-nodes-base.manualTrigger' },
		],
		connections: {},
	});
	const handler = async (_node, items) => items;
	engine.registerNodeType('custom.disabled', handler, { trigger: handler });
	engine.registerNodeType('@n8n/n8n-nodes-langchain.manualChatTrigger', handler, {
		name: '@n8n/n8n-nodes-langchain.manualChatTrigger',
		trigger: handler,
	});
	engine.registerNodeType('custom.poll', handler, { poll: handler });

	assert.equal(engine.findStartNode(), 'Poll');
});

test('explicit start node beats automatic start-node selection', { timeout: 5000 }, async () => {
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

/**
 * A disabled node is not executed at all: `runNode` returns before anything else
 * (`workflow-execute.ts:1199-1201`) and `handleDisabledNode` (`:909-920`) passes the first main
 * input through. Verified against the real engine — a disabled `Limit` with `maxItems: 0` (which
 * would emit nothing) and a pin of `{ pinned: true }` still outputs its input.
 */
test('PIN DATA: a disabled node is not executed — its first main input passes through and its pin is ignored (:909-920)', { timeout: 5000 }, async () => {
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

	assert.equal(codeCalls, 0, 'handleDisabledNode returns before the node implementation (:1199-1201)');
	assert.deepEqual(payload(result.data['Code Node']), [{ start: true }], 'the first main input is passed through');
	assert.deepEqual(payload(result.data['Transform Output']), [{ start: true }], 'and it flows downstream');
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

/**
 * `workflow-execute.ts:1738-1741` is `if (nodeSuccessData) lastNodeExecuted = node` — ANY non-null
 * output counts, including an output with ZERO items. Verified against the real engine (n8n-core
 * 2.9.1): Trigger → Limit(maxItems 0) → NoOp gives `runData.Lim[0].data.main === [[]]`,
 * `lastNodeExecuted === 'Lim'`, and NoOp never runs.
 */
test('lastNodeExecuted is the last node that returned output, even when it emitted zero items', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine(linear());
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ a: 1 })]);
	engine.registerNodeType('n8n-nodes-base.code', async () => []); // ends its branch, emits nothing

	const result = await engine.runWorkflow();

	assert.deepEqual(result.resultData.runData['Code Node'][0].data.main, [[]]);
	assert.equal(result.resultData.lastNodeExecuted, 'Code Node', 'workflow-execute.ts:1738-1741');
	assert.equal(
		result.resultData.runData['Transform Output'],
		undefined,
		'an empty output still ends the branch',
	);
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

/* ------------------------------------------------------------------ *
 * retryOnFail (workflow-execute.ts:1600-1630, :1670-1692)
 * ------------------------------------------------------------------ */

const retryFixture = (nodeExtra = {}) => ({
	nodes: [
		{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
		{ name: 'Flaky', type: 'n8n-nodes-base.flaky', parameters: {}, ...nodeExtra },
	],
	connections: { 'Manual Trigger': { main: [[conn('Flaky')]] } },
});

/** `flaky` counts its calls and throws for the first `failTimes` of them. */
const flakyEngine = (nodeExtra, { failTimes = Infinity, failSoft = false } = {}) => {
	const engine = new WorkflowExecutionEngine(retryFixture(nodeExtra));
	let calls = 0;
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ v: 1 })]);
	engine.registerNodeType('n8n-nodes-base.flaky', async () => {
		calls += 1;
		if (calls <= failTimes) {
			if (failSoft) return [item({ error: `soft ${calls}` })];
			throw new Error(`boom ${calls}`);
		}
		return [item({ ok: true, attempt: calls })];
	});
	return { engine, calls: () => calls };
};

test('CONFORMANCE retryOnFail: maxTries is clamped to [2, 5] with a default of 3 (:1600-1604)', { timeout: 20000 }, async () => {
	for (const [maxTries, expected] of [[1, 2], [2, 2], [3, 3], [undefined, 3], [10, 5]]) {
		const { engine, calls } = flakyEngine(
			{ retryOnFail: true, maxTries, waitBetweenTries: 1 },
			{ failTimes: Infinity },
		);
		const result = await engine.runWorkflow();
		assert.equal(calls(), expected, `maxTries=${maxTries} -> ${expected} attempts`);
		assert.equal(result.status, 'error');
		assert.equal(result.resultData.error.message, `boom ${expected}`);
	}
});

test('CONFORMANCE retryOnFail: a retry that finally succeeds is a success (:1615-1630)', { timeout: 10000 }, async () => {
	const { engine, calls } = flakyEngine(
		{ retryOnFail: true, maxTries: 3, waitBetweenTries: 1 },
		{ failTimes: 2 },
	);
	const result = await engine.runWorkflow();

	assert.equal(calls(), 3);
	assert.equal(result.status, 'success');
	assert.equal(result.resultData.error, undefined);
	assert.deepEqual(payload(taskOf(result, 'Flaky').data.main[0]), [{ ok: true, attempt: 3 }]);
	assert.equal(taskOf(result, 'Flaky').error, undefined, 'the earlier attempts leave no error behind');
});

test('CONFORMANCE retryOnFail defaults to a single attempt when not set (:1601)', { timeout: 5000 }, async () => {
	const { engine, calls } = flakyEngine({}, { failTimes: Infinity });
	const result = await engine.runWorkflow();

	assert.equal(calls(), 1);
	assert.equal(result.status, 'error');
});

test('CONFORMANCE retryOnFail: waitBetweenTries 0 means 1000 ms, not "no wait" (:1607-1613)', { timeout: 10000 }, async () => {
	const { engine } = flakyEngine({ retryOnFail: true, maxTries: 2, waitBetweenTries: 0 }, { failTimes: Infinity });
	const started = Date.now();
	await engine.runWorkflow();
	const elapsed = Date.now() - started;

	// `Math.min(5000, Math.max(0, node.waitBetweenTries || 1000))` — `0 || 1000` is 1000.
	assert.ok(elapsed >= 900, `expected at least one 1000 ms wait, got ${elapsed} ms`);
});

test('CONFORMANCE retryOnFail: a soft failure (json.error) is retried, then counted as success (:1670-1692)', { timeout: 10000 }, async () => {
	const { engine, calls } = flakyEngine(
		{ retryOnFail: true, maxTries: 3, waitBetweenTries: 1 },
		{ failTimes: Infinity, failSoft: true },
	);
	const result = await engine.runWorkflow();

	assert.equal(calls(), 3, 'the soft-failure loop spends the same try budget');
	assert.equal(result.status, 'success', 'a soft failure is not an executionError');
	assert.equal(result.resultData.error, undefined);
	assert.deepEqual(payload(taskOf(result, 'Flaky').data.main[0]), [{ error: 'soft 3' }]);
});

/* ------------------------------------------------------------------ *
 * onError: continueErrorOutput (workflow-execute.ts:1720, :2463-2562)
 * ------------------------------------------------------------------ */

const splitFixture = () => ({
	nodes: [
		{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
		{ name: 'Split', type: 'n8n-nodes-base.split', parameters: {}, onError: 'continueErrorOutput' },
		{ name: 'Ok', type: 'n8n-nodes-base.noOp', parameters: {} },
		{ name: 'Err', type: 'n8n-nodes-base.noOp', parameters: {} },
	],
	connections: {
		'Manual Trigger': { main: [[conn('Split')]] },
		Split: { main: [[conn('Ok')], [conn('Err')]] },
	},
});

const splitEngine = (outputItems, inputItems = [item({ v: 1 })]) => {
	const engine = new WorkflowExecutionEngine(splitFixture());
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => inputItems);
	engine.registerNodeType(
		'n8n-nodes-base.split',
		async () => outputItems,
		{ inputs: ['main'], outputs: ['main'] }, // one declared output + the appended error output
	);
	engine.registerNodeType('n8n-nodes-base.noOp', async (_n, items) => items);
	return engine;
};

test('CONFORMANCE continueErrorOutput: failed items move to the LAST main output (:2463-2562)', { timeout: 5000 }, async () => {
	// The node stamps pairedItem itself, like n8n's Set node does: handleNodeErrorOutput runs at
	// :1721, BEFORE assignPairedItems (:1736), so only node-provided pairedItem can be used here.
	const engine = splitEngine([
		{ json: { error: 'boom' }, pairedItem: { item: 0 } },
		{ json: { ok: 1 }, pairedItem: { item: 0 } },
	]);
	const result = await engine.runWorkflow();

	const task = taskOf(result, 'Split');
	assert.deepEqual(payload(task.data.main[0]), [{ ok: 1 }], 'clean items stay on output 0');
	assert.deepEqual(payload(task.data.main[1]), [{ v: 1, error: 'boom' }], 'error items land on output 1');
	assert.deepEqual(payload(taskOf(result, 'Ok').data.main[0]), [{ ok: 1 }]);
	assert.deepEqual(payload(taskOf(result, 'Err').data.main[0]), [{ v: 1, error: 'boom' }]);
	assert.equal(result.status, 'success');
});

test('CONFORMANCE continueErrorOutput: the three error-detection rules and nothing more (:2515-2523)', { timeout: 5000 }, async () => {
	const engine = splitEngine([
		{ json: { error: 'a' }, error: { message: 'item.error wins' } }, // rule 1
		item({ error: 'b' }), // rule 2: `error` is the only key
		item({ error: 'c', message: 'with a message' }), // rule 3: error + message only
		item({ error: 'd', other: 1 }), // NOT an error: two keys but not error+message
		item({ ok: 1 }), // NOT an error
	]);
	const result = await engine.runWorkflow();
	const task = taskOf(result, 'Split');

	assert.deepEqual(payload(task.data.main[0]), [{ error: 'd', other: 1 }, { ok: 1 }]);
	assert.equal(task.data.main[1].length, 3);
});

test('CONFORMANCE continueErrorOutput: a routed item inherits its source item json (:2534-2556)', { timeout: 5000 }, async () => {
	const engine = splitEngine(
		[{ json: { error: 'boom' }, pairedItem: { item: 0 } }],
		[item({ keep: 'me', n: 7 })],
	);
	const result = await engine.runWorkflow();

	assert.deepEqual(payload(taskOf(result, 'Split').data.main[1]), [{ keep: 'me', n: 7, error: 'boom' }]);
});

test('CONFORMANCE continueErrorOutput: an error item without pairedItem is routed unchanged (:2525-2533)', { timeout: 5000 }, async () => {
	const engine = splitEngine([item({ error: 'boom' })], [item({ keep: 'me' })]);
	const result = await engine.runWorkflow();

	assert.deepEqual(payload(taskOf(result, 'Split').data.main[1]), [{ error: 'boom' }]);
});

test('CONFORMANCE continueErrorOutput: without a declared output there is no error output to route to (node-helpers.ts:1140-1196)', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine(splitFixture());
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ v: 1 })]);
	// no description registered -> `if (!nodeTypeData) return []`
	engine.registerNodeType('n8n-nodes-base.split', async () => [item({ error: 'boom' }), item({ ok: 1 })]);
	engine.registerNodeType('n8n-nodes-base.noOp', async (_n, items) => items);

	const node = engine.nodes.get('Split');
	assert.equal(engine.mainOutputCount(node), 0, 'the reference counts 0 main outputs here');

	const result = await engine.runWorkflow();
	assert.deepEqual(payload(taskOf(result, 'Split').data.main[0]), [{ error: 'boom' }, { ok: 1 }]);
});

test('CONFORMANCE a THROWN error with continueErrorOutput passes the INPUT to output 0 (:1854-1860)', { timeout: 5000 }, async () => {
	// Output 0 carries no connection here (only the error output does), exactly like the
	// real-engine probe: the passed-through input reaches nothing, so `executionError` is still
	// set when the run ends and the status is 'error'.
	const engine = new WorkflowExecutionEngine({
		nodes: splitFixture().nodes,
		connections: {
			'Manual Trigger': { main: [[conn('Split')]] },
			Split: { main: [[], [conn('Err')]] },
		},
	});
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ v: 1 })]);
	engine.registerNodeType(
		'n8n-nodes-base.split',
		async () => {
			throw new Error('kaboom');
		},
		{ inputs: ['main'], outputs: ['main'] },
	);
	engine.registerNodeType('n8n-nodes-base.noOp', async (_n, items) => items);

	const result = await engine.runWorkflow();

	assert.equal(result.status, 'error', 'executionError is still set at the end of the run');
	assert.equal(result.resultData.error.message, 'kaboom');
	assert.deepEqual(payload(taskOf(result, 'Split').data.main[0]), [{ v: 1 }], 'the input is passed through');
	assert.equal(result.resultData.runData.Err, undefined, 'output 1 is empty, so the error branch never runs');
});

/* ------------------------------------------------------------------ *
 * inline item errors (workflow-execute.ts:1898-1917)
 * ------------------------------------------------------------------ */

const inlineErrorEngine = (outputItems) => {
	const engine = new WorkflowExecutionEngine(retryFixture());
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ v: 1 })]);
	engine.registerNodeType('n8n-nodes-base.flaky', async () => outputItems);
	return engine;
};

test('CONFORMANCE inline $error/$json collapses into item.error (:1898-1910)', { timeout: 5000 }, async () => {
	const engine = inlineErrorEngine([{ json: { $error: { message: 'dollar-boom' }, $json: { a: 1 } } }]);
	const result = await engine.runWorkflow();

	const [out] = taskOf(result, 'Flaky').data.main[0];
	assert.equal(out.error.message, 'dollar-boom');
	assert.deepEqual(out.json, { error: 'dollar-boom' });
	assert.equal(result.status, 'success', 'an inline error is not an executionError');
});

test('CONFORMANCE an item already carrying .error gets json replaced by { error: message } (:1912-1915)', { timeout: 5000 }, async () => {
	const engine = inlineErrorEngine([{ json: { anything: 1 }, error: { message: 'carried' } }]);
	const result = await engine.runWorkflow();

	const [out] = taskOf(result, 'Flaky').data.main[0];
	assert.deepEqual(out.json, { error: 'carried' });
	assert.equal(out.error.message, 'carried');
});

/* ------------------------------------------------------------------ *
 * waitTill: pause and resume
 * (workflow-execute.ts:1821, :1948-1959, :1285-1302, :1400-1412)
 * ------------------------------------------------------------------ */

const waitFixture = () => ({
	nodes: [
		{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
		{ name: 'Wait', type: 'n8n-nodes-base.wait', parameters: {} },
		{ name: 'After', type: 'n8n-nodes-base.noOp', parameters: {} },
	],
	connections: {
		'Manual Trigger': { main: [[conn('Wait')]] },
		Wait: { main: [[conn('After')]] },
	},
});

/** The handler behaves like the real Wait node: park the execution, then hand the input on. */
const waitEngine = (when = new Date(Date.now() + 60_000)) => {
	const engine = new WorkflowExecutionEngine(waitFixture());
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ v: 1 })]);
	engine.registerNodeType('n8n-nodes-base.wait', async (_node, items, ctx) => {
		await ctx.putExecutionToWait(when);
		return items; // Wait.node.ts:621-624 — `return [context.getInputData()]`
	});
	engine.registerNodeType('n8n-nodes-base.noOp', async (_n, items) => items);
	return engine;
};

test('CONFORMANCE waitTill: a node that parks the run stops it with status waiting (:1821, :1948-1959, :2391-2396)', { timeout: 5000 }, async () => {
	const when = new Date(Date.now() + 60_000);
	const result = await waitEngine(when).runWorkflow();

	assert.equal(result.status, 'waiting');
	assert.equal(result.paused, true);
	assert.equal(result.finished, false);
	assert.equal(result.waitTill, when, ':2435-2436 — the run carries waitTill');
	assert.equal(taskOf(result, 'Wait').executionStatus, 'waiting', ':1821');
	assert.deepEqual(payload(taskOf(result, 'Wait').data.main[0]), [{ v: 1 }]);
	assert.equal(result.resultData.runData.After, undefined, 'nothing downstream runs while parked');
	assert.equal(result.resultData.lastNodeExecuted, 'Wait');
	assert.deepEqual(
		result.runExecutionData.executionData.nodeExecutionStack.map((entry) => entry.node.name),
		['Wait'],
		':1957 — the node goes back on the stack so the run can start again from it',
	);
});

test('CONFORMANCE resume: processRunExecutionData continues from the parked node (:1400-1412)', { timeout: 5000 }, async () => {
	const paused = await waitEngine().runWorkflow();
	assert.equal(paused.status, 'waiting', 'sanity: the first run parked');

	const resumed = await new WorkflowExecutionEngine(
		waitFixture(),
		paused.runExecutionData,
	).processRunExecutionData();

	assert.equal(resumed.status, 'success');
	assert.equal(resumed.paused, false);
	assert.equal(resumed.waitTill, undefined);
	assert.equal(resumed.resultData.runData.Wait.length, 1, ':1300 — the waiting entry is popped, not added to');
	assert.equal(resumed.resultData.runData.Wait[0].executionStatus, 'success');
	assert.deepEqual(payload(resumed.resultData.runData.Wait[0].data.main[0]), [{ v: 1 }]);
	assert.deepEqual(payload(resumed.resultData.runData.After[0].data.main[0]), [{ v: 1 }]);
	assert.equal(resumed.resultData.lastNodeExecuted, 'After');
	assert.deepEqual(resumed.runExecutionData.executionData.nodeExecutionStack, []);
});

test('CONFORMANCE resume: the snapshot survives a JSON round trip, like a real persisted execution', { timeout: 5000 }, async () => {
	const paused = await waitEngine().runWorkflow();
	// n8n stores IRunExecutionData in the database, so the snapshot must be plain JSON.
	const persisted = JSON.parse(JSON.stringify(paused.runExecutionData));
	assert.equal(persisted.waitTill, paused.waitTill.toISOString());

	const resumed = await new WorkflowExecutionEngine(waitFixture(), persisted).processRunExecutionData();

	assert.equal(resumed.status, 'success');
	assert.deepEqual(payload(resumed.resultData.runData.After[0].data.main[0]), [{ v: 1 }]);
});

test('CONFORMANCE restored runIndex continues existing runData unless the stack overrides it (:1555-1561)', { timeout: 5000 }, async () => {
	const node = { name: 'Only', type: 'custom.only', parameters: {} };
	const priorTask = {
		startTime: 1,
		executionIndex: 7,
		source: [null],
		hints: [],
		executionTime: 0,
		executionStatus: 'success',
		data: { main: [[item({ prior: true })]] },
	};
	const stateWith = (runIndex) => ({
		version: 1,
		resultData: { runData: { Only: [structuredClone(priorTask)] }, lastNodeExecuted: 'Only' },
		executionData: {
			nodeExecutionStack: [{
				node: { ...node },
				data: { main: [[item({ resumed: true })]] },
				source: { main: [null] },
				...(runIndex === undefined ? {} : { runIndex }),
			}],
			waitingExecution: {},
			waitingExecutionSource: {},
		},
	});

	for (const [override, expected] of [[undefined, 1], [9, 9]]) {
		let observedRunIndex;
		const engine = new WorkflowExecutionEngine({ nodes: [node], connections: {} }, stateWith(override));
		engine.registerNodeType('custom.only', async (_node, items, ctx) => {
			observedRunIndex = ctx.runIndex;
			return items;
		});

		const result = await engine.processRunExecutionData();

		assert.equal(observedRunIndex, expected);
		assert.equal(result.resultData.runData.Only.length, 2);
		assert.equal(result.resultData.runData.Only[1].executionIndex, 8, 'global executionIndex also continues');
	}
});

test('CONFORMANCE handleWaitingState: clears waitTill, disables the parked node, pops its entry (:1285-1302)', { timeout: 5000 }, async () => {
	const paused = await waitEngine().runWorkflow();
	const state = JSON.parse(JSON.stringify(paused.runExecutionData));
	const engine = new WorkflowExecutionEngine(waitFixture());

	assert.equal(state.executionData.nodeExecutionStack[0].node.disabled, undefined, 'not disabled while parked');
	engine.handleWaitingState(state);

	assert.equal(state.waitTill, undefined, '1. waitTill is cleared');
	assert.equal(state.executionData.nodeExecutionStack[0].node.disabled, true, '2. the parked node is disabled');
	assert.equal(state.resultData.runData.Wait.length, 0, '3. its waiting entry is popped');
});

test('CONFORMANCE handleWaitingState is a no-op for an execution that is not waiting (:1286)', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine(waitFixture());
	const state = {
		waitTill: undefined,
		executionData: { nodeExecutionStack: [{ node: { name: 'Wait' } }] },
		resultData: { runData: { Wait: [{ executionStatus: 'success' }] }, lastNodeExecuted: 'Wait' },
	};
	engine.handleWaitingState(state);

	assert.equal(state.resultData.runData.Wait.length, 1, 'nothing is popped');
	assert.equal(state.executionData.nodeExecutionStack[0].node.disabled, undefined, 'nothing is disabled');
});

test('CONFORMANCE a disabled multi-input node passes only its first slot; a missing first slot becomes empty output (:909-920, :2192-2196)', { timeout: 5000 }, async () => {
	// Output 0 feeds input slot 1. Once the stack drains, the missing slot 0 is normalized to [];
	// handleDisabledNode must pass that first slot through, not the populated second slot.
	const engine = new WorkflowExecutionEngine({
		nodes: [
			{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
			{ name: 'Fan In', type: 'n8n-nodes-base.noOp', parameters: {}, disabled: true },
			{ name: 'After', type: 'n8n-nodes-base.noOp', parameters: {} },
		],
		connections: {
			'Manual Trigger': { main: [[conn('Fan In', 1)]] },
			'Fan In': { main: [[conn('After')]] },
		},
	});
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [item({ v: 1 })]);
	engine.registerNodeType('n8n-nodes-base.noOp', async (_n, items) => items);

	const result = await engine.runWorkflow();

	assert.equal(result.status, 'success');
	assert.deepEqual(result.resultData.runData['Fan In'][0].data.main, [[]]);
	assert.equal(result.resultData.runData.After, undefined, 'the empty first-slot output ends the branch');
	assert.equal(result.resultData.lastNodeExecuted, 'Fan In', ':1738 — an empty output object still counts');
});

test('CONFORMANCE a disabled trigger is not chosen and ordinary nodes are not fallback starts (workflow.ts:824, :839, :853)', { timeout: 5000 }, async () => {
	const wf = linear();
	wf.nodes[0].disabled = true;
	const engine = new WorkflowExecutionEngine(wf);
	engine.registerNodeType('n8n-nodes-base.code', async (_n, items) => items);
	engine.registerNodeType('n8n-nodes-base.set', async (_n, items) => items);

	assert.equal(engine.findStartNode(), undefined);
	await assert.rejects(
		() => engine.runWorkflow(),
		(error) => error.name === 'ApplicationError' && error.message === 'No node to start the workflow from could be found',
	);
});

/* ------------------------------------------------------------------ *
 * executeOnce (workflow-execute.ts:990-1002, :1219)
 * ------------------------------------------------------------------ */

const manyItemsFixture = (extra = {}) => ({
	nodes: [
		{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
		{ name: 'Only Once', type: 'n8n-nodes-base.code', parameters: {}, ...extra },
	],
	connections: { 'Manual Trigger': { main: [[conn('Only Once')]] } },
});

const manyItemsEngine = (extra = {}) => {
	const engine = new WorkflowExecutionEngine(manyItemsFixture(extra));
	const seen = [];
	engine.registerNodeType('n8n-nodes-base.manualTrigger', async () => [
		item({ n: 1 }),
		item({ n: 2 }),
		item({ n: 3 }),
	]);
	engine.registerNodeType('n8n-nodes-base.code', async (_node, items, ctx) => {
		seen.push({ items: items.length, slots: ctx.inputData.map((slot) => slot?.length ?? null) });
		return items;
	});
	return { engine, seen };
};

test('CONFORMANCE executeOnce: the node is handed only the first item of every input slot (:990-1002)', { timeout: 5000 }, async () => {
	const { engine, seen } = manyItemsEngine({ executeOnce: true });
	const result = await engine.runWorkflow();

	assert.deepEqual(seen, [{ items: 1, slots: [1] }]);
	assert.deepEqual(payload(taskOf(result, 'Only Once').data.main[0]), [{ n: 1 }]);
});

test('CONFORMANCE executeOnce off: every item reaches the node (control)', { timeout: 5000 }, async () => {
	const { engine, seen } = manyItemsEngine();
	const result = await engine.runWorkflow();

	assert.deepEqual(seen, [{ items: 3, slots: [3] }]);
	assert.deepEqual(payload(taskOf(result, 'Only Once').data.main[0]), [{ n: 1 }, { n: 2 }, { n: 3 }]);
});

test('CONFORMANCE handleExecuteOnce narrows every slot and keeps null slots null (:990-1002)', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine(manyItemsFixture());
	const narrowed = engine.handleExecuteOnce(
		{ name: 'X', executeOnce: true },
		{ main: [[item({ a: 1 }), item({ a: 2 })], null, [item({ b: 1 }), item({ b: 2 })]], ai_tool: [[item({ t: 1 }), item({ t: 2 })]] },
	);

	assert.deepEqual(payload(narrowed.main[0]), [{ a: 1 }]);
	assert.equal(narrowed.main[1], null, 'a null slot stays null');
	assert.deepEqual(payload(narrowed.main[2]), [{ b: 1 }]);
	assert.deepEqual(payload(narrowed.ai_tool[0]), [{ t: 1 }], 'every connection type is narrowed, not just main');

	const untouched = engine.handleExecuteOnce({ name: 'X' }, { main: [[item({ a: 1 }), item({ a: 2 })]] });
	assert.equal(untouched.main[0].length, 2, 'without the flag the data is returned as-is');
});

/* ------------------------------------------------------------------ *
 * ensureInputData / getHighestNode (workflow-execute.ts:2315-2348, workflow.ts:492-568)
 * ------------------------------------------------------------------ */

test('CONFORMANCE getHighestNode finds the root-most non-disabled ancestors (workflow.ts:492-568)', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine({
		nodes: [
			{ name: 'Root', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
			{ name: 'Mid', type: 'n8n-nodes-base.code', parameters: {}, disabled: true },
			{ name: 'Leaf', type: 'n8n-nodes-base.set', parameters: {} },
		],
		connections: {
			Root: { main: [[conn('Mid')]] },
			Mid: { main: [[conn('Leaf')]] },
		},
	});

	assert.deepEqual(engine.getHighestNode('Leaf'), ['Root'], 'a disabled node in between is skipped');
	assert.deepEqual(engine.getHighestNode('Root'), [], 'a root has no incoming connection');
});

test('CONFORMANCE ensureInputData: a slot whose ancestors are all disabled never waits (:2317-2325)', { timeout: 5000 }, async () => {
	const engine = new WorkflowExecutionEngine({
		nodes: [
			{ name: 'Root', type: 'n8n-nodes-base.manualTrigger', parameters: {}, disabled: true },
			{ name: 'Leaf', type: 'n8n-nodes-base.set', parameters: {} },
		],
		connections: { Root: { main: [[conn('Leaf')]] } },
	});

	const stack = [];
	const ready = engine.ensureInputData(engine.nodes.get('Leaf'), { data: {} }, stack);

	assert.equal(ready, true, 'it runs as-is instead of waiting for data that can never arrive');
	assert.deepEqual(stack, [], 'and it is not pushed back');
});

test('CONFORMANCE ensureInputData: in the legacy order a missing slot puts the entry back (:2334-2347)', { timeout: 5000 }, async () => {
	// Both slots need a real ancestor: a slot with no incoming connection at all counts as
	// "no valid incoming node" and the node runs as-is (:2317-2325).
	const engine = new WorkflowExecutionEngine({
		nodes: [
			{ name: 'Root A', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
			{ name: 'Root B', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
			{ name: 'Merge', type: 'n8n-nodes-base.code', parameters: {} },
		],
		connections: {
			'Root A': { main: [[conn('Merge', 0)]] },
			'Root B': { main: [[conn('Merge', 1)]] },
		},
		settings: { executionOrder: 'v0' },
	});

	const entry = { node: engine.nodes.get('Merge'), data: { main: [null, [item({ v: 1 })]] } };
	const stack = [];

	assert.equal(engine.ensureInputData(entry.node, entry, stack), false, 'slot 0 is still null');
	assert.deepEqual(stack, [entry], ':2344 — the entry goes back on the stack');

	const complete = { node: entry.node, data: { main: [[item({ a: 1 })], [item({ v: 1 })]] } };
	const stack2 = [];
	assert.equal(engine.ensureInputData(complete.node, complete, stack2), true);
	assert.deepEqual(stack2, []);
});

test('CONFORMANCE a stack entry that never becomes ready aborts the run instead of spinning (:1564-1568)', { timeout: 10000 }, async () => {
	// Restored state whose entry has a null slot in the legacy order: ensureInputData keeps
	// putting it back, and the reference's own endless-loop guard is what stops it.
	const engine = new WorkflowExecutionEngine(
		{
			nodes: [
				{ name: 'Root A', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
				{ name: 'Root B', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
				{ name: 'Merge', type: 'n8n-nodes-base.code', parameters: {} },
			],
			connections: {
				'Root A': { main: [[conn('Merge', 0)]] },
				'Root B': { main: [[conn('Merge', 1)]] },
			},
			settings: { executionOrder: 'v0' },
		},
		{
			version: 1,
			resultData: { runData: {}, lastNodeExecuted: undefined },
			executionData: {
				nodeExecutionStack: [
					{ node: { name: 'Merge', type: 'n8n-nodes-base.code', parameters: {} }, data: { main: [null, [item({ v: 1 })]] }, source: { main: [null, null] } },
				],
				waitingExecution: {},
				waitingExecutionSource: {},
			},
		},
	);
	engine.registerNodeType('n8n-nodes-base.code', async (_n, items) => items);

	const result = await engine.processRunExecutionData();

	assert.equal(result.status, 'error');
	assert.equal(
		result.resultData.error.message,
		'Stopped execution because it seems to be in an endless loop',
		'workflow-execute.ts:1566',
	);
	assert.equal(result.resultData.runData.Merge, undefined, 'the node never ran');
});
