/**
 * P3-M01 — effect ledger: explicit side-effect semantics and idempotency
 * BEFORE an automatic retry. No fake exactly-once; durable recovery leaves
 * `pending` rather than a silent success; bounded state is fail-closed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage } from '../src/lego/storage/contract.mjs';
import { createLocalStorage } from '../src/lego/storage/local-provider.mjs';
import { createTestClock } from '../src/lego/storage/conformance.mjs';
import {
  createEffectLedger, EffectLedgerError, EFFECT_ERROR_CODES,
  EFFECT_STATES, EFFECT_TRANSITIONS, EFFECT_DECISIONS, EFFECT_KINDS,
  IDEMPOTENCY_KEY_PATTERN, EFFECT_LEDGER_VERSION,
} from '../src/lego/effect-ledger.mjs';

const setup = (name, { maxEffects } = {}) => {
  const clock = createTestClock();
  const provider = createLocalStorage({ clock });
  let n = 0;
  const idFactory = () => `eff-${String(++n).padStart(6, '0')}-id`;
  const namespace = `eff-${name.replace(/\W+/g, '_')}`;
  const opts = { clock, idFactory, namespace, ...(maxEffects === undefined ? {} : { maxEffects }) };
  const hostA = createEffectLedger(createStorage(provider), opts);
  const hostB = createEffectLedger(createStorage(provider), opts);
  return { clock, hostA, hostB, idFactory };
};

const codeOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.code;
  }
  return 'NO_THROW';
};

test('1. beginEffect writes a durable pending record BEFORE the side effect runs', () => {
  const { hostA, idFactory } = setup('t1');
  const { decision, effect } = hostA.beginEffect({ idempotencyKey: 'charge-42', kind: 'http' });
  assert.equal(decision, 'execute', 'a first-seen key is executable');
  assert.equal(effect.state, 'pending', 'the record exists before the effect runs');
  assert.equal(effect.attempt, 1);
  assert.equal(effect.effectId, 'eff-000001-id', 'injected idFactory is deterministic');
  assert.equal(effect.kind, 'http');
  assert.equal(typeof effect.version, 'string', 'opaque version for CAS callers');

  const byKey = hostA.getEffect('charge-42');
  assert.equal(byKey.effectId, effect.effectId, 'readable by idempotency key');
  const byId = hostA.getEffect(effect.effectId);
  assert.equal(byId.idempotencyKey, 'charge-42', 'readable by effectId (pointer)');
  assert.equal(typeof idFactory, 'function');
});

test('2. IDEMPOTENCY BEFORE RETRY: an applied effect is never run again', () => {
  const { hostA } = setup('t2');
  const first = hostA.beginEffect({ idempotencyKey: 'charge-42', kind: 'http' });
  hostA.completeEffect(first.effect.effectId, { version: first.effect.version });

  const second = hostA.beginEffect({ idempotencyKey: 'charge-42', kind: 'http' });
  assert.equal(second.decision, 'skip', 'a completed effect must not be re-run');
  assert.equal(second.effect.state, 'applied');
  assert.equal(second.effect.effectId, first.effect.effectId, 'same effect, no duplicate');

  // and it stays skipped no matter how often it is asked
  assert.equal(hostA.beginEffect({ idempotencyKey: 'charge-42', kind: 'http' }).decision, 'skip');
  assert.equal(hostA.size(), 1, 'no second record was created');
});

test('3. a pending effect is in-flight, NOT a licence to re-run (durable recovery)', () => {
  const { hostA, hostB } = setup('t3');
  const first = hostA.beginEffect({ idempotencyKey: 'ship-7', kind: 'queue' });
  // A crash between the write and the real-world effect leaves `pending`.
  // A second host must see UNKNOWN, never "go ahead".
  const other = hostB.beginEffect({ idempotencyKey: 'ship-7', kind: 'queue' });
  assert.equal(other.decision, 'in-flight', 'pending is an explicitly unknown outcome');
  assert.equal(other.effect.state, 'pending');
  assert.equal(other.effect.effectId, first.effect.effectId);

  const pending = hostB.listPending();
  assert.equal(pending.effects.length, 1, 'the recovery surface sees the unknown effect');
  assert.equal(pending.effects[0].idempotencyKey, 'ship-7');
});

test('4. a failed effect is retriable and attempt increments; complete is terminal', () => {
  const { hostA, clock } = setup('t4');
  const first = hostA.beginEffect({ idempotencyKey: 'mail-9', kind: 'email' });
  const failed = hostA.failEffect(first.effect.effectId, { version: first.effect.version });
  assert.equal(failed.state, 'failed');
  assert.equal(failed.attempt, 1, 'a failure does not itself increment the attempt');

  const retried = hostA.beginEffect({ idempotencyKey: 'mail-9', kind: 'email' });
  assert.equal(retried.decision, 'retry', 'a failed effect is safe to attempt again');
  assert.equal(retried.effect.attempt, 2, 'the attempt is visible, not hidden');
  assert.equal(retried.effect.state, 'pending');

  clock.advance(1000);
  const applied = hostA.completeEffect(retried.effect.effectId, { version: retried.effect.version });
  assert.equal(applied.state, 'applied');
  assert.equal(applied.attempt, 2, 'the attempt history is preserved on the record');
  assert.equal(applied.updatedAt, failed.updatedAt + 1000, 'updatedAt tracks the clock');

  // terminal: no transition out of `applied`
  assert.equal(codeOf(() => hostA.completeEffect(applied.effectId, { version: applied.version })), EFFECT_ERROR_CODES.INVALID);
  assert.equal(codeOf(() => hostA.abandonEffect(applied.effectId, { version: applied.version })), EFFECT_ERROR_CODES.INVALID);
});

test('5. abandon is terminal and refuses a further run (explicit, not silent)', () => {
  const { hostA } = setup('t5');
  const first = hostA.beginEffect({ idempotencyKey: 'refund-3', kind: 'http' });
  const abandoned = hostA.abandonEffect(first.effect.effectId, { version: first.effect.version });
  assert.equal(abandoned.state, 'abandoned');
  assert.equal(
    codeOf(() => hostA.beginEffect({ idempotencyKey: 'refund-3', kind: 'http' })),
    EFFECT_ERROR_CODES.CONFLICT,
    'an abandoned effect needs a NEW key; reusing it is a conflict',
  );
  assert.equal(hostA.getEffect('refund-3').state, 'abandoned', 'the refusal is durable');
});

test('6. a key reused with a different kind is a conflict (explicit semantics)', () => {
  const { hostA } = setup('t6');
  hostA.beginEffect({ idempotencyKey: 'shared-key', kind: 'http' });
  assert.equal(
    codeOf(() => hostA.beginEffect({ idempotencyKey: 'shared-key', kind: 'storage' })),
    EFFECT_ERROR_CODES.CONFLICT,
    'one logical operation may not change its declared kind',
  );
  assert.equal(hostA.size(), 1);
});

test('7. BOUNDED STATE is fail-closed, never a silent eviction', () => {
  const { hostA } = setup('t7', { maxEffects: 3 });
  for (let i = 0; i < 3; i += 1) {
    hostA.beginEffect({ idempotencyKey: `eff-${i}`, kind: 'storage' });
  }
  assert.equal(hostA.size(), 3);
  assert.equal(
    codeOf(() => hostA.beginEffect({ idempotencyKey: 'eff-overflow', kind: 'storage' })),
    EFFECT_ERROR_CODES.LEDGER_FULL,
    'the bound refuses rather than dropping an idempotency record',
  );
  // The refusal must not have destroyed anything.
  assert.equal(hostA.size(), 3, 'all three records survive the refusal');
  assert.equal(hostA.getEffect('eff-0').state, 'pending');
  // An existing key is still resolvable at the bound (no growth required).
  assert.equal(hostA.beginEffect({ idempotencyKey: 'eff-0', kind: 'storage' }).decision, 'in-flight');
});

test('8. closed vocabularies are actually closed', () => {
  assert.deepEqual([...EFFECT_STATES].sort(), ['abandoned', 'applied', 'failed', 'pending']);
  assert.deepEqual(EFFECT_TRANSITIONS.applied, [], 'applied is terminal');
  assert.deepEqual(EFFECT_TRANSITIONS.abandoned, [], 'abandoned is terminal');
  assert.deepEqual([...EFFECT_DECISIONS].sort(), ['execute', 'in-flight', 'retry', 'skip']);
  assert.ok(EFFECT_KINDS.includes('http') && EFFECT_KINDS.includes('queue'));
  assert.equal(EFFECT_LEDGER_VERSION, 1);
  assert.equal(new EffectLedgerError(EFFECT_ERROR_CODES.CONFLICT, 'x').code, 'EFFECT_CONFLICT');
  assert.throws(() => new EffectLedgerError('EFFECT_MADE_UP', 'x'), TypeError);
});

test('9. input validation: a bad key or kind is refused, never coerced', () => {
  const { hostA } = setup('t9');
  for (const bad of ['', 'Upper', 'has space', 'a'.repeat(129), null, 42]) {
    assert.equal(
      codeOf(() => hostA.beginEffect({ idempotencyKey: bad, kind: 'http' })),
      EFFECT_ERROR_CODES.INVALID,
      `key ${JSON.stringify(bad)} must be refused`,
    );
  }
  assert.ok(IDEMPOTENCY_KEY_PATTERN.test('a.b-c_d'));
  assert.equal(codeOf(() => hostA.beginEffect({ idempotencyKey: 'ok-key', kind: 'telepathy' })), EFFECT_ERROR_CODES.INVALID);
  assert.equal(hostA.size(), 0, 'nothing was recorded by a rejected call');
});

test('10. every mutation is CAS: a stale version token loses', () => {
  const { hostA } = setup('t10');
  const first = hostA.beginEffect({ idempotencyKey: 'cas-1', kind: 'http' });
  hostA.failEffect(first.effect.effectId, { version: first.effect.version });

  assert.equal(
    codeOf(() => hostA.completeEffect(first.effect.effectId, { version: first.effect.version })),
    EFFECT_ERROR_CODES.CONFLICT,
    'the stale token from before the failure must not apply',
  );
  assert.equal(hostA.getEffect('cas-1').state, 'failed', 'the record is unchanged by the lost update');

  assert.equal(codeOf(() => hostA.completeEffect(first.effect.effectId, {})), EFFECT_ERROR_CODES.INVALID);
  assert.equal(codeOf(() => hostA.completeEffect('no-such-effect', { version: 'v1' })), EFFECT_ERROR_CODES.NOT_FOUND);
});

test('11. bounded listing paginates in a stable order and keeps pointers out', () => {
  const { hostA } = setup('t11');
  for (const key of ['a-1', 'b-1', 'c-1', 'd-1']) {
    hostA.beginEffect({ idempotencyKey: key, kind: 'storage' });
  }
  const page1 = hostA.listEffects({ limit: 2 });
  assert.equal(page1.effects.length, 2);
  assert.deepEqual(page1.effects.map((e) => e.idempotencyKey), ['a-1', 'b-1']);
  assert.ok(page1.nextCursor, 'a cursor is issued when more remain');

  const page2 = hostA.listEffects({ limit: 2, cursor: page1.nextCursor });
  assert.deepEqual(page2.effects.map((e) => e.idempotencyKey), ['c-1', 'd-1']);
  assert.equal(page2.nextCursor, null, 'the last page ends the cursor');
  assert.equal(hostA.listEffects({ limit: 2 }).effects.length, 2, 'pointers are not listed as effects');
  assert.equal(hostA.size(), 4);
});

test('12. the ledger runs nothing itself: a decision never mutates to applied', () => {
  const { hostA } = setup('t12');
  const { effect } = hostA.beginEffect({ idempotencyKey: 'pure-1', kind: 'webhook' });
  // Time passing does not resolve an effect. Only the caller's report does.
  assert.equal(hostA.getEffect('pure-1').state, 'pending');
  assert.equal(hostA.getEffect(effect.effectId).state, 'pending');
  assert.deepEqual(hostA.listPending().effects.map((e) => e.idempotencyKey), ['pure-1']);
});
