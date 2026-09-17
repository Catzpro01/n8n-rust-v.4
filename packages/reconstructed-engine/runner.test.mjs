import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkflowExecutionEngine } from './runner.mjs';

const linearWorkflow = {
  id: 'wf-1', name: 'context test', active: false,
  nodes: [
    { id: 'start', name: 'Start', type: 'trigger', typeVersion: 1, parameters: {} },
    { id: 'set', name: 'Set', type: 'set', typeVersion: 1, parameters: { value: '={{ $json.value + 1 }}', label: '=v={{ $json.value }}' } },
    { id: 'end', name: 'End', type: 'end', typeVersion: 1, parameters: {} },
  ],
  connections: {
    Start: { main: [[{ node: 'Set', type: 'main', index: 0 }]] },
    Set: { main: [[{ node: 'End', type: 'main', index: 0 }]] },
  },
};

test('passes n8n-shaped items through a linear workflow and records run data', async () => {
  const engine = new WorkflowExecutionEngine(linearWorkflow);
  engine.registerNodeType('trigger', async () => [{ json: { value: 4 } }]);
  engine.registerNodeType('set', async (_node, items, context) => items.map((_item, index) => ({
    json: {
      value: context.getNodeParameter('value', index),
      label: context.getNodeParameter('label', index),
      previous: context.getWorkflowDataProxy(index).$prevNode.name,
    },
  })));

  const result = await engine.runWorkflow();
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(result.data.End[0].json, { value: 5, label: 'v=4', previous: 'Start' });
  assert.equal(result.runData.Set[0].source[0].previousNode, 'Start');
  assert.deepEqual(result.data.Set[0].pairedItem, { item: 0 });
});

test('exposes $input, $node, and $(name) data proxies', async () => {
  const engine = new WorkflowExecutionEngine(linearWorkflow);
  engine.registerNodeType('trigger', async () => [{ json: { value: 2 } }, { json: { value: 8 } }]);
  engine.registerNodeType('set', async (_node, items, context) => items.map((_item, index) => {
    const proxy = context.getWorkflowDataProxy(index);
    return { json: {
      current: proxy.$json.value,
      count: proxy.$input.all().length,
      first: proxy.$('Start').first().json.value,
      positional: proxy.$node.Start.json.value,
      executed: proxy.$('Start').isExecuted,
    } };
  }));

  const result = await engine.runWorkflow();
  assert.deepEqual(result.data.Set.map((item) => item.json), [
    { current: 2, count: 2, first: 2, positional: 2, executed: true },
    { current: 8, count: 2, first: 2, positional: 8, executed: true },
  ]);
});

test('routes each output branch only to its connected node', async () => {
  const workflow = structuredClone(linearWorkflow);
  workflow.nodes.splice(2, 0, { id: 'other', name: 'Other', type: 'end', parameters: {} });
  workflow.connections.Set.main.push([{ node: 'Other', type: 'main', index: 0 }]);
  const engine = new WorkflowExecutionEngine(workflow);
  engine.registerNodeType('trigger', async () => [{ json: { value: 1 } }]);
  engine.registerNodeType('set', async () => [[{ json: { branch: 0 } }], [{ json: { branch: 1 } }]]);

  const result = await engine.runWorkflow();
  assert.equal(result.data.End[0].json.branch, 0);
  assert.equal(result.data.Other[0].json.branch, 1);
});

test('captures node errors and blocks unsafe expression globals', async () => {
  const workflow = structuredClone(linearWorkflow);
  workflow.nodes[1].parameters.value = '={{ process.env.SECRET }}';
  const engine = new WorkflowExecutionEngine(workflow);
  engine.registerNodeType('set', async (_node, _items, context) => [{ json: { value: context.getNodeParameter('value') } }]);

  const result = await engine.runWorkflow('Set', [{ value: 1 }]);
  assert.equal(result.status, 'ERROR');
  assert.equal(result.error.name, 'ExpressionError');
  assert.match(result.error.message, /forbidden/);
});

test('stops cyclic workflows at a configurable execution limit', async () => {
  const workflow = {
    nodes: [{ name: 'A', type: 'pass' }, { name: 'B', type: 'pass' }],
    connections: {
      A: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
      B: { main: [[{ node: 'A', type: 'main', index: 0 }]] },
    },
  };
  const engine = new WorkflowExecutionEngine(workflow);
  await assert.rejects(() => engine.runWorkflow('A', [{}], { maxExecutions: 3 }), /Execution limit of 3 reached/);
});

test('passes input through a disabled node instead of starving its children', async () => {
  // handleDisabledNode (workflow-execute.ts L909-920, called from runNode L1199):
  // a disabled node returns its first main input as-is, so it still produces a
  // successful task and its children keep running.
  const workflow = structuredClone(linearWorkflow);
  workflow.nodes[1].disabled = true;
  const engine = new WorkflowExecutionEngine(workflow);
  let setCalls = 0;
  engine.registerNodeType('trigger', async () => [{ json: { value: 4 } }]);
  engine.registerNodeType('set', async () => { setCalls++; return [{ json: { value: -1 } }]; });

  const result = await engine.runWorkflow();
  assert.equal(result.status, 'COMPLETED');
  assert.equal(setCalls, 0); // the handler never runs
  assert.equal(result.runData.Set[0].executionStatus, 'success');
  assert.equal(result.runData.Set[0].source[0].previousNode, 'Start');
  assert.deepEqual(result.data.Set[0].json, { value: 4 }); // input passed through untouched
  assert.deepEqual(result.data.End[0].json, { value: 4 }); // downstream still ran
  assert.equal(result.data.Set[0].pairedItem.item, 0);
});
