/**
 * POOL-004 · Suite 02 — @n8n/db trivial utils (separate / is-string-array / sql / get-final-test-result)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { separate } from '../src/utils/separate.mjs';
import { isStringArray } from '../src/utils/is-string-array.mjs';
import { sql } from '../src/utils/sql.mjs';
import { getTestRunFinalResult } from '../src/utils/get-final-test-result.mjs';

test('separate: partitions into [pass, fail], order preserved', () => {
	const [pass, fail] = separate([1, 2, 3, 4, 5, 6], (n) => n % 2 === 0);
	assert.deepEqual(pass, [2, 4, 6]);
	assert.deepEqual(fail, [1, 3, 5]);
	assert.deepEqual(separate([], () => true), [[], []]);
});

test('isStringArray', () => {
	assert.equal(isStringArray(['a', 'b']), true);
	assert.equal(isStringArray([]), true);
	assert.equal(isStringArray(['a', 1]), false);
	assert.equal(isStringArray('ab'), false);
	assert.equal(isStringArray(null), false);
});

test('sql: interleaves template strings with values', () => {
	const table = 'workflow';
	const col = 'id';
	assert.deepEqual(sql`SELECT ${col} FROM ${table} WHERE x = 1`, 'SELECT id FROM workflow WHERE x = 1');
	assert.deepEqual(sql`plain`, 'plain');
});

test('getTestRunFinalResult: severity error > warning > success', () => {
	const t = (status) => ({ status });
	assert.equal(getTestRunFinalResult([]), 'success');
	assert.equal(getTestRunFinalResult([t('success'), t('success')]), 'success');
	assert.equal(getTestRunFinalResult([t('success'), t('warning')]), 'warning');
	assert.equal(getTestRunFinalResult([t('warning'), t('error'), t('success')]), 'error');
	assert.equal(getTestRunFinalResult([t('error'), t('warning')]), 'error');
	// statuses outside ['error','warning'] never influence the result (reference filter)
	assert.equal(getTestRunFinalResult([t('new'), t('crashed'), t('success')]), 'success');
});
