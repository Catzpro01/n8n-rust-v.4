# n8n-ts baseline

Minimal Node.js HTTP runtime for the TypeScript LEGO baseline **before** LEGO → Rust migration.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Operator landing page |
| `GET` | `/healthz` | Liveness |
| `GET` | `/healthz/readiness` | Readiness |
| `POST` | `/api/v1/workflows/run` | Run a workflow via `reconstructed-engine` |

Contract: [`contracts/ts-runtime-baseline.contract.md`](../../contracts/ts-runtime-baseline.contract.md)

## Quick start

From repo root:

```bash
./scripts/install.sh
./scripts/start.sh --fg
# other terminal:
curl -s localhost:5678/healthz
```

Or:

```bash
node apps/n8n-ts/src/server.mjs
```

## Engine

**Single engine only:** `packages/reconstructed-engine/runner.mjs`  
Wired through `apps/n8n-ts/lib/engine-adapter.mjs` together with execution-lego / workflow-lego provenance.

Rust (`crates/**`, `apps/n8n-rust`) is **frozen** for this baseline.

## Env

See repo `.env.example` (`N8N_TS_*`).
