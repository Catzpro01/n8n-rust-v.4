import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DataProxyDateTime,
	ExpressionError,
	evaluateCode,
	evaluateExpressionValue,
} from '../src/index.mjs';

const scope = {
	$json: { value: 4, nested: { label: 'safe' }, items: [3, 1, 2] },
	$input: { all: () => [{ json: { id: 1 } }, { json: { id: 2 } }] },
};

test('evaluates ordinary expressions and preserves typed single-expression values', () => {
	assert.equal(evaluateExpressionValue('={{ $json.value + 2 }}', scope), 6);
	assert.deepEqual(
		evaluateExpressionValue('={{ $input.all().map(item => item.json.id) }}', scope),
		[1, 2],
	);
	assert.deepEqual(evaluateCode('Object.keys($json.nested)', scope), ['label']);
});

test('handles multiple template expressions and uses JavaScript string coercion', () => {
	assert.equal(evaluateExpressionValue('={{ $json.value }}-{{ $json.nested.label }}', scope), '4-safe');
	assert.equal(evaluateExpressionValue('=object={{ $json.nested }}', scope), 'object=[object Object]');
});

test('denies Node.js globals and dynamic code generation', () => {
	for (const expression of [
		'process.env.SECRET',
		'globalThis.process',
		'Function("return process")()',
		'eval("1 + 1")',
		'require("node:fs")',
	]) {
		assert.throws(
			() => evaluateCode(expression, scope),
			(error) => error instanceof ExpressionError && error.code === 'EXPRESSION_SANDBOX_DENIED',
		);
	}
});

test('blocks direct, quoted, and dynamically computed prototype access', () => {
	assert.throws(() => evaluateCode('$json.constructor.constructor("return process")()', scope), ExpressionError);
	assert.throws(() => evaluateCode('$json["constructor"]', scope), ExpressionError);
	assert.throws(
		() => evaluateCode('$json[$json.nested.label.replace("safe", "constructor")]', scope),
		(error) => error instanceof ExpressionError && /(denied|prototype access)/.test(error.message),
	);
	assert.equal(evaluateCode('Object.getPrototypeOf($json)', scope), null);
	assert.throws(
		() => evaluateCode(
			'Object.getOwnPropertyDescriptor($fn, Reflect.ownKeys($fn).find(key => key.startsWith("proto")))',
			{ $fn: function exposedFunction() {} },
		),
		/denied/,
	);
});

test('execution data is read-only, including mutating collection methods', () => {
	const data = { list: [1, 2], nested: { value: 1 } };
	assert.throws(() => evaluateCode('$json.list.push(3)', { $json: data }), /cannot mutate/);
	assert.throws(() => evaluateCode('Object.assign($json.nested, { value: 2 })', { $json: data }), /cannot mutate/);
	assert.deepEqual(data, { list: [1, 2], nested: { value: 1 } });
});

test('terminates runaway synchronous expressions', () => {
	assert.throws(
		() => evaluateCode('(() => { while (true) {} })()', scope, { timeoutMs: 10 }),
		(error) => error instanceof ExpressionError && error.code === 'EXPRESSION_SANDBOX_TIMEOUT',
	);
});

test('keeps explicitly exposed DateTime methods available through the membrane', () => {
	const now = new DataProxyDateTime('2026-09-17T12:34:56.789Z');
	assert.equal(evaluateCode('$now.toISO()', { $now: now }), '2026-09-17T12:34:56.789Z');
	assert.equal(evaluateCode('$now.toFormat("yyyy-MM-dd HH:mm:ss")', { $now: now }), '2026-09-17 12:34:56');
});
