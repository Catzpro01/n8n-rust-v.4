/**
 * P3 Slice E — bounded streaming execution state (Issue #75 required
 * architecture 4; checkpoint/resume = Slice F on this seam).
 *
 * Proves: bounded buffer (backpressure, no silent loss) · streaming reads
 * (bounded window, finite batch generator, destructive selective consume) ·
 * JSON-domain payloads frozen on admission · purity (only node:crypto) ·
 * purity (zero imports) · JSON-domain payloads frozen on admission.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  STATE_STREAM_CONTRACT,
  STATE_STREAM_CONTRACT_VERSION,
  STATE_STREAM_MAX_EVENTS,
  StateStreamError,
  createStateStream,
} from '../src/lego/state-stream.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const read = (relative) => readFileSync(join(REPO_ROOT, relative), 'utf8');
const LOCK = JSON.parse(read('apps/n8n-lego/src/lego/contracts/contract-lock.json'));
const ROWS = LOCK.contracts ?? LOCK;
const DOMAINS = JSON.parse(read('apps/n8n-lego/src/lego/manifest/domains.json'));
const EXECUTION = (DOMAINS.domains ?? DOMAINS).find((d) => d.id === 'execution');
const ERRORS = JSON.parse(read('apps/n8n-lego/src/lego/contracts/errors.contract.json'));
const SOURCE = read('apps/n8n-lego/src/lego/state-stream.mjs');

const caught = (fn) => {
  try { fn(); return null; } catch (error) { return error; }
};

/* ============================================ A. CONTRACT / LOCK ROW (35th) */

test('the lock row is the thirty-fifth: execution.state-stream@0.1.0, owner agent-1, exports byte-parity', () => {
  const row = ROWS.find((r) => r.id === 'execution.state-stream');
  assert.ok(row, 'execution.state-stream is locked');
  assert.equal(ROWS.length, 35, 'P3 Slice E adds exactly one row — count-pins say 35');
  assert.equal(row.owner, 'agent-1');
  assert.equal(row.domain, 'execution');
  assert.equal(row.version, '0.1.0', 'R9: execution domain contract 0.1.0');
  assert.equal(row.status, 'implemented');
  assert.deepEqual(row.surface, ['src/lego/state-stream.mjs']);
  const module_ = {
    STATE_STREAM_CONTRACT, STATE_STREAM_CONTRACT_VERSION, STATE_STREAM_MAX_EVENTS,
    StateStreamError, createStateStream,
  };
  const locked = row.exports['src/lego/state-stream.mjs'];
  assert.deepEqual([...locked].sort(), Object.keys(module_).sort(), 'lock ⇄ module exports');
  assert.deepEqual([...locked], [...locked].slice().sort(), 'sorted ASCII');
  assert.equal(locked.length, 5);
  assert.deepEqual(row.tests, ['apps/n8n-lego/test/lego-state-stream.test.mjs']);
  assert.equal('operations' in row, false, 'no capability/REST surface (by design)');
  assert.equal('permissions' in row, false);
  assert.equal(STATE_STREAM_CONTRACT.id, row.id);
  assert.equal(STATE_STREAM_CONTRACT_VERSION, row.version);
  assert.equal(STATE_STREAM_CONTRACT.owner, row.owner);
});

test('the execution domain owns the module; purity scan; one published error family', () => {
  assert.ok(EXECUTION.paths.includes('src/lego/state-stream.mjs'));
  assert.equal(EXECUTION.status, 'partial', 'domain status unchanged by a slice');
  assert.equal(ERRORS.version, '1.2.0', 'errors contract untouched');
  assert.ok([...ERRORS.codes].some((c) => (c.code ?? c) === 'lego.backpressure'));
  // purity: ZERO imports — no clock/fs/network/timers/randomness/process
  const imports = [...SOURCE.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports, [], 'zero imports — a pure bounded structure');
  for (const forbidden of [/node:fs/, /node:http/, /node:net/, /setTimeout/, /setInterval/, /Date\.now/, /Math\.random/, /process\./]) {
    assert.equal(forbidden.test(SOURCE), false, `${forbidden} must not appear`);
  }
  const published = new Set((ERRORS.codes ?? []).map((e) => e.code ?? e.id));
  for (const match of SOURCE.matchAll(/'(lego\.[a-z0-9_]+)'/g)) {
    assert.ok(published.has(match[1]), `${match[1]} is published`);
  }
});

/* ================================================= B. BOUNDED BUFFER / APPEND */

test('capacity is required and validated fail-closed in the one error family', () => {
  assert.equal(caught(() => createStateStream()).details.field, 'maxResidentEvents', 'no default bound — ever');
  assert.equal(caught(() => createStateStream({})).details.field, 'maxResidentEvents');
  for (const bad of [0, -1, 1.5, '8', Number.NaN, STATE_STREAM_MAX_EVENTS + 1]) {
    const error = caught(() => createStateStream({ maxResidentEvents: bad }));
    assert.ok(error instanceof StateStreamError, `capacity ${bad} refuses`);
    assert.equal(error.code, 'lego.contract_violation');
    assert.equal(error.details.field, 'maxResidentEvents');
  }
  assert.equal(caught(() => createStateStream(null)).details.field, 'options');
  assert.equal(caught(() => createStateStream([])).details.field, 'options');
});

test('the buffer is bounded: append admits up to capacity, then explicit backpressure (nothing retained)', () => {
  const capacity = 8;
  const stream = createStateStream({ maxResidentEvents: capacity });
  for (let i = 0; i < capacity; i += 1) {
    const outcome = stream.append({ n: i });
    assert.equal(outcome.status, 'admitted');
    assert.equal(outcome.seq, i + 1, 'seq is monotonic and backpressure never burns a seq');
    assert.ok(stream.size() <= capacity, `size ${stream.size()} ≤ capacity after append ${i}`);
  }
  assert.equal(stream.size(), capacity);
  const refused = stream.append({ n: 'lost?' });
  assert.equal(refused.status, 'backpressure');
  assert.equal(refused.code, 'lego.backpressure', 'published explicit outcome code');
  assert.equal(stream.size(), capacity, 'the refused event was never retained');
  assert.equal(stream.lastSeq(), capacity, 'backpressure did not advance lastSeq');
  const stats = stream.stats();
  assert.equal(stats.appended, capacity);
  assert.equal(stats.backpressured, 1);
  assert.equal(stats.peakSize, capacity, 'peak = the bound');
  assert.equal(stats.consumed, 0);
  // non-JSON-domain payloads refused (JSON stream = n8n data domain)
  assert.equal(caught(() => stream.append(undefined)).details.field, 'event');
  assert.equal(caught(() => stream.append(() => 'fn')).details.field, 'event');
  assert.equal(caught(() => stream.append({ x: Number.NaN })).details.field, 'event');
  assert.equal(caught(() => stream.append({ d: new Date() })).details.field, 'event');
});

test('payloads are frozen shared state on admission (documented producer contract)', () => {
  const stream = createStateStream({ maxResidentEvents: 4 });
  const payload = { run: 1, items: [{ ok: true }] };
  const outcome = stream.append(payload);
  assert.equal(outcome.status, 'admitted');
  assert.equal(Object.isFrozen(payload), true, 'admission freezes the event tree');
  assert.equal(Object.isFrozen(payload.items[0]), true);
  assert.throws(() => { 'use strict'; payload.run = 2; }, TypeError, 'post-append mutation refused');
  const readBack = stream.read(1, 4);
  assert.equal(readBack[0].event, payload, 'read serves the same immutable record');
});

/* ==================================================== C. STREAMING READS / CONSUME */

test('read is a bounded non-destructive window; consumed regions read empty', () => {
  const stream = createStateStream({ maxResidentEvents: 16 });
  for (let i = 0; i < 10; i += 1) stream.append({ n: i });
  const window = stream.read(4, 3);
  assert.deepEqual(window.map((r) => r.seq), [4, 5, 6], 'window starts at fromSeq, stops at limit');
  assert.equal(stream.read(4, 3).length, 3, 're-read is non-destructive');
  assert.equal(stream.size(), 10);
  assert.equal(stream.read(11, 5).length, 0, 'cursor past lastSeq reads empty');
  assert.equal(stream.read(1, 0).length, 0, 'limit 0 is legal');
  assert.equal(caught(() => stream.read(0, 1)).details.field, 'fromSeq');
  assert.equal(caught(() => stream.read(1, 999)).details.field, 'limit');
  assert.equal(caught(() => stream.read(1.5, 1)).details.field, 'fromSeq');
  const before = stream.stats().readCalls;
  stream.read(1, 1);
  assert.equal(stream.stats().readCalls, before + 1, 'reads are observable');
});

test('consume is selective retention: destructive FIFO drain frees the bounded buffer', () => {
  const stream = createStateStream({ maxResidentEvents: 4 });
  for (let i = 0; i < 4; i += 1) stream.append({ n: i });
  assert.equal(stream.append({ n: 4 }).status, 'backpressure', 'full');
  const taken = stream.consume(2);
  assert.deepEqual(taken.map((r) => r.seq), [1, 2], 'FIFO drain');
  assert.equal(stream.size(), 2);
  assert.equal(stream.firstResidentSeq(), 3, 'cursor advances');
  assert.equal(stream.append({ n: 4 }).status, 'admitted', 'consume freed capacity — resume flow');
  assert.equal(stream.lastSeq(), 5, 'the new event takes the next seq (3 consumed were 1,2 … lastSeq=5)');
  assert.equal(caught(() => stream.consume(999)).details.field, 'limit');
  assert.equal(stream.consume(0).length, 0, 'drain 0 is legal');
  const stats = stream.stats();
  assert.equal(stats.consumed, 2);
  assert.equal(stats.backpressured, 1, 'the single full-buffer refusal counted');
  assert.equal(stream.read(1, 4).map((r) => r.seq).join(','), '3,4,5', 'consumed region invisible to read');
});

test('stream() yields finite bounded batches up to lastSeq-at-call (no unbounded iteration)', () => {
  const stream = createStateStream({ maxResidentEvents: 64 });
  for (let i = 0; i < 25; i += 1) stream.append({ n: i });
  const batches = [];
  for (const batch of stream.stream(1, { batchSize: 10 })) {
    batches.push(batch);
    assert.ok(batch.events.length <= 10, 'every batch respects the bound');
  }
  assert.equal(batches.length, 3, '25 events at batchSize 10 → 10+10+5');
  assert.equal(batches[0].from, 1);
  assert.equal(batches[2].to, 25);
  // appends after capture do not extend a running iteration (finite)
  stream.append({ n: 25 });
  const again = [...stream.stream(20, { batchSize: 6 })];
  assert.deepEqual(again.map((b) => b.to), [25, 26], 'cursor 20 → batches of 6: …25, then 26');
  assert.throws(() => [...stream.stream(0)], /cursor/, 'cursor validated on first iteration');
  assert.throws(() => [...stream.stream(1, { batchSize: 0 })], /batchSize/, 'batchSize validated on first iteration');
  const empty = createStateStream({ maxResidentEvents: 4 });
  assert.equal([...empty.stream(1)].length, 0, 'empty stream yields nothing');
  assert.equal(caught(() => { empty.stream(-1).next(); }).details.field, 'cursor', 'eager validation for illegal cursor');
});
