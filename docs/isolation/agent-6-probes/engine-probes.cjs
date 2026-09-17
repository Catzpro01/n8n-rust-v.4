'use strict';
/**
 * Agent 6 — TASK-403 execution-engine observation probes (back-fill evidence).
 *
 * Drives the REAL n8n 2.9.x execution engine (`WorkflowExecute` from n8n-core) and records what the
 * engine actually does around a node: which context class it builds, what that context exposes, how it
 * schedules nodes, and exactly what it writes into `runExecutionData.resultData.runData`.
 * Nothing here re-implements n8n: every recorded value is what the running engine produced.
 *
 * Why this file exists for TASK-403: the protest against that task is "no machine evidence". Source
 * reading alone is not evidence, so each rule claimed in docs/isolation/execution-engine.md is pinned
 * here by an observed value, with the source line it came from recorded next to it.
 *
 * usage (from the repo root):
 *   NODE_PATH=$PWD/.runtime/node_modules node docs/isolation/agent-6-probes/engine-probes.cjs [outfile.json]
 * env: AGENT6_REPO, AGENT6_HARNESS
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = process.env.AGENT6_REPO || path.resolve(__dirname, '..', '..', '..');
process.env.N8N_USER_FOLDER = process.env.N8N_USER_FOLDER || path.join(os.tmpdir(), 'n8n-agent6-engine');
process.env.N8N_LOG_LEVEL = 'silent';

const { WorkflowExecute } = require('n8n-core');
const HARNESS = process.env.AGENT6_HARNESS || path.join(REPO, 'tests/reference/harness/harness.js');
const { registry, buildWorkflow, runWorkflow } = require(HARNESS);
const { NodeOperationError, NodeHelpers } = require('n8n-workflow');

// ---------- serialisation helpers -------------------------------------------------------
const show = (v, depth = 0) => {
	if (v === undefined) return { __type: 'undefined' };
	if (v === null) return null;
	if (typeof v === 'function') return { __type: 'function', name: v.name || 'anonymous' };
	if (typeof v === 'bigint') return { __type: 'BigInt', value: String(v) };
	if (typeof v === 'number' && !Number.isFinite(v)) return { __type: 'Number', value: String(v) };
	if (typeof v === 'symbol') return { __type: 'Symbol', value: String(v) };
	if (typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number') return v;
	if (v instanceof Error) {
		const out = { __type: v.constructor.name, message: v.message };
		if (v.description) out.description = String(v.description).slice(0, 200);
		if (v.context && Object.keys(v.context).length) out.context = JSON.parse(JSON.stringify(v.context));
		return out;
	}
	if (v instanceof Date) return { __type: 'Date', iso: v.toISOString() };
	if (Array.isArray(v)) return depth > 5 ? { __type: 'array', length: v.length } : v.map((i) => show(i, depth + 1));
	if (v && typeof v === 'object') {
		if (depth > 5) return { __type: 'object', keys: Object.keys(v) };
		const out = {};
		for (const k of Object.keys(v)) out[k] = show(v[k], depth + 1);
		return out;
	}
	return String(v);
};
const probe = (fn) => { try { return { ok: show(fn()) }; } catch (e) { return { threw: show(e) }; } };

/** prototype chain of a context object: class name + own member names per level */
function protoChain(obj, stopAt = 'Object') {
	const levels = [];
	let p = obj && Object.getPrototypeOf(obj);
	while (p && p.constructor && p.constructor.name !== stopAt) {
		levels.push({
			class: p.constructor.name,
			members: Object.getOwnPropertyNames(p).filter((n) => n !== 'constructor').sort(),
		});
		p = Object.getPrototypeOf(p);
	}
	return levels;
}

/** compact, comparable summary of one whole run (JSON-safe, no show() so arrays stay readable) */
function summarizeRun(run) {
	const rd = run.data ? run.data.resultData : undefined;
	if (!rd) return { status: run.status, noResultData: true };
	const perNode = {};
	for (const [name, tasks] of Object.entries(rd.runData || {})) {
		perNode[name] = {
			runs: tasks.length,
			tasks: tasks.map((t) => ({
				st: t.executionStatus,
				ei: t.executionIndex,
				hints: t.hints && t.hints.length ? t.hints : undefined,
				metadata: t.metadata ? Object.keys(t.metadata).sort() : undefined,
				inputOverride: t.inputOverride ? Object.keys(t.inputOverride).sort() : undefined,
				// branch item counts; null branch stays null, "no data at all" stays undefined
				data: t.data ? Object.fromEntries(Object.entries(t.data).map(([k, br]) => [k, br.map((b) => (b === null ? null : b.length))])) : undefined,
				dataJson: t.data && t.data.main ? t.data.main.map((b) => (b === null ? null : b.map((it) => it.json))) : undefined,
				source: t.source ? t.source.map((s) => (s ? { prev: s.previousNode, out: s.previousNodeOutput, run: s.previousNodeRun } : null)) : undefined,
				pairedItem: t.data && t.data.main ? t.data.main.map((b) => (b === null ? null : b.map((it) => (it.pairedItem === undefined ? 'absent' : it.pairedItem)))) : undefined,
				error: t.error ? { name: t.error.name || t.error.constructor.name, message: t.error.message, keys: Object.keys(t.error).sort(), isErrorInstance: t.error instanceof Error, description: t.error.description, contextKeys: t.error.context ? Object.keys(t.error.context).sort() : undefined, hasCause: t.error.cause !== undefined } : undefined,
				hasExecutionTime: typeof t.executionTime,
			})),
		};
	}
	return {
		status: run.status,
		finished: run.finished,
		mode: run.mode,
		lastNodeExecuted: rd.lastNodeExecuted,
		runDataKeys: Object.keys(rd.runData || {}),
		workflowIssueNodes: rd.workflowIssues ? Object.keys(rd.workflowIssues) : undefined,
		resultError: rd.error ? { name: rd.error.name || rd.error.constructor.name, message: rd.error.message, isErrorInstance: rd.error instanceof Error, description: rd.error.description, contextKeys: rd.error.context ? Object.keys(rd.error.context).sort() : undefined, extraKeys: rd.error.extra ? Object.keys(rd.error.extra).sort() : undefined } : undefined,
		runExecutionDataTopKeys: run.data ? Object.keys(run.data).sort() : undefined,
		resultDataKeys: Object.keys(rd).sort(),
		perNode,
		startData: run.data && run.data.startData ? { destination: run.data.startData.destinationNode || null, runNodeFilter: run.data.startData.runNodeFilter || null } : undefined,
		waitTill: run.data && run.data.waitTill ? 'set' : undefined,
	};
}

const CAPTURE = [];

// ---------- optional byte-stable mirror (drift gate) ---------------------------------------
// Reviewer request (agent-4, consensus record for TASK-PIPE-12/13): make the evidence file
// diff-able by a gate instead of only "MATCH after masking". AGENT6_STABLE=<path> writes a second,
// masked JSON whose bytes are reproducible across runs and machines, so
//   node <runner> --check /dev/null   style gates can diff it against the committed file.
// The raw file stays authoritative (it holds the real pid/PID-style findings); the masked mirror is
// derived from it, and the mask list is exactly the one engine-determinism-check.cjs uses.
const STABLE_OUT = process.env.AGENT6_STABLE || null;
const { toStable } = require(path.join(__dirname, 'make-stable.cjs'));
// AGENT6_ONLY='L,M' restricts the run to those groups (used to bisect a hang); default = all.
const ONLY = (process.env.AGENT6_ONLY || '').split(',').map((x) => x.trim()).filter(Boolean);
const want = (g) => ONLY.length === 0 || ONLY.some((x) => x.toUpperCase() === g);

// ---------- instrumented node types ------------------------------------------------------
const strProps = (...names) => names.map((n) => ({ displayName: n, name: n, type: 'string', default: '' }));

registry['ref.ctxProbe'] = {
	description: {
		displayName: 'ctxProbe', name: 'ctxProbe', group: ['transform'], version: 1, description: '',
		defaults: { name: 'ctxProbe' }, inputs: ['main'], outputs: ['main'],
		properties: [...strProps('value'), { displayName: 'flag', name: 'flag', type: 'boolean', default: false }],
	},
	async execute() {
		const ctx = this;
		const rec = { label: ctx.getNode().name, class: ctx.constructor.name, protoChain: protoChain(ctx), fields: {}, methods: {} };
		// own instance fields = the scoping coordinates the engine assembled for this node run
		for (const k of Object.keys(ctx).sort()) {
			const v = ctx[k];
			if (v === null || ['string', 'boolean', 'number'].includes(typeof v)) rec.fields[k] = v;
			else if (typeof v === 'function') rec.fields[k] = { __type: 'function' };
			else if (Array.isArray(v)) rec.fields[k] = { __type: 'array', length: v.length };
			else if (v && typeof v === 'object') rec.fields[k] = { __type: 'object', keys: Object.keys(v).slice(0, 14) };
			else rec.fields[k] = String(v);
		}
		const call = (name, ...args) => { try { return show(ctx[name](...args)); } catch (e) { return { threw: show(e) }; } };
		const read = (name) => { try { return show(ctx[name]); } catch (e) { return { threw: show(e) }; } };
		rec.methods = {
			getMode: call('getMode'), getExecutionId: call('getExecutionId'), getExecutionContext: call('getExecutionContext'),
			workflowName: (() => { try { return ctx.getWorkflow().name; } catch (e) { return { threw: show(e) }; } })(),
			timezone: call('getTimezone'), workflowSettings: call('getWorkflowSettings'),
			nodeTypeDescriptionName: (() => { try { return ctx.nodeType.description.name; } catch (e) { return { threw: show(e) }; } })(),
			nodeInputsGetter: read('nodeInputs'), nodeOutputsGetter: read('nodeOutputs'),
			getNodeInputs: call('getNodeInputs'), getNodeOutputs: call('getNodeOutputs'),
			knownNodeTypesRaw: (() => { try { const k = ctx.getKnownNodeTypes(); return { type: typeof k, isFunction: typeof k === 'function' ? 'function' : undefined, keys: k && typeof k === 'object' ? Object.keys(k) : undefined }; } catch (e) { return { threw: show(e) }; } })(),
			getChildNodes: call('getChildNodes', ctx.getNode().name),
			getParentNodes: call('getParentNodes', ctx.getNode().name),
			getConnectedNodes: call('getConnectedNodes', 'main'),
			isToolExecution: call('isToolExecution'), continueOnFail: call('continueOnFail'), isStreaming: call('isStreaming'),
			getInputDataLen: (() => { try { const d = ctx.getInputData(0); return Array.isArray(d) ? d.length : { note: 'single-item form', json: d.json }; } catch (e) { return { threw: show(e) }; } })(),
			getInputConnectionData: (() => { try { return { type: typeof ctx.getInputConnectionData }; } catch (e) { return { threw: show(e) }; } })(),
			getInputSourceData: call('getInputSourceData'),
			currentNodeExecutionIndexOnAdditionalData: (() => { try { return ctx.additionalData.currentNodeExecutionIndex; } catch (e) { return { threw: show(e) }; } })(),
			getExecuteDataKeys: (() => { try { const d = ctx.getExecuteData(); return d ? Object.keys(d).sort() : { __type: 'undefined' }; } catch (e) { return { threw: show(e) }; } })(),
			cancelSignal: (() => { try { const s = ctx.getExecutionCancelSignal(); return s ? { aborted: s.aborted, ctor: s.constructor.name } : { __type: 'undefined' }; } catch (e) { return { threw: show(e) }; } })(),
			onExecutionCancellation: (() => { try { return { type: typeof ctx.onExecutionCancellation }; } catch (e) { return { threw: show(e) }; } })(),
			workflowStaticData: (() => { try { return { type: typeof ctx.getWorkflowStaticData('node') }; } catch (e) { return { threw: show(e) }; } })(),
			restApiUrl: call('getRestApiUrl'), instanceBaseUrl: call('getInstanceBaseUrl'), instanceIdPresent: (() => { try { return typeof ctx.getInstanceId() === 'string'; } catch (e) { return { threw: show(e) }; } })(),
			proxyOwnKeys: (() => { try { return Object.keys(ctx.getWorkflowDataProxy(0)).sort(); } catch (e) { return { threw: show(e) }; } })(),
			additionalKeysKeys: (() => { try { return Object.keys(ctx.additionalKeys).sort(); } catch (e) { return { threw: show(e) }; } })(),
			helpersKeys: (() => { try { return Object.keys(ctx.helpers).sort(); } catch (e) { return { threw: show(e) }; } })(),
			nodeHelpersKeys: (() => { try { return Object.keys(ctx.nodeHelpers).sort(); } catch (e) { return { threw: show(e) }; } })(),
			hintsArray: (() => { try { return Array.isArray(ctx.hints) ? { isArray: true, length: ctx.hints.length } : show(ctx.hints); } catch (e) { return { threw: show(e) }; } })(),
			runnerStatus: call('getRunnerStatus', 'local'),
			addInputData: (() => { try { return show(ctx.addInputData()); } catch (e) { return { threw: show(e) }; } })(),
			addOutputData: (() => { try { return { returned: show(ctx.addOutputData()) }; } catch (e) { return { threw: show(e) }; } })(),
			getNodeParameter_value: (() => { try { return call('getNodeParameter', 'value', 0); } catch (e) { return { threw: show(e) }; } })(),
			evaluateExpression_itemIndex: (() => { try { return call('evaluateExpression', '{{ $itemIndex }}', 0); } catch (e) { return { threw: show(e) }; } })(),
		};
		// what the engine-side context supplies to WorkflowDataProxy (the TASK-PIPE-13 hand-off)
		rec.proxySurfaceFromEngine = (() => {
			const idx = rec.fields.itemIndex !== undefined ? rec.fields.itemIndex : 0;
			const p = ctx.getWorkflowDataProxy(idx);
			const out = {};
			for (const k of ['$itemIndex', '$runIndex', '$mode', '$position', '$workflow', '$prevNode', '$nodeVersion', '$nodeId', '$execution', '$executionId', '$config']) {
				try { out[k] = show(p[k]); } catch (e) { out[k] = { threw: show(e) }; }
			}
			try { out['$json'] = show(p.$json); } catch (e) { out['$json'] = { threw: show(e) }; }
			try { out['$inputKeys'] = Object.keys(p.$input ?? {}); } catch (e) { out['$inputKeys'] = { threw: show(e) }; }
			try { out['$executionRunningMode'] = p.$execution && p.$execution.mode; } catch (e) { out['$executionRunningMode'] = { threw: show(e) }; }
			return out;
		})();
		CAPTURE.push(rec);
		return [this.getInputData()];
	},
};

registry['ref.hintNode'] = {
	description: { displayName: 'hintNode', name: 'hintNode', group: ['transform'], version: 1, description: '', defaults: { name: 'hintNode' }, inputs: ['main'], outputs: ['main'], properties: [] },
	async execute() { this.addExecutionHints({ message: 'engine-probe hint', type: 'warning', location: 'outputPane' }); return [this.getInputData()]; },
};
registry['ref.throwsOnce'] = {
	description: { displayName: 'throwsOnce', name: 'throwsOnce', group: ['transform'], version: 1, description: '', defaults: { name: 'throwsOnce' }, inputs: ['main'], outputs: ['main'], properties: [] },
	attempts: 0,
	async execute() {
		registry['ref.throwsOnce'].attempts++;
		if (registry['ref.throwsOnce'].attempts < 2) throw new Error('transient boom');
		return [[{ json: { recoveredAfterAttempts: registry['ref.throwsOnce'].attempts } }]];
	},
};
registry['ref.throwsAlways'] = {
	description: { displayName: 'throwsAlways', name: 'throwsAlways', group: ['transform'], version: 1, description: '', defaults: { name: 'throwsAlways' }, inputs: ['main'], outputs: ['main'], properties: [] },
	async execute() { throw new Error('permanent boom'); },
};
registry['ref.returnNull'] = {
	description: { displayName: 'returnNull', name: 'returnNull', group: ['transform'], version: 1, description: '', defaults: { name: 'returnNull' }, inputs: ['main'], outputs: ['main'], properties: [] },
	async execute() { return null; },
};
registry['ref.emptyOut'] = {
	description: { displayName: 'emptyOut', name: 'emptyOut', group: ['transform'], version: 1, description: '', defaults: { name: 'emptyOut' }, inputs: ['main'], outputs: ['main'], properties: [] },
	async execute() { return [[]]; },
};
registry['ref.errorInJson'] = {
	description: { displayName: 'errorInJson', name: 'errorInJson', group: ['transform'], version: 1, description: '', defaults: { name: 'errorInJson' }, inputs: ['main'], outputs: ['main'], properties: [] },
	async execute() { return [[{ json: { error: 'soft failure' } }]]; },
};
registry['ref.setMeta'] = {
	description: { displayName: 'setMeta', name: 'setMeta', group: ['transform'], version: 1, description: '', defaults: { name: 'setMeta' }, inputs: ['main'], outputs: ['main'], properties: [] },
	async execute() { this.setMetadata({ subExecutionRef: 'sub-1', customKey: 'customValue' }); return [this.getInputData()]; },
};
registry['ref.nodeOpThrows'] = {
	description: { displayName: 'nodeOpThrows', name: 'nodeOpThrows', group: ['transform'], version: 1, description: '', defaults: { name: 'nodeOpThrows' }, inputs: ['main'], outputs: ['main'], properties: [] },
	async execute() {
		throw new NodeOperationError(this.getNode(), 'node-op boom', {
			description: 'a human readable hint',
			context: { parameter: 'value', itemIndex: 0 },
			functionality: 'execution',
		});
	},
};
// arms for 403L/403M: waiting + poll/trigger/webhook dispatch
registry['ref.waitOnce'] = {
	description: { displayName: 'waitOnce', name: 'waitOnce', group: ['transform'], version: 1, description: '', defaults: { name: 'waitOnce' }, inputs: ['main'], outputs: ['main'], properties: [] },
	waited: false,
	async execute() {
		if (!registry['ref.waitOnce'].waited) {
			registry['ref.waitOnce'].waited = true;
			await this.putExecutionToWait(new Date(Date.now() + 60));
			return [this.getInputData()];
		}
		return [[{ json: { resumedAfterWait: true } }]];
	},
};
registry['ref.poller'] = {
	description: { displayName: 'poller', name: 'poller', group: ['transform'], version: 1, description: '', defaults: { name: 'poller' }, inputs: ['main'], outputs: ['main'], properties: [] },
	async poll() {
		const ctx = this;
		return [[{ json: { arm: 'poll', ctxClass: ctx.constructor.name, mode: ctx.getMode(), node: ctx.getNode().name } }]];
	},
};
registry['ref.triggerNode'] = {
	description: { displayName: 'triggerNode', name: 'triggerNode', group: ['transform'], version: 1, description: '', defaults: { name: 'triggerNode' }, inputs: [], outputs: ['main'], properties: [] },
	async trigger() { return [[{ json: { arm: 'trigger' } }]]; },
};
registry['ref.webhookNode'] = {
	description: { displayName: 'webhookNode', name: 'webhookNode', group: ['transform'], version: 1, description: '', defaults: { name: 'webhookNode' }, inputs: ['main'], outputs: ['main'], properties: [] },
	async execute() { return [[{ json: { arm: 'execute-on-webhook-node' } }]]; },
};
registry['ref.requiredParam'] = {
	description: { displayName: 'requiredParam', name: 'requiredParam', group: ['transform'], version: 1, description: '', defaults: { name: 'requiredParam' }, inputs: ['main'], outputs: ['main'], properties: [{ displayName: 'Must', name: 'must', type: 'string', required: true, default: '' }] },
	async execute() { return [this.getInputData()]; },
};
registry['ref.twoMainOutputs'] = {
	description: { displayName: 'twoMainOutputs', name: 'twoMainOutputs', group: ['transform'], version: 1, description: '', defaults: { name: 'twoMainOutputs' }, inputs: ['main'], outputs: ['main', 'main'], properties: [] },
	async execute() {
		const inItems = this.getInputData();
		const ok = [], bad = [];
		inItems.forEach((it, i) => {
			if (i % 2 === 0) ok.push({ json: it.json, pairedItem: { item: i } });
			else bad.push({ json: { error: 'item ' + i + ' failed' }, pairedItem: { item: i } });
		});
		return [ok, bad];
	},
};
registry['ref.asyncDelay'] = {
	description: { displayName: 'asyncDelay', name: 'asyncDelay', group: ['transform'], version: 1, description: '', defaults: { name: 'asyncDelay' }, inputs: ['main'], outputs: ['main'], properties: [] },
	async execute() { await new Promise((r) => setTimeout(r, 40)); return [this.getInputData()]; },
};

const mkWf = (nodes, connections, settings) => ({
	id: 'eng', name: 'eng', settings: { executionOrder: 'v1', ...(settings || {}) }, nodes, connections,
});
const nd = (name, type, flags, parameters) => ({ id: name, name, type, typeVersion: 1, position: [0, 0], parameters: parameters || {}, ...(flags || {}) });
const chain = (specs, settings) => mkWf(
	specs.map((s) => nd(s.name, s.type, s.flags, s.parameters)),
	Object.fromEntries(specs.slice(0, -1).map((s, i) => [s.name, { main: [[{ node: specs[i + 1].name, type: 'main', index: 0 }]] }])),
	settings,
);
const lin = (names, extra = {}) => chain(names.map((n) => ({ name: n.name, type: n.type, flags: n.flags, parameters: n.parameters })), extra.settings);
const items = (n) => Array.from({ length: n }, (_, i) => ({ json: { n: i } }));

(async () => {
	const out = { meta: { generatedAt: new Date().toISOString(), runtime: { 'n8n-core': require('n8n-core/package.json').version, 'n8n-workflow': require('n8n-workflow/package.json').version }, node: process.version } };

	// ---------- A: the context object the engine hands to a node ---------------------------
	CAPTURE.length = 0;
	const runA = await runWorkflow(lin([
		{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' },
		{ name: 'Probe', type: 'ref.ctxProbe', parameters: { value: '={{ 1 + 1 }}', flag: true } },
	]), { startItems: items(3), executionId: 'eng-manual-1' });
	out['403A_context_surface'] = {
		capturedContexts: CAPTURE.length,
		context: CAPTURE[0],
		note: 'ExecuteContext (index-based) is what WorkflowExecute.executeNode() builds (workflow-execute.ts:1020); ExecuteSingleContext is only built for routing-node sub-executions (routing-node.ts:93).',
		run: summarizeRun(runA),
	};

	// ---------- A2: same probe, but no executionId in additionalData -----------------------
	CAPTURE.length = 0;
	await runWorkflow(lin([
		{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' },
		{ name: 'Probe', type: 'ref.ctxProbe' },
	]), { startItems: items(1) });
	out['403A2_context_surface_without_executionId'] = {
		getExecutionId: CAPTURE[0].methods.getExecutionId,
		executionProxy: CAPTURE[0].proxySurfaceFromEngine['$execution'],
		executionIdProxy: CAPTURE[0].proxySurfaceFromEngine['$executionId'],
	};

	// ---------- B: one context per node run, index-based (no per-item context) -------------
	CAPTURE.length = 0;
	await runWorkflow(lin([
		{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' },
		{ name: 'P1', type: 'ref.ctxProbe' },
		{ name: 'P2', type: 'ref.ctxProbe' },
	]), { startItems: items(4), executionId: 'eng-b' });
	out['403B_one_context_per_node_run'] = {
		contextCount: CAPTURE.length,
		identities: CAPTURE.map((c) => ({
			node: c.label, runIndex: c.fields.runIndex,
			itemIndexField: c.fields.itemIndex === undefined ? 'absent — ExecuteContext resolves the item lazily via getNodeParameter(name, itemIndex)' : c.fields.itemIndex,
			inputDataLen: c.methods.getInputDataLen, connectionInputDataLen: c.fields.connectionInputData ? c.fields.connectionInputData.length : undefined,
			proxyItemIndex: c.proxySurfaceFromEngine['$itemIndex'],
		})),
	};

	// ---------- C: per-node lifecycle matrix ------------------------------------------------
	registry['ref.throwsOnce'].attempts = 0;
	const scenarios = {
		linear_success: () => runWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'A', type: 'ref.passthrough' }, { name: 'B', type: 'ref.passthrough' },
		]), { startItems: items(2) }),
		disabled_node_passes_input_through: () => runWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Off', type: 'ref.throwsAlways', flags: { disabled: true } }, { name: 'B', type: 'ref.passthrough' },
		]), { startItems: items(2) }),
		throw_stops_workflow: () => runWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Boom', type: 'ref.throwsAlways' }, { name: 'After', type: 'ref.passthrough' },
		]), { startItems: items(2) }),
		throw_continueOnFail_passthrough: () => runWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Boom', type: 'ref.throwsAlways', flags: { continueOnFail: true } }, { name: 'After', type: 'ref.passthrough' },
		]), { startItems: items(2) }),
		returns_null_ends_branch: () => runWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'N', type: 'ref.returnNull' }, { name: 'After', type: 'ref.passthrough' },
		]), { startItems: items(2) }),
		empty_branch_output: () => runWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Empty', type: 'ref.emptyOut' }, { name: 'After', type: 'ref.passthrough' },
		]), { startItems: items(2) }),
		alwaysOutputData_on_empty: () => runWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Empty', type: 'ref.emptyOut', flags: { alwaysOutputData: true } }, { name: 'After', type: 'ref.passthrough' },
		]), { startItems: items(3) }),
		error_in_json_soft_failure: () => runWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Soft', type: 'ref.errorInJson', flags: { retryOnFail: false } }, { name: 'After', type: 'ref.passthrough' },
		]), { startItems: items(1) }),
		retryOnFail_recovers: () => runWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Flaky', type: 'ref.throwsOnce', flags: { retryOnFail: true, maxTries: 2, waitBetweenTries: 1 } }, { name: 'After', type: 'ref.passthrough' },
		]), { startItems: items(1) }),
		executeOnce_slices_inputs: () => runWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Once', type: 'ref.aggregate', flags: { executeOnce: true } },
		]), { startItems: items(4) }),
		no_executeOnce_sees_all: () => runWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'All', type: 'ref.aggregate' },
		]), { startItems: items(4) }),
		pinned_middle_manual: () => runWorkflow({
			...lin([{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Pin', type: 'ref.throwsAlways' }, { name: 'After', type: 'ref.passthrough' }]),
			pinData: { Pin: [{ json: { pinned: true } }] },
		}, { startItems: items(2), mode: 'manual' }),
		pinned_middle_cli: () => runWorkflow({
			...lin([{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Pin', type: 'ref.throwsAlways' }, { name: 'After', type: 'ref.passthrough' }]),
			pinData: { Pin: [{ json: { pinned: true } }] },
		}, { startItems: items(2), mode: 'cli' }),
		pinned_disabled_node_ignored: () => runWorkflow({
			...lin([{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Pin', type: 'ref.throwsAlways', flags: { disabled: true } }, { name: 'After', type: 'ref.passthrough' }]),
			pinData: { Pin: [{ json: { pinned: true } }] },
		}, { startItems: items(2), mode: 'manual' }),
		setMetadata_lands_in_task: () => runWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Meta', type: 'ref.setMeta' },
		]), { startItems: items(1) }),
		hints_landed_on_task: () => runWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Hint', type: 'ref.hintNode' },
		]), { startItems: items(1) }),
		pairedItem_autofix_single_input_output: () => runWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Map', type: 'ref.mapNoPair' }, { name: 'After', type: 'ref.passthrough' },
		]), { startItems: items(3) }),
		pairedItem_breaks_on_cardinality_mismatch: () => runWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Exp', type: 'ref.explodeNoPair' }, { name: 'After', type: 'ref.passthrough' },
		]), { startItems: items(2) }),
		multi_input_merge_waits: () => runWorkflow(mkWf(
			[nd('S1', 'n8n-nodes-base.manualTrigger'), nd('L', 'ref.passthrough'), nd('R', 'ref.passthrough'), nd('Merge', 'ref.aggregate')],
			{ S1: { main: [[{ node: 'L', type: 'main', index: 0 }, { node: 'R', type: 'main', index: 0 }]] }, L: { main: [[{ node: 'Merge', type: 'main', index: 0 }]] }, R: { main: [[{ node: 'Merge', type: 'main', index: 1 }]] } },
		), { startItems: items(2) }),
		fan_out_runIndex_per_branch: () => runWorkflow(mkWf(
			[nd('Start', 'n8n-nodes-base.manualTrigger'), nd('Split', 'ref.split2'), nd('Left', 'ref.passthrough'), nd('Right', 'ref.passthrough'), nd('Join', 'ref.aggregate')],
			{ Start: { main: [[{ node: 'Split', type: 'main', index: 0 }]] }, Split: { main: [[{ node: 'Left', type: 'main', index: 0 }], [{ node: 'Right', type: 'main', index: 0 }]] }, Left: { main: [[{ node: 'Join', type: 'main', index: 0 }]] }, Right: { main: [[{ node: 'Join', type: 'main', index: 1 }]] } },
		), { startItems: items(2) }),
		node_op_error_recorded_in_task: () => runWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Op', type: 'ref.nodeOpThrows' },
		]), { startItems: items(1) }),
		legacy_order_v0_linear: () => runWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'A', type: 'ref.passthrough' }, { name: 'B', type: 'ref.passthrough' },
		], { executionOrder: 'v0' }), { startItems: items(2) }),
		legacy_order_v0_fan_out: () => runWorkflow(mkWf(
			[nd('Start', 'n8n-nodes-base.manualTrigger'), nd('Split', 'ref.split2'), nd('Left', 'ref.passthrough'), nd('Right', 'ref.passthrough')],
			{ Start: { main: [[{ node: 'Split', type: 'main', index: 0 }]] }, Split: { main: [[{ node: 'Left', type: 'main', index: 0 }], [{ node: 'Right', type: 'main', index: 0 }]] } },
			{ executionOrder: 'v0' },
		), { startItems: items(2) }),
		empty_branch_v0: () => runWorkflow(chain([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Empty', type: 'ref.emptyOut' }, { name: 'After', type: 'ref.passthrough' },
		], { executionOrder: 'v0' }), { startItems: items(2) }),
	};
	const lifecycle = {};
	for (const [k, f] of Object.entries(scenarios)) {
		try { lifecycle[k] = summarizeRun(await f()); } catch (e) { lifecycle[k] = { threw: show(e) }; }
	}
	out['403C_lifecycle_matrix'] = lifecycle;

	// ---------- D: scheduling, executionIndex, destinationNode ------------------------------
	{
		const ad = () => ({
			credentialsHelper: {}, executeWorkflow: async () => { }, restApiUrl: '', instanceBaseUrl: '', webhookBaseUrl: '',
			webhookWaitingBaseUrl: '', webhookTestBaseUrl: '', formWaitingBaseUrl: '', userId: 'eng', variables: {},
			hooks: { runHook: async () => { } }, currentNodeExecutionIndex: 0, executionId: 'eng-d',
		});
		const seed = (n) => ({ name: 'Start', data: { startTime: 0, executionTime: 0, executionIndex: n, source: [], data: { main: [items(2)] } } });
		const wf = buildWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'A', type: 'ref.passthrough' }, { name: 'B', type: 'ref.passthrough' },
		]));
		const inclusive = await new WorkflowExecute(ad(), 'manual').run({ workflow: wf, startNode: wf.getNode('Start'), destinationNode: { nodeName: 'A', mode: 'inclusive' }, triggerToStartFrom: seed(0) });
		const wf2 = buildWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'A', type: 'ref.passthrough' }, { name: 'B', type: 'ref.passthrough' },
		]));
		const exclusive = await new WorkflowExecute(ad(), 'manual').run({ workflow: wf2, startNode: wf2.getNode('Start'), destinationNode: { nodeName: 'B', mode: 'exclusive' }, triggerToStartFrom: seed(0) });
		let noStartNode = null;
		try {
			const wfOnlyAction = buildWorkflow(mkWf([nd('A', 'ref.passthrough')], {}));
			noStartNode = { outcome: 'resolved ' + (await new WorkflowExecute(ad(), 'manual').run({ workflow: wfOnlyAction })).status };
		} catch (e) { noStartNode = { threw: show(e) }; }
		let noStartNodeTwoActionNodes = null;
		try {
			const wfNoStart = buildWorkflow(chain([{ name: 'A', type: 'ref.passthrough' }, { name: 'B', type: 'ref.passthrough' }]));
			noStartNodeTwoActionNodes = { outcome: 'resolved ' + (await new WorkflowExecute(ad(), 'manual').run({ workflow: wfNoStart })).status };
		} catch (e) { noStartNodeTwoActionNodes = { threw: show(e) }; }
		let noStartNodeManual = null;
		try {
			const wfTrg = buildWorkflow(mkWf([nd('T', 'n8n-nodes-base.manualTrigger')], {}));
			const r = await new WorkflowExecute(ad(), 'manual').run({ workflow: wfTrg });
			noStartNodeManual = { outcome: 'resolved', status: r.status, runDataKeys: Object.keys(r.data.resultData.runData || {}) };
		} catch (e) { noStartNodeManual = { threw: show(e) }; }
		CAPTURE.length = 0;
		const withProbe = buildWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'P1', type: 'ref.ctxProbe' }, { name: 'P2', type: 'ref.ctxProbe' }, { name: 'P3', type: 'ref.ctxProbe' },
		]));
		const ad3 = ad();
		await new WorkflowExecute(ad3, 'manual').run({ workflow: withProbe, startNode: withProbe.getNode('Start'), triggerToStartFrom: seed(0) });
		out['403D_scheduling'] = {
			destination_inclusive: summarizeRun(inclusive),
			destination_exclusive: summarizeRun(exclusive),
			missing_startNode_with_only_action_node: noStartNode,
			missing_startNode_two_action_nodes: noStartNodeTwoActionNodes,
			startNodeResolutionNote: 'Workflow.__getStartNode (workflow.ts:817) short-circuits when the graph has exactly one node, else it picks the first non-disabled trigger/poll type, else the first node whose type is in STARTING_NODE_TYPES (constants.ts:53 = manualTrigger, executeWorkflowTrigger, errorTrigger, evaluationTrigger, formTrigger); if nothing matches, run() throws.',
			missing_startNode_with_only_action_node_note: 'single-node short-circuit',
			missing_startNode_resolved_from_trigger: noStartNodeManual,
			executionIndex_sequence: CAPTURE.map((c) => ({ node: c.label, runIndex: c.fields.runIndex, currentNodeExecutionIndex: c.fields.currentNodeExecutionIndex })),
			additionalData_currentNodeExecutionIndex_after_run: ad3.currentNodeExecutionIndex,
			startNode_source_is_null: (() => {
				const t = inclusive.data.resultData.runData.Start[0];
				return { source: t.source === undefined ? 'undefined (not written)' : t.source, startTimePresent: typeof t.startTime, metadata: t.metadata === undefined ? 'undefined' : t.metadata };
			})(),
		};
	}

	// ---------- E: cancellation + timeout --------------------------------------------------
	{
		const ad = {
			credentialsHelper: {}, executeWorkflow: async () => { }, restApiUrl: '', instanceBaseUrl: '', webhookBaseUrl: '',
			webhookWaitingBaseUrl: '', webhookTestBaseUrl: '', formWaitingBaseUrl: '', userId: 'eng', variables: {},
			hooks: { runHook: async () => { } }, currentNodeExecutionIndex: 0, executionId: 'eng-cancel',
		};
		const wf = buildWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Slow', type: 'ref.asyncDelay' }, { name: 'After', type: 'ref.passthrough' },
		]));
		const p = new WorkflowExecute({ ...ad }, 'manual').run({
			workflow: wf, startNode: wf.getNode('Start'),
			triggerToStartFrom: { name: 'Start', data: { startTime: 0, executionTime: 0, executionIndex: 0, source: [], data: { main: [items(1)] } } },
		});
		let cancelResult = 'not attempted';
		try { p.cancel(); cancelResult = 'cancel() called before completion'; } catch (e) { cancelResult = 'threw ' + e.message; }
		let run = null, caught = null;
		try { run = await p; } catch (e) { caught = show(e); }
		out['403E_cancel'] = {
			cancelResult, hasCancelMethod: typeof p.cancel === 'function', caught,
			responseTopLevelKeys: run ? Object.keys(run).sort() : undefined,
			summary: run ? summarizeRun(run) : undefined,
		};
		const wf2 = buildWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'A', type: 'ref.passthrough' },
		]));
		let timedOut = null;
		try {
			const r = await new WorkflowExecute({ ...ad, executionTimeoutTimestamp: Date.now() - 1000 }, 'manual').run({
				workflow: wf2, startNode: wf2.getNode('Start'),
				triggerToStartFrom: { name: 'Start', data: { startTime: 0, executionTime: 0, executionIndex: 0, source: [], data: { main: [items(1)] } } },
			});
			timedOut = { responseKeys: Object.keys(r).sort(), status: r.status, timedOutFlag: r.timedOut, finished: r.finished, runDataKeys: Object.keys(r.data.resultData.runData || {}), resultError: r.data.resultData.error ? { name: r.data.resultData.error.name || r.data.resultData.error.constructor.name, message: r.data.resultData.error.message } : undefined };
		} catch (e) { timedOut = { threw: show(e) }; }
		out['403E_cancel.executionTimeoutTimestamp_in_the_past'] = timedOut;
	}

	// ---------- F: node flags do not change the context class, only the inputs -------------
	{
		CAPTURE.length = 0;
		await runWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' },
			{ name: 'OnceCtx', type: 'ref.ctxProbe', flags: { executeOnce: true } },
			{ name: 'RetryCtx', type: 'ref.ctxProbe', flags: { retryOnFail: true, maxTries: 1, waitBetweenTries: 0 } },
			{ name: 'ContCtx', type: 'ref.ctxProbe', flags: { continueOnFail: true } },
			{ name: 'ErrOutCtx', type: 'ref.ctxProbe', flags: { onError: 'continueErrorOutput' } },
		]), { startItems: items(3), executionId: 'eng-f' });
		out['403F_context_class_by_flags'] = {
			classes: CAPTURE.map((c) => ({ node: c.label, class: c.class, ownFieldCount: Object.keys(c.fields).length, continueOnFail: c.methods.continueOnFail, inputDataLen: c.methods.getInputDataLen })),
			note: 'executeOnce does not change the context class: handleExecuteOnce (workflow-execute.ts:990) slices every input branch to its first item instead. continueOnFail() on the context reports the node flag (base-execute-context.ts:85).',
		};
	}

	// ---------- G: the pre-run validation gate ---------------------------------------------
	{
		const ad = {
			credentialsHelper: {}, executeWorkflow: async () => { }, restApiUrl: '', instanceBaseUrl: '', webhookBaseUrl: '',
			webhookWaitingBaseUrl: '', webhookTestBaseUrl: '', formWaitingBaseUrl: '', userId: 'eng', variables: {},
			hooks: { runHook: async () => { } }, currentNodeExecutionIndex: 0, executionId: 'eng-g',
		};
		const gate = (wfJson, opts) => {
			const wf = buildWorkflow(wfJson);
			const we = new WorkflowExecute({ ...ad }, 'manual');
			try { return show(we.checkReadyForExecution(wf, opts || {})); } catch (e) { return { threw: show(e) }; }
		};
		out['403G_validation_gate'] = {
			unknown_node_type: gate(mkWf([nd('X', 'some.unknown.Type')], {})),
			missing_required_parameter: gate(mkWf([nd('M', 'ref.requiredParam')], {})),
			disabled_node_skipped: gate(mkWf([nd('D', 'some.unknown.Type', { disabled: true })], {})),
			pinned_node_exempt_when_pinDataNodeNames_given: gate(mkWf([nd('P', 'ref.requiredParam')], {}), { pinDataNodeNames: ['P'] }),
			pinned_node_reported_without_pinDataNodeNames: gate(mkWf([nd('P', 'ref.requiredParam')], {}), {}),
			destination_scoped_to_parents: gate(mkWf([nd('S', 'n8n-nodes-base.manualTrigger'), nd('A', 'ref.requiredParam'), nd('B', 'some.unknown.Type')], { S: { main: [[{ node: 'A', type: 'main', index: 0 }]] }, A: { main: [[{ node: 'B', type: 'main', index: 0 }]] } }), { destinationNode: { nodeName: 'A', mode: 'inclusive' } }),
			startNode_scoped_to_children: gate(mkWf([nd('S', 'some.unknown.Type'), nd('A', 'ref.requiredParam')], { S: { main: [[{ node: 'A', type: 'main', index: 0 }]] } }), { startNode: 'A' }),
			two_main_outputs_accepted: gate(mkWf([nd('T', 'ref.twoMainOutputs')], {})),
			onError_continueErrorOutput_on_single_output_node_gate: gate(mkWf(
				[nd('S', 'n8n-nodes-base.manualTrigger'), nd('B', 'ref.passthrough', { onError: 'continueErrorOutput' }), nd('A', 'ref.passthrough')],
				{ S: { main: [[{ node: 'B', type: 'main', index: 0 }]] }, B: { main: [[{ node: 'A', type: 'main', index: 0 }]] } },
			), {}),
		};
	}

	// ---------- H: error-output routing (handleNodeErrorOutput) ---------------------------
	{
		const errOutWf = mkWf(
			[nd('Start', 'n8n-nodes-base.manualTrigger'), nd('Split', 'ref.twoMainOutputs', { onError: 'continueErrorOutput' }), nd('OkPath', 'ref.passthrough'), nd('ErrPath', 'ref.passthrough')],
			{ Start: { main: [[{ node: 'Split', type: 'main', index: 0 }]] }, Split: { main: [[{ node: 'OkPath', type: 'main', index: 0 }], [{ node: 'ErrPath', type: 'main', index: 0 }]] } },
		);
		let routed = null;
		try { routed = summarizeRun(await runWorkflow(errOutWf, { startItems: items(4) })); } catch (e) { routed = { threw: show(e) }; }
		const errOutNoFlagWf = mkWf(
			[nd('Start', 'n8n-nodes-base.manualTrigger'), nd('Split', 'ref.twoMainOutputs'), nd('OkPath', 'ref.passthrough'), nd('ErrPath', 'ref.passthrough')],
			{ Start: { main: [[{ node: 'Split', type: 'main', index: 0 }]] }, Split: { main: [[{ node: 'OkPath', type: 'main', index: 0 }], [{ node: 'ErrPath', type: 'main', index: 0 }]] } },
		);
		let notFlagged = null;
		try { notFlagged = summarizeRun(await runWorkflow(errOutNoFlagWf, { startItems: items(4) })); } catch (e) { notFlagged = { threw: show(e) }; }
		out['403H_error_output_routing'] = {
			effective_outputs_of_the_two_branch_type: (() => {
				const wf = buildWorkflow(errOutWf);
				const node = wf.getNode('Split');
				const desc = wf.nodeTypes.getByNameAndVersion(node.type, node.typeVersion).description;
				const withFlag = NodeHelpers.getNodeOutputs(wf, node, desc);
				const wf2 = buildWorkflow(errOutNoFlagWf);
				const node2 = wf2.getNode('Split');
				return {
					withOnError_continueErrorOutput: show(withFlag),
					without_onError: show(NodeHelpers.getNodeOutputs(wf2, node2, desc)),
					note: 'onError: "continueErrorOutput" adds a synthetic extra main output, so mainOutputTypes.length - 1 (workflow-execute.ts:2551) is one index further than the node author returned.',
				};
			})(),
			two_branch_node_onError_continueErrorOutput: routed,
			two_branch_node_without_onError_flag: notFlagged,
		};
	}

	// ---------- I: runIndex per activation + what the proxy sees in each activation --------
	CAPTURE.length = 0;
	{
		const twoParentsIntoSameInput = mkWf(
			[nd('Start', 'n8n-nodes-base.manualTrigger'), nd('A', 'ref.passthrough'), nd('B', 'ref.passthrough'), nd('C', 'ref.ctxProbe')],
			{
				Start: { main: [[{ node: 'A', type: 'main', index: 0 }, { node: 'B', type: 'main', index: 0 }]] },
				A: { main: [[{ node: 'C', type: 'main', index: 0 }]] },
				B: { main: [[{ node: 'C', type: 'main', index: 0 }]] },
			},
		);
		let run = null;
		try { run = summarizeRun(await runWorkflow(twoParentsIntoSameInput, { startItems: items(2), executionId: 'eng-i' })); } catch (e) { run = { threw: show(e) }; }
		out['403I_runIndex_and_proxy_per_activation'] = {
			note: 'C is reachable from two parents on the same input index, so it is activated twice: runIndex is the position in runData[nodeName] (workflow-execute.ts:1560-1566).',
			run,
			activations: CAPTURE.map((c) => ({ node: c.label, runIndexField: c.fields.runIndex, proxy: c.proxySurfaceFromEngine })),
		};
	}

	// ---------- J: sibling ordering is decided by the node canvas position -----------------
	{
		const pos = (x, y) => ({ position: [x, y] });
		const build = (order) => mkWf(
			[
				{ ...nd('Start', 'n8n-nodes-base.manualTrigger'), ...pos(0, 0) },
				{ ...nd('Far', 'ref.passthrough'), ...pos(300, 300) },
				{ ...nd('Near', 'ref.passthrough'), ...pos(100, 100) },
				{ ...nd('Bottom', 'ref.passthrough'), ...pos(50, 500) },
			],
			{ Start: { main: [[{ node: 'Far', type: 'main', index: 0 }, { node: 'Near', type: 'main', index: 0 }, { node: 'Bottom', type: 'main', index: 0 }]] } },
			{ executionOrder: order },
		);
		let v1 = null, v0 = null;
		try { v1 = summarizeRun(await withTimeout(runWorkflow(build('v1'), { startItems: items(1) }), 5000, '403N v1')); } catch (e) { v1 = { threw: show(e) }; }
		try { v0 = summarizeRun(await withTimeout(runWorkflow(build('v0'), { startItems: items(1) }), 5000, '403N v0')); } catch (e) { v0 = { threw: show(e) }; }
		out['403J_sibling_order'] = {
			note: 'v1 sorts nodesToAdd by canvas position (workflow-execute.ts:2041) and enqueues with unshift (enqueueFn, workflow-execute.ts:418); v0 appends with push.',
			v1: { runDataKeys: v1.runDataKeys, executionIndexes: v1.perNode ? Object.fromEntries(Object.entries(v1.perNode).map(([k, t]) => [k, t.tasks[0].ei])) : v1 },
			v0: { runDataKeys: v0.runDataKeys, executionIndexes: v0.perNode ? Object.fromEntries(Object.entries(v0.perNode).map(([k, t]) => [k, t.tasks[0].ei])) : v0 },
		};
	}

	// ---------- K: the gate the engine itself applies before the loop ---------------------
	{
		const ad = {
			credentialsHelper: {}, executeWorkflow: async () => { }, restApiUrl: '', instanceBaseUrl: '', webhookBaseUrl: '',
			webhookWaitingBaseUrl: '', webhookTestBaseUrl: '', formWaitingBaseUrl: '', userId: 'eng', variables: {},
			hooks: { runHook: async () => { } }, currentNodeExecutionIndex: 0, executionId: 'eng-k',
		};
		const runIt = async (wfJson, opts) => {
			try { return summarizeRun(await runWorkflow(wfJson, Object.assign({ startItems: items(1) }, opts || {}))); } catch (e) { return { threw: show(e) }; }
		};
		const missingParam = () => chain([{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Req', type: 'ref.requiredParam' }]);
		const unknownType = () => chain([{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Un', type: 'some.unknown.Type' }]);
		const res = {};
		res['403K_pre_run_gate'] = {
			note: 'processRunExecutionData calls checkForWorkflowIssues (workflow-execute.ts:1407 -> 1316) which scopes checkReadyForExecution to the first stack node / destinationNode and exempts pinData nodes.',
			missing_required_parameter_blocks_run: await runIt(missingParam()),
			same_node_pinned_runs: await runIt({ ...missingParam(), pinData: { Req: [{ json: { ok: true } }] } }, { mode: 'manual' }),
			same_node_disabled_runs: await runIt(chain([{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Req', type: 'ref.requiredParam', flags: { disabled: true } }])),
			unknown_node_type_blocks_run: await runIt(unknownType()),
			gate_result_for_unknown_type_caller_supplied_startNode: (() => {
				const wf = buildWorkflow(unknownType());
				try { return show(new WorkflowExecute({ ...ad }, 'manual').checkReadyForExecution(wf, { startNode: 'Start' })); } catch (e) { return { threw: show(e) }; }
			})(),
			bare_gate_call_checks_nothing: (() => {
				const wf = buildWorkflow(unknownType());
				try { return show(new WorkflowExecute({ ...ad }, 'manual').checkReadyForExecution(wf, {})); } catch (e) { return { threw: show(e) }; }
			})(),
			issues_shape_for_missing_parameter: (() => {
				const wf = buildWorkflow(missingParam());
				try { return show(new WorkflowExecute({ ...ad }, 'manual').checkReadyForExecution(wf, { startNode: 'Start' })); } catch (e) { return { threw: show(e) }; }
			})(),
		};
		out['403K_pre_run_gate'] = res['403K_pre_run_gate'];
	}

	// ---------- L: waiting state and resume (handleWaitingState, workflow-execute.ts:1285) ----
	if (want('L')) {
		const ad = () => ({
			credentialsHelper: {}, executeWorkflow: async () => { }, restApiUrl: '', instanceBaseUrl: '', webhookBaseUrl: '',
			webhookWaitingBaseUrl: '', webhookTestBaseUrl: '', formWaitingBaseUrl: '', userId: 'eng', variables: {},
			hooks: { runHook: async () => { } }, currentNodeExecutionIndex: 0, executionId: 'eng-wait',
		});
		registry['ref.waitOnce'].waited = false;
		const mk = () => buildWorkflow(lin([
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Wait', type: 'ref.waitOnce' }, { name: 'After', type: 'ref.passthrough' },
		]));
		const wf1 = mk();
		const seed = { name: 'Start', data: { startTime: 0, executionTime: 0, executionIndex: 0, source: [], data: { main: [items(1)] } } };
		let first = null, firstRaw = null;
		try {
			firstRaw = await withTimeout(new WorkflowExecute(ad(), 'manual').run({ workflow: wf1, startNode: wf1.getNode('Start'), triggerToStartFrom: seed }), 6000, '403L first run');
			first = summarizeRun(firstRaw);
		} catch (e) { first = { threw: show(e) }; }
		let second = null;
		try {
			const wf2 = mk();
			const resumed = await withTimeout(new WorkflowExecute(ad(), 'manual', firstRaw ? firstRaw.data : undefined).processRunExecutionData(wf2), 6000, '403L resume');
			second = summarizeRun(resumed);
		} catch (e) { second = { threw: show(e) }; }
		out['403L_waiting_and_resume'] = {
			note: 'A node calling putExecutionToWait() (base-execute-context.ts:107) sets runExecutionData.waitTill, which the engine reads when it writes executionStatus; handleWaitingState then clears waitTill, disables the waiting node on the stack and pops the duplicated task.',
			first_run_ends_waiting: first,
			waitTill_present: first ? first.waitTill : undefined,
			stack_entry_after_wait: firstRaw && firstRaw.data && firstRaw.data.executionData
				? { stackLength: firstRaw.data.executionData.nodeExecutionStack.length, waitingNode: firstRaw.data.executionData.nodeExecutionStack[0] ? firstRaw.data.executionData.nodeExecutionStack[0].node.name : null, waitingNodeDisabled: firstRaw.data.executionData.nodeExecutionStack[0] ? firstRaw.data.executionData.nodeExecutionStack[0].node.disabled : null, waitingExecutionKeys: Object.keys(firstRaw.data.executionData.waitingExecution || {}) }
				: 'no executionData on the response',
			resume_run: second,
		};
	}

	// ---------- M: runNode dispatch arms (poll / trigger / webhook) -------------------------
	if (want('M')) {
		registry['ref.webhookNode'].webhook = { httpMethod: 'GET', responseMode: 'onReceived', path: 'probe' };
		const arms = {};
		arms.poll_manual_mode = await (async () => {
			try { return summarizeRun(await withTimeout(runWorkflow(lin([{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Poll', type: 'ref.poller' }]), { startItems: items(2), mode: 'manual' }), 5000, '403M poll/manual')); } catch (e) { return { threw: show(e) }; }
		})();
		arms.poll_cli_mode_passthrough = (() => {
			const f = async () => { try { return summarizeRun(await withTimeout(runWorkflow(lin([{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Poll', type: 'ref.poller' }]), { startItems: items(2), mode: 'cli' }), 5000, '403M poll/cli')); } catch (e) { return { threw: show(e) }; } };
			return f();
		})();
		arms.trigger_manual_mode_container = (() => {
			const f = async () => { try { return summarizeRun(await withTimeout(runWorkflow(mkWf([nd('T', 'ref.triggerNode')], {}), { mode: 'manual' }), 5000, '403M trigger/manual')); } catch (e) { return { threw: show(e) }; } };
			return f();
		})();
		arms.trigger_cli_mode_passthrough = (() => {
			const f = async () => { try { return summarizeRun(await withTimeout(runWorkflow(mkWf([nd('T', 'ref.triggerNode')], {}), { mode: 'cli' }), 5000, '403M trigger/cli')); } catch (e) { return { threw: show(e) }; } };
			return f();
		})();
		arms.webhook_node_without_requestDefaults = (() => {
			const f = async () => { try { return summarizeRun(await withTimeout(runWorkflow(lin([
				{ name: 'Start', type: 'n8n-nodes-base.manualTrigger' }, { name: 'W', type: 'ref.webhookNode' }, { name: 'After', type: 'ref.passthrough' },
			]), { startItems: items(3) }), 5000, '403M webhook')); } catch (e) { return { threw: show(e) }; } };
			return f();
		})();
		for (const [k, v] of Object.entries(arms)) arms[k] = await v;
		out['403M_dispatch_arms'] = {
			note: 'workflow-execute.ts:1237-1268: execute||customOperation -> executeNode, poll -> executePollNode (:1078, runs nodeType.poll only in manual mode), trigger -> executeTriggerNode (:1098, needs the DI TriggersAndPollers service), webhook without description.requestDefaults -> plain passthrough, else executeDeclarativeNodeInTest (:1151).',
			arms,
		};
	}

	// ---------- N: the endless-loop guard (workflow-execute.ts:1559-1584, 2315-2344) --------
	if (want('N')) {
		const build = (executionOrder) => mkWf(
			[nd('Start', 'n8n-nodes-base.manualTrigger'), nd('Nul', 'ref.returnNull'), nd('Child', 'ref.passthrough')],
			{ Start: { main: [[{ node: 'Nul', type: 'main', index: 0 }]] }, Nul: { main: [[{ node: 'Child', type: 'main', index: 0 }]] } },
			{ executionOrder },
		);
		let v1 = null, v0 = null;
		try { v1 = summarizeRun(await runWorkflow(build('v1'), { startItems: items(1) })); } catch (e) { v1 = { threw: show(e) }; }
		try { v0 = summarizeRun(await runWorkflow(build('v0'), { startItems: items(1) })); } catch (e) { v0 = { threw: show(e) }; }
		out['403N_endless_loop_guard'] = {
			mechanism: 'a parent returning null writes null into the single-input stack branch; ensureInputData (:2338-2343) only rejects a null branch in legacy order (isLegacyExecutionOrder), and it re-pushes the same entry (:2331). The loop guard (:1567) compares node:runIndex against lastExecutionTry, which is assigned only on that re-push path (:1582).',
			v1_child_runs_with_null_branch: v1.threw ? { threw: v1.threw } : { status: v1.status, runDataKeys: v1.runDataKeys, childTask: v1.perNode && v1.perNode.Child ? v1.perNode.Child.tasks[0].data : (v1.perNode ? 'Child absent from runData' : v1) },
			v0_guard_trips: v0.threw ? { threw: v0.threw } : { status: v0.status, runDataKeys: v0.runDataKeys, childTask: v0.perNode && v0.perNode.Child ? v0.perNode.Child.tasks[0].data : 'Child absent from runData' },
		};
	}

	out.fixture = {
		note: 'Node types registered by this runner into the harness registry only; nothing under tests/reference/** or reference/** was modified.',
		types: ['ref.ctxProbe', 'ref.hintNode', 'ref.throwsOnce', 'ref.throwsAlways', 'ref.returnNull', 'ref.emptyOut', 'ref.errorInJson', 'ref.setMeta', 'ref.asyncDelay', 'ref.twoMainOutputs'],
		harness: 'tests/reference/harness/harness.js (registry, buildWorkflow, runWorkflow)',
		harnessLimitation: 'runWorkflow(wf, {executionId}) forwards executionId into IWorkflowExecutionDataProcess.additionalData; omitting it reproduces $execution.id === "__UNKNOWN__" (see 403A2).',
	};

	const json = JSON.stringify(out, null, 2);
	const outFile = process.argv[2];
	if (outFile) fs.writeFileSync(outFile, json + '\n');
	else console.log(json);
	if (STABLE_OUT) fs.writeFileSync(STABLE_OUT, JSON.stringify(toStable(out), null, 2) + '\n');
	process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
