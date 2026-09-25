// Workforce control plane — durable operational store (arena-manager operational state, #264 §15).
//
// Layout (all under one state directory):
//   objects/<ObjectType>/<objectId>.json   current snapshots (bounded; events hold history)
//   events/events-NNNNNN.jsonl             append-only event segments (rotated, never deleted)
//   idempotency/<sha256>.json              committed command results keyed by actor + idempotency key
//   counters.json                          id sequences and event segment cursor
//   journal/pending.json                   write-ahead journal of the in-flight transaction
//   LOCK                                   exclusive single-writer lock (pid + timestamp)
//
// Atomicity (#265 §29, #264 §14): a transaction is first written to the journal (fsync), then each
// file is replaced via temp-file + rename, events are appended, and only then is the journal
// removed. On open, a leftover journal is rolled FORWARD (every write is a full-content
// replacement and every event carries its txId, so re-application is idempotent). Idempotency
// records are part of the same transaction, so two concurrent first-time commands serialize on
// LOCK and the second observes the first's committed record (#265 §21).
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { CommandError } from './core.mjs';

const OBJECT_TYPES = ['Task', 'Reservation', 'AgentState', 'Lease', 'Evidence', 'Decision', 'MergeQueueItem', 'Handoff', 'Request', 'Approval', 'JournalEntry', 'Actor', 'Slice'];
const sleeper = new Int32Array(new SharedArrayBuffer(4));
function sleepMs(ms) { Atomics.wait(sleeper, 0, 0, ms); }

function writeFileDurable(path, text) {
  const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  const fd = openSync(tmp, 'w');
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
}

export class FileStore {
  constructor(dir, { policy, fault = null } = {}) {
    if (!policy) throw new Error('FileStore requires the canonical policy');
    this.dir = dir;
    this.policy = policy;
    this.fault = fault; // test-only crash injection: 'afterJournal' | 'afterFirstWrite' | 'beforeJournalRemove'
    for (const d of ['objects', 'events', 'idempotency', 'journal']) mkdirSync(join(dir, d), { recursive: true });
    for (const t of OBJECT_TYPES) mkdirSync(join(dir, 'objects', t), { recursive: true });
    // Startup recovery runs under the store lock: another process may be mid-commit, and its
    // pending journal must never be applied (or removed) concurrently with its own apply phase.
    this.recovered = { recovered: false, txId: null };
    this.withLock(() => {});
  }

  // ------------------------------------------------------------------ locking
  withLock(fn) {
    const lockPath = join(this.dir, 'LOCK');
    const { lockWaitMaxMs, lockPollMs, staleLockSeconds } = this.policy.timing;
    const started = Date.now();
    let fd = null;
    while (fd === null) {
      try {
        fd = openSync(lockPath, 'wx');
        writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (this.#lockIsStale(lockPath, staleLockSeconds)) { try { unlinkSync(lockPath); } catch { /* raced */ } continue; }
        if (Date.now() - started > lockWaitMaxMs) throw new CommandError('RESOURCE_UNAVAILABLE', 'control-plane store lock is held', { lock: lockPath });
        sleepMs(Math.min(lockPollMs, 1000));
      }
    }
    try {
      if (existsSync(join(this.dir, 'journal', 'pending.json'))) this.recovered = this.recover();
      return fn();
    } finally {
      closeSync(fd);
      try { unlinkSync(lockPath); } catch { /* already gone */ }
    }
  }

  #lockIsStale(lockPath, staleSeconds) {
    try {
      const age = (Date.now() - statSync(lockPath).mtimeMs) / 1000;
      if (age < staleSeconds) return false;
      const { pid } = JSON.parse(readFileSync(lockPath, 'utf8') || '{}');
      if (!pid) return true;
      try { process.kill(pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; }
    } catch { return false; }
  }

  // ------------------------------------------------------------------ reads
  objectPath(type, id) {
    if (!OBJECT_TYPES.includes(type)) throw new CommandError('INVALID_SCHEMA', `unknown object type ${type}`);
    if (!/^[A-Z]+-[0-9A-Za-z-]+$/.test(id)) throw new CommandError('INVALID_SCHEMA', `invalid object id ${id}`);
    return join(this.dir, 'objects', type, `${id}.json`);
  }

  get(type, id) {
    const p = this.objectPath(type, id);
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  }

  list(type) {
    const d = join(this.dir, 'objects', type);
    return readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(d, f), 'utf8')));
  }

  counters() {
    const p = join(this.dir, 'counters.json');
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { sequences: {}, eventSegment: 1, eventsInSegment: 0 };
  }

  idempotencyPath(actorId, key) {
    return join(this.dir, 'idempotency', `${createHash('sha256').update(`${actorId}\u0000${key}`).digest('hex')}.json`);
  }

  getIdempotency(actorId, key) {
    const p = this.idempotencyPath(actorId, key);
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  }

  events() {
    const d = join(this.dir, 'events');
    const out = [];
    for (const f of readdirSync(d).filter((x) => x.endsWith('.jsonl')).sort()) {
      for (const line of readFileSync(join(d, f), 'utf8').split('\n')) if (line.trim()) out.push(JSON.parse(line));
    }
    return out;
  }

  hasPendingJournal() {
    return existsSync(join(this.dir, 'journal', 'pending.json'));
  }

  // ------------------------------------------------------------------ transactions
  begin() {
    const store = this;
    const counters = structuredClone(this.counters());
    const writes = new Map();
    const events = [];
    let idempotency = null;
    return {
      txId: `TX-${randomUUID()}`,
      get(type, id) { const k = `${type}/${id}`; return writes.has(k) ? structuredClone(writes.get(k)) : store.get(type, id); },
      list(type) {
        const base = new Map(store.list(type).map((o) => [o.objectId, o]));
        for (const [k, v] of writes) if (k.startsWith(`${type}/`)) base.set(v.objectId, v);
        return [...base.values()].sort((a, b) => a.objectId.localeCompare(b.objectId));
      },
      put(obj) { writes.set(`${obj.objectType}/${obj.objectId}`, structuredClone(obj)); },
      nextId(prefix, width = 4) {
        const n = (counters.sequences[prefix] ?? 0) + 1;
        counters.sequences[prefix] = n;
        return `${prefix}-${String(n).padStart(width, '0')}`;
      },
      reserveSequenceAtLeast(prefix, n) { counters.sequences[prefix] = Math.max(counters.sequences[prefix] ?? 0, n); },
      event(evt) { events.push(evt); },
      setIdempotency(actorId, key, record) { idempotency = { path: store.idempotencyPath(actorId, key), record }; },
      get writes() { return writes; },
      get events() { return events; },
      get counters() { return counters; },
      get idempotency() { return idempotency; },
    };
  }

  commit(tx) {
    const seg = this.policy.events.segmentMaxEvents;
    let { eventSegment, eventsInSegment } = tx.counters;
    const eventPlacement = [];
    for (const evt of tx.events) {
      if (eventsInSegment >= seg) { eventSegment += 1; eventsInSegment = 0; }
      eventPlacement.push({ segment: eventSegment, event: { ...evt, txId: tx.txId } });
      eventsInSegment += 1;
    }
    const counters = { ...tx.counters, eventSegment, eventsInSegment };
    const journal = {
      txId: tx.txId,
      writes: [...tx.writes.values()].map((obj) => ({ path: this.objectPath(obj.objectType, obj.objectId), text: `${JSON.stringify(obj, null, 2)}\n` })),
      events: eventPlacement,
      idempotency: tx.idempotency ? { path: tx.idempotency.path, text: `${JSON.stringify(tx.idempotency.record, null, 2)}\n` } : null,
      counters: `${JSON.stringify(counters, null, 2)}\n`,
    };
    writeFileDurable(join(this.dir, 'journal', 'pending.json'), JSON.stringify(journal));
    if (this.fault === 'afterJournal') throw new Error('injected crash after journal write');
    this.#apply(journal);
  }

  #apply(journal) {
    let first = true;
    for (const w of journal.writes) {
      writeFileDurable(w.path, w.text);
      if (first && this.fault === 'afterFirstWrite') throw new Error('injected crash after first write');
      first = false;
    }
    const bySegment = new Map();
    for (const { segment, event } of journal.events) {
      if (!bySegment.has(segment)) bySegment.set(segment, []);
      bySegment.get(segment).push(event);
    }
    for (const [segment, evts] of bySegment) {
      const p = join(this.dir, 'events', `events-${String(segment).padStart(6, '0')}.jsonl`);
      const existing = existsSync(p) ? readFileSync(p, 'utf8') : '';
      const present = new Set(existing.split('\n').filter(Boolean).map((l) => JSON.parse(l).eventId));
      const missing = evts.filter((e) => !present.has(e.eventId));
      if (missing.length) {
        const fd = openSync(p, 'a');
        try { writeSync(fd, missing.map((e) => `${JSON.stringify(e)}\n`).join('')); fsyncSync(fd); } finally { closeSync(fd); }
      }
    }
    if (journal.idempotency) writeFileDurable(journal.idempotency.path, journal.idempotency.text);
    writeFileDurable(join(this.dir, 'counters.json'), journal.counters);
    if (this.fault === 'beforeJournalRemove') throw new Error('injected crash before journal removal');
    unlinkSync(join(this.dir, 'journal', 'pending.json'));
  }

  /** Roll a leftover journal forward. Returns { recovered: boolean, txId }. */
  recover() {
    const p = join(this.dir, 'journal', 'pending.json');
    if (!existsSync(p)) return { recovered: false, txId: null };
    let journal;
    try { journal = JSON.parse(readFileSync(p, 'utf8')); } catch {
      // A torn journal means the transaction never reached the apply phase: nothing was mutated.
      renameSync(p, join(this.dir, 'journal', `torn-${Date.now()}.json`));
      return { recovered: false, txId: null, tornJournalQuarantined: true };
    }
    const fault = this.fault;
    this.fault = null;
    try { this.#apply(journal); } finally { this.fault = fault; }
    return { recovered: true, txId: journal.txId };
  }
}
