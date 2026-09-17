#!/usr/bin/env node
/**
 * Differential harness for ISSUE-021 (two JS engine tracks).
 *
 * Runs identical scenarios on `packages/reconstructed-engine` (prototype, "A")
 * and `packages/execution-engine` (reconstruction, "B") and reports per-scenario
 * AGREE / DIVERGE with the compared values. Informational EVIDENCE for the
 * orchestrator's consolidation decision — NOT a gate:
 *   exit 0  — every scenario produced a comparable outcome (even with DIVERGE)
 *   exit 1  — the harness itself broke (scenario threw outside the compared
 *             behavior), which is a bug in this file, not an engine verdict.
 *
 * Reference-backed expectations are encoded ONLY where the author verified the
 * source lines personally (finished flag L2438, R5 routing L1843-1860+L1985-2017,
 * R1-R7 rules); everything else is reported neutrally as agree/diverge.
 *
 * Neither engine is modified; both are imported read-only.
 */
import assert from 'node:assert/strict';
import { WorkflowExecutionEngine as EngineA } from '../packages/reconstructed-engine/runner.mjs';
import {
  NodeTypesRegistry as BRegistry,
  ReconstructedWorkflow as BWorkflow,
  WorkflowExecute as EngineB,
} from '../packages/execution-engine/src/index.mjs';

const findings = [];
let harnessErrors = 0;

const canon = (value) => JSON.parse(JSON.stringify(value ?? null, (_key, entry) =>
  entry instanceof Error ? { name: entry.name, message: entry.message } : entry,
));

function scenario(name, { reference = null } = {}) {
  return {
    name,
    reference,
    compare(label, aValue, bValue) {
      const a = canon(aValue);
      const b = canon(bValue);
      let verdict = 'AGREE';
      let detail = '';
      try {
        assert.deepEqual(a, b);
      } catch {
        verdict = 'DIVERGE';
        detail = `A=${JSON.stringify(a)} B=${JSON.stringify(b)}`;
      }
      findings.push({ scenario: name, label, verdict, detail, reference });
      console.log(`[${verdict}] ${name} :: ${label}${detail ? ` — ${detail}` : ''}${reference ? ` (ref: ${reference})` : ''}`);
    },
  };
}

process.on('unhandledRejection', (error) => {
  console.error(`[HARNESS-ERROR] unhandled rejection: ${error?.message ?? error}`);
  harnessErrors++;
});

// --- adapters ---------------------------------------------------------------
const nodeDef = (name, type, parameters = {}, extra = {}) => ({
  id: `id-${name}`, name, type, typeVersion: 1, position: [0, 0], parameters, ...extra,
});

function runA({ nodes, connections }, handlers, options = {}) {
  const engine = new EngineA({ nodes, connections });
  for (const [type, handler] of Object.entries(handlers)) engine.registerNodeType(type, handler);
  return engine.runWorkflow(null, [{}], options);
}

async function runB({ nodes, connections, settings = {} }, handlers) {
  const registry = new BRegistry();
  for (const [type, handler] of Object.entries(handlers)) {
    registry.register(type, 1, {
      description: { name: type, group: type === 'trigger' ? ['trigger'] : [], inputs: ['main'], outputs: ['main'] },
      execute: handler,
    });
  }
  const workflow = new BWorkflow({ id: 'diff', name: 'diff', nodes, connections, settings, nodeTypes: registry });
  const engine = new EngineB(workflow, {});
  return engine.run({});
}

const bBranch = (run, node, runIndex = 0, branch = 0) =>
  run.data.resultData.runData[node]?.[runIndex]?.data?.main?.[branch];
const bTask = (run, node, runIndex = 0) => run.data.resultData.runData[node]?.[runIndex];
const bJson = (run, node, branch = 0) => (bBranch(run, node, 0, branch) ?? []).map((item) => item.json);
const aJson = (result, node) => (result.data[node] ?? []).map((item) => item.json);

// --- S1: linear happy path ---------------------------------------------------
{
  const s = scenario('S1 linear happy path');
  const def = {
    nodes: [nodeDef('Trigger', 'trigger'), nodeDef('Set', 'set'), nodeDef('End', 'end')],
    connections: {
      Trigger: { main: [[{ node: 'Set', type: 'main', index: 0 }]] },
      Set: { main: [[{ node: 'End', type: 'main', index: 0 }]] },
    },
  };
  const aHandlers = {
    trigger: async () => [{ json: { v: 1 } }],
    set: async (_node, items) => items.map((item) => ({ json: { v: item.json.v + 1 } })),
    end: async (_node, items) => items,
  };
  const bHandlers = {
    trigger: async () => [[{ json: { v: 1 } }]],
    set: async function () { return [this.getInputData().map((item) => ({ json: { v: item.json.v + 1 } }))]; },
    end: async function () { return [this.getInputData()]; },
  };
  try {
    const a = await runA(def, aHandlers);
    const b = await runB(def, bHandlers);
    s.compare('end items json', aJson(a, 'End'), bJson(b, 'End'));
    s.compare('completed', a.status === 'COMPLETED', b.status === 'success');
    s.compare('last node', a.lastNodeExecuted, b.data.resultData.lastNodeExecuted);
  } catch (error) { console.error(`[HARNESS-ERROR] S1: ${error.message}`); harnessErrors++; }
}

// --- S2: retry then success --------------------------------------------------
{
  const s = scenario('S2 retry then success', { reference: 'R1/R2 clamps + pre-retry wait (L1600-1630)' });
  const def = {
    nodes: [
      nodeDef('Trigger', 'trigger'),
      nodeDef('Flaky', 'flaky', {}, { retryOnFail: true, maxTries: 3, waitBetweenTries: 1 }),
      nodeDef('Sink', 'sink'),
    ],
    connections: {
      Trigger: { main: [[{ node: 'Flaky', type: 'main', index: 0 }]] },
      Flaky: { main: [[{ node: 'Sink', type: 'main', index: 0 }]] },
    },
  };
  let aCalls = 0;
  let bCalls = 0;
  const aHandlers = {
    trigger: async () => [{ json: { v: 1 } }],
    flaky: async () => { aCalls++; if (aCalls < 3) throw new Error(`fail ${aCalls}`); return [{ json: { ok: true } }]; },
    sink: async (_node, items) => items,
  };
  const bHandlers = {
    trigger: async () => [[{ json: { v: 1 } }]],
    flaky: async () => { bCalls++; if (bCalls < 3) throw new Error(`fail ${bCalls}`); return [[{ json: { ok: true } }]]; },
    sink: async function () { return [this.getInputData()]; },
  };
  try {
    const a = await runA(def, aHandlers);
    const b = await runB(def, bHandlers);
    s.compare('sink items json', aJson(a, 'Sink'), bJson(b, 'Sink'));
    s.compare('try counts', aCalls, bCalls);
    s.compare('flaky task status', a.runData.Flaky[0].executionStatus, bTask(b, 'Flaky').executionStatus);
  } catch (error) { console.error(`[HARNESS-ERROR] S2: ${error.message}`); harnessErrors++; }
}

// --- S3: retry exhausted → stop ----------------------------------------------
{
  const s = scenario('S3 retry exhausted → stop', { reference: 'finished falsy on error stop (L2438); R5 stop path (L1860-1900)' });
  const def = {
    nodes: [
      nodeDef('Trigger', 'trigger'),
      nodeDef('Flaky', 'flaky', {}, { retryOnFail: true, maxTries: 2, waitBetweenTries: 1 }),
      nodeDef('Sink', 'sink'),
    ],
    connections: {
      Trigger: { main: [[{ node: 'Flaky', type: 'main', index: 0 }]] },
      Flaky: { main: [[{ node: 'Sink', type: 'main', index: 0 }]] },
    },
  };
  let aCalls = 0;
  let bCalls = 0;
  const aHandlers = {
    trigger: async () => [{ json: { v: 1 } }],
    flaky: async () => { aCalls++; throw new Error('always'); },
    sink: async (_node, items) => items,
  };
  const bHandlers = {
    trigger: async () => [[{ json: { v: 1 } }]],
    flaky: async () => { bCalls++; throw new Error('always'); },
    sink: async function () { return [this.getInputData()]; },
  };
  try {
    const a = await runA(def, aHandlers);
    const b = await runB(def, bHandlers);
    s.compare('stopped with error', a.status === 'ERROR', b.status === 'error');
    s.compare('finished flag', a.finished, b.finished);
    s.compare('last node executed', a.lastNodeExecuted, b.data.resultData.lastNodeExecuted);
    s.compare('error message', a.error.message, b.data.resultData.error?.message);
    s.compare('try counts', aCalls, bCalls);
    s.compare('sink never ran', a.runData.Sink, b.data.resultData.runData.Sink);
    s.compare('failed task carries no data', a.runData.Flaky[0].data, bTask(b, 'Flaky').data);
  } catch (error) { console.error(`[HARNESS-ERROR] S3: ${error.message}`); harnessErrors++; }
}

// --- S4: continueRegularOutput passthrough ------------------------------------
{
  const s = scenario('S4 continueRegularOutput passthrough', { reference: 'R5 passthrough main[0] (L1843-1860)' });
  const def = {
    nodes: [
      nodeDef('Trigger', 'trigger'),
      nodeDef('Flaky', 'flaky', {}, { onError: 'continueRegularOutput' }),
      nodeDef('Sink', 'sink'),
    ],
    connections: {
      Trigger: { main: [[{ node: 'Flaky', type: 'main', index: 0 }]] },
      Flaky: { main: [[{ node: 'Sink', type: 'main', index: 0 }]] },
    },
  };
  const aHandlers = {
    trigger: async () => [{ json: { v: 1 } }],
    flaky: async () => { throw new Error('nope'); },
    sink: async (_node, items) => items,
  };
  const bHandlers = {
    trigger: async () => [[{ json: { v: 1 } }]],
    flaky: async () => { throw new Error('nope'); },
    sink: async function () { return [this.getInputData()]; },
  };
  try {
    const a = await runA(def, aHandlers);
    const b = await runB(def, bHandlers);
    s.compare('completed', a.status === 'COMPLETED', b.status === 'success');
    s.compare('sink items json (= input)', aJson(a, 'Sink'), bJson(b, 'Sink'));
    s.compare('failed task status', a.runData.Flaky[0].executionStatus, bTask(b, 'Flaky').executionStatus);
  } catch (error) { console.error(`[HARNESS-ERROR] S4: ${error.message}`); harnessErrors++; }
}

// --- S5: continueErrorOutput hard throw — the code-literal question -----------
{
  const s = scenario('S5 continueErrorOutput hard throw', { reference: 'both continue modes identical while throwing (L1843-1860 + routing L1985-2017)' });
  const def = {
    nodes: [
      nodeDef('Trigger', 'trigger'),
      nodeDef('Flaky', 'flaky', {}, { onError: 'continueErrorOutput' }),
      nodeDef('Sink', 'sink'),
      nodeDef('ErrSink', 'sink'),
    ],
    connections: {
      Trigger: { main: [[{ node: 'Flaky', type: 'main', index: 0 }]] },
      Flaky: { main: [[{ node: 'Sink', type: 'main', index: 0 }], [{ node: 'ErrSink', type: 'main', index: 0 }]] },
    },
  };
  const aHandlers = {
    trigger: async () => [{ json: { v: 1 } }],
    flaky: async () => { throw new Error('hard'); },
    sink: async (_node, items) => items,
  };
  const bHandlers = {
    trigger: async () => [[{ json: { v: 1 } }]],
    flaky: async () => { throw new Error('hard'); },
    sink: async function () { return [this.getInputData()]; },
  };
  try {
    const a = await runA(def, aHandlers);
    const b = await runB(def, bHandlers);
    s.compare('success-branch sink items', aJson(a, 'Sink'), bJson(b, 'Sink'));
    s.compare('error-branch sink ran', a.runData.ErrSink !== undefined, b.data.resultData.runData.ErrSink !== undefined);
  } catch (error) { console.error(`[HARNESS-ERROR] S5: ${error.message}`); harnessErrors++; }
}

// --- S6: item-error split on success ------------------------------------------
{
  const s = scenario('S6 item-error split (success + continueErrorOutput)', { reference: 'R7 split + paired merge (L2463+)' });
  const def = {
    nodes: [
      nodeDef('Trigger', 'trigger'),
      nodeDef('Mixed', 'mixed', {}, { onError: 'continueErrorOutput' }),
      nodeDef('Sink', 'sink'),
      nodeDef('ErrSink', 'sink'),
    ],
    connections: {
      Trigger: { main: [[{ node: 'Mixed', type: 'main', index: 0 }]] },
      Mixed: { main: [[{ node: 'Sink', type: 'main', index: 0 }], [{ node: 'ErrSink', type: 'main', index: 0 }]] },
    },
  };
  const mixedItems = () => [
    { json: { clean: true }, pairedItem: { item: 0 } },
    { json: { error: 'bad row' }, pairedItem: { item: 0 } },
  ];
  const aHandlers = {
    trigger: async () => [{ json: { id: 7 } }],
    mixed: async () => mixedItems(),
    sink: async (_node, items) => items,
  };
  const bHandlers = {
    trigger: async () => [[{ json: { id: 7 } }]],
    mixed: async () => [mixedItems()],
    sink: async function () { return [this.getInputData()]; },
  };
  try {
    const a = await runA(def, aHandlers);
    const b = await runB(def, bHandlers);
    s.compare('success-branch json', aJson(a, 'Sink'), bJson(b, 'Sink'));
    // NOTE: downstream nodes always receive on branch 0 of their own run data.
    s.compare('error-branch json', aJson(a, 'ErrSink'), bJson(b, 'ErrSink', 0));
  } catch (error) { console.error(`[HARNESS-ERROR] S6: ${error.message}`); harnessErrors++; }
}

// --- S7: disabled node ---------------------------------------------------------
{
  const s = scenario('S7 disabled node skipped');
  const def = {
    nodes: [
      nodeDef('Trigger', 'trigger'),
      nodeDef('Middle', 'set', {}, { disabled: true }),
      nodeDef('Sink', 'sink'),
    ],
    connections: {
      Trigger: { main: [[{ node: 'Middle', type: 'main', index: 0 }]] },
      Middle: { main: [[{ node: 'Sink', type: 'main', index: 0 }]] },
    },
  };
  const aHandlers = {
    trigger: async () => [{ json: { v: 1 } }],
    set: async (_node, items) => items,
    sink: async (_node, items) => items,
  };
  const bHandlers = {
    trigger: async () => [[{ json: { v: 1 } }]],
    set: async function () { return [this.getInputData()]; },
    sink: async function () { return [this.getInputData()]; },
  };
  try {
    const a = await runA(def, aHandlers);
    const b = await runB(def, bHandlers);
    s.compare('completed', a.status === 'COMPLETED', b.status === 'success');
    s.compare('disabled node produced no task', a.runData.Middle, b.data.resultData.runData.Middle);
    s.compare('downstream never ran', a.runData.Sink, b.data.resultData.runData.Sink);
  } catch (error) { console.error(`[HARNESS-ERROR] S7: ${error.message}`); harnessErrors++; }
}

// --- S8: trivial expression in parameters --------------------------------------
{
  const s = scenario('S8 trivial ={...} expression via getNodeParameter');
  const def = {
    nodes: [nodeDef('Trigger', 'trigger'), nodeDef('Set', 'set', { value: '={{ $json.v + 1 }}' }), nodeDef('End', 'end')],
    connections: {
      Trigger: { main: [[{ node: 'Set', type: 'main', index: 0 }]] },
      Set: { main: [[{ node: 'End', type: 'main', index: 0 }]] },
    },
  };
  const aHandlers = {
    trigger: async () => [{ json: { v: 1 } }],
    set: async (_node, items, context) => items.map((_item, index) => ({ json: { v: context.getNodeParameter('value', index) } })),
    end: async (_node, items) => items,
  };
  const bHandlers = {
    trigger: async () => [[{ json: { v: 1 } }]],
    set: async function () {
      if (typeof this.getNodeParameter !== 'function') throw new Error('NOT-COMPARABLE: no getNodeParameter');
      const out = this.getInputData().map((_item, index) => ({ json: { v: this.getNodeParameter('value', index) } }));
      return [out];
    },
    end: async function () { return [this.getInputData()]; },
  };
  try {
    const a = await runA(def, aHandlers);
    const b = await runB(def, bHandlers);
    s.compare('end items json', aJson(a, 'End'), bJson(b, 'End'));
  } catch (error) {
    if (String(error.message).includes('NOT-COMPARABLE')) {
      findings.push({ scenario: 'S8 trivial ={...} expression via getNodeParameter', label: 'end items json', verdict: 'NOT-COMPARABLE', detail: error.message });
      console.log(`[NOT-COMPARABLE] S8 :: end items json — ${error.message}`);
    } else { console.error(`[HARNESS-ERROR] S8: ${error.message}`); harnessErrors++; }
  }
}

// --- summary ------------------------------------------------------------------
const agree = findings.filter((f) => f.verdict === 'AGREE').length;
const diverge = findings.filter((f) => f.verdict === 'DIVERGE').length;
const nocomp = findings.filter((f) => f.verdict === 'NOT-COMPARABLE').length;
console.log('-------------------------------------------------------');
console.log(`DIFFERENTIAL: ${agree} agree / ${diverge} diverge / ${nocomp} not-comparable across ${findings.length} comparisons (${harnessErrors} harness errors)`);
if (harnessErrors > 0) {
  console.error('HARNESS FAILED — fix tools/engine-differential.mjs (not an engine verdict)');
  process.exit(1);
}
