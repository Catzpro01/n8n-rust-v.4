/**
 * Conformance & Parity Test Suite for Validation LEGO (@lego/validation).
 *
 * Verifies 1:1 behavioral equivalence against:
 *   1. Golden cases A/B/C/D from docs/isolation/validation-golden-cases.md
 *   2. Reference n8n 2.9.4 runtime (n8n-workflow)
 *   3. Rule enforcement per contracts/validation.contract.md §4.4 / §10 (ISSUE-003 Option A)
 *   4. Negative controls proving the oracle rejects flawed implementations
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const repoRoot = resolve(pkgRoot, '../..');

// Import reconstructed validation LEGO
import * as validation from '../dist/index.js';
const {
	validateFieldType,
	getValueDescription,
	tryToParseNumber,
	tryToParseString,
	tryToParseAlphanumericString,
	tryToParseBoolean,
	tryToParseDateTime,
	tryToParseTime,
	tryToParseArray,
	tryToParseObject,
	tryToParseBinary,
	tryToParseUrl,
	tryToParseJwt,
	tryToParseJsonToFormFields,
	isResourceLocatorValue,
	isINodeProperties,
	isINodePropertyOptions,
	isINodePropertyCollection,
	isINodePropertiesList,
	isINodePropertyOptionsList,
	isINodePropertyCollectionList,
	isValidResourceLocatorParameterValue,
	isResourceMapperValue,
	isAssignmentValue,
	isAssignmentCollectionValue,
	isFilterValue,
	isNodeConnectionType,
	isBinaryValue,
	INodeParametersSchema,
	NodeConnectionTypeSchema,
	validateWorkflow,
	detectCycles,
	checkNodeUniqueness,
	checkDanglingConnections,
	ApplicationError,
} = validation;

// Helper to load reference workflow JSON
const loadRefWorkflow = (name) =>
	JSON.parse(readFileSync(resolve(repoRoot, 'tests', 'reference', name, 'workflow.json'), 'utf8'));

// Discover reference runtime if available
const requireRef = () => {
	const candidates = [
		resolve(repoRoot, 'packages/workflow-lego/node_modules/n8n-workflow/package.json'),
		resolve(repoRoot, '.runtime/node_modules/n8n-workflow/package.json'),
	];
	for (const p of candidates) {
		if (existsSync(p)) {
			const req = createRequire(p);
			return req('n8n-workflow');
		}
	}
	return null;
};
const refWorkflow = requireRef();

/* ------------------------------------------------------------------ */
/* Part 1: Golden Cases A — validateFieldType                         */
/* ------------------------------------------------------------------ */

test('A1-A5: validateFieldType number handling (null, coercion, strict, NaN, boolean)', () => {
	assert.deepEqual(validateFieldType('f', null, 'number'), { valid: true });
	assert.deepEqual(validateFieldType('f', undefined, 'number'), { valid: true });
	assert.deepEqual(validateFieldType('f', '42', 'number'), { valid: true, newValue: 42 });
	assert.deepEqual(validateFieldType('f', '42', 'number', { strict: true }), {
		valid: false,
		errorMessage: "'f' expects a number but we got '42'",
	});
	assert.deepEqual(validateFieldType('f', 'A', 'number'), {
		valid: false,
		errorMessage: "'f' expects a number but we got 'A'",
	});
	assert.deepEqual(validateFieldType('f', true, 'number'), { valid: true, newValue: 1 });
});

test('A6-A8: validateFieldType boolean handling (truthy, falsy, invalid)', () => {
	for (const t of ['01', 'TRUE', 'true', 1]) {
		assert.deepEqual(validateFieldType('f', t, 'boolean'), { valid: true, newValue: true });
	}
	for (const f of ['000', 'FALSE', 'false', 0]) {
		assert.deepEqual(validateFieldType('f', f, 'boolean'), { valid: true, newValue: false });
	}
	for (const bad of ['yes', 2, -1, 'tru']) {
		const res = validateFieldType('f', bad, 'boolean');
		assert.equal(res.valid, false);
		assert.equal(res.errorMessage, `'f' expects a boolean but we got ${getValueDescription(bad)}`);
	}
});

test('A9-A12: validateFieldType string and alphanumeric', () => {
	assert.deepEqual(validateFieldType('f', 42, 'string'), { valid: true, newValue: 42 });
	assert.deepEqual(validateFieldType('f', 42, 'string', { parseStrings: true }), { valid: true, newValue: '42' });
	assert.deepEqual(validateFieldType('f', 42, 'string', { strict: true, parseStrings: true }), {
		valid: false,
		errorMessage: "'f' expects a string but we got '42'",
	});

	assert.equal(
		validateFieldType('f', '1abc', 'string-alphanumeric').errorMessage,
		'Value is not a valid alphanumeric string, only letters, numbers and underscore allowed',
	);
	assert.deepEqual(validateFieldType('f', 'abc_1', 'string-alphanumeric'), { valid: true, newValue: 'abc_1' });
});

test('A13-A16: validateFieldType dateTime and time (frozen quirks)', () => {
	const dt = validateFieldType('f', '1994-11-05T08:15:30-05:00', 'dateTime');
	assert.equal(dt.valid, true);

	const badDt = validateFieldType('f', 'not a date', 'dateTime');
	assert.equal(badDt.valid, false);
	assert.match(
		badDt.errorMessage,
		/^'f' expects a dateTime but we got 'not a date' <br\/><br\/> Consider using .*DateTime\.fromFormat/,
	);

	assert.deepEqual(validateFieldType('f', '23:23', 'time'), { valid: true, newValue: '23:23' });
	// Quirk: time validator accepts 25:99 because regex only tests shape hh:mm(:ss)
	assert.deepEqual(validateFieldType('f', '25:99', 'time'), { valid: true, newValue: '25:99' });
	assert.equal(
		validateFieldType('f', 'not a time', 'time').errorMessage,
		"'f' expects time (hh:mm:(:ss)) but we got 'not a time'.",
	);
});

test('A17-A20: validateFieldType options, binary, jwt', () => {
	const optRes = validateFieldType('f', 'x', 'options', {
		valueOptions: [
			{ name: 'a', value: 'a' },
			{ name: 'b', value: 'b' },
		],
	});
	assert.equal(optRes.errorMessage, "'f' expects one of the following values: [a, b] but we got 'x'");

	const binFail = validateFieldType('f', { data: 'x' }, 'binary');
	assert.equal(
		binFail.errorMessage,
		"'f' expects a binary but we got object. Make sure the value is a valid binary data object with 'mimeType' and 'data' or 'id' property.",
	);
	const binPass = validateFieldType('f', { mimeType: 'text/plain', id: '1' }, 'binary');
	assert.equal(binPass.valid, true);

	assert.equal(validateFieldType('f', 'nope', 'jwt').errorMessage, 'Value is not a valid JWT token');
});

test('A21-A24: validateFieldType object, array, unknown type', () => {
	assert.deepEqual(validateFieldType('f', '{a: 1}', 'object'), { valid: true, newValue: { a: 1 } });
	assert.deepEqual(validateFieldType('f', '{"a": 1}', 'object'), { valid: true, newValue: { a: 1 } });
	assert.deepEqual(validateFieldType('f', [], 'object', { strict: true }), {
		valid: false,
		errorMessage: "'f' expects a object but we got array",
	});

	assert.deepEqual(validateFieldType('f', '[1,2]', 'array'), { valid: true, newValue: [1, 2] });
	assert.deepEqual(validateFieldType('f', 'not an array', 'array'), {
		valid: false,
		errorMessage: "'f' expects a array but we got 'not an array'",
	});

	// Unknown type passes through
	assert.deepEqual(validateFieldType('f', 'x', 'whatever'), { valid: true, newValue: 'x' });
});

/* ------------------------------------------------------------------ */
/* Part 2: Golden Cases B — tryToParse*                               */
/* ------------------------------------------------------------------ */

test('B1-B6: tryToParse* basic parsing and ApplicationError throws', () => {
	const throwsAppErr = (fn, msg) => {
		assert.throws(
			fn,
			(e) => e.constructor.name === 'ApplicationError' && e.message === msg,
			`expected ApplicationError with message "${msg}"`,
		);
	};

	throwsAppErr(() => tryToParseNumber('A'), 'Failed to parse value to number');
	assert.equal(tryToParseNumber('123'), 123);

	throwsAppErr(() => tryToParseBoolean('yes'), 'Failed to parse value as boolean');
	assert.equal(tryToParseBoolean('true'), true);
	assert.equal(tryToParseBoolean('0'), false);

	throwsAppErr(() => tryToParseArray('{"a":1}'), 'Value is not a valid array');
	assert.deepEqual(tryToParseArray('[1, 2]'), [1, 2]);

	throwsAppErr(() => tryToParseObject('[1]'), 'Value is not a valid object');
	assert.deepEqual(tryToParseObject('{a: 1}'), { a: 1 });
});

test('B7-B9: tryToParseUrl, tryToParseJwt, tryToParseJsonToFormFields', () => {
	const throwsAppErr = (fn, msg) => {
		assert.throws(fn, (e) => e.constructor.name === 'ApplicationError' && e.message === msg);
	};

	throwsAppErr(() => tryToParseUrl('not a url'), 'The value "https://not a url" is not a valid url.');
	assert.equal(tryToParseUrl('example.com/x'), 'https://example.com/x');
	throwsAppErr(() => tryToParseUrl('javascript://x'), 'The value "javascript://x" is not a valid url.');
	assert.equal(tryToParseUrl('ftp://example.com'), 'ftp://example.com');

	throwsAppErr(() => tryToParseJwt(''), 'The value "" is not a valid JWT token.');
	assert.equal(
		tryToParseJwt('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotVerifySig'),
		'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotVerifySig',
	);

	throwsAppErr(() => tryToParseJsonToFormFields('not json'), 'Value is not valid JSON');
	assert.deepEqual(
		tryToParseJsonToFormFields('[{"fieldLabel": "Name", "fieldType": "text"}]'),
		[{ fieldLabel: 'Name', fieldType: 'text' }],
	);
});

test('B3-B4: tryToParseDateTime timezone handling', () => {
	const d1 = tryToParseDateTime('2018-05-16', 'America/New_York');
	assert.equal(d1.zoneName, 'America/New_York');

	const d2 = tryToParseDateTime('1994-11-05T08:15:30-05:00', 'UTC');
	assert.equal(d2.offset, -300); // Explicit -05:00 in input overrides defaultZone
});

test('B10: getValueDescription formatting', () => {
	assert.deepEqual(
		[
			getValueDescription('s'),
			getValueDescription([1]),
			getValueDescription({ a: 1 }),
			getValueDescription(1),
			getValueDescription(null),
		],
		["'s'", 'array', 'object', "'1'", "'null'"],
	);
});

/* ------------------------------------------------------------------ */
/* Part 3: Golden Cases C — Type Guards & Schemas                     */
/* ------------------------------------------------------------------ */

test('C1-C3: Type guards (connection type, binary, resource locator)', () => {
	assert.deepEqual(
		[isNodeConnectionType('main'), isNodeConnectionType('ai_tool'), isNodeConnectionType('nope')],
		[true, true, false],
	);
	assert.deepEqual(
		[isBinaryValue({ mimeType: 'a', id: '1' }), isBinaryValue({ mimeType: 'a' })],
		[true, false],
	);
	assert.equal(isResourceLocatorValue({ __rl: true, mode: 'id', value: '1' }), true);
	assert.equal(isResourceLocatorValue({ mode: 'id', value: '1' }), false);
});

test('C4-C6: Zod schemas (INodeParametersSchema, NodeConnectionTypeSchema)', () => {
	assert.equal(
		INodeParametersSchema.safeParse({
			a: 1,
			b: 'x',
			c: { __rl: true, mode: 'id', value: '1' },
		}).success,
		true,
	);
	assert.equal(INodeParametersSchema.safeParse('nope').success, false);

	const r = NodeConnectionTypeSchema.safeParse('bogus');
	assert.equal(r.success, false);
	assert.equal(r.error?.issues[0]?.code, 'invalid_enum_value');

	assert.equal(NodeConnectionTypeSchema.safeParse('main').success, true);
	assert.equal(NodeConnectionTypeSchema.safeParse('ai_chain').success, true);
});

/* ------------------------------------------------------------------ */
/* Part 4: Golden Cases D — Rule Enforcement                          */
/* ------------------------------------------------------------------ */

test('D1-D2: Reference golden workflows are structurally valid', () => {
	const empty = loadRefWorkflow('01-empty-workflow');
	const resEmpty = validateWorkflow(empty);
	assert.equal(resEmpty.valid, true);
	assert.deepEqual(resEmpty.errors, []);

	const linear = loadRefWorkflow('03-linear');
	const resLinear = validateWorkflow(linear);
	assert.equal(resLinear.valid, true);
	assert.deepEqual(resLinear.errors, []);
});

test('D3/D9: NodeUniqueness detects duplicate names even on disabled nodes', () => {
	const wf = {
		nodes: [
			{ name: 'Code' },
			{ name: 'Code', disabled: true },
		],
		connections: {},
	};
	const res = validateWorkflow(wf);
	assert.equal(res.valid, false);
	assert.equal(res.errors.length, 1);
	assert.equal(res.errors[0].code, 'DUPLICATE_NODE_NAME');
	assert.equal(res.errors[0].node, 'Code');
	assert.equal(res.errors[0].message, 'Duplicate node name "Code"');
});

test('D4-D5: DanglingConnections and INVALID_CONNECTION_TYPE detection', () => {
	const dangling = {
		nodes: [{ name: 'Trigger' }],
		connections: {
			Trigger: {
				main: [[{ node: 'Ghost', type: 'main', index: 0 }]],
			},
		},
	};
	const resDangling = validateWorkflow(dangling);
	assert.equal(resDangling.valid, false);
	assert.equal(resDangling.errors[0].code, 'DANGLING_CONNECTION');
	assert.equal(resDangling.errors[0].message, 'Connection from "Trigger" to unknown node "Ghost"');

	const invalidType = {
		nodes: [{ name: 'A' }, { name: 'B' }],
		connections: {
			A: {
				foo: [[{ node: 'B', type: 'main', index: 0 }]],
			},
		},
	};
	const resType = validateWorkflow(invalidType);
	assert.equal(resType.valid, false);
	assert.equal(resType.errors[0].code, 'INVALID_CONNECTION_TYPE');
});

test('D6-D8: CycleDetection is opt-in, main-only, deterministic', () => {
	const cyclic = {
		nodes: [{ name: 'A' }, { name: 'B' }],
		connections: {
			A: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
			B: { main: [[{ node: 'A', type: 'main', index: 0 }]] },
		},
	};

	// Default allowCycles: true matches reference parity (runtime loops allowed)
	assert.equal(validateWorkflow(cyclic).valid, true);

	// Strict cycle check with allowCycles: false
	const resStrict = validateWorkflow(cyclic, { allowCycles: false });
	assert.equal(resStrict.valid, false);
	assert.equal(resStrict.errors[0].code, 'CYCLE_DETECTED');
	assert.equal(resStrict.errors[0].message, 'Cycle detected: A → B → A');

	// Non-main edges (e.g. ai_tool) are ignored for cycle detection
	const cyclicNonMain = {
		nodes: [{ name: 'A' }, { name: 'B' }],
		connections: {
			A: { ai_tool: [[{ node: 'B', type: 'ai_tool', index: 0 }]] },
			B: { ai_tool: [[{ node: 'A', type: 'ai_tool', index: 0 }]] },
		},
	};
	assert.equal(validateWorkflow(cyclicNonMain, { allowCycles: false }).valid, true);
});

test('D10 & Immutability: Malformed input never throws and input is not mutated', () => {
	assert.deepEqual(validateWorkflow('garbage'), {
		valid: false,
		errors: [{ code: 'INVALID_INPUT', message: 'Workflow must be an object with a `nodes` array of named nodes' }],
	});
	assert.deepEqual(validateWorkflow(null), {
		valid: false,
		errors: [{ code: 'INVALID_INPUT', message: 'Workflow must be an object with a `nodes` array of named nodes' }],
	});

	const original = {
		nodes: [{ name: 'A' }, { name: 'B' }],
		connections: { A: { main: [[{ node: 'B', type: 'main', index: 0 }]] } },
	};
	const snapshot = JSON.stringify(original);
	validateWorkflow(original, { allowCycles: false });
	assert.equal(JSON.stringify(original), snapshot, 'validation must not mutate input object');
});

/* ------------------------------------------------------------------ */
/* Part 5: Differential Parity with Reference Runtime                 */
/* ------------------------------------------------------------------ */

test('Parity: differential parity against reference n8n-workflow', (t) => {
	if (!refWorkflow) {
		t.skip('Reference n8n-workflow not found for differential testing');
		return;
	}

	// 1. validateFieldType parity on standard cases
	const testInputs = [
		['num', '42', 'number'],
		['bool', 'TRUE', 'boolean'],
		['str', 100, 'string', { parseStrings: true }],
		['alpha', 'test_123', 'string-alphanumeric'],
		['time', '12:30:00', 'time'],
		['obj', '{"k": 1}', 'object'],
		['arr', '[1, 2, 3]', 'array'],
	];
	for (const [field, val, type, opts] of testInputs) {
		const reconstructedRes = validateFieldType(field, val, type, opts);
		const referenceRes = refWorkflow.validateFieldType(field, val, type, opts);
		assert.deepEqual(reconstructedRes, referenceRes, `parity mismatch on ${field}:${type}`);
	}

	// 2. getValueDescription parity
	for (const sample of ['abc', 123, true, null, undefined, [1, 2], { a: 1 }]) {
		assert.equal(
			getValueDescription(sample),
			refWorkflow.getValueDescription(sample),
			`getValueDescription mismatch on ${sample}`,
		);
	}

	// 3. Type guards parity
	for (const type of ['main', 'ai_chain', 'ai_tool', 'unknown_type']) {
		assert.equal(
			isNodeConnectionType(type),
			refWorkflow.isNodeConnectionType(type),
			`isNodeConnectionType mismatch on ${type}`,
		);
	}
});

/* ------------------------------------------------------------------ */
/* Part 6: Negative Controls                                          */
/* ------------------------------------------------------------------ */

test('Negative control 1: Flawed validator accepting invalid boolean must fail', () => {
	// A flawed validator that coerces 'invalid' to true or valid: true
	const flawedValidator = (val) => ({ valid: val === 'true' || val === true || val === 'yes' });
	// Proving the oracle rejects it
	const result = validateFieldType('f', 'yes', 'boolean');
	assert.equal(result.valid, false, 'Reference oracle rejects "yes" as a boolean');
	assert.notEqual(result.valid, flawedValidator('yes').valid);
});

test('Negative control 2: Permissive cycle check must fail when allowCycles=false', () => {
	const cyclicWf = {
		nodes: [{ name: 'A' }, { name: 'B' }],
		connections: {
			A: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
			B: { main: [[{ node: 'A', type: 'main', index: 0 }]] },
		},
	};
	// A naive checker that always returns valid
	const naiveChecker = () => ({ valid: true, errors: [] });
	const realResult = validateWorkflow(cyclicWf, { allowCycles: false });
	assert.equal(realResult.valid, false);
	assert.notEqual(realResult.valid, naiveChecker().valid);
});
