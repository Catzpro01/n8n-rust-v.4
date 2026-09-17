#!/usr/bin/env node
/**
 * Activation-lifecycle differential harness for ISSUE-023.
 *
 * Runs identical activation scenarios on
 *   A = packages/trigger-lego            (TASK-406)
 *   B = packages/execution-engine activation surface (TASK-ENGINE-ACTIVATION-01)
 * and reports per-comparison AGREE / DIVERGE. Informational EVIDENCE for the
 * orchestrator's ISSUE-023 consolidation decision — NOT a gate:
 *   exit 0  — every scenario produced a comparable outcome (even with DIVERGE)
 *   exit 1  — the harness itself broke, which is a bug in this file.
 *
 * Oracle: active-workflows.ts (add L81-145, activatePolling L150-186, remove
 * L189-208, removeAll L210-222, closeTrigger L224-249), scheduled-task-manager.ts
 * (L52-161), cron.ts toCronExpression L52-72, workflow.ts queryNodes L272-293.
 * Injected transports (logger/errorReporter/onDuplicate/timer) are compared as
 * signal presence — their exact shapes depend on the reference instanceSettings,
 * which both dependency-free packages abstract (see ISSUE-023 addendum).
 * Error taxonomy is exercised per-package: each rig throws and catches its OWN
 * error classes (the classes are reconstructed per package by design).
 */
import assert from 'node:assert/strict';
import * as A from '../packages/trigger-lego/src/index.mjs';
import * as B from '../packages/execution-engine/src/index.mjs';

const findings = [];
let harnessErrors = 0;

const canon = (value) => JSON.parse(JSON.stringify(value ?? null, (_k, v) =>
  v instanceof Error ? { name: v.name, message: v.message } : v,
));

function scenario(name, { reference = null } = {}) {
  return {
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
      findings.push({ scenario: name, label, verdict });
      console.log(`[${verdict}] ${name} :: ${label}${detail ? ` — ${detail}` : ''}${reference ? ` (ref: ${reference})` : ''}`);
    },
  };
}

async function runScenario(name, reference, fn) {
  const s = scenario(name, { reference });
  try {
    await fn(s);
  } catch (error) {
    console.error(`[HARNESS-ERROR] ${name}: ${error?.stack ?? error}`);
    harnessErrors++;
  }
}

// --- identical fixture builders ---------------------------------------------
/** Plain workflow fixture with the queryNodes disabled-skip baked in (workflow.ts L283-285). */
function mkWorkflow(id, { triggers = [], polls = [], types = {} } = {}) {
  return {
    id,
    name: `wf-${id}`,
    timezone: 'UTC',
    getTriggerNodes: () => triggers.filter((n) => n.disabled !== true),
    getPollNodes: () => polls.filter((n) => n.disabled !== true),
    nodeTypes: { getByNameAndVersion: (type) => types[type] },
  };
}

const triggerNode = (id) => ({ id, name: `T-${id}`, type: 'test.trigger', typeVersion: 1, position: [0, 0], parameters: {} });
const pollNode = (id, pollTimes) => ({ id, name: `P-${id}`, type: 'test.poll', typeVersion: 1, position: [0, 0], parameters: { pollTimes } });

const okTriggerType = { 'test.trigger': { description: { name: 'test.trigger' }, trigger: async function () { return { closeFunction: async () => {} }; } } };
const okPollType = { 'test.poll': { description: { name: 'test.poll' }, poll: async function () { return { json: { polled: this.__nodeId } }; } } };

/** Per-engine rig: identical inputs, each package's own classes and transports. */
function mkRig(which) {
  const TP = which === 'A' ? A.TriggersAndPollers : B.TriggersAndPollers;
  const STM = which === 'A' ? A.ScheduledTaskManager : B.ScheduledTaskManager;
  const signals = { duplicates: 0, reported: [], deregistered: [] };

  const scheduledTaskManager = new STM(which === 'A'
    ? {
        registerJob: (ctx) => ({ stop: () => signals.deregistered.push(ctx.expression) }),
        onDuplicate: () => { signals.duplicates += 1; },
      }
    : {
        timer: (ctx) => ({ stop: () => signals.deregistered.push(ctx.expression) }),
        errorReporter: { error: (message, options) => signals.reported.push({ message }) },
      });

  const activeWorkflows = which === 'A'
    ? new A.ActiveWorkflows({ scheduledTaskManager, triggersAndPollers: new TP() })
    : new B.ActiveWorkflows({
        scheduledTaskManager,
        triggersAndPollers: new TP(),
        errorReporter: { error: (message, options) => signals.reported.push({ message }) },
      });

  const factories = {
    getTriggerFunctions: () => ({}),
    getPollFunctions: (_wf, node) => ({
      getNodeParameter: (name) => node.parameters?.[name],
      __emit: () => {},
      __emitError: () => {},
    }),
  };
  return { activeWorkflows, signals, scheduledTaskManager, factories };
}

const cronCtxOf = (rig, workflowId) => {
  const map = rig.scheduledTaskManager.cronsByWorkflow?.get(workflowId);
  return [...(map?.values() ?? [])].map((c) => ({
    expression: c.ctx?.expression ?? c.context?.expression,
    nodeId: c.ctx?.nodeId ?? c.context?.nodeId,
    timezone: c.ctx?.timezone ?? c.context?.timezone,
    workflowId: c.ctx?.workflowId ?? c.context?.workflowId,
  })).sort((x, y) => (x.expression ?? '').localeCompare(y.expression ?? ''));
};

const firstExpression = (rig, workflowId) => cronCtxOf(rig, workflowId)[0]?.expression;

// --- S1: trigger lifecycle ---------------------------------------------------
await runScenario('S1 trigger add/remove lifecycle', 'active-workflows.ts L81-145 add, L189-208 remove', async (s) => {
  const rig = mkRig('A'); const rigB = mkRig('B');
  const mkWf = () => mkWorkflow('wf1', { triggers: [triggerNode('t1')], types: okTriggerType });
  const args = (wf, rigX) => [wf.id, wf, {}, 'production', 'init', rigX.factories.getTriggerFunctions, rigX.factories.getPollFunctions];
  const wfA = mkWf(); const wfB = mkWf();
  await rig.activeWorkflows.add(...args(wfA, rig));
  await rigB.activeWorkflows.add(...args(wfB, rigB));
  s.compare('isActive after add', rig.activeWorkflows.isActive('wf1'), rigB.activeWorkflows.isActive('wf1'));
  s.compare('isActive after add (true)', rig.activeWorkflows.isActive('wf1'), true);
  s.compare('allActiveWorkflows', rig.activeWorkflows.allActiveWorkflows(), rigB.activeWorkflows.allActiveWorkflows());
  s.compare('stored entry keys', Object.keys(rig.activeWorkflows.get('wf1')), Object.keys(rigB.activeWorkflows.get('wf1')));
  s.compare('remove returns true', await rig.activeWorkflows.remove('wf1'), await rigB.activeWorkflows.remove('wf1'));
  s.compare('isActive after remove', rig.activeWorkflows.isActive('wf1'), rigB.activeWorkflows.isActive('wf1'));
  s.compare('remove inactive returns false', await rig.activeWorkflows.remove('wf1'), await rigB.activeWorkflows.remove('wf1'));
});

// --- S2: poll activation + cron registration ----------------------------------
await runScenario('S2 poll activation registers crons', 'active-workflows.ts L150-186 activatePolling; scheduled-task-manager.ts L52-105', async (s) => {
  const rig = mkRig('A'); const rigB = mkRig('B');
  const mkWf = () => mkWorkflow('wf2', { polls: [pollNode('p1', { item: [{ mode: 'custom', cronExpression: '0 */5 * * * *' }] })], types: okPollType });
  const args = (wf, rigX) => [wf.id, wf, {}, 'production', 'init', rigX.factories.getTriggerFunctions, rigX.factories.getPollFunctions];
  const wfA = mkWf(); const wfB = mkWf();
  await rig.activeWorkflows.add(...args(wfA, rig));
  await rigB.activeWorkflows.add(...args(wfB, rigB));
  s.compare('isActive', rig.activeWorkflows.isActive('wf2'), rigB.activeWorkflows.isActive('wf2'));
  s.compare('isActive (true)', rig.activeWorkflows.isActive('wf2'), true);
  s.compare('cron ctx (workflowId/nodeId/expression/timezone)', cronCtxOf(rig, 'wf2'), cronCtxOf(rigB, 'wf2'));
  s.compare('remove returns true', await rig.activeWorkflows.remove('wf2'), await rigB.activeWorkflows.remove('wf2'));
  s.compare('registry empty after remove', cronCtxOf(rig, 'wf2'), cronCtxOf(rigB, 'wf2'));
});

// --- S3: trigger activation error ---------------------------------------------
await runScenario('S3 trigger activation error', 'active-workflows.ts L99-110', async (s) => {
  const boom = { 'test.trigger': { description: { name: 'test.trigger' }, trigger: async function () { throw new Error('boom'); } } };
  const rig = mkRig('A'); const rigB = mkRig('B');
  const mkWf = () => mkWorkflow('wf3', { triggers: [triggerNode('t1')], types: boom });
  const args = (wf, rigX) => [wf.id, wf, {}, 'production', 'init', rigX.factories.getTriggerFunctions, rigX.factories.getPollFunctions];
  const errA = await rig.activeWorkflows.add(...args(mkWf(), rig)).then(() => null, (e) => e);
  const errB = await rigB.activeWorkflows.add(...args(mkWf(), rigB)).then(() => null, (e) => e);
  s.compare('error thrown on both', errA !== null, errB !== null);
  s.compare('error messages', errA?.message, errB?.message);
  s.compare('not active after failed activation', rig.activeWorkflows.isActive('wf3'), rigB.activeWorkflows.isActive('wf3'));
});

// --- S4: poll failure rollback semantics ---------------------------------------
await runScenario('S4 poll failure rollback', 'active-workflows.ts L121-145 (delete only when triggerResponses empty)', async (s) => {
  const failPoll = { 'test.poll': { description: { name: 'test.poll' }, poll: async function () { throw new Error('pollfail'); } } };
  const args = (wf, rigX) => [wf.id, wf, {}, 'production', 'init', rigX.factories.getTriggerFunctions, rigX.factories.getPollFunctions];
  for (const withTrigger of [false, true]) {
    const mkTypes = () => ({ ...failPoll, ...(withTrigger ? okTriggerType : {}) });
    const rig = mkRig('A'); const rigB = mkRig('B');
    const wfA = mkWorkflow('wf4', { triggers: withTrigger ? [triggerNode('t1')] : [], polls: [pollNode('p1', { item: [{ mode: 'custom', cronExpression: '0 * * * * *' }] })], types: mkTypes() });
    const wfB = mkWorkflow('wf4', { triggers: withTrigger ? [triggerNode('t1')] : [], polls: [pollNode('p1', { item: [{ mode: 'custom', cronExpression: '0 * * * * *' }] })], types: mkTypes() });
    const eA = await rig.activeWorkflows.add(...args(wfA, rig)).then(() => null, (e) => e);
    const eB = await rigB.activeWorkflows.add(...args(wfB, rigB)).then(() => null, (e) => e);
    s.compare(`error thrown (withTrigger=${withTrigger})`, eA !== null, eB !== null);
    s.compare(`isActive (withTrigger=${withTrigger})`, rig.activeWorkflows.isActive('wf4'), rigB.activeWorkflows.isActive('wf4'));
  }
});

// --- S5: duplicate cron registration is reported, not double-scheduled ----------
await runScenario('S5 duplicate cron registration', 'scheduled-task-manager.ts L68-79 (duplicate guard)', async (s) => {
  const rig = mkRig('A'); const rigB = mkRig('B');
  const ctx = { workflowId: 'wf5', timezone: 'UTC', nodeId: 'n1', expression: '0 0 * * * *' };
  const tick = () => {};
  rig.scheduledTaskManager.registerCron(ctx, tick);
  rig.scheduledTaskManager.registerCron(ctx, tick);
  rigB.scheduledTaskManager.registerCron(ctx, tick);
  rigB.scheduledTaskManager.registerCron(ctx, tick);
  s.compare('registry size after duplicate', cronCtxOf(rig, 'wf5').length, cronCtxOf(rigB, 'wf5').length);
  s.compare('registry size (1)', cronCtxOf(rig, 'wf5').length, 1);
  s.compare('duplicate reported via some transport', rig.signals.duplicates > 0, rigB.signals.reported.length > 0);
});

// --- S6: polling interval too short ---------------------------------------------
await runScenario('S6 polling interval too short', 'active-workflows.ts L163-165 (UserError guard)', async (s) => {
  const rig = mkRig('A'); const rigB = mkRig('B');
  const mkWf = () => mkWorkflow('wf6', { polls: [pollNode('p1', { item: [{ mode: 'custom', cronExpression: '* * * * * *' }] })], types: okPollType });
  const args = (wf, rigX) => [wf.id, wf, {}, 'production', 'init', rigX.factories.getTriggerFunctions, rigX.factories.getPollFunctions];
  const eA = await rig.activeWorkflows.add(...args(mkWf(), rig)).then(() => null, (e) => e);
  const eB = await rigB.activeWorkflows.add(...args(mkWf(), rigB)).then(() => null, (e) => e);
  s.compare('error thrown on both', eA !== null, eB !== null);
  s.compare('error messages', eA?.message, eB?.message);
  s.compare('rolled back on both', rig.activeWorkflows.isActive('wf6'), rigB.activeWorkflows.isActive('wf6'));
});

// --- S7: deactivation error taxonomy (per-package error classes) -----------------
await runScenario('S7 closeTrigger error taxonomy', 'active-workflows.ts L224-249', async (s) => {
  const args = (wf, rigX) => [wf.id, wf, {}, 'production', 'init', rigX.factories.getTriggerFunctions, rigX.factories.getPollFunctions];

  // TriggerCloseError → swallowed, workflow still removed (remove returns true)
  {
    const mkTypes = (cls) => ({ 'test.trigger': { description: { name: 'test.trigger' }, trigger: async function () { return { closeFunction: async () => { throw new cls('close failed', { node: { name: 'T-t1' } }); } }; } } });
    const rig = mkRig('A'); const rigB = mkRig('B');
    const wfA = mkWorkflow('wf7', { triggers: [triggerNode('t1')], types: mkTypes(A.TriggerCloseError) });
    const wfB = mkWorkflow('wf7', { triggers: [triggerNode('t1')], types: mkTypes(B.TriggerCloseError) });
    await rig.activeWorkflows.add(...args(wfA, rig));
    await rigB.activeWorkflows.add(...args(wfB, rigB));
    const rA = await rig.activeWorkflows.remove('wf7');
    const rB = await rigB.activeWorkflows.remove('wf7');
    s.compare('TriggerCloseError swallowed (remove true)', rA, rB);
    s.compare('both inactive afterwards', rig.activeWorkflows.isActive('wf7'), rigB.activeWorkflows.isActive('wf7'));
    s.compare('both inactive (false)', rig.activeWorkflows.isActive('wf7'), false);
  }
  // generic error → WorkflowDeactivationError with reference message
  {
    const mkTypes = () => ({ 'test.trigger': { description: { name: 'test.trigger' }, trigger: async function () { return { closeFunction: async () => { throw new Error('kaboom'); } }; } } });
    const rig = mkRig('A'); const rigB = mkRig('B');
    const wfA = mkWorkflow('wf7b', { triggers: [triggerNode('t1')], types: mkTypes() });
    const wfB = mkWorkflow('wf7b', { triggers: [triggerNode('t1')], types: mkTypes() });
    await rig.activeWorkflows.add(...args(wfA, rig));
    await rigB.activeWorkflows.add(...args(wfB, rigB));
    const eA = await rig.activeWorkflows.remove('wf7b').then(() => null, (e) => e);
    const eB = await rigB.activeWorkflows.remove('wf7b').then(() => null, (e) => e);
    s.compare('deactivation error classes', eA?.name, eB?.name);
    s.compare('deactivation error messages', eA?.message, eB?.message);
  }
});

// --- S8: toCronExpression surface — everyX poll mode ------------------------------
await runScenario('S8 toCronExpression: everyX minutes mode', 'cron.ts L52-72 (reference supports everyX/everyWeek/everyMonth + random second)', async (s) => {
  const rig = mkRig('A'); const rigB = mkRig('B');
  const mkWf = () => mkWorkflow('wf8', { polls: [pollNode('p1', { item: [{ mode: 'everyX', unit: 'minutes', value: 7 }] })], types: okPollType });
  const args = (wf, rigX) => [wf.id, wf, {}, 'production', 'init', rigX.factories.getTriggerFunctions, rigX.factories.getPollFunctions];
  const eA = await rig.activeWorkflows.add(...args(mkWf(), rig)).then(() => null, (e) => e);
  const eB = await rigB.activeWorkflows.add(...args(mkWf(), rigB)).then(() => null, (e) => e);
  s.compare('both activated or both errored', eA === null, eB === null);
  const shape = (expr) => (expr ?? '').replace(/^\d+/, 'R'); // random second normalized
  s.compare('registered expression shape',
    shape(firstExpression(rig, 'wf8')),
    shape(firstExpression(rigB, 'wf8')));
  s.compare('registered expression shape (*/7 minutes)', shape(firstExpression(rig, 'wf8')), 'R */7 * * * *');
});

// --- S9: custom expression trimmed -------------------------------------------------
await runScenario('S9 custom cronExpression trimmed', 'cron.ts L72 (item.cronExpression.trim())', async (s) => {
  const rig = mkRig('A'); const rigB = mkRig('B');
  const mkWf = () => mkWorkflow('wf9', { polls: [pollNode('p1', { item: [{ mode: 'custom', cronExpression: '  0 5 * * * *  ' }] })], types: okPollType });
  const args = (wf, rigX) => [wf.id, wf, {}, 'production', 'init', rigX.factories.getTriggerFunctions, rigX.factories.getPollFunctions];
  await rig.activeWorkflows.add(...args(mkWf(), rig));
  await rigB.activeWorkflows.add(...args(mkWf(), rigB));
  s.compare('stored expression', firstExpression(rig, 'wf9'), firstExpression(rigB, 'wf9'));
  s.compare('stored expression (trimmed)', firstExpression(rig, 'wf9'), '0 5 * * * *');
});

// --- S10: disabled trigger/poll nodes are never activated ---------------------------
await runScenario('S10 disabled nodes skipped', 'workflow.ts queryNodes L283-285 (disabled === true continue)', async (s) => {
  const rig = mkRig('A'); const rigB = mkRig('B');
  const mkWf = () => mkWorkflow('wf10', {
    triggers: [{ ...triggerNode('t1'), disabled: true }],
    polls: [{ ...pollNode('p1', { item: [{ mode: 'everyMinute' }] }), disabled: true }],
    types: { ...okTriggerType, ...okPollType },
  });
  const args = (wf, rigX) => [wf.id, wf, {}, 'production', 'init', rigX.factories.getTriggerFunctions, rigX.factories.getPollFunctions];
  await rig.activeWorkflows.add(...args(mkWf(), rig));
  await rigB.activeWorkflows.add(...args(mkWf(), rigB));
  s.compare('isActive', rig.activeWorkflows.isActive('wf10'), rigB.activeWorkflows.isActive('wf10'));
  s.compare('no cron registered', cronCtxOf(rig, 'wf10').length, cronCtxOf(rigB, 'wf10').length);
  s.compare('no cron registered (0)', cronCtxOf(rig, 'wf10').length, 0);
});

// --- S11: removeAll ------------------------------------------------------------------
await runScenario('S11 removeAllTriggerAndPollerBasedWorkflows', 'active-workflows.ts L210-222', async (s) => {
  const rig = mkRig('A'); const rigB = mkRig('B');
  const args = (wf, rigX) => [wf.id, wf, {}, 'production', 'init', rigX.factories.getTriggerFunctions, rigX.factories.getPollFunctions];
  for (const id of ['w1', 'w2']) {
    const mkWf = () => mkWorkflow(id, { triggers: [triggerNode('t1')], types: okTriggerType });
    await rig.activeWorkflows.add(...args(mkWf(), rig));
    await rigB.activeWorkflows.add(...args(mkWf(), rigB));
  }
  await rig.activeWorkflows.removeAllTriggerAndPollerBasedWorkflows();
  await rigB.activeWorkflows.removeAllTriggerAndPollerBasedWorkflows();
  s.compare('all inactive', rig.activeWorkflows.allActiveWorkflows(), rigB.activeWorkflows.allActiveWorkflows());
  s.compare('all inactive (empty)', rig.activeWorkflows.allActiveWorkflows(), []);
});

// --- S12: multiple poll nodes / multiple cron expressions ------------------------------
await runScenario('S12 multi-node multi-expression', 'active-workflows.ts L150-186 (loop over poll nodes and expressions)', async (s) => {
  const rig = mkRig('A'); const rigB = mkRig('B');
  const mkWf = () => mkWorkflow('wf12', {
    polls: [
      pollNode('p1', { item: [{ mode: 'custom', cronExpression: '0 1 * * * *' }, { mode: 'custom', cronExpression: '0 2 * * * *' }] }),
      pollNode('p2', { item: [{ mode: 'custom', cronExpression: '0 3 * * * *' }] }),
    ],
    types: okPollType,
  });
  const args = (wf, rigX) => [wf.id, wf, {}, 'production', 'init', rigX.factories.getTriggerFunctions, rigX.factories.getPollFunctions];
  await rig.activeWorkflows.add(...args(mkWf(), rig));
  await rigB.activeWorkflows.add(...args(mkWf(), rigB));
  s.compare('three crons registered', cronCtxOf(rig, 'wf12'), cronCtxOf(rigB, 'wf12'));
  s.compare('three crons (count 3)', cronCtxOf(rig, 'wf12').length, 3);
  s.compare('remove deregisters all', await rig.activeWorkflows.remove('wf12'), await rigB.activeWorkflows.remove('wf12'));
});

// --- summary ---------------------------------------------------------------------------
const agree = findings.filter((f) => f.verdict === 'AGREE').length;
const diverge = findings.filter((f) => f.verdict === 'DIVERGE').length;
console.log('-------------------------------------------------------');
console.log(`ACTIVATION DIFFERENTIAL: ${agree} agree / ${diverge} diverge across ${findings.length} comparisons (${harnessErrors} harness errors)`);
process.exit(harnessErrors ? 1 : 0);
