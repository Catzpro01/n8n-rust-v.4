/**
 * Issue #241 — Scope C: differential / parity harness.
 *
 * Deterministic comparisons on observable behavior only. Statuses are closed:
 * equivalent | compatible | migration-required | breaking.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PARITY_STATUSES,
  compareObservations,
  observation,
  validateObservation,
  describeParityHarness,
  ParityError,
} from '../src/parity.mjs';
import { REGION_STATES } from '../src/surface-contract.mjs';

function baseRef(overrides = {}) {
  return observation({
    surfaceId: 'ui.primitives.status-region',
    side: 'reference',
    visible: true,
    regionState: 'empty',
    loading: false,
    empty: true,
    error: null,
    interactions: { 'shows-retry': false },
    events: [],
    accessibility: { role: 'status', 'aria-busy': 'false' },
    localization: { slot: 'system-messages', messageKeys: ['system-messages.status-empty'] },
    contract: { mode: 'reference', authority: 'declare-request-render' },
    ...overrides,
  });
}

function baseCand(overrides = {}) {
  return observation({
    surfaceId: 'ui.primitives.status-region',
    side: 'candidate',
    visible: true,
    regionState: 'empty',
    loading: false,
    empty: true,
    error: null,
    interactions: { 'shows-retry': false },
    events: [],
    accessibility: { role: 'status', 'aria-busy': 'false' },
    localization: { slot: 'system-messages', messageKeys: ['system-messages.status-empty'] },
    contract: { mode: 'pilot', authority: 'declare-request-render' },
    ...overrides,
  });
}

test('harness describes a closed status set and observable fields only', () => {
  const described = describeParityHarness();
  assert.deepEqual([...described.statuses], [...PARITY_STATUSES]);
  assert.equal(described.compares, 'observable behavior (not pixels)');
  assert.ok(described.fields.includes('regionState'));
  assert.equal(described.fields.includes('pixels'), false);
});

test('identical observables with only a mode flip are compatible (pilot vs reference)', () => {
  const result = compareObservations(baseRef(), baseCand());
  assert.ok(PARITY_STATUSES.includes(result.status));
  assert.equal(result.status, 'compatible');
  assert.equal(result.fieldStatus.contract, 'diff');
  for (const field of ['visible', 'regionState', 'loading', 'empty', 'error', 'interactions', 'events', 'accessibility', 'localization']) {
    assert.equal(result.fieldStatus[field], 'equal', field);
  }
});

test('exact match including mode yields equivalent', () => {
  const ref = baseRef({ contract: { mode: 'reference', authority: 'declare-request-render' } });
  const cand = baseCand({ contract: { mode: 'reference', authority: 'declare-request-render' } });
  const result = compareObservations(ref, cand);
  assert.equal(result.status, 'equivalent');
  assert.equal(result.diffs.length, 0);
});

test('region state mismatch is migration-required', () => {
  const result = compareObservations(
    baseRef({ regionState: 'error', empty: false, loading: false }),
    baseCand({ regionState: 'empty', empty: true }),
  );
  assert.equal(result.status, 'migration-required');
  assert.equal(result.fieldStatus.regionState, 'diff');
});

test('loading/empty/visible differences are material', () => {
  const result = compareObservations(
    baseRef({ regionState: 'loading', loading: true, empty: false }),
    baseCand({ regionState: 'ready', loading: false, empty: false }),
  );
  assert.equal(result.status, 'migration-required');
  assert.equal(result.fieldStatus.loading, 'diff');
});

test('error kind mismatch is material; matching errors compare equal', () => {
  const mismatch = compareObservations(
    baseRef({ regionState: 'error', empty: false, error: { kind: 'network', messageKey: 'system-messages.status-error' } }),
    baseCand({ regionState: 'error', empty: false, error: { kind: 'auth', messageKey: 'system-messages.status-error' } }),
  );
  assert.equal(mismatch.status, 'migration-required');
  assert.equal(mismatch.fieldStatus.error, 'diff');

  const match = compareObservations(
    baseRef({ regionState: 'error', empty: false, error: { kind: 'network', messageKey: 'system-messages.status-error' } }),
    baseCand({ regionState: 'error', empty: false, error: { kind: 'network', messageKey: 'system-messages.status-error' } }),
  );
  assert.equal(match.fieldStatus.error, 'equal');
});

test('missing interaction or extra interaction is migration-required', () => {
  const missing = compareObservations(
    baseRef({ interactions: { 'shows-retry': true, reload: true } }),
    baseCand({ interactions: { 'shows-retry': true } }),
  );
  assert.equal(missing.status, 'migration-required');

  const extra = compareObservations(
    baseRef({ interactions: { 'shows-retry': false } }),
    baseCand({ interactions: { 'shows-retry': false, surprise: true } }),
  );
  assert.equal(extra.status, 'migration-required');
});

test('event set differences are material (deterministic ordering ignored)', () => {
  const result = compareObservations(
    baseRef({ events: ['status-region:retry', 'status-region:dismiss'] }),
    baseCand({ events: ['status-region:dismiss'] }),
  );
  assert.equal(result.status, 'migration-required');
  assert.equal(result.fieldStatus.events, 'diff');

  const order = compareObservations(
    baseRef({ events: ['b', 'a'] }),
    baseCand({ events: ['a', 'b'], contract: { mode: 'reference', authority: 'declare-request-render' } }),
  );
  assert.equal(order.status, 'equivalent');
});

test('accessibility and localization regressions are material', () => {
  const a11y = compareObservations(
    baseRef({ accessibility: { role: 'alert', 'aria-busy': 'false' } }),
    baseCand({ accessibility: { role: 'status', 'aria-busy': 'false' } }),
  );
  assert.equal(a11y.status, 'migration-required');

  const loc = compareObservations(
    baseRef({ localization: { slot: 'system-messages', messageKeys: ['system-messages.status-empty', 'system-messages.status-error'] } }),
    baseCand({ localization: { slot: 'system-messages', messageKeys: ['system-messages.status-empty'] } }),
  );
  assert.equal(loc.status, 'migration-required');
});

test('authority violation on the candidate is breaking', () => {
  const result = compareObservations(
    baseRef(),
    baseCand({ contract: { mode: 'pilot', authority: 'grant-session' } }),
  );
  assert.equal(result.status, 'breaking');
  assert.equal(result.fieldStatus.contract, 'breaking');
});

test('invalid observations throw ParityError (no soft pass)', () => {
  assert.throws(
    () => compareObservations(baseRef({ side: 'candidate' }), baseCand()),
    ParityError,
  );
  assert.throws(
    () => compareObservations(baseRef(), baseCand({ surfaceId: 'ui.other' })),
    ParityError,
  );
  const errors = validateObservation({ side: 'reference' });
  assert.ok(errors.length > 0);
  assert.ok(errors.some((e) => e.includes('surfaceId')));
  for (const state of REGION_STATES) {
    const obs = baseRef({ regionState: state });
    assert.equal(validateObservation(obs).length, 0, state);
  }
});

test('comparison is deterministic — same inputs, same status and diffs', () => {
  const a = compareObservations(
    baseRef({ regionState: 'ready', empty: false }),
    baseCand({ regionState: 'empty', empty: true }),
  );
  const b = compareObservations(
    baseRef({ regionState: 'ready', empty: false }),
    baseCand({ regionState: 'empty', empty: true }),
  );
  assert.deepEqual(a, b);
});
