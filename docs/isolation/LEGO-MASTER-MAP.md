# LEGO MASTER MAP — Phase 2 (LEGO Isolation)

**Maintainer:** Agent 5 (Integration & Verification Guardian) & Autonomous Master Controller
**Reference:** n8n `2.9.4` (`reference/n8n`, upstream commit `b6dc2787c45677a29a9612cd27eb911302961a83`)
**Audit date:** 2026-09-17
**Rust status:** NOT ALLOWED in Phase 2 — verified clean (`crates/`, `apps/n8n-rust/` contain only `.gitkeep`)

Status vocabulary: `PLANNED | ANALYZED | ISOLATED | TESTED | VERIFIED | BLOCKED | FAILED`

---

## 1. Assigned LEGOs (per `docs/LEGO_PARALLEL_RULES.md`)

All assigned LEGOs have verified contracts, isolation blueprints, and passing gate fixtures.

| LEGO | Owner | Contract | Isolation doc | Tests | Regression | Live | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Workflow | Agent 1 | `contracts/workflow.contract.md` ✅ | `docs/isolation/workflow.md` ✅ | packages/workflow-lego/test/ 5/5 ✅ | 11/11 live VPS gate verified ✅ | verified live on VPS ✅ | **VERIFIED** |
| Node | Agent 2 | `contracts/node.contract.md` ✅ | `docs/isolation/node.md` ✅ | contract-conformance 21/21 ✅ | 11/11 live VPS gate verified ✅ | verified live on VPS ✅ | **VERIFIED** |
| Connection | Agent 3 | `contracts/connection.contract.md` ✅ | `docs/isolation/connection.md` ✅ | contract-conformance 21/21 ✅ | 11/11 live VPS gate verified ✅ | verified live on VPS ✅ | **VERIFIED** |
| Validation | Agent 4 | `contracts/validation.contract.md` ✅ | `docs/isolation/validation.md` ✅ | cycle + uniqueness + dangling 40 golden ✅ | 11/11 live VPS gate verified ✅ | verified live on VPS ✅ | **VERIFIED** |
| Integration | Agent 5 | all contracts | `docs/isolation/PHASE-2-INTEGRATION-REPORT.md` | `contract_conformance.mjs` 21/21 ✅, `boundary_audit.py` PASS ✅ | 11/11 live VPS PASS ✅ | live VPS verified ✅ | **VERIFIED** |

## 2. Extended LEGOs Authored by Agents 3 & 4

All 8 secondary LEGOs have been contracted and isolated under Phase 2 boundary rules:

| LEGO | Owner | Contract | Isolation Doc | Golden / Tests | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Execution Data | Agent 3 | `contracts/execution-data.contract.md` ✅ | `docs/isolation/execution-data.md` ✅ | 7 golden test suites ✅ | **ISOLATED** |
| Expression | Agent 3 | `contracts/expression.contract.md` ✅ | `docs/isolation/expression.md` ✅ | 6 golden test suites ✅ | **ISOLATED** |
| Trigger | Agent 4 | `contracts/trigger.contract.md` ✅ | `docs/isolation/trigger.md` ✅ | golden fixture + lifecycle test ✅ | **ISOLATED** |
| Webhook | Agent 4 | `contracts/webhook.contract.md` ✅ | `docs/isolation/webhook.md` ✅ | golden fixture + routing test ✅ | **ISOLATED** |
| Scheduler | Agent 4 | `contracts/scheduler.contract.md` ✅ | `docs/isolation/scheduler.md` ✅ | golden fixture + scheduler test ✅ | **ISOLATED** |
| Persistence | Agent 4 | `contracts/persistence.contract.md` ✅ | `docs/isolation/persistence.md` ✅ | golden fixture + persistence test ✅ | **ISOLATED** |
| Credentials | Agent 4 | `contracts/credentials.contract.md` ✅ | `docs/isolation/credentials.md` ✅ | golden fixture + credentials test ✅ | **ISOLATED** |
| API | Agent 4 | `contracts/api.contract.md` ✅ | `docs/isolation/api.md` ✅ | golden fixture + envelope test ✅ | **ISOLATED** |

## 3. Source-of-truth mapping (verified against source, not assumed)

Every LEGO is mapped to concrete files under `reference/n8n/packages/workflow/src`.
This mapping is encoded in `tests/integration/boundary_audit.py` (`LEGO_OWNERSHIP`) so the
map and the automated audit can never silently diverge.

| LEGO | Source files | LOC |
| :--- | :--- | :--- |
| Workflow | `workflow.ts` | 925 |
| Node | `node-helpers.ts`, `node-validation.ts`, `node-parameters/**`, `node-reference-parser-utils.ts` | 1966 + … |
| Connection | `graph/graph-utils.ts`, `connections-diff.ts` | 273 + … |
| Validation | `workflow-validation.ts`, `type-validation.ts` | — |
| Expression (support) | `expression.ts`, `expressions/**`, `extensions/**`, `workflow-data-proxy.ts`, `expression-sandboxing.ts` | 714 + … |
| Execution Data (support) | `run-execution-data/**`, `run-execution-data-factory.ts`, `execution-context.ts` | — |
| Shared types | `interfaces.ts`, `schemas.ts`, `types.d.ts` | 3452 + … |

## 4. Phase 6 LEGOs — QUEUE · EVENTS · REALTIME (Agent 3, branch `arena/01a0b16c-n8n-rust-v-4`)

Three subsystems that the anatomy had documented (11-queue, 14-events, 16-realtime) but that
had **no contract, no blueprint, no package and no engine on any branch**:

| LEGO | Owner | Contract | Isolation doc | Package | Tests | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Queue | Agent 3 | `contracts/queue.contract.md` ✅ | `docs/isolation/queue.md` ✅ | `packages/queue-lego` | `node --test` 17/17 ✅ | **VERIFIED** (POOL-009) |
| Events | Agent 3 | `contracts/events.contract.md` ✅ | `docs/isolation/events.md` ✅ | `packages/events-lego` | `node --test` 14/14 ✅ | **VERIFIED** (POOL-010) |
| Realtime | Agent 3 | `contracts/realtime.contract.md` ✅ | `docs/isolation/realtime.md` ✅ | `packages/realtime-lego` | `node --test` 14/14 ✅ | **VERIFIED** (POOL-011) |

Engines: `packages/reconstructed-engine/src/{queue,events,realtime}-engine.ts` (+ shared
`emitter.ts`). Invariants: `Q1..Q14`, `E1..E12`, `R1..R13` — each one machine-checked against
the pinned reference (`b6dc2787…`, n8n 2.9.4) by the package tests and by
`tools/phase6-isolation-gate.mjs` (G01..G08); per-LEGO subsets via `tools/{queue,events,realtime}-isolation-gate.mjs --lego …`.

## 5. Gate summary

| Gate | Result | Evidence |
| :--- | :--- | :--- |
| Contracts present | PASS (15/15) | `contract_conformance.mjs` + extended contracts + queue/events/realtime |
| Golden fixtures conform to contracts | PASS (21/21) | `contract_conformance.mjs` |
| Cross-LEGO edges all documented | PASS | `boundary_audit.py` |
| No premature Rust | PASS | `crates/` + `apps/` clean; Phase-3 Rust archived read-only under `docs/archive/phase3-rust/` |
| Isolation docs complete | PASS (15/15) | all LEGOs have complete isolation blueprints |
| Live smoke re-run | PASS (11/11) | `npm run verify` G11 live verification on this checkout |
| Phase 6 LEGOs (queue/events/realtime) | PASS (8/8) | `tools/phase6-isolation-gate.mjs` → `docs/isolation/evidence/phase6-gate.json` |
| Phase 6 integration (queue × events × realtime) | PASS (4/4) | `tests/integration/phase6-integration.test.mjs` (gate `G08`) |

**Overall gate: `VERIFIED`** — the 18 anatomy subsystems now have 15 contracted LEGOs; queue,
events and realtime moved `DISCOVERED → VERIFIED` in phase 6 without touching the Vue bundle
and without introducing Rust (rule §1).
