import test from 'node:test';
import assert from 'node:assert/strict';

import {
	RETRY_LIMITS,
	isErrorItem,
	normalizeOutputItems,
	resolveErrorOutcome,
	resolveRetryPolicy,
	runWithRetry,
	splitErrorOutput,
	toExecutionError,
} from '../src/error-recovery-policy.ts';

const noSleep = async () => {};
const recordedSleep = () => {
	const waits = [];
	const sleep = async (ms) => {
		waits.push(ms);
	};
	return { waits, sleep };
};

test('resolveRetryPolicy: tanpa retryOnFail -> 1 percobaan, tanpa jeda (L1600-L1601)', () => {
	assert.deepEqual(resolveRetryPolicy({}), { maxTries: 1, waitBetweenTries: 0 });
	assert.deepEqual(resolveRetryPolicy(undefined), { maxTries: 1, waitBetweenTries: 0 });
	assert.deepEqual(resolveRetryPolicy({ retryOnFail: false, maxTries: 9 }), {
		maxTries: 1,
		waitBetweenTries: 0,
	});
});

test('resolveRetryPolicy: retryOnFail -> default 3x / 1000ms (L1602-L1604, L1608-L1612)', () => {
	assert.deepEqual(resolveRetryPolicy({ retryOnFail: true }), {
		maxTries: 3,
		waitBetweenTries: 1000,
	});
});

test('resolveRetryPolicy: clamp maxTries ke [2,5] dan wait ke [0,5000]', () => {
	assert.equal(resolveRetryPolicy({ retryOnFail: true, maxTries: 99 }).maxTries, RETRY_LIMITS.MAX_TRIES);
	assert.equal(resolveRetryPolicy({ retryOnFail: true, maxTries: 1 }).maxTries, RETRY_LIMITS.MIN_TRIES);
	assert.equal(resolveRetryPolicy({ retryOnFail: true, maxTries: -4 }).maxTries, RETRY_LIMITS.MIN_TRIES);
	assert.equal(
		resolveRetryPolicy({ retryOnFail: true, waitBetweenTries: 60000 }).waitBetweenTries,
		RETRY_LIMITS.MAX_WAIT_MS,
	);
	assert.equal(
		resolveRetryPolicy({ retryOnFail: true, waitBetweenTries: -1 }).waitBetweenTries,
		RETRY_LIMITS.MIN_WAIT_MS,
	);
});

test('resolveRetryPolicy: 0 (falsy) jatuh ke default karena operator || di source', () => {
	assert.equal(resolveRetryPolicy({ retryOnFail: true, maxTries: 0 }).maxTries, RETRY_LIMITS.DEFAULT_TRIES);
	assert.equal(
		resolveRetryPolicy({ retryOnFail: true, waitBetweenTries: 0 }).waitBetweenTries,
		RETRY_LIMITS.DEFAULT_WAIT_MS,
	);
});

test('resolveErrorOutcome: default n8n adalah stopWorkflow', () => {
	assert.equal(resolveErrorOutcome({}), 'stop-workflow');
	assert.equal(resolveErrorOutcome({ onError: 'stopWorkflow' }), 'stop-workflow');
	assert.equal(resolveErrorOutcome(undefined), 'stop-workflow');
});

test('resolveErrorOutcome: continueOnFail / onError dihormati (L1839-L1846)', () => {
	assert.equal(resolveErrorOutcome({ continueOnFail: true }), 'continue-regular-output');
	assert.equal(resolveErrorOutcome({ onError: 'continueRegularOutput' }), 'continue-regular-output');
	assert.equal(resolveErrorOutcome({ onError: 'continueErrorOutput' }), 'continue-error-output');
	// continueOnFail menang untuk arah output walau onError = stopWorkflow
	assert.equal(
		resolveErrorOutcome({ continueOnFail: true, onError: 'stopWorkflow' }),
		'continue-regular-output',
	);
});

test('toExecutionError: mempertahankan field n8n dan menormalisasi message/stack (L1811)', () => {
	const source = Object.assign(new Error('boom'), { description: 'HTTP 502', httpCode: '502' });
	const normalized = toExecutionError(source);
	assert.equal(normalized.message, 'boom');
	assert.equal(normalized.description, 'HTTP 502');
	assert.equal(normalized.httpCode, '502');
	assert.equal(normalized.stack, source.stack);

	assert.equal(toExecutionError('plain string').message, 'plain string');
});

test('runWithRetry: sukses percobaan pertama -> 1 attempt, tanpa jeda', async () => {
	const { waits, sleep } = recordedSleep();
	let calls = 0;
	const outcome = await runWithRetry(
		async () => {
			calls++;
			return [[{ json: { ok: true } }]];
		},
		resolveRetryPolicy({ retryOnFail: true }),
		{ sleep },
	);
	assert.equal(outcome.status, 'success');
	assert.equal(outcome.tries, 1);
	assert.equal(calls, 1);
	assert.deepEqual(waits, []);
});

test('runWithRetry: gagal 2x lalu sukses -> 3 attempt, jeda hanya antar percobaan', async () => {
	const { waits, sleep } = recordedSleep();
	let calls = 0;
	const outcome = await runWithRetry(
		async () => {
			calls++;
			if (calls < 3) throw new Error(`fail ${calls}`);
			return [[{ json: { ok: true } }]];
		},
		resolveRetryPolicy({ retryOnFail: true, waitBetweenTries: 250 }),
		{ sleep },
	);
	assert.equal(outcome.status, 'success');
	assert.equal(outcome.tries, 3);
	assert.deepEqual(waits, [250, 250]);
	assert.equal(outcome.attempts[0].waitedMs, 0);
	assert.equal(outcome.attempts[1].waitedMs, 250);
	assert.equal(outcome.attempts[2].waitedMs, 250);
});

test('runWithRetry: percobaan habis -> status error, jumlah attempt = maxTries', async () => {
	const { sleep } = recordedSleep();
	let calls = 0;
	const outcome = await runWithRetry(
		async () => {
			calls++;
			throw new Error('always failing');
		},
		resolveRetryPolicy({ retryOnFail: true, maxTries: 4 }),
		{ sleep },
	);
	assert.equal(outcome.status, 'error');
	assert.equal(outcome.error.message, 'always failing');
	assert.equal(calls, 4);
	assert.equal(outcome.tries, 4);
	assert.equal(outcome.attempts.length, 4);
});

test('runWithRetry: tanpa retryOnFail error langsung berhenti di 1 percobaan', async () => {
	let calls = 0;
	const outcome = await runWithRetry(
		async () => {
			calls++;
			throw new Error('nope');
		},
		resolveRetryPolicy({}),
		{ sleep: noSleep },
	);
	assert.equal(outcome.status, 'error');
	assert.equal(calls, 1);
	assert.equal(outcome.tries, 1);
});

test('runWithRetry: soft-failure (item json.error tanpa throw) ikut di-retry (L1655-L1680)', async () => {
	const { waits, sleep } = recordedSleep();
	let calls = 0;
	const outcome = await runWithRetry(
		async () => {
			calls++;
			return [[{ json: { error: `attempt ${calls} failed` } }]];
		},
		resolveRetryPolicy({ retryOnFail: true, waitBetweenTries: 100 }),
		{ sleep },
	);
	assert.equal(outcome.status, 'success'); // dikembalikan apa adanya setelah percobaan terakhir
	assert.equal(calls, 3);
	assert.deepEqual(waits, [100, 100]);
	assert.equal(outcome.attempts.at(-1).error, 'result flagged as error');
});

test('normalizeOutputItems: $error/$json -> error + json.error (L1903-L1910)', () => {
	const output = normalizeOutputItems([
		[{ json: { $error: { message: 'upstream exploded' }, $json: { id: 7 } } }],
	]);
	assert.equal(output[0][0].error.message, 'upstream exploded');
	assert.deepEqual(output[0][0].json, { error: 'upstream exploded' });
});

test('normalizeOutputItems: item.error -> json = { error: message } (L1915-L1917)', () => {
	const output = normalizeOutputItems([
		[{ json: { untouched: true }, error: { message: 'node operation error' } }],
	]);
	assert.deepEqual(output[0][0].json, { error: 'node operation error' });
	assert.equal(output[0][0].error.message, 'node operation error');
});

test('isErrorItem: aturan deteksi handleNodeErrorOutput (L2510-L2516)', () => {
	assert.equal(isErrorItem({ json: {}, error: { message: 'x' } }), true);
	assert.equal(isErrorItem({ json: { error: 'x' } }), true);
	assert.equal(isErrorItem({ json: { error: 'x', message: 'x' } }), true);
	assert.equal(isErrorItem({ json: { error: 'x', other: 1 } }), false);
	assert.equal(isErrorItem({ json: { ok: 1 } }), false);
});

test('splitErrorOutput: item error dipindah ke output terakhir (L2559)', () => {
	const { data, errorItems } = splitErrorOutput(
		[
			[
				{ json: { ok: 1 } },
				{ json: { error: 'bad row' } },
				{ json: { error: 'bad row', message: 'bad row' } },
			],
			[],
		],
		2,
	);
	assert.equal(errorItems.length, 2);
	assert.deepEqual(data[0], [{ json: { ok: 1 } }]);
	assert.deepEqual(data[1], errorItems);
});

test('splitErrorOutput: tanpa error -> output tidak berubah', () => {
	const input = [[{ json: { a: 1 } }], []];
	const { data, errorItems } = splitErrorOutput(input, 2);
	assert.equal(errorItems.length, 0);
	assert.deepEqual(data, input);
});
