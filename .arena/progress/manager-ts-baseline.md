# Manager progress — TS baseline

- Contract stabilized: `contracts/ts-runtime-baseline.contract.md`
- Runtime: `apps/n8n-ts` (node:http, /, /healthz, POST /api/v1/workflows/run)
- Engine: single `packages/reconstructed-engine/runner.mjs` via `lib/engine-adapter.mjs`
- Packaging scripts + Docker files
- Tests: 26/26 real HTTP
- Rust untouched
- Live local smoke OK on :5678
- Freeze: NOT YET (await VPS + user declaration)
