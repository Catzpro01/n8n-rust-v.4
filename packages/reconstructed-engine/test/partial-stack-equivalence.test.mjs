#!/usr/bin/env node
/**
 * Remaining partial-planning differential suite.
 *
 * Public helpers are executed against n8n-core 2.9.1. Support helpers that n8n keeps module-private
 * are pinned with source-derived unit cases adapted from the upstream 2.9.4 tests.
 *
 * `engine:test` skips runtime comparisons when the pinned runtime is absent; `engine:test:strict`
 * fails instead. Install it with `scripts/setup-reference-runtime.sh`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	DirectedGraph as MineDirectedGraph,
	addWaitingExecution,
	addWaitingExecutionSource,
	findStartNodes as mineFindStartNodes,
	getSourceDataGroups,
	isDirty,
	recreateNodeExecutionStack as mineRecreateNodeExecutionStack,
	rewireGraph as mineRewireGraph,
} from '../partial.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const RUNTIME = process.env.LEGO_LIVE_RUNTIME ?? join(REPO, '.runtime', 'node_modules');
const runtimeReady =
	existsSync(join(RUNTIME, 'n8n-core', 'package.json')) &&
	existsSync(join(RUNTIME, 'n8n-workflow', 'package.json'));
const missingRuntimeMessage =
	`pinned reference runtime not installed at ${RUNTIME} (run scripts/setup-reference-runtime.sh)`;
if (!runtimeReady && process.env.REQUIRE_REFERENCE_RUNTIME === '1') {
	throw new Error(missingRuntimeMessage);
}
const skipReason = runtimeReady ? false : missingRuntimeMessage;

const req = runtimeReady ? createRequire(join(RUNTIME, 'package.json')) : null;
const core = runtimeReady ? req('n8n-core') : null;
const RealDirectedGraph = runtimeReady ? core.DirectedGraph : null;
const realFindStartNodes = runtimeReady ? core.findStartNodes : null;
const realRecreateNodeExecutionStack = runtimeReady ? core.recreateNodeExecutionStack : null;
const realRewireGraph = runtimeReady ? core.rewireGraph : null;
const realFindStartModule = runtimeReady
	? req(join(RUNTIME, 'n8n-core/dist/execution-engine/partial-execution-utils/find-start-nodes.js'))
	: null;
const realSourceGroupsModule = runtimeReady
	? req(join(RUNTIME, 'n8n-core/dist/execution-engine/partial-execution-utils/get-source-data-groups.js'))
	: null;
const realStackModule = runtimeReady
	? req(
			join(
				RUNTIME,
				'n8n-core/dist/execution-engine/partial-execution-utils/recreate-node-execution-stack.js',
			),
		)
	: null;

const MAIN = 'main';
const AI_TOOL = 'ai_tool';
const item = (value) => ({ json: { value } });
const task = (outputs = [[item('default')]]) => ({ data: { main: outputs } });

const node = (definition) => {
	const value = typeof definition === 'string' ? { name: definition } : definition;
	return {
		id: `id-${value.name}`,
		name: value.name,
		type: 'n8n-nodes-base.noOp',
		typeVersion: 1,
		position: [0, 0],
		parameters: {},
		...value,
	};
};

function build(Impl, nodeDefinitions, connectionDefinitions = []) {
	const nodes = nodeDefinitions.map(node);
	const byName = Object.fromEntries(nodes.map((value) => [value.name, value]));
	const graph = new Impl().addNodes(...nodes);
	for (const connection of connectionDefinitions) {
		graph.addConnection({
			from: byName[connection.from],
			to: byName[connection.to],
			type: connection.type ?? MAIN,
			outputIndex: connection.outputIndex ?? 0,
			inputIndex: connection.inputIndex ?? 0,
		});
	}
	return { graph, byName };
}

const names = (nodes) => [...nodes].map((value) => value.name).sort();

const normalizeConnection = (connection) => ({
	from: connection.from.name,
	to: connection.to.name,
	type: connection.type,
	outputIndex: connection.outputIndex,
	inputIndex: connection.inputIndex,
});

const normalizeGroups = (groups) =>
	groups.map((group) => ({
		complete: group.complete,
		connections: group.connections.map(normalizeConnection),
	}));

const normalizeStack = (value) => ({
	nodeExecutionStack: value.nodeExecutionStack.map((entry) => ({
		node: entry.node.name,
		data: entry.data,
		source: entry.source,
	})),
	waitingExecution: value.waitingExecution,
	waitingExecutionSource: value.waitingExecutionSource,
});

function normalizeGraph(graph) {
	const normalizedNodes = [...graph.getNodes().values()]
		.map((value) => ({
			name: value.name,
			id: value.id,
			type: value.type,
			typeVersion: value.typeVersion,
			position: value.position,
			parameters: value.parameters,
			disabled: value.disabled,
			rewireOutputLogTo: value.rewireOutputLogTo,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
	const normalizedConnections = graph
		.getConnections()
		.map(normalizeConnection)
		.sort((a, b) =>
			`${a.from}|${a.type}|${a.outputIndex}|${a.inputIndex}|${a.to}`.localeCompare(
				`${b.from}|${b.type}|${b.outputIndex}|${b.inputIndex}|${b.to}`,
			),
		);
	return { nodes: normalizedNodes, connections: normalizedConnections };
}

function compareFindStartNodes(nodeDefinitions, connections, trigger, destination, runData, pinData) {
	const mine = build(MineDirectedGraph, nodeDefinitions, connections);
	const real = build(RealDirectedGraph, nodeDefinitions, connections);
	const mineResult = mineFindStartNodes({
		graph: mine.graph,
		trigger: mine.byName[trigger],
		destination: mine.byName[destination],
		runData: structuredClone(runData),
		pinData: structuredClone(pinData),
	});
	const realResult = realFindStartNodes({
		graph: real.graph,
		trigger: real.byName[trigger],
		destination: real.byName[destination],
		runData: structuredClone(runData),
		pinData: structuredClone(pinData),
	});
	assert.deepEqual(names(mineResult), names(realResult));
	return names(mineResult);
}

function compareRecreate(nodeDefinitions, connections, startNames, runData, pinData) {
	const mine = build(MineDirectedGraph, nodeDefinitions, connections);
	const real = build(RealDirectedGraph, nodeDefinitions, connections);
	const mineResult = mineRecreateNodeExecutionStack(
		mine.graph,
		new Set(startNames.map((name) => mine.byName[name])),
		structuredClone(runData),
		structuredClone(pinData),
	);
	const realResult = realRecreateNodeExecutionStack(
		real.graph,
		new Set(startNames.map((name) => real.byName[name])),
		structuredClone(runData),
		structuredClone(pinData),
	);
	assert.deepEqual(normalizeStack(mineResult), normalizeStack(realResult));
	return normalizeStack(mineResult);
}

/* ------------------------------------------------------------------ *
 * source-derived checks for helpers n8n-core does not export
 * ------------------------------------------------------------------ */

test('UNIT/PORT isDirty preserves the current pin/run-data-only decision table', () => {
	const current = node('Current');
	const cases = [
		{ args: [current], expected: true },
		{ args: [current, { Current: [] }], expected: false },
		{ args: [current, undefined, { Current: [] }], expected: false },
		{ args: [current, null, {}], expected: true },
		{ args: [current, {}, { Other: [item(1)] }], expected: true },
	];
	for (const { args, expected } of cases) {
		assert.equal(isDirty(...args), expected);
		if (runtimeReady) assert.equal(realFindStartModule.isDirty(...args), expected);
	}
});

test('UNIT/PORT getSourceDataGroups deterministically prefers data and marks incomplete groups', () => {
	const definitions = ['A', 'B', 'C', 'D', 'Utility', 'Target'];
	const connections = [
		{ from: 'B', to: 'Target', inputIndex: 0 },
		{ from: 'A', to: 'Target', inputIndex: 0 },
		{ from: 'D', to: 'Target', inputIndex: 1 },
		{ from: 'C', to: 'Target', inputIndex: 1 },
		{ from: 'Utility', to: 'Target', type: AI_TOOL },
	];
	const runData = { A: [task()], B: [task()], C: [task()] };
	const fixture = build(MineDirectedGraph, definitions, connections);
	const groups = normalizeGroups(
		getSourceDataGroups(fixture.graph, fixture.byName.Target, runData, {}),
	);
	assert.deepEqual(
		groups.map((group) => ({
			complete: group.complete,
			from: group.connections.map((connection) => connection.from),
			inputs: group.connections.map((connection) => connection.inputIndex),
		})),
		[
			{ complete: true, from: ['A', 'C'], inputs: [0, 1] },
			{ complete: false, from: ['B', 'D'], inputs: [0, 1] },
		],
	);
	if (runtimeReady) {
		const real = build(RealDirectedGraph, definitions, connections);
		assert.deepEqual(
			groups,
			normalizeGroups(
				realSourceGroupsModule.getSourceDataGroups(real.graph, real.byName.Target, runData, {}),
			),
		);
	}

	const empty = build(MineDirectedGraph, ['Only']);
	assert.deepEqual(getSourceDataGroups(empty.graph, empty.byName.Only, {}, {}), []);
});

test('UNIT/PORT addWaitingExecution builds sparse run/type/input slots and accepts null', () => {
	const waiting = {};
	addWaitingExecution(waiting, 'Merge', 1, MAIN, 2, [item('third')]);
	addWaitingExecution(waiting, 'Merge', 1, MAIN, 0, null);
	addWaitingExecution(waiting, 'Merge', 0, AI_TOOL, 0, [item('tool')]);
	assert.deepEqual(waiting, {
		Merge: {
			0: { [AI_TOOL]: [[item('tool')]] },
			1: { [MAIN]: [null, , [item('third')]] },
		},
	});
	if (runtimeReady) {
		const realWaiting = {};
		realStackModule.addWaitingExecution(realWaiting, 'Merge', 1, MAIN, 2, [item('third')]);
		realStackModule.addWaitingExecution(realWaiting, 'Merge', 1, MAIN, 0, null);
		realStackModule.addWaitingExecution(realWaiting, 'Merge', 0, AI_TOOL, 0, [item('tool')]);
		assert.deepEqual(waiting, realWaiting);
	}
});

test('UNIT/PORT addWaitingExecutionSource builds sparse source slots and accepts null', () => {
	const waitingSource = {};
	const source = { previousNode: 'A', previousNodeRun: 2, previousNodeOutput: 1 };
	addWaitingExecutionSource(waitingSource, 'Merge', 1, MAIN, 2, source);
	addWaitingExecutionSource(waitingSource, 'Merge', 1, MAIN, 0, null);
	addWaitingExecutionSource(waitingSource, 'Merge', 0, AI_TOOL, 0, source);
	assert.deepEqual(waitingSource, {
		Merge: {
			0: { [AI_TOOL]: [source] },
			1: { [MAIN]: [null, , source] },
		},
	});
	if (runtimeReady) {
		const realWaitingSource = {};
		realStackModule.addWaitingExecutionSource(realWaitingSource, 'Merge', 1, MAIN, 2, source);
		realStackModule.addWaitingExecutionSource(realWaitingSource, 'Merge', 1, MAIN, 0, null);
		realStackModule.addWaitingExecutionSource(realWaitingSource, 'Merge', 0, AI_TOOL, 0, source);
		assert.deepEqual(waitingSource, realWaitingSource);
	}
});

/* ------------------------------------------------------------------ *
 * public n8n-core differential checks
 * ------------------------------------------------------------------ */

test('PORT n8n-core exports all three reconstructed planning operations', { timeout: 60000, skip: skipReason }, () => {
	assert.equal(typeof realFindStartNodes, 'function');
	assert.equal(typeof realRecreateNodeExecutionStack, 'function');
	assert.equal(typeof realRewireGraph, 'function');
});

test('PORT findStartNodes matches simple, branching, output-filter and cycle cases', { timeout: 60000, skip: skipReason }, () => {
	assert.deepEqual(compareFindStartNodes(['Only'], [], 'Only', 'Only', {}, {}), ['Only']);
	assert.deepEqual(
		compareFindStartNodes(['Trigger', 'Destination'], [{ from: 'Trigger', to: 'Destination' }], 'Trigger', 'Destination', {}, {}),
		['Trigger'],
	);
	assert.deepEqual(
		compareFindStartNodes(
			['Trigger', 'Destination'],
			[{ from: 'Trigger', to: 'Destination' }],
			'Trigger',
			'Destination',
			{ Trigger: [task()] },
			{},
		),
		['Destination'],
	);
	assert.deepEqual(
		compareFindStartNodes(
			['Trigger', 'A', 'B', 'Destination'],
			[
				{ from: 'Trigger', to: 'A' },
				{ from: 'Trigger', to: 'B' },
				{ from: 'A', to: 'Destination' },
				{ from: 'B', to: 'Destination' },
			],
			'Trigger',
			'Destination',
			{ Trigger: [task()], A: [task()] },
			{},
		),
		['B', 'Destination'],
	);
	assert.deepEqual(
		compareFindStartNodes(
			['Trigger', 'Destination'],
			[{ from: 'Trigger', to: 'Destination', outputIndex: 1 }],
			'Trigger',
			'Destination',
			{ Trigger: [task([[item('wrong-output')]])] },
			{},
		),
		[],
	);
	assert.deepEqual(
		compareFindStartNodes(
			['Trigger', 'A', 'B', 'Destination'],
			[
				{ from: 'Trigger', to: 'A' },
				{ from: 'A', to: 'B' },
				{ from: 'B', to: 'A' },
				{ from: 'B', to: 'Destination' },
			],
			'Trigger',
			'Destination',
			{ Trigger: [task()], A: [task()], B: [task()] },
			{},
		),
		['Destination'],
	);
});

test('PORT findStartNodes matches pin-data and Loop Over Items completion behavior', { timeout: 60000, skip: skipReason }, () => {
	assert.deepEqual(
		compareFindStartNodes(
			['Trigger', 'Destination'],
			[{ from: 'Trigger', to: 'Destination' }],
			'Trigger',
			'Destination',
			{},
			{ Trigger: [item('pinned')] },
		),
		['Destination'],
	);

	const nodes = ['Trigger', { name: 'Loop', type: 'n8n-nodes-base.splitInBatches' }, 'Destination'];
	const connections = [
		{ from: 'Trigger', to: 'Loop' },
		{ from: 'Loop', to: 'Loop', outputIndex: 1 },
		{ from: 'Loop', to: 'Destination', outputIndex: 0 },
	];
	assert.deepEqual(
		compareFindStartNodes(
			nodes,
			connections,
			'Trigger',
			'Destination',
			{ Trigger: [task()], Loop: [task([[], [item('looping')]])] },
			{},
		),
		['Loop'],
	);
	assert.deepEqual(
		compareFindStartNodes(
			nodes,
			connections,
			'Trigger',
			'Destination',
			{ Trigger: [task()], Loop: [task([[item('done')], [item('looping')]])] },
			{},
		),
		['Destination'],
	);
});

test('PORT recreateNodeExecutionStack matches root, complete run-data and pinned inputs', { timeout: 60000, skip: skipReason }, () => {
	assert.deepEqual(compareRecreate(['Trigger'], [], ['Trigger'], {}, {}), {
		nodeExecutionStack: [
			{ node: 'Trigger', data: { main: [[{ json: {} }]] }, source: null },
		],
		waitingExecution: {},
		waitingExecutionSource: {},
	});

	const result = compareRecreate(
		['A', 'B', 'Destination'],
		[
			{ from: 'A', to: 'Destination', inputIndex: 0 },
			{ from: 'B', to: 'Destination', inputIndex: 1 },
		],
		['Destination'],
		{ A: [task([[]]), task([[item('A-run-1')]])] },
		{ B: [item('B-pinned')] },
	);
	assert.deepEqual(result.nodeExecutionStack[0].source, {
		main: [
			{ previousNode: 'A', previousNodeOutput: 0, previousNodeRun: 1 },
			{ previousNode: 'B', previousNodeOutput: 0, previousNodeRun: 0 },
		],
	});
});

test('PORT recreateNodeExecutionStack matches incomplete waiting and repeated-input groups', { timeout: 60000, skip: skipReason }, () => {
	const waiting = compareRecreate(
		['A', 'B', 'Destination'],
		[
			{ from: 'A', to: 'Destination', inputIndex: 0 },
			{ from: 'B', to: 'Destination', inputIndex: 1 },
		],
		['Destination'],
		{ A: [task([[item('A')]])] },
		{},
	);
	assert.deepEqual(waiting.nodeExecutionStack, []);
	assert.deepEqual(waiting.waitingExecution, {
		Destination: { 0: { main: [[item('A')]] } },
	});

	const repeated = compareRecreate(
		['A', 'B', 'C', 'Destination'],
		[
			{ from: 'B', to: 'Destination', inputIndex: 0 },
			{ from: 'A', to: 'Destination', inputIndex: 0 },
			{ from: 'C', to: 'Destination', inputIndex: 1 },
		],
		['Destination'],
		{ A: [task([[item('A')]])], B: [task([[item('B')]])], C: [task([[item('C')]])] },
		{},
	);
	assert.equal(repeated.nodeExecutionStack.length, 2);
	assert.deepEqual(
		repeated.nodeExecutionStack.map((entry) => entry.source.main.map((source) => source.previousNode)),
		[['A', 'C'], ['B']],
	);
});

test('PORT recreateNodeExecutionStack matches the strict disabled-node invariant', { timeout: 60000, skip: skipReason }, () => {
	for (const disabled of [true, 1]) {
		const mine = build(MineDirectedGraph, [{ name: 'Node', disabled }]);
		const real = build(RealDirectedGraph, [{ name: 'Node', disabled }]);
		const callMine = () => mineRecreateNodeExecutionStack(mine.graph, new Set([mine.byName.Node]), {}, {});
		const callReal = () => realRecreateNodeExecutionStack(real.graph, new Set([real.byName.Node]), {}, {});

		if (disabled === true) {
			assert.throws(callMine, (mineError) => {
				assert.throws(callReal, (realError) => {
					assert.equal(mineError.name, realError.name);
					assert.equal(mineError.message, realError.message);
					return true;
				});
				return true;
			});
		} else {
			assert.doesNotThrow(callMine);
			assert.doesNotThrow(callReal);
		}
	}
});

test('PORT rewireGraph matches executor construction, incoming filtering and no-child identity', { timeout: 60000, skip: skipReason }, () => {
	const definitions = [
		'Trigger',
		'OtherUtility',
		{ name: 'Tool', type: 'n8n-nodes-base.ai-tool' },
		{ name: 'Root', type: 'n8n-nodes-base.ai-agent' },
	];
	const connections = [
		{ from: 'Trigger', to: 'Root' },
		{ from: 'OtherUtility', to: 'Root', type: 'ai_languageModel' },
		{ from: 'Tool', to: 'Root', type: AI_TOOL },
	];
	const request = { query: { city: 'Surabaya' }, tool: { name: 'weather' } };
	const mine = build(MineDirectedGraph, definitions, connections);
	const real = build(RealDirectedGraph, definitions, connections);
	const mineResult = mineRewireGraph(mine.byName.Tool, mine.graph, request);
	const realResult = realRewireGraph(real.byName.Tool, real.graph, request);
	assert.deepEqual(normalizeGraph(mineResult), normalizeGraph(realResult));
	assert.equal(mine.byName.Tool.rewireOutputLogTo, real.byName.Tool.rewireOutputLogTo);
	assert.equal(mineResult.hasNode('Root'), false);
	assert.equal(mineResult.hasNode('PartialExecutionToolExecutor'), true);

	const mineNoChild = build(MineDirectedGraph, [{ name: 'Tool', type: 'n8n-nodes-base.ai-tool' }]);
	const realNoChild = build(RealDirectedGraph, [{ name: 'Tool', type: 'n8n-nodes-base.ai-tool' }]);
	assert.equal(mineRewireGraph(mineNoChild.byName.Tool, mineNoChild.graph), mineNoChild.graph);
	assert.equal(realRewireGraph(realNoChild.byName.Tool, realNoChild.graph), realNoChild.graph);
});

test('PORT rewireGraph matches deeply nested AI-tool traversal', { timeout: 60000, skip: skipReason }, () => {
	const definitions = [
		'Trigger',
		{ name: 'TopAgent', type: 'n8n-nodes-base.ai-agent' },
		{ name: 'AgentTool', type: 'n8n-nodes-base.ai-agent-tool' },
		{ name: 'LeafTool', type: 'n8n-nodes-base.ai-tool' },
	];
	const connections = [
		{ from: 'Trigger', to: 'TopAgent' },
		{ from: 'AgentTool', to: 'TopAgent', type: AI_TOOL },
		{ from: 'LeafTool', to: 'AgentTool', type: AI_TOOL },
	];
	const mine = build(MineDirectedGraph, definitions, connections);
	const real = build(RealDirectedGraph, definitions, connections);
	const mineResult = mineRewireGraph(mine.byName.LeafTool, mine.graph);
	const realResult = realRewireGraph(real.byName.LeafTool, real.graph);
	assert.deepEqual(normalizeGraph(mineResult), normalizeGraph(realResult));
	assert.equal(mineResult.hasNode('TopAgent'), false);
	assert.equal(mineResult.hasNode('LeafTool'), true);
});
