/**
 * P3-M01 — effect ledger: explicit side-effect semantics and idempotency
 * BEFORE an automatic retry may re-run a side effect.
 *
 * The ledger is a decision model, not an executor. Like the P5-M17 retry
 * model, IT NEVER RUNS ANYTHING ITSELF: a caller asks whether an effect may
 * run, then runs it, then reports the outcome. That separation is what makes
 * the decision auditable and keeps the module free of IO.
 *
 * THE FIVE INVARIANTS FROM #229, AND HOW EACH IS HONOURED:
 *
 *  1. NO FAKE EXACTLY-ONCE. This module never claims an effect happened
 *     exactly once. It records what the caller reported and nothing more.
 *     `applied` means "the caller confirmed the side effect completed" — it is
 *     an assertion BY THE CALLER, not a proof by the ledger. A crash between
 *     the real-world side effect and `completeEffect` leaves the record
 *     `pending`, which is an explicitly UNKNOWN state, never a silent success.
 *
 *  2. EXPLICIT SIDE-EFFECT SEMANTICS. Every effect declares an `idempotencyKey`
 *     (the caller's own key, validated against a closed charset) and a `kind`.
 *     There is no implicit or derived key: the caller states which logical
 *     operation this is, so two calls with different intent can never collide
 *     and two calls with the same intent always do.
 *
 *  3. IDEMPOTENCY BEFORE AUTOMATIC RETRY. `beginEffect` returns a decision and
 *     the caller MUST branch on it before running anything:
 *       - `execute`   no record yet -> run it
 *       - `skip`      already `applied` -> do NOT run it again
 *       - `in-flight` `pending`, outcome unknown -> do NOT run it again
 *       - `retry`     `failed` -> safe to attempt again (attempt increments)
 *       - `abandoned` terminal -> refusal (EFFECT_CONFLICT)
 *     A caller that ignores the decision and re-runs anyway is the only way to
 *     produce a duplicate side effect; the ledger gives it no helper to do so.
 *
 *  4. DURABLE RECOVERY. The `pending` record is written BEFORE the side effect
 *     runs (that is what `beginEffect` is). A crash therefore always leaves a
 *     durable trace, and `listPending` is the recovery surface: a recovering
 *     host sees the unknown effects and can resolve them explicitly instead of
 *     blindly re-running.
 *
 *  5. BOUNDED STATE. The ledger is bounded by `maxEffects` and is FAIL-CLOSED:
 *     it refuses a new effect with EFFECT_LEDGER_FULL rather than silently
 *     evicting a record. Silent eviction would destroy the very idempotency
 *     evidence the ledger exists to keep — an evicted `applied` record would
 *     let a retry re-run a completed side effect. Growth is therefore an
 *     explicit, visible condition that an operator must resolve, never a
 *     background event.
 *
 * Record (closed shape) - ONE authoritative record per idempotency key:
 *   effect {tag:1, effectId, idempotencyKey, kind, state, attempt, createdAt,
 *           updatedAt, metadata}
 *   stored at key `k:<idempotencyKey>` (linkage + uniqueness in ONE key);
 *   a pointer `e:<effectId>` resolves effectId -> idempotencyKey.
 *
 * Terminal states are `applied` and `abandoned`. Every transition is a pure
 * CAS mutation (version token REQUIRED; stale -> EFFECT_CONFLICT).
 *
 * Idempotency keys are caller-authored and are embedded in a storage key, so
 * the charset is closed and length-capped: lowercase letters, digits, dot,
 * underscore, dash; 1..128 characters, starting with a letter or digit. A key
 * outside that set is a caller bug (EFFECT_INVALID), not something to escape.
 *
 * Error set (closed): EFFECT_INVALID | EFFECT_NOT_FOUND | EFFECT_CONFLICT
 *                     | EFFECT_LEDGER_FULL
 * Storage errors propagate unchanged.
 */

export const EFFECT_ERROR_CODES = Object.freeze({
  INVALID: 'EFFECT_INVALID',
  NOT_FOUND: 'EFFECT_NOT_FOUND',
  CONFLICT: 'EFFECT_CONFLICT',
  LEDGER_FULL: 'EFFECT_LEDGER_FULL',
});

export class EffectLedgerError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'EffectLedgerError';
    this.code = code;
    this.details = options.details ?? {};
    if (!Object.values(EFFECT_ERROR_CODES).includes(code)) {
      throw new TypeError(`EffectLedgerError: unknown code ${String(code)}`);
    }
  }
}

const invalid = (message, details) => new EffectLedgerError(EFFECT_ERROR_CODES.INVALID, message, { details });
const notFound = (message, details) => new EffectLedgerError(EFFECT_ERROR_CODES.NOT_FOUND, message, { details });
const conflict = (message, details) => new EffectLedgerError(EFFECT_ERROR_CODES.CONFLICT, message, { details });
const ledgerFull = (message, details) => new EffectLedgerError(EFFECT_ERROR_CODES.LEDGER_FULL, message, { details });

const RECORD_TAG = 1;

/** Closed effect-state vocabulary. */
export const EFFECT_STATES = Object.freeze(['pending', 'applied', 'failed', 'abandoned']);
/** Legal transitions; terminal states have empty lists. */
export const EFFECT_TRANSITIONS = Object.freeze({
  pending: ['applied', 'failed', 'abandoned'],
  failed: ['applied', 'failed', 'abandoned'],
  applied: [],
  abandoned: [],
});
/** Closed decision vocabulary returned by `beginEffect`; see invariant 3. */
export const EFFECT_DECISIONS = Object.freeze(['execute', 'skip', 'in-flight', 'retry']);
/** Closed effect-kind vocabulary; explicit, never inferred. */
export const EFFECT_KINDS = Object.freeze(['http', 'queue', 'storage', 'email', 'webhook', 'external']);
/** Idempotency key charset and bounds; see the module header. */
export const IDEMPOTENCY_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
export const MAX_EFFECTS_DEFAULT = 1000;

const keyOf = (idempotencyKey) => `k:${idempotencyKey}`;
const pointerOf = (effectId) => `e:${effectId}`;

function assertIdempotencyKey(value, name) {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw invalid(
      `${name} must match ${IDEMPOTENCY_KEY_PATTERN.source} (lowercase, 1..128 chars)`,
      { received: typeof value === 'string' ? value.slice(0, 32) : typeof value },
    );
  }
  return value;
}

function assertId(value, name) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw invalid(`${name} must be a non-empty string of at most 256 characters`);
  }
  return value;
}

/**
 * @param {object} storage storage facade handle: get / put / putIfVersion / list
 * @param {{ now: () => number }} options.clock REQUIRED deterministic clock (ms)
 * @param {() => string} options.idFactory REQUIRED opaque id factory
 * @param {string} [options.namespace='effect-ledger']
 * @param {number} [options.maxEffects=1000] hard bound; exceeded is a refusal
 */
export function createEffectLedger(storage, { clock, idFactory, namespace = 'effect-ledger', maxEffects = MAX_EFFECTS_DEFAULT } = {}) {
  if (!storage || typeof storage.get !== 'function' || typeof storage.putIfVersion !== 'function'
    || typeof storage.put !== 'function' || typeof storage.list !== 'function') {
    throw invalid('createEffectLedger requires a storage facade handle');
  }
  if (!clock || typeof clock.now !== 'function') throw invalid('an injected clock is required');
  if (typeof idFactory !== 'function') throw invalid('an injected idFactory is required');
  if (!Number.isInteger(maxEffects) || maxEffects <= 0) throw invalid('maxEffects must be a positive integer');

  const readJson = (key) => {
    const got = storage.get(namespace, key);
    if (!got.found) return null;
    let record;
    try {
      record = JSON.parse(got.value.toString('utf8'));
    } catch (error) {
      throw conflict('effect record is unreadable', { cause: error });
    }
    if (record.tag !== RECORD_TAG) throw conflict('effect record has an unsupported shape');
    return { record, version: got.version };
  };

  const readByKey = (idempotencyKey) => {
    const found = readJson(keyOf(idempotencyKey));
    if (!found) throw notFound('effect not found', { idempotencyKey });
    return found;
  };

  const resolve = (effectId) => {
    assertId(effectId, 'effectId');
    const pointer = storage.get(namespace, pointerOf(effectId));
    if (!pointer.found) throw notFound('effect not found', { effectId: effectId.slice(0, 8) });
    const { idempotencyKey } = JSON.parse(pointer.value.toString('utf8'));
    return readByKey(idempotencyKey);
  };

  const requireVersion = (version) => {
    if (typeof version !== 'string' || version.length === 0) {
      throw invalid('a CAS version token is required for this update');
    }
    return version;
  };

  const createRecord = (key, record) => {
    if (storage.get(namespace, key).found) throw conflict('record already exists');
    const bytes = Buffer.from(JSON.stringify(record), 'utf8');
    storage.put(namespace, key, bytes);
    const verify = storage.get(namespace, key);
    if (!verify.found || !verify.value.equals(bytes)) {
      throw conflict('create lost a concurrent write');
    }
    return Object.freeze({ ...record, version: verify.version });
  };

  const countRecords = () => {
    let n = 0;
    let scan;
    for (;;) {
      const page = storage.list(namespace, { cursor: scan, limit: 1000 });
      for (const entry of page.keys) {
        if (entry.key.startsWith('k:')) n += 1;
      }
      if (!page.nextCursor) break;
      scan = page.nextCursor;
    }
    return n;
  };

  return Object.freeze({
    capabilities: storage.capabilities,
    namespace,
    maxEffects,

    /**
     * Decide whether a side effect may run. Idempotency BEFORE retry (inv. 3).
     * Returns `{ decision, effect }`; the caller MUST branch on `decision`
     * and report the real outcome through complete/fail.
     */
    beginEffect({ idempotencyKey, kind, metadata = null } = {}) {
      assertIdempotencyKey(idempotencyKey, 'idempotencyKey');
      if (!EFFECT_KINDS.includes(kind)) {
        throw invalid(`kind must be one of ${EFFECT_KINDS.join('|')}`);
      }
      const existing = readJson(keyOf(idempotencyKey));
      if (existing) {
        const { record } = existing;
        // Same logical operation, different declared intent -> caller bug.
        if (record.kind !== kind) {
          throw conflict('idempotency key is already used with a different kind', {
            idempotencyKey, recordedKind: record.kind, requestedKind: kind,
          });
        }
        if (record.state === 'applied') {
          return Object.freeze({ decision: 'skip', effect: Object.freeze({ ...record, version: existing.version }) });
        }
        if (record.state === 'pending') {
          return Object.freeze({ decision: 'in-flight', effect: Object.freeze({ ...record, version: existing.version }) });
        }
        if (record.state === 'abandoned') {
          throw conflict('effect was abandoned; a new key is required to run it again', { idempotencyKey });
        }
        // failed -> safe to attempt again, attempt increments (CAS).
        return this.retryEffect(idempotencyKey, { version: existing.version });
      }
      if (countRecords() >= maxEffects) {
        throw ledgerFull('effect ledger is at its bound; resolve before recording more', {
          maxEffects,
        });
      }
      const effectId = assertId(idFactory(), 'idFactory output');
      const now = clock.now();
      const record = {
        tag: RECORD_TAG,
        effectId,
        idempotencyKey,
        kind,
        state: 'pending',
        attempt: 1,
        createdAt: now,
        updatedAt: now,
        metadata: metadata === undefined ? null : structuredClone(metadata),
      };
      // Written BEFORE the side effect runs -> durable recovery (inv. 4).
      const created = createRecord(keyOf(idempotencyKey), record);
      createRecord(pointerOf(effectId), { tag: RECORD_TAG, effectId, idempotencyKey });
      return Object.freeze({ decision: 'execute', effect: created });
    },

    /** Read by effectId (pointer) or by idempotencyKey. */
    getEffect(effectIdOrKey) {
      assertId(effectIdOrKey, 'effectIdOrKey');
      try {
        const { record, version } = resolve(effectIdOrKey);
        return Object.freeze({ ...record, version });
      } catch (error) {
        if (error.code !== EFFECT_ERROR_CODES.NOT_FOUND) throw error;
        const { record, version } = readByKey(effectIdOrKey);
        return Object.freeze({ ...record, version });
      }
    },

    /** Record the confirmed outcome exactly once (CAS). */
    completeEffect(effectId, { version } = {}) {
      return transition(effectId, 'applied', version);
    },

    /** Record a failed attempt; the effect stays retriable (CAS). */
    failEffect(effectId, { version } = {}) {
      return transition(effectId, 'failed', version);
    },

    /** Terminal: this effect will not be run again (CAS). */
    abandonEffect(effectId, { version } = {}) {
      return transition(effectId, 'abandoned', version);
    },

    /** Re-attempt a failed effect: attempt++ and back to `pending` (CAS). */
    retryEffect(effectIdOrKey, { version } = {}) {
      requireVersion(version);
      const { record } = resolveOrKey(effectIdOrKey);
      if (record.state !== 'failed') {
        throw conflict(`only a failed effect can be retried, this one is ${record.state}`, { state: record.state });
      }
      const next = { ...record, state: 'pending', attempt: record.attempt + 1, updatedAt: clock.now() };
      const applied = storage.putIfVersion(
        namespace, keyOf(record.idempotencyKey),
        Buffer.from(JSON.stringify(next), 'utf8'), version,
      );
      if (!applied.applied) throw conflict('effect update lost a concurrent update', { reason: applied.reason });
      return Object.freeze({ decision: 'retry', effect: Object.freeze({ ...next, version: applied.version }) });
    },

    /** Durable-recovery surface: every effect whose outcome is unknown (inv. 4). */
    listPending({ limit = 100 } = {}) {
      if (!Number.isInteger(limit) || limit <= 0) throw invalid('limit must be a positive integer');
      return Object.freeze({ effects: Object.freeze(collect({ prefix: 'k:', filter: (r) => r.state === 'pending', limit })) });
    },

    /** Bounded listing (stable order over idempotencyKey). */
    listEffects({ cursor = null, limit = 100 } = {}) {
      if (cursor !== null && (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > 256)) {
        throw invalid('cursor must be an opaque token issued by a previous list call');
      }
      if (!Number.isInteger(limit) || limit <= 0) throw invalid('limit must be a positive integer');
      const collected = collect({ prefix: 'k:', filter: () => true, limit: Number.MAX_SAFE_INTEGER });
      const after = cursor === null ? collected : collected.filter((r) => r.idempotencyKey > cursor);
      const items = after.slice(0, limit);
      const last = items[items.length - 1];
      return Object.freeze({
        effects: Object.freeze(items),
        nextCursor: after.length > items.length && last ? last.idempotencyKey : null,
      });
    },

    /** Observable bound state; the refusal in beginEffect is driven by this. */
    size() {
      return countRecords();
    },
  });

  function resolveOrKey(effectIdOrKey) {
    try {
      return resolve(effectIdOrKey);
    } catch (error) {
      if (error.code !== EFFECT_ERROR_CODES.NOT_FOUND) throw error;
      return readByKey(effectIdOrKey);
    }
  }

  function transition(effectId, target, version) {
    requireVersion(version);
    const { record } = resolve(effectId);
    const allowed = EFFECT_TRANSITIONS[record.state];
    if (!allowed.includes(target)) {
      throw invalid(`cannot move an effect from ${record.state} to ${target}`);
    }
    const next = { ...record, state: target, updatedAt: clock.now() };
    const applied = storage.putIfVersion(
      namespace, keyOf(record.idempotencyKey),
      Buffer.from(JSON.stringify(next), 'utf8'), version,
    );
    if (!applied.applied) throw conflict('effect update lost a concurrent update', { reason: applied.reason });
    return Object.freeze({ ...next, version: applied.version });
  }

  function collect({ prefix, filter, limit }) {
    const collected = [];
    let scan;
    for (;;) {
      const page = storage.list(namespace, { cursor: scan, limit: 1000 });
      for (const entry of page.keys) {
        if (!entry.key.startsWith(prefix)) continue;
        const found = readJson(entry.key);
        if (found && filter(found.record)) collected.push(Object.freeze({ ...found.record, version: entry.version }));
      }
      if (!page.nextCursor) break;
      scan = page.nextCursor;
    }
    collected.sort((a, b) => (a.idempotencyKey < b.idempotencyKey ? -1 : a.idempotencyKey > b.idempotencyKey ? 1 : 0));
    return collected.slice(0, limit);
  }
}

export const EFFECT_LEDGER_VERSION = 1;
