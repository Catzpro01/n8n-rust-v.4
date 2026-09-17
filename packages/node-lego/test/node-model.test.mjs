/**
 * Node LEGO conformance suite.
 *
 * Every case is ported from a reference oracle or pins a line-anchored reference
 * behaviour; the oracle test file is named per test group in README §Surface.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ApplicationError,
	FilterError,
	defaultDateTimeFactory,
	getContext,
	getNodeParametersIssues,
	getParameterIssues,
	getValueDescription,
	jsonParse,
	mergeIssues,
	tryToParseArray,
	tryToParseBoolean,
	tryToParseJwt,
	tryToParseNumber,
	tryToParseObject,
	tryToParseUrl,
	validateFieldType,
	validateFilterParameter,
	NodeConnectionTypes,
	NodeOperationError,
	assertIsValidNodeParameterValueType,
	assertParamIsArray,
	assertParamIsBoolean,
	assertParamIsNumber,
	assertParamIsOfAnyTypes,
	assertParamIsString,
	checkConditions,
	deepCopy,
	displayParameter,
	displayParameterPath,
	get,
	getConnectionTypes,
	getNodeFeatures,
	getNodeInputs,
	getNodeOutputs,
	getNodeParameters,
	getParameterValueByPath,
	getPropertyValues,
	getSubworkflowId,
	getToolDescriptionForNode,
	getUpdatedToolDescription,
	getVersionedNodeType,
	isAssignmentCollectionValue,
	isDefaultNodeName,
	isExecutable,
	isFilterValue,
	isHitlToolType,
	isNodeConnected,
	isNodeParameters,
	isNodeWithWorkflowSelector,
	isResourceLocatorValue,
	isResourceMapperValue,
	isSubNodeType,
	isTool,
	isToolType,
	isEqual,
	isExpression,
	isTriggerLikeNode,
	isTriggerNode,
	makeDescription,
	makeNodeName,
	mergeNodeProperties,
	nodeAcceptsInputType,
	nodeHasOutputType,
	renameFormFields,
	resolveRelativePath,
	toPath,
	validateNodeCredentials,
	validateNodeParameters,
	isValidNodeParameterValueType,
} from '../src/index.mjs';

/* --- node-validation.test.ts (18 reference cases) -------------------------- */

const nodeWithCredentials = (credentials, extra = {}) => ({
	id: '1',
	name: 'Node',
	type: 'n8n-nodes-base.test',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
	credentials,
	...extra,
});

const credentialType = (overrides = {}) => ({
	name: 'testApi',
	required: true,
	displayName: 'Test API',
	...overrides,
});

test('validateNodeCredentials: no issues when required credentials are set (node-validation.test.ts L39)', () => {
	const node = nodeWithCredentials({ testApi: { id: 'cred-1', name: 'My Cred' } });
	const issues = validateNodeCredentials(node, { description: { credentials: [credentialType()] } });
	assert.deepEqual(issues, []);
});

test('validateNodeCredentials: missing / not-configured / optional / hidden (L54-L158)', () => {
	// missing
	assert.deepEqual(validateNodeCredentials(nodeWithCredentials({}), { description: { credentials: [credentialType()] } }), [
		{ type: 'missing', displayName: 'Test API', credentialName: 'testApi' },
	]);
	// not-configured (no id)
	assert.deepEqual(
		validateNodeCredentials(nodeWithCredentials({ testApi: { name: 'My Cred' } }), {
			description: { credentials: [credentialType()] },
		}),
		[{ type: 'not-configured', displayName: 'Test API', credentialName: 'testApi' }],
	);
	// optional credential skipped
	assert.deepEqual(
		validateNodeCredentials(nodeWithCredentials({}), { description: { credentials: [credentialType({ required: false })] } }),
		[],
	);
	// hidden by displayOptions
	const hidden = credentialType({ displayOptions: { show: { mode: ['advanced'] } } });
	assert.deepEqual(validateNodeCredentials(nodeWithCredentials({}, { parameters: { mode: 'simple' } }), {
		description: { credentials: [hidden] },
	}), []);
	// shown by displayOptions
	assert.deepEqual(validateNodeCredentials(nodeWithCredentials({}, { parameters: { mode: 'advanced' } }), {
		description: { credentials: [hidden] },
	}), [{ type: 'missing', displayName: 'Test API', credentialName: 'testApi' }]);
});

test('validateNodeCredentials: displayName falls back to the credential name (L185)', () => {
	const issues = validateNodeCredentials(nodeWithCredentials({}), {
		description: { credentials: [{ name: 'testApi', required: true }] },
	});
	assert.equal(issues[0].displayName, 'testApi');
});

test('validateNodeCredentials: multiple missing credentials are all reported, in order (L159)', () => {
	const issues = validateNodeCredentials(nodeWithCredentials({}), {
		description: { credentials: [credentialType(), credentialType({ name: 'otherApi', displayName: 'Other' })] },
	});
	assert.deepEqual(
		issues.map((issue) => issue.credentialName),
		['testApi', 'otherApi'],
	);
});

test('isNodeConnected: outgoing first, then incoming, false for empty maps (L201-L271)', () => {
	const outgoing = { Node: { main: [[{ node: 'Next', type: 'main', index: 0 }]] } };
	const incoming = { Node: { main: [[{ node: 'Prev', type: 'main', index: 0 }]] } };
	assert.equal(isNodeConnected('Node', outgoing, {}), true);
	assert.equal(isNodeConnected('Node', {}, incoming), true);
	assert.equal(isNodeConnected('Node', outgoing, incoming), true);
	assert.equal(isNodeConnected('Node', {}, {}), false);
	assert.equal(isNodeConnected('Node', { Node: {} }, { Node: {} }), false);
});

test('isTriggerLikeNode: trigger / webhook / poll are entry points (L272-L371)', () => {
	assert.equal(isTriggerLikeNode({ trigger: async () => {} }), true);
	assert.equal(isTriggerLikeNode({ webhook: async () => {} }), true);
	assert.equal(isTriggerLikeNode({ poll: async () => {} }), true);
	assert.equal(isTriggerLikeNode({}), false);
	assert.equal(isTriggerLikeNode({ execute: async () => {} }), false);
});

/* --- node-helpers.conditions.test.ts (through checkConditions/display) ----- */

test('checkConditions: literal conditions use Array.includes (node-helpers.ts L330)', () => {
	assert.equal(checkConditions(['a', 'b'], ['b']), true);
	assert.equal(checkConditions(['a', 'b'], ['c']), false);
	assert.equal(checkConditions([{ _cnd: { eq: 'x' } }], ['x']), true);
});

test('checkConditions: every operator of a single-key _cnd object (L336-L400)', () => {
	const cases = [
		['eq', 5, 5, true],
		['eq', 5, 6, false],
		['not', 5, 6, true],
		['gte', 5, 5, true],
		['lte', 5, 5, true],
		['gt', 6, 5, true],
		['lt', 4, 5, true],
		['between', 5, { from: 4, to: 6 }, true],
		['between', 7, { from: 4, to: 6 }, false],
		['includes', 'hello world', 'world', true],
		['startsWith', 'hello', 'he', true],
		['endsWith', 'hello', 'lo', true],
		['regex', 'abc123', '^abc\\d+$', true],
		['exists', 'x', null, true],
	];
	for (const [key, value, target, expected] of cases) {
		assert.equal(checkConditions([{ _cnd: { [key]: target } }], [value]), expected, `${key}(${value})`);
	}
	assert.equal(checkConditions([{ _cnd: { unknownOp: 1 } }], [1]), false);
});

test('checkConditions: the empty-actual-values rule (L345-L350)', () => {
	assert.equal(checkConditions([{ _cnd: { not: 'x' } }], []), true);
	assert.equal(checkConditions([{ _cnd: { eq: 'x' } }], []), false);
});

test('checkConditions: nested objects compare by value, not identity (L358 isEqual)', () => {
	assert.equal(checkConditions([{ _cnd: { eq: { a: 1 } } }], [{ a: 1 }]), true);
	assert.equal(checkConditions([{ _cnd: { eq: { a: 1 } } }], [{ a: 2 }]), false);
});

test('getNodeFeatures: "@version" conditions per feature (node-helpers.ts L275)', () => {
	assert.deepEqual(getNodeFeatures(undefined, 1), {});
	assert.deepEqual(
		getNodeFeatures({ alpha: { '@version': [{ _cnd: { gte: 2 } }] }, beta: { '@version': [{ _cnd: { lt: 2 } }] } }, 2),
		{ alpha: true, beta: false },
	);
});

test('getPropertyValues: /root, @version, @tool, @feature, __rl and array handling (L290-L328)', () => {
	assert.deepEqual(getPropertyValues({ a: 1 }, 'a', null, null, { a: 1 }), [1]);
	assert.deepEqual(getPropertyValues({ a: 1 }, '/b', null, null, { b: [1, 2] }), [1, 2]);
	assert.deepEqual(getPropertyValues({}, '@version', { typeVersion: 3 }, null, {}), [3]);
	assert.deepEqual(getPropertyValues({}, '@version', null, null, {}), [0]);
	assert.deepEqual(getPropertyValues({}, '@tool', { typeVersion: 1 }, { name: 'n8n-nodes-base.codeTool' }, {}), [true]);
	assert.deepEqual(
		getPropertyValues({}, '@feature', { typeVersion: 2 }, { name: 'x', features: { f: { '@version': [{ _cnd: { gte: 1 } }] } } }, {}),
		['f'],
	);
	assert.deepEqual(getPropertyValues({}, '@feature', null, null, {}), []);
	assert.deepEqual(getPropertyValues({ rl: { __rl: true, mode: 'list', value: 'v1' } }, 'rl', null, null, {}), ['v1']);
	assert.deepEqual(getPropertyValues({ list: [1, 2, 3] }, 'list', null, null, {}), [1, 2, 3]);
});

test('displayParameter: show = all rules match, hide = any rule matches (L403-L467)', () => {
	const parameter = { displayOptions: { show: { resource: ['user'] }, hide: { operation: ['remove'] } } };
	assert.equal(displayParameter({ resource: 'user' }, parameter, null, null), true);
	assert.equal(displayParameter({ resource: 'user', operation: 'remove' }, parameter, null, null), false);
	assert.equal(displayParameter({ resource: 'other' }, parameter, null, null), false);
	assert.equal(displayParameter({}, { name: 'plain' }, null, null), true);
});

test('displayParameter: expression-looking values short-circuit show to true (L432-L435)', () => {
	const parameter = { displayOptions: { show: { resource: ['user'] } } };
	assert.equal(displayParameter({ resource: '={{ $json.x }}' }, parameter, null, null), true);
});

test('displayParameter: hide ignores empty value lists (L451-L460)', () => {
	const parameter = { displayOptions: { hide: { resource: ['user'] } } };
	assert.equal(displayParameter({}, parameter, null, null), true);
	assert.equal(displayParameter({ resource: 'user' }, parameter, null, null), false);
});

test('displayParameterPath: path resolution and the parameters-root rule (L469-L503)', () => {
	const rootRule = { displayOptions: { show: { '/parent': ['x'] } } };
	const directRule = { displayOptions: { show: { child: ['x'] } } };
	const values = { parameters: { parent: 'x', child: 'x' }, sub: { child: 'x' } };

	// values are read from `path`
	assert.equal(displayParameterPath(values, directRule, 'parameters', null, null), true);
	assert.equal(displayParameterPath(values, directRule, 'sub', null, null), true);
	// '/' targets resolve against `parameters` only when the path starts there
	assert.equal(displayParameterPath(values, rootRule, 'parameters', null, null), true);
	assert.equal(displayParameterPath(values, rootRule, 'sub', null, null), false);
	// without the path, the root is the given values object itself
	assert.equal(displayParameter({ sub: values.sub }, rootRule, null, null), false);
});

test('displayParameter: disabledOptions uses the same rules with its own key (L409)', () => {
	const parameter = { disabledOptions: { show: { resource: ['user'] } } };
	assert.equal(displayParameter({ resource: 'user' }, parameter, null, null, undefined, 'disabledOptions'), true);
	assert.equal(displayParameter({ resource: 'other' }, parameter, null, null, undefined, 'disabledOptions'), false);
});

/* --- connection IO (node-helpers.test.ts + workflow-execute.ts L909-920) --- */

test('getConnectionTypes: strings pass, objects contribute type, typeless entries drop (L1104)', () => {
	assert.deepEqual(getConnectionTypes(['main', { type: 'ai_tool' }, {}]), ['main', 'ai_tool']);
	assert.deepEqual(getConnectionTypes([]), []);
	// pinned quirk: the filter runs after the map, so a literal `undefined` entry throws
	assert.throws(() => getConnectionTypes(['main', undefined]), { name: 'TypeError' });
});

test('isSubNodeType: any non-main output marks a sub-node (L247)', () => {
	assert.equal(isSubNodeType({ outputs: ['main', 'ai_tool'] }), true);
	assert.equal(isSubNodeType({ outputs: ['main'] }), false);
	assert.equal(isSubNodeType({ outputs: '={{ $json.x }}' }), false);
	assert.equal(isSubNodeType(null), false);
});

test('getNodeInputs: static array wins, expression is evaluated, throw yields [] (L1117)', () => {
	assert.deepEqual(getNodeInputs({}, {}, { inputs: ['main'] }), ['main']);
	const workflow = { expression: { getSimpleParameterValue: () => ['main', 'ai_tool'] } };
	assert.deepEqual(getNodeInputs(workflow, {}, { inputs: '={{ ["main"] }}' }), ['main', 'ai_tool']);
	const throwing = { expression: { getSimpleParameterValue: () => { throw new Error('boom'); } } };
	assert.deepEqual(getNodeInputs(throwing, { name: 'N' }, { inputs: '={{ }}' }), []);
});

test('getNodeOutputs: continueErrorOutput appends the error output and labels single outputs "Success" (L1140)', () => {
	const single = getNodeOutputs({}, { onError: 'continueErrorOutput' }, { outputs: ['main'] });
	assert.deepEqual(single, [
		{ type: 'main', displayName: 'Success' },
		{ category: 'error', type: 'main', displayName: 'Error' },
	]);
	// the node type data must not be mutated
	const nodeType = { outputs: ['main'] };
	getNodeOutputs({}, { onError: 'continueErrorOutput' }, nodeType);
	assert.deepEqual(nodeType.outputs, ['main']);
	const multi = getNodeOutputs({}, { onError: 'continueErrorOutput' }, { outputs: ['main', 'ai_tool'] });
	assert.equal(multi.length, 3);
	assert.equal(multi[2].displayName, 'Error');
	assert.deepEqual(getNodeOutputs({}, {}, null), []);
});

test('getNodeOutputs: expression output that is not an array yields [] (L1170)', () => {
	const workflow = { expression: { getSimpleParameterValue: () => 'main' } };
	assert.deepEqual(getNodeOutputs(workflow, {}, { outputs: '={{ }}' }), []);
});

test('isExecutable / isTriggerNode: main or ai_tool output, or trigger group (L1671-L1686)', () => {
	assert.equal(isExecutable({}, {}, { outputs: ['main'], group: ['transform'] }), true);
	assert.equal(isExecutable({}, {}, { outputs: ['ai_tool'], group: ['transform'] }), true);
	assert.equal(isExecutable({}, {}, { outputs: [], group: ['transform'] }), false);
	assert.equal(isExecutable({}, {}, { outputs: [], group: ['trigger'] }), true);
	assert.equal(isExecutable({}, {}, null), false);
	assert.equal(isTriggerNode({ group: ['trigger', 'input'] }), true);
	assert.equal(isTriggerNode({ group: ['transform'] }), false);
});

test('nodeAcceptsInputType / nodeHasOutputType: strings use includes, objects compare type (L1921-L1966)', () => {
	assert.equal(nodeAcceptsInputType({ inputs: 'main' }, 'main'), true);
	assert.equal(nodeAcceptsInputType({ inputs: 'ai_tool' }, 'tool'), true);
	assert.equal(nodeAcceptsInputType({ inputs: ['main', { type: 'ai_tool' }] }, 'ai_tool'), true);
	assert.equal(nodeAcceptsInputType({ inputs: [] }, 'main'), false);
	assert.equal(nodeAcceptsInputType({}, 'main'), false);
	assert.equal(nodeHasOutputType({ outputs: 'main' }, 'main'), true);
	assert.equal(nodeHasOutputType({ outputs: [{ type: 'main' }] }, 'ai_tool'), false);
});

/* --- parameter utils (path-utils / value guard / rename oracles) ----------- */

test('resolveRelativePath: all eight oracle rows (path-utils.test.ts)', () => {
	const rows = [
		['parameters.level1.level2.field', '&childField', 'level1.level2.childField'],
		['parameters.level1.level2[0].field', '&childField', 'level1.level2[0].childField'],
		['parameters.level1.level2.field', 'absolute.path', 'absolute.path'],
		['parameters', '&childField', 'childField'],
		['parameters.level1.level2.field', '', ''],
		['', '&childField', 'childField'],
		['', '', ''],
		['parameters.level1.level2.field', 'relative.path', 'relative.path'],
	];
	for (const [fullPath, candidate, expected] of rows) {
		assert.equal(resolveRelativePath(fullPath, candidate), expected, `${fullPath} + ${candidate}`);
	}
});

test('getParameterValueByPath: get(values, path ? path.name : name) (node-helpers.ts L1369)', () => {
	assert.equal(getParameterValueByPath({ a: 1 }, 'a', ''), 1);
	assert.equal(getParameterValueByPath({ sub: { a: 2 } }, 'a', 'sub'), 2);
	assert.equal(getParameterValueByPath({}, 'missing', ''), undefined);
});

test('renameFormFields: rewrites only html form fields, leaves others (rename-node-utils.ts)', () => {
	const node = {
		parameters: {
			formFields: {
				values: [
					{ fieldType: 'html', html: 'old' },
					{ fieldType: 'text', html: 'untouched' },
					'not-an-object',
				],
			},
		},
	};
	renameFormFields(node, (value) => `${value}!`);
	assert.equal(node.parameters.formFields.values[0].html, 'old!');
	assert.equal(node.parameters.formFields.values[1].html, 'untouched');
	renameFormFields({ parameters: {} }, (v) => v);
	renameFormFields({}, (v) => v);
});

test('value guards: primitives, locators, mappers, filters, assignments (type-guard oracle)', () => {
	for (const value of ['s', 1, true, undefined, null]) assert.equal(isValidNodeParameterValueType(value), true);
	assert.equal(isResourceLocatorValue({ __rl: true, mode: 'list', value: 'v' }), true);
	assert.equal(isResourceLocatorValue({ mode: 'list', value: 'v' }), false);
	assert.equal(isResourceMapperValue({ mappingMode: 'auto', schema: [], value: {} }), true);
	assert.equal(isFilterValue({ conditions: [], combinator: 'and' }), true);
	assert.equal(isAssignmentCollectionValue({ assignments: [{ id: '1', name: 'a', value: 'b' }] }), true);
	assert.equal(isAssignmentCollectionValue({ assignments: [{ id: 1, name: 'a', value: 'b' }] }), false);
	assert.equal(isNodeParameters({ a: { b: [1, 'x'] } }), true);
	assert.equal(isNodeParameters(new Date()), false);
	assert.equal(isNodeParameters([1, 2]), false);
	assert.equal(isValidNodeParameterValueType({ a: new Date() }), false);
	assert.equal(isValidNodeParameterValueType([{ a: 1 }]), true);
	assert.equal(isValidNodeParameterValueType([new Date()]), false);
	assert.equal(isValidNodeParameterValueType([]), true);
});

test('assertIsValidNodeParameterValueType: default and custom messages (L170-L190)', () => {
	assert.doesNotThrow(() => assertIsValidNodeParameterValueType({ a: 1 }));
	assert.throws(() => assertIsValidNodeParameterValueType(new Date()), {
		message: 'Value is not a valid NodeParameterValueType',
	});
	assert.throws(() => assertIsValidNodeParameterValueType(new Date(), 'custom message'), { message: 'custom message' });
});

/* --- parameter type validation (parameter-type-validation.test.ts) -------- */

test('validateNodeParameters: required, optional-present and type matrix', () => {
	const node = { name: 'Node' };
	const parameters = {
		name: { type: 'string' },
		count: { type: 'number' },
		flag: { type: 'boolean' },
		ids: { type: 'string[]' },
		locator: { type: 'resource-locator' },
		payload: { type: 'object' },
		either: { type: ['string', 'number'] },
	};

	assert.doesNotThrow(() =>
		validateNodeParameters(
			{ name: 'x', count: 1, flag: true, ids: ['a'], locator: { __rl: true, mode: 'list', value: 'v' }, payload: {}, either: 3 },
			parameters,
			node,
		),
	);
	// optional parameters are skipped when undefined
	assert.doesNotThrow(() => validateNodeParameters({}, parameters, node));
	assert.doesNotThrow(() => validateNodeParameters({ ids: ['a', 'b'] }, parameters, node));
});

test('validateNodeParameters: failures carry the reference aggregate message and level info', () => {
	const node = { name: 'Node' };
	const attempt = (value, parameters) => {
		try {
			validateNodeParameters(value, parameters, node);
			return null;
		} catch (error) {
			return error;
		}
	};

	// the per-type assertions are swallowed by validateParameterType (L178-192), so the
	// surface message is always the aggregate one from validateParameterAgainstTypes (L211-225)
	const notString = attempt({ name: 1 }, { name: { type: 'string' } });
	assert.equal(notString.message, 'Parameter "name" does not match any of the expected types: string');
	assert.equal(notString.level, 'info');
	assert.equal(notString.node, node);
	assert.ok(notString instanceof NodeOperationError);
	assert.equal(notString.name, 'NodeOperationError');

	assert.equal(attempt('not-an-object', {}).message, 'Value is not a valid object');
	assert.equal(attempt({}, { name: { type: 'string', required: true } }).message, 'Required parameter "name" is missing');
	assert.equal(
		attempt({ ids: 'a' }, { ids: { type: 'string[]' } }).message,
		'Parameter "ids" does not match any of the expected types: string[]',
	);
	assert.equal(
		attempt({ ids: [1] }, { ids: { type: 'string[]' } }).message,
		'Parameter "ids" does not match any of the expected types: string[]',
	);
	assert.equal(
		attempt({ locator: {} }, { locator: { type: 'resource-locator' } }).message,
		'Parameter "locator" does not match any of the expected types: resource-locator',
	);
	assert.equal(
		attempt({ payload: 5 }, { payload: { type: 'object' } }).message,
		'Parameter "payload" does not match any of the expected types: object',
	);
	assert.equal(
		attempt({ either: true }, { either: { type: ['string', 'number'] } }).message,
		'Parameter "either" does not match any of the expected types: string or number',
	);
});

test('assertParamIsNumber/String/Boolean: the per-type messages (L45-58)', () => {
	const node = { name: 'Node' };
	assert.doesNotThrow(() => assertParamIsNumber('count', 1, node));
	assert.doesNotThrow(() => assertParamIsString('name', 'x', node));
	assert.doesNotThrow(() => assertParamIsBoolean('flag', true, node));
	assert.throws(() => assertParamIsNumber('count', 'x', node), { message: 'Parameter "count" is not number' });
	assert.throws(() => assertParamIsString('name', 1, node), { message: 'Parameter "name" is not string' });
	assert.throws(() => assertParamIsBoolean('flag', 'x', node), { message: 'Parameter "flag" is not boolean' });
});

test('assertParamIsArray: sparse arrays are rejected by the index loop (L82-L89)', () => {
	const node = { name: 'Node' };
	assert.throws(() => assertParamIsArray('ids', 'x', () => true, node), { message: 'Parameter "ids" is not an array' });
	// eslint-disable-next-line no-sparse-arrays
	assert.throws(() => assertParamIsArray('ids', [, 'a'], (v) => typeof v === 'string', node), /has elements/);
	assertParamIsArray('ids', ['a', 'b'], (v) => typeof v === 'string', node);
});

test('assertParamIsOfAnyTypes lists the accepted types (L60-L72)', () => {
	assertParamIsOfAnyTypes('x', 1, ['string', 'number'], { name: 'Node' });
	assert.throws(() => assertParamIsOfAnyTypes('x', true, ['string', 'number'], { name: 'Node' }), {
		message: 'Parameter "x" must be string or number',
	});
});

/* --- properties (node-helpers.test.ts) ------------------------------------ */

test('mergeNodeProperties: append, overwrite by name, doNotInherit skipped (L1641)', () => {
	const main = [{ name: 'a', type: 'string' }];
	mergeNodeProperties(main, [{ name: 'a', type: 'number' }, { name: 'b', type: 'string' }, { name: 'c', type: 'string', doNotInherit: true }]);
	assert.deepEqual(main, [{ name: 'a', type: 'number' }, { name: 'b', type: 'string' }]);
});

test('getVersionedNodeType / isNodeWithWorkflowSelector (L1661, L1688)', () => {
	const versioned = { nodeVersions: {}, getNodeType: (v) => ({ version: v }) };
	assert.deepEqual(getVersionedNodeType(versioned, 2), { version: 2 });
	const plain = { description: {} };
	assert.equal(getVersionedNodeType(plain), plain);
	assert.equal(isNodeWithWorkflowSelector({ type: 'n8n-nodes-base.executeWorkflow' }), true);
	assert.equal(isNodeWithWorkflowSelector({ type: '@n8n/n8n-nodes-langchain.toolWorkflow' }), true);
	assert.equal(isNodeWithWorkflowSelector({ type: 'n8n-nodes-base.set' }), false);
});

test('makeDescription / makeNodeName: action, resource+operation, fallback (L1692-L1847)', () => {
	const description = {
		name: 'n8n-nodes-base.slack',
		displayName: 'Slack',
		description: 'Send Slack messages',
		defaults: { name: 'Slack' },
		properties: [
			{
				name: 'operation',
				options: [{ name: 'Send', value: 'send', action: 'Send a message' }],
				displayOptions: { show: { resource: ['message'] } },
			},
		],
	};

	assert.deepEqual(
		makeDescription({ resource: 'message', operation: 'send' }, description),
		'Send a message in Slack',
	);
	assert.deepEqual(
		makeDescription({ resource: 'other', operation: 'delete' }, description),
		'delete other in Slack',
	);
	assert.deepEqual(makeDescription({}, { ...description, properties: [] }), 'Send Slack messages');
	assert.equal(makeNodeName({ resource: 'message', operation: 'send' }, description), 'Send a message');
	assert.equal(makeNodeName({}, { ...description, properties: [] }), 'Slack');
	assert.equal(makeNodeName({}, { ...description, properties: [], skipNameGeneration: true }), 'Slack');
});

test('makeNodeName: the code-node language action special case (L1700-L1709)', () => {
	const description = {
		name: 'n8n-nodes-base.code',
		displayName: 'Code',
		defaults: { name: 'Code' },
		description: 'Run code',
		properties: [{ name: 'language', options: [{ name: 'JS', value: 'javaScript', action: 'Run JavaScript' }] }],
	};
	assert.equal(makeNodeName({ language: 'javaScript' }, description), 'Run JavaScript');
});

test('makeNodeName: tool postfix and vector-store tool detection (L1816, L1782)', () => {
	const tool = {
		name: 'n8n-nodes-base.someTool',
		displayName: 'Some Tool',
		defaults: { name: 'Some Tool' },
		description: 'd',
		outputs: [{ type: 'ai_tool' }],
		properties: [{ name: 'operation', options: [{ name: 'Do', value: 'do', action: 'Do a thing' }], displayOptions: { show: { resource: ['x'] } } }],
	};
	assert.equal(makeNodeName({ resource: 'x', operation: 'do' }, tool), 'Do a thing in Some Tool');
	// the suffix alone does not make it a tool: isTool only looks at vectorStore mode and outputs
	assert.equal(makeNodeName({ resource: 'x', operation: 'do' }, { ...tool, outputs: ['main'] }), 'Do a thing');
	assert.equal(isTool({ name: 'n8n-nodes-base.vectorStoreQdrant', outputs: ['ai_tool'] }, { mode: 'retrieve-as-tool' }), true);
	assert.equal(isTool({ name: 'n8n-nodes-base.vectorStoreQdrant', outputs: ['ai_tool'] }, { mode: 'insert' }), false);
});

test('isDefaultNodeName: `<name>\\d*` including auto-renames (L1849)', () => {
	const description = { name: 'n8n-nodes-base.set', displayName: 'Set', defaults: { name: 'Set' }, description: 'd', properties: [] };
	assert.equal(isDefaultNodeName('Set', description, {}), true);
	assert.equal(isDefaultNodeName('Set1', description, {}), true);
	assert.equal(isDefaultNodeName('SetX', description, {}), false);
	assert.equal(isDefaultNodeName('Other', description, {}), false);
});

test('isToolType / isHitlToolType: suffix on the last segment, hitl toggle (L1761-L1781)', () => {
	assert.equal(isToolType('n8n-nodes-base.httpRequestTool'), true);
	assert.equal(isToolType('@n8n/n8n-nodes-langchain.toolCode'), true);
	assert.equal(isToolType('n8n-nodes-base.thingHitlTool'), true);
	assert.equal(isToolType('n8n-nodes-base.thingHitlTool', { includeHitl: false }), false);
	assert.equal(isToolType(undefined), false);
	assert.equal(isHitlToolType('n8n-nodes-base.thingHitlTool'), true);
	assert.equal(isHitlToolType('n8n-nodes-base.thingTool'), false);
});

test('getToolDescriptionForNode / getUpdatedToolDescription (L1864-L1906)', () => {
	const nodeType = {
		description: { name: 'n8n-nodes-base.tool', displayName: 'Tool', defaults: { name: 'Tool' }, description: 'auto description', properties: [] },
	};
	assert.equal(getToolDescriptionForNode({ parameters: { descriptionType: 'auto' } }, nodeType), 'auto description');
	assert.equal(
		getToolDescriptionForNode({ parameters: { descriptionType: 'manual', toolDescription: 'manual text' } }, nodeType),
		'manual text',
	);

	const current = { parameters: { descriptionType: 'manual', toolDescription: 'auto description' } };
	// toolDescription still equals the generated description -> refresh it
	assert.equal(
		getUpdatedToolDescription(nodeType.description, current.parameters, current.parameters),
		'auto description',
	);
	// a hand-written description is preserved (no update)
	assert.equal(
		getUpdatedToolDescription(
			nodeType.description,
			{ descriptionType: 'manual', toolDescription: 'hand written' },
			current.parameters,
		),
		undefined,
	);
	assert.equal(getUpdatedToolDescription(null, current.parameters, current.parameters), undefined);
	const filled = { descriptionType: 'manual', toolDescription: '   ' };
	assert.equal(getUpdatedToolDescription(nodeType.description, filled, current.parameters), 'auto description');
});

test('getSubworkflowId: only workflow-selector nodes with a locator value (L1908)', () => {
	assert.equal(
		getSubworkflowId({ type: 'n8n-nodes-base.executeWorkflow', parameters: { workflowId: { __rl: true, mode: 'id', value: 'wf-1' } } }),
		'wf-1',
	);
	assert.equal(getSubworkflowId({ type: 'n8n-nodes-base.executeWorkflow', parameters: { workflowId: 'wf-1' } }), undefined);
	assert.equal(
		getSubworkflowId({ type: 'n8n-nodes-base.set', parameters: { workflowId: { __rl: true, mode: 'id', value: 'wf-1' } } }),
		undefined,
	);
});

/* --- the dependency-free lodash subset (documented delta) ------------------ */

test('get/toPath: lodash path grammar used by node parameters', () => {
	assert.deepEqual(toPath('a.b[0].c'), ['a', 'b', '0', 'c']);
	assert.deepEqual(toPath('parameters.a.b[0].c'), ['parameters', 'a', 'b', '0', 'c']);
	assert.equal(get({ a: { b: [{ c: 1 }] } }, 'a.b[0].c'), 1);
	assert.equal(get({ a: 1 }, 'a.b', 'D'), 'D');
	assert.equal(get(null, 'a', 'D'), 'D');
	assert.equal(get({ a: { b: null } }, 'a.b.c', 'D'), 'D');
});

test('isEqual: JSON-shaped values (documented delta)', () => {
	const source = { a: [1, { b: 2 }] };
	assert.equal(isEqual(source, { a: [1, { b: 2 }] }), true);
	assert.equal(isEqual({ a: 1 }, { a: 2 }), false);
	assert.equal(getConnectionTypes([{ type: NodeConnectionTypes.Main }])[0], 'main');
});

test('deepCopy: verbatim utils.ts semantics (L53-87)', () => {
	const source = { a: [1, { b: 2 }] };
	const copy = deepCopy(source);
	assert.notEqual(copy, source);
	assert.notEqual(copy.a, source.a);
	assert.deepEqual(copy, source);

	// primitives, null and functions are returned as-is
	assert.equal(deepCopy('x'), 'x');
	assert.equal(deepCopy(null), null);
	const fn = () => 1;
	assert.equal(deepCopy(fn), fn);

	// objects with toJSON are replaced by their toJSON() result (a Date becomes a string)
	assert.equal(deepCopy(new Date(0)), '1970-01-01T00:00:00.000Z');

	// cycles are preserved through the WeakMap
	const cyclic = { a: 1 };
	cyclic.self = cyclic;
	const cyclicCopy = deepCopy(cyclic);
	assert.equal(cyclicCopy.self, cyclicCopy);
	assert.equal(cyclicCopy.a, 1);

	// the clone is a plain object
	assert.equal(Object.getPrototypeOf(deepCopy(Object.create({ marker: true }))), Object.prototype);
});

test('isExpression: only strings starting with "=" (expression-helpers.ts L1-10)', () => {
	assert.equal(isExpression('='), true);
	assert.equal(isExpression('={{ 1 + 1 }}'), true);
	assert.equal(isExpression('x'), false);
	assert.equal(isExpression(''), false);
	assert.equal(isExpression(1), false);
	assert.equal(isExpression(null), false);
	assert.equal(isExpression(undefined), false);
});

test('ApplicationError: reference surface (name stays "Error", level "error")', () => {
	const error = new ApplicationError('boom', { extra: { k: 1 } });
	assert.equal(error.name, 'Error');
	assert.equal(error.message, 'boom');
	assert.equal(error.level, 'error');
	assert.deepEqual(error.extra, { k: 1 });
	assert.deepEqual(error.tags, {});
});

/* --- parameter resolution (node-helpers.test.ts `getNodeParameters`) ------- */

const PARAM_NODE = { typeVersion: 1 };
const resolveParams = (nodePropertiesArray, nodeValues, returnDefaults, returnNoneDisplayed, options) =>
	getNodeParameters(nodePropertiesArray, nodeValues, returnDefaults, returnNoneDisplayed, PARAM_NODE, null, options);

test('getNodeParameters: plain values, defaults and none-displayed matrix (oracle L53-334)', () => {
	const nodePropertiesArray = [
		{ name: 'string1', displayName: 'String 1', type: 'string', default: '' },
		{ name: 'string2', displayName: 'String 2', type: 'string', default: 'default string 2' },
		{ name: 'number1', displayName: 'Number 1', type: 'number', default: 10 },
		{ name: 'boolean1', displayName: 'Boolean 1', type: 'boolean', default: false },
	];
	const nodeValues = { string1: 'hello', number1: 0, boolean1: false };

	// without defaults only values differing from their default survive: number1 (0 vs 10) stays,
	// boolean1 (false === default) is dropped
	assert.deepEqual(resolveParams(nodePropertiesArray, nodeValues, false, false), {
		string1: 'hello',
		number1: 0,
	});
	assert.deepEqual(resolveParams(nodePropertiesArray, { string1: 'hello' }, false, false), { string1: 'hello' });
	// with defaults everything appears, false/0 keeping their real value (L790-800)
	assert.deepEqual(resolveParams(nodePropertiesArray, { string1: 'hello' }, true, false), {
		string1: 'hello',
		string2: 'default string 2',
		number1: 10,
		boolean1: false,
	});
	// null values resolve to an empty result instead of throwing (oracle L3466)
	assert.deepEqual(resolveParams(nodePropertiesArray, null, true, false), {});
});

test('getNodeParameters: displayOptions show match/mismatch + returnNoneDisplayed (oracle L335-619)', () => {
	const nodePropertiesArray = [
		{ name: 'mode', displayName: 'Mode', type: 'options', default: 'a', options: [{ name: 'A', value: 'a' }, { name: 'B', value: 'b' }] },
		{ name: 'child', displayName: 'Child', type: 'string', default: 'x', displayOptions: { show: { mode: ['b'] } } },
	];
	assert.deepEqual(resolveParams(nodePropertiesArray, { mode: 'b' }, true, false), { mode: 'b', child: 'x' });
	assert.deepEqual(resolveParams(nodePropertiesArray, { mode: 'a' }, true, false), { mode: 'a' });
	// without defaults a value equal to its default is dropped as well
	assert.deepEqual(resolveParams(nodePropertiesArray, { mode: 'a', child: 'hidden but set' }, false, false), {});
	// returnNoneDisplayed keeps the hidden parameter (and drops the default-valued one)
	assert.deepEqual(resolveParams(nodePropertiesArray, { mode: 'a', child: 'hidden but set' }, false, true), {
		child: 'hidden but set',
	});
});

test('getNodeParameters: duplicate parameter names are re-checked individually (L726-737)', () => {
	const nodePropertiesArray = [
		{ name: 'resource', displayName: 'Resource', type: 'options', default: 'r1', options: [{ name: 'R1', value: 'r1' }] },
		{ name: 'value', displayName: 'V1', type: 'string', default: 'd1', displayOptions: { show: { resource: ['r1'] } } },
		{ name: 'value', displayName: 'V2', type: 'string', default: 'd2', displayOptions: { show: { resource: ['r2'] } } },
	];
	assert.deepEqual(resolveParams(nodePropertiesArray, { resource: 'r2', value: 'user value' }, false, false), {
		resource: 'r2',
		value: 'user value',
	});
	assert.deepEqual(resolveParams(nodePropertiesArray, { resource: 'r1' }, true, false), {
		resource: 'r1',
		value: 'd1',
	});
});

test('getNodeParameters: noDataExpression strips the expression prefix (oracle L6321-6524)', () => {
	const nodePropertiesArray = [
		{ name: 'code', displayName: 'Code', type: 'string', default: '', noDataExpression: true },
		{ name: 'keep', displayName: 'Keep', type: 'string', default: '' },
	];
	// pinned quirk: the strip runs after the returnDefaults branch, so it only applies there
	assert.deepEqual(resolveParams(nodePropertiesArray, { code: '={{ 1 + 1 }}', keep: '=not stripped' }, true, false), {
		code: '{{ 1 + 1 }}',
		keep: '=not stripped',
	});
	assert.deepEqual(resolveParams(nodePropertiesArray, { code: '={{ 1 + 1 }}', keep: '=not stripped' }, false, false), {
		code: '={{ 1 + 1 }}',
		keep: '=not stripped',
	});
	// non-string values are left alone
	assert.deepEqual(
		resolveParams([{ name: 'n', displayName: 'N', type: 'number', default: 1, noDataExpression: true }], { n: 5 }, false, false),
		{ n: 5 },
	);
});

test('getNodeParameters: resourceLocator defaults get the __rl marker (L781-790)', () => {
	assert.deepEqual(
		resolveParams([{ name: 'rl', displayName: 'RL', type: 'resourceLocator', default: { mode: 'list', value: 'v' } }], {}, true, false),
		{ rl: { __rl: true, mode: 'list', value: 'v' } },
	);
	assert.deepEqual(
		resolveParams([{ name: 'rl', displayName: 'RL', type: 'resourceLocator', default: { mode: 'list', value: 'v' } }], {}, false, false),
		{},
	);
});

test('getNodeParameters: collection with multipleValues and single collections (L820-876)', () => {
	const multi = [
		{
			name: 'col', displayName: 'Col', type: 'collection', default: [], typeOptions: { multipleValues: true },
			options: [{ name: 'a', displayName: 'A', type: 'string', default: '' }],
		},
	];
	assert.deepEqual(resolveParams(multi, { col: [{ a: 'x' }] }, false, false), { col: [{ a: 'x' }] });
	// nothing set: with defaults an empty array is returned even when the default is not an array (L829-838)
	assert.deepEqual(resolveParams(multi, {}, true, false), { col: [] });

	const single = [
		{
			name: 'col', displayName: 'Col', type: 'collection', default: {},
			options: [
				{ name: 'a', displayName: 'A', type: 'string', default: 'da' },
				{ name: 'b', displayName: 'B', type: 'string', default: 'db' },
			],
		},
	];
	// inside a collection a value equal to its default is still returned (L805-807)
	assert.deepEqual(resolveParams(single, { col: { b: 'user' } }, false, false), { col: { b: 'user' } });
	assert.deepEqual(resolveParams(single, { col: { a: 'da' } }, false, false), { col: { a: 'da' } });
	// without values the collection default itself is returned — child defaults are NOT materialised
	assert.deepEqual(resolveParams(single, {}, true, false), { col: {} });
	// and an explicitly empty collection stays empty even with returnDefaults: inside a collection a
	// `undefined` child is skipped (L703-708), so child defaults are never invented
	assert.deepEqual(resolveParams(single, { col: {} }, true, false), { col: {} });
	assert.deepEqual(resolveParams(single, { col: { a: 'da' } }, true, false), { col: { a: 'da' } });
});

test('getNodeParameters: fixedCollection multipleValues keeps every item (oracle L620-726)', () => {
	const nodePropertiesArray = [
		{
			name: 'fc', displayName: 'FC', type: 'fixedCollection', default: {}, typeOptions: { multipleValues: true },
			options: [{ name: 'item', displayName: 'Item', values: [{ name: 'v', displayName: 'V', type: 'string', default: '' }] }],
		},
	];
	assert.deepEqual(resolveParams(nodePropertiesArray, { fc: { item: [{ v: 'one' }, { v: 'two' }] } }, false, false), {
		fc: { item: [{ v: 'one' }, { v: 'two' }] },
	});
	assert.throws(() => resolveParams(nodePropertiesArray, { fc: { unknown: [{ v: '1' }] } }, false, false), {
		name: 'Error',
		message: 'Could not find property option',
	});
	// pinned quirk: a non-array element is iterated with `for…of`, so a *string* yields one empty
	// object per character instead of being rejected (L905-916 guards the outer value only)
	const perCharacter = Array.from({ length: 'not-an-array'.length }, () => ({}));
	assert.deepEqual(resolveParams(nodePropertiesArray, { fc: { item: 'not-an-array' } }, false, false), {
		fc: { item: perCharacter },
	});
});

test('getNodeParameters: fixedCollection single-value GitHub cases (L903-1030)', () => {
	const nodePropertiesArray = [
		{
			name: 'fc', displayName: 'FC', type: 'fixedCollection', default: {}, typeOptions: { multipleValues: false },
			options: [{
				name: 'item', displayName: 'Item',
				values: [
					{ name: 'mode', displayName: 'Mode', type: 'options', default: 'a', options: [{ name: 'A', value: 'a' }] },
					{ name: 'child', displayName: 'Child', type: 'string', default: '', displayOptions: { show: { mode: ['b'] } } },
				],
			}],
		},
	];
	// hidden field with a non-default value: the whole collection is dropped (test case, L1000-1030)
	assert.deepEqual(resolveParams(nodePropertiesArray, { fc: { item: { mode: 'a', child: 'typed but hidden' } } }, false, false), {});
	// explicitly added item that only holds defaults is preserved (GitHub case, L966-997)
	const defaultsOnly = [
		{
			name: 'fc', displayName: 'FC', type: 'fixedCollection', default: {}, typeOptions: { multipleValues: false },
			options: [{ name: 'item', displayName: 'Item', values: [{ name: 'v', displayName: 'V', type: 'string', default: 'dv' }] }],
		},
	];
	assert.deepEqual(resolveParams(defaultsOnly, { fc: { item: { v: 'dv' } } }, false, false), { fc: { item: {} } });
	// an empty object value short-circuits the whole resolution and returns the values back (L880-887)
	assert.deepEqual(resolveParams(defaultsOnly, { fc: {} }, false, false), { fc: {} });
});

test('getNodeParameters: dependency cycles terminate (resolve-order quirk, L577-656)', () => {
	const nodePropertiesArray = [
		{ name: 'a', displayName: 'A', type: 'string', default: '', displayOptions: { show: { b: ['x'] } } },
		{ name: 'b', displayName: 'B', type: 'string', default: '', displayOptions: { show: { a: ['x'] } } },
	];
	// Pinned quirk: the `continue` statements inside the dependency loop only advance that loop,
	// so an unresolved parameter is re-queued AND resolved anyway — a cycle terminates instead of
	// hanging or throwing, and both parameters come back when none-displayed values are requested.
	assert.deepEqual(resolveParams(nodePropertiesArray, { a: '1', b: '2' }, true, false), {});
	assert.deepEqual(resolveParams(nodePropertiesArray, { a: '1', b: '2' }, false, true), { a: '1', b: '2' });
	// the max-iterations guard itself is only reachable when the queue keeps growing (L627-652)
});

test('getNodeParameters: unknown fixedCollection option throws the reference error (L913-919)', () => {
	const nodePropertiesArray = [
		{
			name: 'fc', displayName: 'FC', type: 'fixedCollection', default: {}, typeOptions: { multipleValues: true },
			options: [{ name: 'known', displayName: 'K', values: [{ name: 'v', displayName: 'V', type: 'string', default: '' }] }],
		},
	];
	assert.throws(() => resolveParams(nodePropertiesArray, { fc: { unknown: [{ v: '1' }] } }, false, false), {
		name: 'Error',
		message: 'Could not find property option',
	});
});

/* =========================================================================
 * Slice 3 — field-type validation, filter-parameter validation and the
 * parameter-issues engine.
 * Oracles: test/type-validation.test.ts (`Type Validation` L11),
 *          test/node-helpers.test.ts (`getParameterIssues` L3683,
 *          `getParameterIssues, required parameters validation` L4270),
 *          test/filter-parameter.test.ts (`FilterParameter` L32).
 * ======================================================================= */

test('validateFieldType: alphanumeric strings reject leading numbers (oracle type-validation.test.ts L13/L23)', () => {
	assert.deepEqual(validateFieldType('field', 'abc_1', 'string-alphanumeric'), { valid: true, newValue: 'abc_1' });
	assert.deepEqual(validateFieldType('field', '1abc', 'string-alphanumeric'), {
		valid: false,
		errorMessage: 'Value is not a valid alphanumeric string, only letters, numbers and underscore allowed',
	});
	assert.equal(validateFieldType('field', 'a-b', 'string-alphanumeric').valid, false);
});

test('validateFieldType: dateTime uses the injected factory and rejects invalid dates (DELTA-04; oracle L45/L122)', () => {
	// default (dependency-free) factory — see contract DELTA-04 for the luxon delta
	const iso = validateFieldType('field', '2024-01-02T03:04:05Z', 'dateTime');
	assert.equal(iso.valid, true);
	assert.equal(iso.newValue.toISO(), '2024-01-02T03:04:05.000Z');
	assert.equal(validateFieldType('field', new Date(1000), 'dateTime').newValue.toMillis(), 1000);
	assert.equal(validateFieldType('field', '2019-01-01 00:00:00', 'dateTime').valid, true);
	assert.equal(validateFieldType('field', 'Tue, 01 Jan 2019 00:00:00 GMT', 'dateTime').valid, true);

	const invalid = validateFieldType('field', 'not a date', 'dateTime');
	assert.equal(invalid.valid, false);
	assert.equal(
		invalid.errorMessage,
		`'field' expects a dateTime but we got 'not a date' <br/><br/> Consider using <a href="https://moment.github.io/luxon/api-docs/index.html#datetimefromformat" target="_blank"><code>DateTime.fromFormat</code></a> to work with custom date formats.`,
	);

	// an injected factory is what the differential injects (the reference's own luxon)
	const seen = [];
	const spyFactory = {
		isDateTime: (value) => defaultDateTimeFactory.isDateTime(value),
		fromJSDate: (...args) => (seen.push('fromJSDate'), defaultDateTimeFactory.fromJSDate(...args)),
		fromISO: (...args) => (seen.push('fromISO'), defaultDateTimeFactory.fromISO(...args)),
		fromHTTP: (...args) => (seen.push('fromHTTP'), defaultDateTimeFactory.fromHTTP(...args)),
		fromRFC2822: (...args) => (seen.push('fromRFC2822'), defaultDateTimeFactory.fromRFC2822(...args)),
		fromSQL: (...args) => (seen.push('fromSQL'), defaultDateTimeFactory.fromSQL(...args)),
		fromMillis: (...args) => (seen.push('fromMillis'), defaultDateTimeFactory.fromMillis(...args)),
	};
	validateFieldType('field', '2024-01-02', 'dateTime', { dateTimeFactory: spyFactory });
	assert.deepEqual(seen, ['fromISO']);
	seen.length = 0;
	validateFieldType('field', 'zzz', 'dateTime', { dateTimeFactory: spyFactory });
	assert.deepEqual(seen, ['fromISO', 'fromHTTP', 'fromRFC2822', 'fromSQL', 'fromMillis']);
});

test('validateFieldType: booleans and numbers (oracle L140/L158/L165)', () => {
	assert.deepEqual(validateFieldType('field', true, 'boolean'), { valid: true, newValue: true });
	assert.deepEqual(validateFieldType('field', 'FALSE', 'boolean'), { valid: true, newValue: false });
	assert.deepEqual(validateFieldType('field', 1, 'boolean'), { valid: true, newValue: true });
	assert.deepEqual(validateFieldType('field', 'maybe', 'boolean'), {
		valid: false,
		errorMessage: "'field' expects a boolean but we got 'maybe'",
	});
	assert.deepEqual(validateFieldType('field', '', 'boolean'), {
		valid: false,
		errorMessage: "'field' expects a boolean but we got ''",
	});

	assert.deepEqual(validateFieldType('field', '5', 'number'), { valid: true, newValue: 5 });
	assert.deepEqual(validateFieldType('field', '5.5', 'number'), { valid: true, newValue: 5.5 });
	// pinned quirk: Number('') === 0, so an empty string is a valid number
	assert.deepEqual(validateFieldType('field', '', 'number'), { valid: true, newValue: 0 });
	assert.deepEqual(validateFieldType('field', 'abc', 'number'), {
		valid: false,
		errorMessage: "'field' expects a number but we got 'abc'",
	});
	// strict mode refuses to convert
	assert.deepEqual(validateFieldType('field', '5', 'number', { strict: true }), {
		valid: false,
		errorMessage: "'field' expects a number but we got '5'",
	});
	// parseStrings only affects the `string` type
	assert.deepEqual(validateFieldType('field', 'abc', 'string'), { valid: true, newValue: 'abc' });
	assert.deepEqual(validateFieldType('field', 42, 'string', { parseStrings: true }), { valid: true, newValue: '42' });
});

test('validateFieldType: objects, arrays and the tolerant JS-object adapter (DELTA-05; oracle L187/L224)', () => {
	assert.deepEqual(validateFieldType('field', '{"a":1}', 'object'), { valid: true, newValue: { a: 1 } });
	assert.deepEqual(validateFieldType('field', "{'a':1}", 'object'), { valid: true, newValue: { a: 1 } });
	assert.deepEqual(validateFieldType('field', '{a: 1, b: "x"}', 'object'), { valid: true, newValue: { a: 1, b: 'x' } });
	assert.deepEqual(validateFieldType('field', 'not json', 'object'), {
		valid: false,
		errorMessage: "'field' expects a object but we got 'not json'",
	});
	assert.deepEqual(validateFieldType('field', [1, 2], 'object', { strict: true }), {
		valid: false,
		errorMessage: "'field' expects a object but we got array",
	});

	assert.deepEqual(validateFieldType('field', '[1,2]', 'array'), { valid: true, newValue: [1, 2] });
	assert.deepEqual(validateFieldType('field', "['a','b']", 'array'), { valid: true, newValue: ['a', 'b'] });
	assert.equal(validateFieldType('field', '[1,2', 'array').valid, false);
	assert.equal(validateFieldType('field', '{"a":1}', 'array').valid, false);
});

test('validateFieldType: options, time, url, jwt, binary and null (oracle L254/L273/L378/L414)', () => {
	const valueOptions = [{ name: 'A', value: 'a' }, { name: 'B', value: 'b' }];
	assert.deepEqual(validateFieldType('field', 'a', 'options', { valueOptions }), { valid: true, newValue: 'a' });
	assert.deepEqual(validateFieldType('field', 'c', 'options', { valueOptions }), {
		valid: false,
		errorMessage: "'field' expects one of the following values: [a, b] but we got 'c'",
	});

	assert.deepEqual(validateFieldType('field', '12:30:45', 'time'), { valid: true, newValue: '12:30:45' });
	assert.deepEqual(validateFieldType('field', '1:2', 'time'), {
		valid: false,
		errorMessage: "'field' expects time (hh:mm:(:ss)) but we got '1:2'.",
	});

	// tryToParseUrl adds https:// when the value carries no scheme
	assert.deepEqual(validateFieldType('field', 'a.example.com', 'url'), { valid: true, newValue: 'https://a.example.com' });
	assert.equal(validateFieldType('field', 'javascript:alert(1)', 'url').valid, false);
	assert.deepEqual(validateFieldType('field', 'a.b.c', 'jwt'), { valid: true, newValue: 'a.b.c' });
	assert.equal(validateFieldType('field', 'nope', 'jwt').valid, false);

	assert.deepEqual(validateFieldType('field', { mimeType: 'text/plain', data: 'x' }, 'binary'), {
		valid: true,
		newValue: { mimeType: 'text/plain', data: 'x' },
	});
	assert.equal(validateFieldType('field', { mimeType: 'text/plain' }, 'binary').valid, false);
	assert.equal(validateFieldType('field', [], 'binary').valid, false);

	for (const type of ['string', 'number', 'boolean', 'object', 'array', 'binary', 'dateTime']) {
		assert.deepEqual(validateFieldType('field', null, type), { valid: true });
		assert.deepEqual(validateFieldType('field', undefined, type), { valid: true });
	}
	// unknown types pass through untouched
	const passthrough = { a: 1 };
	assert.deepEqual(validateFieldType('field', passthrough, 'not-a-type'), { valid: true, newValue: passthrough });
});

test('getValueDescription + the parse helpers keep the reference wording (oracle L323)', () => {
	assert.equal(getValueDescription(null), "'null'");
	assert.equal(getValueDescription([1, 2]), 'array');
	assert.equal(getValueDescription({ a: 1 }), 'object');
	assert.equal(getValueDescription('x'), "'x'");
	assert.equal(getValueDescription(5), "'5'");
	assert.equal(getValueDescription(undefined), "'undefined'");

	assert.deepEqual(tryToParseNumber('5'), 5);
	assert.throws(() => tryToParseNumber('abc'), { message: 'Failed to parse value to number' });
	assert.deepEqual(tryToParseBoolean('TRUE'), true);
	assert.throws(() => tryToParseBoolean('maybe'), { message: 'Failed to parse value as boolean' });
	assert.deepEqual(tryToParseArray("['a']"), ['a']);
	assert.deepEqual(tryToParseObject('{a: 1}'), { a: 1 });
	assert.deepEqual(tryToParseUrl('example.com'), 'https://example.com');
	assert.deepEqual(tryToParseJwt('a.b.c'), 'a.b.c');
});

test('jsonParse: strict first, then the injected/relaxed object recovery (DELTA-05)', () => {
	assert.deepEqual(jsonParse('{"a":1}'), { a: 1 });
	assert.deepEqual(jsonParse("{'a':'b'}", { acceptJSObject: true }), { a: 'b' });
	assert.deepEqual(jsonParse('{a: 1, b: "x"}', { acceptJSObject: true }), { a: 1, b: 'x' });
	assert.deepEqual(jsonParse('{"a":1,}', { acceptJSObject: true }), { a: 1 });
	assert.throws(() => jsonParse('{a: 1}'), SyntaxError);
	assert.throws(() => jsonParse('{a: 1}', { errorMessage: 'bad json' }), { message: 'bad json' });
	assert.deepEqual(jsonParse('{a: 1}', { fallbackValue: { f: true } }), { f: true });
	assert.deepEqual(jsonParse('{a: 1}', { fallbackValue: () => ['f'] }), ['f']);
	// the adapter itself is injectable (the differential injects the reference's esprima path)
	assert.deepEqual(jsonParse('{a: 1}', { acceptJSObject: true, parseJSObject: () => ({ injected: true }) }), {
		injected: true,
	});
	assert.throws(() => jsonParse('{a: 1}', { acceptJSObject: true, parseJSObject: () => { throw new Error('nope'); } }), SyntaxError);
});

test('validateFilterParameter returns {} for every input (pinned dead-code quirk, L427-450)', () => {
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
	// `parseFilterConditionValues` RETURNS `{ ok: false, error }` — it never throws, so the
	// `catch (error) { if (error instanceof FilterError) ... }` block is unreachable and the
	// function is a no-op. Fixing it would throw a TypeError (see contract §12.2.6).
	assert.deepEqual(validateFilterParameter({ name: 'filters' }, filterValue([condition('number', 'nope', 'also nope')])), {});
	assert.deepEqual(validateFilterParameter({ name: 'filters' }, filterValue([condition('boolean', 'maybe', 'perhaps')])), {});
	assert.deepEqual(validateFilterParameter({ name: 'filters' }, filterValue([condition('string', 'a', 'b')], { typeValidation: 'loose' })), {});
	assert.deepEqual(validateFilterParameter({ name: 'filters' }, filterValue([])), {});
});

test('FilterError keeps the ApplicationError surface: name stays Error, level is warning (DELTA-03)', () => {
	const error = new FilterError('broken comparison', 'try something else');
	assert.equal(error.name, 'Error');
	assert.equal(error.level, 'warning');
	assert.equal(error.message, 'broken comparison');
	assert.equal(error.description, 'try something else');
	assert.ok(error instanceof ApplicationError);
});

test('getNodeParametersIssues: required parameters (oracle node-helpers.test.ts L4270)', () => {
	const node = (parameters, extra = {}) => ({ name: 'Node', type: 'n8n-nodes-base.test', parameters, ...extra });
	const required = (name, displayName, type, extra = {}) => ({ name, displayName, type, required: true, ...extra });
	const issues = (properties, parameters, extra) =>
		getNodeParametersIssues(properties, node(parameters, extra), null);

	assert.deepEqual(issues([required('a', 'A', 'string')], {}), {
		parameters: { a: ['Parameter "A" is required.'] },
	});
	assert.deepEqual(issues([required('a', 'A', 'string')], { a: 'x' }), null);
	assert.deepEqual(issues([required('m', 'M', 'multiOptions')], { m: [] }), {
		parameters: { m: ['Parameter "M" is required.'] },
	});
	assert.deepEqual(issues([required('d', 'D', 'dateTime')], { d: '' }), {
		parameters: { d: ['Parameter "D" is required.'] },
	});
	assert.deepEqual(issues([required('r', 'R', 'resourceLocator')], { r: { __rl: true, value: '', mode: 'list' } }), {
		parameters: { r: ['Parameter "R" is required.'] },
	});
	// a numeric zero resource-locator value is accepted
	assert.equal(issues([required('r', 'R', 'resourceLocator')], { r: { __rl: true, value: 0, mode: 'list' } }), null);
	// multipleValues loops the single values of the array
	assert.deepEqual(
		issues([required('m', 'M', 'string', { typeOptions: { multipleValues: true } })], { m: ['a', ''] }),
		{ parameters: { m: ['Parameter "M" is required.'] } },
	);
});

test('getNodeParametersIssues: disabled / pinned nodes are never validated (L1202-1225)', () => {
	const properties = [{ name: 'a', displayName: 'A', type: 'string', required: true }];
	const node = { name: 'Node', type: 't', parameters: { a: '' } };
	assert.equal(getNodeParametersIssues(properties, { ...node, disabled: true }, null), null);
	assert.equal(getNodeParametersIssues(properties, node, null, ['Node']), null);
	assert.deepEqual(getNodeParametersIssues(properties, node, null), { parameters: { a: ['Parameter "A" is required.'] } });
});

test('getParameterIssues: display gating, resource locator regex and unknown mode (L1389-1470)', () => {
	const hidden = {
		name: 'b', displayName: 'B', type: 'string', required: true,
		displayOptions: { show: { mode: ['b'] } },
	};
	const mode = { name: 'mode', displayName: 'Mode', type: 'options', default: 'a', options: [{ name: 'A', value: 'a' }] };
	const node = { name: 'Node', type: 't', parameters: {} };
	assert.deepEqual(getParameterIssues(hidden, { mode: 'a' }, '', node, null), {});
	assert.deepEqual(
		getParameterIssues({ ...hidden, displayOptions: { show: { mode: ['a'] } } }, { mode: 'a' }, '', node, null),
		{ parameters: { b: ['Parameter "B" is required.'] } },
	);

	const locator = {
		name: 'r', displayName: 'R', type: 'resourceLocator', required: true, default: {},
		modes: [{ name: 'list', type: 'list', validation: [{ type: 'regex', properties: { regex: '^abc$', errorMessage: 'must be abc' } }] }],
	};
	assert.deepEqual(getParameterIssues(locator, { r: { __rl: true, value: 'zzz', mode: 'list' } }, '', node, null), {
		parameters: { r: ['must be abc'] },
	});
	// expressions are not regex-validated
	assert.deepEqual(getParameterIssues(locator, { r: { __rl: true, value: '={{ $json.id }}', mode: 'list' } }, '', node, null), {});
	// an unknown mode skips validation entirely
	assert.deepEqual(getParameterIssues(locator, { r: { __rl: true, value: 'zzz', mode: 'nope' } }, '', node, null), {});
});

test('getParameterIssues: resourceMapper, filter and validateType branches (L1471-1512)', () => {
	const node = { name: 'Node', type: 't', parameters: {} };
	const mapper = { name: 'map', displayName: 'Map', type: 'resourceMapper', default: {} };
	assert.deepEqual(getParameterIssues(mapper, {
		map: { mappingMode: 'autoMapInputData', schema: [{ id: 'a', required: true }], value: null },
	}, '', node, null), {});
	// required fields are only checked in `mode: 'add'` — every other mode sets skipRequiredCheck (L1476)
	assert.deepEqual(getParameterIssues(mapper, {
		map: { mappingMode: 'defineBelow', schema: [{ id: 'a', displayName: 'A', required: true }], value: null },
	}, '', node, null), {});
	const addMapper = { ...mapper, typeOptions: { resourceMapper: { mode: 'add' } } };
	// pinned: the mapper branch initialises `parameters[<name>]` before spreading the field
	// issues, so an empty array for the parameter itself stays next to the per-field keys
	assert.deepEqual(getParameterIssues(addMapper, {
		map: { mappingMode: 'defineBelow', schema: [{ id: 'a', displayName: 'A', required: true }], value: null },
	}, '', node, null), { parameters: { map: [], 'map.a': ['Field "a" is required'] } });
	assert.deepEqual(getParameterIssues(
		{ ...mapper, typeOptions: { resourceMapper: { mode: 'add', fieldWords: { singular: 'column' } } } },
		{ map: { mappingMode: 'defineBelow', schema: [{ id: 'a', displayName: 'A', required: true }], value: null } },
		'', node, null,
	), { parameters: { map: [], 'map.a': ['Column "a" is required'] } });
	assert.deepEqual(getParameterIssues(mapper, {
		map: { mappingMode: 'defineBelow', schema: [{ id: 'n', displayName: 'N', type: 'number' }], value: { n: 'abc' } },
	}, '', node, null), { parameters: { map: [], 'map.n': ["'n' expects a number but we got 'abc'"] } });
	assert.deepEqual(getParameterIssues(mapper, {
		map: { mappingMode: 'defineBelow', schema: [{ id: 'n', displayName: 'N', type: 'number' }], value: { n: '={{ 1 }}' } },
	}, '', node, null), {});

	const filter = { name: 'f', displayName: 'F', type: 'filter', required: true, default: {} };
	assert.deepEqual(getParameterIssues(filter, {
		f: { options: { typeValidation: 'strict', version: 2 }, combinator: 'and', conditions: [
			{ operator: { type: 'number', operation: 'equals' }, leftValue: 'nope', rightValue: 'also nope' }] },
	}, '', node, null), {});

	assert.deepEqual(getParameterIssues({ name: 'n', displayName: 'N', type: 'number', validateType: 'number' }, { n: 'abc' }, '', node, null), {
		parameters: { n: ["'n' expects a number but we got 'abc'"] },
	});
	// expressions skip validateType
	assert.deepEqual(getParameterIssues({ name: 'n', displayName: 'N', type: 'number', validateType: 'number' }, { n: '={{ 1 }}' }, '', node, null), {});
	assert.deepEqual(getParameterIssues({ name: 'a', displayName: 'A', type: 'array', validateType: 'array' }, { a: 'not json' }, '', node, null), {
		parameters: { a: ["'a' expects a array but we got 'not json'"] },
	});
});

test('getParameterIssues: collection and fixedCollection children (L1513-1574)', () => {
	const node = { name: 'Node', type: 't', parameters: {} };
	const child = { name: 'a', displayName: 'A', type: 'string', required: true };
	assert.deepEqual(
		getParameterIssues({ name: 'col', displayName: 'Col', type: 'collection', default: {}, options: [child] }, { col: { a: '' } }, '', node, null),
		// a collection child keeps the *current* path (empty here), so no `col.` prefix (L1513)
		{ parameters: { a: ['Parameter "A" is required.'] } },
	);
	// a missing collection value is checked against the un-prefixed path
	assert.deepEqual(
		getParameterIssues({ name: 'col', displayName: 'Col', type: 'collection', default: {}, options: [child] }, {}, '', node, null),
		{ parameters: { a: ['Parameter "A" is required.'] } },
	);

	const fixed = (typeOptions) => ({
		name: 'fc', displayName: 'FC', type: 'fixedCollection', default: {}, typeOptions,
		options: [{ name: 'item', displayName: 'Item', values: [{ name: 'v', displayName: 'V', type: 'string', required: true }] }],
	});
	assert.deepEqual(getParameterIssues(fixed({ multipleValues: true, minRequiredFields: 2 }), { fc: { item: [{ v: 'x' }] } }, '', node, null), {
		parameters: { fc: ['At least 2 fields are required.'] },
	});
	assert.deepEqual(getParameterIssues(fixed({ multipleValues: true, minRequiredFields: 1 }), {}, '', node, null), {
		parameters: { fc: ['At least 1 field is required.'] },
	});
	assert.deepEqual(getParameterIssues(fixed({ multipleValues: true, maxAllowedFields: 1 }), { fc: { item: [{ v: 'x' }, { v: 'y' }] } }, '', node, null), {
		parameters: { fc: ['At most 1 field is allowed.'] },
	});
	// pinned: issue keys are the *parameter* names, not their paths — the editor resolves the
	// path from the node description. Two broken items therefore collapse into one key.
	assert.deepEqual(getParameterIssues(fixed({ multipleValues: true }), { fc: { item: [{ v: '' }, { v: 'ok' }] } }, '', node, null), {
		parameters: { v: ['Parameter "V" is required.'] },
	});
	assert.deepEqual(getParameterIssues(fixed({ multipleValues: true }), { fc: { item: [{ v: '' }, { v: '' }] } }, '', node, null), {
		parameters: { v: ['Parameter "V" is required.', 'Parameter "V" is required.'] },
	});
	assert.deepEqual(getParameterIssues(fixed(undefined), { fc: { item: { v: '' } } }, '', node, null), {
		parameters: { v: ['Parameter "V" is required.'] },
	});
});

test('mergeIssues merges parameters/credentials/execution/typeUnknown and ignores everything else (L1600-1635)', () => {
	const destination = { parameters: { a: ['one'] } };
	mergeIssues(destination, {
		execution: true,
		typeUnknown: true,
		parameters: { a: ['two'], b: ['b1'] },
		credentials: { cred: ['c1'] },
		ignoredKey: ['nope'],
	});
	assert.deepEqual(destination, {
		parameters: { a: ['one', 'two'], b: ['b1'] },
		credentials: { cred: ['c1'] },
		execution: true,
		typeUnknown: true,
	});

	const untouched = { parameters: { a: ['one'] } };
	mergeIssues(untouched, null);
	assert.deepEqual(untouched, { parameters: { a: ['one'] } });

	// a defined (even empty) object property still materialises on the destination
	const falsey = {};
	mergeIssues(falsey, { execution: false, typeUnknown: false, parameters: {} });
	assert.deepEqual(falsey, { parameters: {} });

	const flagsOnly = {};
	mergeIssues(flagsOnly, { execution: false, typeUnknown: false });
	assert.deepEqual(flagsOnly, {});
});

test('getContext: flow/node keys, lazily created objects and the three errors (L505-538)', () => {
	const run = { executionData: { contextData: {} } };
	assert.deepEqual(getContext(run, 'flow'), {});
	assert.equal(getContext(run, 'node', { name: 'N' }), getContext(run, 'node', { name: 'N' }));
	assert.deepEqual(Object.keys(run.executionData.contextData), ['flow', 'node:N']);

	assert.throws(() => getContext({}, 'flow'), { name: 'Error', message: '`executionData` is not initialized' });
	assert.throws(() => getContext(run, 'node'), {
		message: 'The request data of context type "node" the node parameter has to be set!',
	});
	assert.throws(() => getContext(run, 'nope'), {
		message: 'Unknown context type. Only `flow` and `node` are supported.',
	});
	try {
		getContext(run, 'nope');
	} catch (error) {
		assert.deepEqual(error.extra, { contextType: 'nope' });
	}
});
