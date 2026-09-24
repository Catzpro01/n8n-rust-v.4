// tools/certification/src/selftest.mjs — Deliverable F: offline self-test suite.
//
// No network. No frameworks. Deterministic. Exercises the acceptance
// checklist items (valid/malformed/missing/zero/timeout/non-zero/drift/
// incompatible/secret/reproducible/non-reproducible).

import { canonicalJSON, percentile } from './util.mjs';
import { hasSecretShaped, redact } from './redact.mjs';
import { validateResult } from './schema.mjs';
import { compareResults, VERDICT } from './comparator.mjs';
import { generateReports } from './report.mjs';
import { runBenchmark } from './runner.mjs';

function baseResult(overrides = {}) {
  const r = {
    schemaVersion: 'cert-result@1.0.0',
    tool: { name: 'p21-certification', version: '0.1.0' },
    runId: 'run-fixture',
    timestamp: 1700000000000,
    startedAt: '2023-11-14T22:13:20.000Z',
    completedAt: '2023-11-14T22:13:21.000Z',
    commit: 'abc1234',
    command: 'node -e "1+1"',
    note: null,
    commandMeta: [],
    environment: {
      os: 'Linux 6.1.0',
      platform: 'linux',
      arch: 'x64',
      cpu: { modules: 2 },
      node: 'v20.0.0',
      rust: null,
      tool: { name: 'p21-certification', version: '0.1.0' },
      commit: 'abc1234',
      commandMeta: [],
      capturedAt: 1700000000000,
    },
    measurement: {
      warmupRuns: 1,
      measurementRuns: 5,
      duration: { unit: 'ms', values: [10, 10, 10, 10, 10], samples: 5, p50: 10, p95: 10, p99: 10 },
      exitCode: 0,
      exitCodeOfLastRun: 0,
      failedRuns: 0,
      successRuns: 5,
      stdoutBytes: 4,
      stderrBytes: 0,
    },
    diagnostics: {},
    outcome: 'SUCCESS',
  };
  Object.assign(r, overrides);
  return r;
}

function deepSet(obj, pathStr, value) {
  const parts = pathStr.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cur[parts[i]] === undefined) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}

export async function runSelfTests() {
  const results = [];
  const test = (name, fn) => results.push({ name, pass: fn() });
  const asyncTest = (name, fn) => results.push({ name, pending: fn });

  // 1. valid result validates.
  test('valid result validates', () => {
    const v = validateResult(baseResult());
    return v.ok === true;
  });

  // 2. malformed result rejected.
  test('malformed result rejected', () => {
    const v = validateResult({ notAField: true });
    return v.ok === false;
  });
  test('malformed: non-object rejected', () => {
    const v = validateResult(42);
    return v.ok === false;
  });
  test('malformed: bad type for timestamp rejected', () => {
    const r = baseResult();
    r.timestamp = 'soon';
    const v = validateResult(r);
    return v.ok === false;
  });

  // 3. missing metric rejected.
  test('missing metric rejected', () => {
    const r = deepSet(baseResult(), 'measurement.duration', { unit: 'ms', values: [1, 2, 3], samples: 3, p50: 2 });
    const v = validateResult(r);
    return v.ok === false;
  });

  // 11. incompatible schema rejected by validator.
  test('incompatible schema rejected', () => {
    const r = deepSet(baseResult(), 'schemaVersion', 'cert-result@9.9.9');
    const v = validateResult(r);
    return v.ok === false && v.errors.some((e) => e.includes('schemaVersion'));
  });

  // 12. secret-shaped output detected / redacted.
  test('secret-shaped output detected', () => {
    return hasSecretShaped('Authorization: Bearer abcdef') === true;
  });
  test('secret-shaped output redacted', () => {
    const out = redact('token=abcdef password=hunter2 api_key=zzz');
    return !out.includes('abcdef') && !out.includes('hunter2') && !out.includes('zzz');
  });
  test('non-secret text untouched', () => {
    return hasSecretShaped('p50=10.5 samples=5') === false;
  });

  // 7. deterministic normalization: canonical JSON stable + percentile sane.
  test('deterministic normalization (key order)', () => {
    const a = { z: 1, a: { y: 2, b: 3 } };
    return canonicalJSON(a) === `{"a":{"b":3,"y":2},"z":1}`;
  });
  test('deterministic percentile', () => {
    return percentile([1, 2, 3, 4, 5], 50) === 3 && percentile([], 50) === null;
  });

  // 8. environment drift.
  test('environment drift detected', () => {
    const c = deepSet(baseResult(), 'environment.arch', 'arm64');
    const cmp = compareResults(baseResult(), c);
    return cmp.verdict === VERDICT.DRIFTED_ENVIRONMENT;
  });

  // 9. commit drift.
  test('commit drift detected', () => {
    const c = baseResult({ commit: 'deadbee' });
    const cmp = compareResults(baseResult(), c);
    return cmp.verdict === VERDICT.DRIFTED_COMMIT;
  });

  // 10. command drift.
  test('command drift detected', () => {
    const c = baseResult({ command: 'node -e "2+2"' });
    const cmp = compareResults(baseResult(), c);
    return cmp.verdict === VERDICT.DRIFTED_COMMAND;
  });

  // 4. zero sample → INCOMPLETE_EVIDENCE.
  test('zero sample is incomplete evidence', () => {
    const c = deepSet(baseResult(), 'measurement.duration.samples', 0);
    const cmp = compareResults(baseResult(), c);
    return cmp.verdict === VERDICT.INCOMPLETE_EVIDENCE;
  });

  // 13. reproducible pair.
  test('reproducible pair', () => {
    const cmp = compareResults(baseResult(), baseResult());
    return cmp.verdict === VERDICT.REPRODUCIBLE;
  });

  // 14. non-reproducible pair (sample-count mismatch).
  test('non-reproducible pair (sample count)', () => {
    const c = deepSet(baseResult(), 'measurement.duration.samples', 7);
    const cmp = compareResults(baseResult(), c);
    return cmp.verdict !== VERDICT.REPRODUCIBLE;
  });

  // Report is deterministic and evidence-bound.
  test('report is deterministic', () => {
    const cmp = compareResults(baseResult(), baseResult());
    const r1 = generateReports(baseResult(), baseResult(), cmp);
    const r2 = generateReports(baseResult(), baseResult(), cmp);
    return r1.text === r2.text && JSON.stringify(r1.json) === JSON.stringify(r2.json);
  });

  // Async tests: timeout + non-zero exit via the real runner (offline, node only).
  asyncTest('timeout is failure (TIMEOUT)', async () => {
    const out = await runBenchmark({ command: 'node -e "setTimeout(()=>{},3000)"' }, {
      timeoutPerRunMs: 250,
      warmupRuns: 0,
      measurementRuns: 1,
    });
    return out.outcome === 'TIMEOUT';
  });
  asyncTest('non-zero exit is failure', async () => {
    const out = await runBenchmark({ command: 'node -e "process.exit(3)"' }, {
      warmupRuns: 0,
      measurementRuns: 2,
      timeoutPerRunMs: 10_000,
    });
    return out.outcome === 'FAILURE' && out.measurement.exitCode === 3;
  });
  asyncTest('success run yields samples and percentiles', async () => {
    const out = await runBenchmark({ command: 'node -e "1+1"' }, {
      warmupRuns: 1,
      measurementRuns: 3,
      timeoutPerRunMs: 10_000,
    });
    const d = out.measurement.duration;
    return out.outcome === 'SUCCESS' && d.samples === 3 && d.p50 !== null && d.p95 !== null && d.p99 !== null;
  });
  asyncTest('runner never persists secret-shaped output', async () => {
    const out = await runBenchmark(
      { command: 'node -e "console.log(\'Authorization: Bearer supersecret123\')"' },
      { warmupRuns: 0, measurementRuns: 1, timeoutPerRunMs: 10_000 },
    );
    const blob = JSON.stringify(out);
    return !blob.includes('supersecret123');
  });
  asyncTest('runner bounds oversized output (truncated)', async () => {
    const out = await runBenchmark(
      { command: 'node -e "process.stdout.write(\'x\'.repeat(64 * 1024))"' },
      { warmupRuns: 0, measurementRuns: 1, timeoutPerRunMs: 10_000, stdoutMaxBytes: 4 * 1024 },
    );
    // captured bytes must stay under a small multiple of the cap
    return out.measurement.stdoutBytes <= 8 * 1024;
  });

  // Resolve async tests.
  const resolved = [];
  for (const r of results) {
    if (r.pending) {
      try {
        const ok = await r.pending();
        resolved.push({ name: r.name, pass: ok });
      } catch (err) {
        resolved.push({ name: r.name, pass: false, error: String(err && err.message ? err.message : err) });
      }
    } else {
      resolved.push(r);
    }
  }

  const failed = resolved.filter((r) => !r.pass);
  const summary = {
    total: resolved.length,
    failed: failed.length,
    passed: resolved.length - failed.length,
    error: failed.filter((r) => r.error).length,
    failures: failed.map((r) => r.name),
    results: resolved,
  };
  return summary;
}
