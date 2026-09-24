// tools/certification/src/fileio.mjs — bounded JSON read/write for result bundles.
//
// Reads are size-capped; writes are atomic-ish (tmp + rename). No secrets are
// special-cased here — callers run content through the schema/redact path.

import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';

export const MAX_RESULT_BYTES = 4 * 1024 * 1024; // 4 MiB hard cap

export function readResult(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    return { ok: false, error: `read failed: ${err && err.message ? err.message : err}`, json: null };
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_RESULT_BYTES) {
    return { ok: false, error: `file too large (max ${MAX_RESULT_BYTES} bytes)`, json: null };
  }
  try {
    return { ok: true, error: null, json: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: `invalid JSON: ${err && err.message ? err.message : err}`, json: null };
  }
}

export function writeText(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, file);
}

export function removeIfExists(file) {
  try {
    unlinkSync(file);
  } catch {
    /* ignore */
  }
}
