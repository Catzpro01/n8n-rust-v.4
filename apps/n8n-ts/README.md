# `apps/n8n-ts` — TypeScript runtime (baseline)

A dependency-free `node:http` runtime that exposes the LEGO execution engine over HTTP and serves a
browser console. It is the **usable baseline** that must be stable *before* any LEGO is migrated to Rust.

* Contract: [`contracts/runtime-api.contract.md`](../../contracts/runtime-api.contract.md)
* Engine: [`packages/reconstructed-engine`](../../packages/reconstructed-engine/README.md) (the single execution engine)
* Worker charter: [`docs/workers/W1-runtime-server.md`](../../docs/workers/W1-runtime-server.md)

## Run it

```bash
# from the repository root
node apps/n8n-ts/src/server.ts            # http://localhost:5678
# or with the packaged scripts (recommended on a VPS)
bash scripts/install.sh && bash scripts/start.sh
```

Requirements: **Node.js ≥ 22.18** (native TypeScript execution — there is no build step).
No runtime npm dependencies; `typescript` is a devDependency used by `npm run typecheck` only.

```bash
npm --prefix apps/n8n-ts install       # dev tooling (tsc + @types/node)
npm --prefix apps/n8n-ts run typecheck
node --test apps/n8n-ts/test/*.test.mjs
```

## Configuration (contract §2)

| Variable | Default | Notes |
| :--- | :--- | :--- |
| `N8N_TS_HOST` / `HOST` | `0.0.0.0` | listen address |
| `N8N_TS_PORT` / `PORT` | `5678` | listen port |
| `N8N_TS_ENV` | `development` | `development` \| `production` \| `test` (production hides stack traces) |
| `N8N_TS_LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `N8N_TS_LOG_FORMAT` | `text` in development, `json` otherwise | `json` for systemd/journald |
| `N8N_TS_DATA_DIR` | `<repo>/data` | workflows + execution records |
| `N8N_TS_STORAGE` | `file` | `memory` for throwaway runs |
| `N8N_TS_MAX_BODY_BYTES` | `1048576` | requests above this get `413` |
| `N8N_TS_EXECUTION_TIMEOUT_MS` | `30000` | `504 EXECUTION_TIMEOUT` beyond it |
| `N8N_TS_UNKNOWN_NODE_POLICY` | `passthrough` | `error` turns unknown node types into `422 UNKNOWN_NODE` |
| `N8N_TS_UNKNOWN_CONNECTION_POLICY` | `warn` | `error` turns dangling connections into `422 UNKNOWN_CONNECTION` |
| `N8N_TS_ALLOW_CODE_EVAL` | `false` | enables the restricted `node:vm` sandbox for `jsCode` (**not production safe**) |
| `N8N_TS_API_KEY` | *(unset)* | when set, `/api/v1/*` requires `X-N8N-API-KEY` |
| `N8N_TS_CORS_ORIGIN` | `*` | `off` disables CORS headers |
| `N8N_TS_LOCALE` | `id` | response locale (`id`, `jv`, `ar`, `zh`, `ru`, `en`) |
| `N8N_TS_EXECUTION_HISTORY` | `200` | execution records kept |
| `N8N_TS_PID_FILE` | `<dataDir>/runtime.pid` | used by `scripts/*.sh` |

Invalid values abort the boot with exit code `78` and a message naming the variable — never a silent fallback.

## Endpoints

| Method | Path | Purpose |
| :--- | :--- | :--- |
| GET | `/` | operator console (health, editor, save/run/delete, results, history) |
| GET | `/healthz` | `{"status":"ok"}` — n8n-compatible |
| GET | `/healthz/readiness` | `200`/`503` with a checks object |
| GET | `/healthz/full` | single JSON document for `scripts/doctor.sh` |
| GET | `/api/v1/version` | runtime + engine versions, uptime |
| GET | `/api/v1/nodes` | registered node handlers |
| GET | `/api/v1/runtime/config` | effective configuration (API key masked) |
| POST | `/api/v1/workflows/run` | stateless run of a workflow in the body |
| GET/POST | `/api/v1/workflows` | list summaries / create or update |
| GET/PUT/DELETE | `/api/v1/workflows/:id` | read, replace, delete |
| POST | `/api/v1/workflows/:id/run` | run a stored workflow |
| GET | `/api/v1/executions` | recent runs (`?limit=`) |
| GET | `/api/v1/executions/:id` | full execution record |

## curl examples

```bash
curl -s localhost:5678/healthz

curl -s -X POST localhost:5678/api/v1/workflows/run \
  -H 'content-type: application/json' \
  -d '{
        "workflow": {
          "name": "demo",
          "nodes": [
            {"name": "Manual Trigger", "type": "n8n-nodes-base.manualTrigger", "parameters": {}},
            {"name": "Edit Fields", "type": "n8n-nodes-base.set",
             "parameters": {"values": {"string": [{"name": "status", "value": "ok"}]}}}
          ],
          "connections": {"Manual Trigger": {"main": [[{"node": "Edit Fields", "type": "main", "index": 0}]]}}
        },
        "input": [{"json": {"seed": 1}}]
      }' | python3 -m json.tool
```

With `N8N_TS_API_KEY` set, add `-H "x-n8n-api-key: $KEY"` (the console has an API-key field that stores it in `localStorage`).

## Architecture

```
server.ts      boot / listen / graceful shutdown (SIGTERM, SIGINT)
app.ts         pipeline: CORS → auth → shutdown gate → route → envelope → access log
config.ts      env parsing (fail fast, exit 78)
http/          router (method+path params), body reader with byte limit, error table, response envelope
store/         workflow store (atomic JSON) + execution store (jsonl index + per-run files)
engine/bridge  the ONLY module that imports packages/reconstructed-engine — validation, policy, timeout
routes/        health, meta, workflows, executions
console/       self-contained HTML console (no CDN, no build)
```

The runtime contains **no execution loop and no node behaviour** — that is the LEGO's job
(single-engine rule, `docs/lego-integration.md`).

## Behaviour worth knowing

* **Deterministic runs.** Node handlers never read the clock or the network, so identical input produces
  identical `data` — which is what makes the regression fixtures usable as a Rust equivalence baseline.
* **Expression values are not evaluated.** `= {{ … }}` is used verbatim and reported as an
  `EXPRESSION_NOT_EVALUATED` warning. Conditional/routing nodes and HTTP nodes are not registered: they
  pass items through and report `UNKNOWN_NODE_TYPE`.
* **Failures are recorded.** Every run (success, timeout, failure) is written to the execution store and
  retrievable via `/api/v1/executions/:id`, which is the fastest way to debug a workflow after a restart.
* **Timeouts are soft.** The HTTP request ends with `504` and the record is marked `TIMED_OUT`; the engine
  promise keeps running in the background because the reference engine has no cancellation hook yet
  (documented limitation, will be revisited during the Rust migration).

## Troubleshooting

| Symptom | Fix |
| :--- | :--- |
| `Node.js >= 22.18.0 is required` | upgrade Node (`nvm install 22`, `apt-get install nodejs` from NodeSource) |
| exit code 78 | the message names the offending variable; run `bash scripts/doctor.sh` |
| `EADDRINUSE` | another process owns the port: `bash scripts/doctor.sh` shows the owner (`ss -ltnp`) |
| console shows `health: unreachable` | the process is down or the proxy targets another port |
| `401 UNAUTHORIZED` | `N8N_TS_API_KEY` is set; send `X-N8N-API-KEY` |
| runs are `COMPLETED` but data looks unchanged | the node type is not registered — check the `warnings` array |
