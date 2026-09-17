/**
 * Conformance suite for the filter-EXECUTION half plus the webhook-path helpers and
 * `cronNodeOptions` (slice 4 of the Node LEGO).
 *
 * Oracles: `test/filter-parameter.test.ts` (`FilterParameter` L32: combinators L34, case
 * sensitivity L60/L84, version handling L236-275, type errors L111-241, `arrayContainsValue`
 * L1329-1359) and `test/node-helpers.test.ts` (`getNodeWebhookPath` L6211).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	arrayContainsValue,
	cronNodeOptions,
	executeFilter,
	executeFilterCondition,
	FilterError,
	getNodeWebhookPath,
	getNodeWebhookUrl,
} from '../src/index.mjs';

/** filterFactory equivalent of the reference oracle helper. */
const filter = (conditions, options = {}, combinator = 'and') => ({
	options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2, ...options },
	conditions,
	combinator,
});

const condition = (type, operation, leftValue, rightValue, extra = {}) => ({
	operator: { type, operation, ...extra },
	leftValue,
	rightValue,
});

test('executeFilter: and/or combinators (oracle filter-parameter.test.ts L34)', () => {
	const falseCondition = condition('string', 'equals', 'foo', 'bar');
	const trueCondition = condition('string', 'equals', 'foo', 'foo');

	assert.equal(executeFilter(filter([falseCondition, trueCondition], {}, 'and')), false);
	assert.equal(executeFilter(filter([falseCondition, trueCondition], {}, 'or')), true);
	assert.equal(executeFilter(filter([trueCondition, trueCondition], {}, 'and')), true);
	assert.equal(executeFilter(filter([falseCondition], {}, 'or')), false);
	// empty condition lists short-circuit through every()/some()
	assert.equal(executeFilter(filter([], {}, 'and')), true);
	assert.equal(executeFilter(filter([], {}, 'or')), false);
});

test('executeFilter: unknown combinator warns through the injected logger and returns false (DELTA-06)', () => {
	const warnings = [];
	const value = { ...filter([condition('string', 'equals', 'a', 'a')]), combinator: 'xor' };
	assert.equal(executeFilter(value, { logger: { warn: (message) => warnings.push(message) } }), false);
	assert.deepEqual(warnings, ['Unknown filter combinator "xor"']);
	// the default logger is a no-op
	assert.equal(executeFilter(value), false);
});

test('executeFilterCondition: case sensitivity (oracle L60/L84)', () => {
	const equals = condition('string', 'equals', 'A', 'a');
	assert.equal(executeFilterCondition(equals, { caseSensitive: true, typeValidation: 'loose', version: 2 }), false);
	assert.equal(executeFilterCondition(equals, { caseSensitive: false, typeValidation: 'loose', version: 2 }), true);
});

test('executeFilterCondition: boolean version handling parses "false" differently (oracle L241/L261)', () => {
	// version 1: Boolean('false') === true, so `true === false` is false
	assert.equal(
		executeFilter(filter([condition('boolean', 'equals', 'false', false)], { version: 1 })),
		false,
	);
	// version 2: tryToParseBoolean('false') === false, so the comparison matches
	assert.equal(
		executeFilter(filter([condition('boolean', 'equals', 'false', false)], { version: 2 })),
		true,
	);
	assert.equal(executeFilter(filter([condition('boolean', 'true', true, '')])), true);
	assert.equal(executeFilter(filter([condition('boolean', 'false', false, '')])), true);
});

test('executeFilterCondition: string operators incl. regex literals with flags', () => {
	const run = (operation, left, right) =>
		executeFilterCondition(condition('string', operation, left, right), {
			caseSensitive: true, typeValidation: 'loose', version: 2,
		});

	assert.equal(run('empty', '', ''), true);
	assert.equal(run('notEmpty', 'x', ''), true);
	assert.equal(run('contains', 'hello world', 'world'), true);
	assert.equal(run('notContains', 'hello', 'zz'), true);
	assert.equal(run('startsWith', 'hello', 'he'), true);
	assert.equal(run('notStartsWith', 'hello', 'xx'), true);
	assert.equal(run('endsWith', 'hello', 'lo'), true);
	assert.equal(run('notEndsWith', 'hello', 'xx'), true);
	assert.equal(run('equals', 'a', 'a'), true);
	assert.equal(run('notEquals', 'a', 'b'), true);
	// parseRegexPattern: `/pattern/flags` literals are honoured, plain patterns are raw regexes
	assert.equal(run('regex', 'ABC', '/abc/i'), true);
	assert.equal(run('regex', 'abc123', '/^abc\\d+$/'), true);
	assert.equal(run('regex', 'abc123', 'abc'), true);
	assert.equal(run('notRegex', 'abc', '/[0-9]+/'), true);
});

test('executeFilterCondition: number, array and object operators', () => {
	const run = (type, operation, left, right, extra = {}, ignoreCase = true) =>
		executeFilterCondition(condition(type, operation, left, right, extra), {
			caseSensitive: ignoreCase, typeValidation: 'loose', version: 2,
		});

	assert.equal(run('number', 'equals', 5, 5), true);
	assert.equal(run('number', 'gt', 5, 3), true);
	assert.equal(run('number', 'gte', 3, 3), true);
	assert.equal(run('number', 'lt', 2, 3), true);
	assert.equal(run('number', 'lte', 3, 3), true);
	assert.equal(run('number', 'empty', null, 1), true);
	assert.equal(run('number', 'notEmpty', 1, 1), true);

	// length operations take a number on the right (operator.rightType)
	assert.equal(run('array', 'lengthEquals', [1, 2], 2, { rightType: 'number' }), true);
	assert.equal(run('array', 'lengthGt', [1, 2], 3, { rightType: 'number' }), false);
	assert.equal(run('array', 'lengthGte', [1, 2], 2, { rightType: 'number' }), true);
	assert.equal(run('array', 'empty', [], 1, { rightType: 'number' }), true);
	assert.equal(run('array', 'notEmpty', [1], 1, { rightType: 'number' }), true);
	assert.equal(
		run('array', 'contains', ['A'], 'a', { rightType: 'string' }, false),
		true,
		'ignoreCase is applied to array membership',
	);
	assert.equal(run('array', 'contains', ['A'], 'a', { rightType: 'string' }, true), false);

	// the reference filter operators mark empty/notEmpty as singleValue, so the right side is
	// not parsed at all
	assert.equal(run('object', 'empty', {}, '', { singleValue: true }), true);
	assert.equal(run('object', 'notEmpty', { a: 1 }, '', { singleValue: true }), true);
	assert.equal(run('object', 'empty', { a: 1 }, '', { singleValue: true }), false);
});

test('executeFilterCondition: exists / notExists short-circuit before the type switch', () => {
	const run = (operation, left) =>
		executeFilterCondition(condition('string', operation, left, ''), {
			caseSensitive: true, typeValidation: 'loose', version: 2,
		});
	assert.equal(run('exists', 'x'), true);
	assert.equal(run('exists', null), false);
	assert.equal(run('exists', undefined), false);
	// pinned: the left value is parsed *before* the exists check, so NaN becomes the string
	// 'NaN' for a string condition and `Number.isNaN('NaN')` is false — the field "exists"
	assert.equal(run('exists', NaN), true);
	assert.equal(run('notExists', undefined), true);
	assert.equal(run('notExists', 'x'), false);
});

test('executeFilterCondition: unknown operators warn and return false; type errors throw FilterError', () => {
	const warnings = [];
	const metadata = { logger: { warn: (message) => warnings.push(message) } };
	assert.equal(
		executeFilterCondition(condition('string', 'nope', 'a', 'a'), { caseSensitive: true, typeValidation: 'loose', version: 2 }, metadata),
		false,
	);
	assert.deepEqual(warnings, ['Unknown filter parameter operator "string:nope"']);

	// strict type mismatch (oracle L111)
	assert.throws(
		() => executeFilter(filter([condition('number', 'equals', 'nope', 1)], { typeValidation: 'strict' })),
		(error) => {
			assert.ok(error instanceof FilterError);
			assert.equal(error.name, 'Error', 'DELTA-03: ApplicationError never sets name');
			assert.equal(error.level, 'warning');
			assert.equal(error.message, "Wrong type: 'nope' is a string but was expecting a number [condition 0, item 0]");
			assert.match(error.description, /Convert types where required/);
			return true;
		},
	);

	// both sides un-convertible (oracle L216)
	assert.throws(
		() => executeFilter(filter([condition('number', 'equals', 'nope', 'also nope')])),
		(error) => {
			assert.equal(error.message, 'Comparison type expects a number but both fields are a string');
			assert.equal(error.description, 'Try changing the type of the comparison.');
			return true;
		},
	);
});

test('arrayContainsValue: case handling (oracle filter-parameter.test.ts L1329-1359)', () => {
	assert.equal(arrayContainsValue(['a', 'b'], 'a', false), true);
	assert.equal(arrayContainsValue(['a', 'b'], 'c', false), false);
	assert.equal(arrayContainsValue(['A'], 'a', true), true);
	assert.equal(arrayContainsValue(['A'], 'a', false), false);
	assert.equal(arrayContainsValue([1, 2], 1, true), true);
	// ignoreCase only applies to string needles
	assert.equal(arrayContainsValue([1, 2], '1', true), false);
	assert.equal(arrayContainsValue([], 'a', true), false);
});

test('getNodeWebhookPath / getNodeWebhookUrl (oracle node-helpers.test.ts L6211)', () => {
	const node = (extra = {}) => ({ name: 'TestNode', type: 'n8n-nodes-base.webhook', parameters: {}, ...extra });

	// restartWebhook short-circuits
	assert.equal(getNodeWebhookPath('workflow-123', node(), 'test-path', false, true), 'test-path');
	// webhookId + isFullPath
	assert.equal(getNodeWebhookPath('workflow-123', node({ webhookId: 'webhook-456' }), 'test-path', true, false), 'test-path');
	assert.equal(getNodeWebhookPath('workflow-123', node({ webhookId: 'webhook-456' }), '', true, false), 'webhook-456');
	assert.equal(getNodeWebhookPath('workflow-123', node({ webhookId: 'webhook-456' }), 'test-path', false, false), 'webhook-456/test-path');
	// no webhookId: workflowId/lower-cased-name/path
	assert.equal(getNodeWebhookPath('workflow-123', node(), 'test-path'), 'workflow-123/testnode/test-path');
	assert.equal(getNodeWebhookPath('workflow-123', { name: 'My Node' }, 'hook'), 'workflow-123/my%20node/hook');

	// URL helper: dynamic paths keep the webhookId prefix, leading slashes are stripped
	assert.equal(getNodeWebhookUrl('https://base', 'workflow-123', node(), 'hook'), 'https://base/workflow-123/testnode/hook');
	assert.equal(getNodeWebhookUrl('https://base', 'workflow-123', node(), '/hook'), 'https://base/workflow-123/testnode/hook');
	assert.equal(
		getNodeWebhookUrl('https://base', 'workflow-123', node({ webhookId: 'wh1' }), ':id', true),
		'https://base/wh1/:id',
	);
	assert.equal(
		getNodeWebhookUrl('https://base', 'workflow-123', node({ webhookId: 'wh1' }), 'x/:id'),
		'https://base/wh1/x/:id',
	);
});

test('cronNodeOptions: the Schedule Trigger property collection is complete', () => {
	assert.equal(cronNodeOptions.length, 1);
	const [item] = cronNodeOptions;
	assert.equal(item.name, 'item');
	assert.equal(item.displayName, 'Item');
	const mode = item.values.find((value) => value.name === 'mode');
	assert.deepEqual(
		mode.options.map((option) => option.value),
		['everyMinute', 'everyHour', 'everyDay', 'everyWeek', 'everyMonth', 'everyX', 'custom'],
	);
	assert.equal(mode.default, 'everyDay');
	// the literal is pure data — every entry keeps the reference shape
	for (const value of item.values) {
		assert.equal(typeof value.name, 'string');
		assert.equal(typeof value.displayName, 'string');
	}
	assert.deepEqual(
		item.values.map((value) => value.name),
		['mode', 'hour', 'minute', 'dayOfMonth', 'weekday', 'cronExpression', 'value', 'unit'],
	);
});
