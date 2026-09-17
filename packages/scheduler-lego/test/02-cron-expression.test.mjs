import assert from 'node:assert/strict';
import test from 'node:test';

import { toCronExpression } from '../src/cron-expression.mjs';

/**
 * Field-wise assertion for a 6-field (seconds-precision) cron expression.
 * `null` means "a random integer in [0,60)" (S-03 / S-04); anything else must
 * match exactly. Masking every digit instead would hide the fixed fields.
 */
function assertCron(expression, expected) {
	const parts = expression.split(' ');
	assert.equal(parts.length, 6, `expected 6 fields, got ${parts.length}: ${expression}`);
	parts.forEach((actual, index) => {
		const want = expected[index];
		if (want === null) {
			assert.match(actual, /^\d{1,2}$/, `field ${index} should be a random integer, got "${actual}"`);
			const value = Number(actual);
			assert.ok(value >= 0 && value < 60, `field ${index} out of [0,60): ${value}`);
		} else {
			assert.equal(actual, want, `field ${index}`);
		}
	});
}

test('everyMinute -> "<sec> * * * * *"', () => {
	assertCron(toCronExpression({ mode: 'everyMinute' }), [null, '*', '*', '*', '*', '*']);
});

test('everyHour -> "<sec> <minute> * * * *"', () => {
	assertCron(toCronExpression({ mode: 'everyHour', minute: 42 }), [null, '42', '*', '*', '*', '*']);
});

test('everyX + minutes randomises ONLY the seconds field', () => {
	assertCron(toCronExpression({ mode: 'everyX', unit: 'minutes', value: 5 }), [
		null,
		'*/5',
		'*',
		'*',
		'*',
		'*',
	]);
});

test('S-04: everyX + hours randomises BOTH seconds and minutes', () => {
	assertCron(toCronExpression({ mode: 'everyX', unit: 'hours', value: 3 }), [
		null,
		null,
		'*/3',
		'*',
		'*',
		'*',
	]);
});

test('everyDay / everyWeek / everyMonth carry the fixed fields through', () => {
	assertCron(toCronExpression({ mode: 'everyDay', hour: 7, minute: 15 }), [
		null,
		'15',
		'7',
		'*',
		'*',
		'*',
	]);
	assertCron(toCronExpression({ mode: 'everyWeek', hour: 7, minute: 15, weekday: 3 }), [
		null,
		'15',
		'7',
		'*',
		'*',
		'3',
	]);
	assertCron(toCronExpression({ mode: 'everyMonth', hour: 7, minute: 15, dayOfMonth: 28 }), [
		null,
		'15',
		'7',
		'28',
		'*',
		'*',
	]);
});

test('S-06: custom is trimmed but never validated here', () => {
	const padded = '  */30 * * * * *  ';
	assert.equal(toCronExpression({ mode: 'custom', cronExpression: padded }), padded.trim());
	assert.equal(
		toCronExpression({ mode: 'custom', cronExpression: 'not a cron at all' }),
		'not a cron at all',
		'syntax is the cron package business, not this LEGO',
	);
});

test('S-03: the seconds field really is random across calls, and stays in range', () => {
	const seen = new Set();
	for (let i = 0; i < 300; i++) {
		const expression = toCronExpression({ mode: 'everyMinute' });
		assertCron(expression, [null, '*', '*', '*', '*', '*']);
		seen.add(expression);
	}
	assert.ok(seen.size > 20, `expected many distinct seconds, got ${seen.size}`);
});

test('S-03: a random second is drawn even for `custom`, then discarded', () => {
	// The draw happens before any mode check. It is unobservable through the
	// return value, so this pins the control flow rather than the output.
	assert.doesNotThrow(() => toCronExpression({ mode: 'custom', cronExpression: '0 0 1 1 *' }));
	const source = toCronExpression.toString();
	assert.ok(
		source.indexOf('randomInt(60)') < source.indexOf("item.mode === 'everyMinute'"),
		'the random draw must precede the mode dispatch',
	);
});

test('S-05: everyX with an unknown unit falls through and crashes on .trim()', () => {
	assert.throws(() => toCronExpression({ mode: 'everyX', unit: 'fortnights', value: 2 }), TypeError);
});
