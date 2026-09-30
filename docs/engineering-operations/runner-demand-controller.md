# Demand-Based Self-Hosted Runner Controller

## 1. Overview & Control Path

The Demand-Based Self-Hosted Runner Controller (`tools/ci/runner-demand-controller.mjs`) manages the local self-hosted Windows runner pool (`laptop-build-worker-1..10`) on an event-driven basis:

```text
workflow demand -> GitHub webhook (workflow_job) -> self-hosted runner capacity -> job execution
```

- **Control plane vs. execution compute**: GitHub Actions acts strictly as the control plane (workflow orchestration and `workflow_job` webhook dispatch). All repository CI compute comes from the self-hosted runner fleet.
- **Zero hosted fallback**: Non-self-hosted jobs are ignored (`non_self_hosted_job_rejected`, `hostedFallbackAllowed: false`). The controller never substitutes GitHub-hosted runners and has zero dependency on GitHub billing, spending limits, or hosted runner minutes.
- **Demand-driven lifecycle**: Runner Windows services are started when `workflow_job` `queued` events arrive, kept warm during active runs, and stopped after the configurable idle timeout (`RUNNER_IDLE_TIMEOUT_MS`) when demand returns to zero.

---

## 2. Security & Fail-Closed Contract

1. **Mandatory HMAC-SHA256 authentication (fail-closed)**:
   - Every `POST /webhook` request must carry a valid `X-Hub-Signature-256: sha256=<hex>` header verified via `crypto.timingSafeEqual` against `GITHUB_WEBHOOK_SECRET`.
   - If `GITHUB_WEBHOOK_SECRET` is unset/empty, or if the signature header is missing, malformed, or mismatches the raw request body, `verifyWebhookSignature()` returns `false` and the controller responds with `401 Unauthorized` (`code: 'UNAUTHORIZED_WEBHOOK'`).
2. **Zero shell interpolation**:
   - Windows service transitions execute exclusively via `execFile('sc.exe', [action, serviceName], { windowsHide: true, shell: false })`.
   - `action` is restricted to `start | stop | query`.
   - `serviceName` must pass `isValidServiceName()` (`/^(?:actions\.runner\.[A-Za-z0-9._-]+|ArenaRunner-[A-Za-z0-9._-]+)$/`, forbidding all shell metacharacters, whitespace, quotes, and path separators) AND belong to the static `RUNNER_SERVICES` allowlist configured at startup.
   - Webhook payload fields (`workflow_job.id`, `name`, `labels`, etc.) are never interpolated into commands or passed to `sc.exe`.

---

## 3. Observable Capacity & Self-Hosted Exhaustion State

`GET /status` (and `getCapacitySnapshot()`) returns a machine-readable JSON snapshot:

- `controlPlane`: `"github-actions-webhook"`
- `executionModel`: `"self-hosted-only"`
- `hostedFallbackAllowed`: `false`
- `status`:
  - `"IDLE"` — zero queued or running jobs and zero active workers.
  - `"ACTIVE"` — self-hosted workers are running jobs or scaling to meet demand.
  - `"WAITING_RUNNER"` — one or more self-hosted jobs are queued (`queuedJobsCount > 0`), but no self-hosted runner capacity is available (all configured runners are busy or offline).
- `exhaustionState`:
  - `"BLOCKED_WITH_EVIDENCE"` when `status === "WAITING_RUNNER"`, accompanied by a structured `evidence` string naming the queued job IDs, active/total self-hosted workers, and confirming that GitHub-hosted fallback is disabled.
  - `"NONE"` otherwise.
- `queuedJobsCount`, `runningJobsCount`, `activeWorkersCount`, `availableIdleWorkers`, `desiredWorkers`, `totalConfiguredWorkers`.

---

## 4. Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `RUNNER_CONTROLLER_PORT` | `9876` | Localhost TCP port (`127.0.0.1`) for `/webhook` and `/status`. |
| `GITHUB_WEBHOOK_SECRET` | _(required)_ | HMAC-SHA256 shared secret for GitHub `workflow_job` webhooks. Fail-closed when empty. |
| `RUNNER_SERVICES` | `""` | Comma-separated allowlist of Windows service names (`actions.runner.Catzpro01-n8n-rust-v.4.laptop-build-worker-1,...`). |
| `RUNNER_IDLE_TIMEOUT_MS` | `600000` (10m) | Idle duration before stopping active runner services. |
| `RUNNER_MIN_IDLE` | `0` | Minimum warm self-hosted runners to keep online when idle (`0` = full scale-to-zero). |
| `RUNNER_RECONCILE_INTERVAL_MS` | `15000` (15s) | Periodic reconciliation cadence. |
| `RUNNER_DRY_RUN` | `false` on Win32 | Simulates `sc.exe` transitions without mutating OS services. |
