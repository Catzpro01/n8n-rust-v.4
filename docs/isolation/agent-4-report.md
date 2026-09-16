# Agent 4 — Phase 2 LEGO Isolation Report

**LEGOs:** Trigger · Webhook · Scheduler · Persistence · Credentials · API
**Reference:** n8n **2.9.4** (`reference/n8n`, upstream `b6dc2787c45677a29a9612cd27eb911302961a83`)
**Branch:** `arena/01a0ac06-n8n-rust-v-4` (Agent 4 worktree, branched from `agent-4` @ `e65a2f38`)
**Date:** 2026-09-16
**Overall status:** **VERIFIED** (all six LEGOs)

---

## 1. Scope

Phase 2 isolation of the I/O and persistence boundaries of n8n 2.9.4, TypeScript only.
Approach followed the rules: **DOCUMENT → ANALYZE → CONTRACT → MINIMAL ISOLATION**, with
truth priority *source > runtime behaviour > existing tests > anatomy docs > contracts*.

Out of scope and untouched: Rust (`crates/*`, `apps/n8n-rust/*`), Workflow / Node Model /
Execution Data / Expression / `WorkflowExecute` / execution loop / queue / worker / frontend,
and all Agent 1/2/3 files. `git status` shows **no modified tracked file** — only additions.

## 2. LEGO Map

| LEGO | Source owned (n8n 2.9.4) | Doc | Contract | Status |
|---|---|---|---|---|
| Trigger | `core/src/execution-engine/active-workflows.ts`, `triggers-and-pollers.ts`, `trigger-context.ts`, `poll-context.ts`; `cli/src/active-workflow-manager.ts`, `activation-errors.service.ts` | `docs/isolation/trigger.md` | `contracts/trigger.contract.md` | VERIFIED |
| Webhook | `cli/src/webhooks/**` (`webhook-server`, `webhook-request-handler`, `live-`/`test-`/`waiting-webhooks`, `webhook-helpers`, `webhook.service`), `@n8n/db WebhookEntity/WebhookRepository` | `docs/isolation/webhook.md` | `contracts/webhook.contract.md` | VERIFIED |
| Scheduler | `core/src/execution-engine/scheduled-task-manager.ts`, `scheduling-helper-functions.ts`, `workflow/src/cron.ts` | `docs/isolation/scheduler.md` | `contracts/scheduler.contract.md` | VERIFIED |
| Persistence | `@n8n/db` entities/repositories/migrations, `cli/src/executions/execution-persistence.ts`, `execution-lifecycle/*` save hooks, `workflows/workflow.service.ts`, `workflow-history.ee`, `workflow-static-data.service.ts` | `docs/isolation/persistence.md` | `contracts/persistence.contract.md` | VERIFIED |
| Credentials | `core/src/encryption/cipher.ts`, `core/src/credentials.ts`, `cli/src/credentials/**`, `credentials-helper.ts`, `credentials-overwrites.ts` | `docs/isolation/credentials.md` | `contracts/credentials.contract.md` | VERIFIED |
| API | `cli/src/abstract-server.ts`, `server.ts`, `controller.registry.ts`, `response-helper.ts`, `controllers/**`, `*/*.controller.ts`, `public-api/**`, `push/**` | `docs/isolation/api.md` | `contracts/api.contract.md` | VERIFIED |

Two anatomy corrections were made in the docs (source wins): the Scheduler has **no**
central tick loop (each cron is its own `CronJob`, leader-gated at tick time), and the
credentials cipher is OpenSSL-compatible `EVP_BytesToKey(MD5)` + AES-256-CBC with a
`Salted__` header, not a bare AES call.

## 3. Dependency Map (verified from imports / call graph / repositories / HTTP handlers)

```
                       ┌──────────── API (express, controller.registry, response-helper) ────────────┐
                       │  /rest/*  /api/v1/*  /healthz  push  SPA                                    │
                       └──┬────────────┬────────────┬────────────┬──────────────┬────────────────────┘
       CROSS-BOUNDARY ▼   ▼            ▼            ▼            ▼              ▼
   WorkflowService  ActiveWorkflowManager  ExecutionService  CredentialsService  TestWebhooks
        │                 │       │                 │              │                  │
        │        ┌────────┘       └───────┐         │              │                  │
        ▼        ▼                        ▼         │              │                  │
   PERSISTENCE   TRIGGER ──registerCron──► SCHEDULER │              │                  │
   (@n8n/db)     (ActiveWorkflows)        (ScheduledTaskManager)   │                  │
     ▲  ▲  ▲        │ emit()                 │ onTick()             │                  │
     │  │  │        └────────┬───────────────┘                      │                  │
     │  │  │                 ▼                                      │                  │
     │  │  │      EXECUTION (WorkflowRunner.run)  ◄─── CROSS-BOUNDARY, not owned ──────┤
     │  │  │                 ▲  ▲                                   │                  │
     │  │  └── webhook_entity│  │ execute + await response          │                  │
     │  │              WEBHOOK (WebhookRequestHandler → LiveWebhooks/TestWebhooks/Waiting)
     │  │                 │ node.webhook() auth options ─────────────┘
     │  └── credentials_entity  CREDENTIALS (Cipher, Credentials, CredentialsHelper)
     └───── execution_entity / execution_data / workflow_entity / workflow_history / settings
```

| Edge | Class | Notes |
|---|---|---|
| API → {Workflow,Execution,Credentials}Service, ActiveWorkflowManager | CROSS-BOUNDARY | API owns transport + envelope only |
| API → `@n8n/db` repositories directly (some controllers) | CROSS-BOUNDARY (documented coupling) | left as is; refactor not needed for boundary |
| Trigger ↔ Webhook (same `ActiveWorkflowManager.add` transaction) | CROSS-BOUNDARY | `addWebhooks()` then `addTriggersAndPollers()` |
| Trigger → Scheduler (`registerCron/deregisterCrons`) | CROSS-BOUNDARY | poll nodes + Schedule Trigger via `helpers.registerCron` |
| Trigger/Webhook → Execution (`WorkflowRunner.run`) | CROSS-BOUNDARY | documented, not owned (Agent 3 domain) |
| Trigger/Webhook/Execution/API → Persistence | CROSS-BOUNDARY | repositories are the interface |
| Webhook (node auth) → Credentials | CROSS-BOUNDARY | inside `node.webhook()` |
| Execution node context → Credentials (`getCredentials`) | CROSS-BOUNDARY | `ICredentialsHelper` |
| `n8n-workflow` types, `NodeTypes`, `@n8n/api-types`, `@n8n/decorators` | SHARED | read-only |
| `cron`, `express`, `flatted`, `node:crypto`, TypeORM drivers, `InstanceSettings` | EXTERNAL | |
| Everything under each LEGO's "Source owned" column | INTERNAL | |

Full per-LEGO tables are in each `docs/isolation/<lego>.md` (§ "Dependency map").

## 4. Contracts

Six contracts, each with the required sections (Purpose, Inputs, Outputs, Responsibilities,
Non-responsibilities, Dependencies, Error behavior, Lifecycle, Data ownership, External
interfaces, Compatibility requirements): `contracts/{trigger,webhook,scheduler,persistence,credentials,api}.contract.md`.
Every error string and envelope shape in the contracts was recorded from the live instance
(`tests/reference/agent-4/golden/*.golden.json`) or from n8n source, not designed.

## 5. Source Changes

**None.** After analysis no source change was needed for a clearer boundary in any of the six
LEGOs: the 2.9.4 code already exposes each boundary through a DI service (`ActiveWorkflows`,
`ScheduledTaskManager`, `WebhookService`, repositories, `Cipher`/`Credentials`,
`controller.registry` + `ResponseHelper`). Couplings that *look* like leaks but are necessary
were documented instead of forced apart:

- Trigger and Webhook registration share one activation call (`ActiveWorkflowManager.add`) — required for atomic activation and rollback.
- `webhook_entity` and `credentials_entity` live in `@n8n/db` (Persistence infra) while their semantics belong to Webhook/Credentials.
- Some API controllers touch repositories directly (`SettingsRepository`, `WorkflowRepository`).

## 6. Tests

`tests/reference/agent-4/` (TypeScript, `node --test`, Node ≥ 22.6, no build, no extra deps).
Three layers per LEGO: unit tests that drive the **real n8n 2.9.4 classes** with stub infra,
offline golden tests, and optional live replays.

| LEGO | File | Cases | Result |
|---|---|---|---|
| Trigger | `trigger/trigger-lifecycle.test.ts` | register→activate→execute→deactivate; activation failure; missing `trigger()`; close failure (hard/soft); manual mode; poll cron + sub-minute rejection; golden; live no-trigger 400 | 8/8 |
| Scheduler | `scheduler/scheduler.test.ts` | register→real tick→cancel; follower never fires; duplicate skip; invalid expression; deregister; `toCronExpression`; golden | 7/7 |
| Webhook | `webhook/webhook-routing.test.ts` | static routing (method/path/PK upsert/deregister); dynamic `:param` routing; golden POST/input/response; golden errors; golden default/CORS/409; execution side effect; live GET/POST/404 | 7/7 |
| Persistence | `persistence/persistence.test.ts` | flatted wire format; status transitions golden; execution save/load golden; workflow save/load golden; live save→load→run→status + SQLite rows + `workflow_history` | 5/5 |
| Credentials | `credentials/credentials.test.ts` | encrypt/decrypt + independent EVP_BytesToKey cross-check; wrong key/short input; `Credentials` NO_DATA/DECRYPTION_FAILED/INVALID_JSON; golden redaction; live lookup/missing/invalid | 5/5 |
| API | `api/api-envelope.test.ts` | health/401; `{data}` envelope; `{code,message,hint,meta}`; zod raw issue 400; not-found variants; public API; baseline; live valid/invalid/404/validation/success | 8/8 |

Golden fixtures (INPUT / EXPECTED OUTPUT / ERROR / SIDE EFFECT): `golden/api.golden.json`,
`credentials.golden.json` (dummy credential; plaintext never stored), `execution-status.golden.json`,
`trigger-scheduler.golden.json`, `webhook.golden.json`; recorder: `live/record-golden.mjs`.
No credentials or secrets are in the repo; the credential tests use a throw-away key and dummy values.

## 7. Reference Regression (11/11)

Harness: `tests/reference/agent-4/live/smoke.mjs` (same 11 steps as `tests/reference/baseline/SMOKE_TEST_RESULTS.md`).

| Run | When | Result | Record |
|---|---|---|---|
| Baseline BEFORE isolation | before any Agent 4 deliverable | **11/11 PASS** | `live/baseline-before.json` |
| Baseline AFTER isolation | after docs/contracts/tests were complete | **11/11 PASS** | `live/baseline-after.json` |

Because there are no source changes the two runs exercise identical code; the after-run additionally
asserts the unsupported-method behaviour (`PROPFIND → 500 code 0`) recorded during analysis.

## 8. Live Verification

The baseline VPS (`157.10.160.95`) was unreachable from the sandbox, and `pnpm`/Docker are not
installed, so `regression_gate.py` could not run. Instead n8n **2.9.4** was installed from npm into
`/home/user/n8n-runtime` (sqlite3 built from source) and started with SQLite, a throw-away
`N8N_ENCRYPTION_KEY`, diagnostics off. Verified live:

- `GET /rest/settings` (authenticated) → `versionCli: "2.9.4"`.
- Smoke 11/11 twice; manual, webhook and **schedule-trigger** executions recorded (`mode` = `manual` / `webhook` / `trigger`).
- Webhook path conflict → 409; CORS preflight 204 `OPTIONS, POST`; deactivate → 404.
- Credentials: ciphertext `Salted__…` in DB, `includeData=true` redacts to `CREDENTIAL_BLANKING_VALUE`, blanked update keeps the secret.
- SQLite rows inspected directly via `node:sqlite` (`execution_entity`, `execution_data`, `workflow_history`).

## 9. Cross-Boundary Dependencies (documented, not owned)

| From → To | Interface to keep |
|---|---|
| Webhook → Execution | `WorkflowRunner.run({ executionMode:'webhook', executionData, workflowData, … })` + response promise / `sendResponse` hook |
| Trigger → Execution | `emit(data, responsePromise?, donePromise?)` → `WorkflowRunner.run(mode:'trigger')`; `emitError` → error workflow + `remove` |
| Trigger → Scheduler | `registerCron(CronContext, onTick)` / `deregisterCrons(workflowId)` |
| Execution → Persistence | `ExecutionPersistence.create`, `ExecutionRepository.setRunning/updateExistingExecution` (flatted data) |
| Execution → Credentials | `ICredentialsHelper.getDecrypted / authenticate` via node context |
| API → all | services only (`{data}` / `{code,message}` envelope owned by API) |
| Webhook/Credentials → Persistence | tables `webhook_entity`, `credentials_entity`, `shared_credentials` via repositories |

## 10. Risks

1. **Environment substitution** — live verification used an npm-installed 2.9.4 with SQLite, not the VPS/pnpm build. Same version and same behaviour observed, but Postgres-specific paths were not exercised.
2. **Non-deterministic cron seconds** — `toCronExpression` randomises the seconds (and minute for `everyX hours`) field; goldens must not pin expressions.
3. **Credentials API quirks** — unknown credential type is a 500 (`code:0`), and REST create accepts names < 3 chars. Kept as-is (compatibility); flagged in the contract.
4. **`GET /rest/executions/:id` unknown → `200 {}`** — surprising but current behaviour; editor depends on it.
5. **Stack traces in error bodies** — present because the sandbox instance runs with `NODE_ENV` unset; tests strip `stacktrace` and must never assert on it.
6. **Scheduler `onTick` exceptions** are not caught by `ScheduledTaskManager`; relies on node/Trigger wrappers.
7. **Multi-main** semantics (triggers leader-only, webhooks on all mains) documented from source but not exercised live (single instance).

## 11. Status

| LEGO | Status |
|---|---|
| Trigger | **VERIFIED** |
| Webhook | **VERIFIED** |
| Scheduler | **VERIFIED** |
| Persistence | **VERIFIED** |
| Credentials | **VERIFIED** |
| API | **VERIFIED** |

Criteria met: source-verified docs + contracts, 40/40 reference tests, 11/11 smoke before and
after, live verification on n8n 2.9.4, zero modification of Agent 1/2/3 files, no Rust, no secrets.
