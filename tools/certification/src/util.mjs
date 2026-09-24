// tools/certification/src/util.mjs — deterministic helpers (no deps, no randomness).

/** Recursively sort object keys so serialization is reproducible. */
export function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
    return out;
  }
  return value;
}

/** Deterministic JSON with sorted keys. */
export function canonicalJSON(value, space) {
  return JSON.stringify(sortKeysDeep(value), null, space);
}

/** Convert a process.hrtime.bigint() nanoseconds value to milliseconds (3 decimals). */
export function toMs(ns) {
  return Math.round((Number(ns) / 1e6) * 1000) / 1000;
}

/**
 * Nearest-rank percentile over an ascending-sorted numeric array.
 * Returns null when the array is empty (explicit missing — never fabricated).
 */
export function percentile(sortedAsc, p) {
  const n = sortedAsc.length;
  if (n === 0) return null;
  const rank = Math.ceil((p / 100) * n);
  return sortedAsc[Math.min(rank, n) - 1];
}

/** Truncate a string deterministically. */
export function truncate(s, max, suffix = '…(truncated)') {
  if (typeof s !== 'string') return s;
  if (s.length <= max) return s;
  return s.slice(0, max) + suffix;
}
