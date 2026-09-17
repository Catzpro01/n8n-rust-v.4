# Agent 4 reference tests — Trigger, Webhook, Scheduler, Persistence, Credentials, API

Reference: **n8n 2.9.4**. TypeScript only, run with Node ≥ 22.6 (`node --test` strips types natively; no build step, no extra deps).

```
tests/reference/agent-4/
├── helpers.ts                       shared runtime/live helpers (no secrets)
├── golden/                          recorded behaviour of live n8n 2.9.4 (INPUT / EXPECTED / ERROR / SIDE EFFECT)
│   ├── api.golden.json
│   ├── credentials.golden.json      dummy credential only; plaintext never stored
│   ├── execution-status.golden.json
│   ├── trigger-scheduler.golden.json
│   └── webhook.golden.json
├── trigger/trigger-lifecycle.test.ts
├── webhook/webhook-routing.test.ts
├── scheduler/scheduler.test.ts
├── persistence/persistence.test.ts
├── credentials/credentials.test.ts
├── api/api-envelope.test.ts
├── validation/workflow-rules.ts        NEW CAPABILITY (ISSUE-003 Option A): validateWorkflow / NodeUniqueness / DanglingConnections / CycleDetection
├── validation/validation.test.ts       golden A/B/C vs real n8n-workflow 2.9.4 + D vs workflow-rules
└── live/                            11-step smoke harness + baselines (see live/README.md)
```

## Three layers per LEGO

| Layer | Needs | What it proves |
|---|---|---|
| **Unit (real n8n classes)** | `N8N_RUNTIME` = directory with `node_modules/n8n` (default `/home/user/n8n-runtime`) | drives the *actual* 2.9.4 code (`ActiveWorkflows`, `TriggersAndPollers`, `ScheduledTaskManager`, `WebhookService`+`WebhookEntity`, `Cipher`, `Credentials`, `flatted`) with stub infra — no DB, no network |
| **Golden (offline)** | nothing | asserts the recorded live behaviour in `golden/*.json` and `live/baseline-before.json` — these are the contract fixtures |
| **Live replay** | `N8N_URL` (+ `N8N_OWNER_EMAIL`, `N8N_OWNER_PASS`, optional `N8N_SQLITE_PATH`) | replays the same cases against a running instance |

Tests that cannot run are **skipped**, never faked.

## Run

```bash
# offline golden + unit (runtime present)
node --test tests/reference/agent-4/trigger/ tests/reference/agent-4/scheduler/ \
            tests/reference/agent-4/webhook/ tests/reference/agent-4/persistence/ \
            tests/reference/agent-4/credentials/ tests/reference/agent-4/api/

# with live replay
N8N_URL=http://127.0.0.1:5678 N8N_SQLITE_PATH=$HOME/n8n-runtime/data/.n8n/database.sqlite \
  node --test tests/reference/agent-4/*/*.test.ts

# regenerate goldens from a live instance (idempotent, cleans up after itself)
N8N_URL=http://127.0.0.1:5678 node tests/reference/agent-4/live/record-golden.mjs
```

Note: `node --test <dir>` only auto-discovers `*.test.js`; pass the `.ts` files / globs explicitly as above.

## Coverage matrix (task requirements → test)

| Requirement | Test |
|---|---|
| Trigger register / activate / execute / deactivate | `trigger-lifecycle.test.ts` #1 (real `ActiveWorkflows`), golden #7, live #8 |
| Trigger activation failure, close failure, manual mode, poll cron | `trigger-lifecycle.test.ts` #2–#6 |
| Webhook GET/POST, input shape, response, invalid route, error | `webhook-routing.test.ts` golden #3–#6, live #7; routing #1–#2 (real `WebhookService`) |
| Scheduler register / execute / cancel | `scheduler.test.ts` #1 (real `ScheduledTaskManager`, real cron tick), #2–#5 |
| Persistence workflow save/load; execution save/load/status | `persistence.test.ts` #3–#4 golden, #5 live (+SQLite rows), #1 flatted |
| Credentials lookup / encrypt-decrypt / missing / invalid (no real secrets) | `credentials.test.ts` #1–#3 (real `Cipher`/`Credentials`, dummy key), #4 golden, #5 live |
| API valid / invalid / not found / validation error / success | `api-envelope.test.ts` #1–#7 golden, #8 live |
| Validation: validateFieldType / tryToParse* / guards / schemas (frozen) + workflow rules (new) | `validation/validation.test.ts` 10 cases |

Last run (2026-09-16, live n8n 2.9.4 in sandbox): trigger 8/8, scheduler 7/7, webhook 7/7, persistence 5/5, credentials 5/5, api 8/8; smoke 11/11 before and after.

---

## Operational note (TASK-AGENT4-RUNTIME-01, 2026-09-18) — restoring the N8N_RUNTIME layer in this sandbox

The full-runtime unit layers above (everything gated on `hasRuntime`) were unreproducible here for
two reasons, both solved without native builds:

1. `cdn.sheetjs.com` (an `xlsx` tarball in the n8n tree) is TLS-blocked in this sandbox — the SAME
   blocker `scripts/setup-reference-runtime.sh` solves for the partial runtime with an npm-registry
   override. Use the identical override:
   ```bash
   mkdir -p /tmp/n8n-runtime && cd /tmp/n8n-runtime && npm init -y
   npm pkg set overrides.xlsx=0.18.5
   npm install --ignore-scripts --no-audit --no-fund n8n@2.9.4     # ~1969 packages, ~2 min
   ```
2. `--ignore-scripts` is REQUIRED: native deps would otherwise need nodejs.org headers (blocked).
   The unit layers drive pure-JS classes (`ActiveWorkflows`, `TriggersAndPollers`,
   `ScheduledTaskManager`, `WebhookService`, `Cipher`, `Credentials`, `flatted`), so nothing native
   is exercised.

Run: `N8N_RUNTIME=/tmp/n8n-runtime node --test tests/reference/agent-4/<lane>/*.test.ts ...`
(observed on 2026-09-18: **45 pass / 0 fail**, the remaining **5 skips are the live layer** —
they need a RUNNING n8n server + `N8N_URL` and stay blocked here because server startup requires
native module builds). `npm run reference:agent4` runs the same suite without the runtime env
(unit-golden layers only, 23 pass / 27 skip).
