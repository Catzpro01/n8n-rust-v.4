import assert from 'node:assert/strict';
import test from 'node:test';

import { healthz, readiness } from '../src/health.mjs';

test('H-01 /healthz is unconditional: always 200 {status: "ok"}', () => {
	assert.deepEqual(healthz(), { httpStatus: 200, body: { status: 'ok' } });
	// No argument exists that can make it report otherwise.
	assert.deepEqual(healthz({ connected: false, migrated: false }), {
		httpStatus: 200,
		body: { status: 'ok' },
	});
});

test('H-02 readiness reflects the database: connected AND migrated', () => {
	assert.deepEqual(readiness({ connected: true, migrated: true }), {
		httpStatus: 200,
		body: { status: 'ok' },
	});
	assert.deepEqual(readiness({ connected: true, migrated: false }), {
		httpStatus: 503,
		body: { status: 'error' },
	});
	assert.deepEqual(readiness({ connected: false, migrated: true }), {
		httpStatus: 503,
		body: { status: 'error' },
	});
	assert.deepEqual(readiness(), { httpStatus: 503, body: { status: 'error' } });
});

test('H-03 neither payload is wrapped in the { data } envelope', () => {
	assert.deepEqual(Object.keys(healthz().body), ['status']);
	assert.deepEqual(Object.keys(readiness({ connected: true, migrated: true }).body), ['status']);
});
