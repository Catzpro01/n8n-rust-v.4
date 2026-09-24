// tools/certification/src/runner.mjs — Deliverable C: benchmark runner.
//
// Executes an explicitly supplied command for warmup + repeated measurements.
// Fully bounded: per-run timeout, total timeout, output caps, drop policy.
// The command is executed as-is (no retry-until-success, no source edits).

import { spawn } from 'node:child_process';

import { OUTCOME } from './schema.mjs';
import { redact, hasSecretShaped } from './redact.mjs';
import { percentile, toMs, truncate } from './util.mjs';

export const DEFAULT_RUNNER_LIMITS = Object.freeze({
  env: {}, // deterministic isolation: no inherited environment
  timeoutPerRunMs: 30_000,
  dropOnNonZero: true,
  stdoutMaxBytes: 16 * 1024,
  stderrMaxBytes: 16 * 1024,
  stdoutMaxLines: 200,
  stderrMaxLines: 200,
  warmupRuns: 1,
  measurementRuns: 5,
  onSample: null, // optional callback per warmup sample
  onSampleMeasured: null,
});

function clampInt(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, Math.trunc(v)));
}

function validateLimits(limits) {
  const merged = { ...DEFAULT_RUNNER_LIMITS, ...limits };
  if (!merged.command || typeof merged.command !== 'string' || merged.command.trim() === '') {
    throw new Error('runner: command must be a non-empty string');
  }
  merged.warmupRuns = clampInt(merged.warmupRuns, 0, 1000);
  merged.measurementRuns = clampInt(merged.measurementRuns, 1, 100_000);
  merged.timeoutPerRunMs = clampInt(merged.timeoutPerRunMs, 1, 3_600_000);
  merged.stdoutMaxBytes = clampInt(merged.stdoutMaxBytes, 0, 1 << 20);
  merged.stderrMaxBytes = clampInt(merged.stderrMaxBytes, 0, 1 << 20);
  merged.stdoutMaxLines = clampInt(merged.stdoutMaxLines, 0, 50_000);
  merged.stderrMaxLines = clampInt(merged.stderrMaxLines, 0, 50_000);
  return merged;
}

/**
 * Run one command invocation. Returns a plain object (never throws for
 * process-level failures).
 */
function runOnce(command, limits, signal, callback) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      env: limits.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutLines = 0;
    let stderrLines = 0;
    let stdoutUpperBound = 0;
    let stderrUpperBound = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let stdoutSummary = '';
    let stderrSummary = '';

    let settled = false;
    let timedOut = false;
    let exited = null; // exit code when known

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve({
        startMs: startedMs,
        endMs: Date.now(),
        exitCode: exited,
        timedOut,
        stdoutBytes,
        stderrBytes,
        stdoutTruncated,
        stderrTruncated,
        stdoutCapBytes: limits.stdoutMaxBytes,
        stderrCapBytes: limits.stderrMaxBytes,
        stdoutSummary,
        stderrSummary,
        upperBoundOut,
        upperBoundErr,
      });
    };

    const startedMs = Date.now();
    let upperBoundOut = 0;
    let upperBoundErr = 0;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      finish();
    }, limits.timeoutPerRunMs);
    timer.unref?.();

    const onAbort = () => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      finish();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    let outEof = false;
    let errEof = false;
    const tryBufferFinish = () => {
      if (outEof && errEof && exited !== null) finish();
    };

    child.stdout.on('data', (chunk) => {
      const len = chunk.length;
      upperBoundOut += len;
      if (stdoutBytes + len > limits.stdoutMaxBytes) {
        stdoutTruncated = true;
        const take = limits.stdoutMaxBytes - stdoutBytes;
        if (take > 0) stdoutSummary += truncate(chunk.toString('utf8', 0, take), 256);
        stdoutBytes = limits.stdoutMaxBytes;
      } else {
        stdoutBytes += len;
        if (stdoutLines < limits.stdoutMaxLines) {
          stdoutSummary += chunk.toString('utf8');
          stdoutLines = stdoutSummary.split('\n').length - 1;
        } else {
          stdoutTruncated = true;
        }
      }
    });
    child.stdout.on('end', () => {
      outEof = true;
      tryBufferFinish();
    });

    child.stderr.on('data', (chunk) => {
      const len = chunk.length;
      upperBoundErr += len;
      if (stderrBytes + len > limits.stderrMaxBytes) {
        stderrTruncated = true;
        const take = limits.stderrMaxBytes - stderrBytes;
        if (take > 0) stderrSummary += truncate(chunk.toString('utf8', 0, take), 256);
        stderrBytes = limits.stderrMaxBytes;
      } else {
        stderrBytes += len;
        if (stderrLines < limits.stderrMaxLines) {
          stderrSummary += chunk.toString('utf8');
          stderrLines = stderrSummary.split('\n').length - 1;
        } else {
          stderrTruncated = true;
        }
      }
    });
    child.stderr.on('end', () => {
      errEof = true;
      tryBufferFinish();
    });

    child.on('error', () => {
      exited = exited === null ? 127 : exited;
      tryBufferFinish();
    });

    child.on('close', (code) => {
      exited = code === null ? 0 : code;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      tryBufferFinish();
    });
  });
}

/**
 * Run the benchmark. Returns the normalized result object (serde-ready).
 */
export async function runBenchmark(inputs, options = {}) {
  const limits = validateLimits({ ...DEFAULT_RUNNER_LIMITS, ...options, command: inputs.command });

  const startedAtIso = new Date().toISOString();
  const totalStart = process.hrtime.bigint();

  let total = 0;
  let failed = 0;
  let success = 0;
  let lastExitCode = null;
  let timedOut = false;
  let anyTruncated = false;
  let outBytes = 0;
  let errBytes = 0;
  let outCap = 0;
  let errCap = 0;
  let lastSampleSummary = null;

  const samples = [];
  const warmupSamples = [];
  const pushSample = (r) => {
    const ms = toMs(process.hrtime.bigint() - totalStart);
    if (r.durationMs !== undefined) samples.push(r.durationMs);
    return ms;
  };

  const runLoop = async (count, isWarmup) => {
    for (let i = 0; i < count; i += 1) {
      const r = await runOnce(limits.command, limits, options.signal);
      outBytes += r.stdoutBytes;
      errBytes += r.stderrBytes;
      outCap = Math.max(outCap, r.stdoutCapBytes);
      errCap = Math.max(errCap, r.stderrCapBytes);
      if (r.stdoutTruncated || r.stderrTruncated) anyTruncated = true;
      if (r.timedOut) timedOut = true;

      total += 1;
      if (r.exitCode === 0) success += 1;
      else failed += 1;
      lastExitCode = r.exitCode;

      const sample = { runIndex: i, durationMs: r.endMs - r.startMs, exitCode: r.exitCode };
      if (isWarmup) {
        warmupSamples.push(sample);
        if (limits.onSample) limits.onSample(sample.durationMs);
      } else {
        samples.push(sample.durationMs);
        lastSampleSummary = summarizeLastRun(r);
        if (limits.onSampleMeasured) limits.onSampleMeasured(sample);
      }

      // Exit-status honesty: a failed measurement is NOT replaced by a retry
      // and is NOT interpreted as a success. We keep counting runs; outcome is
      // set from the final aggregate below.
    }
  };

  await runLoop(limits.warmupRuns, true);
  await runLoop(limits.measurementRuns, false);

  const totalDurationMs = toMs(process.hrtime.bigint() - totalStart);
  const sorted = samples.slice().sort((a, b) => a - b);

  let outcome;
  if (timedOut) outcome = OUTCOME.TIMEOUT;
  else if (anyTruncated) outcome = OUTCOME.CAPTURE_LIMIT;
  else if (lastExitCode !== null && failed > 0) outcome = OUTCOME.FAILURE;
  else if (lastExitCode === null) outcome = OUTCOME.COMMAND_REJECTED;
  else outcome = OUTCOME.SUCCESS;

  const measurement = {
    warmupRuns: limits.warmupRuns,
    measurementRuns: limits.measurementRuns,
    duration: {
      unit: 'ms',
      values: samples,
      samples: samples.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
    },
    exitCode: lastExitCode,
    exitCodeOfLastRun: lastExitCode,
    failedRuns: failed,
    successRuns: success,
    stdoutBytes: outBytes,
    stderrBytes: errBytes,
  };

  const diagnostics = {};
  if (anyTruncated) diagnostics.captureTruncated = true;
  if (timedOut) diagnostics.timedOut = true;
  if (lastSampleSummary) diagnostics.lastRunSummary = lastSampleSummary;

  return {
    outcome,
    measurement,
    diagnostics,
    startedAt: startedAtIso,
    completedAt: new Date().toISOString(),
    totalDurationMs,
  };
}

function summarizeLastRun(r) {
  const width = Math.min(120, (r.stdoutBytes + r.stderrBytes) || 0);
  const joined = `${r.stdoutSummary || ''}${r.stderrSummary ? '\n' + r.stderrSummary : ''}`;
  let snippet = joined.slice(0, width);
  if (hasSecretShaped(snippet)) {
    snippet = redact(truncate(snippet, 512));
  }
  return {
    bytes: r.stdoutBytes + r.stderrBytes,
    snippet: snippet || '',
  };
}
