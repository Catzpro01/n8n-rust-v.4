// tools/certification/src/report.mjs — Deliverable E: deterministic report
// generator (JSON + text).
//
// Only metrics actually present on both sides are compared. Verdict is
// copied from the comparator; no faster/better/more-stable language is
// emitted without evidence.

import { canonicalJSON } from './util.mjs';

function fmtNum(v) {
  if (v == null) return 'n/a';
  return Number.isFinite(v) ? (Math.round(v * 1000) / 1000).toString() : 'n/a';
}

function fmtInt(v) {
  if (v == null) return 'n/a';
  return Number.isInteger(v) ? String(v) : 'n/a';
}

function row(label, base, cand) {
  return `${label.padEnd(22)} base=${base.padEnd(12)} cand=${cand.padEnd(12)} Δ=${fmtDelta(base, cand)}`;
}

function fmtDelta(base, cand) {
  if (base == null || cand == null) return 'n/a';
  const b = Number(base);
  const c = Number(cand);
  if (!Number.isFinite(b) || !Number.isFinite(c) || b === 0) return 'n/a';
  const d = ((c - b) / b) * 100;
  return `${d >= 0 ? '+' : ''}${(Math.round(d * 100) / 100)}%`;
}

/**
 * Generate a deterministic text report and a JSON report.
 * `{ baselineResult, candidateResult, comparison }`.
 */
export function generateReports(baseline, candidate, comparison) {
  const bm = baseline.measurement || {};
  const cm = candidate.measurement || {};
  const bd = bm.duration || {};
  const cd = cm.duration || {};

  const available = { p50: true, p95: true, p99: true };
  for (const p of ['p50', 'p95', 'p99']) {
    if (bd[p] == null && cd[p] == null) available[p] = false;
  }

  const deltaPct = {};
  for (const p of ['p50', 'p95', 'p99']) {
    if (available[p] && Number.isFinite(Number(bd[p])) && Number(bd[p]) !== 0) {
      deltaPct[p] = Math.round((((Number(cd[p]) - Number(bd[p])) / Number(bd[p])) * 100) * 100) / 100;
    } else {
      deltaPct[p] = null;
    }
  }

  // Deterministic: derived from the candidate's own timestamp, never wall clock.
  const deterministicTs = Math.max(
    Number(baseline.timestamp) || 0,
    Number(candidate.timestamp) || 0,
  );

  const declarations = {
    generatedAt: new Date(deterministicTs).toISOString(),
    tool: baseline.tool,
    schemaVersion: baseline.schemaVersion,
    baselineRunId: baseline.runId,
    candidateRunId: candidate.runId,
  };

  const json = {
    declarations,
    comparison: {
      verdict: comparison.verdict,
      reasons: comparison.reasons,
    },
    environment: {
      baseline: baseline.environment || null,
      candidate: candidate.environment || null,
    },
    command: {
      baseline: baseline.command,
      candidate: candidate.command,
    },
    metrics: {
      sampleCount: {
        baseline: bd.samples ?? null,
        candidate: cd.samples ?? null,
      },
      p50: { baseline: available.p50 ? fmtNum(bd.p50) : 'Missing', candidate: available.p50 ? fmtNum(cd.p50) : 'Missing', deltaPct: deltaPct.p50 },
      p95: { baseline: available.p95 ? fmtNum(bd.p95) : 'Missing', candidate: available.p95 ? fmtNum(cd.p95) : 'Missing', deltaPct: deltaPct.p95 },
      p99: { baseline: available.p99 ? fmtNum(bd.p99) : 'Missing', candidate: available.p99 ? fmtNum(cd.p99) : 'Missing', deltaPct: deltaPct.p99 },
    },
    failure: {
      baselineOutcome: baseline.outcome,
      candidateOutcome: candidate.outcome,
      baselineExitCode: bm.exitCode ?? null,
      candidateExitCode: cm.exitCode ?? null,
      baselineFailedRuns: bm.failedRuns ?? null,
      candidateFailedRuns: cm.failedRuns ?? null,
    },
    missingEvidence: comparison.reasons
      .filter((r) => ['missingMetrics', 'sampleCount'].includes(r.key))
      .map((r) => ({ key: r.key, baseline: r.baseline, candidate: r.candidate })),
  };

  const lines = [];
  lines.push('=== p21-certification report ===');
  lines.push(`generatedAt : ${declarations.generatedAt}`);
  lines.push(`tool        : ${declarations.tool.name}@${declarations.tool.version} (${declarations.schemaVersion})`);
  lines.push(`baseline    : ${declarations.baselineRunId}`);
  lines.push(`candidate   : ${declarations.candidateRunId}`);
  lines.push(`verdict     : ${comparison.verdict}`);
  if (comparison.reasons.length > 0) {
    lines.push('reasons:');
    for (const r of comparison.reasons) {
      lines.push(`  - ${r.key}: base=${JSON.stringify(r.baseline)} cand=${JSON.stringify(r.candidate)}`);
    }
  }
  lines.push('');
  lines.push('metrics (latency ms):');
  lines.push(row('samples', fmtInt(bd.samples), fmtInt(cd.samples)));
  lines.push(row('p50', available.p50 ? fmtNum(bd.p50) : 'Missing', available.p50 ? fmtNum(cd.p50) : 'Missing'));
  lines.push(row('p95', available.p95 ? fmtNum(bd.p95) : 'Missing', available.p95 ? fmtNum(cd.p95) : 'Missing'));
  lines.push(row('p99', available.p99 ? fmtNum(bd.p99) : 'Missing', available.p99 ? fmtNum(cd.p99) : 'Missing'));
  lines.push('');
  lines.push('failure information:');
  lines.push(`  baseline outcome: ${baseline.outcome} (exit ${fmtInt(bm.exitCode)}, failedRuns ${fmtInt(bm.failedRuns)})`);
  lines.push(`  candidate outcome: ${candidate.outcome} (exit ${fmtInt(cm.exitCode)}, failedRuns ${fmtInt(cm.failedRuns)})`);
  if (json.missingEvidence.length > 0) {
    lines.push('missing evidence:');
    for (const m of json.missingEvidence) {
      lines.push(`  - ${m.key}`);
    }
  } else {
    lines.push('missing evidence: none');
  }
  lines.push('');
  lines.push('note: no faster/better/stable/pre-production claim is made; verdict is evidence-based only.');

  return { json: JSON.parse(canonicalJSON(json, 2)), text: lines.join('\n') + '\n' };
}
