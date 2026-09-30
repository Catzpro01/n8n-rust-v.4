// Self-hosted-only CI check classifier and merge-readiness verdict.
// PURE: jobs come from the GitHub Actions jobs API ({ name, status, conclusion, labels }).
//
// Repository CI execution is self-hosted-only. GitHub Actions is control plane only;
// GitHub-hosted runners are never repository CI capacity and never serve as a merge
// or readiness fallback.
//
// Verdict values:
//   ALL_GREEN        every self-hosted check is green, no check failed, and no check is
//                    pending, running, or waiting for a self-hosted runner
//   WAITING_RUNNER   at least one self-hosted check is queued with no matching online
//                    self-hosted runner available (exhaustionState = 'BLOCKED_WITH_EVIDENCE');
//                    never treated as PASS and never licenses a merge
//   PENDING          a check is still running or queued with an online runner able to take it
//   BLOCKED          no checks ran, a check failed, or no self-hosted check passed

export const OK = new Set(['success', 'neutral', 'skipped']);
const QUEUED = new Set(['queued', 'waiting', 'requested', 'pending']);
const norm = (s) => String(s).toLowerCase();
const labelSet = (arr = []) => new Set(arr.map((l) => norm(typeof l === 'string' ? l : l?.name ?? '')));

export const isSelfHosted = (job) => labelSet(job.labels).has('self-hosted');

/** True if at least one online runner carries every label the job asks for. */
function runnerCanTake(job, onlineRunners) {
  if (!Array.isArray(onlineRunners)) return true; // unknown -> do not claim WAITING_RUNNER
  const need = [...labelSet(job.labels)];
  return onlineRunners.some((r) => {
    const have = labelSet(r.labels);
    return need.every((l) => have.has(l));
  });
}

export function classifyChecks(jobs, { onlineRunners } = {}) {
  const out = {
    hosted: { pass: [], fail: [], pending: [] },
    selfHosted: { pass: [], fail: [], running: [], waitingRunner: [] },
    verdict: 'PENDING',
    exhaustionState: 'NONE',
    mergeAllowed: false,
    hostedFallbackAllowed: false,
    deferredRunnerChecks: [],
    reasons: [],
  };
  for (const j of jobs) {
    const done = j.status === 'completed';
    if (!isSelfHosted(j)) {
      if (done) (OK.has(j.conclusion) ? out.hosted.pass : out.hosted.fail).push(j.name);
      else out.hosted.pending.push(j.name);
      continue;
    }
    if (done) (OK.has(j.conclusion) ? out.selfHosted.pass : out.selfHosted.fail).push(j.name);
    else if (QUEUED.has(j.status) && !runnerCanTake(j, onlineRunners)) out.selfHosted.waitingRunner.push(j.name);
    else out.selfHosted.running.push(j.name);
  }
  const failed = [...out.hosted.fail, ...out.selfHosted.fail];
  if (!jobs.length) {
    out.verdict = 'BLOCKED';
    out.reasons.push('no checks ran on this head: not treated as green');
  } else if (failed.length) {
    out.verdict = 'BLOCKED';
    out.reasons.push(`failed: ${failed.join(', ')}`);
  } else if (out.selfHosted.waitingRunner.length) {
    out.verdict = 'WAITING_RUNNER';
    out.exhaustionState = 'BLOCKED_WITH_EVIDENCE';
    out.deferredRunnerChecks = [...new Set(out.selfHosted.waitingRunner)].sort();
    out.reasons.push(`self-hosted WAITING_RUNNER / BLOCKED_WITH_EVIDENCE (not PASS): ${out.deferredRunnerChecks.join(', ')}`);
  } else if (out.hosted.pending.length || out.selfHosted.running.length) {
    out.verdict = 'PENDING';
    out.reasons.push(`waiting for: ${[...out.hosted.pending, ...out.selfHosted.running].join(', ')}`);
  } else if (!out.selfHosted.pass.length) {
    out.verdict = 'BLOCKED';
    out.reasons.push('no self-hosted check passed: GitHub-hosted runners are not repository CI capacity');
  } else {
    out.verdict = 'ALL_GREEN';
  }
  out.mergeAllowed = out.verdict === 'ALL_GREEN';
  return out;
}

/** One-line transparent status, e.g. "Self-hosted: PASS 6/6 | Hosted fallback: disabled | Merge: ALL_GREEN". */
export function formatChecks(c) {
  const sh = c.selfHosted;
  const selfTotal = sh.pass.length + sh.fail.length + sh.running.length + sh.waitingRunner.length;
  const selfState = sh.fail.length ? 'FAIL'
    : sh.waitingRunner.length ? 'WAITING_RUNNER (BLOCKED_WITH_EVIDENCE)'
    : sh.running.length ? 'RUNNING'
    : selfTotal ? 'PASS' : 'NONE';
  return `Self-hosted: ${selfState} ${sh.pass.length}/${selfTotal}${sh.waitingRunner.length ? ` (${c.deferredRunnerChecks.join(', ')})` : ''} | Hosted fallback: disabled | Merge: ${c.verdict}`;
}
