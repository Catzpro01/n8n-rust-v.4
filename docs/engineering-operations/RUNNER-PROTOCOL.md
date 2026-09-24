# Runner protocol — self-hosted CI runners, polling and job monitoring

**Status:** authoritative. **Owner:** manager. **Anchor:** Issue #256 (governance reset; mandate #254 §10–§11).
**Machine-readable twin:** `docs/engineering-operations/workforce-governance.json` → `runnerProtocol`.
**Generated view:** `.ai/master/PROJECT_WORKFORCE_ORCHESTRATION.md` → "Runner protocol" (rendered by
`tools/lego/ai-pack.mjs`; edit this document and the JSON block, then run `npm run lego:ai`).

> Scope boundary: this is ENGINEERING OPERATIONS (how the repository is built and verified),
> not n8n LEGO product architecture. Nothing here is a product domain or capability.

## 1. Runner inventory (fixed: 5 Windows + 5 WSL = 10)

The architecture is ten self-hosted runners. Do not reduce the count or change the architecture
without a Manager decision recorded in the canonical register.

| # | Runner name | OS | Labels |
| --- | --- | --- | --- |
| W1 | `laptop-build-worker` | Windows | `self-hosted, Windows, X64, rust-build, n8n-rust` |
| W2 | `laptop-build-worker-2` | Windows | `self-hosted, Windows, X64, rust-build, n8n-rust` |
| W3 | `laptop-build-worker-3` | Windows | `self-hosted, Windows, X64, rust-build, n8n-rust` |
| W4 | `laptop-build-worker-4` | Windows | `self-hosted, Windows, X64, rust-build, n8n-rust` |
| W5 | `laptop-build-worker-5` | Windows | `self-hosted, Windows, X64, rust-build, n8n-rust` |
| L1 | `MDMTEST-n8n-wsl` | Linux (WSL) | `self-hosted, Linux, X64, rust-build, n8n-rust` |
| L2 | `MDMTEST-n8n-wsl-2` | Linux (WSL) | `self-hosted, Linux, X64, rust-build, n8n-rust` |
| L3 | `MDMTEST-n8n-wsl-3` | Linux (WSL) | `self-hosted, Linux, X64, rust-build, n8n-rust` |
| L4 | `MDMTEST-n8n-wsl-4` | Linux (WSL) | `self-hosted, Linux, X64, rust-build, n8n-rust` |
| L5 | `MDMTEST-n8n-wsl-5` | Linux (WSL) | `self-hosted, Linux, X64, rust-build, n8n-rust` |

**Observed** (GitHub API `GET /repos/{owner}/{repo}/actions/runners`, governance reset #256):
10 runners, all `online`, none `busy`, with exactly the labels above. GitHub-hosted
`ubuntu-latest` jobs in `.github/workflows/n8n-lego.yml` and `typescript-runtime.yml` are not part of
this inventory and are unaffected.

## 2. Runner selection

1. Jobs select runners **by label, never by name**. Windows jobs use
   `[self-hosted, windows, x64, rust-build, n8n-rust]`; Linux/WSL jobs use
   `[self-hosted, linux, x64, rust-build, n8n-rust]` (GitHub label matching is case-insensitive).
2. A job needing either OS may use the common labels `[self-hosted, x64, rust-build, n8n-rust]`,
   which lets GitHub place it on any of the 10 runners.
3. Matrix fan-out may use at most 10 parallel self-hosted jobs; more simply queues.
4. No workflow may pin a single runner name — that silently reduces the fleet to 1.

## 3. Polling interval — at most 1 second

**Rule:** every wait for a runner, CI run, job, health endpoint, process or queue polls with a
**sleep of at most 1 second — prefer exactly 1s**.

Forbidden in wait loops: `sleep 2`, `sleep 5`, `sleep 10`, `sleep 30`, `sleep 60`,
`time.sleep(n > 1)`, `Start-Sleep -Seconds n > 1`, `setTimeout(fn, ms > 1000)`,
`setInterval(fn, ms > 1000)`, and exponential backoff whose step exceeds 1 second.

A total **timeout** is still required; express it as a bounded number of 1-second attempts
(e.g. `for attempt in $(seq 1 180); do …; sleep 1; done` = 180 s budget).

**The only exception:** a documented external API rate limit (e.g. GitHub REST secondary rate
limit, `Retry-After`, or a provider 429). The exception must name the API and the limit in a
comment next to the wait, and must honour the server-provided delay rather than a guessed one.

**Decoupling rule:** a loop may wake every 1 second while *emitting* an expensive external call
on its own slower cadence (e.g. a worker heartbeat to an external API every 15 s). Waking at 1 s
does not multiply the external call rate; sleeping 15 s in one call is what is forbidden.

**Not in scope** (these are not waits for runners, jobs or CI and keep their semantics):
security controls such as the login failure backoff in `apps/n8n-lego/src/auth/account-routes.mjs`,
and upstream n8n wire-compatibility constants such as the 60 s realtime ping interval.

### Enforcement applied in the reset (#256)

| File | Before | After |
| --- | --- | --- |
| `.github/workflows/n8n-lego.yml` (health wait) | 90 × `sleep 2` | 180 × `sleep 1` (same 180 s budget) |
| `.github/workflows/n8n-lego.yml` (restart wait) | 60 × `sleep 2` | 120 × `sleep 1` (same 120 s budget) |
| `apps/n8n-lego/scripts/install-tarball.sh` | `sleep 2` once | ≤ 5 × `sleep 1`, exits as soon as the unit is active |
| `tools/gateway/orchestrator_daemon.py` | tick every 10 s | tick every ≤ 1 s |
| `tools/gateway/worker_agent.py` | `sleep(15)` heartbeat | wake every 1 s, emit heartbeat every 15 s (decoupling rule) |
| `tools/orchestration/supervisor_daemon.py` | poll 5 s | poll ≤ 1 s |
| `tools/orchestration/supervisor_recovery_loop.py` | 5 s | ≤ 1 s |
| `tools/orchestration/continuous_worker_engine.py` | default 5 s | default 1 s |
| `tools/orchestration/persistent_worker_process.py` | poll 3 s | poll ≤ 1 s |

The Python suites `tools/orchestration/tests` + `tools/gateway/tests` gave the identical result
before and after (126 pass, 10 fail). The 10 failures are environmental and pre-existing: they
need a live control plane (HTTP 0/400 instead of 200, laptop webhook offline, Supabase task rows
and worker PIDs absent in the sandbox).

## 4. Retry

- Retry a failed **job** at most **2** times, and only for failures classified as environmental
  (runner lost, network, checkout/cache infrastructure). Never retry to "get green" on an
  implementation failure.
- Retries of individual **polls** are the 1-second loop itself; there is no backoff above 1 s.
- Every retry is logged with the classification (observed / environmental / implementation).

## 5. Failure handling

1. Classify first: **implementation**, **environmental**, **pre-existing** (reproduces on
   unmodified `main`), or **flaky** (does not reproduce on 3 identical reruns).
2. Implementation failures block the merge. Environmental failures are re-run on another runner
   of the same OS. Pre-existing failures are recorded against `main` with evidence and never
   hidden by weakening a test, pin or gate.
3. A runner that fails 2 consecutive jobs for environmental reasons is reported offline in the
   run evidence; the remaining runners continue to take jobs.

## 6. Exhaustion (all runners of an OS busy or offline)

- Jobs queue in GitHub; the monitor keeps polling at 1 s and reports queue time.
- If no runner of the required OS comes online within the job's timeout, the job is reported
  **blocked (environmental)** — never skipped, never re-labelled onto GitHub-hosted runners to
  bypass a self-hosted requirement, and never recorded as passing.

## 7. GitHub Actions monitoring

- Monitor a head SHA with `GET /repos/{owner}/{repo}/commits/{sha}/check-runs`, polling at 1 s
  until every check run is `completed`, then record `conclusion` per check.
- A PR is mergeable only when all check runs on the **exact head SHA** are `success` (or an
  explicitly documented `skipped`/`neutral`), and the merge call pins that SHA
  (`PUT …/pulls/{n}/merge` with `"sha": <head>`).
- GitHub REST rate limits are the documented exception to §3: honour `Retry-After` /
  `x-ratelimit-reset` when present.

## 8. VPS job monitoring

- VPS jobs (`vps-runner-smoke.yml`, `[self-hosted, linux, x64, vps-runtime]`) follow the same
  1-second polling rule for health endpoints and process state.
- Health checks use `/rest/settings` (the app's `/healthz` returns 503 without the UI bundle).
- Long-running VPS processes are supervised (systemd), not waited on with long sleeps.

## 9. Workspace lifecycle

1. **Create:** a fresh checkout/clone per job; never reuse a dirty working tree.
2. **Use:** write temporary files under the runner temp directory, never into the repository.
3. **Clean:** after the job, remove temporary files, patches, logs, duplicate clones and
   stale worktrees. Keep dependency and build caches that speed up later jobs.
4. **Never commit** runtime artifacts. In particular `.arena/gateway_tokens.json` (generated
   locally by `tools/gateway/auth.py`) is gitignored and must never be added.
5. **Branches:** only `main` and `arena-manager` persist; temporary branches are deleted after
   merge (see the canonical register `governance.branchPolicy`).
