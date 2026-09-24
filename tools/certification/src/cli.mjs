#!/usr/bin/env node
// tools/certification/src/cli.mjs — command-line entry point.
//
// Subcommands:
//   fingerprint [--repo-dir DIR]     print deterministic environment fingerprint (JSON)
//   run --command CMD [opts] OUT     run a benchmark, write result JSON to OUT
//   validate FILE...                 validate result bundle(s) against the schema
//   compare BASE CAND                compare two result bundles (verdict + report)
//   report BASE CAND [OUT]           write deterministic report (text + JSON)
//   self-test                        run the offline test suite (prints JSON)

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HELP = `p21-certification <command>

commands:
  fingerprint [--repo-dir DIR]     environment fingerprint (JSON to stdout)
  run --command CMD [opts] OUT     benchmark a command, write result to OUT (- for stdout)
  validate FILE...                 schema-validate result bundle(s)
  compare BASE CAND                reproducibility verdict + report (JSON to stdout)
  report BASE CAND [OUT.json]      write report (text to stdout + json when OUT given)
  self-test                        run offline self-test suite

run options:
  --warmup N         warmup runs (default 1)
  --measure N        measurement runs (default 5)
  --timeout MS       per-run timeout ms (default 30000)
  --drop-on-fail     treat non-zero exit as failure (default; recorded, not retried)
  --keep-going       do not stop on process error (still recorded)
  --note TEXT        optional note (stored verbatim under 'note')
  --commit SHA       repository commit/ref (else probed via --repo-dir git)
  --repo-dir DIR     repo directory for git commit probe (path never persisted)
`;

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(HELP);
    return 0;
  }

  const { fingerprintForRepo } = await import('./fingerprint.mjs');
  const { validateResult, serializeResult } = await import('./schema.mjs');
  const { runBenchmark, DEFAULT_RUNNER_LIMITS } = await import('./runner.mjs');
  const { compareResults, VERDICT } = await import('./comparator.mjs');
  const { generateReports } = await import('./report.mjs');
  const { canonicalJSON } = await import('./util.mjs');
  const { TOOL_NAME, TOOL_VERSION, SCHEMA_VERSION } = await import('./version.mjs');
  const { readResult } = await import('./fileio.mjs');

  if (cmd === 'fingerprint') {
    const opts = parseFlags(rest);
    const fingerprint = fingerprintForRepo(opts['repo-dir'] || process.cwd(), { argv: [] });
    process.stdout.write(canonicalJSON(fingerprint, 2) + '\n');
    return 0;
  }

  if (cmd === 'run') {
    const opts = parseFlags(rest);
    const outPath = opts._[0];
    if (!opts['command']) {
      process.stderr.write('run: --command is required\n');
      return 2;
    }
    const limits = {
      warmupRuns: opts['warmup'] !== undefined ? Number(opts['warmup']) : DEFAULT_RUNNER_LIMITS.warmupRuns,
      measurementRuns: opts['measure'] !== undefined ? Number(opts['measure']) : DEFAULT_RUNNER_LIMITS.measurementRuns,
      timeoutPerRunMs: opts['timeout'] !== undefined ? Number(opts['timeout']) : DEFAULT_RUNNER_LIMITS.timeoutPerRunMs,
    };
    const runnerOut = await runBenchmark({ command: opts['command'] }, limits);
    const fingerprint = fingerprintForRepo(opts['repo-dir'] || process.cwd(), { argv: [opts['command']] });

    const result = {
      schemaVersion: SCHEMA_VERSION,
      tool: { name: TOOL_NAME, version: TOOL_VERSION },
      runId: makeRunId(),
      timestamp: Date.now(),
      startedAt: runnerOut.startedAt,
      completedAt: runnerOut.completedAt,
      commit: opts['commit'] || fingerprint.commit || null,
      command: opts['command'],
      note: opts['note'] || null,
      commandMeta: fingerprint.commandMeta,
      environment: fingerprint,
      measurement: runnerOut.measurement,
      diagnostics: runnerOut.diagnostics,
      outcome: runnerOut.outcome,
    };

    const text = serializeResult(result);
    if (outPath && outPath !== '-') {
      const { writeText } = await import('./fileio.mjs');
      writeText(outPath, text);
      process.stderr.write(`wrote ${outPath} (${result.outcome}, ${result.measurement.duration.samples} samples)\n`);
    } else {
      process.stdout.write(text);
    }
    return result.outcome === 'SUCCESS' ? 0 : 1;
  }

  if (cmd === 'validate') {
    const { readResult } = await import('./fileio.mjs');
    let allOk = true;
    for (const f of optsFiles(rest)) {
      const parsed = readResult(f);
      const v = validateResult(parsed.json);
      process.stdout.write(`${f}: ${v.ok ? 'VALID' : 'INVALID — ' + v.errors.join('; ')}\n`);
      if (!v.ok) allOk = false;
    }
    return allOk ? 0 : 1;
  }

  if (cmd === 'compare') {
    const [baseFile, candFile] = optsFiles(rest);
    if (!baseFile || !candFile) {
      process.stderr.write('compare: BASE and CAND required\n');
      return 2;
    }
    const base = readResult(baseFile).json;
    const cand = readResult(candFile).json;
    const comparison = compareResults(base, cand);
    const reports = generateReports(base, cand, comparison);
    process.stdout.write(canonicalJSON({ verdict: comparison.verdict, reasons: comparison.reasons, report: reports.json }, 2) + '\n');
    return comparison.verdict === VERDICT.REPRODUCIBLE ? 0 : 1;
  }

  if (cmd === 'report') {
    const files = optsFiles(rest);
    const baseFile = files[0];
    const candFile = files[1];
    const outJson = files[2];
    if (!baseFile || !candFile) {
      process.stderr.write('report: BASE and CAND required\n');
      return 2;
    }
    const base = readResult(baseFile).json;
    const cand = readResult(candFile).json;
    const comparison = compareResults(base, cand);
    const reports = generateReports(base, cand, comparison);
    if (outJson && outJson !== '-') {
      const { writeText } = await import('./fileio.mjs');
      writeText(outJson, canonicalJSON(reports.json, 2) + '\n');
      process.stderr.write(`wrote ${outJson}\n`);
    }
    process.stdout.write(reports.text);
    return 0;
  }

  if (cmd === 'self-test') {
    const { runSelfTests } = await import('./selftest.mjs');
    const summary = await runSelfTests();
    process.stdout.write(canonicalJSON(summary, 2) + '\n');
    return summary.failed === 0 && summary.error === 0 ? 0 : 1;
  }

  process.stderr.write(`unknown command: ${cmd}\n`);
  return 2;
}

function parseFlags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function optsFiles(args) {
  return parseFlags(args)._;
}

function makeRunId() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const ymd = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const hms = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `run-${ymd}-${hms}-${Math.floor(d.getUTCMilliseconds()).toString(36)}`;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`fatal: ${err && err.message ? err.message : err}\n`);
    process.exitCode = 1;
  },
);
