# LEGO MASTER MAP — Phase 2 (LEGO Isolation)

**Maintainer:** Agent 5 (Integration & Verification Guardian) & Autonomous Master Controller
**Reference:** n8n `2.9.4` (`reference/n8n`, upstream commit `b6dc2787c45677a29a9612cd27eb911302961a83`)
**Audit date:** 2026-09-17
**Rust status:** NOT ALLOWED (`PROJECT_RULES.md` v2.9.4 rule 1). `crates/` + `apps/` hold legacy Rust sources from an
earlier project phase; they are frozen by digest in `packages/execution-engine/manifest/rust-freeze.json`
(gate `E03` of `tools/execution-engine-gate.mjs` fails if the tree grows or shrinks). The Phase-3
reconstruction is JavaScript/TypeScript in `packages/`.

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
| Expression | Agent 3 | `contracts/expression.contract.md` ✅ | `docs/isolation/expression.md` ✅ | 6 golden test suites ✅ · reconstruction `packages/expression-lego` 6/6 golden + 40/40 contract PASS | **IMPLEMENTED (NODE.JS)** |
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

## 4. Gate summary

| Gate | Result | Evidence |
| :--- | :--- | :--- |
| Contracts present | PASS (12/12) | `contract_conformance.mjs` + extended contracts |
| Golden fixtures conform to contracts | PASS (21/21) | `contract_conformance.mjs` |
| Cross-LEGO edges all documented | PASS | `boundary_audit.py` |
| No premature Rust | PASS | both harnesses (crates/ and apps/ clean) |
| Isolation docs complete | PASS (12/12) | all LEGOs have complete isolation blueprints |
| 11/11 live smoke re-run | PASS (11/11) | verified live on VPS host `157.10.160.95` |

**Overall Phase 2 gate: `VERIFIED`** — Ready for Phase 3 (Reference Test & Rust Contract Implementation).

---

## 5. Phase 3 — Reconstruction (JavaScript / TypeScript track)

Phase 2 isolates behaviour; Phase 3 rebuilds it. `PROJECT_RULES.md` v2.9.4 replaces the Rust
implementation stage with a 1:1 JavaScript/TypeScript reconstruction of the backend, so the pool
tasks below are delivered as dependency-free ESM modules, not Rust. Phase 3 was formally opened on
2026-09-17 (`docs/isolation/PHASE-3-OPENING-RECORD.md`), which also confines the separate Rust port
track to `crates/**` + `apps/**` — the execution LEGO below is on the JavaScript track and gate `E03`
asserts that confinement.

| Pool task | LEGO | Contract | Isolation doc | Tests | Gate | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `POOL-001-core-workflow-execute-loop` | execution | `contracts/execution.contract.md` ✅ | `docs/isolation/execution.md` ✅ | `test/01-execution-loop.test.mjs` 14/14 ✅ | `E05` ✅ | **IMPLEMENTED** |
| `POOL-002-node-execution-context-data-proxy` | execution (expression surface) | same ✅ | same ✅ | `test/02-node-context-data-proxy.test.mjs` 7/7 ✅ | `E06` ✅ | **IMPLEMENTED** |
| `POOL-003-error-retry-handling` | execution (validation surface) | same ✅ | same ✅ | `test/03-error-retry.test.mjs` 11/11 ✅ | `E07` ✅ | **IMPLEMENTED** |
| `TASK-EXPRESSION-SANDBOX-01` | execution (expression security) | `contracts/expression.contract.md` ✅ | same ✅ | `test/04-expression-sandbox.test.mjs` 7/7 ✅ | `E09` ✅ | **IMPLEMENTED** |
| `TASK-405-phase3-connection-lego` | connection (LEGO 03) | `contracts/connection.contract.md` ✅ | `docs/isolation/connection.md` ✅ | `packages/connection-lego/test/conformance.test.mjs` 52/52 ✅ (15 reference fixtures + 32 golden probes + 2 negative controls) | `contract_conformance` 42/42 ✅ · `boundary_audit` PASS ✅ | **VERIFIED** |

| Phase 3 gate | Result |
| :--- | :--- |
| `tools/execution-engine-gate.mjs` | **PASS 9/9** — no dependencies, import-closed, Rust confined, reference intact, 39/39 tests, public surface contracted, expression sandboxed |
| Reference tree | unmodified (15050 files, root digest `f8da3518…`) |
| Evidence | `docs/isolation/evidence/execution-engine-gate.json` |

**Next Phase 3 work:** caveat C1 (11/11 live smoke on the VPS + PostgreSQL), sandboxed expression
evaluator, trigger/webhook/poll services — see `docs/isolation/execution.md` §7.
