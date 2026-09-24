// tools/certification/src/comparator.mjs — Deliverable D: reproducibility
// checker comparing two result bundles.

import { isDeepStrictEqual } from 'node:util';

import { SCHEMA_VERSION } from './version.mjs';

export const VERDICT = Object.freeze({
  REPRODUCIBLE: 'REPRODUCIBLE',
  DRIFTED_ENVIRONMENT: 'DRIFTED_ENVIRONMENT',
  DRIFTED_COMMAND: 'DRIFTED_COMMAND',
  DRIFTED_COMMIT: 'DRIFTED_COMMIT',
  DRIFTED_TOOL: 'DRIFTED_TOOL',
  INCOMPLETE_EVIDENCE: 'INCOMPLETE_EVIDENCE',
  INCOMPARABLE: 'INCOMPARABLE',
});

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (k in obj) out[k] = clone(obj[k]);
  return out;
}

const ENV_COMPARE_KEYS = ['os', 'platform', 'arch', 'cpu'];
const TOOL_COMPARE_KEYS = ['tool', 'node', 'rust'];

function durationOf(r) {
  return (r && r.measurement && r.measurement.duration) || {};
}

/**
 * Compare two parsed result bundles.
 * Returns { verdict, reasons: [{key, baseline, candidate}] }.
 * Deterministic priority: command > commit > schema > evidence > env > tool.
 */
export function compareResults(baseline, candidate) {
  const reasons = [];
  const add = (key, b, c) => reasons.push({ key, baseline: clone(b), candidate: clone(c) });

  if (!baseline || !candidate) {
    return { verdict: VERDICT.INCOMPLETE_EVIDENCE, reasons: [{ key: 'bundle', baseline: null, candidate: null }] };
  }

  const bDur = durationOf(baseline);
  const cDur = durationOf(candidate);

  // Command.
  const commandDrift = baseline.command !== candidate.command;
  if (commandDrift) add('command', baseline.command, candidate.command);

  // Commit (both must be non-null; mismatch → drift).
  const commitDrift = Boolean(baseline.commit && candidate.commit && baseline.commit !== candidate.commit);
  if (commitDrift) add('commit', baseline.commit, candidate.commit);

  // Schema mismatch → structurally incomparable.
  if (baseline.schemaVersion !== candidate.schemaVersion) {
    if (!reasons.some((r) => r.key === 'schema')) {
      add('schema', baseline.schemaVersion, candidate.schemaVersion);
    }
  }
  const schemaDrift = reasons.some((r) => r.key === 'schema');

  // Missing metrics: a percentile present on one side but absent on the other.
  const missing = [];
  for (const p of ['p50', 'p95', 'p99']) {
    const b = bDur[p];
    const c = cDur[p];
    const bMiss = b === null || b === undefined;
    const cMiss = c === null || c === undefined;
    if (bMiss !== cMiss) missing.push(p);
  }
  let missingLogged = false;
  if (missing.length > 0) {
    add('missingMetrics', missing, missing);
    missingLogged = true;
  }

  // Sample count mismatch / zero samples.
  const bsamp = bDur.samples;
  const csamp = cDur.samples;
  const sampleMismatch = typeof bsamp === 'number' && typeof csamp === 'number' && bsamp !== csamp;
  if (sampleMismatch) add('sampleCount', bsamp, csamp);
  const zeroSamples = !(bsamp > 0) || !(csamp > 0);

  // Environment structural drift.
  const envSame = isDeepStrictEqual(pick(baseline.environment || {}, ENV_COMPARE_KEYS), pick(candidate.environment || {}, ENV_COMPARE_KEYS));
  if (!envSame) add('environment', pick(baseline.environment || {}, ENV_COMPARE_KEYS), pick(candidate.environment || {}, ENV_COMPARE_KEYS));

  // Tool/AUX drift.
  const toolSame = isDeepStrictEqual(pick(baseline.environment || {}, TOOL_COMPARE_KEYS), pick(candidate.environment || {}, TOOL_COMPARE_KEYS));
  if (!toolSame) add('toolVersions', pick(baseline.environment || {}, TOOL_COMPARE_KEYS), pick(candidate.environment || {}, TOOL_COMPARE_KEYS));

  // Priority classification.
  if (commandDrift) return { verdict: VERDICT.DRIFTED_COMMAND, reasons };
  if (commitDrift) return { verdict: VERDICT.DRIFTED_COMMIT, reasons };
  if (schemaDrift) return { verdict: VERDICT.INCOMPARABLE, reasons };
  if (missingLogged || sampleMismatch || zeroSamples) return { verdict: VERDICT.INCOMPLETE_EVIDENCE, reasons };
  if (!envSame) return { verdict: VERDICT.DRIFTED_ENVIRONMENT, reasons };
  if (!toolSame) return { verdict: VERDICT.DRIFTED_TOOL, reasons };

  return { verdict: VERDICT.REPRODUCIBLE, reasons };
}

/** Convenience: schema identity of a bundle. */
export function schemaOf(bundle) {
  return { schemaVersion: bundle && bundle.schemaVersion, expected: SCHEMA_VERSION };
}
