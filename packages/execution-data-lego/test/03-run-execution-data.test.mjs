import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEmptyRunExecutionData,
	createErrorExecutionData,
	createRunExecutionData,
	migrateRunExecutionData,
	runExecutionDataV0ToV1,
} from '../src/run-execution-data.mjs';

test('createRunExecutionData fills every default and keeps the upstream key order', () => {
	const data = createRunExecutionData();
	assert.deepEqual(Object.keys(data), [
		'version',
		'startData',
		'resultData',
		'executionData',
		'parentExecution',
		'validateSignature',
		'waitTill',
		'manualData',
		'pushRef',
	]);
	assert.equal(data.version, 1);
	assert.deepEqual(data.startData, {});
	assert.deepEqual(data.resultData.runData, {});
	assert.deepEqual(data.executionData, {
		contextData: {},
		nodeExecutionStack: [],
		metadata: {},
		waitingExecution: {},
		waitingExecutionSource: {},
		runtimeData: undefined,
	});
	// R-02: written unconditionally -> present as explicit `undefined` keys
	assert.deepEqual(Object.keys(data.resultData), [
		'error',
		'runData',
		'pinData',
		'lastNodeExecuted',
		'metadata',
	]);
});

test('R-01: opt-out is via explicit null, not undefined', () => {
	const withNulls = createRunExecutionData({ resultData: { runData: null }, executionData: null });
	assert.equal(withNulls.resultData.runData, undefined);
	assert.equal(withNulls.executionData, undefined);

	const omitted = createRunExecutionData({ resultData: {}, executionData: {} });
	assert.deepEqual(omitted.resultData.runData, {});
	assert.ok(omitted.executionData);
});

test('createRunExecutionData carries the supplied fields through', () => {
	const data = createRunExecutionData({
		startData: { runNodeFilter: ['A'] },
		resultData: { lastNodeExecuted: 'A', runData: { A: [] } },
		waitTill: new Date(0),
		pushRef: 'ref',
		parentExecution: { executionId: '1', workflowId: '2' },
	});
	assert.deepEqual(data.startData, { runNodeFilter: ['A'] });
	assert.equal(data.resultData.lastNodeExecuted, 'A');
	assert.equal(data.pushRef, 'ref');
	assert.deepEqual(data.parentExecution, { executionId: '1', workflowId: '2' });
});

test('createEmptyRunExecutionData is the only factory without startData/executionData', () => {
	const data = createEmptyRunExecutionData();
	assert.deepEqual(data, { version: 1, resultData: { runData: {} } });
	assert.deepEqual(Object.keys(data), ['version', 'resultData']);
});

test('R-04..R-06: createErrorExecutionData synthesises a single failing task', () => {
	const node = { name: 'Boom', type: 'ref.boom', typeVersion: 1, parameters: {} };
	const error = { message: 'nope', name: 'NodeOperationError' };
	const data = createErrorExecutionData(node, error);

	assert.deepEqual(data.startData, {
		destinationNode: { nodeName: 'Boom', mode: 'inclusive' },
		runNodeFilter: ['Boom'],
	});
	assert.deepEqual(data.executionData.nodeExecutionStack, [
		{ node, data: { main: [[{ json: {}, pairedItem: { item: 0 } }]] }, source: null },
	]);
	assert.deepEqual(data.executionData.waitingExecution, {});
	assert.deepEqual(data.executionData.waitingExecutionSource, {}, 'R-03 also holds here');
	assert.deepEqual(data.resultData.runData.Boom, [
		{ startTime: 0, executionIndex: 0, executionTime: 0, error, source: [] },
	]);
	assert.equal(data.resultData.error, error);
	assert.equal(data.resultData.lastNodeExecuted, 'Boom');
});

test('R-07/R-08: v0 -> v1 lifts destination node strings into structured objects', () => {
	const lifted = runExecutionDataV0ToV1({
		version: 0,
		startData: { destinationNode: 'A', originalDestinationNode: 'B' },
		resultData: { runData: {} },
	});
	assert.deepEqual(lifted, {
		version: 1,
		startData: {
			destinationNode: { nodeName: 'A', mode: 'inclusive' },
			originalDestinationNode: { nodeName: 'B', mode: 'inclusive' },
		},
		resultData: { runData: {} },
	});
});

test('R-07: the lift always creates startData, even from a record without one', () => {
	const lifted = runExecutionDataV0ToV1({ resultData: { runData: {} } });
	assert.deepEqual(Object.keys(lifted.startData), ['destinationNode', 'originalDestinationNode']);
	assert.equal(lifted.startData.destinationNode, undefined);
	assert.equal(lifted.startData.originalDestinationNode, undefined);
});

test('R-09/R-10: migrateRunExecutionData accepts 0/undefined/1 and rejects the rest', () => {
	const v0 = { startData: { destinationNode: 'A' }, resultData: { runData: {} } };
	assert.deepEqual(migrateRunExecutionData(v0), runExecutionDataV0ToV1(v0));

	const noVersion = { resultData: { runData: {} } };
	assert.equal(migrateRunExecutionData(noVersion).version, 1, 'missing version means version 0');

	const v1 = { version: 1, resultData: { runData: {} } };
	assert.equal(migrateRunExecutionData(v1), v1, 'v1 is returned by reference');

	assert.throws(
		() => migrateRunExecutionData({ version: 2, resultData: { runData: {} } }),
		(err) =>
			err instanceof Error && err.message === 'Unsupported IRunExecutionData version: 2',
	);
	assert.throws(
		() => migrateRunExecutionData({ version: 99, resultData: { runData: {} } }),
		/Unsupported IRunExecutionData version: 99/,
	);
});
