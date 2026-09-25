// DEC-0015: classify the exact-head checks of a PR into GitHub-hosted vs self-hosted and derive the
// merge verdict. PURE: jobs come from the GitHub Actions jobs API ({ name, status, conclusion, labels }).
//
//   ALL_GREEN            every check completed successfully
//   ALLOWED_BY_DEC-0015  every GitHub-hosted check is green, no check failed, and the remaining
//                        self-hosted checks are WAITING_RUNNER (queued, no online runner can take them)
//   PENDING              a GitHub-hosted check is not finished, or a self-hosted check is running /
//                        may still be picked up by an online runner (or runner availability is unknown)
//   BLOCKED              a check completed without success, or no check ran at all
//
// WAITING_RUNNER is never PASS: it is reported separately and becomes runner verification debt that
// the Slice (or manager-executed task) must clear before it can be COMPLETE.

const OK = new Set(['success', 'skipped', 'neutral']);
const QUEUED = new Set(['queued', 'waiting', 'pending', 'requested']);

export const isSelfHosted = (job) => (job.labels ?? []).includes('self-hosted');

/** Could an online runner take this job? onlineRunners: [{ labels: [...] }] or undefined (unknown). */
function runnerCanTake(job, onlineRunners) {
  if (onlineRunners === undefined) return true;
  const want = (job.labels ?? []).map((l) => l.toLowerCase());
  return onlineRunners.some((r) => {
    const have = new Set((r.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name).toLowerCase()));
    return want.every((l) => have.has(l));
  });
}

export function classifyChecks(jobs, { onlineRunners } = {}) {
  const out = {
    hosted: { pass: [], fail: [], pending: [] },
    selfHosted: { pass: [], fail: [], running: [], waitingRunner: [] },
    verdict: 'PENDING', mergeAllowed: false, deferredRunnerChecks: [], reasons: [],
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
  if (!jobs.length) { out.verdict = 'BLOCKED'; out.reasons.push('no checks ran on this head: not treated as green'); }
  else if (failed.length) { out.verdict = 'BLOCKED'; out.reasons.push(`failed: ${failed.join(', ')}`); }
  else if (out.hosted.pending.length || out.selfHosted.running.length) {
    out.verdict = 'PENDING';
    out.reasons.push(`waiting for: ${[...out.hosted.pending, ...out.selfHosted.running].join(', ')}`);
  } else if (!out.hosted.pass.length) {
    out.verdict = 'BLOCKED'; out.reasons.push('no GitHub-hosted check passed: a merge needs at least one hosted gate');
  } else if (out.selfHosted.waitingRunner.length) {
    out.verdict = 'ALLOWED_BY_DEC-0015';
    out.deferredRunnerChecks = [...new Set(out.selfHosted.waitingRunner)].sort();
    out.reasons.push(`self-hosted WAITING_RUNNER (not PASS): ${out.deferredRunnerChecks.join(', ')}`);
  } else out.verdict = 'ALL_GREEN';
  out.mergeAllowed = out.verdict === 'ALL_GREEN' || out.verdict === 'ALLOWED_BY_DEC-0015';
  return out;
}

/** One-line transparent status, e.g. "GitHub-hosted: PASS 7/7 | Self-hosted: WAITING_RUNNER 4 | Merge: ALLOWED_BY_DEC-0015". */
export function formatChecks(c) {
  const hostedTotal = c.hosted.pass.length + c.hosted.fail.length + c.hosted.pending.length;
  const hosted = c.hosted.fail.length ? 'FAIL' : c.hosted.pending.length ? 'PENDING' : 'PASS';
  const sh = c.selfHosted;
  const selfState = sh.fail.length ? 'FAIL' : sh.running.length ? 'PENDING' : sh.waitingRunner.length ? 'WAITING_RUNNER' : sh.pass.length ? 'PASS' : 'NONE';
  const merge = c.verdict === 'ALL_GREEN' ? 'ALLOWED' : c.verdict === 'ALLOWED_BY_DEC-0015' ? 'ALLOWED_BY_DEC-0015' : c.verdict;
  return `GitHub-hosted: ${hosted} ${c.hosted.pass.length}/${hostedTotal} | Self-hosted: ${selfState}${sh.waitingRunner.length ? ` ${sh.waitingRunner.length} (${sh.waitingRunner.join(', ')})` : ''} | Merge: ${merge}`;
}
