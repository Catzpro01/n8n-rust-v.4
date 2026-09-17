/**
 * Contract invariant tests — contracts/expression.contract.md §5 (E1–E15)
 * and §3 output semantics, against the reconstruction.
 *
 *   node --test test/contract.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	Expression,
	ExpressionError,
	ApplicationError,
	ExpressionWithStatementError,
	ExpressionClassExtensionError,
	ExpressionReservedVariableError,
	ExpressionDestructuringError,
	WorkflowGraphAdapter,
	WorkflowDataProxy,
	createEnvProvider,
	createEnvProviderState,
	augmentObject,
	extend,
	extendOptional,
	isExpression,
	isSafeObjectProperty,
} from '../index.mjs';

const mkWorkflow = (workflowJson = {}) =>
	new WorkflowGraphAdapter(
		{
			nodes: [
				{ name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
				{ name: 'Set', type: 'n8n-nodes-base.set', typeVersion: 1, position: [0, 0], parameters: {} },
				{ name: 'End', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [0, 0], parameters: {} },
			],
			connections: {
				Start: { main: [[{ node: 'Set', type: 'main', index: 0 }]] },
				Set: { main: [[{ node: 'End', type: 'main', index: 0 }]] },
			},
			...workflowJson,
			id: workflowJson.id ?? 'wf',
			name: workflowJson.name ?? 'wf',
			active: false,
			settings: workflowJson.settings ?? {},
		},
		{ pinData: workflowJson.pinData },
	);

const runData = {
	Start: [
		{
			startTime: 0,
			executionTime: 0,
			executionIndex: 0,
			source: [],
			data: { main: [[{ json: { id: 0 } }, { json: { id: 1 } }]] },
		},
	],
	Set: [
		{
			startTime: 0,
			executionTime: 0,
			executionIndex: 1,
			source: [{ previousNode: 'Start', previousNodeOutput: 0, previousNodeRun: 0 }],
			data: { main: [[{ json: { a: 10 }, pairedItem: { item: 0 } }, { json: { a: 20 }, pairedItem: { item: 1 } }]] },
		},
	],
};

const input = [
	{ json: { a: 10 }, pairedItem: { item: 0 } },
	{ json: { a: 20 }, pairedItem: { item: 1 } },
];

const executeData = {
	data: { main: [input] },
	source: { main: [{ previousNode: 'Set', previousNodeOutput: 0, previousNodeRun: 0 }] },
};

function evalExpr(value, { itemIndex = 0, runExecutionData = { resultData: { runData } }, activeNodeName = 'End', mode = 'manual', connectionInputData = input, executeData: ed = executeData, additionalKeys = {}, workflowJson } = {}) {
	const workflow = mkWorkflow(workflowJson);
	return workflow.expression.getParameterValue(
		value,
		runExecutionData,
		0,
		itemIndex,
		activeNodeName,
		connectionInputData,
		mode,
		additionalKeys,
		ed,
	);
}

/* ── E1: only '=' strings are evaluated ───────────────────────────────── */
test('E1: non-expression strings returned unchanged', () => {
	assert.equal(evalExpr('hello'), 'hello');
	assert.equal(evalExpr('={{ $json.a }}'), 10);
});

test('E1: "=" alone → "", "=text" → "text" (identity resolution)', () => {
	assert.equal(evalExpr('='), '');
	assert.equal(evalExpr('=just text'), 'just text');
});

test('E1: isExpression helper', () => {
	assert.equal(isExpression('=x'), true);
	assert.equal(isExpression('x'), false);
	assert.equal(isExpression(5), false);
});

/* ── E3: missing property / identifier ⇒ undefined ────────────────────── */
test('E3: missing property reads as undefined', () => {
	assert.equal(evalExpr('={{ $json.missing }}'), undefined);
	assert.equal(evalExpr('={{ $json.missing.deeper }}'), undefined);
});

test('E3: undefined identifier reads as undefined (no ReferenceError)', () => {
	assert.equal(evalExpr('={{ totallyUnknownVariable }}'), undefined);
});

/* ── E9: sandbox ──────────────────────────────────────────────────────── */
test('E9: .constructor access → ExpressionError', () => {
	assert.throws(() => evalExpr('={{ $json.constructor.name }}'), (e) => {
		assert.ok(e instanceof ExpressionError);
		assert.match(e.message, /invalid constructor function call/);
		return true;
	});
});

test('E9: computed __proto__ literal access → ExpressionError', () => {
	assert.throws(() => evalExpr("={{ $json['__proto__'] }}"), (e) => {
		assert.ok(e instanceof ExpressionError);
		assert.match(e.message, /security concerns/);
		return true;
	});
});

test('E9: with statement → ExpressionWithStatementError', () => {
	assert.throws(() => evalExpr('={{ with (Math) { PI } }}'), ExpressionWithStatementError);
});

test('E9: class extends Function → ExpressionClassExtensionError', () => {
	assert.throws(
		() => evalExpr('={{ (class X extends Function {}) }}'),
		ExpressionClassExtensionError,
	);
});

test('E9: bare $ and $.x → ExpressionError(DOLLAR_SIGN_ERROR)', () => {
	assert.throws(() => evalExpr('={{ $ }}'), (e) => {
		assert.ok(e instanceof ExpressionError);
		assert.equal(e.message, 'Cannot access "$" without calling it as a function');
		return true;
	});
	assert.throws(() => evalExpr('={{ $.foo }}'), ExpressionError);
});

test('E9: reserved internal variable names rejected', () => {
	assert.throws(() => evalExpr('={{ let ___n8n_data = 1 }}'), ExpressionReservedVariableError);
});

test('E9: destructuring unsafe key rejected', () => {
	assert.throws(() => evalExpr("={{ const { __proto__: x } = $json }}"), ExpressionDestructuringError);
});

test('E9: isSafeObjectProperty', () => {
	assert.equal(isSafeObjectProperty('name'), true);
	assert.equal(isSafeObjectProperty('__proto__'), false);
	assert.equal(isSafeObjectProperty('constructor'), false);
});

/* ── E10: env access ──────────────────────────────────────────────────── */
test('E10: $env access denied by default', () => {
	assert.throws(() => evalExpr('={{ $env.HOME }}'), (e) => {
		assert.ok(e instanceof ExpressionError);
		assert.equal(e.message, 'access to env vars denied');
		return true;
	});
});

test('E10: $env works when env provider state permits', () => {
	const state = { isProcessAvailable: true, isEnvAccessBlocked: false, env: { HOME: '/root' } };
	const workflow = mkWorkflow();
	const proxy = new WorkflowDataProxy(workflow, null, 0, 0, 'End', [], {}, 'manual', {}, undefined, -1, {}, 'End', state);
	const data = proxy.getDataProxy();
	assert.equal(data.$env.HOME, '/root');
});

/* ── E11: runExecutionData === null ───────────────────────────────────── */
test('E11: $json works from input with null runExecutionData', () => {
	assert.equal(evalExpr('={{ $json.a }}', { runExecutionData: null }), 10);
});

test('E11: $("X") with null runExecutionData → unexecuted error', () => {
	assert.throws(() => evalExpr('={{ $("Start").first() }}', { runExecutionData: null }), (e) => {
		assert.ok(e instanceof ExpressionError);
		assert.match(e.message, /hasn't been executed/);
		return true;
	});
});

/* ── E14: syntax errors ───────────────────────────────────────────────── */
test('E14: syntax error → ApplicationError("invalid syntax")', () => {
	assert.throws(() => evalExpr('={{ $json.a +++ }}'), (e) => {
		assert.ok(e instanceof ApplicationError);
		assert.equal(e.message, 'invalid syntax');
		return true;
	});
});

/* ── E15 / augment: copy-on-write views ───────────────────────────────── */
test('E15: augmentObject gives copy-on-write views', () => {
	const original = { a: 1, nested: { b: 2 } };
	const view = augmentObject(original);
	view.a = 99;
	assert.equal(original.a, 1); // stored data untouched
	assert.equal(view.a, 99);
	assert.equal(view.nested.b, 2);
});

/* ── §3 output semantics ─────────────────────────────────────────────── */
test('§3: single expression preserves raw types; interpolation yields strings', () => {
	assert.equal(evalExpr('={{ $json.a + 1 }}'), 11);
	assert.deepEqual(evalExpr('={{ $json }}'), { a: 10 }, '$json = connectionInputData[itemIndex].json');
	assert.equal(evalExpr('=Value: {{ 1 + 1 }}!'), 'Value: 2!');
	assert.equal(evalExpr('=x {{ {a: 1} }}'), 'x [object Object]');
	assert.equal(evalExpr('=x{{ undefined }}'), 'x', 'undefined renders as empty in text');
	assert.equal(evalExpr('=x{{ null }}'), 'x', 'null renders as empty in text');
});

test('§3: nested parameter objects and arrays resolve leaf-by-leaf', () => {
	const result = evalExpr({
		value: '={{ 10 }}',
		nested: { deep: '={{ 20 }}', static: 'text' },
		list: ['={{ 1 }}', 'plain', 7],
		num: 5,
		bool: true,
		nul: null,
	});
	assert.deepEqual(result, {
		value: 10,
		nested: { deep: 20, static: 'text' },
		list: [1, 'plain', 7],
		num: 5,
		bool: true,
		nul: null,
	});
});

test('§3: resource locator object passes through with resolved value', () => {
	const result = evalExpr({ __rl: true, mode: 'id', value: '={{ 10 }}' });
	assert.deepEqual(result, { __rl: true, mode: 'id', value: 10 });
});

test('§3: returnObjectAsString renders [Object: …]', () => {
	const workflow = mkWorkflow();
	const result = workflow.expression.getParameterValue(
		'={{ {a: 1} }}',
		{ resultData: { runData } },
		0,
		0,
		'End',
		input,
		'manual',
		{},
		executeData,
		true,
	);
	assert.equal(result, '[Object: {\"a\": 1}]');
});

/* ── $parameter / $rawParameter / siblings ────────────────────────────── */
test('$parameter resolves node parameters (expressions inside resolved)', () => {
	const workflow = mkWorkflow();
	const setParams = { greeting: '={{ "hi" }}', static: 1 };
	workflow.nodes['Set'].parameters = setParams;
	const proxy = new WorkflowDataProxy(workflow, { resultData: { runData } }, 0, 0, 'Set', input, { sibling: 7 }, 'manual', {}, executeData);
	const data = proxy.getDataProxy();
	assert.equal(data.$parameter.greeting, 'hi');
	assert.equal(data.$parameter.static, 1);
	assert.equal(data.$rawParameter.greeting, '={{ "hi" }}');
	assert.equal(data.$parameter.unknownKey, undefined);
});

/* ── extensions ──────────────────────────────────────────────────────── */
test('E12: extension .isEmpty()/.unique()/toInt resolve through extend()', () => {
	assert.equal(evalExpr('={{ 0.isEmpty() }}'), true);
	assert.equal(evalExpr('={{ [1,1,2].unique().length }}'), 2);
	assert.equal(evalExpr('={{ "42".toInt() }}'), 42);
});

test('E12: unknown extension → ExpressionExtensionError (not TypeError)', () => {
	assert.throws(() => extend(1, 'nope'), /Unknown expression function|only callable/);
});

test('extendOptional returns undefined for nullish input', () => {
	assert.equal(extendOptional(undefined, 'isEmpty'), undefined);
	assert.equal(typeof extendOptional(1, 'isEmpty'), 'function');
});

/* ── static helpers ──────────────────────────────────────────────────── */
test('Expression.resolveWithoutWorkflow evaluates against plain data', () => {
	assert.equal(Expression.resolveWithoutWorkflow('{{ a + 1 }}', { a: 41 }), 42);
});

test('Expression.initializeGlobalContext replaces dangerous globals', () => {
	const data = {};
	Expression.initializeGlobalContext(data);
	assert.deepEqual(data.eval, {});
	assert.deepEqual(data.require, {});
	assert.equal(data.Math, Math);
	assert.equal(data.JSON, JSON);
	assert.equal(typeof data.DateTime.fromISO, 'function');
});

/* ── misc data-proxy surfaces ────────────────────────────────────────── */
test('$jmespath queries objects', () => {
	assert.deepEqual(evalExpr('={{ $jmespath($json, "a") }}'), 10);
});

test('$vars without provider → undefined; additionalKeys pass through', () => {
	assert.equal(evalExpr('={{ $vars }}'), undefined);
	assert.equal(evalExpr('={{ $vars.token }}', { additionalKeys: { $vars: { token: 't' } } }), 't');
});

test('$execution / $executionId passthrough via additionalKeys', () => {
	assert.equal(
		evalExpr('={{ $execution.mode }}', { additionalKeys: { $execution: { mode: 'production' } } }),
		'production',
	);
});

test('$now / $today are luxon DateTime values', () => {
	const v = evalExpr('={{ $now }}');
	assert.equal(typeof v.toISO, 'function');
	const t = evalExpr('={{ $today.hour }}');
	assert.equal(typeof t, 'number');
});

test('$runIndex / $itemIndex / $mode / $nodeVersion exposed', () => {
	assert.deepEqual(
		[
			evalExpr('={{ $runIndex }}'),
			evalExpr('={{ $itemIndex }}', { itemIndex: 1 }),
			evalExpr('={{ $mode }}'),
			evalExpr('={{ $nodeVersion }}'),
		],
		[0, 1, 'manual', 1],
	);
});

test('$fromAI validates the key', () => {
	assert.throws(() => evalExpr("={{ $fromAI('') }}"), /Add a key/);
	assert.throws(() => evalExpr("={{ $fromAI('bad key!') }}"), /Invalid parameter key/);
});

test('getSimpleParameterValue resolves expressions with empty run data', () => {
	const workflow = mkWorkflow();
	assert.equal(workflow.expression.getSimpleParameterValue(workflow.nodes['End'], '={{ 1 + 1 }}', 'manual', {}), 2);
	assert.equal(workflow.expression.getSimpleParameterValue(workflow.nodes['End'], undefined, 'manual', {}, undefined, 'dflt'), 'dflt');
});

test('getComplexParameterValue resolves nested structures', () => {
	const workflow = mkWorkflow();
	const result = workflow.expression.getComplexParameterValue(
		workflow.nodes['End'],
		{ a: '={{ 1 }}', b: { c: '={{ 2 }}' } },
		'manual',
		{},
	);
	assert.deepEqual(result, { a: 1, b: { c: 2 } });
});

/* ── graph adapter sanity ────────────────────────────────────────────── */
test('graph adapter: getNodeConnectionIndexes resolves multi-hop ancestry', () => {
	const workflow = mkWorkflow();
	assert.deepEqual(workflow.getNodeConnectionIndexes('End', 'Set'), { sourceIndex: 0, destinationIndex: 0 });
	assert.deepEqual(workflow.getNodeConnectionIndexes('End', 'Start'), { sourceIndex: 0, destinationIndex: 0 });
	assert.equal(workflow.getNodeConnectionIndexes('Start', 'End'), undefined);
});

test('graph adapter: getParentNodes / getChildNodes ordering', () => {
	const workflow = mkWorkflow();
	assert.deepEqual(workflow.getParentNodes('End'), ['Start', 'Set']);
	assert.deepEqual(workflow.getChildNodes('Start'), ['End', 'Set']);
});

test('env provider factory respects N8N_BLOCK_ENV_ACCESS_IN_NODE', () => {
	const blocked = createEnvProviderState();
	// sandbox env without the override → blocked
	assert.equal(blocked.isEnvAccessBlocked, process.env.N8N_BLOCK_ENV_ACCESS_IN_NODE !== 'false');
	const proxy = createEnvProvider(0, 0, blocked);
	assert.throws(() => proxy.HOME, /access to env vars denied/);
});
