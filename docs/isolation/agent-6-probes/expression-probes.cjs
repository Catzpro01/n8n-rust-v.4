'use strict';
/**
 * Agent 6 — TASK-PIPE-12 / TASK-PIPE-13 observation probes.
 *
 * Drives the REAL n8n 2.9.4 runtime (n8n-workflow@2.9.1 / n8n-core@2.9.1) and records
 * observed behaviour of
 *   PIPE-12  the `{{ … }}` expression pipeline (chunking, tmpl codegen, sandbox, extensions)
 *   PIPE-13  WorkflowDataProxy variable lookup + scoping ($json/$binary/$node/$parameter/…)
 *
 * Nothing here re-implements n8n: every value in the output is what the runtime returned.
 * 503 entries are recorded (266 for PIPE-12, 214 for PIPE-13, 23 fixture entries); 418 of them are
 * outcome records (353 returned values, 65 typed throws), the rest being splitter/inventory rows. See README.md for the per-group breakdown and the determinism recipe.
 *
 * usage (from the repo root):
 *   NODE_PATH=$PWD/.runtime/node_modules \
 *     node docs/isolation/agent-6-probes/expression-probes.cjs [outfile.json]
 *   env: AGENT6_REPO (repo root), AGENT6_HARNESS (default <repo>/tests/reference/harness/harness.js)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = process.env.AGENT6_REPO || path.resolve(__dirname, '..', '..', '..');
process.env.N8N_USER_FOLDER = process.env.N8N_USER_FOLDER || path.join(os.tmpdir(), 'n8n-agent6-probe');
process.env.N8N_LOG_LEVEL = 'silent';

const { Workflow, WorkflowDataProxy, Expression, ExpressionParser } = require('n8n-workflow');
const ext = require('n8n-workflow/dist/cjs/extensions/expression-extension.js');
const tournamentSplitter = require('@n8n/tournament/dist/ExpressionSplitter.js');
const { WorkflowExecute } = require('n8n-core');
const HARNESS = process.env.AGENT6_HARNESS || path.join(REPO, 'tests/reference/harness/harness.js');
const { buildWorkflow, registry } = require(HARNESS);

(async () => {
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
	if (typeof v === 'object' && v.constructor && v.constructor.name === 'DateTime') {
		return { __type: 'luxon.DateTime', iso: v.toISO(), invalidReason: v.invalidReason ?? undefined };
	}
	if (Array.isArray(v)) {
		if (depth > 4) return { __type: 'array', length: v.length };
		return v.map((i) => show(i, depth + 1));
	}
	if (v instanceof Map) return { __type: 'Map', entries: [...v.entries()].map(([k, x]) => [String(k), show(x, depth + 1)]) };
	if (v instanceof Set) return { __type: 'Set', values: [...v].map((x) => show(x, depth + 1)) };
	if (depth > 4) return { __type: 'object', keys: Object.keys(v) };
	const out = {};
	for (const k of Object.keys(v)) out[k] = show(v[k], depth + 1);
	return out;
};

const probe = (fn) => {
	try {
		return { ok: show(fn()) };
	} catch (e) {
		return { threw: show(e) };
	}
};

const probeAll = (obj) => Object.fromEntries(Object.entries(obj).map(([k, f]) => [k, probe(f)]));

// ---------- 12-A: chunk splitting (the pipeline has TWO different splitters) ------------
const CHUNK_INPUTS = [
	'{{a}}',
	'a{{b}}c',
	'{{a}}{{b}}',
	'{{ a }}',
	'\\{{a}}',
	'\\\\{{a}}',
	'\\\\\\{{a}}',
	'{{a}',
	'a}}',
	'{{}}',
	'{{ }}',
	'{{ }}{{ }}',
	'a\\}}b',
	'{{"{{"}}',
	'{{"}}}}',
	'{{a\nb}}',
	'x{{1',
	'{{1}}x',
	'\\',
	'\\\\',
	'a\\\\b{{1}}',
	'a\\\\b',
];

const chunking = {};
for (const input of CHUNK_INPUTS) {
	chunking[JSON.stringify(input)] = {
		n8n: probe(() => ExpressionParser.splitExpression(input)),
		tournament: probe(() => tournamentSplitter.splitExpression(input)),
		roundTripN8n: probe(() => ExpressionParser.joinExpression(ExpressionParser.splitExpression(input))),
	};
}

// ---------- 12-B: template evaluation semantics (tournament, no data proxy) -------------
const TMPL_CASES = {
	num: '{{1}}',
	str: '{{"x"}}',
	arr: '{{ [1,2] }}',
	obj: '{{ {a:1} }}',
	bool: '{{ true }}',
	null: '{{ null }}',
	undefined_lit: '{{ undefined }}',
	nan: '{{ NaN }}',
	infinity: '{{ 1/0 }}',
	concat_text_code: '{{"a"}}{{"b"}}',
	prefix_text: 'x{{1}}',
	suffix_text: '{{1}}x',
	missing_in_text: 'x{{undefined}}y',
	null_in_text: 'x{{null}}y',
	false_in_text: 'x{{false}}y',
	zero_in_text: 'x{{0}}y',
	obj_in_text: 'x{{ {a:1} }}y',
	empty_code_only: '{{}}',
	empty_code_in_text: 'x{{}}y',
	unclosed_code: 'x{{1',
	unknown_ident: '{{notDefined}}',
	unknown_ident_in_text: 'x{{notDefined}}y',
	member_missing: '{{ $json.missing.deep }}',
	member_missing_in_text: 'x{{ $json.missing.deep }}y',
	template_string: '{{ `a${1}b` }}',
	iife: '{{ (() => 42)() }}',
	iife_throw: '{{ (() => { throw new Error("boom") })() }}',
	iife_throw_in_text: 'x{{ (() => { throw new Error("boom") })() }}y',
	callback_throw: '{{ [1].map(function(){ throw new Error("x") })[0] }}',
	add_object: '{{ 1 + {} }}',
	typeof_undef: '{{ typeof notDefined }}',
	sequence: '{{ (1, 2) }}',
	new_date: '{{ new Date(0).toISOString() }}',
	trailing_semicolon: '{{ 1 + 1; }}',
	multiline: '{{ 1 +\n2 }}',
	syntax_error: '{{ 1 + }}',
	syntax_error_dot: '{{ . }}',
	syntax_error_member: '{{ a. }}',
	assignment: '{{ a = 1 }}',
	assignment_then_use: '{{ ((a=1), a) }}',
};
const tmpl = probeAll(
	Object.fromEntries(Object.entries(TMPL_CASES).map(([k, v]) => [k, () => Expression.resolveWithoutWorkflow(v)])),
);

// ---------- 12-B2: the same inputs through the public parameter pipeline -----------------
const tinyWf = () =>
	buildWorkflow({ nodes: [{ id: 'A', name: 'A', type: 'ref.passthrough', typeVersion: 1, position: [0, 0], parameters: {} }], connections: {} });
const evalRaw = (v) => tinyWf().expression.getParameterValue(v, null, 0, 0, 'A', [], 'manual', {});
const rawPipeline = probeAll({
	input_number: () => evalRaw(1),
	input_string: () => evalRaw('plain'),
	equals_only: () => evalRaw('='),
	equals_text: () => evalRaw('=just text'),
	equals_braced_num: () => evalRaw('={{1}}'),
	equals_bare_num: () => evalRaw('=1'),
	equals_undefined: () => evalRaw('={{ undefined }}'),
	equals_notDefined: () => evalRaw('={{ notDefined }}'),
	equals_text_and_undefined: () => evalRaw('=a{{ undefined }}b'),
	equals_obj: () => evalRaw('={{ {a:1} }}'),
	equals_syntax_error: () => evalRaw('={{ 1 + }}'),
	equals_throwing_fn: () => evalRaw('=x{{ (() => { throw new Error("boom") })() }}'),
	non_expression_string_with_braces: () => evalRaw('{{1}}'),
	array_of_expressions: () => evalRaw(['={{1}}', '={{2}}', 'plain']),
	object_tree: () => evalRaw({ a: '={{1}}', b: { c: '={{2}}' }, d: null, e: undefined, f: [ { g: '={{3}}' } ] }),
});

// ---------- 12-C: extension-syntax rewriting + inventory --------------------------------
const EXT_CASES = {
	isEmpty_on_member: '={{ $json.a.isEmpty() }}',
	trim_native: '={{ "x".trim() }}',
	trim_after_extension: '={{ $json.a.trim().isEmpty() }}',
	if_fn: '={{ $if($json.a, "y", "n") }}',
	min_max: '={{ $min(1, 2) }}',
	optional_chain_ext: '={{ $json.a?.isEmpty() }}',
	obj_literal: '={{ { data: 1 } }}',
	toDate: '={{ $json.t.toDate() }}',
	mixed_text: '=a{{ $json.x.trim() }}b',
	quote_strip_quirk: '={{ "literal.isEmpty()" }}',
};
const extensions = {};
for (const [k, v] of Object.entries(EXT_CASES)) {
	const stripped = v.slice(1);
	extensions[k] = {
		input: stripped,
		hasExpressionExtension: probe(() => ext.hasExpressionExtension(stripped)),
		hasNativeMethod: probe(() => ext.hasNativeMethod(stripped)),
		extendSyntax: probe(() => ext.extendSyntax(stripped)),
		extendSyntax_forced: probe(() => ext.extendSyntax(stripped, true)),
	};
}
const extensionInventory = {
	extendedFunctions: Object.keys(require('n8n-workflow/dist/cjs/extensions/extended-functions.js').extendedFunctions),
	byType: ext.EXTENSION_OBJECTS.map((o) => ({
		typeName: o.typeName,
		aliases: Object.keys(o.aliases ?? {}),
		functions: Object.keys(o.functions),
	})),
};

// ---------- 12-D: sandbox / security hooks (through the real parameter pipeline) ---------
const sandboxEval = (expr) => tinyWf().expression.getParameterValue(expr, null, 0, 0, 'A', [], 'manual', {});
const SANDBOX_CASES = {
	constructor_direct: '={{ {}.constructor }}',
	constructor_member: '={{ $json.a.constructor }}',
	constructor_computed: '={{ {}["constructor"] }}',
	proto_literal: '={{ ({}).__proto__ }}',
	proto_member: '={{ $json.a.__proto__ }}',
	proto_computed: '={{ {}["__proto__"] }}',
	proto_dynamic: '={{ {}[ "pro" + "to" + "__" ] }}',
	prototype_dynamic: '={{ {}[ "pro" + "type" ] }}',
	with_stmt: '={{ (() => { with ({a:1}) { return a } })() }}',
	class_extends_fn: '={{ (class extends Function {}) }}',
	class_dynamic_extends: '={{ (class extends (function(){}){}) }}',
	reserved_shadow: '={{ (() => { const ___n8n_data = 1; return 1 })() }}',
	sanitize_shadow: '={{ (() => { const __sanitize = 1; return 1 })() }}',
	bare_dollar: '={{ $ }}',
	dollar_object: '={{ $.json }}',
	dollar_property: '={{ ({$:""}).$ }}',
	this_expr: '={{ this }}',
	this_arrow_process: '={{ (() => this)() }}',
	globalThis: '={{ globalThis }}',
	global_this_member: '={{ globalThis.process }}',
	process_env: '={{ process.env.PATH }}',
	require_call: '={{ require("fs") }}',
	eval_call: '={{ eval("1+1") }}',
	fn_ctor: '={{ Function("return 1")() }}',
	spread_process: '={{ {...process} }}',
	destructure_proto: '={{ (() => { const { __proto__ } = {}; return 1 })() }}',
	destructure_computed: '={{ (() => { const { [1]: a } = [9]; return a })() }}',
	promise_new: '={{ Promise.resolve(1) }}',
	buffer_new: '={{ Buffer.from("a") }}',
	date_ok: '={{ new Date(0).toISOString() }}',
	object_assign: '={{ Object.assign({}, {a:1}) }}',
	object_create: '={{ Object.create(null) }}',
	object_define: '={{ Object.defineProperty({}, "a", {value:1}) }}',
	error_capture: '={{ Error.captureStackTrace }}',
	error_prepare_set: '={{ Error.prepareStackTrace = 1 }}',
	safe_global_lookup: '={{ JSON.stringify({a:1}) }}',
	process_version: '={{ process.version }}',
	process_env_direct: '={{ process.env }}',
	process_keys_expression: '={{ Object.keys({ ...process }) }}',
};
const sandbox = {};
for (const [k, v] of Object.entries(SANDBOX_CASES)) sandbox[k] = { expr: v, result: probe(() => sandboxEval(v)) };

// ---------- 13: WorkflowDataProxy lookup matrix ------------------------------------------
// A node type whose description declares the fixture parameters: `Workflow`'s constructor
// rewrites node.parameters through NodeHelpers.getNodeParameters(), so parameters that are not
// declared by the node type are dropped before $parameter can ever see them.
registry['ref.pipeTarget'] = {
	description: {
		displayName: 'pipeTarget', name: 'pipeTarget', group: ['transform'], version: 1, description: '',
		defaults: { name: 'pipeTarget' }, inputs: ['main'], outputs: ['main'],
		properties: [
			{ displayName: 'msg', name: 'msg', type: 'string', default: 'DEFAULT_MSG' },
			{ displayName: 'expr', name: 'expr', type: 'string', default: '' },
			{ displayName: 'nested', name: 'nested', type: 'object', default: {} },
			{ displayName: 'rl', name: 'rl', type: 'resourceLocator', default: { __rl: true, mode: 'url', value: '' }, modes: [{ displayName: 'URL', name: 'url', type: 'string', extractValue: { type: 'regex', regex: '/(\\d+)$' } }] },
			{ displayName: 'hidden', name: 'hidden', type: 'string', default: 'HIDDEN_DEFAULT', displayOptions: { show: { msg: ['neverMatches'] } } },
		],
	},
	async execute() { return [this.getInputData()]; },
};

const WF_JSON = {
	id: 'agent6',
	name: 'agent6',
	settings: { executionOrder: 'v1' },
	nodes: [
		{ id: 'Start', name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
		{ id: 'Split', name: 'Split', type: 'ref.split2', typeVersion: 1, position: [1, 0], parameters: { tag: 'splitTag' } },
		{
			id: 'End', name: 'End', type: 'ref.pipeTarget', typeVersion: 1, position: [2, 0],
			parameters: { msg: 'hello', expr: '={{ 21 * 2 }}', nested: { a: '={{ 1 + 1 }}' }, rl: { __rl: true, value: '={{ "https://x/42" }}', mode: 'url' } },
		},
	],
	connections: {
		Start: { main: [[{ node: 'Split', type: 'main', index: 0 }]] },
		Split: { main: [[{ node: 'End', type: 'main', index: 0 }]] },
	},
};
const startItems = [{ json: { n: 0 } }, { json: { n: 1 } }, { json: { n: 2 } }, { json: { n: 3 } }];

const additionalFor = (over = {}) => ({
	credentialsHelper: {},
	executeWorkflow: async () => {},
	restApiUrl: '',
	instanceBaseUrl: '',
	webhookBaseUrl: '',
	webhookWaitingBaseUrl: 'https://wait/resume',
	formWaitingBaseUrl: 'https://form/resume',
	userId: 'agent6',
	variables: { myVar: 'myValue' },
	hooks: { runHook: async () => {} },
	executionId: 'exec-1',
	currentNodeExecutionIndex: 0,
	...over,
});

const wf = buildWorkflow(WF_JSON);
const execResult = await new WorkflowExecute(additionalFor(), 'manual').run({
	workflow: wf,
	startNode: wf.getNode('Start'),
	triggerToStartFrom: { name: 'Start', data: { startTime: 0, executionTime: 0, executionIndex: 0, source: [], data: { main: [startItems] } } },
});
const runExecutionData = execResult.data;
const endTaskData = runExecutionData.resultData.runData.End[0];
const connectionInputData = endTaskData.data.main[0];
const executeData = {
	data: { main: [connectionInputData] },
	node: wf.getNode('End'),
	source: { main: endTaskData.source },
};

const newProxy = (over = {}) =>
	new WorkflowDataProxy(
		over.workflow ?? wf,
		'runExecutionData' in over ? over.runExecutionData : runExecutionData,
		over.runIndex ?? 0,
		over.itemIndex ?? 0,
		over.activeNodeName ?? 'End',
		over.connectionInputData ?? connectionInputData,
		over.siblingParameters ?? wf.getNode('End').parameters,
		over.mode ?? 'manual',
		over.additionalKeys ?? {},
		'executeData' in over ? over.executeData : executeData,
		over.defaultReturnRunIndex ?? -1,
		over.selfData ?? {},
		over.contextNodeName ?? over.activeNodeName ?? 'End',
		over.envProviderState,
	).getDataProxy(over.opts);

const LOOKUPS = {
	'$json': (p) => p.$json,
	'$data': (p) => p.$data,
	'$binary': (p) => p.$binary,
	'$json.deep_missing': (p) => p.$json.nope.deeper,
	'$json.n': (p) => p.$json.n,
	'$itemIndex': (p) => p.$itemIndex,
	'$runIndex': (p) => p.$runIndex,
	'$mode': (p) => p.$mode,
	'$position': (p) => p.$position,
	'$thisItem': (p) => p.$thisItem,
	'$thisItemIndex': (p) => p.$thisItemIndex,
	'$thisRunIndex': (p) => p.$thisRunIndex,
	'$nodeVersion': (p) => p.$nodeVersion,
	'$nodeId': (p) => p.$nodeId,
	'$webhookId': (p) => p.$webhookId,
	'$workflow': (p) => p.$workflow,
	'$prevNode': (p) => p.$prevNode,
	'$parameter': (p) => p.$parameter,
	'$parameter.msg': (p) => p.$parameter.msg,
	'$parameter.other (nested expression)': (p) => p.$parameter.other,
	'$parameter.nested': (p) => p.$parameter.nested,
	'$parameter.locator (resource locator)': (p) => p.$parameter.locator,
	'$parameter[&sibling]': (p) => p.$parameter['&msg'],
	'$parameter[&missing]': (p) => p.$parameter['&nope'],
	'$parameter.missing': (p) => p.$parameter.doesNotExist,
	'$parameter.toJSON()': (p) => p.$parameter.toJSON && p.$parameter.toJSON(),
	'$rawParameter.other': (p) => p.$rawParameter.other,
	'$input.item': (p) => p.$input.item,
	'$input.first()': (p) => p.$input.first(),
	'$input.last()': (p) => p.$input.last(),
	'$input.all()': (p) => p.$input.all(),
	'$input.params': (p) => p.$input.params,
	'$input.context': (p) => p.$input.context,
	'$input.first(1) with args': (p) => p.$input.first(1),
	'$input.nope (unknown property)': (p) => p.$input.nope,
	'$("Split").all()': (p) => p.$('Split').all(),
	'$("Split").first()': (p) => p.$('Split').first(),
	'$("Split").last()': (p) => p.$('Split').last(),
	'$("Split").all(1) second branch': (p) => p.$('Split').all(1),
	'$("Split").all(2) out of range': (p) => p.$('Split').all(2),
	'$("Split").isExecuted': (p) => p.$('Split').isExecuted,
	'$("Nope").all() unknown node': (p) => p.$('Nope').all(),
	'$("Start").item': (p) => p.$('Start').item,
	'$("Start").pairedItem(0)': (p) => p.$('Start').pairedItem(0),
	'$("Start").itemMatching(1)': (p) => p.$('Start').itemMatching(1),
	'$("Start").itemMatching() no arg': (p) => p.$('Start').itemMatching(),
	'$("End").item self': (p) => p.$('End').item,
	'$node["Start"].json': (p) => p.$node['Start'].json,
	'$node["Start"].binary': (p) => p.$node['Start'].binary,
	'$node["Start"].parameter': (p) => p.$node['Start'].parameter,
	'$node["Start"].runIndex': (p) => p.$node['Start'].runIndex,
	'$node["Start"].context': (p) => p.$node['Start'].context,
	'$node["Missing"].json': (p) => p.$node['Missing'].json,
	'$items()': (p) => p.$items(),
	'$items("Start")': (p) => p.$items('Start'),
	'$item(2).$json': (p) => p.$item(2).$json,
	'$now': (p) => (p.$now && p.$now.toISO ? p.$now.toISO() : p.$now),
	'$today': (p) => (p.$today && p.$today.toISO ? p.$today.toISO() : p.$today),
	'$jmespath': (p) => p.$jmespath([{ a: 1 }, { a: 2 }], '[*].a'),
	'$env.PATH': (p) => p.$env.PATH,
	'$vars.myVar': (p) => p.$vars && p.$vars.myVar,
	'$secrets': (p) => p.$secrets,
	'$execution': (p) => p.$execution,
	'$executionId (deprecated)': (p) => p.$executionId,
	'$resumeWebhookUrl (deprecated)': (p) => p.$resumeWebhookUrl,
	'$evaluateExpression': (p) => p.$evaluateExpression('={{ 21 * 2 }}'),
	'$fromAI("k")': (p) => p.$fromAI('k'),
	'$fromAI() empty': (p) => p.$fromAI(''),
	'$fromAI("bad key!")': (p) => p.$fromAI('bad key!'),
	'$tool': (p) => p.$tool,
	'$self': (p) => p.$self,
	'$agentInfo': (p) => p.$agentInfo,
	'$unknownVar': (p) => p.$unknownVar,
	'plainVar': (p) => p.somePlainVar,
	'$parameter.msg (declared)': (p) => p.$parameter.msg,
	'$parameter.expr (expression param)': (p) => p.$parameter.expr,
	'$parameter.nested': (p) => p.$parameter.nested,
	'$parameter.rl (resource locator)': (p) => p.$parameter.rl,
	'$parameter.hidden (default-injected, not displayed)': (p) => p.$parameter.hidden,
	'$parameter.absent (no such property)': (p) => p.$parameter.absent,
	'$rawParameter.expr': (p) => p.$rawParameter.expr,
	'$rawParameter.rl': (p) => p.$rawParameter.rl,
	'$parameter.toJSON()': (p) => JSON.stringify(p.$parameter.toJSON()),
	'process.version via data.process': (p) => p.process?.version,
	'process keys via data.process': (p) => Object.keys(p.process ?? {}),
	'proxy surface: "json" in $node.X': (p) => 'json' in p.$node.Start,
	'proxy surface: Object.keys($node.X)': (p) => Object.keys(p.$node.Start),
	'proxy surface: "$json" in p': (p) => '$json' in p,
	'proxy surface: Object.keys(p)': (p) => Object.keys(p).slice(0, 80),
	'proxy surface: isProxy': (p) => p.isProxy,
	'proxy surface: $input.item.isProxy': (p) => p.$input.item?.isProxy,
	'raw workflow node.parameters (post-Workflow-ctor)': (p) => p.workflow ? undefined : wf.getNode('End').parameters,
};
const lookupWithProxy = {};
for (const [k, f] of Object.entries(LOOKUPS)) lookupWithProxy[k] = probe(() => f(newProxy()));

// scoping dimensions
const mkEval = (expr, over = {}) =>
	(over.workflow ?? wf).expression.getParameterValue(
		expr,
		'runExecutionData' in over ? over.runExecutionData : runExecutionData,
		over.runIndex ?? 0,
		over.itemIndex ?? 0,
		over.activeNodeName ?? 'End',
		over.connectionInputData ?? connectionInputData,
		over.mode ?? 'manual',
		over.additionalKeys ?? {},
		'executeData' in over ? over.executeData : executeData,
		over.returnObjectAsString ?? false,
		over.selfData ?? {},
		over.contextNodeName,
	);

const scoping = {
	itemIndex_shifts_json: probe(() => [0, 1, 2, 3].map((i) => mkEval('={{ $json.n }}', { itemIndex: i }))),
	itemIndex_out_of_range: probe(() => mkEval('={{ $json.n }}', { itemIndex: 9 })),
	contextNodeName_switches_json: probe(() => {
		const p = newProxy({ contextNodeName: 'Split', activeNodeName: 'Split' });
		return { json: p.$json, prevNode: p.$prevNode, parameter: p.$parameter };
	}),
	no_executeData_pairing: probe(() => mkEval("={{ $('Start').item.json }}", { executeData: undefined })),
	runExecutionData_null: {
		'$json still works': probe(() => mkEval('={{ $json.n }}', { runExecutionData: null })),
		'$node throws': probe(() => mkEval("={{ $node['Start'].json }}", { runExecutionData: null })),
		'$() throws': probe(() => mkEval("={{ $('Start').all() }}", { runExecutionData: null })),
	},
	empty_input: {
		'$json': probe(() => mkEval('={{ $json }}', { connectionInputData: [], executeData: undefined })),
		'$input': probe(() => mkEval('={{ $input.first() }}', { connectionInputData: [], executeData: undefined })),
		'$thisItem': probe(() => mkEval('={{ $thisItem }}', { connectionInputData: [], executeData: undefined })),
	},
	throwOnMissingExecutionData_false: probe(() => {
		const p = newProxy({ itemIndex: 0, opts: { throwOnMissingExecutionData: false }, connectionInputData: [], contextNodeName: 'Unrun' });
		return { json: p.$json };
	}),
	returnObjectAsString: {
		object_raw: probe(() => mkEval('={{ ({a:1}) }}')),
		object_as_string: probe(() => mkEval('={{ ({a:1}) }}', { returnObjectAsString: true })),
		jsdate_as_string: probe(() => mkEval('={{ new Date(0) }}', { returnObjectAsString: true })),
		luxon_as_string: probe(() => mkEval('={{ $now }}', { returnObjectAsString: true })),
		invalid_luxon: probe(() => mkEval('={{ DateTime.fromISO("zzz") }}', { returnObjectAsString: true })),
		null_as_string: probe(() => mkEval('={{ null }}', { returnObjectAsString: true })),
		array_as_string: probe(() => mkEval('={{ [1,2] }}', { returnObjectAsString: true })),
	},
	additionalKeys_precedence: probe(() => {
		const p = newProxy({ additionalKeys: { $position: 'callerA', $now: 'callerB', $json: 'callerC', $vars: { v: 1 }, $itemIndex: 'callerD' } });
		return { position: p.$position, itemIndex: p.$itemIndex, now: show(p.$now), json: p.$json, vars: p.$vars };
	}),
	pairedItem_per_item: Object.fromEntries([0, 1, 2, 3].map((i) => [`item${i}`, probe(() => mkEval("={{ $('Start').item.json }}", { itemIndex: i }))])),
	pairedItem_paired_via_split: Object.fromEntries([0, 1].map((i) => [`item${i}`, probe(() => mkEval("={{ $('Split').item.json }}", { itemIndex: i }))])),
	pairedItem_via_node: probe(() => [0, 1, 2, 3].map((i) => mkEval("={{ $node['Start'].json }}", { itemIndex: i }))),
	branch_default_from_graph: probe(() => {
		// End is wired to Split output 0 → default branch must be 0 even though all(1) exists
		return { def: mkEval("={{ $('Split').all().length }}"), b1: mkEval("={{ $('Split').all(1).length }}") };
	}),
	pinned_data: (() => {
		const pinnedWf = buildWorkflow({ ...WF_JSON, pinData: { Split: [{ json: { pinned: true, n: 99 } }] } });
		const call = (mode) =>
			pinnedWf.expression.getParameterValue("={{ $('Split').all() }}", runExecutionData, 0, 0, 'End', connectionInputData, mode, {}, executeData);
		return { manual: probe(() => call('manual')), regular: probe(() => call('regular')) };
	})(),
	combined_binaryMode: (() => {
		const wfCombined = buildWorkflow({ ...WF_JSON, settings: { ...WF_JSON.settings, binaryMode: 'combined' } });
		const items = [{ json: { n: 1 }, binary: { data: { data: 'AA==', mimeType: 'text/plain', fileName: 'a.txt' } } }];
		const call = (expr) => wfCombined.expression.getParameterValue(expr, runExecutionData, 0, 0, 'End', items, 'manual', {}, executeData);
		return {
			'$input.item': probe(() => call('={{ $input.item }}')),
			'$input.all()': probe(() => call('={{ $input.all() }}')),
			'$json': probe(() => call('={{ $json }}')),
		};
	})(),
	code_node_augmentation: probe(() => {
		const codeWf = buildWorkflow({
			nodes: [{ id: 'C', name: 'C', type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0], parameters: {} }],
			connections: {},
		});
		const p = new WorkflowDataProxy(codeWf, runExecutionData, 0, 0, 'C', connectionInputData, {}, 'manual', {}, executeData).getDataProxy();
		const before = JSON.parse(JSON.stringify(runExecutionData.resultData.runData.End[0].data.main[0][0].json));
		p.$json.injected = 'yes';
		const after = JSON.parse(JSON.stringify(runExecutionData.resultData.runData.End[0].data.main[0][0].json));
		return { before, after, mutated: JSON.stringify(before) !== JSON.stringify(after) };
	}),
	timezone_side_effect: (() => {
		const { Settings, DateTime } = require('luxon');
		const before = Settings.defaultZone?.name;
		const tzWf = buildWorkflow({ ...WF_JSON, settings: { ...WF_JSON.settings, timezone: 'Asia/Jakarta' } });
		const p = new WorkflowDataProxy(tzWf, runExecutionData, 0, 0, 'End', connectionInputData, {}, 'manual', {}, executeData).getDataProxy();
		return probe(() => ({ before, after: Settings.defaultZone?.name, nowZone: DateTime.now().zoneName, proxyNowZone: p.$now.zoneName }));
	})(),
	parameter_recursion_guard: probe(() => {
		const wf2 = buildWorkflow({
			nodes: [{ id: 'R', name: 'R', type: 'ref.passthrough', typeVersion: 1, position: [0, 0], parameters: { self: '={{ $parameter.self }}', ok: '={{ $parameter.other }}', other: '={{ 1 + 1 }}' } }],
			connections: {},
		});
		return {
			self: probe(() => wf2.expression.getParameterValue('={{ $parameter.self }}', null, 0, 0, 'R', [], 'manual', {}, undefined)),
			other: probe(() => wf2.expression.getParameterValue('={{ $parameter.other }}', null, 0, 0, 'R', [], 'manual', {}, undefined)),
		};
	}),
	nested_parameter_walk: probe(() => mkEval({ a: '={{ 1 }}', b: ['={{ 2 }}', { c: '=x' }], d: 5, e: null })),
};

// ---------- 13-D: extra lookup edge cases -------------------------------------------------
const binaryItems = [
	{ json: { n: 10 }, binary: { data: { data: 'aGVsbG8=', mimeType: 'text/plain', fileName: 'a.txt', fileSize: '5 bytes' }, png: { data: 'iVBOR', mimeType: 'image/png', fileName: 'b.png' } } },
	{ json: { n: 11 } },
];
const extra = {
	binary_metadata_only: {
		'$binary (item 0)': probe(() => newProxy({ connectionInputData: binaryItems }).$binary),
		'$binary (item 1, none)': probe(() => newProxy({ connectionInputData: binaryItems, itemIndex: 1 }).$binary),
		'$item(0).$binary': probe(() => newProxy({ connectionInputData: binaryItems }).$item(0).$binary),
		'$input.item.binary (FULL)': probe(() => newProxy({ connectionInputData: binaryItems }).$input.item.binary),
		'$input.all()[0].binary (FULL)': probe(() => newProxy({ connectionInputData: binaryItems }).$input.all()[0].binary),
	},
	evaluate_expression_forms: {
		'without = prefix': probe(() => newProxy().$evaluateExpression('1 + 1')),
		'with = prefix': probe(() => newProxy().$evaluateExpression('=1 + 1')),
		'with braces+prefix': probe(() => newProxy().$evaluateExpression('={{ 1 + 1 }}')),
		'explicit itemIndex': probe(() => newProxy().$evaluateExpression('{{$itemIndex}}', 3)),
		'braced_no_prefix': probe(() => newProxy().$evaluateExpression('{{1 + 1}}')),
		'plain_text': probe(() => newProxy().$evaluateExpression('hello')),
	},
	run_index_errors: {
		'$("Start").first(0, 5)': probe(() => newProxy().$('Start').first(0, 5)),
		'$("Start").first(0, 0)': probe(() => newProxy().$('Start').first(0, 0)),
		'$items("Start", 0, 0)': probe(() => newProxy().$items('Start', 0, 0)),
		'$items("Start", 9)': probe(() => newProxy().$items('Start', 9)),
	},
	pinned_active_node: (() => {
		const pinnedEnd = buildWorkflow({ ...WF_JSON, pinData: { End: [{ json: { pinnedOnly: true } }] } });
		const call = (expr, mode) => pinnedEnd.expression.getParameterValue(expr, runExecutionData, 0, 0, 'End', connectionInputData, mode, {}, executeData);
		return {
			'$json with End pinned (manual)': probe(() => call('={{ $json }}', 'manual')),
			"$('End').all() with End pinned (manual)": probe(() => call("={{ $('End').all() }}", 'manual')),
		};
	})(),
	non_ancestor_reference: (() => {
		// Start -> Split -> End ; 'Solo' is disconnected from End's ancestry
		const wf2 = buildWorkflow({ ...WF_JSON, nodes: [...WF_JSON.nodes, { id: 'S', name: 'Solo', type: 'ref.passthrough', typeVersion: 1, position: [3, 3], parameters: {} }] });
		return {
			"$('Solo').item": probe(() => wf2.expression.getParameterValue("={{ $('Solo').item }}", runExecutionData, 0, 0, 'End', connectionInputData, 'manual', {}, executeData)),
			"$('Solo').all()": probe(() => wf2.expression.getParameterValue("={{ $('Solo').all() }}", runExecutionData, 0, 0, 'End', connectionInputData, 'manual', {}, executeData)),
			// Solo EXISTS in workflow.nodes but has no run data -> nodeDataGetter rules, not nodeGetter's
			"$('Solo').all() (exists, never executed)": probe(() => newProxy({ workflow: wf2 }).$('Solo').all()),
			"$node[\"Solo\"].json (exists, never executed)": probe(() => newProxy({ workflow: wf2 }).$node['Solo'].json),
			"$node[\"Solo\"].runIndex (never executed)": probe(() => newProxy({ workflow: wf2 }).$node['Solo'].runIndex),
			"$node[\"Solo\"].json + throwOnMissingExecutionData:false": probe(() => newProxy({ workflow: wf2, opts: { throwOnMissingExecutionData: false } }).$node['Solo'].json),
		};
	})(),
	unrun_node_reference: {
		// honest labels: 'Unrun' is not a node here, so this row is about an UNKNOWN PROPERTY on a node proxy
		'$node["Start"].unrun (unknown property on an executed node proxy)': probe(() => newProxy().$node['Start'].unrun),
		'$node["Nope"] (name not in workflow.nodes; throw happens at lookup, not at the accessor)': probe(() => newProxy().$node['Nope']),
		'$("End").first() (self, executed)': probe(() => newProxy().$('End').first()),
	},
	legacy_syntax_aliases: {
		'$jmespath vs $jmesPath': probe(() => [newProxy().$jmespath([{ a: 1 }], '[0].a'), newProxy().$jmesPath([{ a: 1 }], '[0].a')]),
		'$fromai / $fromAi aliases': probe(() => [(() => { try { return newProxy().$fromai('bad key!'); } catch (e) { return 'THROWS: ' + e.message; } })(), (() => { try { return newProxy().$fromAi('bad key!'); } catch (e) { return 'THROWS: ' + e.message; } })()]),
		'$items() vs $input.all()': probe(() => { const p = newProxy(); return { same: JSON.stringify(p.$items()) === JSON.stringify(p.$input.all()) }; }),
	},
	global_seed_asymmetry: {
		// `data.process` and the deny/allow global list are attached by Expression.resolveSimpleParameterValue,
		// NOT by WorkflowDataProxy.getDataProxy() — which is what n8n-core's getWorkflowDataProxy() returns.
		'raw proxy .process (getWorkflowDataProxy path)': probe(() => newProxy().process),
		'raw proxy .Object (getWorkflowDataProxy path)': probe(() => newProxy().Object),
		'raw proxy .JSON (getWorkflowDataProxy path)': probe(() => newProxy().JSON),
	},
	selfdata: probe(() => {
		const p = new WorkflowDataProxy(wf, runExecutionData, 0, 0, 'End', connectionInputData, {}, 'manual', {}, executeData, -1, { tool: 'TOOLVAL', itemIndex: 7 }, 'End').getDataProxy();
		return { selfToolDirect: p.$self.tool, selfItemIndex: p.$self.itemIndex, spread: { ...p.$self }, itemIndexStillFromCtor: p.$itemIndex };
	}),
	defaultReturnRunIndex: probe(() => {
		// defaultReturnRunIndex !== -1 forces a fixed run for $node[X] lookups
		const p = new WorkflowDataProxy(wf, runExecutionData, 0, 0, 'End', connectionInputData, {}, 'manual', {}, executeData, 0, {}, 'End').getDataProxy();
		return { run0: p.$node['Start'].json };
	}),
};

// ---------- 13-E: gap closure for the PARTIAL rows of contracts/variable-lookup.contract.md §10 -------
// ($fromAI/$tool data source, $agentInfo with a real agent+tool graph, item-lineage sourceOverwrite,
//  and the additionalKeys supply surface that every node-execution-context forwards.)
const CORE_CTX_PATH = 'n8n-core/dist/execution-engine/node-execution-context/index.js';
const { getAdditionalKeys, getNonWorkflowAdditionalKeys, resolveSourceOverwrite } = require(CORE_CTX_PATH);

const gapClosure = {
	// ---- E1: $fromAI data source = runData[active][runIndex].inputOverride.ai_tool[0][itemIndex].json
	fromAI_inputOverride: (() => {
		const rd = JSON.parse(JSON.stringify(runExecutionData));
		rd.resultData.runData.End[0].inputOverride = {
			ai_tool: [[
				{ json: { query: { city: 'Jakarta', n: 5, tool: 'search', toolParameters: { q: 'hello' } }, topOnly: 'TOP', both: 'FROM_TOPLEVEL' } },
				{ json: { query: { city: 'Bandung', both: 'FROM_ITEM1' } } },
			]],
		};
		const P = (itemIndex, over = {}) =>
			new WorkflowDataProxy(over.workflow ?? wf, over.rd ?? rd, over.runIndex ?? 0, itemIndex,
				over.activeNodeName ?? 'End', over.connectionInputData ?? connectionInputData, {}, over.mode ?? 'manual',
				over.additionalKeys ?? {}, executeData, -1, {}, 'End').getDataProxy();
		return {
			query_map_wins: probe(() => P(0).$fromAI('city')),
			top_level_only_key: probe(() => P(0).$fromAI('topOnly')),
			query_beats_top_level: probe(() => P(0).$fromAI('both')),
			unknown_key: probe(() => P(0).$fromAI('nope')),
			unknown_key_with_default: probe(() => P(0).$fromAI('nope', 'desc', 'string', 'FALLBACK')),
			item_selected_by_itemIndex: probe(() => [P(0).$fromAI('city'), P(1).$fromAI('city')]),
			itemIndex_out_of_range: probe(() => P(2).$fromAI('city')),
			key_64_chars_accepted: probe(() => P(0).$fromAI('a'.repeat(64))),
			key_65_chars_throws: probe(() => P(0).$fromAI('a'.repeat(65))),
			key_with_dot_throws: probe(() => P(0).$fromAI('a.b')),
			alias_fromai_matches: probe(() => P(0).$fromai('city')),
			alias_fromAi_matches: probe(() => P(0).$fromAi('city')),
			// the data source is chosen by whether a TASK exists at [activeNode][runIndex]:
			// task exists but has no inputOverride => NO fallback (the connection data is never consulted)
			existing_task_without_inputOverride_does_not_fall_back: probe(() =>
				({ itemIndex: 3, value: P(3, { rd: runExecutionData, connectionInputData: [{ json: { n: 0 } }, { json: { n: 1 } }, { json: { n: 2 } }, { json: { n: 9 } }] }).$fromAI('n') })),
			// no task at that runIndex => fallback to connectionInputData[**runIndex**] (upstream quirk: not itemIndex)
			no_task_at_runIndex_falls_back_to_connectionInputData_at_runIndex: probe(() =>
				P(0, { runIndex: 1, rd: runExecutionData, connectionInputData: [{ json: { n: 'a' } }, { json: { n: 'b' } }] }).$fromAI('n')),
		};
	})(),

	// ---- E2: $tool (handleTool): name/parameters from $fromAI('tool'/'toolParameters') + fallback ----
	tool_access: (() => {
		const rd = JSON.parse(JSON.stringify(runExecutionData));
		const setOverride = (json) => {
			rd.resultData.runData.End[0].inputOverride = { ai_tool: [[{ json }]] };
			return rd;
		};
		const P = (over = {}) =>
			new WorkflowDataProxy(wf, over.rd ?? rd, 0, over.itemIndex ?? 0, 'End', connectionInputData, {}, 'manual',
				over.additionalKeys ?? {}, executeData, -1, {}, 'End').getDataProxy();
		return {
			from_query_map: probe(() => { setOverride({ query: { tool: 'search', toolParameters: { q: 'hello' } } }); return P().$tool; }),
			from_top_level: probe(() => { setOverride({ tool: 'topTool', toolParameters: { z: 1 } }); return P().$tool; }),
			partial_only_name: probe(() => { setOverride({ query: { tool: 'onlyName' } }); return P().$tool; }),
			no_data_with_fallback: probe(() => P({ rd: runExecutionData, additionalKeys: { $tool: { name: 'fallbackTool', parameters: { a: 1 } } } }).$tool),
			no_data_no_fallback: probe(() => P({ rd: runExecutionData }).$tool),
			empty_override_item_index_out_of_range: probe(() => { setOverride({ query: { tool: 'x' } }); return P({ itemIndex: 4 }).$tool; }),
			toolName_via_expression: probe(() => { setOverride({ query: { tool: 'search' } }); return wf.expression.getParameterValue('={{ $tool.name }}', rd, 0, 0, 'End', connectionInputData, 'manual', {}, executeData); }),
		};
	})(),

	// ---- E3: $agentInfo (agent node type + ai_tool/ai_memory graph) ----
	agent_info: (() => {
		registry['@n8n/n8n-nodes-langchain.agent'] = {
			description: {
				displayName: 'AI Agent', name: 'agent', group: ['ai'], version: 1, description: '',
				defaults: { name: 'agent' }, inputs: ['main', 'ai_systemMessage', 'ai_memory', 'ai_tool'], outputs: ['main'],
				properties: [{ displayName: 'Prompt', name: 'prompt', type: 'string', default: '' }],
			},
			async execute() { return [this.getInputData()]; },
		};
		registry['@n8n/n8n-nodes-langchain.keywordTool'] = {
			description: {
				displayName: 'Keyword Tool', name: 'keywordTool', group: ['ai'], version: 1, description: '',
				defaults: { name: 'keywordTool' }, inputs: ['ai_tool'], outputs: ['ai_tool'],
				properties: [
					{ displayName: 'Resource', name: 'resource', type: 'options', default: 'resA', options: [{ name: 'Resource A', value: 'resA' }, { name: 'Resource B', value: 'resB' }] },
					{ displayName: 'Operation', name: 'operation', type: 'options', default: 'opA', displayOptions: { show: { resource: ['resA'] } }, options: [{ name: 'Operation A', value: 'opA' }, { name: 'Operation B', value: 'opB' }] },
					{ displayName: 'User Query', name: 'userQuery', type: 'string', default: '' },
				],
			},
			async execute() { return [[]]; },
		};
		registry['@n8n/n8n-nodes-langchain.googleCalendarTool'] = {
			description: {
				displayName: 'Calendar Tool', name: 'googleCalendarTool', group: ['ai'], version: 1, description: '',
				defaults: { name: 'googleCalendarTool' }, inputs: ['ai_tool'], outputs: ['ai_tool'],
				properties: [
					{ displayName: 'Calendar', name: 'calendar', type: 'resourceLocator', default: { __rl: true, mode: 'list', value: '' }, modes: [{ displayName: 'List', name: 'list', type: 'list', typeOptions: {} }] },
				],
			},
			async execute() { return [[]]; },
		};
		registry['ref.memoryStore'] = {
			description: { displayName: 'Memory', name: 'memoryStore', group: ['ai'], version: 1, description: '', defaults: { name: 'memoryStore' }, inputs: ['ai_memory'], outputs: ['ai_memory'], properties: [] },
			async execute() { return [[]]; },
		};
		const AG_JSON = {
			id: 'agent6-agent', name: 'agent6-agent', settings: { executionOrder: 'v1' },
			nodes: [
				{ id: 'Start', name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
				{
					id: 'Agent', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 1, position: [1, 0], parameters: { prompt: 'hi' },
				},
				{
					id: 'Tool1', name: 'Tool1', type: '@n8n/n8n-nodes-langchain.keywordTool', typeVersion: 1, position: [1, 1],
					parameters: { resource: 'resA', operation: 'opA', userQuery: '={{ $fromAI("user_input") }}' },
					credentials: { slackApi: { id: 'c1', name: 'Slack' } },
				},
				{ id: 'Tool2', name: 'Tool2', type: '@n8n/n8n-nodes-langchain.keywordTool', typeVersion: 1, position: [1, 2], parameters: { resource: 'resB' } },
				{ id: 'Cal', name: 'Cal', type: '@n8n/n8n-nodes-langchain.googleCalendarTool', typeVersion: 1, position: [1, 3], parameters: { calendar: { __rl: true, mode: 'id', value: 'cal-123' } } },
				{ id: 'Mem', name: 'Mem', type: 'ref.memoryStore', typeVersion: 1, position: [1, 4], parameters: {} },
			],
			connections: {
				Start: { main: [[{ node: 'Agent', type: 'main', index: 0 }]] },
				Tool1: { ai_tool: [[{ node: 'Agent', type: 'ai_tool', index: 0 }]] },
				Mem: { ai_memory: [[{ node: 'Agent', type: 'ai_memory', index: 0 }]] },
			},
		};
		const agWf = buildWorkflow(AG_JSON);
		const agItems = [{ json: { n: 0 } }];
		const P = (over = {}) =>
			new WorkflowDataProxy(agWf, null, 0, 0, over.activeNodeName ?? 'Agent', agItems, {}, 'manual', {}, undefined, -1, {}, over.activeNodeName ?? 'Agent').getDataProxy();
		return {
			agentInfo_on_agent_node: probe(() => P().$agentInfo),
			agentInfo_on_non_agent_node: probe(() => P({ activeNodeName: 'Tool2' }).$agentInfo),
			tools_are_from_queryNodes_not_connections_only: probe(() => ({
				connected: P().$agentInfo.tools.filter((t) => t.connected).map((t) => t.name),
				unconnected: P().$agentInfo.tools.filter((t) => !t.connected).map((t) => t.name),
			})),
			aiDefinedFields_and_calendar: probe(() => {
				const t = P().$agentInfo.tools.find((x) => x.name === 'Tool1');
				const c = P().$agentInfo.tools.find((x) => x.name === 'Cal');
				return { tool1: { resource: t.resource, operation: t.operation, hasCredentials: t.hasCredentials, aiDefinedFields: t.aiDefinedFields, type: t.type }, cal: { hasValidCalendar: c.hasValidCalendar, resource: c.resource, operation: c.operation } };
			}),
			memoryConnectedToAgent_then_not: probe(() => {
				const noMemConns = { Start: AG_JSON.connections.Start, Tool1: AG_JSON.connections.Tool1 };   // Mem dropped entirely
				const noMem = buildWorkflow({ ...AG_JSON, connections: noMemConns });
				const P2 = new WorkflowDataProxy(noMem, null, 0, 0, 'Agent', agItems, {}, 'manual', {}, undefined, -1, {}, 'Agent').getDataProxy();
				return { withMemory: P().$agentInfo.memoryConnectedToAgent, withoutMemory: P2.$agentInfo.memoryConnectedToAgent };
			}),
			// $agentInfo is computed EAGERLY in `base` (agentInfo() runs at getDataProxy() time)
			eager_snapshot_not_lazy: probe(() => {
				const p = P();
				const before = p.$agentInfo.tools.length;
				agWf.nodes['Tool3'] = { id: 'Tool3', name: 'Tool3', type: '@n8n/n8n-nodes-langchain.keywordTool', typeVersion: 1, position: [1, 5], parameters: {}, disabled: false };
				const after = p.$agentInfo.tools.length;
				const fresh = P().$agentInfo.tools.length;
				return { before, after, fresh };
			}),
		};
	})(),

	// ---- E4: item-lineage `sourceOverwrite` (workflow-data-proxy) and the core resolveSourceOverwrite rule ----
	lineage_sourceOverwrite: (() => {
		// give Start a SECOND run so a redirected source is observable
		const rd = JSON.parse(JSON.stringify(runExecutionData));
		rd.resultData.runData.Start.push({
			startTime: 0, executionTime: 0, executionIndex: 1, source: [],
			data: { main: [[{ json: { n: 'RUN1' } }]] },
		});
		// End item0's pairedItem -> Split run0 item0; Split item0's pairedItem decides the NEXT hop.
		const splitItem = rd.resultData.runData.Split[0].data.main[0][0];
		const natural = probe(() => new WorkflowDataProxy(wf, rd, 0, 0, 'End', connectionInputData, {}, 'manual', {}, { ...executeData }, -1, {}, 'End').getDataProxy().$('Start').item.json);
		const redirected = probe(() => {
			const rd2 = JSON.parse(JSON.stringify(rd));
			const item = rd2.resultData.runData.Split[0].data.main[0][0];
			item.pairedItem = { item: 0, input: 0, sourceOverwrite: { previousNode: 'Start', previousNodeOutput: 0, previousNodeRun: 1 } };
			return new WorkflowDataProxy(wf, rd2, 0, 0, 'End', connectionInputData, {}, 'manual', {}, { ...executeData }, -1, {}, 'End').getDataProxy().$('Start').item.json;
		});
		const badInputIndex = probe(() => {
			const rd2 = JSON.parse(JSON.stringify(rd));
			const item = rd2.resultData.runData.Split[0].data.main[0][0];
			item.pairedItem = { item: 0, input: 7 };   // beyond taskData.source.length
			return new WorkflowDataProxy(wf, rd2, 0, 0, 'End', connectionInputData, {}, 'manual', {}, { ...executeData }, -1, {}, 'End').getDataProxy().$('Start').item.json;
		});
		const ed = (meta) => ({ data: { main: [[{ json: { n: 0 } }]] }, node: wf.getNode('End'), source: [], metadata: meta });
		return {
			natural_walk: natural,
			redirected_via_pairedItem_sourceOverwrite: redirected,
			input_index_beyond_sourceArray: badInputIndex,
			core_resolveSourceOverwrite_matrix: {
				'no metadata': probe(() => resolveSourceOverwrite({ json: {}, pairedItem: { item: 0 } }, ed(undefined))),
				'flag off': probe(() => resolveSourceOverwrite({ json: {}, pairedItem: { item: 0, sourceOverwrite: { previousNode: 'X' } } }, ed({ preserveSourceOverwrite: false }))),
				'preservedSourceOverwrite wins': probe(() => resolveSourceOverwrite({ json: {}, pairedItem: { item: 0, sourceOverwrite: { previousNode: 'FROM_ITEM' } } }, ed({ preserveSourceOverwrite: true, preservedSourceOverwrite: { previousNode: 'PRESERVED' } }))),
				'falls back to pairedItem.sourceOverwrite': probe(() => resolveSourceOverwrite({ json: {}, pairedItem: { item: 0, sourceOverwrite: { previousNode: 'FROM_ITEM' } } }, ed({ preserveSourceOverwrite: true }))),
				'flag on, nothing set': probe(() => resolveSourceOverwrite({ json: {}, pairedItem: { item: 0 } }, ed({ preserveSourceOverwrite: true }))),
				'pairedItem is a number': probe(() => resolveSourceOverwrite({ json: {}, pairedItem: 2 }, ed({ preserveSourceOverwrite: true }))),
			},
		};
	})(),

	// ---- E5: the additionalKeys supply side every node-execution-context forwards ----
	additionalKeys_surface: (() => {
		const base = additionalFor();
		return {
			getAdditionalKeys_shape: probe(() => {
				const k = getAdditionalKeys(base, 'manual', runExecutionData);
				return { keys: Object.keys(k).sort(), id: k.$execution.id, mode: k.$execution.mode, resumeUrl: k.$execution.resumeUrl, resumeFormUrl: k.$execution.resumeFormUrl, vars: k.$vars, secrets: k.$secrets, deprecatedExecutionId: k.$executionId };
			}),
			getAdditionalKeys_production_mode: probe(() => {
				const k = getAdditionalKeys({ ...base, executionId: undefined, webhookWaitingBaseUrl: 'https://h/wait' }, 'cli', runExecutionData);
				return { mode: k.$execution.mode, id: k.$execution.id, resumeUrl: k.$execution.resumeUrl };
			}),
			getAdditionalKeys_without_runData: probe(() => {
				const k = getAdditionalKeys(base, 'manual', null);
				return { keys: Object.keys(k).sort(), customData: k.$execution.customData };
			}),
			getNonWorkflowAdditionalKeys_shape: probe(() => {
				const k = getNonWorkflowAdditionalKeys(base);
				return { keys: Object.keys(k).sort(), vars: k.$vars, secrets: k.$secrets };
			}),
			secrets_proxy_surface: (() => {
				const store = { vaultA: { tok: 'SECRET_A', nested: { deep: 'D' } } };
				const externalSecretsProxy = {
					listProviders: () => Object.keys(store),
					hasProvider: (name) => name in store,
					listSecrets: (name) => Object.keys(store[name] ?? {}),
					hasSecret: (name, key) => !!store[name] && key in store[name],
					getSecret: (name, key) => store[name]?.[key],
				};
				const withSecrets = (mode = 'manual') => getAdditionalKeys({ ...base, externalSecretsProxy }, mode, runExecutionData, { secretsEnabled: true });
				return {
					providers: probe(() => Object.keys(withSecrets().$secrets)),
					secret_value: probe(() => withSecrets().$secrets.vaultA.tok),
					nested_object: probe(() => withSecrets().$secrets.vaultA.nested.deep),
					enumeration_is_invisible: probe(() => { const sp = withSecrets().$secrets; return { objectKeys: Object.keys(sp), hasOperator: 'vaultA' in sp, getOwnPropertyNames: Object.getOwnPropertyNames(sp), directRead: sp.vaultA.tok }; }),
					unknown_provider_throws: probe(() => withSecrets().$secrets.vaultB.anything),
					unknown_secret_throws: probe(() => withSecrets().$secrets.vaultA.nope),
					writes_are_refused: probe(() => { const k = withSecrets(); try { k.$secrets.vaultA = 1; } catch (e) { return { threw: e.constructor.name }; } return { ownKeysAfterWrite: Object.keys(k.$secrets), valueStill: k.$secrets.vaultA.tok }; }),
					disabled_flag_leaves_key_undefined: probe(() => getAdditionalKeys({ ...base, externalSecretsProxy }, 'manual', runExecutionData).$secrets),
				};
			})(),
			nonWorkflow_keys_no_secrets: probe(() => getNonWorkflowAdditionalKeys({ ...base, externalSecretsProxy: undefined }).$secrets),
			customData_set_get_manual_mode: probe(() => {
				const rd = JSON.parse(JSON.stringify(runExecutionData));
				const k = getAdditionalKeys(base, 'manual', rd);
				k.$execution.customData.set('k1', 'v1');
				return { stored: k.$execution.customData.get('k1'), all: k.$execution.customData.getAll(), inRunData: show(rd.resultData.metadata) };
			}),
			customData_bad_value_throws_in_manual: probe(() => {
				const rd = JSON.parse(JSON.stringify(runExecutionData));
				const k = getAdditionalKeys(base, 'manual', rd);
				return k.$execution.customData.set('k2', { not: 'a string' });
			}),
			customData_bad_value_swallowed_in_production: probe(() => {
				const rd = JSON.parse(JSON.stringify(runExecutionData));
				const k = getAdditionalKeys(base, 'cli', rd);
				k.$execution.customData.set('k3', { not: 'a string' });
				return { ok: true, after: k.$execution.customData.get('k3') };
			}),
			// precedence check: $webhookId is declared AFTER ...additionalKeys, so a caller-supplied
			// value of the same name must LOSE to the engine's (here: node has no webhookId -> undefined).
			webhookId_precedence_engine_wins: probe(() => {
				const p = new WorkflowDataProxy(wf, runExecutionData, 0, 0, 'End', connectionInputData, {}, 'manual', { $webhookId: 'FROM_CALLER' }, executeData, -1, {}, 'End').getDataProxy();
				return { fromCaller: 'FROM_CALLER', seenByProxy: p.$webhookId, engineValueFromNode: wf.getNode('End').webhookId };
			}),
			webhookId_from_node_when_present: probe(() => {
				const wfW = buildWorkflow({ ...WF_JSON, nodes: WF_JSON.nodes.map((n) => (n.name === 'End' ? { ...n, webhookId: 'node-wh-id' } : n)) });
				return new WorkflowDataProxy(wfW, runExecutionData, 0, 0, 'End', connectionInputData, {}, 'manual', { $webhookId: 'FROM_CALLER' }, executeData, -1, {}, 'End').getDataProxy().$webhookId;
			}),
		};
	})(),
};

// ---------- 13-B: n8n-core node-execution-context glue -----------------------------------
const glue = {};
{
	registry['ref.pipeProbe'] = {
		description: {
			displayName: 'pipeProbe', name: 'pipeProbe', group: ['transform'], version: 1, description: '',
			defaults: { name: 'pipeProbe' }, inputs: ['main'], outputs: ['main'],
			properties: [
				{ displayName: 'value', name: 'value', type: 'string', default: '' },
				{ displayName: 'num', name: 'num', type: 'string', default: '' },
				{ displayName: 'locator', name: 'locator', type: 'string', default: '', extractValue: { type: 'regex', regex: '/(\\d+)$' } },
				{ displayName: 'typed', name: 'typed', type: 'string', default: '', validateType: 'number' },
			],
		},
		async execute() {
			const items = this.getInputData();
			const out = [];
			for (let i = 0; i < items.length; i++) {
				const rec = { index: i };
				rec.value = this.getNodeParameter('value', i, '');
				rec.raw = this.getNodeParameter('value', i, '', { rawExpressions: true });
				rec.numString = this.getNodeParameter('num', i, '', { ensureType: 'string' });
				rec.numNumber = this.getNodeParameter('num', i, '', { ensureType: 'number' });
				rec.numBool = this.getNodeParameter('num', i, '', { ensureType: 'boolean' });
				rec.numJson = this.getNodeParameter('num', i, '', { ensureType: 'json' });
				rec.evalDefaultItem = this.evaluateExpression('{{$json.n}}');
				rec.evalI = this.evaluateExpression('{{$json.n}}', i);
				rec.proxyJson = this.getWorkflowDataProxy(i).$json;
				rec.proxyParamKeys = (() => { try { return Object.keys(this.getWorkflowDataProxy(i).$parameter); } catch (e) { return 'ERR ' + e.message; } })();
				rec.proxySibling = (() => { try { return this.getWorkflowDataProxy(i).$parameter['&msg']; } catch (e) { return 'THROWS: ' + e.constructor.name + ': ' + e.message; } })();
				rec.proxyExec = (() => { const e = this.getWorkflowDataProxy(i).$execution; return { id: e.id, mode: e.mode, resumeUrl: e.resumeUrl, resumeFormUrl: e.resumeFormUrl, hasCustomData: !!e.customData }; })();
				rec.proxyVars = this.getWorkflowDataProxy(i).$vars;
				rec.proxyEnv = (() => { try { return this.getWorkflowDataProxy(i).$env.HOME; } catch (e) { return 'THROWS: ' + e.message; } })();
				rec.mode = this.getMode();
				rec.workflow = this.getWorkflow();
				rec.now = String(this.getWorkflowDataProxy(i).$now);
				out.push({ json: rec, pairedItem: { item: i } });
			}
			return [out];
		},
	};
	const glueWf = buildWorkflow({
		id: 'glue', name: 'glue', settings: { executionOrder: 'v1' },
		nodes: [
			{ id: 'Start', name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
			{ id: 'End', name: 'End', type: 'ref.pipeProbe', typeVersion: 1, position: [1, 0], parameters: { value: '={{ $json.n }} plus', num: '7', locator: 'https://x/42', typed: '={{ "12" }}' } },
		],
		connections: { Start: { main: [[{ node: 'End', type: 'main', index: 0 }]] } },
	});
	const r = await new WorkflowExecute(additionalFor({ currentNodeExecutionIndex: 0 }), 'manual').run({
		workflow: glueWf, startNode: glueWf.getNode('Start'),
		triggerToStartFrom: { name: 'Start', data: { startTime: 0, executionTime: 0, executionIndex: 0, source: [], data: { main: [[{ json: { n: 5 } }, { json: { n: 6 } }]] } } },
	});
	const task = r.data.resultData.runData.End?.[0];
	glue.run = task
		? show({ status: task.executionStatus, items: task.data?.main?.[0]?.map((i) => i.json), error: task.error ? { message: task.error.message, context: task.error.context } : undefined, runError: r.data.resultData.error?.message })
		: { noTaskData: true, full: show(r.data.resultData) };
	glue.overallStatus = r.status;
	delete registry['ref.pipeProbe'];
}

// error propagation: failing expression inside a parameter
{
	registry['ref.pipeErr'] = {
		description: { displayName: 'pipeErr', name: 'pipeErr', group: ['transform'], version: 1, description: '', defaults: {}, inputs: ['main'], outputs: ['main'], properties: [{ displayName: 'value', name: 'value', type: 'string', default: '' }] },
		async execute() {
			const out = [];
			for (let i = 0; i < this.getInputData().length; i++) out.push({ json: { got: this.getNodeParameter('value', i, '') }, pairedItem: { item: i } });
			return [out];
		},
	};
	const errWf = buildWorkflow({
		id: 'err', name: 'err', settings: { executionOrder: 'v1' },
		nodes: [
			{ id: 'Start', name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
			{ id: 'End', name: 'End', type: 'ref.pipeErr', typeVersion: 1, position: [1, 0], parameters: { value: "={{ $('Nope').all() }}" } },
		],
		connections: { Start: { main: [[{ node: 'End', type: 'main', index: 0 }]] } },
	});
	const r = await new WorkflowExecute(additionalFor({ executionId: undefined, webhookWaitingBaseUrl: '', formWaitingBaseUrl: '' }), 'manual').run({
		workflow: errWf, startNode: errWf.getNode('Start'),
		triggerToStartFrom: { name: 'Start', data: { startTime: 0, executionTime: 0, executionIndex: 0, source: [], data: { main: [[{ json: {} }]] } } },
	});
	const task = r.data.resultData.runData.End?.[0] ?? {};
	glue.errorContext = show({
		status: task.executionStatus, errorName: task.error?.name, message: task.error?.message,
		context: task.error?.context, description: task.error?.description,
		runError: r.data.resultData.error?.message, runErrorContext: r.data.resultData.error?.context,
	});
	delete registry['ref.pipeErr'];
}

const output = {
	meta: {
		generatedAt: new Date().toISOString(),
		runtime: {
			'n8n-workflow': require('n8n-workflow/package.json').version,
			'n8n-core': require('n8n-core/package.json').version,
			'@n8n/tournament': require('@n8n/tournament/package.json').version,
			'luxon': require('luxon/package.json').version,
		},
		node: process.version,
	},
	'PIPE-12': {
		'12A_chunking_n8n_vs_tournament': chunking,
		'12B_template_semantics_resolveWithoutWorkflow': tmpl,
		'12B2_param_pipeline_raw_strings': rawPipeline,
		'12C_extension_syntax': extensions,
		'12C2_extension_inventory': extensionInventory,
		'12D_sandbox': sandbox,
	},
	'PIPE-13': {
		'13A_lookup_matrix': lookupWithProxy,
		'13B_scoping': scoping,
		'13C_core_glue': glue,
		'13D_extra': extra,
		'13E_gap_closure': gapClosure,
		fixture: {
			workflow: WF_JSON,
			startItems,
			runDataKeys: Object.keys(runExecutionData.resultData.runData),
			endTask: show(endTaskData),
			connectionInputData: show(connectionInputData),
			executionStatus: execResult.status,
		},
	},
};

const json = JSON.stringify(output, null, 2);
const outFile = process.argv[2];
if (outFile) fs.writeFileSync(outFile, json + '\n');
else console.log(json);
	process.exit(0);

})().catch((e) => { console.error(e); process.exit(2); });
