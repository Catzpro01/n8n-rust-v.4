# LEGO MASTER MAP — Phase 2 (LEGO Isolation)

**Maintainer:** Agent 5 (Integration & Verification Guardian)
**Reference:** n8n `2.9.4` (`reference/n8n`, upstream commit `b6dc2787c45677a29a9612cd27eb911302961a83`)
**Audit date:** 2026-09-16
**Rust status:** NOT ALLOWED in Phase 2 — verified clean (`crates/`, `apps/n8n-rust/` contain only `.gitkeep`)

Status vocabulary: `PLANNED | ANALYZED | ISOLATED | TESTED | VERIFIED | BLOCKED | FAILED`

---

## 1. Assigned LEGOs (per `docs/LEGO_PARALLEL_RULES.md`)

These are the LEGOs that actually have an owner and a task manifest in this repository.

| LEGO | Owner | Contract | Isolation doc | Tests | Regression | Live | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Workflow | Agent 1 | `contracts/workflow.contract.md` ✅ | `docs/isolation/workflow.md` ✅ | packages/workflow-lego/test/ 5/5 ✅ | 11/11 live VPS gate verified ✅ | verified live on VPS ✅ | **VERIFIED** |
| Node | Agent 2 | `contracts/node.contract.md` ✅ | ❌ `docs/isolation/node.md` **MISSING** | contract-conformance ✅ (schema only) | not run | not run | **BLOCKED** |
| Connection | Agent 3 | `contracts/connection.contract.md` ✅ | ❌ `docs/isolation/connection.md` MISSING | contract-conformance ✅ (schema + dangling) | baseline recorded only | not re-verified | **BLOCKED** (no isolation doc) |
| Validation | Agent 4 | `contracts/validation.contract.md` ✅ | ❌ `docs/isolation/validation.md` MISSING | cycle + uniqueness + dangling ✅; `DisabledHandling` ❌ untested | baseline recorded only | not re-verified | **BLOCKED** (no isolation doc, 1 rule untested) |
| Integration | Agent 5 | all contracts | this document | `tests/compatibility/contract_conformance.mjs` 21/21 ✅, `tests/integration/boundary_audit.py` PASS ✅ | 11/11 live VPS PASS ✅ | live VPS verified ✅ | **VERIFIED** |

## 2. LEGOs named in the Agent-5 brief but NOT yet owned in this repo

The brief's table lists ten LEGOs. Only four are assigned by `docs/LEGO_PARALLEL_RULES.md` and have
contracts. The rest exist as **anatomy documentation only** (`docs/anatomy/`) — no contract, no
isolation doc, no owner. Recording them honestly as `PLANNED` rather than inventing status:

| LEGO | Brief owner | Anatomy doc | Contract | Isolation | Tests | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Execution Data | Agent 3 | `06-execution-data.md` ✅ | ❌ missing | ❌ | ❌ | **PLANNED** |
| Expression | Agent 3 | `07-expression.md` ✅ | ❌ missing | ❌ | ❌ | **PLANNED** |
| Trigger | Agent 4 | `08-trigger.md` ✅ | ❌ missing | ❌ | ❌ | **PLANNED** |
| Webhook | Agent 4 | `09-webhook.md` ✅ | ❌ missing | ❌ | ❌ | **PLANNED** |
| Scheduler | Agent 4 | `10-scheduler.md` ✅ | ❌ missing | ❌ | ❌ | **PLANNED** |
| Persistence | Agent 4 | `12-persistence.md` ✅ | ❌ missing | ❌ | ❌ | **PLANNED** |
| Credentials | Agent 4 | `13-credentials.md` ✅ | ❌ missing | ❌ | ❌ | **PLANNED** |
| API | Agent 4 | `15-api.md` ✅ | ❌ missing | ❌ | ❌ | **PLANNED** |

> Agent 5 does **not** author these contracts — ownership belongs to Agents 3 and 4.
> Tracked as `ISSUE-002` in `CROSS-AGENT-ISSUES.md`.

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

## 4. Gate summary

| Gate | Result | Evidence |
| :--- | :--- | :--- |
| Contracts present | PASS (4/4) | `contract_conformance.mjs` |
| Golden fixtures conform to contracts | PASS (16/16) | `contract_conformance.mjs` |
| Cross-LEGO edges all documented | PASS | `boundary_audit.py` |
| No premature Rust | PASS | both harnesses |
| Isolation docs complete | **FAIL (1/4)** | only `workflow.md` exists |
| 11/11 live smoke re-run | **NOT RUN** | no Docker/pnpm/n8n host in this environment |

**Overall Phase 2 gate: `BLOCKED`** (re-affirmed 2026-09-17 — see ISSUE-009/010) — see `PHASE-2-INTEGRATION-REPORT.md`.
