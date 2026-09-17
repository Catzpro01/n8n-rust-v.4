import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkflowExecutionEngine } from './runner.mjs';

// handleDisabledNode (n8n 2.9.4, workflow-execute.ts:909-920, via runNode:1199):
// a disabled node never touches its handler or the type registry and returns
// its received first-main input; the success tail (assign, R7, R6, task, route)
// applies uniformly. Strict `node.disabled === true`.
//
// Out of scope here (recorded, not implemented): start-node selection skipping
// disabled nodes (Workflow LEGO `getStartNode`, workflow.ts:839,853) and the
// no-input `{data:undefined}` → null branch-end (L1768-1776), unreachable in
// this engine's shape — queued nodes always carry >= 1 item.

const chain = (middleExtra = {}) => ({
  id: 'wf-disabled', name: 'disabled test', active: false,
  nodes: [
    { id: 't', name: 'Trigger', type: 'trigger', typeVersion: 1, parameters: {} },
    { id: 'm', name: 'Middle', type: 'set', typeVersion: 1, parameters: {}, ...middleExtra },
    { id: 'd', name: 'Sink', type: 'sink', typeVersion: 1, parameters: {} },
  ],
  connections: {
    Trigger: { main: [[{ node: 'Middle', type: 'main', index: 0 }]] },
    Middle: { main: [[{ node: 'Sink', type: 'main', index: 0 }]] },
  },
});

const baseHandlers = (engine, middleHandler) => {
  engine.registerNodeType('trigger', async () => [{ json: { v: 1 } }]);
  if (middleHandler) engine.registerNodeType('set', middleHandler);
  engine.registerNodeType('sink', async (_node, items) => items);
};

test('disabled mid-chain node passes received input through and downstream runs', async () => {
  const engine = new WorkflowExecutionEngine(chain({ disabled: true }));
  let handlerCalls = 0;
  baseHandlers(engine, async () => { handlerCalls++; return [{ json: { hacked: true } }]; });
  const result = await engine.runWorkflow();
  assert.equal(result.status, 'COMPLETED');
  assert.equal(handlerCalls, 0); // handler never consulted
  assert.deepEqual(result.data.Sink.map((item) => item.json), [{ v: 1 }]);
  const task = result.runData.Middle[0];
  assert.equal(task.executionStatus, 'success');
  assert.deepEqual(task.data.main[0].map((item) => item.json), [{ v: 1 }]);
  assert.equal(result.lastNodeExecuted, 'Sink');
});

test('disabled node with an unregistered type still passes through (no type lookup)', async () => {
  const workflow = chain({ disabled: true });
  workflow.nodes[1].type = 'never-registered';
  const engine = new WorkflowExecutionEngine(workflow);
  engine.registerNodeType('trigger', async () => [{ json: { v: 5 } }]);
  engine.registerNodeType('sink', async (_node, items) => items);
  const result = await engine.runWorkflow();
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(result.data.Sink.map((item) => item.json), [{ v: 5 }]);
});

test('disabled node ignores retry settings: single attempt, no waits', async () => {
  const engine = new WorkflowExecutionEngine(chain({ disabled: true, retryOnFail: true, maxTries: 5, waitBetweenTries: 50 }));
  const waits = [];
  baseHandlers(engine, async () => { throw new Error('must not run'); });
  const result = await engine.runWorkflow(null, [{}], { sleep: async (ms) => { waits.push(ms); } });
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(waits, []);
  assert.deepEqual(result.data.Sink.map((item) => item.json), [{ v: 1 }]);
});

test('disabled node with continueErrorOutput passes clean input on output 0', async () => {
  const workflow = chain({ disabled: true, onError: 'continueErrorOutput' });
  workflow.nodes.push({ id: 'e', name: 'ErrSink', type: 'sink', typeVersion: 1, parameters: {} });
  workflow.connections.Middle.main.push([{ node: 'ErrSink', type: 'main', index: 0 }]);
  const engine = new WorkflowExecutionEngine(workflow);
  baseHandlers(engine, async () => { throw new Error('must not run'); });
  const result = await engine.runWorkflow();
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(result.data.Sink.map((item) => item.json), [{ v: 1 }]); // R7: no signals, stays
  assert.equal(result.runData.ErrSink, undefined);
});

test('disabled check is strict: falsy and truthy-non-true values execute normally', async () => {
  for (const disabled of [false, undefined, null, 0, 'yes']) {
    const engine = new WorkflowExecutionEngine(chain({ disabled }));
    let calls = 0;
    baseHandlers(engine, async (node, items) => { calls++; return items; });
    const result = await engine.runWorkflow();
    assert.equal(calls, 1, `disabled=${JSON.stringify(disabled)} must execute the handler`);
    assert.equal(result.status, 'COMPLETED');
  }
});

test('passthrough preserves upstream paired items (received, not re-stamped)', async () => {
  // prepareInput would re-stamp these as {item:0},{item:1}; the reference passes
  // main[0] through untouched, so the arrival values must survive.
  const engine = new WorkflowExecutionEngine(chain({ disabled: true }));
  engine.registerNodeType('trigger', async () => [
    { json: { v: 1 }, pairedItem: { item: 5 } },
    { json: { v: 2 }, pairedItem: { item: 6 } },
  ]);
  engine.registerNodeType('sink', async (_node, items) => items);
  const result = await engine.runWorkflow();
  // Assert on Middle's RECORDED output: Sink re-stamps its own input via
  // prepareInput (standard input preparation, all paths), so only Middle's
  // run data shows what the passthrough preserved.
  assert.deepEqual(
    result.runData.Middle[0].data.main[0].map((item) => item.pairedItem),
    [{ item: 5 }, { item: 6 }],
  );
  assert.deepEqual(result.data.Sink.map((item) => item.json), [{ v: 1 }, { v: 2 }]);
});
