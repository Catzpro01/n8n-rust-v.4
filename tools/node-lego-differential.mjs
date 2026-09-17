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

/**
 * DELTA-04: the port has no `luxon` dependency — `tryToParseDateTime`/`validateFieldType`
 * take an injected factory. Injecting the reference's own luxon here keeps the date-time
 * cascade bit-for-bit comparable (both sides then return a luxon `DateTime`).
 */
let dateTimeFactory;
try {
	const { DateTime } = requireFromWorkflowLego('luxon');
	dateTimeFactory = {
		isDateTime: (value) => DateTime.isDateTime(value),
		fromJSDate: (value, options) => DateTime.fromJSDate(value, options),
		fromISO: (value, options) => DateTime.fromISO(value, options),
		fromHTTP: (value, options) => DateTime.fromHTTP(value, options),
		fromRFC2822: (value, options) => DateTime.fromRFC2822(value, options),
		fromSQL: (value, options) => DateTime.fromSQL(value, options),
		fromMillis: (value, options) => DateTime.fromMillis(value, options),
	};
} catch (error) {
	console.error(`[HARNESS-ERROR] luxon unavailable (needed for DELTA-04 injection): ${error.message}`);
	process.exit(2);
}

/** Normalises a value for comparison: luxon DateTime -> its ISO string. */
const norm = (value) => {
	try {
		if (dateTimeFactory.isDateTime(value)) return { dateTime: value.toISO() };
	} catch {
		/* not a DateTime */
	}
	return value;
};

const REF = {
	...reference.NodeHelpers,
	validateFieldType: reference.validateFieldType,
	getValueDescription: reference.getValueDescription,
	jsonParse: reference.jsonParse,
	tryToParseNumber: reference.tryToParseNumber,
	tryToParseString: reference.tryToParseString,
	tryToParseAlphanumericString: reference.tryToParseAlphanumericString,
	tryToParseBoolean: reference.tryToParseBoolean,
	tryToParseDateTime: reference.tryToParseDateTime,
	tryToParseTime: reference.tryToParseTime,
	tryToParseArray: reference.tryToParseArray,
	tryToParseObject: reference.tryToParseObject,
	tryToParseBinary: reference.tryToParseBinary,
	tryToParseUrl: reference.tryToParseUrl,
	tryToParseJwt: reference.tryToParseJwt,
	tryToParseJsonToFormFields: reference.tryToParseJsonToFormFields,
	extractReferencesInNodeExpressions: reference.extractReferencesInNodeExpressions,
	hasDotNotationBannedChar: reference.hasDotNotationBannedChar,
	backslashEscape: reference.backslashEscape,
	dollarEscape: reference.dollarEscape,
	applyAccessPatterns: reference.applyAccessPatterns,
	OperationalError: reference.OperationalError,
	validateFilterParameter: reference.validateFilterParameter,
	executeFilter: reference.executeFilter,
	executeFilterCondition: reference.executeFilterCondition,
	arrayContainsValue: reference.arrayContainsValue,
	FilterError: reference.FilterError,
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
};

/**
 * The three lodash helpers the node-reference parser imports are re-exported by this LEGO but
 * are NOT part of the published `n8n-workflow` surface (upstream gets them from `lodash`), so
 * they are compared against lodash itself instead of the package build.
 */
const PORT_ONLY_SURFACE = ['cloneDeep', 'mapValues', 'escapeRegExp'];

let lodash;
try {
	lodash = requireFromWorkflowLego('lodash');
} catch (error) {
	console.error(`[HARNESS-ERROR] lodash unavailable (oracle for the DELTA-01 helpers): ${error.message}`);
	process.exit(2);
}

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
	'getNodeParameters', 'deepCopy', 'isExpression', 'ApplicationError', 'NodeOperationError',
	'validateFieldType', 'getValueDescription', 'jsonParse', 'tryToParseNumber', 'tryToParseString',
	'tryToParseAlphanumericString', 'tryToParseBoolean', 'tryToParseDateTime', 'tryToParseTime',
	'tryToParseArray', 'tryToParseObject', 'tryToParseBinary', 'tryToParseUrl', 'tryToParseJwt',
	'tryToParseJsonToFormFields', 'validateFilterParameter', 'FilterError',
	'getNodeParametersIssues', 'getParameterIssues', 'mergeIssues', 'getContext',
	'executeFilter', 'executeFilterCondition', 'arrayContainsValue', 'getNodeWebhookPath',
	'getNodeWebhookUrl', 'cronNodeOptions',
	'extractReferencesInNodeExpressions', 'hasDotNotationBannedChar', 'backslashEscape',
	'dollarEscape', 'applyAccessPatterns', 'OperationalError',
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
	for (const name of EXAMINED_SURFACE.filter((n) => !PORT_ONLY_SURFACE.includes(n))) {
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


/* --- N19: validateFieldType (field-type validation) ---------------------- */
scenario('N19', 'validateFieldType matrix', (api, capture) => {
	const types = [
		'string', 'string-alphanumeric', 'number', 'boolean', 'dateTime', 'time', 'binary',
		'object', 'array', 'options', 'url', 'jwt', 'form-fields', 'not-a-type',
	];
	const values = [
		null, undefined, '', 'text', 'abc123', '123abc', 5, -0.5, '5', '5.5', '0', '1',
		'true', 'FALSE', true, false, [], [1, 'a'], '["a"]', {}, { a: 1 }, '{"a":1}',
		"{'a':1}", '{a:1}', 'not json', '2024-01-02T03:04:05Z', '2024-01-02',
		'Tue, 01 Jan 2019 00:00:00 GMT', '01 Jan 2019 00:00:00 +0000', '2019-01-01 00:00:00',
		'not a date', '12:30', '12:30:45', '1:2', 'https://a.example.com/x', 'a.example.com',
		'ftp://h/p', 'javascript:alert(1)', 'eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig', 'a.b.c',
		{ mimeType: 'text/plain', data: 'x' }, { mimeType: 'text/plain' },
		[{ fieldLabel: 'A', fieldType: 'text' }], 'BADKEY',
	];
	let index = 0;
	for (const type of types) {
		for (const value of values) {
			index++;
			capture(
				`validateFieldType [${index}] ${type}`,
				norm(api.validateFieldType('field', value, type, { dateTimeFactory })),
			);
		}
	}

	const optionCases = [
		[{ strict: true }, 'number', '5'],
		[{ strict: true }, 'boolean', 1],
		[{ strict: true }, 'object', []],
		[{ strict: true }, 'object', () => 1],
		[{ parseStrings: true }, 'string', 42],
		[{ parseStrings: true }, 'string', { a: 1 }],
		[{ valueOptions: [{ value: 'a' }, { value: 'b' }] }, 'options', 'c'],
		[{ valueOptions: [{ value: 'a' }] }, 'options', 'a'],
	];
	optionCases.forEach(([options, type, value], caseIndex) => {
		capture(
			`validateFieldType options [${caseIndex}] ${type}`,
			norm(api.validateFieldType('field', value, type, { ...options, dateTimeFactory })),
		);
	});
});

/* --- N20: type parsers + jsonParse -------------------------------------- */
scenario('N20', 'tryToParse* helpers / getValueDescription / jsonParse', (api, capture) => {
	const parserValues = [
		null, undefined, '', 'text', 'abc123', '123abc', 5, '5', '5.5', '0', '1', 'true', 'FALSE',
		true, false, [], [1, 'a'], '["a"]', "['a','b']", {}, { a: 1 }, '{"a":1}', "{'a':1}",
		'{a:1}', 'not json', new Date(1000), '2024-01-02T03:04:05Z', 'not a date',
		'12:30:45', 'a.example.com', 'a.b.c', { mimeType: 'text/plain', data: 'x' },
	];
	const parsers = [
		'tryToParseNumber', 'tryToParseString', 'tryToParseAlphanumericString', 'tryToParseBoolean',
		'tryToParseTime', 'tryToParseArray', 'tryToParseObject', 'tryToParseBinary',
		'tryToParseUrl', 'tryToParseJwt', 'tryToParseJsonToFormFields',
	];
	for (const name of parsers) {
		parserValues.forEach((value, index) => {
			capture(`${name} [${index}]`, safe(() => norm(api[name](value))));
		});
	}
	parserValues.forEach((value, index) => {
		capture(`getValueDescription [${index}]`, safe(() => api.getValueDescription(value)));
	});

	capture('jsonParse strict object', safe(() => api.jsonParse('{"a":1}')));
	capture('jsonParse strict array', safe(() => api.jsonParse('[1,2]')));
	capture('jsonParse relaxed single quotes', safe(() => api.jsonParse("{'a':'b'}", { acceptJSObject: true })));
	capture('jsonParse relaxed unquoted keys', safe(() => api.jsonParse('{a: 1, b: "x"}', { acceptJSObject: true })));
	capture('jsonParse invalid without options', safe(() => api.jsonParse('{a: 1}')));
	capture('jsonParse invalid with errorMessage', safe(() => api.jsonParse('{a: 1}', { errorMessage: 'bad json' })));
	capture('jsonParse invalid with fallbackValue', safe(() => api.jsonParse('{a: 1}', { fallbackValue: { fallback: true } })));
	capture('jsonParse invalid with fallback thunk', safe(() => api.jsonParse('{a: 1}', { fallbackValue: () => ['f'] })));
});

/* --- N21: filter-parameter validation ----------------------------------- */
scenario('N21', 'validateFilterParameter / FilterError', (api, capture) => {
	const condition = (type, left, right, extra = {}) => ({
		operator: { type, operation: 'equals', ...extra },
		leftValue: left,
		rightValue: right,
	});
	const filterValue = (conditions, options = {}) => ({
		options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2, ...options },
		conditions,
		combinator: 'and',
	});
	const filters = [
		filterValue([condition('string', 'a', 'b')]),
		filterValue([condition('number', 'not a number', 1)]),
		filterValue([condition('number', 'x', 'y')]),
		filterValue([condition('boolean', 'maybe', 'perhaps')]),
		filterValue([condition('number', '', 1)], { version: 3 }),
		filterValue([condition('number', [], 1)], { version: 3 }),
		filterValue([condition('string', 'a', 'b')], { typeValidation: 'loose' }),
		filterValue([condition('any', undefined, undefined)]),
		filterValue([condition('string', '=expr', 'b')]),
		filterValue([condition('dateTime', 'not a date', 'x')]),
		filterValue([], {}),
	];
	filters.forEach((value, index) => {
		capture(
			`validateFilterParameter [${index}]`,
			safe(() => api.validateFilterParameter({ name: 'filters' }, value)),
		);
	});
	capture('FilterError surface', (() => {
		const error = new api.FilterError('broken comparison', 'try something else');
		return { name: error.name, level: error.level, message: error.message, description: error.description };
	})());
});

/* --- N22: parameter issues engine --------------------------------------- */
scenario('N22', 'getNodeParametersIssues / getParameterIssues / mergeIssues / getContext', (api, capture) => {
	const node = (parameters, extra = {}) => ({ name: 'Node', type: 'n8n-nodes-base.test', parameters, ...extra });
	const issues = (properties, parameters, extra) =>
		safe(() => api.getNodeParametersIssues(properties, node(parameters, extra), null));
	const req = (name, displayName, type, extra = {}) => ({ name, displayName, type, required: true, ...extra });

	capture('required string empty', issues([req('a', 'A', 'string')], { a: '' }));
	capture('required string undefined', issues([req('a', 'A', 'string')], {}));
	capture('required string present', issues([req('a', 'A', 'string')], { a: 'x' }));
	capture('required string zero', issues([req('n', 'N', 'string')], { n: 0 }));
	capture('required multiOptions empty', issues([req('m', 'M', 'multiOptions')], { m: [] }));
	capture('required multiOptions filled', issues([req('m', 'M', 'multiOptions')], { m: ['a'] }));
	capture('required multiOptions multipleValues', issues(
		[req('m', 'M', 'string', { typeOptions: { multipleValues: true } })], { m: ['a', ''] }));
	capture('required dateTime empty', issues([req('d', 'D', 'dateTime')], { d: '' }));
	capture('required options empty', issues([req('o', 'O', 'options', { options: [{ name: 'A', value: 'a' }] })], { o: '' }));
	capture('required options invalid', issues([req('o', 'O', 'options', { options: [{ name: 'A', value: 'a' }] })], { o: 'z' }));
	capture('required resourceLocator empty', issues(
		[req('r', 'R', 'resourceLocator')], { r: { __rl: true, value: '', mode: 'list' } }));
	capture('required resourceLocator zero', issues(
		[req('r', 'R', 'resourceLocator')], { r: { __rl: true, value: 0, mode: 'list' } }));
	capture('required workflowSelector empty', issues([req('w', 'W', 'workflowSelector')], { w: { value: '' } }));
	capture('disabled node', issues([req('a', 'A', 'string')], { a: '' }, { disabled: true }));
	capture('pindata node', safe(() => api.getNodeParametersIssues(
		[req('a', 'A', 'string')], node({ a: '' }), null, ['Node'])));
	capture('hidden required', issues(
		[{ ...req('b', 'B', 'string'), displayOptions: { show: { mode: ['b'] } } },
			{ name: 'mode', displayName: 'Mode', type: 'options', default: 'a', options: [{ name: 'A', value: 'a' }] }],
		{ mode: 'a' }));
	capture('resourceLocator regex mismatch', issues(
		[{ name: 'r', displayName: 'R', type: 'resourceLocator', required: true, default: {}, modes: [
			{ name: 'list', type: 'list', validation: [{ type: 'regex', properties: { regex: '^abc$', errorMessage: 'must be abc' } }] }] }],
		{ r: { __rl: true, value: 'zzz', mode: 'list' } }));
	capture('resourceLocator regex match', issues(
		[{ name: 'r', displayName: 'R', type: 'resourceLocator', required: true, default: {}, modes: [
			{ name: 'list', type: 'list', validation: [{ type: 'regex', properties: { regex: '^abc$', errorMessage: 'must be abc' } }] }] }],
		{ r: { __rl: true, value: 'abc', mode: 'list' } }));
	capture('resourceLocator expression value', issues(
		[{ name: 'r', displayName: 'R', type: 'resourceLocator', required: true, default: {}, modes: [
			{ name: 'list', type: 'list', validation: [{ type: 'regex', properties: { regex: '^abc$', errorMessage: 'must be abc' } }] }] }],
		{ r: { __rl: true, value: '={{ $json.id }}', mode: 'list' } }));
	capture('resourceLocator unknown mode', issues(
		[{ name: 'r', displayName: 'R', type: 'resourceLocator', required: true, default: {}, modes: [
			{ name: 'list', type: 'list', validation: [{ type: 'regex', properties: { regex: '^abc$', errorMessage: 'must be abc' } }] }] }],
		{ r: { __rl: true, value: 'zzz', mode: 'nope' } }));
	capture('resourceLocator non-rl value', issues(
		[{ name: 'r', displayName: 'R', type: 'resourceLocator', required: true, default: {} }], { r: 'plain' }));

	const mapperProps = (extra = {}) => ({
		name: 'map', displayName: 'Map', type: 'resourceMapper', default: {}, ...extra,
	});
	capture('resourceMapper autoMapInputData', issues(
		[mapperProps()], { map: { mappingMode: 'autoMapInputData', schema: [{ id: 'a', required: true }], value: null } }));
	capture('resourceMapper required field missing', issues(
		[mapperProps()], { map: { mappingMode: 'defineBelow', schema: [{ id: 'a', displayName: 'A', required: true }], value: null } }));
	capture('resourceMapper required skipped for non-add', issues(
		[mapperProps({ typeOptions: { resourceMapper: { mode: 'update', fieldWords: { singular: 'column' } } } })],
		{ map: { mappingMode: 'defineBelow', schema: [{ id: 'a', displayName: 'A', required: true }], value: null } }));
	capture('resourceMapper required field missing in add mode', issues(
		[mapperProps({ typeOptions: { resourceMapper: { mode: 'add' } } })],
		{ map: { mappingMode: 'defineBelow', schema: [{ id: 'a', displayName: 'A', required: true }], value: null } }));
	capture('resourceMapper required field words', issues(
		[mapperProps({ typeOptions: { resourceMapper: { mode: 'add', fieldWords: { singular: 'column' } } } })],
		{ map: { mappingMode: 'defineBelow', schema: [{ id: 'a', displayName: 'A', required: true }], value: null } }));
	capture('resourceMapper field type error', issues(
		[mapperProps()], { map: { mappingMode: 'defineBelow', schema: [{ id: 'n', displayName: 'N', type: 'number', required: false }], value: { n: 'abc' } } }));
	capture('resourceMapper expression value skips validation', issues(
		[mapperProps()], { map: { mappingMode: 'defineBelow', schema: [{ id: 'n', displayName: 'N', type: 'number' }], value: { n: '={{ 1 }}' } } }));

	capture('filter parameter invalid types (pinned dead-code quirk)', issues(
		[{ name: 'f', displayName: 'F', type: 'filter', required: true, default: {} }],
		{ f: { options: { typeValidation: 'strict', version: 2 }, combinator: 'and', conditions: [
			{ operator: { type: 'number', operation: 'equals' }, leftValue: 'nope', rightValue: 'also nope' }] } }));

	capture('validateType number invalid', issues([{ name: 'n', displayName: 'N', type: 'number', validateType: 'number' }], { n: 'abc' }));
	capture('validateType number valid', issues([{ name: 'n', displayName: 'N', type: 'number', validateType: 'number' }], { n: '5' }));
	capture('validateType expression skips', issues([{ name: 'n', displayName: 'N', type: 'number', validateType: 'number' }], { n: '={{ 1 + 1 }}' }));
	capture('validateType options invalid', issues(
		[{ name: 'o', displayName: 'O', type: 'options', validateType: 'options', options: [{ name: 'A', value: 'a' }] }], { o: 'z' }));
	capture('validateType boolean invalid', issues([{ name: 'b', displayName: 'B', type: 'boolean', validateType: 'boolean' }], { b: 'maybe' }));
	capture('validateType array invalid', issues([{ name: 'a', displayName: 'A', type: 'array', validateType: 'array' }], { a: 'not json' }));
	capture('validateType url invalid', issues([{ name: 'u', displayName: 'U', type: 'string', validateType: 'url' }], { u: 'javascript:alert(1)' }));
	capture('validateType jwt invalid', issues([{ name: 'j', displayName: 'J', type: 'string', validateType: 'jwt' }], { j: 'a.b.c' }));
	capture('validateType time invalid', issues([{ name: 't', displayName: 'T', type: 'string', validateType: 'time' }], { t: '1:2' }));
	capture('validateType dateTime invalid', issues([{ name: 'd', displayName: 'D', type: 'dateTime', validateType: 'dateTime' }], { d: 'not a date' }));
	capture('validateType string-alphanumeric invalid', issues(
		[{ name: 's', displayName: 'S', type: 'string', validateType: 'string-alphanumeric' }], { s: '1abc' }));
	capture('validateType form-fields invalid', issues(
		[{ name: 'ff', displayName: 'FF', type: 'form-fields', validateType: 'form-fields' }], { ff: 'not json' }));

	capture('collection child required', issues(
		[{ name: 'col', displayName: 'Col', type: 'collection', default: {}, options: [req('a', 'A', 'string')] }],
		{ col: { a: '' } }));
	capture('collection child missing entirely', issues(
		[{ name: 'col', displayName: 'Col', type: 'collection', default: {}, options: [req('a', 'A', 'string')] }], {}));
	capture('fixedCollection min fields', issues(
		[{ name: 'fc', displayName: 'FC', type: 'fixedCollection', default: {}, typeOptions: { multipleValues: true, minRequiredFields: 2 }, options: [{ name: 'item', displayName: 'Item', values: [{ name: 'v', displayName: 'V', type: 'string' }] }] }],
		{ fc: { item: [{ v: 'x' }] } }));
	capture('fixedCollection max fields', issues(
		[{ name: 'fc', displayName: 'FC', type: 'fixedCollection', default: {}, typeOptions: { multipleValues: true, maxAllowedFields: 1 }, options: [{ name: 'item', displayName: 'Item', values: [{ name: 'v', displayName: 'V', type: 'string' }] }] }],
		{ fc: { item: [{ v: 'x' }, { v: 'y' }] } }));
	capture('fixedCollection min fields one', issues(
		[{ name: 'fc', displayName: 'FC', type: 'fixedCollection', default: {}, typeOptions: { multipleValues: true, minRequiredFields: 1 }, options: [{ name: 'item', displayName: 'Item', values: [{ name: 'v', displayName: 'V', type: 'string' }] }] }],
		{}));
	capture('fixedCollection multiple values child required', issues(
		[{ name: 'fc', displayName: 'FC', type: 'fixedCollection', default: {}, typeOptions: { multipleValues: true }, options: [{ name: 'item', displayName: 'Item', values: [req('v', 'V', 'string')] }] }],
		{ fc: { item: [{ v: '' }, { v: 'ok' }] } }));
	capture('fixedCollection single value child required', issues(
		[{ name: 'fc', displayName: 'FC', type: 'fixedCollection', default: {}, options: [{ name: 'item', displayName: 'Item', values: [req('v', 'V', 'string')] }] }],
		{ fc: { item: { v: '' } } }));

	capture('mergeIssues merges all supported keys', (() => {
		const destination = { parameters: { a: ['one'] } };
		api.mergeIssues(destination, {
			execution: true, typeUnknown: true,
			parameters: { a: ['two'], b: ['b1'] },
			credentials: { cred: ['c1'] },
			ignoredKey: ['nope'],
		});
		return destination;
	})());
	capture('mergeIssues null source', (() => {
		const destination = { parameters: { a: ['one'] } };
		api.mergeIssues(destination, null);
		return destination;
	})());
	capture('mergeIssues falsey flags ignored', (() => {
		const destination = {};
		api.mergeIssues(destination, { execution: false, typeUnknown: false, parameters: {} });
		return destination;
	})());

	const context = (executionData) => ({ executionData });
	capture('getContext flow', safe(() => api.getContext(context({ contextData: {} }), 'flow')));
	capture('getContext node', safe(() => api.getContext(context({ contextData: {} }), 'node', { name: 'N' })));
	capture('getContext node twice is the same object', safe(() => {
		const run = context({ contextData: {} });
		return api.getContext(run, 'node', { name: 'N' }) === api.getContext(run, 'node', { name: 'N' });
	}));
	capture('getContext node without node', safe(() => api.getContext(context({ contextData: {} }), 'node')));
	capture('getContext unknown type', safe(() => api.getContext(context({ contextData: {} }), 'nope')));
	capture('getContext missing executionData', safe(() => api.getContext({}, 'flow')));
	capture('getParameterIssues direct', safe(() => api.getParameterIssues(
		req('a', 'A', 'string'), {}, '', node({ a: '' }), null)));
});


/* --- N23: filter-parameter execution ------------------------------------- */
scenario('N23', 'executeFilter / executeFilterCondition / arrayContainsValue', (api, capture) => {
	const condition = (type, operation, left, right, extra = {}) => ({
		operator: { type, operation, ...extra },
		leftValue: left,
		rightValue: right,
	});
	const filterValue = (conditions, options = {}, combinator = 'and') => ({
		options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2, ...options },
		conditions,
		combinator,
	});
	const metadata = { index: 0, itemIndex: 0, dateTimeFactory };

	const conditions = [
		['string equals', condition('string', 'equals', 'a', 'a')],
		['string equals miss', condition('string', 'equals', 'a', 'b')],
		['string equals ignoreCase', condition('string', 'equals', 'A', 'a')],
		['string notEquals', condition('string', 'notEquals', 'a', 'b')],
		['string contains', condition('string', 'contains', 'hello world', 'world')],
		['string notContains', condition('string', 'notContains', 'hello', 'zz')],
		['string startsWith', condition('string', 'startsWith', 'hello', 'he')],
		['string notStartsWith', condition('string', 'notStartsWith', 'hello', 'xx')],
		['string endsWith', condition('string', 'endsWith', 'hello', 'lo')],
		['string empty', condition('string', 'empty', '', 'x')],
		['string notEmpty', condition('string', 'notEmpty', 'x', '')],
		['string regex literal', condition('string', 'regex', 'abc123', '/^abc\\d+$/')],
		['string regex plain', condition('string', 'regex', 'abc123', 'abc')],
		['string notRegex', condition('string', 'notRegex', 'abc', '/[0-9]+/')],
		['string regex flags', condition('string', 'regex', 'ABC', '/abc/i')],
		['number equals', condition('number', 'equals', 5, 5)],
		['number gt', condition('number', 'gt', 5, 3)],
		['number lte', condition('number', 'lte', 3, 3)],
		['number empty', condition('number', 'empty', null, 1)],
		['number unknown op (falls through)', condition('number', 'weird', 5, 3)],
		['boolean true', condition('boolean', 'true', true, '')],
		['boolean false', condition('boolean', 'false', false, '')],
		['boolean equals', condition('boolean', 'equals', true, true)],
		['array contains', condition('array', 'contains', ['a', 'B'], 'b')],
		['array contains miss', condition('array', 'contains', ['a'], 'z')],
		['array contains ignoreCase', condition('array', 'contains', ['A'], 'a')],
		['array lengthEquals', condition('array', 'lengthEquals', [1, 2], 2)],
		['array lengthGt', condition('array', 'lengthGt', [1, 2], 3)],
		['array empty', condition('array', 'empty', [], 1)],
		['array notEmpty', condition('array', 'notEmpty', [1], 1)],
		['object empty', condition('object', 'empty', {}, '')],
		['object notEmpty', condition('object', 'notEmpty', { a: 1 }, '')],
		['exists', condition('string', 'exists', 'x', '')],
		['exists null', condition('string', 'exists', null, '')],
		['notExists', condition('string', 'notExists', undefined, '')],
		['exists on array', condition('array', 'exists', [1], '')],
		['unknown type', condition('nope', 'equals', 1, 1)],
		['unknown operation', condition('string', 'nope', 'a', 'a')],
		['dateTime after', condition('dateTime', 'after', '2024-01-02T00:00:00Z', '2024-01-01T00:00:00Z')],
		['dateTime before', condition('dateTime', 'before', '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z')],
		['dateTime equals', condition('dateTime', 'equals', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')],
		['dateTime notEquals', condition('dateTime', 'notEquals', '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z')],
		['dateTime afterOrEquals', condition('dateTime', 'afterOrEquals', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')],
		['dateTime empty', condition('dateTime', 'empty', null, '2024-01-01T00:00:00Z')],
		['dateTime missing side', condition('dateTime', 'after', '2024-01-01T00:00:00Z', null)],
		['dateTime invalid', condition('dateTime', 'after', 'not a date', '2024-01-01T00:00:00Z')],
		['type error both sides', condition('number', 'equals', 'nope', 'also nope')],
		['type error strict', condition('number', 'equals', 'nope', 1)],
		['unresolved expression left', condition('number', 'equals', '={{ $json.n }}', 1)],
	];
	conditions.forEach(([label, value], index) => {
		capture(`condition [${index}] ${label}`, safe(() => api.executeFilterCondition(value, { caseSensitive: true, typeValidation: 'loose', version: 2 }, metadata)));
		capture(`condition ignoreCase [${index}] ${label}`, safe(() => api.executeFilterCondition(value, { caseSensitive: false, typeValidation: 'loose', version: 2 }, metadata)));
		capture(`condition strict [${index}] ${label}`, safe(() => api.executeFilterCondition(value, { caseSensitive: true, typeValidation: 'strict', version: 2 }, metadata)));
	});

	const filters = [
		filterValue([condition('number', 'equals', 1, 1), condition('number', 'equals', 2, 3)]),
		{ ...filterValue([condition('number', 'equals', 1, 1), condition('number', 'equals', 2, 3)]), combinator: 'or' },
		{ ...filterValue([]), combinator: 'or' },
		filterValue([]),
		{ ...filterValue([condition('number', 'equals', 1, 1)]), combinator: 'xor' },
		filterValue([condition('string', 'equals', 'a', 'a')], { caseSensitive: false }),
		filterValue([condition('dateTime', 'after', '2024-01-02T00:00:00Z', '2024-01-01T00:00:00Z')]),
		filterValue([condition('number', 'equals', 'nope', 'also nope')], { typeValidation: 'strict' }),
	];
	filters.forEach((value, index) => {
		capture(`executeFilter [${index}]`, safe(() => api.executeFilter(value, { itemIndex: 0 })));
	});

	const arrays = [
		[['a', 'b'], 'a', false],
		[['a', 'b'], 'c', false],
		[['A'], 'a', true],
		[['A'], 'a', false],
		[[1, 2], 1, true],
		[[1, 2], '1', false],
		[[], 'a', true],
		[['a'], 1, true],
	];
	arrays.forEach(([array, value, ignoreCase], index) => {
		capture(`arrayContainsValue [${index}]`, api.arrayContainsValue(array, value, ignoreCase));
	});
});

/* --- N24: webhook paths + cronNodeOptions -------------------------------- */
scenario('N24', 'getNodeWebhookPath / getNodeWebhookUrl / cronNodeOptions', (api, capture) => {
	const node = (extra = {}) => ({ name: 'My Node', type: 'n8n-nodes-base.webhook', parameters: {}, ...extra });
	const cases = [
		['wf', node(), 'hook', undefined, undefined],
		['wf', node(), 'hook', undefined, true],
		['wf', node(), 'hook', false, false],
		['wf', node(), '', undefined, undefined],
		['wf', node({ webhookId: 'abc' }), 'hook', undefined, undefined],
		['wf', node({ webhookId: 'abc' }), 'hook', true, undefined],
		['wf', node({ webhookId: 'abc' }), '', true, undefined],
		['wf', node({ webhookId: 'abc' }), 'hook', true, true],
		['', node(), 'hook', undefined, undefined],
	];
	cases.forEach(([workflowId, n, path, isFullPath, restartWebhook], index) => {
		capture(`getNodeWebhookPath [${index}]`, api.getNodeWebhookPath(workflowId, n, path, isFullPath, restartWebhook));
	});

	const urlCases = [
		['https://base', 'wf', node(), 'hook', undefined],
		['https://base', 'wf', node({ webhookId: 'abc' }), ':id', undefined],
		['https://base', 'wf', node({ webhookId: 'abc' }), 'x/:id', undefined],
		['https://base', 'wf', node({ webhookId: 'abc' }), ':id', true],
		['https://base', 'wf', node(), '/hook', undefined],
		['https://base', 'wf', node({ webhookId: 'abc' }), 'hook', true],
		['https://base', 'wf', node({ name: 'Ünïcode Node' }), 'hook', undefined],
	];
	urlCases.forEach(([baseUrl, workflowId, n, path, isFullPath], index) => {
		capture(`getNodeWebhookUrl [${index}]`, api.getNodeWebhookUrl(baseUrl, workflowId, n, path, isFullPath));
	});

	capture('cronNodeOptions structure', api.cronNodeOptions);
	capture('cronNodeOptions mode values', api.cronNodeOptions[0].values[0].options.map((option) => option.value));
});


/* --- N25: node-reference parser + lodash helpers + OperationalError ------- */
scenario('N25', 'extractReferencesInNodeExpressions / access patterns / lodash helpers', (api, capture) => {
	const node = (name, expressions, extra = {}) => ({
		name,
		type: 'n8n-nodes-base.set',
		parameters: Object.fromEntries(expressions.map((expression, i) => [`p${i}`, `={{ ${expression} }}`])),
		...extra,
	});
	// The three lodash helpers are port-only: on the REF side fall back to lodash itself, so the
	// comparison *is* port-vs-lodash.
	const portClone = (value) => (typeof api.cloneDeep === 'function' ? api.cloneDeep(value) : lodash.cloneDeep(value));
	const portMapValues = (object, iteratee) =>
		typeof api.mapValues === 'function' ? api.mapValues(object, iteratee) : lodash.mapValues(object, iteratee);
	const portEscapeRegExp = (value) =>
		typeof api.escapeRegExp === 'function' ? api.escapeRegExp(value) : lodash.escapeRegExp(value);

	const run = (nodes, nodeNames, startNodeName, graphInputNodeNames) =>
		safe(() => {
			const result = api.extractReferencesInNodeExpressions(
				nodes,
				nodeNames,
				startNodeName,
				graphInputNodeNames,
			);
			return { nodes: result.nodes, variables: [...result.variables.entries()] };
		});

	capture('oracle: extract used expressions', run(
		[node('B', ['$("A").item.json.myField']), node('C', ['$("A").first().json.myField.anotherField'])],
		['A', 'B', 'C'], 'Start'));
	capture('oracle: metadata functions', run(
		[node('B', ['$("A").isExecuted ? 1 : 2']), node('C', ['someFunction($("D").params["resource"])'])],
		['A', 'B', 'C', 'D'], 'Start'));
	capture('oracle: standalone node reference', run([node('B', ['$("D")'])], ['B', 'D'], 'Start', ['B']));
	capture('oracle: reference to non-existent node', run([node('B', ['$("E").item.json.x'])], ['B'], 'Start', ['B']));
	capture('oracle: invalid node reference', run([node('B', ['$("A").item.json["x"]'])], ['A', 'B'], 'Start', ['B']));
	capture('oracle: new fields on the node', run([node('B', ['$("A").item.json.foo.bar()'])], ['A', 'B'], 'Start', ['B']));
	capture('oracle: $json only for graph inputs', run(
		[node('B', ['$json.a.b']), node('C', ['$json.c.d'])], ['A', 'B', 'C'], 'Start', ['B']));
	capture('oracle: complex $json case for first node', run(
		[{ ...node('B', []), parameters: { p0: '={{ $json.a.b?.[0].c }}' } }], ['A', 'B'], 'Start', ['B']));
	capture('oracle: different accessor patterns', run(
		[node('B', [`$node['A'].json.x`, `$node.A.json.y`, '$items("A", 0)[0].json.z'])],
		['A', 'B'], 'Start'));
	capture('oracle: simple name clashes', run(
		[node('B', ['$("A").item.json.myField']), node('C', ['$("D").item.json.myField']), node('E', ['$("F").item.json.myField'])],
		['A', 'B', 'C', 'D', 'E', 'F'], 'Start'));
	capture('oracle: complex name clashes', run(
		[
			node('F', ['$("A").item.json.myField']),
			node('B', ['$("A").item.json.Node_Name_With_Gap_myField']),
			node('C', ['$("D").item.json.Node_Name_With_Gap_myField']),
			node('E', ['$("Node_Name_With_Gap").item.json.myField']),
		],
		['A', 'B', 'C', 'D', 'E', 'F', 'Node_Name_With_Gap'], 'Start'));
	capture('oracle: code node', run(
		[{
			parameters: { jsCode: "for (const item of $input.all()) {\n  item.json.myNewField = $('DebugHelper').first().json.uid;\n}\n\nreturn $input.all();" },
			type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 0],
			id: 'c9de02d0-982a-4f8c-9af7-93f63795aa9b', name: 'Code',
		}],
		['DebugHelper', 'Code'], 'Start'));
	capture('oracle: assignments format of Set node', run(
		[{
			parameters: {
				assignments: {
					assignments: [
						{ id: 'cf8bd6cb-f28a-4a73-b141-02e5c22cfe74', name: 'ghApiBaseUrl', value: '={{ $("A").item.json.x.y.z }}', type: 'string' },
					],
				},
				options: {},
			},
			type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [80, 80],
			id: '6e2fd284-2aba-4dee-8921-18be9a291484', name: 'Params',
		}],
		['A', 'Params'], 'Start'));
	capture('oracle: unexpected code after the data accessor', run(
		[node('A', ['$("B").all()[0].json.first_node_variable'])], ['A', 'B'], 'Start'));
	capture('oracle: carry over unrelated properties', run(
		[{ parameters: { a: 3, b: { c: 4, d: true }, d: 'hello', e: "={{ $('goodbye').item.json.f }}" }, name: 'A' }],
		['A', 'goodbye'], 'Start'));
	capture('oracle: splitOut constant fields', run(
		[{ parameters: { fieldToSplitOut: 'foo,bar' }, type: 'n8n-nodes-base.splitOut', typeVersion: 1, position: [200, 200], id: 'splitOutNodeId', name: 'A' }],
		['A', 'B'], 'Start', ['A']));
	capture('splitOut expression throws', run(
		[{ parameters: { fieldToSplitOut: '={{ $json.a }}' }, type: 'n8n-nodes-base.splitOut', name: 'A' }],
		['A', 'B'], 'Start', ['A']));
	capture('oracle: multiple expressions, different nodes', run(
		[node('B', ['$("A").item.json.x + $("C").item.json.y'])], ['A', 'B', 'C'], 'Start'));
	capture('oracle: first/last/all/items together', run(
		[node('B', ['$("A").first().json.a + $("A").last().json.b + $("A").all()[0].json.c + $("A").items(0).json.d'])],
		['A', 'B'], 'Start'));
	capture('oracle: itemMatching examples', run(
		[node('B', ['$("A").itemMatching(20).json.x', '$("A").itemMatching(2).json.y'])], ['A', 'B'], 'Start'));
	capture('oracle: complex itemMatching untouched', run(
		[node('B', ['$("A").itemMatching($("C").item.json.idx).json.x'])], ['A', 'B', 'C'], 'Start'));
	capture('oracle: spaces and special characters in node names', run(
		[node('B', ['$("Node Name!").item.json.x'])], ['Node Name!', 'B'], 'Start'));
	capture('oracle: custom start node name', run(
		[node('B', ['$("A").item.json.x'])], ['A', 'B'], 'CustomStart'));
	capture('throws: start name clash', run([node('Start', ['$("A").item.json.x'])], ['A', 'Start'], 'Start'));
	capture('throws: subgraph name not in nodeNames', run([node('Z', ['$("A").item.json.x'])], ['A'], 'Start'));
	capture('empty subgraph', run([], ['A'], 'Start'));
	capture('expression not starting with = is untouched', run(
		[{ name: 'A', type: 't', parameters: { p0: 'plain string $("B").item.json.x' } }], ['A', 'B'], 'Start'));

	// helpers
	['abc', 'a b', '1abc', 'Né', 'Node.Name', 'Node-Name', '', 'a_b$1'].forEach((name, index) => {
		capture(`hasDotNotationBannedChar [${index}]`, api.hasDotNotationBannedChar(name));
	});
	['a.b*c', 'plain', '[x]', '$name', 'a|b', ''].forEach((name, index) => {
		capture(`backslashEscape [${index}]`, api.backslashEscape(name));
		capture(`dollarEscape [${index}]`, api.dollarEscape(name));
		// oracle is lodash itself (the reference imports `lodash/escapeRegExp`)
		capture(`escapeRegExp [${index}]`, portEscapeRegExp(name));
	});
	[
		['$node["oldName"].data', 'oldName', 'newName'],
		['$node.oldName.data', 'oldName', 'new.Name'],
		['$node.oldName.data', 'oldName', 'New Name'],
		['$node.oldName.method()', 'oldName', 'New Name'],
		['$node["someOtherName"].data', 'oldName', 'newName'],
		['$node["oldName"].data + $node["oldName"].info', 'oldName', 'newName'],
		['$items("oldName", 0)', 'oldName', 'newName'],
		["$items('oldName', 0)", 'oldName', 'newName'],
		["$('oldName')", 'oldName', 'newName'],
		['$("oldName")', 'oldName', 'newName'],
		['noMatchHere', 'oldName', 'newName'],
		['$node.old$Name.data', 'old$Name', 'new$Name'],
		// $-sequences in the new name must survive replace()'s substitution syntax
		['$("oldName")', 'oldName', 'new$1Name'],
		['$node["oldName"].data', 'oldName', 'a$&b'],
		['$items("oldName", 0)', 'oldName', 'x$`y'],
		['$node.oldName.data', 'oldName', "$'tail"],
	].forEach(([expression, previousName, newName], index) => {
		capture(`applyAccessPatterns [${index}]`, api.applyAccessPatterns(expression, previousName, newName));
	});

	// lodash subset + OperationalError surface
	// port-only helpers — oracle is lodash, not the n8n-workflow build
	// every capture below is total (no throwing getters) so a broken clone reports a DIVERGE.
	// A Date-prototype object without the internal [[DateValue]] slot passes `instanceof Date`
	// but throws on every Date method, so the probes use slot-safe accessors + try/catch.
	const slotTime = (value) => { try { return Date.prototype.getTime.call(value); } catch { return null; } };
	const describeDate = (value) => ({
		isDate: value instanceof Date,
		time: slotTime(value),
		tag: Object.prototype.toString.call(value),
	});
	capture('cloneDeep keeps Date', (() => {
		const source = { d: new Date(1000) };
		const port = portClone(source);
		const oracle = lodash.cloneDeep(source);
		return {
			port: describeDate(port.d),
			matchesLodash: slotTime(port.d) === oracle.d.getTime(),
		};
	})());
	capture('cloneDeep keeps RegExp', (() => {
		const copy = portClone({ r: /ab/gi });
		const value = copy.r;
		return {
			source: value instanceof RegExp ? value.source : null,
			flags: value instanceof RegExp ? value.flags : null,
			isRegExp: value instanceof RegExp,
		};
	})());
	capture('cloneDeep keeps Map/Set', (() => {
		const copy = portClone({ m: new Map([['k', 1]]), s: new Set([1, 2]) });
		return {
			mapSize: copy.m instanceof Map ? copy.m.size : null,
			setSize: copy.s instanceof Set ? copy.s.size : null,
			isMap: copy.m instanceof Map,
			isSet: copy.s instanceof Set,
		};
	})());
	capture('cloneDeep cycle', (() => { const source = { a: 1 }; source.self = source; const copy = portClone(source); return { a: copy.a, selfIsCopy: copy.self === copy }; })());
	capture('cloneDeep prototype', Object.getPrototypeOf(portClone({ a: 1 })) === Object.prototype);
	capture('mapValues', {
		port: portMapValues({ a: 1, b: 2 }, (value) => value * 2),
		lodash: lodash.mapValues({ a: 1, b: 2 }, (value) => value * 2),
	});
	capture('mapValues keys order preserved', Object.keys(portMapValues({ z: 1, a: 2 }, (value) => value)));
	capture('cloneDeep vs lodash on a mixed structure', (() => {
		const source = {
			date: new Date(12345), regex: /ab/gi, map: new Map([['k', { n: 1 }]]), set: new Set([1, { x: 2 }]),
			array: [1, { y: 2 }], nested: { z: { w: 3 } }, text: 'text',
		};
		source.self = source;
		const canonical = (value) => ({
			date: slotTime(value.date) ?? `<no Date slot: ${Object.prototype.toString.call(value.date)}>`,
			regex: value.regex instanceof RegExp ? `${value.regex.source}/${value.regex.flags}` : '<not a RegExp>',
			mapSize: value.map instanceof Map ? value.map.size : null,
			mapValue: value.map instanceof Map ? value.map.get('k').n : null,
			setSize: value.set instanceof Set ? value.set.size : null,
			array: value.array, nested: value.nested, text: value.text,
			selfIsSelf: value.self === value,
		});
		return { port: canonical(portClone(source)), lodash: canonical(lodash.cloneDeep(source)) };
	})());
	capture('OperationalError surface', (() => {
		const error = new api.OperationalError('boom', { extra: { k: 1 } });
		return { name: error.name, level: error.level, message: error.message, extra: error.extra, tags: error.tags };
	})());
	capture('OperationalError level override', new api.OperationalError('x', { level: 'info' }).level);
	capture('extractReferences throws OperationalError class', (() => {
		try {
			api.extractReferencesInNodeExpressions([node('Start', [])], ['Start'], 'Start');
			return 'no throw';
		} catch (error) {
			return { name: error.name, level: error.level, ctor: error.constructor.name };
		}
	})());
});

/* --- report -------------------------------------------------------------- */
// values are allowed too (e.g. `cronNodeOptions`) — only presence matters here
const missing = [...EXAMINED_SURFACE, ...PORT_ONLY_SURFACE].filter((name) => !(name in port));
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
