# P2-M01 — Lazy tool/skill discovery + token-aware capability budgets

**Slice:** `P2-M01` (activated from `FUTURE-AI-ECOSYSTEM-S01`; legacy `P18`, issues `#234` / `#418`)  
**Program:** `P2` — Frontend, Backend LEGO & AI Foundation  
**Contract:** `ai.capability-budget@1.0.0` (`apps/n8n-lego/src/lego/capability-budget.mjs`)  
**Test Suite:** `apps/n8n-lego/test/lego-capability-budget.test.mjs` (12 focused tests, 12/12 pass)

## Scope Mapping (`#234` / `#418`)

| Canonical Feature / Invariant | Delivered Implementation | Verification Evidence |
| --- | --- | --- |
| `FUTURE-AI-ECOSYSTEM-F-P18-001` — Lazy tool / skill discovery | `createCapabilityDiscoveryCatalog().register` stores only frozen L0/L1 declaration metadata and lazy `loadSchema` / `loadProcedure` callbacks; `getIndexEntry`, `describeSummary`, and `discover` never invoke schema or procedure loaders; `stats()` counts loader invocations per capability | `lego-capability-budget.test.mjs` test 2 |
| `FUTURE-AI-ECOSYSTEM-F-P18-002` — Progressive capability discovery | Four-tier disclosure (`L0_INDEX`, `L1_SUMMARY`, `L2_SCHEMA`, `L3_PROCEDURE`); `discover()` operates strictly at `L0_INDEX` / `L1_SUMMARY` with deterministic relevance + token-efficiency ranking, result cap (`maxDiscoveryResults`), and discovery `tokenBudget` truncation (`truncatedByBudget`, `droppedCount`) | `lego-capability-budget.test.mjs` tests 1, 2, 3 |
| `FUTURE-AI-ECOSYSTEM-F-P18-003` — On-demand tool schema loading | `loadSchema` and `loadProcedure` invoke loaders only for the explicitly requested capability, validate structural and byte/token bounds (`maxSchemaBytes`, `maxSchemaTokensPerItem`, `maxSchemaProperties`, `maxSchemaDepth`), deeply freeze loaded artifacts, and support optional `cacheSchema` memoization | `lego-capability-budget.test.mjs` tests 4, 11 |
| `FUTURE-AI-ECOSYSTEM-F-P18-004` — Token / context-aware capability budgets | `createCapabilityBudget` + `estimateCapabilityTokens` track token allocations across `call`, `run`, and `session` scopes with honest provenance (`reported` vs `estimated`, never fabricated `0`), enforcing `maxCapabilityBudgetTokens`, `maxContextTokens - contextTokensUsed - reserveResponseTokens`, and `maxLoadedSchemas` | `lego-capability-budget.test.mjs` test 5 |
| `FUTURE-AI-ECOSYSTEM-F-P18-005` — Agent runtime workload admission | `admitAgentWorkload` gates agent workloads before execution; supports fail-closed atomic `reject` (rolling back all partial allocations on exhaustion) and priority-ordered `degrade-to-lazy` (`L2_SCHEMA` / `L3_PROCEDURE` -> `L1_SUMMARY` without invoking degraded schema loaders) | `lego-capability-budget.test.mjs` tests 6, 10, 12 |
| P5 Authority Invariant (`discovery != authorization`) | `discover()` sets `authorityGranted: false` and never mutates caller `authorizedCapabilities`; `loadSchema`, `loadProcedure`, and `admitAgentWorkload` require explicit declaration (`CAPABILITY_BUDGET_UNDECLARED`) and caller authorization (`CAPABILITY_BUDGET_UNAUTHORIZED`) before invoking any loader | `lego-capability-budget.test.mjs` test 7 |
| P5 Secret Hygiene Invariant (no raw secrets in context) | `assertNoSecretsInCapability` scans registrations, workloads, loaded tool schemas, and loaded skill procedures for forbidden credential keys (`apiKey`, `password`, `client_secret`, `privateKey`, etc.) and raw secret tokens (`ghp_*`, `sk-*`, `Bearer *`, PEM private keys, `AKIA*`), failing closed with `CAPABILITY_BUDGET_SECRET_REJECTED` | `lego-capability-budget.test.mjs` test 8 |
| Bounded State & CAS Concurrency | Catalog enforces `maxCatalogSize` without silent eviction (`CAPABILITY_BUDGET_CATALOG_FULL`); availability updates and budget mutations enforce optimistic `expectedVersion` / `expectedBudgetVersion` CAS tokens (`CAPABILITY_BUDGET_CONFLICT`) | `lego-capability-budget.test.mjs` tests 9, 12 |

## Baseline vs Post-Change Verification

- `node --test apps/n8n-lego/test/lego-capability-budget.test.mjs`: `12/12 pass` (`0 fail`)
- `node tools/lego/architecture-gate.mjs`: `OK` (`26 domains, 100 locked public contracts`)
- `node tools/lego/architecture-gate.mjs --selftest`: `26/26 pass`
- `node tools/lego/capability-conformance.mjs`: `OK` (`22 REST features vs 101 registered capabilities`)
- `node tools/lego/foundation-gate.mjs`: `OK` (`26 LEGOs, 12 node creation routes`)
- `node tools/lego/scale-out-readiness.mjs`: `OK` (`190 files, 15 declared exceptions, 0 new findings`)
- `node tools/lego/ai-pack.mjs --check`: `OK` (`64 generated, 37 curated, 101 total`)
- `apps/n8n-lego` full test suite: `3138/3138 pass` (`+12` new tests from `3126` baseline, `0 fail`)
- `packages/frontend-lego` full test suite: `1041 pass, 1 skip, 0 fail` (unchanged from baseline)
