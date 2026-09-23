# Manager integration — TypeScript LEGO baseline

**Branch:** `arena/01a0c013-n8n-rust-v-4`  
**Date:** 2026-09-20  
**Rust:** FROZEN (no `crates/**` / `apps/n8n-rust` changes)

## Note on parallel worker branches

Arena session is bound to a single working branch. Worker scopes were executed with **strict path boundaries** on this branch (equivalent to parallel worktrees), then integrated by the manager. Separate GitHub worker PRs into `main` are not opened from alternate local branches in this session.

## Delivered scopes

| Worker | Scope | Status |
|--------|--------|--------|
| Contract first | `contracts/ts-runtime-baseline.contract.md` | DONE |
| W1 Runtime | `apps/n8n-ts/**` HTTP server + engine adapter | DONE |
| W2 Packaging | `scripts/*`, `deploy/docker/*`, `.env.example` | DONE |
| W3 Testing | `tests/runtime/**`, `tests/integration/ts-baseline/**` | DONE 26/26 |
| W4 LEGO | adapter wires reconstructed-engine + execution/workflow lego probes | DONE |

## Evidence

```
npm run test:ts-baseline  →  26 pass, 0 fail
./scripts/install.sh      →  doctor-check OK
./scripts/start.sh        →  healthz 200
POST /api/v1/workflows/run (linear fixture) → COMPLETED, nodes [Manual Trigger, Code, Set]
./scripts/doctor.sh       →  doctor OK
git diff crates apps/n8n-rust reference → empty
```

## Not yet (manager gate remaining)

- [ ] CI green on remote PR (if opened)
- [ ] VPS deploy `vps-runtime` → https://n8n.kentutmambu.my.id
- [ ] Explicit user declaration: `TYPESCRIPT BASELINE FROZEN`

Until those pass, baseline is **usable but not frozen**.
