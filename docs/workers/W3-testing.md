# W3 — Testing (`verification/ts1-runtime-tests`)

Contract: [`contracts/runtime-api.contract.md`](../../contracts/runtime-api.contract.md).
Principle: **tests exercise the real runtime process over real HTTP** — no mocked server, no in-process handler calls for the acceptance paths.

## ALLOWED

```
tests/runtime/**
tests/fixtures/runtime/**
tests/integration/runtime_*.mjs  tests/integration/runtime_*.sh  tests/integration/runtime_*.py
```

## FORBIDDEN

```
apps/**  packages/**  crates/**  apps/n8n-rust/**  reference/n8n/**  deploy/**  scripts/**
existing files in tests/integration/** (non runtime_*)  tests/reference/**  .github/**  .arena/**
contracts/**  docs/workers/**  package.json (root)
```

## Deliverables

| Path | Purpose |
| :--- | :--- |
| `tests/runtime/helpers/process.mjs` | spawn `apps/n8n-ts/src/server.ts` on a free ephemeral port with an isolated temp data dir, wait for readiness, tear down (kill + assert port released), plus HTTP helpers (`get`, `post`, `raw`) returning `{status, headers, body}` |
| `tests/runtime/01-health.test.mjs` | `/healthz` exact body, `/healthz/readiness` shape, `/api/v1/version`, unknown route 404, CORS headers, `X-Request-Id` |
| `tests/runtime/02-workflow-execution.test.mjs` | 1-node, linear 3-node, branching, multi-item input, `startNode`, stateless run + stored workflow run, execution record retrieval, `data` shape fidelity |
| `tests/runtime/03-malformed-request.test.mjs` | broken JSON → 400 `BAD_JSON`, missing `workflow.nodes` → 400 `VALIDATION_ERROR`, wrong types, duplicate node names → 422 `INVALID_WORKFLOW`, body over the limit → 413, method not allowed → 405 + `Allow`, unknown execution id → 404 |
| `tests/runtime/04-empty-workflow.test.mjs` | `nodes: []` → 422 `EMPTY_WORKFLOW`; missing `connections` still runs; no node output for unknown start node → 400 |
| `tests/runtime/05-unknown-node.test.mjs` | default `passthrough` → 200 + `UNKNOWN_NODE_TYPE` warning + items passed through; `N8N_TS_UNKNOWN_NODE_POLICY=error` → 422 `UNKNOWN_NODE`; unknown connection target → warning, and `UNKNOWN_CONNECTION` under the strict policy |
| `tests/runtime/06-restart.test.mjs` | save workflow → restart process → workflow still listed and runnable; execution record survives; port released after stop; double-start protection (W2 script contract) |
| `tests/runtime/07-configuration.test.mjs` | `N8N_TS_PORT`/`PORT` precedence, `N8N_TS_API_KEY` (401 without/with wrong key, 200 with key, health stays open), `N8N_TS_MAX_BODY_BYTES`, `N8N_TS_LOCALE`, `N8N_TS_STORAGE=memory` (nothing persisted), invalid env → exit 78 with a readable message |
| `tests/runtime/08-regression.test.mjs` | replay every fixture in `tests/fixtures/runtime/workflows/**` and compare against the committed expected results (`fixtures/runtime/expected/**`) with volatile fields normalised (`executionId`, timestamps, durations) — a golden-style regression net for later Rust migration |
| `tests/integration/runtime_lego_integration.mjs` | the *single engine rule*: `apps/n8n-ts/src` must not contain execution-loop/node-handler logic (import-graph + heuristic gate), must import `packages/reconstructed-engine/index.mjs`, and must not add third-party runtime deps |
| `tests/integration/runtime_gate.sh` | one entry point: typecheck → runtime suite → integration checks; exit 0 only when all pass (used by CI and the laptop runner) |

## Hard requirements

1. `node --test` (Node ≥ 22.18); no test framework dependency. Tests are hermetic: ephemeral ports, temp data dirs, no network access to the internet, no writes outside `os.tmpdir()`.
2. No `sleep`-based flakiness: poll readiness with a timeout, always kill children in `after()` hooks, and fail loudly with captured stdout/stderr on startup errors.
3. A test that cannot run (e.g. missing Node feature) MUST fail, not skip silently.
4. Fixtures are runtime-owned (`tests/fixtures/runtime/**`); `tests/reference/**` is frozen and untouched.
5. Every contract §4 error code and every §3 endpoint has at least one assertion.
6. Coverage list from the task brief: health, workflow execution, malformed request, empty workflow, unknown node, restart, configuration, regression — all present and **green against the real server**.
