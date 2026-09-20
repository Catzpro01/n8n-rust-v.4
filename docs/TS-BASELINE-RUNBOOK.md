# TypeScript LEGO Baseline — Operator Runbook

Phase **TS-1**. This is the usable application layer on top of the LEGO packages:
install → start → use → modify (oprek) → upgrade → debug, without touching Rust.

- Runtime: `apps/n8n-ts` (zero-dependency Node `node:http`, calls the existing execution engine through one bridge)
- Engine: `packages/reconstructed-engine` (frozen entrypoint `index.mjs`, node registry, validation)
- API contract: [`contracts/runtime-api.contract.md`](../contracts/runtime-api.contract.md) — **v1.0.0 FROZEN**
- Rust (`crates/**`, `apps/n8n-rust/**`, `Cargo.*`) and `reference/n8n/**`: **frozen, do not touch**

---

## 1. Quick start (clean machine / VPS)

Prerequisites: `git`, Node **≥ 22.18** (`node -v`), and nothing else — the runtime has no runtime dependencies.

```bash
git clone https://github.com/Catzpro01/n8n-rust-v.4.git && cd n8n-rust-v.4
bash scripts/install.sh          # dirs + .env from .env.example + dev deps   (idempotent)
$EDITOR .env                     # set N8N_TS_API_KEY, N8N_TS_ENV=production
bash scripts/start.sh            # background, pid file, waits for /healthz
bash scripts/doctor.sh           # full diagnostics
open http://127.0.0.1:5678/      # operator console
```

Foreground (containers, systemd, debugging): `bash scripts/start.sh --foreground` or `npm run runtime:start`.
Stop: `bash scripts/stop.sh` (SIGTERM → 10 s grace → SIGKILL, idempotent).

**Acceptance (what "running" means):**

```
$ bash scripts/start.sh
==> Starting runtime on port 5678
  ok pid 12345 written to .../data/runtime.pid
  ok healthz: {"status":"ok"}
$ curl -s localhost:5678/healthz
{"status":"ok"}
```

## 2. Configuration

`.env` is created once from `.env.example` and never overwritten. The loader never *evaluates* the file — it reads `KEY=VALUE` (same semantics as `node --env-file`).

| Key | Default | Meaning |
| --- | --- | --- |
| `N8N_TS_HOST` / `N8N_TS_PORT` | `0.0.0.0` / `5678` | bind address/port (`0.0.0.0` when behind a proxy) |
| `N8N_TS_ENV` | `development` | `development` \| `production` \| `test`; invalid value → boot fails fast |
| `N8N_TS_API_KEY` | *(empty)* | enables `X-N8N-API-KEY` auth on `/api/v1/**`; empty = open (dev only) |
| `N8N_TS_ALLOW_CODE_EVAL` | `false` | Code-node evaluation policy (contract §6) |
| `N8N_TS_LOG_LEVEL` / `_LOG_FORMAT` | `info` / `text` | `text` or `json` (json for containers/systemd) |
| `N8N_TS_DATA_DIR` / `_STORAGE` | `./data` / `file` | workflow + execution storage |
| `N8N_TS_CORS_ORIGIN` | `*` | CORS origin for `/api/*` |

Invalid configuration is a **feature**: the process logs the reason and exits `78` instead of half-starting.

## 3. Day-2 operations

| Task | Command |
| --- | --- |
| Upgrade to the newest `main` | `bash scripts/upgrade.sh` (fetch → deps → **typecheck gate** → restart → health check) |
| Upgrade to a specific revision | `bash scripts/upgrade.sh --ref <ref>` |
| Roll back | `bash scripts/rollback.sh` (last known-good) or `bash scripts/rollback.sh --to <ref>` |
| Debug | `bash scripts/doctor.sh` (`--quick`, `--json`), `logs/runtime.log`, `GET /healthz/readiness` |
| Docker | `cd deploy/docker && docker compose up -d --build` |
| systemd | `bash scripts/install.sh --systemd && systemctl enable --now n8n-ts-runtime` |

`upgrade.sh` **never leaves a broken revision running**: a failed typecheck or a failed start automatically rolls back to the previous revision, restarts it, and records the event in `state/deploy-history.log` (exit code 1 = rolled back, 0 = clean upgrade).

## 4. Modify the baseline (oprek)

| I want to… | Touch | Then |
| --- | --- | --- |
| add/change a node type | `packages/reconstructed-engine/` (registry + node module) | `node --test packages/reconstructed-engine/test/*.test.mjs` |
| add an HTTP endpoint | `apps/n8n-ts/src/routes/*` + register in `src/app.ts` | `npm --prefix apps/n8n-ts test` |
| change request/response shape | `contracts/runtime-api.contract.md` (bump version!) + runtime + tests | `bash tests/integration/runtime_gate.sh` |
| change storage/execution limits | `apps/n8n-ts/src/config.ts`, `src/store/*` | runtime tests |

Everything is plain JavaScript/TypeScript executed directly by Node 22 — no build step, no transpiler. One rule: the runtime must keep calling `packages/reconstructed-engine`; **never add a second execution engine**.

Full gate (what CI runs): `bash tests/integration/runtime_gate.sh` → engine unit → runtime unit → typecheck → 79 real-process runtime tests → single-engine integration audit.

## 5. Security notes

- Set `N8N_TS_API_KEY` (`openssl rand -hex 24`) before exposing the port; without it `/api/v1/**` is unauthenticated.
- Keep `N8N_TS_ALLOW_CODE_EVAL=false` unless a workflow really needs Code nodes.
- Terminate TLS at a reverse proxy (Caddy/nginx) and proxy to `127.0.0.1:5678`; set `N8N_TS_HOST=127.0.0.1` then.
- The runtime sends `X-Content-Type-Options: nosniff` and answers 413 `PAYLOAD_TOO_LARGE` above the 1 MiB body limit.

## 6. Verification record (TS-1)

Worker boundaries — each commit stayed inside its scope; nothing touched Rust or the reference source:

| Commit | Role | Scope touched |
| --- | --- | --- |
| `9d10b598` | contract | `contracts/`, `docs/workers/`, root `package.json`, `.gitignore` |
| `35f99db2`, `15c4eaca` | worker 4 — LEGO integration | `packages/reconstructed-engine/` |
| `b927a1b0`, `15be79b8` | worker 1 — runtime server | `apps/n8n-ts/` |
| `0aed61a9` | worker 3 — testing | `tests/runtime/`, `tests/fixtures/runtime/`, `tests/integration/` |
| `2e68f8dc` | worker 2 — packaging | `scripts/`, `.env.example`, `deploy/` |
| `66750d84` | manager | `.github/workflows/typescript-runtime.yml` |

Local evidence (Node v22.22.3): gate 5/5 PASS · engine 29/29 · runtime unit 22/22 · typecheck clean · runtime 79/79 (~6.7 s) · integration 7/7. Fresh-clone drill: install → start (`{"status":"ok"}`) → doctor (green) → stop (port free). Failure drills: bad typecheck → automatic rollback, healthy; boot failure → automatic rollback, healthy (both exit 1).

CI on the merge PR: Architecture/Contract/Scope audit **PASS**, Level 2 workspace + LEGO conformance **PASS**, TypeScript Runtime Gate **PASS** (incl. the job asserting `crates/**`, `apps/n8n-rust/**`, `Cargo.*`, `reference/n8n/**` are untouched). `Level 0 - Verify Formatting` is red because of pre-existing `cargo fmt` drift on `main` — no Rust file is changed by TS-1.

**Not yet done — blocked outside the repository:** deploy to the VPS. `n8n.kentutmambu.my.id` now resolves (157.10.160.95, ports 22/443 open) but nothing serves HTTP/TLS there yet, there is no `vps-runtime` runner registered (only the Windows `laptop-build-worker`), and `.arena/policies/validation-policy.md` still declares the VPS out of scope. `BASELINE FROZEN` is **not** declared.
