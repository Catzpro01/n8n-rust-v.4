# W2 — Packaging (`infrastructure-orchestration/ts1-packaging`)

Contract: [`contracts/runtime-api.contract.md`](../../contracts/runtime-api.contract.md) §1–§2, §6 (criteria 1, 2, 4, 5, 6).
Target flow: **clean machine → install → start → application running**.

## ALLOWED

```
deploy/docker/**
deploy/systemd/n8n-ts-runtime.service      (NEW file only — never edit arena-* units)
scripts/install.sh  scripts/start.sh  scripts/stop.sh
scripts/upgrade.sh  scripts/rollback.sh  scripts/doctor.sh
scripts/lib/**
.env.example
```

## FORBIDDEN

```
apps/**  packages/**  tests/**  crates/**  apps/n8n-rust/**  reference/n8n/**
scripts/arena/**  scripts/run-lego-tests.sh  scripts/setup-reference-runtime.sh
deploy/systemd/arena-bridge.service  deploy/systemd/arena-executor.service
deploy/supabase/**  .github/**  .arena/**  tools/**  package.json (root)  contracts/**
```

## Deliverables

| Path | Behaviour |
| :--- | :--- |
| `scripts/lib/common.sh` | shared helpers: repo root, `.env` loading, log helpers, port/pid checks, health probe, `have_cmd` |
| `scripts/install.sh` | idempotent, non-interactive; verifies Node ≥ 22.18 + npm; installs dev deps for `apps/n8n-ts` (`npm ci` when lockfile exists); creates `N8N_TS_DATA_DIR`, `logs/`, `state/`; copies `.env.example` → `.env` when missing (never overwrites); `--systemd` installs+enables `n8n-ts-runtime.service`; prints next steps; exit 0 on a clean machine |
| `scripts/start.sh` | loads `.env`, refuses to double-start (pidfile check), starts the server (background by default, `--foreground` for systemd/docker), waits for `/healthz` (≤ 30 s), writes pidfile, non-zero exit + log tail on failure |
| `scripts/stop.sh` | SIGTERM → wait ≤ 15 s → SIGKILL; removes pidfile; idempotent (exit 0 when already stopped) |
| `scripts/upgrade.sh` | fetch + fast-forward to `--ref`/`main` (default), records `state/last-good-ref`, reinstalls deps, typecheck, restart, health probe; on failure → calls `scripts/rollback.sh` automatically and exits non-zero |
| `scripts/rollback.sh` | `--to <ref>` or the recorded previous good ref; checkout, reinstall, restart, health probe; prints the active ref |
| `scripts/doctor.sh` | reports: node/npm versions, repo ref + dirty state, `.env` presence and keys (secrets masked), data dir writability + size, pid state, port availability/owner, process liveness, HTTP `/healthz` + `/healthz/readiness` bodies, node catalog count, execution history, log tail, systemd unit state, disk space; exit 0 healthy / 1 warnings / 2 critical, always actionable |
| `deploy/docker/Dockerfile` | multi-stage, `node:22-bookworm-slim`, non-root user, only production files copied, `HEALTHCHECK` on `/healthz`, `CMD ["node","apps/n8n-ts/src/server.ts"]` |
| `deploy/docker/docker-compose.yml` | `n8n-ts` service, `env_file: ../../.env`, persistent volume for `N8N_TS_DATA_DIR`, `restart: unless-stopped`, healthcheck, port mapping `N8N_TS_PORT`, no host-name allowlist (must work behind a proxy/iframe) |
| `deploy/docker/README.md` | docker quickstart + VPS notes |
| `deploy/systemd/n8n-ts-runtime.service` | unit for the VPS runner: `User`, `WorkingDirectory`, `ExecStart=scripts/start.sh --foreground`, `Restart=always`, `EnvironmentFile`, hardening (`NoNewPrivileges`, `ProtectSystem=strict`, `ReadWritePaths` for data dir) |
| `.env.example` | append a clearly marked runtime section documenting **every** contract §2 variable; keep the existing Supabase/GitHub placeholders untouched |

## Hard requirements

1. `set -euo pipefail`, shellcheck-clean style, no `sudo` unless the user passed an explicit flag.
2. Scripts work when **run from any cwd** (they resolve the repo root themselves) and on Debian/Ubuntu + macOS-ish bash.
3. Never print secrets from `.env` (mask everything except known non-secret keys).
4. No changes to the control plane, Docker of the Rust crates, or the arena systemd units.
5. Every script has `--help`.
6. `scripts/upgrade.sh` must leave the service in a **working** state or roll back automatically.

## Evidence to record in the PR

```
bash scripts/install.sh                 # clean machine
bash scripts/start.sh && bash scripts/doctor.sh
curl -s localhost:5678/healthz
bash scripts/stop.sh
bash scripts/upgrade.sh --help && bash scripts/rollback.sh --help
docker compose -f deploy/docker/docker-compose.yml config   # (if docker available)
```
