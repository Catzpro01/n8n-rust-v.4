import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WorkflowExecutionEngine,
  WorkflowValidationError,
} from './runner.mjs';

const node = (name, type = name, extra = {}) => ({
  name,
  type,
  parameters: {},
  ...extra,
});

const connection = (source, outputIndex, target, inputIndex = 0) => ({
  [source]: {
    main: [
      ...Array.from({ length: outputIndex }, () => []),
      [{ node: target, type: 'main', index: inputIndex }],
    ],
  },
});

const mergeConnections = (...entries) => {
  const result = {};
  for (const entry of entries) {
    for (const [source, byType] of Object.entries(entry)) {
      result[source] ??= {};
      for (const [type, slots] of Object.entries(byType)) {
        result[source][type] ??= [];
        slots.forEach((slot, index) => {
          result[source][type][index] ??= [];
          result[source][type][index].push(...(slot ?? []));
        });
      }
    }
  }
  return result;
};

test('routes each main output to its matching branch', async () => {
  const engine = new WorkflowExecutionEngine({
    nodes: [node('Start', 'manualTrigger'), node('Split'), node('Left'), node('Right')],
    connections: mergeConnections(
      connection('Start', 0, 'Split'),
      {
        Split: {
          main: [
            [{ node: 'Left', type: 'main', index: 0 }],
            [{ node: 'Right', type: 'main', index: 0 }],
          ],
        },
      },
    ),
  });

  engine
    .registerNodeType('manualTrigger', () => [{ json: { started: true } }])
    .registerNodeType('Split', () => [
      [{ json: { selected: 'left' } }],
      [{ json: { selected: 'right' } }],
    ])
    .registerNodeType('Left', (_node, items) => items.map((item) => ({ json: { ...item.json, handled: 'left' } })))
    .registerNodeType('Right', (_node, items) => items.map((item) => ({ json: { ...item.json, handled: 'right' } })));

  const result = await engine.runWorkflow();

  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(result.data.Left.map((item) => item.json), [{ selected: 'left', handled: 'left' }]);
  assert.deepEqual(result.data.Right.map((item) => item.json), [{ selected: 'right', handled: 'right' }]);
  assert.equal(result.executionLog.find((entry) => entry.node === 'Left').inputCount, 1);
  assert.equal(result.executionLog.find((entry) => entry.node === 'Right').inputCount, 1);
});

test('waits for all main inputs before executing a fan-in node', async () => {
  const engine = new WorkflowExecutionEngine({
    nodes: [node('Start', 'manualTrigger'), node('A'), node('B'), node('Join')],
    connections: {
      Start: {
        main: [[
          { node: 'A', type: 'main', index: 0 },
          { node: 'B', type: 'main', index: 0 },
        ]],
      },
      A: { main: [[{ node: 'Join', type: 'main', index: 0 }]] },
      B: { main: [[{ node: 'Join', type: 'main', index: 1 }]] },
    },
  });

  engine
    .registerNodeType('manualTrigger', () => [{ json: { value: 'seed' } }])
    .registerNodeType('A', (_node, items) => items.map((item) => ({ json: { from: 'A', value: item.json.value } })))
    .registerNodeType('B', (_node, items) => items.map((item) => ({ json: { from: 'B', value: item.json.value } })))
    .registerNodeType('Join', (_node, _items, context) => [{
      json: {
        left: context.getInputData(0)[0].json.from,
        right: context.getInputData(1)[0].json.from,
      },
    }]);

  const result = await engine.runWorkflow();

  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(result.data.Join[0].json, { left: 'A', right: 'B' });
  assert.equal(result.runData.Join.length, 1);
  assert.deepEqual(result.runData.Join[0].source, [
    { previousNode: 'A', previousNodeOutput: 0, previousNodeRun: 0 },
    { previousNode: 'B', previousNodeOutput: 0, previousNodeRun: 0 },
  ]);
});

test('does not execute downstream nodes when an upstream output is empty', async () => {
  let downstreamRuns = 0;
  const engine = new WorkflowExecutionEngine({
    nodes: [node('Start', 'manualTrigger'), node('Empty'), node('Downstream')],
    connections: {
      Start: { main: [[{ node: 'Empty', type: 'main', index: 0 }]] },
      Empty: { main: [[{ node: 'Downstream', type: 'main', index: 0 }]] },
    },
  });

  engine
    .registerNodeType('manualTrigger', () => [{ json: {} }])
    .registerNodeType('Empty', () => [])
    .registerNodeType('Downstream', () => {
      downstreamRuns += 1;
      return [{ json: { unexpected: true } }];
    });

  const result = await engine.runWorkflow();

  assert.equal(result.status, 'COMPLETED');
  assert.equal(downstreamRuns, 0);
  assert.equal(result.runData.Downstream, undefined);
});

test('retries a failing node using n8n retry bounds and exposes the data context', async () => {
  let attempts = 0;
  const engine = new WorkflowExecutionEngine({
    nodes: [
      node('Start', 'manualTrigger'),
      node('Retry', 'retrying', { retryOnFail: true, maxTries: 3, waitBetweenTries: 0, parameters: {
        value: '={{ $json.input }}',
      } }),
    ],
    connections: {
      Start: { main: [[{ node: 'Retry', type: 'main', index: 0 }]] },
    },
  });

  engine
    .registerNodeType('manualTrigger', () => [{ json: { input: 'from-start' } }])
    .registerNodeType('retrying', (_node, _items, context) => {
      attempts += 1;
      if (attempts < 2) throw new Error('transient failure');
      return [{ json: {
        parameter: context.getNodeParameter('value'),
        input: context.getWorkflowDataProxy().$json.input,
        prior: context.getWorkflowDataProxy().resolve("={{ $('Start').first().json.input }}"),
      } }];
    });

  const result = await engine.runWorkflow();

  assert.equal(result.status, 'COMPLETED');
  assert.equal(attempts, 2);
  assert.equal(result.data.Retry[0].json.parameter, 'from-start');
  assert.equal(result.data.Retry[0].json.input, 'from-start');
  assert.equal(result.data.Retry[0].json.prior, 'from-start');
  assert.equal(result.executionLog.find((entry) => entry.node === 'Retry').attempts, 2);
});

test('supports continueErrorOutput without marking the workflow as failed', async () => {
  const engine = new WorkflowExecutionEngine({
    nodes: [
      node('Start', 'manualTrigger'),
      node('Recoverable', 'recoverable', { onError: 'continueErrorOutput' }),
      node('ErrorSink'),
    ],
    connections: {
      Start: { main: [[{ node: 'Recoverable', type: 'main', index: 0 }]] },
      Recoverable: {
        main: [
          [],
          [{ node: 'ErrorSink', type: 'main', index: 0 }],
        ],
      },
    },
  });

  engine
    .registerNodeType('manualTrigger', () => [{ json: { id: 7 } }])
    .registerNodeType('recoverable', () => { throw new Error('expected failure'); })
    .registerNodeType('ErrorSink', (_node, items) => items);

  const result = await engine.runWorkflow();

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.executionLog.find((entry) => entry.node === 'Recoverable').continued, true);
  assert.equal(result.data.ErrorSink[0].json.error, 'expected failure');
});

test('stopWorkflow returns an error result and does not run downstream work', async () => {
  let downstreamRuns = 0;
  const engine = new WorkflowExecutionEngine({
    nodes: [node('Start', 'manualTrigger'), node('Fail'), node('Never')],
    connections: {
      Start: { main: [[{ node: 'Fail', type: 'main', index: 0 }]] },
      Fail: { main: [[{ node: 'Never', type: 'main', index: 0 }]] },
    },
  });

  engine
    .registerNodeType('manualTrigger', () => [{ json: {} }])
    .registerNodeType('Fail', () => { throw new Error('fatal failure'); })
    .registerNodeType('Never', () => {
      downstreamRuns += 1;
      return [{ json: {} }];
    });

  const result = await engine.runWorkflow();

  assert.equal(result.status, 'ERROR');
  assert.equal(result.finished, false);
  assert.equal(result.error.message, 'fatal failure');
  assert.equal(downstreamRuns, 0);
});

test('alwaysOutputData emits an empty item for a node with no output', async () => {
  const engine = new WorkflowExecutionEngine({
    nodes: [node('Start', 'manualTrigger'), node('KeepAlive', 'empty', { alwaysOutputData: true }), node('End')],
    connections: {
      Start: { main: [[{ node: 'KeepAlive', type: 'main', index: 0 }]] },
      KeepAlive: { main: [[{ node: 'End', type: 'main', index: 0 }]] },
    },
  });

  engine
    .registerNodeType('manualTrigger', () => [{ json: { started: true } }])
    .registerNodeType('empty', () => [])
    .registerNodeType('End', (_node, items) => items);

  const result = await engine.runWorkflow();

  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(result.data.End[0].json, {});
  assert.deepEqual(result.data.End[0].pairedItem, { item: 0 });
});

test('guards cycles with maxNodeExecutions instead of hanging', async () => {
  const engine = new WorkflowExecutionEngine({
    nodes: [node('Loop', 'manualTrigger')],
    connections: {
      Loop: { main: [[{ node: 'Loop', type: 'main', index: 0 }]] },
    },
  }, { maxNodeExecutions: 3 });
  engine.registerNodeType('manualTrigger', (_node, items) => items);

  const result = await engine.runWorkflow();

  assert.equal(result.status, 'ERROR');
  assert.equal(result.error.code, 'MAX_NODE_EXECUTIONS');
  assert.equal(result.runData.Loop.length, 3);
});

test('skips disabled triggers when selecting a start node', async () => {
  const engine = new WorkflowExecutionEngine({
    nodes: [
      node('Disabled trigger', 'manualTrigger', { disabled: true }),
      node('Worker', 'worker'),
    ],
    connections: {
      'Disabled trigger': { main: [[{ node: 'Worker', type: 'main', index: 0 }]] },
    },
  });
  engine.registerNodeType('worker', (_node, items) => items.map((item) => ({
    json: { ...item.json, startedFrom: 'worker' },
  })));

  const result = await engine.runWorkflow();

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.data['Disabled trigger'], undefined);
  assert.equal(result.data.Worker[0].json.startedFrom, 'worker');
});

test('rejects duplicate nodes and dangling connections before execution', () => {
  assert.throws(
    () => new WorkflowExecutionEngine({ nodes: [node('A'), node('A')], connections: {} }),
    WorkflowValidationError,
  );
  assert.throws(
    () => new WorkflowExecutionEngine({
      nodes: [node('A')],
      connections: { A: { main: [[{ node: 'Missing', type: 'main', index: 0 }]] } },
    }),
    /Unknown connection target node: Missing/,
  );
});
