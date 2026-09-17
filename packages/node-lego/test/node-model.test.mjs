/**
 * Node LEGO conformance suite.
 *
 * Every case is ported from a reference oracle or pins a line-anchored reference
 * behaviour; the oracle test file is named per test group in README §Surface.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	NodeConnectionTypes,
	NodeOperationError,
	assertIsValidNodeParameterValueType,
	assertParamIsArray,
	assertParamIsBoolean,
	assertParamIsNumber,
	assertParamIsOfAnyTypes,
	assertParamIsString,
	checkConditions,
	cloneDeep,
	displayParameter,
	displayParameterPath,
	get,
	getConnectionTypes,
	getNodeFeatures,
	getNodeInputs,
	getNodeOutputs,
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

test('cloneDeep/isEqual: JSON-shaped values (documented delta)', () => {
	const source = { a: [1, { b: 2 }], when: new Date(0) };
	const copy = cloneDeep(source);
	assert.notEqual(copy, source);
	assert.notEqual(copy.a, source.a);
	assert.deepEqual(copy, source);
	assert.ok(copy.when instanceof Date);
	assert.equal(getConnectionTypes([{ type: NodeConnectionTypes.Main }])[0], 'main');
});
