import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTINUE_MODES,
  isSoftFailure,
  mergeErrorInfo,
  retryPlanFor,
  shouldContinueOnError,
  splitErrorOutput,
  toErrorRecord,
} from './error-policy.mjs';
import { WorkflowExecutionEngine } from './runner.mjs';

// ---------------------------------------------------------------------------
// R1 — retry budget clamps (workflow-execute.ts:1600-1613)
// ---------------------------------------------------------------------------
test('R1: retry budget defaults to a single try without waiting', () => {
  assert.deepEqual(retryPlanFor({}), { maxTries: 1, waitBetweenTries: 0 });
  assert.deepEqual(retryPlanFor({ retryOnFail: false, maxTries: 5 }), { maxTries: 1, waitBetweenTries: 0 });
});

test('R1: retry budget clamps tries to [2,5] and wait to [0,5000] with || defaults', () => {
  assert.deepEqual(retryPlanFor({ retryOnFail: true }), { maxTries: 3, waitBetweenTries: 1000 });
  assert.deepEqual(retryPlanFor({ retryOnFail: true, maxTries: 99 }), { maxTries: 5, waitBetweenTries: 1000 });
  assert.deepEqual(retryPlanFor({ retryOnFail: true, maxTries: 1 }), { maxTries: 2, waitBetweenTries: 1000 });
  assert.deepEqual(retryPlanFor({ retryOnFail: true, waitBetweenTries: 99999 }), { maxTries: 3, waitBetweenTries: 5000 });
  // `||` semantics: 0 falls back to the default, exactly like the reference.
  assert.deepEqual(retryPlanFor({ retryOnFail: true, maxTries: 0, waitBetweenTries: 0 }), { maxTries: 3, waitBetweenTries: 1000 });
});

// ---------------------------------------------------------------------------
// R5 — continue-vs-stop decision (workflow-execute.ts:1843-1846)
// ---------------------------------------------------------------------------
test('R5: continueOnFail legacy flag and both onError continue modes continue', () => {
  assert.equal(shouldContinueOnError({}), false);
  assert.equal(shouldContinueOnError({ onError: 'stopWorkflow' }), false);
  assert.equal(shouldContinueOnError({ onError: 'bogus' }), false);
  assert.equal(shouldContinueOnError({ continueOnFail: true }), true);
  assert.equal(shouldContinueOnError({ onError: 'continueRegularOutput' }), true);
  assert.equal(shouldContinueOnError({ onError: 'continueErrorOutput' }), true);
  assert.deepEqual([...CONTINUE_MODES].sort(), ['continueErrorOutput', 'continueRegularOutput']);
});

// ---------------------------------------------------------------------------
// R3 — soft-failure signal (workflow-execute.ts:1672)
// ---------------------------------------------------------------------------
test('R3: only first-branch first-item json.error (non-undefined) signals soft failure', () => {
  assert.equal(isSoftFailure([[{ json: { error: 'boom' } }]]), true);
  assert.equal(isSoftFailure([[{ json: { error: null } }]]), true); // null !== undefined
  assert.equal(isSoftFailure([[{ json: { ok: 1 } }]]), false);
  assert.equal(isSoftFailure([[], [{ json: { error: 'x' } }]]), false); // second branch ignored
  assert.equal(isSoftFailure([[{ json: { ok: 1 } }, { json: { error: 'x' } }]]), false); // second item ignored
  assert.equal(isSoftFailure([]), false);
  assert.equal(isSoftFailure(undefined), false);
});

// ---------------------------------------------------------------------------
// R4 — error record shape (workflow-execute.ts:1801)
// ---------------------------------------------------------------------------
test('R4: error record keeps name/message/stack and spreads extra fields', () => {
  const err = new TypeError('bad');
  err.code = 'E_X';
  const record = toErrorRecord(err);
  assert.equal(record.name, 'TypeError');
  assert.equal(record.message, 'bad');
  assert.equal(typeof record.stack, 'string');
  assert.equal(record.code, 'E_X');
  assert.deepEqual(toErrorRecord('plain'), { name: 'Error', message: 'plain', stack: undefined });
});

// ---------------------------------------------------------------------------
// R6 — merge loop (workflow-execute.ts:1902-1917)
// ---------------------------------------------------------------------------
test('R6: $error/$json pairs and item.error collapse to json={error}', () => {
  const out = mergeErrorInfo([[
    { json: { $error: new Error('api down'), $json: { a: 1 } }, pairedItem: { item: 0 } },
    { json: { kept: true }, error: new Error('node blew'), pairedItem: { item: 1 } },
    { json: { error: 'soft' }, pairedItem: { item: 2 } },
  ]]);
  assert.deepEqual(out[0][0].json, { error: 'api down' });
  assert.equal(out[0][0].error.message, 'api down');
  assert.deepEqual(out[0][1].json, { error: 'node blew' });
  assert.deepEqual(out[0][2].json, { error: 'soft' }); // plain {error} json untouched by R6
});

// ---------------------------------------------------------------------------
// R7 — error-output split (workflow-execute.ts:2463+)
// ---------------------------------------------------------------------------
test('R7: error-signalled items move to the last output with paired merge', () => {
  const input = [{ json: { id: 7, name: 'in' }, pairedItem: { item: 0 } }];
  const branches = splitErrorOutput(
    [[
      { json: { clean: true }, pairedItem: { item: 0 } },
      { json: { error: 'x' }, pairedItem: { item: 0 } },
      { json: { error: 'y', message: 'm' }, pairedItem: { item: 0 } },
      { json: { other: 1 }, error: new Error('z'), pairedItem: { item: 0 } },
      { json: { error: 'kept', extra: 1 }, pairedItem: { item: 0 } }, // 3 keys: not a signal
    ]],
    input,
    2, // success + error wired
  );
  assert.equal(branches.length, 2);
  assert.deepEqual(branches[0].map((i) => i.json), [{ clean: true }, { error: 'kept', extra: 1 }]);
  assert.equal(branches[1].length, 3);
  assert.deepEqual(branches[1][0].json, { id: 7, name: 'in', error: 'x' }); // paired merge
  assert.deepEqual(branches[1][2].json, { id: 7, name: 'in', other: 1 });
});

test('R7: last branch is replaced and unpairable items move unmerged', () => {
  const branches = splitErrorOutput(
    [[{ json: { error: 'x' } }], [{ json: { stale: true } }]],
    [{ json: { id: 1 } }],
    2,
  );
  assert.deepEqual(branches[0], []);
  assert.deepEqual(branches[1].map((i) => i.json), [{ error: 'x' }]); // replaced, unmerged
});

// ---------------------------------------------------------------------------
// Engine integration — retry, routing, stop/continue
// ---------------------------------------------------------------------------
const twoNode = (middle) => ({
  id: 'wf-err', name: 'error test', active: false,
  nodes: [
    { id: 't', name: 'Trigger', type: 'trigger', typeVersion: 1, parameters: {} },
    { id: 'm', name: 'Middle', type: 'flaky', typeVersion: 1, parameters: {}, ...middle },
    { id: 'd', name: 'Downstream', type: 'sink', typeVersion: 1, parameters: {} },
  ],
  connections: {
    Trigger: { main: [[{ node: 'Middle', type: 'main', index: 0 }]] },
    Middle: { main: [[{ node: 'Downstream', type: 'main', index: 0 }]] },
  },
});

test('engine retries with pre-retry waits and succeeds within budget', async () => {
  const engine = new WorkflowExecutionEngine(twoNode({ retryOnFail: true, maxTries: 3, waitBetweenTries: 25 }));
  let calls = 0;
  const waits = [];
  engine.registerNodeType('trigger', async () => [{ json: { v: 1 } }]);
  engine.registerNodeType('flaky', async () => {
    calls++;
    if (calls < 3) throw new Error(`fail ${calls}`);
    return [{ json: { v: 2 } }];
  });
  const result = await engine.runWorkflow(null, [{}], { sleep: async (ms) => { waits.push(ms); } });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [25, 25]); // R2: wait before tries 2..N only
  assert.equal(result.runData.Middle[0].executionStatus, 'success');
  assert.deepEqual(result.data.Downstream[0].json, { v: 2 });
});

test('engine stops with ERROR (no data on the task) when retries are exhausted', async () => {
  const engine = new WorkflowExecutionEngine(twoNode({ retryOnFail: true, maxTries: 2, waitBetweenTries: 5 }));
  let calls = 0;
  engine.registerNodeType('trigger', async () => [{ json: { v: 1 } }]);
  engine.registerNodeType('flaky', async () => { calls++; throw new Error('always'); });
  const result = await engine.runWorkflow(null, [{}], { sleep: async () => {} });
  assert.equal(result.status, 'ERROR');
  assert.equal(result.finished, false);
  assert.equal(result.lastNodeExecuted, 'Middle');
  assert.equal(calls, 2);
  assert.equal(result.runData.Middle[0].executionStatus, 'error');
  assert.equal(result.runData.Middle[0].error.message, 'always');
  assert.equal(result.runData.Middle[0].data, undefined); // R5 stop path: no data
  assert.equal(result.runData.Downstream, undefined);
});

test('engine continues with input passthrough on continueRegularOutput', async () => {
  const engine = new WorkflowExecutionEngine(twoNode({ onError: 'continueRegularOutput' }));
  engine.registerNodeType('trigger', async () => [{ json: { v: 1 } }]);
  engine.registerNodeType('flaky', async () => { throw new Error('nope'); });
  const result = await engine.runWorkflow();
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.runData.Middle[0].executionStatus, 'error');
  assert.equal(result.runData.Middle[0].error.message, 'nope');
  assert.deepEqual(result.runData.Middle[0].data.main[0].map((i) => i.json), [{ v: 1 }]); // R5 passthrough
  assert.deepEqual(result.data.Downstream[0].json, { v: 1 });
});

test('engine treats legacy continueOnFail like the continue modes', async () => {
  const engine = new WorkflowExecutionEngine(twoNode({ continueOnFail: true }));
  engine.registerNodeType('trigger', async () => [{ json: { v: 9 } }]);
  engine.registerNodeType('flaky', async () => { throw new Error('legacy'); });
  const result = await engine.runWorkflow();
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(result.data.Downstream[0].json, { v: 9 });
});

test('engine routes thrown-error passthrough to output 0 even with continueErrorOutput (code-literal R5)', async () => {
  // DELIBERATE, CITED, FLAGGED: workflow-execute.ts:1843-1860 puts the input
  // passthrough at index 0 for BOTH continue modes, and the routing loop
  // (:1985-2017) only fires indexes holding data. The error branch fires via
  // the R7 success-path split, not via hard throws. Pinned here on purpose —
  // see ERROR-POLICY.md "open verification" if live n8n disagrees.
  const workflow = twoNode({ onError: 'continueErrorOutput' });
  workflow.nodes.push({ id: 'e', name: 'ErrSink', type: 'sink', typeVersion: 1, parameters: {} });
  workflow.connections.Middle.main.push([{ node: 'ErrSink', type: 'main', index: 0 }]);
  const engine = new WorkflowExecutionEngine(workflow);
  engine.registerNodeType('trigger', async () => [{ json: { v: 1 } }]);
  engine.registerNodeType('flaky', async () => { throw new Error('hard'); });
  const result = await engine.runWorkflow();
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(result.data.Downstream[0].json, { v: 1 });
  assert.equal(result.runData.ErrSink, undefined);
});

test('engine splits item-errors to the error branch on success with continueErrorOutput', async () => {
  const workflow = twoNode({ onError: 'continueErrorOutput' });
  workflow.nodes.push({ id: 'e', name: 'ErrSink', type: 'sink', typeVersion: 1, parameters: {} });
  workflow.connections.Middle.main.push([{ node: 'ErrSink', type: 'main', index: 0 }]);
  const engine = new WorkflowExecutionEngine(workflow);
  engine.registerNodeType('trigger', async () => [{ json: { id: 7 } }]);
  engine.registerNodeType('flaky', async () => [
    { json: { clean: true }, pairedItem: { item: 0 } },
    { json: { error: 'bad row' }, pairedItem: { item: 0 } },
  ]);
  const result = await engine.runWorkflow();
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(result.data.Downstream.map((i) => i.json), [{ clean: true }]);
  assert.deepEqual(result.data.ErrSink.map((i) => i.json), [{ id: 7, error: 'bad row' }]);
});

test('engine re-runs soft failures (json.error) inside the try budget', async () => {
  const engine = new WorkflowExecutionEngine(twoNode({ retryOnFail: true, maxTries: 3 }));
  let calls = 0;
  const waits = [];
  engine.registerNodeType('trigger', async () => [{ json: { v: 1 } }]);
  engine.registerNodeType('flaky', async () => {
    calls++;
    return calls < 3 ? [[{ json: { error: 'soft' }, pairedItem: { item: 0 } }]] : [[{ json: { v: 'recovered' } }]];
  });
  const result = await engine.runWorkflow(null, [{}], { sleep: async (ms) => { waits.push(ms); } });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 1000]); // default wait, R3 inner loop
  assert.deepEqual(result.data.Downstream[0].json, { v: 'recovered' });
});

test('engine collapses item.error to json={error} for downstream (R6)', async () => {
  const engine = new WorkflowExecutionEngine(twoNode({}));
  engine.registerNodeType('trigger', async () => [{ json: { v: 1 } }]);
  engine.registerNodeType('flaky', async () => [{ json: { dropped: true }, error: new Error('kablam') }]);
  const result = await engine.runWorkflow();
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(result.data.Downstream[0].json, { error: 'kablam' });
});
