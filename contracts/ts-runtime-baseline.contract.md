# LEGO Contract: TypeScript Runtime Baseline

Reference: n8n 2.9.4 behavioral shapes where applicable.
Status: **BASELINE (pre-freeze)** — TypeScript usable runtime before LEGO → Rust migration.
Engine source of truth: `packages/reconstructed-engine` (+ LEGO re-exports).
Rust: **FROZEN** for this baseline. Do not touch `crates/**` or `apps/n8n-rust`.

## 1. Purpose

Provide a minimal, installable, VPS-runnable Node.js HTTP runtime that:

- exposes health and workflow-run endpoints
- executes workflows through the **existing** reconstructed engine (no second execution engine)
- is easy to install, start, stop, upgrade, rollback, and debug
- is the frozen TypeScript baseline before one-by-one LEGO → Rust migration

## 2. Process model

| Item | Value |
|---|---|
| Runtime | Node.js ≥ 20 (ESM) |
| HTTP | `node:http` only (no Express dependency in baseline) |
| Entry | `apps/n8n-ts/src/server.mjs` |
| Bind | `0.0.0.0` (VPS / container friendly) |
| Default port | `5678` (`N8N_TS_PORT` / `PORT`) |
| Engine | `packages/reconstructed-engine/runner.mjs` → `WorkflowExecutionEngine` |
| LEGO wiring | `workflow-lego` (model surface provenance), `execution-lego` (runtime ports re-export), `reconstructed-engine` (DAG runner) |
| Persistence | in-memory only for baseline (no DB required to boot) |

## 3. Configuration

| Env | Default | Meaning |
|---|---|---|
| `N8N_TS_HOST` | `0.0.0.0` | Listen address |
| `N8N_TS_PORT` / `PORT` | `5678` | Listen port |
| `N8N_TS_BASE_PATH` | `` (empty) | Optional URL prefix (no trailing slash) |
| `N8N_LOCALE` | `id` | Default response locale for engine interceptor |
| `N8N_TS_LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `N8N_TS_PAYLOAD_LIMIT` | `1048576` | Max JSON body bytes (1 MiB) |
| `N8N_TS_PID_FILE` | `run/n8n-ts.pid` | PID file for scripts |
| `N8N_TS_LOG_FILE` | `run/n8n-ts.log` | Log file for scripts |
| `NODE_ENV` | `production` | Affects error stack inclusion |

`.env` is loaded from repo root when present (never commit secrets).

## 4. HTTP surface (baseline only)

Base path `B` = `N8N_TS_BASE_PATH` (may be empty).

### 4.1 `GET {B}/`

**200** `text/html` — minimal operator landing page (not the full n8n editor SPA).

Must include runtime name, version, health link, and run endpoint hint.

### 4.2 `GET {B}/healthz`

**200** `application/json`:

```json
{
  "status": "ok",
  "service": "n8n-ts-baseline",
  "version": "<package version>",
  "uptimeSec": 12.34,
  "engine": "reconstructed-engine",
  "locale": "id"
}
```

### 4.3 `GET {B}/healthz/readiness`

**200** when process can accept run requests:

```json
{ "status": "ok", "ready": true }
```

**503** only if a future readiness gate fails (baseline always ready after listen).

### 4.4 `POST {B}/api/v1/workflows/run`

Execute a workflow definition synchronously through `WorkflowExecutionEngine`.

#### Request

- `Content-Type: application/json` (required)
- Body shape:

```json
{
  "workflow": {
    "id": "optional-string",
    "name": "optional-string",
    "nodes": [ { "name": "string", "type": "string", "parameters": {} } ],
    "connections": {}
  },
  "startNode": "optional-node-name",
  "inputData": [ { } ],
  "locale": "optional-locale",
  "options": {}
}
```

- `workflow` **required** and must be a plain object.
- `workflow.nodes` must be an array when present (default `[]`).
- `workflow.connections` must be an object when present (default `{}`).
- `inputData` optional; default `[{}]`. If provided must be an array or a single object (coerced to one-item array).
- Unknown top-level keys are ignored (forward compatible).

#### Success response — **200**

```json
{
  "data": {
    "executionId": "exec-<ulid-or-counter>",
    "status": "success",
    "finished": true,
    "workflowId": "<id or null>",
    "workflowName": "<name or null>",
    "startedAt": "<ISO-8601>",
    "stoppedAt": "<ISO-8601>",
    "locale": "id",
    "result": {
      "status": "COMPLETED",
      "finished": true,
      "executionLog": [ /* engine log entries */ ],
      "data": { /* nodeName -> items */ }
    }
  }
}
```

Envelope uses `{ data: ... }` to stay compatible with the public API success shape from `contracts/api.contract.md` §3.

#### Error responses

Uniform baseline error body:

```json
{
  "code": 400,
  "message": "human readable",
  "hint": "optional",
  "details": {}
}
```

| Case | HTTP | `code` | `message` (stable token / text) |
|---|---|---|---|
| Empty body / invalid JSON | 400 | 400 | `Invalid JSON body` |
| Body not object | 400 | 400 | `Request body must be a JSON object` |
| Missing `workflow` | 400 | 400 | `workflow is required` |
| `workflow` not object | 400 | 400 | `workflow must be an object` |
| `nodes` not array | 400 | 400 | `workflow.nodes must be an array` |
| `connections` not object | 400 | 400 | `workflow.connections must be an object` |
| Empty workflow (`nodes.length === 0`) | 400 | 400 | `workflow has no nodes` |
| Unknown / unregistered node type (strict mode) | 422 | 422 | `Unknown node type: <type>` |
| Node handler throws | 500 | 500 | `Node execution failed: <nodeName>` |
| Engine internal error | 500 | 500 | engine message or `Internal execution error` |
| Method not allowed on known path | 405 | 405 | `Method Not Allowed` |
| Unknown path | 404 | 404 | `Not Found` |
| Body too large | 413 | 413 | `Payload too large` |

Stack traces appear only when `NODE_ENV !== 'production'`.

### 4.5 Node type policy (baseline)

Built-in handlers registered at boot for:

| Type | Behavior |
|---|---|
| `n8n-nodes-base.manualTrigger` | Emits `[{ json: { triggered: true, at: <ISO> } }]` (or passes `inputData`) |
| `n8n-nodes-base.noOp` | Passthrough |
| `n8n-nodes-base.set` | Merges `parameters.values` / keeps input; baseline simple set |
| `n8n-nodes-base.code` | **Does not eval user JS** in baseline. Returns passthrough + `{ codeNode: true }` marker OR applies static `parameters` preview fields only |
| `n8n-nodes-base.if` | Routes all items to output 0 (true) by default (no expression eval in baseline) |
| unknown type | **422** when `options.strictTypes !== false` (default **strict**). If `strictTypes: false`, passthrough like engine default |

This keeps the baseline safe (no `eval`) and debuggable.

## 5. Engine integration rules (Worker 1 + Worker 4)

1. **Single engine**: only `WorkflowExecutionEngine` from `packages/reconstructed-engine/runner.mjs`.
2. **Do not** reimplement DAG BFS, execution log, or locale interceptor in the HTTP layer.
3. HTTP layer may:
   - validate request shape
   - construct engine instance per request (or pooled)
   - `registerNodeType` for baseline built-ins
   - call `runWorkflow(startNode, inputData, { locale })`
   - wrap result in `{ data: ... }` envelope
4. `execution-lego` is imported for provenance / future ActiveExecutions wiring; baseline run path may assign an in-memory `executionId` without full persistence.
5. `workflow-lego` is optional structural validation when its surface is available without the heavy reference extract; baseline must still run if only reconstructed-engine is present.
6. **Forbidden**: second `class WorkflowExecutionEngine`, copying runner logic into `apps/n8n-ts`.

## 6. Packaging contract (Worker 2)

Clean machine path:

```text
git clone … && cd n8n-rust-v.4
cp .env.example .env          # edit N8N_TS_PORT if needed
./scripts/install.sh          # node deps for apps/n8n-ts (+ workspace packages as needed)
./scripts/start.sh            # daemonize or foreground with --fg
./scripts/doctor.sh           # preflight
curl -s localhost:5678/healthz
./scripts/stop.sh
./scripts/upgrade.sh          # git pull + install + restart
./scripts/rollback.sh         # previous release tag/dir if present
```

Docker:

- `deploy/docker/Dockerfile.n8n-ts`
- `deploy/docker/docker-compose.n8n-ts.yml`
- Expose `5678`, healthcheck `GET /healthz`

Scripts must be idempotent, print clear errors, and never touch Rust build by default.

## 7. Testing contract (Worker 3)

Tests live under:

- `tests/runtime/**` — real HTTP against spawned or in-process server
- `tests/integration/**` — cross-package wiring
- fixtures under `tests/runtime/fixtures/`

Mandatory cases:

| ID | Case | Expect |
|---|---|---|
| T1 | healthz | 200 status ok |
| T2 | workflow execution (linear fixture) | 200, COMPLETED, nodes in result.data |
| T3 | malformed JSON | 400 Invalid JSON body |
| T4 | empty workflow | 400 workflow has no nodes |
| T5 | unknown node type (strict) | 422 Unknown node type |
| T6 | restart | stop + start → healthz ok |
| T7 | configuration | custom port via env |
| T8 | regression | fixture hashes / golden subset stable |

Tests **must** hit a real `node:http` server (in-process listen on ephemeral port is OK). Pure mocks of `runWorkflow` alone are insufficient for T1–T5.

## 8. Non-goals (baseline)

- Full n8n editor UI / `/rest/*` surface
- Auth, API keys, multi-tenancy
- Webhook server, queue mode, Redis, Postgres
- Evaluating user Code node JavaScript
- Rust server or any change under `crates/**`, `apps/n8n-rust/**`
- Modifying `reference/n8n/**`

## 9. Versioning & freeze

- Package name: `n8n-ts-baseline` version `0.4.0` aligned with repo.
- After acceptance (install → start → health → run → VPS smoke), manager declares **`TYPESCRIPT BASELINE FROZEN`**.
- Only then may LEGO → Rust migration tasks be opened one-by-one.

## 10. Worker path boundaries

| Worker | Allowed paths | Forbidden |
|---|---|---|
| W1 Runtime | `apps/n8n-ts/**` | docker, scripts lifecycle (except reading contract), crates, reference |
| W2 Packaging | `deploy/docker/**`, `scripts/{install,start,stop,upgrade,rollback,doctor}.sh`, `.env.example` | `apps/n8n-ts/src/**` business logic, crates |
| W3 Testing | `tests/runtime/**`, `tests/integration/ts-baseline/**` | production runtime source except fixtures import |
| W4 LEGO | `packages/workflow-lego/**`, `packages/execution-lego/**`, `packages/reconstructed-engine/**` (wiring only, no second engine), thin adapter under `apps/n8n-ts/lib/**` if needed | crates, deploy scripts, reference |
| Manager | integration, root `package.json` scripts, contracts, docs/baseline, merge | must not expand feature scope |

## 11. Acceptance criteria (manager gate)

1. `./scripts/install.sh && ./scripts/start.sh` → `GET /healthz` = 200
2. `POST /api/v1/workflows/run` with linear fixture = 200 COMPLETED
3. Malformed / empty / unknown-node cases match §4.4
4. `npm test` (or `node --test tests/runtime/*.test.mjs`) passes
5. Docker image builds and healthchecks (when Docker available)
6. No files changed under `crates/**`, `apps/n8n-rust/**`, `reference/n8n/**`
7. Engine import path resolves to `reconstructed-engine` only
