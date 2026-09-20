# W1 — Runtime Server (`runtime-kernel/ts1-runtime-server`)

Contract: [`contracts/runtime-api.contract.md`](../../contracts/runtime-api.contract.md) §1–§4.
Engine entrypoint: [`contracts/runtime-api.contract.md`](../../contracts/runtime-api.contract.md) §5 (`packages/reconstructed-engine/index.mjs`, delivered by W4).

## ALLOWED

```
apps/n8n-ts/**
```

## FORBIDDEN

```
crates/**  apps/n8n-rust/**  reference/n8n/**  packages/**  tests/**
deploy/**  scripts/**  .github/**  .arena/**  tools/**  contracts/**
```

## Deliverables

| Path | Purpose |
| :--- | :--- |
| `apps/n8n-ts/package.json` | name `@n8n-ts/runtime`, scripts: `start`, `dev`, `typecheck`, `test`, `engines.node >=22.18.0`; devDependency `typescript` only |
| `apps/n8n-ts/tsconfig.json` | `noEmit`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `strict` |
| `apps/n8n-ts/src/server.ts` | entry: config → server → routes → listen → graceful shutdown (`SIGTERM`/`SIGINT`) |
| `apps/n8n-ts/src/config.ts` | env parsing exactly per contract §2, fail-fast exit code `78`, no deps |
| `apps/n8n-ts/src/logger.ts` | structured JSON / text logs, level filter, request id |
| `apps/n8n-ts/src/http/*` | zero-dep router (method+path params), body reader with byte limit, response helpers, `HttpError` classes and the frozen error-code table |
| `apps/n8n-ts/src/routes/*` | `health`, `meta` (version/nodes), `workflows`, `executions`, `console` (HTML) |
| `apps/n8n-ts/src/store/*` | workflow store + execution store (file/memory per contract §2, atomic writes) |
| `apps/n8n-ts/src/engine/bridge.ts` | **only** module importing `packages/reconstructed-engine/index.mjs`; maps definitions → `validateWorkflowDefinition` → `runWorkflowDefinition`, applies timeout and node policy |
| `apps/n8n-ts/src/console/*` | operator console HTML + inline JS (run, save, load, delete, health strip, result viewer) |
| `apps/n8n-ts/README.md` | how to run, every env var, curl examples, troubleshooting |
| `apps/n8n-ts/test/*.test.mjs` | unit tests for config/logger/router/store (integration tests belong to W3) |

## Hard requirements

1. `node apps/n8n-ts/src/server.ts` starts with **no build step** (Node ≥ 22.18 type stripping).
2. Exact response shapes from contract §3; `/healthz` body is exactly `{"status":"ok"}`.
3. No `express`/`zod`/`dotenv`; `node:http`, `node:fs`, `node:path`, `node:crypto`, `node:vm` (opt-in only) etc.
4. Bind `0.0.0.0` by default; never set `X-Frame-Options`; CORS headers per contract.
5. `POST /api/v1/workflows/run` drives the engine LEGO only — no execution loop inside `apps/n8n-ts`.
6. Graceful shutdown drains in-flight requests and flips `/healthz/readiness` to `503`.
7. Data survives restart with `N8N_TS_STORAGE=file`.

## Evidence to record in the PR

```
node apps/n8n-ts/src/server.ts &                    # start
curl -s localhost:5678/healthz                      # {"status":"ok"}
curl -s -X POST localhost:5678/api/v1/workflows/run -d @tests/runtime/fixtures/... | head
npm run typecheck --prefix apps/n8n-ts
node --test apps/n8n-ts/test
```
