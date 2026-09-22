# LEGO Contract: TypeScript Runtime API (v1)

| Field | Value |
| :--- | :--- |
| Owner | **MANAGER** (integration authority) — this file is FROZEN |
| Status | **FROZEN v1.0.0** (2026-09-20) — additive changes only |
| Consumers | Worker 1 (runtime server), Worker 2 (packaging), Worker 3 (testing), Worker 4 (LEGO integration) |
| Reference | n8n `2.9.4` HTTP surface where a compatible endpoint exists (`/healthz`) — see `contracts/api.contract.md` |
| Rust | **FROZEN** — `crates/**` and `apps/n8n-rust/**` are out of scope for this contract |

## 0. Purpose

Define the single, stable interface between:

```
client / operator / test           apps/n8n-ts            packages/reconstructed-engine
        ───────────────►   HTTP  ───────────────►   LEGO entrypoint (JS)
```

Any worker that changes this surface without manager approval is **rejected at review**.
Everything unspecified here is implementation detail and MUST NOT be relied upon.

## 1. Process & binding

| Item | Value |
| :--- | :--- |
| Entry point | `apps/n8n-ts/src/server.ts` — launched with `node apps/n8n-ts/src/server.ts` (Node ≥ 22.18 native type stripping, **no build step**) |
| Bind | `N8N_TS_HOST` else `HOST` else `0.0.0.0` |
| Port | `N8N_TS_PORT` else `PORT` else `5678` |
| Runtime requirements | Node.js ≥ 22.18.0, no runtime npm dependencies beyond the repo's own packages |
| Shutdown | `SIGTERM` / `SIGINT` → readiness flips to `503`, listener stops accepting, in-flight requests drain (≤ 10 s), exit code `0` |
| Restart | MUST be idempotent: a restart MUST NOT lose stored workflows/executions and MUST NOT leave the port bound |

Static boundaries (workers MUST NOT edit outside their scope — see `docs/workers/`):

```
crates/**                  FROZEN (Rust)
apps/n8n-rust/**           FROZEN (Rust)
reference/n8n/**           FROZEN (read-only reference)
deploy/systemd/arena-*     FROZEN (control plane)
tools/arena-*/             FROZEN (control plane)
```

## 2. Environment variables (frozen names, defaults)

All variables are optional. Unknown variables are ignored. Invalid values MUST fail fast at boot with a readable message and exit code `78` (`EX_CONFIG`).

| Variable | Default | Type / allowed | Meaning |
| :--- | :--- | :--- | :--- |
| `N8N_TS_HOST` / `HOST` | `0.0.0.0` | string | listen address |
| `N8N_TS_PORT` / `PORT` | `5678` | int 1–65535 | listen port |
| `N8N_TS_ENV` | `development` | `development` \| `production` \| `test` | affects error verbosity, log default |
| `N8N_TS_LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` | structured log threshold |
| `N8N_TS_LOG_FORMAT` | `json` | `json` \| `text` | `text` is human-friendly for laptops |
| `N8N_TS_DATA_DIR` | `<repo>/data` | path | workflow store + execution records + pid/log default dir |
| `N8N_TS_STORAGE` | `file` | `file` \| `memory` | `memory` = ephemeral (tests) |
| `N8N_TS_MAX_BODY_BYTES` | `1048576` | int ≥ 1024 | request body limit |
| `N8N_TS_EXECUTION_TIMEOUT_MS` | `30000` | int ≥ 1 | per-run wall clock budget |
| `N8N_TS_UNKNOWN_NODE_POLICY` | `passthrough` | `passthrough` \| `error` | behaviour for unregistered node types |
| `N8N_TS_UNKNOWN_CONNECTION_POLICY` | `warn` | `warn` \| `error` | behaviour for connections pointing at missing nodes |
| `N8N_TS_ALLOW_CODE_EVAL` | `false` | boolean | enable restricted in-process `jsCode` evaluation for `code`/`function` nodes (documented as NOT production safe) |
| `N8N_TS_API_KEY` | *(unset)* | string | when set, every `/api/v1/*` request MUST carry `X-N8N-API-KEY: <value>` |
| `N8N_TS_CORS_ORIGIN` | `*` | string \| `off` | `Access-Control-Allow-Origin` value for `/api/v1/*` |
| `N8N_TS_LOCALE` | `id` | `id` \| `jv` \| `ar` \| `zh` \| `ru` \| `en` | default response locale (engine LEGO) |
| `N8N_TS_EXECUTION_HISTORY` | `200` | int 0–10000 | max execution records kept (newest kept) |
| `N8N_TS_PID_FILE` | `<dataDir>/runtime.pid` | path | used by `scripts/*.sh` |

Boolean parsing: `1/true/yes/on` and `0/false/no/off` (case-insensitive). Anything else → boot error.

## 3. HTTP surface (frozen)

Envelope rules:

* Success → `200`/`201` with body `{ "data": <payload> }`.
* Error → matching status with body `{ "code": <STRING>, "message": <string>, "details"?: <any>, "requestId": <string> }`.
* Every response carries `X-Request-Id`; `X-Content-Type-Options: nosniff`; `/api/*` carries the CORS headers when enabled.
* `Content-Type: application/json; charset=utf-8` for JSON, `text/html; charset=utf-8` for `/`.
* **No framing restrictions** (`X-Frame-Options` MUST NOT be set) — the app is embedded in a proxied preview iframe.
* `GET /healthz` returns the exact n8n-compatible body `{"status":"ok"}` (no envelope).

| # | Method | Path | Auth | Success | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | GET | `/` | none | `200 text/html` | Operator console: health strip, workflow editor (JSON), run button, saved-workflow list, result viewer |
| 2 | GET | `/assets/*` | none | `200` | Console assets (inline script allowed; keep zero external CDN deps) |
| 3 | GET | `/healthz` | none | `200 {"status":"ok"}` | exact body |
| 4 | GET | `/healthz/readiness` | none | `200 {"status":"ok","checks":{…}}` | `503 {"status":"error","checks":{…}}` when storage/engine unavailable or shutting down |
| 5 | GET | `/api/v1/version` | api key | `200 {data:{…}}` | see §3.1 |
| 6 | GET | `/api/v1/nodes` | api key | `200 {data:{count,nodes:[…]}}` | registered node handlers (type, group, label, description, implemented) |
| 7 | POST | `/api/v1/workflows/run` | api key | `200 {data: runResult}` | stateless run of a definition in the body |
| 8 | POST | `/api/v1/workflows/:id/run` | api key | `200 {data: runResult}` | run a stored workflow |
| 9 | GET | `/api/v1/workflows` | api key | `200 {data:{count,items:[…]}}` | summaries only |
| 10 | POST | `/api/v1/workflows` | api key | `201` (new) / `200` (existing id) `{data: workflow}` | body is `{"workflow": …}` or a bare workflow |
| 11 | GET | `/api/v1/workflows/:id` | api key | `200 {data: workflow}` | artifact stored verbatim (validated) |
| 12 | PUT | `/api/v1/workflows/:id` | api key | `200 {data: workflow}` | full replace; `404` if unknown |
| 13 | DELETE | `/api/v1/workflows/:id` | api key | `200 {data:{id,deleted:true}}` | idempotent → `404` if unknown |
| 14 | GET | `/api/v1/executions?limit=N` | api key | `200 {data:{count,items:[…]}}` | newest first, default `20`, max `200` |
| 15 | GET | `/api/v1/executions/:id` | api key | `200 {data: executionRecord}` | `404 EXECUTION_NOT_FOUND` |
| 16 | OPTIONS | `/api/v1/*` | none | `204` | CORS preflight |
| 17 | * | anything else | — | `404 NOT_FOUND` | wrong method on a known path → `405` + `Allow` header |

Auth is only enforced when `N8N_TS_API_KEY` is set; otherwise `/api/v1/*` is open (development default).

### 3.1 `GET /api/v1/version`

```json
{ "data": {
  "name": "n8n-ts-runtime",
  "version": "<apps/n8n-ts/package.json version>",
  "api": "v1",
  "contract": "1.0.0",
  "node": "v22.22.3",
  "startedAt": "2026-09-20T10:00:00.000Z",
  "uptimeSec": 12.5,
  "locale": "id",
  "engine": { "package": "@lego/reconstructed-engine", "version": "<pkg version>", "registryVersion": "<from engine entrypoint>" }
} }
```

### 3.2 Run request (endpoints 7 and 8)

```json
{
  "workflow": {
    "id": "wf-optional",
    "name": "optional",
    "nodes": [
      { "name": "Manual Trigger", "type": "n8n-nodes-base.manualTrigger", "parameters": {}, "typeVersion": 1, "position": [0, 0] }
    ],
    "connections": { "Manual Trigger": { "main": [[{ "node": "Code", "type": "main", "index": 0 }]] } }
  },
  "startNode": "Manual Trigger",
  "input": [{ "json": { "seed": 1 } }],
  "locale": "id"
}
```

* `nodes` is **required** and non-empty; `connections` defaults to `{}`.
* Body shorthand: a body that itself contains `nodes` (no `workflow` key) is treated as the workflow.
* `input` accepts either an array of `{json: …}` items or a bare object/array of plain JSON (wrapped into items).
* `startNode` optional; when given it MUST exist → else `400 UNKNOWN_START_NODE`.

### 3.3 Run result (`data` of endpoints 7 and 8)

```json
{
  "executionId": "exec_01J…",
  "workflowId": "wf_01J…",
  "status": "COMPLETED",
  "finished": true,
  "startedAt": "2026-09-20T10:00:00.000Z",
  "stoppedAt": "2026-09-20T10:00:00.012Z",
  "durationMs": 12,
  "executionLog": [
    { "node": "Manual Trigger", "type": "n8n-nodes-base.manualTrigger",
      "inputCount": 1, "outputCount": 1, "durationMs": 0, "status": "success",
      "nodeLabel": "…(optional, from the engine locale layer)", "message": "…(optional)" }
  ],
  "data": { "Manual Trigger": [ { "json": { "triggeredAt": "…", "status": "ACTIVE" } } ] },
  "warnings": [ { "code": "UNKNOWN_NODE_TYPE", "message": "…", "node": "HTTP Request" } ]
}
```

* `status` ∈ `COMPLETED` | `FAILED` | `TIMED_OUT`; `finished` is `false` only for `TIMED_OUT`.
* `data` keys are node names; values are item arrays shaped `{ "json": … }` exactly as produced by the engine LEGO (`packages/reconstructed-engine`). The runtime MUST NOT reshape executed data.
* Extra keys added by the engine locale layer (e.g. localized status text) are allowed — **additive passthrough**.
* Warning codes (frozen vocabulary, additive extensions allowed): `UNKNOWN_NODE_TYPE`, `UNKNOWN_CONNECTION_TARGET`, `CODE_EVAL_DISABLED`, `NODE_EXECUTED_AS_PASSTHROUGH`.

### 3.4 Execution record (endpoint 15)

Run result plus `{ "requestedAt", "requestedBy": "http"|"console", "mode": "manual" }`, `error?: {code,message}` and `warnings`. Records MUST survive a process restart when `N8N_TS_STORAGE=file`.

## 4. Error codes (frozen)

| HTTP | `code` | Trigger |
| :--- | :--- | :--- |
| 400 | `BAD_JSON` | body is not valid JSON |
| 400 | `VALIDATION_ERROR` | schema violation (missing/typed fields) — `details` lists the offending paths |
| 400 | `UNKNOWN_START_NODE` | `startNode` not present in `nodes` |
| 401 | `UNAUTHORIZED` | `N8N_TS_API_KEY` set and header missing/wrong |
| 404 | `NOT_FOUND` | unknown route |
| 404 | `WORKFLOW_NOT_FOUND` | unknown `:id` in the workflow store |
| 404 | `EXECUTION_NOT_FOUND` | unknown execution id |
| 405 | `METHOD_NOT_ALLOWED` | known path, unsupported method (`Allow` header set) |
| 413 | `PAYLOAD_TOO_LARGE` | body exceeds `N8N_TS_MAX_BODY_BYTES` |
| 422 | `EMPTY_WORKFLOW` | `nodes` is an empty array |
| 422 | `INVALID_WORKFLOW` | duplicate node names, non-object node, bad `connections` shape |
| 422 | `UNKNOWN_NODE` | unregistered node type **and** `N8N_TS_UNKNOWN_NODE_POLICY=error` |
| 422 | `UNKNOWN_CONNECTION` | connection target missing **and** `N8N_TS_UNKNOWN_CONNECTION_POLICY=error` |
| 500 | `INTERNAL_ERROR` | unexpected error (engine throw, bug) |
| 500 | `STORAGE_ERROR` | data dir not writable / JSON corrupt |
| 503 | `NOT_READY` | readiness failed or shutting down |
| 504 | `EXECUTION_TIMEOUT` | run exceeded `N8N_TS_EXECUTION_TIMEOUT_MS` |

Production (`N8N_TS_ENV=production`) MUST NOT include stack traces in responses; development MAY add `details.stack`.

## 5. LEGO integration boundary (frozen)

The runtime MUST consume exactly one execution engine. Its only entrypoint is:

```
packages/reconstructed-engine/index.mjs
```

Required named exports (Worker 4 owns them; Worker 1 may not edit them):

| Export | Signature | Meaning |
| :--- | :--- | :--- |
| `ENGINE_PACKAGE` | `string` | `'@lego/reconstructed-engine'` |
| `ENGINE_VERSION` | `string` | package version |
| `NODE_REGISTRY_VERSION` | `string` | changes when the built-in handler set changes |
| `createNodeRegistry(opts?)` | `() => { handlers: Map<string,Function>, list(): NodeTypeInfo[], has(type): boolean, version: string }` | built-in node handler registry |
| `createWorkflowEngine(definition, opts?)` | `() => engine` | engine with the built-in registry pre-registered; `opts = { locale?, allowCodeEval?, registry? }` |
| `runWorkflowDefinition(definition, opts?)` | `async (…) => RunResult` | one-shot run: `opts = { startNode?, input?, locale?, allowCodeEval?, registry? }`; throws `WorkflowRunError` (`.code` ∈ `EMPTY_WORKFLOW` \| `INVALID_WORKFLOW`) for pre-execution failures |
| `validateWorkflowDefinition(definition)` | `() => { ok, errors: [{code,message,path}], warnings: [{code,message,node?}] }` | static pre-flight (used by the runtime for HTTP 400/422 mapping) |
| `listNodeTypes()` | `() => NodeTypeInfo[]` | `{type, group, label, description, implemented}` |

Rules:

1. `apps/n8n-ts/**` MUST NOT implement a workflow execution loop, a queue/DAG scheduler, or node handlers. It only maps HTTP ↔ engine calls (documented as the **single engine rule**).
2. `packages/workflow-lego` and `packages/execution-lego` remain the *declared* model/boundary LEGOs (`contracts/workflow.contract.md`, `contracts/execution.contract.md`). Worker 4 audits and documents their relationship to the runtime; wire-through is optional and MUST NOT introduce a second engine.
3. No new top-level runtime dependencies (no express, no zod, no dotenv): Node built-ins only. `typescript` is a devDependency for `npm run typecheck` only.
4. Arbitrary user JavaScript in `code`/`function` nodes is **disabled by default**. It MAY be enabled with `N8N_TS_ALLOW_CODE_EVAL=true` via `node:vm` with a timeout; the runtime MUST log a loud warning at boot and emit `CODE_EVAL_DISABLED` warnings otherwise.

## 6. Acceptance criteria (baseline gate)

The TypeScript baseline is **not** frozen until every line passes on a clean machine **and** on the VPS:

1. `bash scripts/install.sh` on a clean machine → exit 0, `.env` created, no manual steps.
2. `bash scripts/start.sh` → process running, `GET /healthz` = `{"status":"ok"}`.
3. `POST /api/v1/workflows/run` with a 3-node workflow → `COMPLETED`, `data` contains the last node's items.
4. `bash scripts/doctor.sh` → all checks green on a healthy runtime, actionable output when broken.
5. `bash scripts/stop.sh` → port free, pid file removed.
6. `bash scripts/upgrade.sh` → new revision running; forced failure → automatic rollback to the previous revision.
7. `npm run runtime:gate` (Worker 3 suite) → PASS: health, execution, malformed, empty, unknown node, restart, configuration, regression.
8. `GET /` renders the operator console and can run a stored workflow end-to-end from the browser.
9. Live smoke against `https://n8n.kentutmambu.my.id` → `/healthz` ok + one workflow run ok.

## 7. Change process

Additive changes to this contract (new endpoint, new error code, new env var with a default) MAY be proposed by a worker inside its own PR and are reviewed by the manager. Any **breaking** change requires an explicit version bump of `contract` and a migration note in `docs/runtime/MIGRATION.md`.
