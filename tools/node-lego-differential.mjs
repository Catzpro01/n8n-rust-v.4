#!/usr/bin/env node
/**
 * Node LEGO differential harness — reconstruction vs the pinned reference build.
 *
 * REF = the published `n8n-workflow@2.9.1` build (the version the pinned reference
 *       commit `b6dc2787` ships), resolved from `packages/workflow-lego/node_modules`
 *       where the Phase-2 LEGO already declares it as a devDependency.
 * PORT = `packages/node-lego` (this LEGO).
 *
 * Acceptance (DIFF-01): every scenario must MATCH. A divergence is a bug in the port,
 * not an ISSUE note — so this harness is a gate:
 *   exit 0 — every scenario matched
 *   exit 1 — at least one divergence (printed with both values)
 *   exit 2 — harness break (reference build unavailable, scenario threw unexpectedly)
 *
 * Both sides are imported read-only; nothing under `reference/n8n/**` is touched.
 *
 * Usage: node tools/node-lego-differential.mjs [--verbose]
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const VERBOSE = process.argv.includes('--verbose');

/* --- reference build ------------------------------------------------------- */
const requireFromWorkflowLego = createRequire(join(REPO, 'packages/workflow-lego/package.json'));
let reference;
try {
	requireFromWorkflowLego.resolve('n8n-workflow');
	reference = requireFromWorkflowLego('n8n-workflow');
} catch (error) {
	console.error(`[HARNESS-ERROR] reference build unavailable: ${error.message}`);
	console.error('  fix: npm install (packages/workflow-lego) — n8n-workflow@2.9.1 is a declared devDependency');
	process.exit(2);
}

const port = await import(join(REPO, 'packages/node-lego/src/index.mjs'));

const REF = {
	...reference.NodeHelpers,
	deepCopy: reference.deepCopy,
	isExpression: reference.isExpression,
	ApplicationError: reference.ApplicationError,
	NodeOperationError: reference.NodeOperationError,
	validateNodeCredentials: reference.validateNodeCredentials,
	isNodeConnected: reference.isNodeConnected,
	isTriggerLikeNode: reference.isTriggerLikeNode,
	resolveRelativePath: reference.resolveRelativePath,
	isResourceLocatorValue: reference.isResourceLocatorValue,
	isResourceMapperValue: reference.isResourceMapperValue,
	isFilterValue: reference.isFilterValue,
	isAssignmentCollectionValue: reference.isAssignmentCollectionValue,
	isNodeParameterValue: reference.isNodeParameterValue,
	isNodeParameters: reference.isNodeParameters,
	isValidNodeParameterValueType: reference.isValidNodeParameterValueType,
	assertIsValidNodeParameterValueType: reference.assertIsValidNodeParameterValueType,
	assertParamIsNumber: reference.assertParamIsNumber,
	assertParamIsString: reference.assertParamIsString,
	assertParamIsBoolean: reference.assertParamIsBoolean,
	assertParamIsOfAnyTypes: reference.assertParamIsOfAnyTypes,
	assertParamIsArray: reference.assertParamIsArray,
	validateNodeParameters: reference.validateNodeParameters,
	validateFieldType: reference.validateFieldType,
};

/* `renameFormFields` is not part of the published surface (internal to workflow.ts);
 * `getPropertyValues` is private in the reference module. Both are marked NOT-DIFFABLE. */
const NOT_DIFFABLE = new Set(['renameFormFields', 'getPropertyValues']);

const EXAMINED_SURFACE = [
	'checkConditions', 'getUpdatedToolDescription', 'isSubNodeType', 'getNodeFeatures', 'displayParameter',
	'displayParameterPath', 'getConnectionTypes', 'getNodeInputs', 'getNodeOutputs', 'getParameterValueByPath',
	'mergeNodeProperties', 'getVersionedNodeType', 'isTriggerNode', 'isExecutable', 'isNodeWithWorkflowSelector',
	'makeDescription', 'isToolType', 'isHitlToolType', 'isTool', 'makeNodeName', 'isDefaultNodeName',
	'getToolDescriptionForNode', 'getSubworkflowId', 'nodeAcceptsInputType', 'nodeHasOutputType',
	'validateNodeCredentials', 'isNodeConnected', 'isTriggerLikeNode', 'resolveRelativePath',
	'isResourceLocatorValue', 'isResourceMapperValue', 'isFilterValue', 'isAssignmentCollectionValue',
	'isNodeParameterValue', 'isNodeParameters', 'isValidNodeParameterValueType',
	'assertIsValidNodeParameterValueType', 'assertParamIsNumber', 'assertParamIsString', 'assertParamIsBoolean',
	'assertParamIsOfAnyTypes', 'assertParamIsArray', 'validateNodeParameters',
	'getNodeParameters', 'getNodeParametersIssues', 'getParameterIssues', 'mergeIssues', 'validateFieldType',
	'deepCopy', 'isExpression', 'ApplicationError', 'NodeOperationError',
];

/* --- comparison ------------------------------------------------------------ */
const canon = (value) => {
	if (value instanceof Error) return { error: value.name, message: value.message };
	if (typeof value === 'function') return '[function]';
	return JSON.parse(JSON.stringify(value ?? null));
};

let comparables = 0;
let notDiffable = 0;
let agreements = 0;
const divergences = [];
let harnessErrors = 0;

const safe = (fn) => {
	try {
		return fn();
	} catch (error) {
		return { thrown: error.name, message: error.message };
	}
};

/**
 * Runs one scenario body twice — once against REF, once against PORT — and compares the
 * captured outcomes value by value. The scenario receives `(api, capture)` where
 * `capture(label, value)` records a comparable.
 */
function scenario(id, name, body) {
	const captureFor = (side) => {
		const captured = new Map();
		return { captured, capture: (label, value) => captured.set(label, canon(value)) };
	};

	const sides = {};
	for (const side of ['REF', 'PORT']) {
		const { captured, capture } = captureFor(side);
		try {
			body(side === 'REF' ? REF : port, capture);
		} catch (error) {
			harnessErrors++;
			console.error(`[HARNESS-ERROR] ${id} (${side}): ${error.message}`);
			return;
		}
		sides[side] = captured;
	}

	const labels = new Set([...sides.REF.keys(), ...sides.PORT.keys()]);
	for (const label of labels) {
		if ([...NOT_DIFFABLE].some((name) => label.includes(name))) {
			notDiffable++;
			console.log(`[NOT-DIFFABLE] ${id} :: ${label} — port=${JSON.stringify(sides.PORT.get(label))} ref=${JSON.stringify(sides.REF.get(label))}`);
			continue;
		}
		comparables++;
		try {
			assert.deepEqual(sides.PORT.get(label), sides.REF.get(label));
			agreements++;
			if (VERBOSE) console.log(`[AGREE] ${id} :: ${label}`);
		} catch {
			divergences.push({ id, label, port: sides.PORT.get(label), reference: sides.REF.get(label) });
			console.log(
				`[DIVERGE] ${id} :: ${label} — port=${JSON.stringify(sides.PORT.get(label))} ref=${JSON.stringify(sides.REF.get(label))}`,
			);
		}
	}
	console.log(`[SCENARIO] ${id} ${name} — ${sides.REF.size} comparisons`);
}

/* --- fixtures -------------------------------------------------------------- */
const workflowWith = (getSimpleParameterValue) => ({ expression: { getSimpleParameterValue } });
const q = (api, node, nodeType) => api.getNodeOutputs(workflowWith(() => []), node, nodeType);

/* --- N01: connection types + sub-node detection ---------------------------- */
scenario('N01', 'getConnectionTypes / isSubNodeType', (api, capture) => {
	capture('strings+objects+typeless', api.getConnectionTypes(['main', { type: 'ai_tool' }, {}]));
	capture('undefined entry throws (pinned quirk)', safe(() => api.getConnectionTypes(['main', undefined])));
	capture('empty', api.getConnectionTypes([]));
	capture('sub-node mixed', api.isSubNodeType({ outputs: ['main', 'ai_tool'] }));
	capture('sub-node main only', api.isSubNodeType({ outputs: ['main'] }));
	capture('sub-node expression', api.isSubNodeType({ outputs: '={{ $json.x }}' }));
	capture('sub-node null', api.isSubNodeType(null));
});

/* --- N02: node inputs / outputs ------------------------------------------- */
scenario('N02', 'getNodeInputs / getNodeOutputs', (api, capture) => {
	capture('inputs static', api.getNodeInputs(workflowWith(() => []), {}, { inputs: ['main'] }));
	capture('inputs expression', api.getNodeInputs(workflowWith(() => ['main', 'ai_tool']), {}, { inputs: '={{ }}' }));
	capture('inputs throw → []', api.getNodeInputs(workflowWith(() => { throw new Error('boom'); }), { name: 'N' }, { inputs: '={{ }}' }));
	capture('outputs static', q(api, {}, { outputs: ['main', 'ai_tool'] }));
	capture('outputs continueErrorOutput single', q(api, { onError: 'continueErrorOutput' }, { outputs: ['main'] }));
	capture('outputs continueErrorOutput multi', q(api, { onError: 'continueErrorOutput' }, { outputs: ['main', 'ai_tool'] }));
	capture('outputs continueRegularOutput untouched', q(api, { onError: 'continueRegularOutput' }, { outputs: ['main'] }));
	capture('outputs no nodeType', api.getNodeOutputs(workflowWith(() => []), {}, null));
	const nodeType = { outputs: ['main'] };
	q(api, { onError: 'continueErrorOutput' }, nodeType);
	capture('nodeType not mutated', nodeType.outputs);
	capture('outputs expression array', api.getNodeOutputs(workflowWith(() => ['main']), {}, { outputs: '={{ }}' }));
	capture('outputs expression non-array', q(api, {}, { outputs: '={{ }}' }));
});

/* --- N03: trigger / executable / IO type predicates ----------------------- */
scenario('N03', 'isExecutable / isTriggerNode / IO predicates', (api, capture) => {
	const noOutputs = { outputs: [], group: ['transform'] };
	capture('executable main', api.isExecutable(workflowWith(() => []), {}, { outputs: ['main'], group: ['transform'] }));
	capture('executable ai_tool', api.isExecutable(workflowWith(() => []), {}, { outputs: ['ai_tool'], group: ['transform'] }));
	capture('executable none', api.isExecutable(workflowWith(() => []), {}, noOutputs));
	capture('executable trigger group', api.isExecutable(workflowWith(() => []), {}, { outputs: [], group: ['trigger'] }));
	capture('executable null type', api.isExecutable(workflowWith(() => []), {}, null));
	capture('trigger node', api.isTriggerNode({ group: ['trigger', 'input'] }));
	capture('non-trigger node', api.isTriggerNode({ group: ['transform'] }));
	capture('accepts string main', api.nodeAcceptsInputType({ inputs: 'main' }, 'main'));
	capture('accepts string includes', api.nodeAcceptsInputType({ inputs: 'ai_tool' }, 'tool'));
	capture('accepts array mixed', api.nodeAcceptsInputType({ inputs: ['main', { type: 'ai_tool' }] }, 'ai_tool'));
	capture('accepts empty array', api.nodeAcceptsInputType({ inputs: [] }, 'main'));
	capture('accepts missing', api.nodeAcceptsInputType({}, 'main'));
	capture('has output string', api.nodeHasOutputType({ outputs: 'main' }, 'main'));
	capture('has output object mismatch', api.nodeHasOutputType({ outputs: [{ type: 'main' }] }, 'ai_tool'));
	capture('has output missing', api.nodeHasOutputType({}, 'main'));
});

/* --- N04: display conditions --------------------------------------------- */
scenario('N04', 'checkConditions / getNodeFeatures', (api, capture) => {
	capture('literal match', api.checkConditions(['a', 'b'], ['b']));
	capture('literal miss', api.checkConditions(['a', 'b'], ['c']));
	for (const [key, target] of [
		['eq', 5], ['not', 6], ['gte', 5], ['lte', 5], ['gt', 5], ['lt', 5],
		['between', { from: 4, to: 6 }], ['includes', 'world'], ['startsWith', 'he'],
		['endsWith', 'lo'], ['regex', '^abc\\d+$'], ['exists', null], ['unknownOp', 1],
	]) {
		const value = key === 'startsWith' || key === 'endsWith' ? 'hello' : key === 'includes' ? 'hello world' : key === 'regex' ? 'abc123' : key === 'exists' ? 'x' : 5;
		capture(`op ${key}`, api.checkConditions([{ _cnd: { [key]: target } }], [value]));
	}
	capture('empty values + not', api.checkConditions([{ _cnd: { not: 'x' } }], []));
	capture('empty values + eq', api.checkConditions([{ _cnd: { eq: 'x' } }], []));
	capture('object equality', api.checkConditions([{ _cnd: { eq: { a: 1 } } }], [{ a: 1 }]));
	capture('object inequality', api.checkConditions([{ _cnd: { eq: { a: 1 } } }], [{ a: 2 }]));
	capture('two keys not a condition', api.checkConditions([{ _cnd: { eq: 1 }, other: true }], [1]));
	capture('features undefined', api.getNodeFeatures(undefined, 1));
	capture(
		'features matrix',
		api.getNodeFeatures({ alpha: { '@version': [{ _cnd: { gte: 2 } }] }, beta: { '@version': [{ _cnd: { lt: 2 } }] } }, 2),
	);
});

/* --- N05: displayParameter / displayParameterPath ------------------------ */
scenario('N05', 'displayParameter / displayParameterPath', (api, capture) => {
	const showHide = { displayOptions: { show: { resource: ['user'] }, hide: { operation: ['remove'] } } };
	capture('show match', api.displayParameter({ resource: 'user' }, showHide, null, null));
	capture('hide wins', api.displayParameter({ resource: 'user', operation: 'remove' }, showHide, null, null));
	capture('show miss', api.displayParameter({ resource: 'other' }, showHide, null, null));
	capture('no displayOptions', api.displayParameter({}, { name: 'plain' }, null, null));
	capture('expression short-circuit', api.displayParameter({ resource: '={{ $json.x }}' }, { displayOptions: { show: { resource: ['user'] } } }, null, null));
	capture('hide empty actual list', api.displayParameter({}, { displayOptions: { hide: { resource: ['user'] } } }, null, null));
	capture('hide matched', api.displayParameter({ resource: 'user' }, { displayOptions: { hide: { resource: ['user'] } } }, null, null));
	capture('disabledOptions key', api.displayParameter({ resource: 'user' }, { disabledOptions: { show: { resource: ['user'] } } }, null, null, undefined, 'disabledOptions'));
	capture('disabledOptions miss', api.displayParameter({ resource: 'other' }, { disabledOptions: { show: { resource: ['user'] } } }, null, null, undefined, 'disabledOptions'));
	capture('@version rule', api.displayParameter({}, { displayOptions: { show: { '@version': [{ _cnd: { gte: 2 } }] } } }, { typeVersion: 3 }, null));
	capture('@version rule miss', api.displayParameter({}, { displayOptions: { show: { '@version': [{ _cnd: { gte: 4 } }] } } }, { typeVersion: 3 }, null));
	capture('@tool rule', api.displayParameter({}, { displayOptions: { show: { '@tool': [true] } } }, { typeVersion: 1 }, { name: 'n8n-nodes-base.codeTool' }));
	capture('@feature rule', api.displayParameter({}, { displayOptions: { show: { '@feature': ['f'] } } }, { typeVersion: 2 }, { name: 'x', features: { f: { '@version': [{ _cnd: { gte: 1 } }] } } }));
	capture('root-prefixed rule', api.displayParameter({ a: 'x' }, { displayOptions: { show: { '/a': ['x'] } } }, null, null));
	capture('locator unwrap', api.displayParameter({ rl: { __rl: true, mode: 'list', value: 'v1' } }, { displayOptions: { show: { rl: ['v1'] } } }, null, null));

	const rootRule = { displayOptions: { show: { '/parent': ['x'] } } };
	const directRule = { displayOptions: { show: { child: ['x'] } } };
	const values = { parameters: { parent: 'x', child: 'x' }, sub: { child: 'x' } };
	capture('path values via parameters', api.displayParameterPath(values, directRule, 'parameters', null, null));
	capture('path values via sub', api.displayParameterPath(values, directRule, 'sub', null, null));
	capture('root rule at parameters', api.displayParameterPath(values, rootRule, 'parameters', null, null));
	capture('root rule at sub', api.displayParameterPath(values, rootRule, 'sub', null, null));
	capture('root rule without path', api.displayParameter({ sub: values.sub }, rootRule, null, null));
});

/* --- N06: node validation ------------------------------------------------ */
scenario('N06', 'validateNodeCredentials / isNodeConnected / isTriggerLikeNode', (api, capture) => {
	const node = (extra = {}) => ({ id: '1', name: 'Node', type: 'n8n-nodes-base.test', typeVersion: 1, position: [0, 0], parameters: {}, ...extra });
	const cred = (overrides = {}) => ({ name: 'testApi', required: true, displayName: 'Test API', ...overrides });

	capture('all set', api.validateNodeCredentials(node({ credentials: { testApi: { id: 'c1', name: 'My Cred' } } }), { description: { credentials: [cred()] } }));
	capture('missing', api.validateNodeCredentials(node(), { description: { credentials: [cred()] } }));
	capture('not-configured', api.validateNodeCredentials(node({ credentials: { testApi: { name: 'My Cred' } } }), { description: { credentials: [cred()] } }));
	capture('optional skipped', api.validateNodeCredentials(node(), { description: { credentials: [cred({ required: false })] } }));
	capture('displayName fallback', api.validateNodeCredentials(node(), { description: { credentials: [{ name: 'testApi', required: true }] } }));
	capture('hidden credential', api.validateNodeCredentials(node({ parameters: { mode: 'simple' } }), { description: { credentials: [cred({ displayOptions: { show: { mode: ['advanced'] } } })] } }));
	capture('shown credential', api.validateNodeCredentials(node({ parameters: { mode: 'advanced' } }), { description: { credentials: [cred({ displayOptions: { show: { mode: ['advanced'] } } })] } }));
	capture('multiple missing', api.validateNodeCredentials(node(), { description: { credentials: [cred(), cred({ name: 'otherApi', displayName: 'Other' })] } }));

	const outgoing = { Node: { main: [[{ node: 'Next', type: 'main', index: 0 }]] } };
	const incoming = { Node: { main: [[{ node: 'Prev', type: 'main', index: 0 }]] } };
	capture('connected outgoing', api.isNodeConnected('Node', outgoing, {}));
	capture('connected incoming', api.isNodeConnected('Node', {}, incoming));
	capture('connected both', api.isNodeConnected('Node', outgoing, incoming));
	capture('connected none', api.isNodeConnected('Node', {}, {}));
	capture('connected empty maps', api.isNodeConnected('Node', { Node: {} }, { Node: {} }));

	capture('trigger-like trigger', api.isTriggerLikeNode({ trigger: () => {} }));
	capture('trigger-like webhook', api.isTriggerLikeNode({ webhook: () => {} }));
	capture('trigger-like poll', api.isTriggerLikeNode({ poll: () => {} }));
	capture('trigger-like plain', api.isTriggerLikeNode({}));
	capture('trigger-like execute only', api.isTriggerLikeNode({ execute: () => {} }));
});

/* --- N07: parameter paths ------------------------------------------------ */
scenario('N07', 'resolveRelativePath / getParameterValueByPath', (api, capture) => {
	const rows = [
		['parameters.level1.level2.field', '&childField'],
		['parameters.level1.level2[0].field', '&childField'],
		['parameters.level1.level2.field', 'absolute.path'],
		['parameters', '&childField'],
		['parameters.level1.level2.field', ''],
		['', '&childField'],
		['', ''],
		['parameters.level1.level2.field', 'relative.path'],
	];
	for (const [fullPath, candidate] of rows) capture(`relative ${fullPath}+${candidate}`, api.resolveRelativePath(fullPath, candidate));
	capture('by path root', api.getParameterValueByPath({ a: 1 }, 'a', ''));
	capture('by path nested', api.getParameterValueByPath({ sub: { a: 2 } }, 'a', 'sub'));
	capture('by path missing', api.getParameterValueByPath({}, 'missing', ''));
});

/* --- N08: value guards --------------------------------------------------- */
scenario('N08', 'node parameter value guards', (api, capture) => {
	for (const value of ['s', 1, true, undefined, null]) capture(`primitive ${String(value)}`, api.isNodeParameterValue(value));
	capture('primitive object rejected', api.isNodeParameterValue({}));
	capture('locator valid', api.isResourceLocatorValue({ __rl: true, mode: 'list', value: 'v' }));
	capture('locator missing __rl', api.isResourceLocatorValue({ mode: 'list', value: 'v' }));
	capture('mapper valid', api.isResourceMapperValue({ mappingMode: 'auto', schema: [], value: {} }));
	capture('filter valid', api.isFilterValue({ conditions: [], combinator: 'and' }));
	capture('assignment valid', api.isAssignmentCollectionValue({ assignments: [{ id: '1', name: 'a', value: 'b' }] }));
	capture('assignment invalid id', api.isAssignmentCollectionValue({ assignments: [{ id: 1, name: 'a', value: 'b' }] }));
	capture('parameters nested', api.isNodeParameters({ a: { b: [1, 'x'] } }));
	capture('parameters Date rejected', api.isNodeParameters(new Date()));
	capture('parameters array rejected', api.isNodeParameters([1, 2]));
	capture('valid type object', api.isValidNodeParameterValueType({ a: 1 }));
	capture('valid type Date in object', api.isValidNodeParameterValueType({ a: new Date() }));
	capture('valid type array of objects', api.isValidNodeParameterValueType([{ a: 1 }]));
	capture('valid type array of dates', api.isValidNodeParameterValueType([new Date()]));
	capture('valid type empty array', api.isValidNodeParameterValueType([]));
	capture('valid type locator', api.isValidNodeParameterValueType({ __rl: true, mode: 'list', value: 'v' }));
});

/* --- N09: assertions ----------------------------------------------------- */
scenario('N09', 'assertion helpers', (api, capture) => {
	const node = { name: 'Node' };
	const outcome = (fn) => {
		try {
			fn();
			return 'ok';
		} catch (error) {
			return {
				name: error.name,
				message: error.message,
				level: error.level,
				hasNode: error.node !== undefined && error.node !== null,
				context: error.context,
				messages: error.messages,
				timestamp: typeof error.timestamp,
				code: error.code,
			};
		}
	};
	capture('assert valid type', outcome(() => api.assertIsValidNodeParameterValueType({ a: 1 })));
	capture('assert invalid type', outcome(() => api.assertIsValidNodeParameterValueType(new Date())));
	capture('assert custom message', outcome(() => api.assertIsValidNodeParameterValueType(new Date(), 'custom message')));
	capture('assert number ok', outcome(() => api.assertParamIsNumber('count', 1, node)));
	capture('assert number fail', outcome(() => api.assertParamIsNumber('count', 'x', node)));
	capture('assert string fail', outcome(() => api.assertParamIsString('name', 1, node)));
	capture('assert boolean fail', outcome(() => api.assertParamIsBoolean('flag', 'x', node)));
	capture('assert any types ok', outcome(() => api.assertParamIsOfAnyTypes('x', 1, ['string', 'number'], node)));
	capture('assert any types fail', outcome(() => api.assertParamIsOfAnyTypes('x', true, ['string', 'number'], node)));
	capture('assert array fail', outcome(() => api.assertParamIsArray('ids', 'x', () => true, node)));
	// eslint-disable-next-line no-sparse-arrays
	capture('assert array sparse', outcome(() => api.assertParamIsArray('ids', [, 'a'], (v) => typeof v === 'string', node)));
	capture('assert array ok', outcome(() => api.assertParamIsArray('ids', ['a'], (v) => typeof v === 'string', node)));
});

/* --- N10: validateNodeParameters ---------------------------------------- */
scenario('N10', 'validateNodeParameters', (api, capture) => {
	const node = { name: 'Node' };
	const parameters = {
		name: { type: 'string' }, count: { type: 'number' }, flag: { type: 'boolean' }, ids: { type: 'string[]' },
		locator: { type: 'resource-locator' }, payload: { type: 'object' }, either: { type: ['string', 'number'] },
	};
	const outcome = (value, params = parameters) => {
		try {
			api.validateNodeParameters(value, params, node);
			return 'ok';
		} catch (error) {
			return {
				name: error.name,
				message: error.message,
				level: error.level,
				nodeIdentity: error.node === node,
				context: error.context,
				messages: error.messages,
				timestamp: typeof error.timestamp,
			};
		}
	};
	capture('all valid', outcome({ name: 'x', count: 1, flag: true, ids: ['a'], locator: { __rl: true, mode: 'list', value: 'v' }, payload: {}, either: 3 }));
	capture('all absent', outcome({}));
	capture('not an object', outcome('not-an-object', {}));
	capture('required missing', outcome({}, { name: { type: 'string', required: true } }));
	capture('wrong string', outcome({ name: 1 }, { name: { type: 'string' } }));
	capture('wrong number', outcome({ count: 'x' }, { count: { type: 'number' } }));
	capture('wrong boolean', outcome({ flag: 'x' }, { flag: { type: 'boolean' } }));
	capture('not array', outcome({ ids: 'a' }, { ids: { type: 'string[]' } }));
	capture('bad array element', outcome({ ids: [1] }, { ids: { type: 'string[]' } }));
	capture('bad locator', outcome({ locator: {} }, { locator: { type: 'resource-locator' } }));
	capture('bad object', outcome({ payload: 5 }, { payload: { type: 'object' } }));
	capture('no union match', outcome({ either: true }, { either: { type: ['string', 'number'] } }));
	capture('union second match', outcome({ either: 3 }, { either: { type: ['string', 'number'] } }));
	capture('number[] element', outcome({ ids: [1] }, { ids: { type: 'number[]' } }));
	capture('boolean[] element', outcome({ ids: [true] }, { ids: { type: 'boolean[]' } }));
});

/* --- N11: properties ---------------------------------------------------- */
scenario('N11', 'mergeNodeProperties / getVersionedNodeType', (api, capture) => {
	const main = [{ name: 'a', type: 'string' }];
	api.mergeNodeProperties(main, [{ name: 'a', type: 'number' }, { name: 'b', type: 'string' }, { name: 'c', type: 'string', doNotInherit: true }]);
	capture('merged in place', main);
	const versioned = { nodeVersions: {}, getNodeType: (v) => ({ version: v }) };
	capture('versioned container', api.getVersionedNodeType(versioned, 2));
	const plain = { description: {} };
	capture('plain node type identity', api.getVersionedNodeType(plain) === plain);
	capture('workflow selector execute', api.isNodeWithWorkflowSelector({ type: 'n8n-nodes-base.executeWorkflow' }));
	capture('workflow selector tool', api.isNodeWithWorkflowSelector({ type: '@n8n/n8n-nodes-langchain.toolWorkflow' }));
	capture('workflow selector plain', api.isNodeWithWorkflowSelector({ type: 'n8n-nodes-base.set' }));
});

/* --- N12: names + descriptions ------------------------------------------ */
const SLACK = {
	name: 'n8n-nodes-base.slack',
	displayName: 'Slack',
	description: 'Send Slack messages',
	defaults: { name: 'Slack' },
	properties: [
		{ name: 'operation', options: [{ name: 'Send', value: 'send', action: 'Send a message' }], displayOptions: { show: { resource: ['message'] } } },
	],
};

scenario('N12', 'makeDescription / makeNodeName', (api, capture) => {
	capture('description with action', api.makeDescription({ resource: 'message', operation: 'send' }, SLACK));
	capture('description resource+operation', api.makeDescription({ resource: 'other', operation: 'delete' }, SLACK));
	capture('description fallback', api.makeDescription({}, { ...SLACK, properties: [] }));
	capture('name with action', api.makeNodeName({ resource: 'message', operation: 'send' }, SLACK));
	capture('name fallback', api.makeNodeName({}, { ...SLACK, properties: [] }));
	capture('name skipNameGeneration', api.makeNodeName({ resource: 'message', operation: 'send' }, { ...SLACK, skipNameGeneration: true, defaults: { name: 'Test Node Default' } }));

	const code = {
		name: 'n8n-nodes-base.code', displayName: 'Code', description: 'Run code', defaults: { name: 'Code' },
		properties: [{ name: 'language', options: [{ name: 'JS', value: 'javaScript', action: 'Code in JavaScript' }] }],
	};
	capture('code language action', api.makeNodeName({ language: 'javaScript' }, code));

	const tool = {
		name: 'n8n-nodes-base.someTool', displayName: 'Some Tool', description: 'd', defaults: { name: 'Some Tool' },
		outputs: [{ type: 'ai_tool' }],
		properties: [{ name: 'operation', options: [{ name: 'Do', value: 'do', action: 'Do a thing' }], displayOptions: { show: { resource: ['x'] } } }],
	};
	capture('tool name postfix', api.makeNodeName({ resource: 'x', operation: 'do' }, tool));
	capture('tool name without ai_tool output', api.makeNodeName({ resource: 'x', operation: 'do' }, { ...tool, outputs: ['main'] }));
	capture('vector store tool mode', api.isTool({ name: 'n8n-nodes-base.vectorStoreQdrant', outputs: ['ai_tool'] }, { mode: 'retrieve-as-tool' }));
	capture('vector store insert mode', api.isTool({ name: 'n8n-nodes-base.vectorStoreQdrant', outputs: ['ai_tool'] }, { mode: 'insert' }));
	capture('isTool plain node', api.isTool(SLACK, {}));
});

/* --- N13: default names + tool types ----------------------------------- */
scenario('N13', 'isDefaultNodeName / tool type predicates', (api, capture) => {
	const set = { name: 'n8n-nodes-base.set', displayName: 'Set', defaults: { name: 'Set' }, description: 'd', properties: [] };
	capture('default exact', api.isDefaultNodeName('Set', set, {}));
	capture('default numbered', api.isDefaultNodeName('Set1', set, {}));
	capture('default with suffix text', api.isDefaultNodeName('SetX', set, {}));
	capture('default other name', api.isDefaultNodeName('Other', set, {}));
	capture('tool type suffix', api.isToolType('n8n-nodes-base.httpRequestTool'));
	capture('tool type prefix', api.isToolType('@n8n/n8n-nodes-langchain.toolCode'));
	capture('tool type hitl default', api.isToolType('n8n-nodes-base.thingHitlTool'));
	capture('tool type hitl excluded', api.isToolType('n8n-nodes-base.thingHitlTool', { includeHitl: false }));
	capture('tool type undefined', api.isToolType(undefined));
	capture('tool type plain', api.isToolType('n8n-nodes-base.httpRequest'));
	capture('hitl true', api.isHitlToolType('n8n-nodes-base.thingHitlTool'));
	capture('hitl false', api.isHitlToolType('n8n-nodes-base.thingTool'));
});

/* --- N14: tool descriptions + subworkflow id --------------------------- */
scenario('N14', 'getToolDescriptionForNode / getUpdatedToolDescription / getSubworkflowId', (api, capture) => {
	const nodeType = {
		description: { name: 'n8n-nodes-base.tool', displayName: 'Tool', defaults: { name: 'Tool' }, description: 'auto description', properties: [] },
	};
	capture('auto description', api.getToolDescriptionForNode({ parameters: { descriptionType: 'auto' } }, nodeType));
	capture('manual description', api.getToolDescriptionForNode({ parameters: { descriptionType: 'manual', toolDescription: 'manual text' } }, nodeType));
	capture('blank toolDescription', api.getToolDescriptionForNode({ parameters: { descriptionType: 'manual', toolDescription: '   ' } }, nodeType));
	capture(
		'updated description refresh',
		api.getUpdatedToolDescription(nodeType.description, { descriptionType: 'manual', toolDescription: 'auto description' }, { descriptionType: 'manual', toolDescription: 'auto description' }),
	);
	capture(
		'updated description preserved',
		api.getUpdatedToolDescription(nodeType.description, { descriptionType: 'manual', toolDescription: 'hand written' }, { descriptionType: 'manual', toolDescription: 'auto description' }),
	);
	capture('updated description null type', api.getUpdatedToolDescription(null, { descriptionType: 'manual', toolDescription: 'x' }, {}));
	capture(
		'subworkflow id locator',
		api.getSubworkflowId({ type: 'n8n-nodes-base.executeWorkflow', parameters: { workflowId: { __rl: true, mode: 'id', value: 'wf-1' } } }),
	);
	capture('subworkflow id plain param', api.getSubworkflowId({ type: 'n8n-nodes-base.executeWorkflow', parameters: { workflowId: 'wf-1' } }));
	capture('subworkflow id other node', api.getSubworkflowId({ type: 'n8n-nodes-base.set', parameters: { workflowId: { __rl: true, mode: 'id', value: 'wf-1' } } }));
});

/* --- N15: surface parity ------------------------------------------------- */
scenario('N15', 'exported surface', (api, capture) => {
	for (const name of EXAMINED_SURFACE) {
		capture(`surface ${name}`, typeof api[name]);
	}
	capture('NOT-DIFFABLE renameFormFields', typeof api.renameFormFields);
	capture('NOT-DIFFABLE getPropertyValues', typeof api.getPropertyValues);
});

/* --- N16/N17: getNodeParameters (parameter resolution) ------------------- */
const paramNode = { typeVersion: 1 };

const PARAM_FIXTURES = {
	'plain values': {
		nodePropertiesArray: [
			{ name: 'string1', displayName: 'String 1', type: 'string', default: '' },
			{ name: 'string2', displayName: 'String 2', type: 'string', default: 'default string 2' },
			{ name: 'number1', displayName: 'Number 1', type: 'number', default: 10 },
			{ name: 'boolean1', displayName: 'Boolean 1', type: 'boolean', default: false },
			{ name: 'options1', displayName: 'Options 1', type: 'options', default: 'a', options: [{ name: 'A', value: 'a' }] },
		],
		nodeValues: { number1: 0, boolean1: false, string1: 'hello' },
	},
	'show match': {
		nodePropertiesArray: [
			{ name: 'mode', displayName: 'Mode', type: 'options', default: 'a', options: [{ name: 'A', value: 'a' }, { name: 'B', value: 'b' }] },
			{ name: 'child', displayName: 'Child', type: 'string', default: 'x', displayOptions: { show: { mode: ['b'] } } },
		],
		nodeValues: { mode: 'b' },
	},
	'show mismatch with value': {
		nodePropertiesArray: [
			{ name: 'mode', displayName: 'Mode', type: 'options', default: 'a', options: [{ name: 'A', value: 'a' }] },
			{ name: 'child', displayName: 'Child', type: 'string', default: 'x', displayOptions: { show: { mode: ['b'] } } },
		],
		nodeValues: { mode: 'a', child: 'hidden but set' },
	},
	'duplicate names': {
		nodePropertiesArray: [
			{ name: 'resource', displayName: 'Resource', type: 'options', default: 'r1', options: [{ name: 'R1', value: 'r1' }] },
			{ name: 'value', displayName: 'V1', type: 'string', default: 'd1', displayOptions: { show: { resource: ['r1'] } } },
			{ name: 'value', displayName: 'V2', type: 'string', default: 'd2', displayOptions: { show: { resource: ['r2'] } } },
		],
		nodeValues: { resource: 'r2', value: 'user value' },
	},
	'noDataExpression': {
		nodePropertiesArray: [
			{ name: 'code', displayName: 'Code', type: 'string', default: '', noDataExpression: true },
			{ name: 'keep', displayName: 'Keep', type: 'string', default: '' },
		],
		nodeValues: { code: '={{ 1 + 1 }}', keep: '=not stripped' },
	},
	'resourceLocator default': {
		nodePropertiesArray: [{ name: 'rl', displayName: 'RL', type: 'resourceLocator', default: { mode: 'list', value: 'v' } }],
		nodeValues: {},
	},
	'collection multipleValues': {
		nodePropertiesArray: [
			{ name: 'col', displayName: 'Col', type: 'collection', default: [], typeOptions: { multipleValues: true }, options: [{ name: 'a', displayName: 'A', type: 'string', default: '' }] },
		],
		nodeValues: { col: [{ a: 'x' }] },
	},
	'collection single': {
		nodePropertiesArray: [
			{ name: 'col', displayName: 'Col', type: 'collection', default: {}, options: [{ name: 'a', displayName: 'A', type: 'string', default: 'da' }, { name: 'b', displayName: 'B', type: 'string', default: 'db' }] },
		],
		nodeValues: { col: { b: 'user' } },
	},
	'fixedCollection multipleValues': {
		nodePropertiesArray: [
			{ name: 'fc', displayName: 'FC', type: 'fixedCollection', default: {}, typeOptions: { multipleValues: true }, options: [{ name: 'item', displayName: 'Item', values: [{ name: 'v', displayName: 'V', type: 'string', default: '' }] }] },
		],
		nodeValues: { fc: { item: [{ v: 'one' }, { v: 'two' }] } },
	},
	'fixedCollection default-only values': {
		nodePropertiesArray: [
			{ name: 'fc', displayName: 'FC', type: 'fixedCollection', default: {}, typeOptions: { multipleValues: false }, options: [{ name: 'item', displayName: 'Item', values: [{ name: 'v', displayName: 'V', type: 'string', default: 'dv' }] }] },
		],
		nodeValues: { fc: { item: { v: 'dv' } } },
	},
	'fixedCollection empty value': {
		nodePropertiesArray: [
			{ name: 'fc', displayName: 'FC', type: 'fixedCollection', default: {}, typeOptions: { multipleValues: false }, options: [{ name: 'item', displayName: 'Item', values: [{ name: 'v', displayName: 'V', type: 'string', default: 'dv' }] }] },
		],
		nodeValues: { fc: {} },
	},
	'fixedCollection hidden fields': {
		nodePropertiesArray: [
			{
				name: 'fc', displayName: 'FC', type: 'fixedCollection', default: {}, typeOptions: { multipleValues: false },
				options: [{ name: 'item', displayName: 'Item', values: [
					{ name: 'mode', displayName: 'Mode', type: 'options', default: 'a', options: [{ name: 'A', value: 'a' }] },
					{ name: 'child', displayName: 'Child', type: 'string', default: '', displayOptions: { show: { mode: ['b'] } } },
				] }],
			},
		],
		nodeValues: { fc: { item: { mode: 'a', child: 'typed but hidden' } } },
	},
	'null values': { nodePropertiesArray: [{ name: 'a', displayName: 'A', type: 'string', default: 'da' }], nodeValues: null },
	'root-prefixed rule': {
		nodePropertiesArray: [
			{ name: 'top', displayName: 'Top', type: 'string', default: 'dt' },
			{ name: 'child', displayName: 'Child', type: 'string', default: 'dc', displayOptions: { show: { '/top': ['dt'] } } },
		],
		nodeValues: { child: 'kept?' },
	},
};

function runParameters(api, fixture, returnDefaults, returnNoneDisplayed, options = undefined) {
	try {
		return api.getNodeParameters(fixture.nodePropertiesArray, fixture.nodeValues, returnDefaults, returnNoneDisplayed, paramNode, null, options);
	} catch (error) {
		return { thrown: error.name, message: error.message };
	}
}

scenario('N16', 'getNodeParameters matrix (defaults × noneDisplayed)', (api, capture) => {
	for (const [name, fixture] of Object.entries(PARAM_FIXTURES)) {
		for (const returnDefaults of [false, true]) {
			for (const returnNoneDisplayed of [false, true]) {
				capture(`${name} [d=${returnDefaults} n=${returnNoneDisplayed}]`, runParameters(api, fixture, returnDefaults, returnNoneDisplayed));
			}
		}
	}
});

scenario('N17', 'getNodeParameters edge cases', (api, capture) => {
	capture('mutual dependency guard', runParameters(api, {
		nodePropertiesArray: [
			{ name: 'a', displayName: 'A', type: 'string', default: '', displayOptions: { show: { b: ['x'] } } },
			{ name: 'b', displayName: 'B', type: 'string', default: '', displayOptions: { show: { a: ['x'] } } },
		],
		nodeValues: { a: '1', b: '2' },
	}, true, false));
	capture('self dependency guard', runParameters(api, {
		nodePropertiesArray: [{ name: 'a', displayName: 'A', type: 'string', default: '', displayOptions: { show: { a: ['x'] } } }],
		nodeValues: { a: 'x' },
	}, false, false));
	capture('unknown fixedCollection option', runParameters(api, {
		nodePropertiesArray: [
			{ name: 'fc', displayName: 'FC', type: 'fixedCollection', default: {}, typeOptions: { multipleValues: true }, options: [{ name: 'known', displayName: 'K', values: [{ name: 'v', displayName: 'V', type: 'string', default: '' }] }] },
		],
		nodeValues: { fc: { unknown: [{ v: '1' }] } },
	}, false, false));
	capture('Date value through deepCopy', runParameters(api, {
		nodePropertiesArray: [{ name: 'd', displayName: 'D', type: 'dateTime', default: new Date(0) }],
		nodeValues: { d: new Date(1000) },
	}, true, false));
	capture('onlySimpleTypes + dataIsResolved', runParameters(api, {
		nodePropertiesArray: [
			{ name: 'col', displayName: 'Col', type: 'collection', default: {}, options: [{ name: 'a', displayName: 'A', type: 'string', default: 'da' }] },
			{ name: 'plain', displayName: 'P', type: 'string', default: 'dp' },
		],
		nodeValues: { col: { a: 'x' }, plain: 'y' },
	}, false, false, { onlySimpleTypes: true, dataIsResolved: true }));
	capture('parentType=collection keeps defaults', runParameters(api, {
		nodePropertiesArray: [{ name: 'a', displayName: 'A', type: 'string', default: 'da' }],
		nodeValues: { a: 'da' },
	}, false, false, { parentType: 'collection', dataIsResolved: true }));
	capture('noDataExpression on a number', runParameters(api, {
		nodePropertiesArray: [{ name: 'n', displayName: 'N', type: 'number', default: 1, noDataExpression: true }],
		nodeValues: { n: 5 },
	}, false, false));
	capture('collection with empty object value', runParameters(api, {
		nodePropertiesArray: [
			{ name: 'col', displayName: 'Col', type: 'collection', default: {}, options: [{ name: 'a', displayName: 'A', type: 'string', default: 'da' }, { name: 'b', displayName: 'B', type: 'string', default: 'db' }] },
		],
		nodeValues: { col: {} },
	}, true, false));
	capture('fixedCollection element not an array', runParameters(api, {
		nodePropertiesArray: [
			{ name: 'fc', displayName: 'FC', type: 'fixedCollection', default: {}, typeOptions: { multipleValues: true }, options: [{ name: 'item', displayName: 'Item', values: [{ name: 'v', displayName: 'V', type: 'string', default: '' }] }] },
		],
		nodeValues: { fc: { item: 'not-an-array' } },
	}, false, false));
	capture('collection defaults', runParameters(api, {
		nodePropertiesArray: [{ name: 'col', displayName: 'Col', type: 'collection', default: {}, options: [{ name: 'a', displayName: 'A', type: 'string', default: 'da' }] }],
		nodeValues: {},
	}, true, false));
	capture('hidden parameter with defaults', runParameters(api, {
		nodePropertiesArray: [
			{ name: 'mode', displayName: 'Mode', type: 'options', default: 'a', options: [{ name: 'A', value: 'a' }] },
			{ name: 'child', displayName: 'Child', type: 'string', default: 'dc', displayOptions: { show: { mode: ['b'] } } },
		],
		nodeValues: { mode: 'a' },
	}, true, false));
});

/* --- N18: deepCopy / isExpression / error classes ------------------------ */
scenario('N18', 'deepCopy / isExpression / error surface', (api, capture) => {
	capture('deepCopy(Date)', api.deepCopy(new Date(0)));
	capture('deepCopy primitives', ['a', 1, true, null, undefined].map((value) => api.deepCopy(value)));
	capture('deepCopy function identity', typeof api.deepCopy(() => 1));
	capture('deepCopy cycle', (() => { const source = { a: 1 }; source.self = source; const copy = api.deepCopy(source); return { a: copy.a, selfIsCopy: copy.self === copy, isSameRef: copy === source }; })());
	capture('deepCopy nested array', api.deepCopy({ a: [1, { b: 2 }] }));
	capture('deepCopy prototype is a plain object', Object.getPrototypeOf(api.deepCopy({ a: 1 })) === Object.prototype);
	capture('isExpression matrix', ['=', '=1+1', 'x', '', 1, null, undefined].map((value) => api.isExpression(value)));
	capture('ApplicationError surface', (() => { const error = new api.ApplicationError('boom', { extra: { k: 1 } }); return { name: error.name, level: error.level, extra: error.extra, tags: error.tags }; })());
	capture('NodeOperationError surface', (() => { const error = new api.NodeOperationError({ name: 'N', type: 't' }, 'x', { level: 'info' }); return { name: error.name, level: error.level, messages: error.messages, context: error.context }; })());
});

/* --- N19-N20: parameter issues engine ------------------------------------ */
scenario('N19', 'getParameterIssues / getNodeParametersIssues', (api, capture) => {
	const issueNode = { id: '1', name: 'Test', type: 'test', typeVersion: 1, position: [0, 0], parameters: {} };
	const check = (label, property, values) => capture(label, api.getParameterIssues(property, values, '', { ...issueNode, parameters: values }, null));
	check('required string', { name: 'x', displayName: 'X', type: 'string', required: true }, { x: '' });
	check('hidden required', { name: 'x', displayName: 'X', type: 'string', required: true, displayOptions: { show: { mode: ['yes'] } } }, { mode: 'no', x: '' });
	check('locator regex', { name: 'id', displayName: 'ID', type: 'resourceLocator', modes: [{ name: 'id', validation: [{ type: 'regex', properties: { regex: '[0-9]+', errorMessage: 'digits only' } }] }] }, { id: { mode: 'id', value: 'bad' } });
	check('validate number', { name: 'n', displayName: 'N', type: 'string', validateType: 'number' }, { n: 'bad' });
	check('fixed count + child', { name: 'fields', displayName: 'Fields', type: 'fixedCollection', typeOptions: { multipleValues: true, minRequiredFields: 2 }, options: [{ name: 'values', displayName: 'Values', values: [{ name: 'name', displayName: 'Name', type: 'string', required: true }] }] }, { fields: { values: [{ name: '' }] } });
	const top = [{ name: 'x', displayName: 'X', type: 'string', required: true }];
	capture('node clean null', api.getNodeParametersIssues(top, { ...issueNode, parameters: { x: 'ok' } }, null));
	capture('node issue', api.getNodeParametersIssues(top, { ...issueNode, parameters: { x: '' } }, null));
	capture('node disabled', api.getNodeParametersIssues(top, { ...issueNode, disabled: true, parameters: { x: '' } }, null));
	const merged = { parameters: { a: ['one'] } };
	api.mergeIssues(merged, { execution: true, parameters: { a: ['two'], b: ['three'] }, typeUnknown: true });
	capture('mergeIssues', merged);
});

scenario('N20', 'validateFieldType issue-facing types', (api, capture) => {
	for (const [name, value, type, options] of [
		['number valid', '42', 'number'], ['number invalid', 'x', 'number'],
		['boolean valid', 'false', 'boolean'], ['alpha invalid', 'has space', 'string-alphanumeric'],
		['array valid', '[1,2]', 'array'], ['object invalid', '[]', 'object'],
		['option invalid', 'x', 'options', { valueOptions: [{ value: 'a' }] }],
		['url invalid', 'javascript:alert(1)', 'url'], ['jwt invalid', 'nope', 'jwt'],
	]) capture(name, api.validateFieldType(name, value, type, options));
});

/* --- report -------------------------------------------------------------- */
const missing = EXAMINED_SURFACE.filter((name) => typeof port[name] !== 'function');
if (missing.length) {
	harnessErrors++;
	console.error(`[HARNESS-ERROR] port exports missing: ${missing.join(', ')}`);
}

console.log('-------------------------------------------------------');
console.log(
	`NODE LEGO DIFFERENTIAL: ${agreements} agree / ${divergences.length} diverge / ${comparables} comparisons` +
		` (${NOT_DIFFABLE.size} NOT-DIFFABLE, ${harnessErrors} harness errors)`,
);
console.log(`reference: n8n-workflow@${reference.NodeHelpers ? requireFromWorkflowLego('n8n-workflow/package.json').version : '?'} (published build of the pinned version)`);
if (harnessErrors) process.exit(2);
process.exit(divergences.length ? 1 : 0);
