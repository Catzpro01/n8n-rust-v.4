# Self-Hosted Runner Protocol

**Owner:** Manager  
**Anchor:** Governance Reset (Issue #256)  
**Machine-readable mirror:** `docs/engineering-operations/workforce-governance.json` (`runnerProtocol`)  
**Generated view:** `.ai/master/PROJECT_WORKFORCE_ORCHESTRATION.md` (`npm run lego:ai`)

---

## 0. Self-Hosted-Only Execution Mandate & Control-Plane Boundary

1. **Self-hosted-only CI execution:** Every active repository CI, test, build, and release job in `.github/workflows/*.yml` executes exclusively on the repository's self-hosted runner fleet. Zero active workflow jobs may use `ubuntu-latest`, `windows-latest`, `macos-latest`, or any other GitHub-hosted runner label.
2. **GitHub is control plane, not execution compute:** GitHub Actions is used strictly as the control plane for workflow orchestration, check-run reporting, and `workflow_job` webhook dispatch.
3. **GitHub-hosted runners are not repository CI capacity:** Repository CI readiness and merge gates have zero dependency on GitHub-hosted runner minutes, spending limits, billing state, or plan upgrades. Plan upgrades or hosted-runner substitutions are never used as repository CI recovery.
4. **Runner unavailability is an honest environmental blocker (`WAITING_RUNNER` / `BLOCKED_WITH_EVIDENCE`):** When no matching self-hosted runner is available, queued jobs are classified explicitly as `WAITING_RUNNER` / `BLOCKED_WITH_EVIDENCE` — never silently substituted with a GitHub-hosted runner and never claimed as `PASS`. Remote-capable engineering work (`PHASE_A_REMOTE`) continues outside the blocked validation lane until self-hosted capacity returns.
5. **Supersession of temporary hosted-fallback rules:** All prior "while self-hosted runners are offline, merge on GitHub-hosted gates" operating language (historical `DEC-0015` hosted-gate merge allowance and historical `DEC-0025`) is superseded as an active rule. Historical records remain only in explicitly historical decision/evidence archives.

---

## 1. Runner inventory (canonical)

The architecture is ten self-hosted runners. Do not reduce the count or change the architecture without an explicit Manager decision.

| # | Runner name | OS | Labels |
| --- | --- | --- | --- |
| 1 | `laptop-build-worker` | Windows x64 (`laptop-build-worker-1..10` pool) | `self-hosted, Windows, X64, rust-build, n8n-rust` |
| 2 | `laptop-build-worker-2` | Windows x64 | `self-hosted, Windows, X64, rust-build, n8n-rust` |
| 3 | `laptop-build-worker-3` | Windows x64 | `self-hosted, Windows, X64, rust-build, n8n-rust` |
| 4 | `laptop-build-worker-4` | Windows x64 | `self-hosted, Windows, X64, rust-build, n8n-rust` |
| 5 | `laptop-build-worker-5` | Windows x64 | `self-hosted, Windows, X64, rust-build, n8n-rust` |
| 6 | `MDMTEST-n8n-wsl` | WSL Linux x64 | `self-hosted, Linux, X64, rust-build, n8n-rust` |
| 7 | `MDMTEST-n8n-wsl-2` | WSL Linux x64 | `self-hosted, Linux, X64, rust-build, n8n-rust` |
| 8 | `MDMTEST-n8n-wsl-3` | WSL Linux x64 | `self-hosted, Linux, X64, rust-build, n8n-rust` |
| 9 | `MDMTEST-n8n-wsl-4` | WSL Linux x64 | `self-hosted, Linux, X64, rust-build, n8n-rust` |
| 10 | `MDMTEST-n8n-wsl-5` | WSL Linux x64 | `self-hosted, Linux, X64, rust-build, n8n-rust` |

Additional dedicated smoke target:
- VPS runtime smoke runner: `[self-hosted, Linux, X64, vps-runtime]` (`.github/workflows/vps-runner-smoke.yml`).

**Linux execution on Windows self-hosted workers:** Linux-targeted CI jobs (`validation.yml`, `integration.yml`, `typescript-runtime.yml`, `n8n-lego.yml`, `cleanup.yml`) run on `[self-hosted, Windows, X64, rust-build, n8n-rust]` inside pinned local Linux Docker images (`n8n-rust-runner:latest`, `n8n-node-ci:latest`) via `tools/ci/run-linux-container.ps1` (`--pull=never`), or via WSL where probed.

---

## 2. Selection and concurrency

- Select by **label**, never by runner hostname:
  - Windows / Linux-container pool: `runs-on: [self-hosted, Windows, X64, rust-build, n8n-rust]`
  - Native Linux pool: `runs-on: [self-hosted, Linux, X64, rust-build, n8n-rust]`
  - VPS smoke target: `runs-on: [self-hosted, Linux, X64, vps-runtime]`
- Total self-hosted concurrency is bounded by the 10-runner pool (at most 10 parallel self-hosted jobs).
- Workflows use `concurrency` with `cancel-in-progress: true` on non-`main` refs so superseded PR pushes release runners immediately.

---

## 3. Polling & sleep interval rule (<= 1 s)

> **Rule:** Every active polling loop that waits for a runner, CI run, job status, health endpoint, local process, or queue transition **must sleep at most 1 second** (`sleep 1`, `time.sleep(1)`, `Start-Sleep -Seconds 1`, `setTimeout(..., <= 1000)`) per iteration, bounded by an explicit maximum attempt count or wall-clock deadline.

- **Preferred interval:** `1 s` (`<= 1 s` where sub-second readiness checks are appropriate).
- **Forbidden in active polling loops:** `sleep 2`, `sleep 5`, `sleep 10`, `sleep 30`, `sleep 60`, `setTimeout`/`setInterval` > `1000` ms, or multi-second backoff steps (`2s / 5s / 10s`).
- **Why:** Multi-second sleeps hide state transitions, delay runner release, and waste wall-clock budget. A 180 s timeout is `180 x 1 s`, not `36 x 5 s`.
- **Single permitted exception:** Documented **external API rate limits** (e.g. GitHub REST secondary rate limit or `Retry-After` header). The code comment next to the wait must name the external API and its rate limit, and the wait must honour `Retry-After` / `x-ratelimit-reset` rather than a blind fixed sleep.
- **Decoupling rule:** If an external call is rate-limited or expensive, the local state/health loop still wakes every `<= 1 s` and only emits the external network request on its own slower cadence.

### Enforced locations

| File | Previous | Now |
| --- | --- | --- |
| `.github/workflows/n8n-lego.yml` (health wait) | 90 x `sleep 2` | 180 x `sleep 1` (same 180 s budget) |
| `.github/workflows/n8n-lego.yml` (restart wait) | 60 x `sleep 2` | 120 x `sleep 1` (same 120 s budget) |
| `.github/workflows/cleanup.yml` (service readiness) | `sleep 2` | 10 x `sleep 1` readiness poll |

Enforced by `apps/n8n-lego/test/governance-register.test.mjs` and `tools/workforce/test/repo-invariants.test.mjs` (both run in `npm test` and CI).

---

## 4. Job retry protocol

- **Maximum automatic retries:** **2** per job, and **only** for environmental failures:
  - Runner lost communication / daemon restart;
  - Transient network failure fetching dependencies or git refs;
  - GitHub Actions checkout/cache infrastructure error.
- **Never retry** deterministic test, lint, typecheck, `cargo check`, or architecture-gate failures — classify and fix them.

---

## 5. Failure classification

Every red job is classified before any action is taken:

| Class | Meaning | Action |
| --- | --- | --- |
| `implementation` | Caused by the PR's own diff | Fix in the same PR branch before merge |
| `environmental` | Runner offline, WSL interop, disk full, network drop | Recover runner / retry (<= 2); record in evidence if blocking |
| `pre-existing` | Reproduces on `main` at the base SHA | Record with file:line + reproduction command; route to owning slice |
| `flaky` | Non-deterministic timing/order sensitivity | Fix the test's determinism (poll at <= 1 s with bounded attempts) |

---

## 6. Self-hosted exhaustion (`WAITING_RUNNER` / `BLOCKED_WITH_EVIDENCE`)

- When no matching self-hosted runner is available (`onlineRunners` has no runner matching the job's label set, or all configured self-hosted runners in the demand controller are busy/offline):
  - Check classification (`tools/workforce/src/checks.mjs`) and controller status (`tools/ci/runner-demand-controller.mjs`) report explicit `WAITING_RUNNER` with `exhaustionState: 'BLOCKED_WITH_EVIDENCE'` and `hostedFallbackAllowed: false`.
  - Jobs queue in GitHub while the monitor polls at `1 s` and reports queue time.
  - If no runner of the required label set comes online within the job's timeout, the job is reported **blocked (environmental)** (`WAITING_RUNNER` / `BLOCKED_WITH_EVIDENCE`) — never skipped, never re-labelled onto GitHub-hosted runners to bypass a self-hosted requirement, and never recorded as `PASS` (`mergeAllowed: false`).
  - Remote-capable work (`PHASE_A_REMOTE`) continues outside the blocked validation lane until self-hosted runner capacity is restored.

---

## 7. GitHub Actions, Webhook Controller & VPS monitoring

### GitHub Actions (control plane)
- Poll check runs / workflow runs for the exact commit SHA via `GET /repos/{owner}/{repo}/commits/{sha}/check-runs` (or `actions/runs?head_sha={sha}`).
- Local loop cadence: `1 s` (`maxSleepSeconds = 1`), bounded by the job's `timeout-minutes`.
- Merge only when every required self-hosted check on the **exact PR head SHA** has `status == "completed"` and `conclusion == "success"` (`verdict == "ALL_GREEN"`), and pass `sha: <head_sha>` to the merge API.

### Demand-based runner webhook controller (`tools/ci/runner-demand-controller.mjs`)
- Control path: `workflow demand -> GitHub webhook (workflow_job) -> self-hosted runner capacity -> job execution`.
- Authentication is **fail-closed**: HMAC-SHA256 (`X-Hub-Signature-256`) with a non-empty configured `GITHUB_WEBHOOK_SECRET` is mandatory; missing secret or invalid signature returns `401 Unauthorized`.
- Process control uses `execFile('sc.exe', [action, serviceName], { shell: false })` with strict service-name allowlist validation so webhook payload data can never become shell commands.
- Non-self-hosted jobs are rejected/ignored (`hostedFallbackAllowed: false`), and `/status` exposes observable capacity and `WAITING_RUNNER` / `BLOCKED_WITH_EVIDENCE` state.

### VPS (`vps-runtime`)
- VPS jobs (`vps-runner-smoke.yml`, `[self-hosted, Linux, X64, vps-runtime]`) follow the same `<= 1 s` polling rule.
- Health verification polls `http://127.0.0.1:<port>/rest/settings` (or `/healthz` when the UI bundle is present) every `1 s` up to the bounded startup budget; on failure, tail the last 60 lines of the service log.
- Long-running VPS processes must be supervised by `systemd` (`Restart=on-failure`, `RestartSec=1`).

---

## 8. Workspace lifecycle & cleanup

1. **Before job:** Fresh checkout (`actions/checkout`) or `git clean -fd` inside the job's working directory; temporary state goes under `$RUNNER_TEMP` (`${{ runner.temp }}`) or container-local `/var/tmp`, never inside the tracked tree.
2. **After job / after merge:**
   - Stop any child processes started by the job (`kill $(cat "$CLEAN_TMP/lego.pid") || true`).
   - Remove temporary directories, one-off `.patch` / `.tmp` / `.log` files, duplicate clones, and stale worktrees (`git worktree prune`).
   - Preserve dependency/build caches (`~/.cargo`, `~/.npm`, Docker volume caches) so subsequent runs stay fast.
3. **Repository tree:** Never commit runtime state, logs, or token files (`.arena/gateway_tokens.json` and `.arena/workforce-state/` are gitignored and enforced untracked by `repo-invariants.test.mjs`).
4. **Branches (DEC-0019):** Persistent branches are `main` and `arena-manager` only. Temporary Manager PR branches are deleted after merge (`cleanup.yml`).
