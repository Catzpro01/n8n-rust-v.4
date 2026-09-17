/**
 * POOL-002 — node execution context + workflow data proxy.
 * Pinned to reference/n8n/packages/core/src/execution-engine/node-execution-context/*
 * and reference/n8n/packages/workflow/src/workflow-data-proxy.ts (2.9.4).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	ApplicationError,
	ExecuteContext,
	WorkflowDataProxy,
	constructExecutionMetaData,
	copyInputItems,
	createRunExecutionData,
	normalizeItems,
	returnJsonArray,
} from '../src/index.mjs';
import { createWorkflow, executeWorkflow, node, typeDefinition } from './helpers.mjs';

const MANUAL_TRIGGER = 'n8n-nodes-base.manualTrigger';
const PROBE = 'n8n-nodes-base.probe';

/** Everything the Probe node observed through its execution context. */
const observed = {};

function probeNode() {
	return typeDefinition(PROBE, {
		execute: async function () {
			const context = this;
			observed.items = context.getInputData(0);
			observed.secondInputMissing = context.getInputData(0, 'ai_languageModel');
			observed.source = context.getInputSourceData(0);
			observed.ownNode = context.getNode().name;
			observed.workflowName = context.getWorkflow().name;
			observed.mode = context.getMode();
			observed.runIndex = context.getRunIndex();

			observed.literal = context.getNodeParameter('literal');
			observed.template = context.getNodeParameter('greeting');
			observed.numeric = context.getNodeParameter('sum');
			observed.nodeRef = context.getNodeParameter('ref');
			observed.itemsRef = context.getNodeParameter('firstItem');
			observed.inputCount = context.getNodeParameter('inputCount');
			observed.prevNode = context.getNodeParameter('prev');
			observed.executionMode = context.getNodeParameter('executionMode');
			observed.workflowRef = context.getNodeParameter('workflowRef');
			observed.env = context.getNodeParameter('env');
			observed.nowIso = context.getNodeParameter('nowIso');
			observed.today = context.getNodeParameter('today');
			observed.itemIndex = context.getNodeParameter('itemIndex');
			observed.binaryKeys = context.getNodeParameter('binaryKeys');
			observed.nested = context.getNodeParameter('values.string');
			observed.perItem = context.getNodeParameter('perItem', 1);
			observed.fallback = context.getNodeParameter('missing', 0, 'fallback-value');

			try {
				context.getNodeParameter('missing');
			} catch (error) {
				observed.missingThrows = `${error.name}: ${error.message}`;
			}

			try {
				context.getInputData(5);
			} catch (error) {
				observed.outOfRangeThrows = `${error.name}: ${error.message}`;
			}

			try {
				context.getCredentials();
			} catch (error) {
				observed.credentialsThrows = `${error.name}: ${error.message}`;
			}

			observed.helpers = {
				returnJsonArray: returnJsonArray([{ a: 1 }, { json: { b: 2 } }]),
				normalizeItems: normalizeItems([{ a: 1 }]),
				metaData: constructExecutionMetaData([{ json: { a: 1 } }], { itemData: { item: 3 } }),
				copied: copyInputItems([{ json: { keep: { deep: 1 }, drop: 2 } }], ['keep']),
			};

			return [context.getInputData()];
		},
	});
}

function buildProbeWorkflow() {
	return createWorkflow({
		nodes: [
			node('Manual Trigger', MANUAL_TRIGGER),
			node('Probe', PROBE, {
				literal: 'plain-value',
				greeting: '=Hello {{ $json.first }} {{ $json.last }}',
				sum: '={{ $json.a + $json.b }}',
				ref: '={{ $node["Manual Trigger"].json.first }}',
				firstItem: '={{ $items("Manual Trigger")[0].json.last }}',
				inputCount: '={{ $input.all().length }}',
				prev: '={{ $prevNode.name }}',
				executionMode: '={{ $execution.mode }}',
				workflowRef: '={{ $workflow.name }}',
				env: '={{ $env.FLAG }}',
				nowIso: '={{ $now.toISO() }}',
				today: '={{ $today.toFormat("yyyy-MM-dd") }}',
				itemIndex: '={{ $itemIndex }}',
				binaryKeys: '={{ Object.keys($binary).length }}',
				values: { string: [{ name: '={{ $json.first }}', value: 123 }] },
				perItem: '={{ $json.n }}',
			}),
		],
		connections: { 'Manual Trigger': { main: [[{ node: 'Probe', type: 'main', index: 0 }]] } },
		nodeTypes: {
			[MANUAL_TRIGGER]: typeDefinition(MANUAL_TRIGGER, {
				group: ['trigger'],
				execute: async () => [
					[
						{ json: { first: 'Ada', last: 'Lovelace', a: 2, b: 3, n: 10 } },
						{ json: { first: 'Grace', last: 'Hopper', a: 4, b: 5, n: 20 } },
					],
				],
			}),
			[PROBE]: probeNode(),
		},
	});
}

test('execution context exposes input data, source data and node identity', async () => {
	await executeWorkflow(buildProbeWorkflow(), { engineOptions: { additionalData: { env: { FLAG: 'on' } } } });

	assert.equal(observed.items.length, 2);
	assert.deepEqual(observed.secondInputMissing, [], 'unwired connection type returns []');
	assert.deepEqual(observed.source, { previousNode: 'Manual Trigger', previousNodeOutput: 0, previousNodeRun: 0 });
	assert.equal(observed.ownNode, 'Probe');
	assert.equal(observed.workflowName, 'Fixture Workflow');
	assert.equal(observed.mode, 'manual');
	assert.equal(observed.runIndex, 0);
});

test('node parameters resolve literals, templates and typed expressions', async () => {
	await executeWorkflow(buildProbeWorkflow(), { engineOptions: { additionalData: { env: { FLAG: 'on' } } } });

	assert.equal(observed.literal, 'plain-value', 'a parameter without "=" stays a literal');
	assert.equal(observed.template, 'Hello Ada Lovelace', 'mixed text + {{ }} is interpolated');
	assert.equal(observed.numeric, 5, 'a single {{ }} keeps the evaluated type');
	assert.equal(typeof observed.numeric, 'number');
});

test('data proxy variables resolve against the execution data', async () => {
	await executeWorkflow(buildProbeWorkflow(), { engineOptions: { additionalData: { env: { FLAG: 'on' } } } });

	assert.equal(observed.nodeRef, 'Ada');
	assert.equal(observed.itemsRef, 'Lovelace');
	assert.equal(observed.inputCount, 2);
	assert.equal(observed.prevNode, 'Manual Trigger');
	assert.equal(observed.executionMode, 'manual');
	assert.equal(observed.workflowRef, 'Fixture Workflow');
	assert.equal(observed.env, 'on');
	assert.match(observed.nowIso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
	assert.match(observed.today, /^\d{4}-\d{2}-\d{2}$/);
	assert.equal(observed.itemIndex, 0);
	assert.equal(observed.binaryKeys, 0);
	assert.deepEqual(observed.nested, [{ name: 'Ada', value: 123 }], 'nested parameters are resolved');
	assert.equal(observed.perItem, 20, 'getNodeParameter(name, itemIndex) resolves per item');
});

test('context errors and fallbacks match the reference behaviour', async () => {
	await executeWorkflow(buildProbeWorkflow(), { engineOptions: { additionalData: { env: { FLAG: 'on' } } } });

	assert.equal(observed.fallback, 'fallback-value');
	assert.match(observed.missingThrows, /^ApplicationError: Could not get parameter "missing"$/);
	assert.match(observed.outOfRangeThrows, /^ApplicationError: Could not get input with given index$/);
	assert.match(observed.credentialsThrows, /^ApplicationError: getCredentials\(\) is not part of the reconstructed execution engine/);
});

test('helpers reproduce returnJsonArray / normalizeItems / metadata / copyInputItems', async () => {
	await executeWorkflow(buildProbeWorkflow(), { engineOptions: { additionalData: { env: { FLAG: 'on' } } } });

	assert.deepEqual(observed.helpers.returnJsonArray, [{ json: { a: 1 } }, { json: { b: 2 } }]);
	assert.deepEqual(observed.helpers.normalizeItems, [{ json: { a: 1 } }]);
	assert.deepEqual(observed.helpers.metaData, [{ json: { a: 1 }, pairedItem: { item: 3 } }]);
	assert.deepEqual(observed.helpers.copied, [{ keep: { deep: 1 } }]);

	assert.deepEqual(normalizeItems([]), []);
	assert.throws(() => normalizeItems([{ json: { a: 1 } }, { a: 2 }]), /Inconsistent item format/);

	// copyInputItems deep-copies: mutating the source must not leak into the copy
	const source = [{ json: { keep: { deep: 1 } } }];
	const copied = copyInputItems(source, ['keep']);
	source[0].json.keep.deep = 99;
	assert.deepEqual(copied, [{ keep: { deep: 1 } }]);

	// constructExecutionMetaData keeps extra item fields
	assert.deepEqual(constructExecutionMetaData([{ json: {}, binary: { f: {} } }], { itemData: { item: 1 } }), [
		{ json: {}, pairedItem: { item: 1 }, binary: { f: {} } },
	]);
});

test('data proxy resolves $json, $binary, $items, $node and $getPairedItem directly', async () => {
	const runExecutionData = createRunExecutionData({
		resultData: {
			runData: {
				Producer: [
					{
						startTime: 0,
						executionIndex: 0,
						executionTime: 0,
						source: [],
						executionStatus: 'success',
						data: { main: [[{ json: { id: 7 }, binary: { file: { data: 'x' } } }]] },
					},
				],
			},
		},
	});

	const workflow = createWorkflow({
		nodes: [node('Producer', PROBE), node('Consumer', PROBE)],
		connections: { Producer: { main: [[{ node: 'Consumer', type: 'main', index: 0 }]] } },
	});

	const proxy = new WorkflowDataProxy({
		workflow,
		runExecutionData,
		runIndex: 0,
		itemIndex: 0,
		activeNodeName: 'Consumer',
		connectionInputData: [{ json: { local: true }, pairedItem: { item: 0 } }],
		executionData: { data: { main: [[{ json: { local: true }, pairedItem: { item: 0 } }]] }, source: { main: [{ previousNode: 'Producer', previousNodeOutput: 0, previousNodeRun: 0 }] } },
		mode: 'manual',
		additionalData: { env: { A: '1' } },
	}).proxy;

	assert.deepEqual(proxy.$json, { local: true });
	assert.deepEqual(proxy.$binary, {});
	assert.equal(proxy.$itemIndex, 0);
	assert.equal(proxy.$node.Producer.json.id, 7);
	assert.deepEqual(proxy.$node.Producer.binary, { file: { data: 'x' } });
	assert.equal(proxy.$node.Producer.all().length, 1);
	assert.equal(proxy.$items('Producer')[0].json.id, 7);
	assert.equal(proxy.$input.item.json.local, true);
	assert.equal(proxy.$prevNode.name, 'Producer');
	assert.equal(proxy.$env.A, '1');
	assert.deepEqual(proxy.$getPairedItem('Producer', { previousNode: 'Producer' }, { item: 0 }), {
		json: { id: 7 },
		binary: { file: { data: 'x' } },
	});

	assert.throws(() => proxy.$items('Nope'), ApplicationError);
	assert.throws(() => proxy.$node.Nope.json, ApplicationError);
});

test('ExecuteContext can be constructed standalone (no engine) with run data it does not own', () => {
	const workflow = createWorkflow({ nodes: [node('Solo', PROBE)], connections: {} });
	const runExecutionData = createRunExecutionData();

	const context = new ExecuteContext({
		workflow,
		node: workflow.getNode('Solo'),
		runExecutionData,
		inputData: { main: [[{ json: { only: 1 } }]] },
		connectionInputData: [{ json: { only: 1 } }],
	});

	assert.equal(context.getInputData()[0].json.only, 1);
	assert.equal(context.getWorkflowDataProxy(0).proxy.$json.only, 1);
	assert.equal(context.getWorkflowStaticData('global'), context.getWorkflowStaticData('global'));
	assert.deepEqual(context.getWorkflowDataProxy(0).proxy.$input.params, {});
});
