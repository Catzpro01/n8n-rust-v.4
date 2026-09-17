/**
 * POOL-001 — core workflow execute loop.
 * Every assertion below is a behaviour pinned to
 * reference/n8n/packages/core/src/execution-engine/workflow-execute.ts (2.9.4).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRunExecutionData } from '../src/index.mjs';
import {
	createRecordingHooks,
	createWorkflow,
	executeWorkflow,
	itemsOf,
	node,
	taskOf,
	typeDefinition,
} from './helpers.mjs';

const MANUAL_TRIGGER = 'n8n-nodes-base.manualTrigger';
const SET = 'n8n-nodes-base.set';
const IF = 'n8n-nodes-base.if';
const MERGE = 'n8n-nodes-base.merge';
const NO_OP = 'n8n-nodes-base.noOp';

function constantTrigger(jsonItems) {
	return typeDefinition(MANUAL_TRIGGER, {
		execute: async () => [jsonItems.map((json) => ({ json }))],
		group: ['trigger'],
	});
}

function passThrough(name = SET, mapper = (json) => json) {
	// NOTE: pairedItem is intentionally NOT carried over, so the assertions below
	// observe the engine's own auto-assignment rules (execution-data contract I4).
	return typeDefinition(name, {
		execute: async function () {
			return [this.getInputData().map((item) => ({ json: mapper(item.json) }))];
		},
	});
}

test('linear chain: one task per node, ordered, sourced and paired', async () => {
	const workflow = createWorkflow({
		nodes: [
			node('Manual Trigger', MANUAL_TRIGGER),
			node('Set1', SET),
			node('Set2', SET),
		],
		connections: {
			'Manual Trigger': { main: [[{ node: 'Set1', type: 'main', index: 0 }]] },
			Set1: { main: [[{ node: 'Set2', type: 'main', index: 0 }]] },
		},
		nodeTypes: {
			[MANUAL_TRIGGER]: constantTrigger([{ started: true }]),
			[SET]: passThrough(),
		},
	});

	const { run } = await executeWorkflow(workflow);

	assert.equal(run.status, 'success');
	assert.equal(run.finished, true);
	assert.equal(run.data.resultData.lastNodeExecuted, 'Set2');
	assert.deepEqual(Object.keys(run.data.resultData.runData), ['Manual Trigger', 'Set1', 'Set2']);

	// executionIndex increases monotonically across tasks
	assert.deepEqual(
		['Manual Trigger', 'Set1', 'Set2'].map((name) => taskOf(run, name).executionIndex),
		[0, 1, 2],
	);

	// I6: the start node has no source, children record previousNode/Output/Run
	assert.deepEqual(taskOf(run, 'Manual Trigger').source, []);
	assert.deepEqual(taskOf(run, 'Set1').source, [
		{ previousNode: 'Manual Trigger', previousNodeOutput: 0, previousNodeRun: 0 },
	]);

	// I4a: one input item → pairedItem { item: 0 }
	assert.deepEqual(itemsOf(run, 'Set2')[0].pairedItem, { item: 0 });
	assert.deepEqual(itemsOf(run, 'Set2')[0].json, { started: true });

	// task data carries timing + status
	const task = taskOf(run, 'Set1');
	assert.equal(task.executionStatus, 'success');
	assert.equal(typeof task.executionTime, 'number');
	assert.equal(task.data.main.length, 1);
});

test('item order and count are preserved and paired by index (I4b, I13)', async () => {
	const workflow = createWorkflow({
		nodes: [node('Manual Trigger', MANUAL_TRIGGER), node('Set', SET)],
		connections: { 'Manual Trigger': { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
		nodeTypes: {
			[MANUAL_TRIGGER]: constantTrigger([{ n: 1 }, { n: 2 }, { n: 3 }]),
			[SET]: passThrough(),
		},
	});

	const { run } = await executeWorkflow(workflow);
	const items = itemsOf(run, 'Set');

	assert.deepEqual(items.map((item) => item.json.n), [1, 2, 3]);
	assert.deepEqual(items.map((item) => item.pairedItem), [{ item: 0 }, { item: 1 }, { item: 2 }]);
});

test('multiple outputs route independently and record previousNodeOutput (I7)', async () => {
	const workflow = createWorkflow({
		nodes: [
			node('Manual Trigger', MANUAL_TRIGGER),
			node('If', IF),
			node('True Branch', SET),
			node('False Branch', SET),
		],
		connections: {
			'Manual Trigger': { main: [[{ node: 'If', type: 'main', index: 0 }]] },
			If: {
				main: [
					[{ node: 'True Branch', type: 'main', index: 0 }],
					[{ node: 'False Branch', type: 'main', index: 0 }],
				],
			},
		},
		nodeTypes: {
			[MANUAL_TRIGGER]: constantTrigger([{ value: 7 }]),
			[IF]: typeDefinition(IF, {
				outputs: ['main', 'main'],
				execute: async function () {
					const items = this.getInputData();
					const isTrue = items[0].json.value > 5;
					return [isTrue ? items : [], isTrue ? [] : items];
				},
			}),
			[SET]: passThrough(),
		},
	});

	const { run } = await executeWorkflow(workflow);

	assert.equal(itemsOf(run, 'True Branch').length, 1);
	assert.equal(run.data.resultData.runData['False Branch'], undefined);
	assert.deepEqual(taskOf(run, 'True Branch').source, [
		{ previousNode: 'If', previousNodeOutput: 0, previousNodeRun: 0 },
	]);
	assert.deepEqual(Object.keys(taskOf(run, 'If').data.main).length, 2);
});

test('empty output ends the branch but is a successful task (I8)', async () => {
	const workflow = createWorkflow({
		nodes: [node('Manual Trigger', MANUAL_TRIGGER), node('Empty', SET), node('Never', SET)],
		connections: {
			'Manual Trigger': { main: [[{ node: 'Empty', type: 'main', index: 0 }]] },
			Empty: { main: [[{ node: 'Never', type: 'main', index: 0 }]] },
		},
		nodeTypes: {
			[MANUAL_TRIGGER]: constantTrigger([{ a: 1 }]),
			[SET]: typeDefinition(SET, { execute: async () => [[]] }),
		},
	});

	const { run } = await executeWorkflow(workflow);

	assert.equal(run.status, 'success');
	assert.equal(run.data.resultData.lastNodeExecuted, 'Empty');
	assert.deepEqual(taskOf(run, 'Empty').data.main, [[]]);
	assert.equal(taskOf(run, 'Empty').executionStatus, 'success');
	assert.equal(run.data.resultData.runData.Never, undefined);
});

test('alwaysOutputData turns an empty output into one paired item (I9)', async () => {
	const workflow = createWorkflow({
		nodes: [node('Manual Trigger', MANUAL_TRIGGER), node('Empty', SET, {}, { alwaysOutputData: true }), node('After', SET)],
		connections: {
			'Manual Trigger': { main: [[{ node: 'Empty', type: 'main', index: 0 }]] },
			Empty: { main: [[{ node: 'After', type: 'main', index: 0 }]] },
		},
		nodeTypes: {
			[MANUAL_TRIGGER]: constantTrigger([{ a: 1 }, { a: 2 }]),
			[SET]: typeDefinition(SET, {
				execute: async function () {
					if (this.getNode().name === 'Empty') return [[]];
					return [this.getInputData()];
				},
			}),
		},
	});

	const { run } = await executeWorkflow(workflow);
	const items = itemsOf(run, 'Empty');

	assert.equal(items.length, 1);
	assert.deepEqual(items[0].json, {});
	assert.deepEqual(items[0].pairedItem, [
		{ item: 0, input: 0 },
		{ item: 1, input: 0 },
	]);
	assert.equal(itemsOf(run, 'After').length, 1);
});

test('a node returning null ends the branch and records no task data', async () => {
	const workflow = createWorkflow({
		nodes: [node('Manual Trigger', MANUAL_TRIGGER), node('Null', SET), node('Never', SET)],
		connections: {
			'Manual Trigger': { main: [[{ node: 'Null', type: 'main', index: 0 }]] },
			Null: { main: [[{ node: 'Never', type: 'main', index: 0 }]] },
		},
		nodeTypes: {
			[MANUAL_TRIGGER]: constantTrigger([{ a: 1 }]),
			[SET]: typeDefinition(SET, { execute: async () => null }),
		},
	});

	const { run } = await executeWorkflow(workflow);

	assert.equal(run.data.resultData.runData.Null, undefined);
	assert.equal(run.data.resultData.runData.Never, undefined);
	assert.equal(run.data.resultData.lastNodeExecuted, 'Manual Trigger');
});

test('executeOnce limits every input to its first item', async () => {
	let seen = 0;
	const workflow = createWorkflow({
		nodes: [node('Manual Trigger', MANUAL_TRIGGER), node('Once', SET, {}, { executeOnce: true })],
		connections: { 'Manual Trigger': { main: [[{ node: 'Once', type: 'main', index: 0 }]] } },
		nodeTypes: {
			[MANUAL_TRIGGER]: constantTrigger([{ n: 1 }, { n: 2 }, { n: 3 }]),
			[SET]: typeDefinition(SET, {
				execute: async function () {
					seen = this.getInputData().length;
					return [this.getInputData()];
				},
			}),
		},
	});

	const { run } = await executeWorkflow(workflow);

	assert.equal(seen, 1);
	assert.equal(itemsOf(run, 'Once').length, 1);
});

test('destinationNode skips nodes outside the destination ancestry', async () => {
	let sideBranchRan = false;
	const workflow = createWorkflow({
		nodes: [node('Manual Trigger', MANUAL_TRIGGER), node('A', SET), node('B', SET), node('C', SET)],
		connections: {
			'Manual Trigger': {
				main: [[{ node: 'A', type: 'main', index: 0 }, { node: 'C', type: 'main', index: 0 }]],
			},
			A: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
		},
		nodeTypes: {
			[MANUAL_TRIGGER]: constantTrigger([{ a: 1 }]),
			[SET]: typeDefinition(SET, {
				execute: async function () {
					if (this.getNode().name === 'C') sideBranchRan = true;
					return [this.getInputData()];
				},
			}),
		},
	});

	const { run } = await executeWorkflow(workflow, {
		destinationNode: { nodeName: 'B', mode: 'inclusive' },
	});

	assert.equal(sideBranchRan, false);
	assert.equal(run.data.resultData.runData.C, undefined);
	assert.equal(run.status, 'success');
});

test('two-input node waits until both inputs carry data', async () => {
	const seenInputs = [];
	const workflow = createWorkflow({
		nodes: [
			node('Manual Trigger', MANUAL_TRIGGER),
			node('P1', SET),
			node('P2', SET),
			node('Merge', MERGE, {}, { typeVersion: 2 }),
		],
		connections: {
			'Manual Trigger': {
				main: [[{ node: 'P1', type: 'main', index: 0 }, { node: 'P2', type: 'main', index: 0 }]],
			},
			P1: { main: [[{ node: 'Merge', type: 'main', index: 0 }]] },
			P2: { main: [[{ node: 'Merge', type: 'main', index: 1 }]] },
		},
		nodeTypes: {
			[MANUAL_TRIGGER]: constantTrigger([{ from: 'trigger' }]),
			[SET]: typeDefinition(SET, {
				execute: async function () {
					return [this.getInputData().map((item) => ({ json: { ...item.json, hop: this.getNode().name } }))];
				},
			}),
			[MERGE]: typeDefinition(MERGE, {
				inputs: ['main', 'main'],
				execute: async function () {
					seenInputs.push([this.getInputData(0), this.getInputData(1)]);
					return [this.getInputData(0).concat(this.getInputData(1))];
				},
			}),
		},
	});

	const { run } = await executeWorkflow(workflow);

	assert.equal(seenInputs.length, 1, 'merge node must run exactly once');
	assert.equal(seenInputs[0][0].length, 1);
	assert.equal(seenInputs[0][1].length, 1);
	assert.deepEqual(seenInputs[0][0][0].json, { from: 'trigger', hop: 'P1' });
	assert.deepEqual(seenInputs[0][1][0].json, { from: 'trigger', hop: 'P2' });

	const mergeTask = taskOf(run, 'Merge');
	assert.equal(mergeTask.source.length, 2);
	assert.deepEqual(mergeTask.source, [
		{ previousNode: 'P1', previousNodeOutput: 0, previousNodeRun: 0 },
		{ previousNode: 'P2', previousNodeOutput: 0, previousNodeRun: 0 },
	]);
	assert.equal(run.data.executionData.waitingExecution.Merge, undefined, 'waiting slot must be consumed');
});

test('pinData short-circuits a node and is recorded as its output', async () => {
	let called = false;
	const workflow = createWorkflow({
		nodes: [node('Manual Trigger', MANUAL_TRIGGER), node('Pinned', SET)],
		connections: { 'Manual Trigger': { main: [[{ node: 'Pinned', type: 'main', index: 0 }]] } },
		nodeTypes: {
			[MANUAL_TRIGGER]: constantTrigger([{ a: 1 }]),
			[SET]: typeDefinition(SET, {
				execute: async () => {
					called = true;
					return [[]];
				},
			}),
		},
	});

	const { run } = await executeWorkflow(workflow, {
		pinData: { Pinned: [{ json: { pinned: true } }] },
	});

	assert.equal(called, false);
	assert.deepEqual(itemsOf(run, 'Pinned').map((item) => item.json), [{ pinned: true }]);
});

test('runIndex of a new run equals the number of runs recorded for that node (I12)', async () => {
	const previousRunData = {
		'Manual Trigger': [
			{
				startTime: 0,
				executionIndex: 0,
				executionTime: 0,
				source: [],
				executionStatus: 'success',
				data: { main: [[{ json: { old: true } }]] },
			},
		],
	};

	const workflow = createWorkflow({
		nodes: [node('Manual Trigger', MANUAL_TRIGGER)],
		nodeTypes: { [MANUAL_TRIGGER]: constantTrigger([{ fresh: true }]) },
	});

	const { run } = await executeWorkflow(workflow, {
		engineOptions: { runExecutionData: createRunExecutionData({ resultData: { runData: previousRunData } }) },
	});

	const runs = run.data.resultData.runData['Manual Trigger'];
	assert.equal(runs.length, 2);
	assert.deepEqual(runs[1].data.main[0], [{ json: { fresh: true }, pairedItem: { item: 0 } }]);
});

test('re-processing the same node+runIndex stops with the endless-loop guard', async () => {
	const workflow = createWorkflow({
		nodes: [node('Manual Trigger', MANUAL_TRIGGER), node('Target', SET)],
		connections: { 'Manual Trigger': { main: [[{ node: 'Target', type: 'main', index: 0 }]] } },
		nodeTypes: {
			[MANUAL_TRIGGER]: constantTrigger([{ a: 1 }]),
			[SET]: passThrough(),
		},
	});

	// `data: {}` has no `main`, so `ensureInputData` re-queues the very same entry
	// and the loop sees the identical `node:runIndex` twice.
	const { run } = await executeWorkflow(workflow, {
		startNode: workflow.getNode('Target'),
		startNodes: [{ node: workflow.getNode('Target'), data: {} }],
	});

	assert.equal(run.status, 'error');
	assert.match(run.data.resultData.error.message, /endless loop/);
});

test('lifecycle hooks fire in execution order', async () => {
	const order = [];
	const workflow = createWorkflow({
		nodes: [node('Manual Trigger', MANUAL_TRIGGER), node('After', SET)],
		connections: { 'Manual Trigger': { main: [[{ node: 'After', type: 'main', index: 0 }]] } },
		nodeTypes: {
			[MANUAL_TRIGGER]: constantTrigger([{ a: 1 }]),
			[SET]: passThrough(),
		},
	});

	await executeWorkflow(workflow, { engineOptions: { hooks: createRecordingHooks(order) } });

	assert.deepEqual(order.map((entry) => [entry.name, entry.node]), [
		['workflowExecuteBefore', undefined],
		['nodeExecuteBefore', 'Manual Trigger'],
		['nodeExecuteAfter', 'Manual Trigger'],
		['nodeExecuteBefore', 'After'],
		['nodeExecuteAfter', 'After'],
		['workflowExecuteAfter', undefined],
	]);
});

test('a disabled node passes its input through and records a task', async () => {
	let disabledRan = false;
	const workflow = createWorkflow({
		nodes: [
			node('Manual Trigger', MANUAL_TRIGGER),
			node('Disabled', NO_OP, {}, { disabled: true }),
			node('After', SET),
		],
		connections: {
			'Manual Trigger': { main: [[{ node: 'Disabled', type: 'main', index: 0 }]] },
			Disabled: { main: [[{ node: 'After', type: 'main', index: 0 }]] },
		},
		nodeTypes: {
			[MANUAL_TRIGGER]: constantTrigger([{ a: 1 }]),
			[NO_OP]: typeDefinition(NO_OP, {
				execute: async () => {
					disabledRan = true;
					return [[]];
				},
			}),
			[SET]: passThrough(),
		},
	});

	const { run } = await executeWorkflow(workflow);

	assert.equal(run.status, 'success');
	assert.equal(disabledRan, false, 'a disabled node must not execute');
	assert.equal(itemsOf(run, 'After')[0].json.a, 1);
});
