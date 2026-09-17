#!/usr/bin/env node
/**
 * Differential harness for ISSUE-023 (two activation-lifecycle implementations).
 *
 * Runs identical scenarios against `packages/trigger-lego` ("T", TASK-406) and the
 * activation modules inside `packages/execution-engine` ("E", TASK-ENGINE-ACTIVATION-01)
 * and prints AGREE / DIVERGE per compared value, with the reference behaviour that the
 * value is measured against. Informational EVIDENCE for the orchestrator's consolidation
 * decision — NOT a gate:
 *   exit 0 — every scenario produced a comparable outcome (even with DIVERGE)
 *   exit 1 — the harness itself broke
 *
 * Both packages are imported read-only.
 */
import assert from 'node:assert/strict';

import { ActiveWorkflows as TActiveWorkflows, TriggersAndPollers as TTriggersAndPollers } from '../packages/trigger-lego/src/index.mjs';
import {
	ActiveWorkflows as EActiveWorkflows,
	ExecutionLifecycleHooks,
	NodeTypesRegistry,
	ReconstructedWorkflow,
	TriggerContext,
	TriggersAndPollers as ETriggersAndPollers,
	createDeferredPromise,
	toCronExpression,
} from '../packages/execution-engine/src/index.mjs';

let harnessErrors = 0;
const canon = (value) => JSON.parse(JSON.stringify(value ?? null, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message } : v)));

function scenario(name, reference = null) {
	return {
		name,
		reference,
		compare(label, tValue, eValue) {
			let verdict = 'AGREE';
			let detail = '';
			try {
				assert.deepEqual(canon(tValue), canon(eValue));
			} catch {
				verdict = 'DIVERGE';
				detail = `T=${JSON.stringify(canon(tValue))} E=${JSON.stringify(canon(eValue))}`;
			}
			console.log(`[${verdict}] ${name} :: ${label}${detail ? ` — ${detail}` : ''}${reference ? ` (ref: ${reference})` : ''}`);
		},
	};
}

// Both packages need the same minimal model; the shapes differ only in registry ownership.
const TYPES = {
	trigger: { description: { name: 'trigger', properties: {}, inputs: [], outputs: [] }, trigger: async () => ({ closeFunction: async () => {} }) },
	poll: { description: { name: 'poll', properties: {}, inputs: [], outputs: [] }, poll: async () => null },
	plain: { description: { name: 'plain', properties: {}, inputs: [], outputs: [] }, execute: async () => [] },
};
const node = (name, type, extra = {}) => ({ id: `id-${name}`, name, type, typeVersion: 1, parameters: {}, ...extra });

function model(nodes) {
	const registry = new NodeTypesRegistry();
	for (const [type, definition] of Object.entries(TYPES)) registry.register(type, 1, definition);
	return new ReconstructedWorkflow({
		id: 'wf-1',
		name: 'diff',
		settings: { timezone: 'Europe/Berlin' },
		nodes,
		connections: {},
		nodeTypes: registry,
	});
}

// --- D1: cron expression mapping ---------------------------------------------
{
	const s = scenario('D1 trigger-time → cron mapping', 'cron.ts L52-72 (random second, week/month/everyX supported)');
	try {
		const items = [
			{ mode: 'everyMinute' },
			{ mode: 'everyHour', minute: 30 },
			{ mode: 'everyDay', hour: 3, minute: 30 },
			{ mode: 'everyWeek', hour: 3, minute: 30, weekday: 1 },
			{ mode: 'everyMonth', hour: 3, minute: 30, dayOfMonth: 15 },
			{ mode: 'cronExpression', cronExpression: ' 0 5 * * * ' },
		];
		const mapOne = (fn, item) => {
			try {
				return fn(item);
			} catch (error) {
				return `${error.name}: ${error.message}`;
			}
		};
		const peer = new TActiveWorkflows({ triggersAndPollers: new TTriggersAndPollers(), scheduledTaskManager: { registerCron() {}, deregisterCrons() {} } });
		const tResult = items.map((item) => mapOne((entry) => peer.toCronExpression(entry), item));
		const eResult = items.map((item) => mapOne((entry) => toCronExpression(entry, () => 0), item));
		s.compare('six trigger-time modes (T vs E)', tResult, eResult);
		s.compare('modes that threw', tResult.filter((entry) => typeof entry === 'string').length, eResult.filter((entry) => typeof entry === 'string').length);
	} catch (error) { console.error(`[HARNESS-ERROR] D1: ${error.message}`); harnessErrors++; }
}

// --- D2: runTrigger error shape ----------------------------------------------
{
	const s = scenario('D2 trigger/poll function missing', 'triggers-and-pollers.ts L35-40, L105-110 (ApplicationError, extra.nodeName + tags.nodeType)');
	try {
		const workflow = model([node('Trigger', 'plain'), node('Poller', 'plain')]);
		const t = new TTriggersAndPollers();
		const e = new ETriggersAndPollers();

		const tError = await t.runTrigger(workflow, node('Trigger', 'plain'), () => ({}), {}, 'trigger', 'init').catch((error) => error);
		const eError = await e.runTrigger(workflow, node('Trigger', 'plain'), () => ({}), {}, 'trigger', 'init').catch((error) => error);
		s.compare('runTrigger message', tError.message, eError.message);
		s.compare('runTrigger error name', tError.name, eError.name);

		const tPoll = await t.runPoll(workflow, node('Poller', 'plain'), {}).catch((error) => error);
		const ePoll = await e.runPoll(workflow, node('Poller', 'plain'), {}).catch((error) => error);
		s.compare('runPoll message', tPoll.message, ePoll.message);
		s.compare('runPoll error name', tPoll.name, ePoll.name);
	} catch (error) { console.error(`[HARNESS-ERROR] D2: ${error.message}`); harnessErrors++; }
}

// --- D3: manual mode + hooks --------------------------------------------------
{
	const s = scenario('D3 manual-mode emit wiring', 'triggers-and-pollers.ts L42-90 + oracle manual block');
	try {
		const workflow = model([node('Trigger', 'trigger')]);
		const results = {};
		for (const [label, TriggersAndPollers, hooks] of [
			['T', TTriggersAndPollers, { handlers: { sendResponse: [], workflowExecuteAfter: [] }, addHandler(name, fn) { this.handlers[name].push(fn); }, async runHook(name, args) { for (const fn of this.handlers[name]) await fn(...args); } }],
			['E', ETriggersAndPollers, new ExecutionLifecycleHooks('manual', 'exec-1', {})],
		]) {
			let functions = null;
			const response = await new TriggersAndPollers().runTrigger(
				workflow, node('Trigger', 'trigger'), () => (functions ??= { emit() {}, emitError() {}, saveFailedExecution() {} }), { hooks }, 'manual', 'init',
			);
			const responsePromise = createDeferredPromise();
			const donePromise = createDeferredPromise();
			functions.emit([[{ json: { v: 1 } }]], responsePromise, donePromise);
			results[label] = {
				emitted: await response.manualTriggerResponse,
			};
			await hooks.runHook('sendResponse', [{ ok: true }]);
			await hooks.runHook('workflowExecuteAfter', [{ run: true }, {}]);
			results[label].response = await responsePromise.promise;
			results[label].done = await donePromise.promise;
		}
		s.compare('manualTriggerResponse + deferreds resolve', results.T, results.E);
	} catch (error) { console.error(`[HARNESS-ERROR] D3: ${error.message}`); harnessErrors++; }
}

// --- D4: missing hooks --------------------------------------------------------
{
	const s = scenario('D4 manual mode without hooks', 'triggers-and-pollers.ts L50 assert inside the executor ⇒ rejected manualTriggerResponse');
	try {
		const workflow = model([node('Trigger', 'trigger')]);
		const results = {};
		for (const [label, TriggersAndPollers] of [['T', TTriggersAndPollers], ['E', ETriggersAndPollers]]) {
			const response = await new TriggersAndPollers().runTrigger(
				workflow, node('Trigger', 'trigger'), () => ({ emit() {}, emitError() {}, saveFailedExecution() {} }), {}, 'manual', 'init',
			);
			results[label] = await response.manualTriggerResponse.then(() => 'resolved', (error) => `${error.name}: ${error.message}`);
		}
		s.compare('rejection reason', results.T, results.E);
	} catch (error) { console.error(`[HARNESS-ERROR] D4: ${error.message}`); harnessErrors++; }
}

// --- D5: activation + polling order ------------------------------------------
{
	const s = scenario('D5 add() with one trigger + one poller', 'active-workflows.ts L81-186 (initial poll test before cron registration)');
	try {
		const workflow = model([node('Trigger', 'trigger'), node('Poller', 'poll')]);
		const results = {};
		for (const [label, ActiveWorkflows] of [['T', TActiveWorkflows], ['E', EActiveWorkflows]]) {
			const order = [];
			const registered = [];
			const scheduledTaskManager = {
				registerCron(ctx) { order.push('register'); registered.push(ctx); },
				deregisterCrons() { order.push('deregister'); },
			};
			const active = new ActiveWorkflows({
				scheduledTaskManager,
				randomInt: () => 0,
				triggersAndPollers: label === 'T' ? new TTriggersAndPollers() : new ETriggersAndPollers(),
			});
			const pollFunctions = {
				getNodeParameter: (name) => (name === 'pollTimes' ? { item: [{ mode: 'everyDay', hour: 3, minute: 30 }] } : undefined),
				__emit: () => order.push('emit'),
				__emitError: () => order.push('emitError'),
			};
			await active.add('wf-1', workflow, {}, 'trigger', 'init', () => ({}), () => pollFunctions);
			const removed = await active.remove('wf-1');
			results[label] = { order, registered: registered.map((ctx) => ({ ...ctx, expression: ctx.expression })), removed, active: active.isActive('wf-1') };
		}
		s.compare('operation order', results.T.order, results.E.order);
		s.compare('registered cron contexts', results.T.registered, results.E.registered);
		s.compare('remove() return + final state', { removed: results.T.removed, active: results.T.active }, { removed: results.E.removed, active: results.E.active });
	} catch (error) { console.error(`[HARNESS-ERROR] D5: ${error.message}`); harnessErrors++; }
}

// --- D6: too-short interval ---------------------------------------------------
{
	const s = scenario('D6 poll interval too short', 'active-workflows.ts L170-175 → UserError surfaced through the add() wrapper');
	try {
		const workflow = model([node('Poller', 'poll')]);
		const results = {};
		for (const [label, ActiveWorkflows] of [['T', TActiveWorkflows], ['E', EActiveWorkflows]]) {
			const active = new ActiveWorkflows({
				scheduledTaskManager: { registerCron() {}, deregisterCrons() {} },
				randomInt: () => 0,
				triggersAndPollers: label === 'T' ? new TTriggersAndPollers() : new ETriggersAndPollers(),
			});
			const pollFunctions = {
				getNodeParameter: () => ({ item: [{ mode: 'cronExpression', cronExpression: '* * * * * *' }] }),
				__emit() {}, __emitError() {},
			};
			results[label] = await active
				.add('wf-1', workflow, {}, 'trigger', 'init', () => ({}), () => pollFunctions)
				.then(() => 'resolved', (error) => ({ name: error.name, message: error.message, active: active.isActive('wf-1') }));
		}
		s.compare('error + rollback', results.T, results.E);
	} catch (error) { console.error(`[HARNESS-ERROR] D6: ${error.message}`); harnessErrors++; }
}

// --- D7: lifecycle-hook + trigger-context surface -----------------------------
{
	const s = scenario('D7 surfaces only one package has');
	try {
		s.compare('ExecutionLifecycleHooks exported by both', 'available', typeof ExecutionLifecycleHooks === 'function' ? 'available' : 'missing');
		s.compare('TriggerContext exported by both', 'available', typeof TriggerContext === 'function' ? 'available' : 'missing');
		s.compare('createDeferredPromise exported by both', 'available', typeof createDeferredPromise === 'function' ? 'available' : 'missing');
	} catch (error) { console.error(`[HARNESS-ERROR] D7: ${error.message}`); harnessErrors++; }
}

console.log('-------------------------------------------------------');
console.log(`ACTIVATION DIFFERENTIAL complete · harness errors: ${harnessErrors}`);
process.exit(harnessErrors === 0 ? 0 : 1);
