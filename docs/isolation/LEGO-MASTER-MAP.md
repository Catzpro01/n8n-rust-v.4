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
| Execution Data | Agent 3 | `contracts/execution-data.contract.md` ✅ | `docs/isolation/execution-data.md` ✅ | `packages/execution-data-lego` 24/24 ✅ · gate 6/6 ✅ | **VERIFIED** |
| Expression | Agent 3 | `contracts/expression.contract.md` ✅ | `docs/isolation/expression.md` ✅ | 6 golden test suites ✅ · reconstruction `packages/expression-lego` 6/6 golden + 40/40 contract PASS | **IMPLEMENTED (NODE.JS)** |
| Trigger | Agent 4 | `contracts/trigger.contract.md` ✅ | `docs/isolation/trigger.md` ✅ | golden fixture + lifecycle test ✅ | **ISOLATED** |
| Webhook | Agent 4 | `contracts/webhook.contract.md` ✅ | `docs/isolation/webhook.md` ✅ | golden fixture + routing test ✅ | **ISOLATED** |
| Scheduler | Agent 4 | `contracts/scheduler.contract.md` ✅ | `docs/isolation/scheduler.md` ✅ | golden fixture + scheduler test ✅ | **ISOLATED** |
| Persistence | Agent 4 | `contracts/persistence.contract.md` ✅ | `docs/isolation/persistence.md` ✅ | golden fixture + persistence test ✅ | **ISOLATED** |
| Credentials | Agent 4 | `contracts/credentials.contract.md` ✅ | `docs/isolation/credentials.md` ✅ | `packages/credentials-lego` 22/22 ✅ · gate 6/6 ✅ | **VERIFIED** |
| API | Agent 4 | `contracts/api.contract.md` ✅ | `docs/isolation/api.md` ✅ | `packages/api-lego` 12/12 ✅ · gate 6/6 ✅ | **VERIFIED** |

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
| `POOL-003-error-retry-handling` | execution (validation surface) | same ✅ | same ✅ | `test/03-error-retry.test.mjs` 12/12 ✅ | `E07` ✅ | **IMPLEMENTED** |
| `TASK-EXPRESSION-SANDBOX-01` | execution (expression security) | `contracts/expression.contract.md` ✅ | same ✅ | `test/04-expression-sandbox.test.mjs` 7/7 ✅ | `E09` ✅ | **IMPLEMENTED** |
| `TASK-405-phase3-connection-lego` | connection (LEGO 03) | `contracts/connection.contract.md` ✅ | `docs/isolation/connection.md` ✅ | `packages/connection-lego/test/conformance.test.mjs` 52/52 ✅ (15 reference fixtures + 32 golden probes + 2 negative controls) | `contract_conformance` 42/42 ✅ · `boundary_audit` PASS ✅ | **VERIFIED** |
| `TASK-406-phase3-trigger-lego` | trigger | `contracts/trigger.contract.md` ✅ | `docs/isolation/trigger.md` ✅ | `packages/trigger-lego/test/lifecycle.test.mjs` 9/9 ✅ | `tools/trigger-lego-gate.mjs` 5/5 ✅ | **IMPLEMENTED** |
| `TASK-ENGINE-ACTIVATION-01` | execution (activation lifecycle) | `contracts/execution.contract.md` ✅ | `docs/isolation/execution.md` ✅ | `packages/execution-engine/test/05-activation.test.mjs` 20/20 ✅ (ported from the two reference oracle suites) | `E10` ✅ | **IMPLEMENTED** |
| `TASK-407-phase3-webhook-lego` | webhook | `contracts/webhook.contract.md` ✅ | `docs/isolation/webhook.md` ✅ | `packages/webhook-lego/test/routing.test.mjs` 10/10 ✅ | `tools/webhook-lego-gate.mjs` 5/5 ✅ | **IMPLEMENTED** |
| `TASK-408-phase3-scheduler-lego` | scheduler | `contracts/scheduler.contract.md` ✅ | `docs/isolation/scheduler.md` ✅ | `packages/scheduler-lego/test/scheduler.test.mjs` 9/9 ✅ · Trigger regression 9/9 ✅ | `tools/scheduler-lego-gate.mjs` 6/6 ✅ | **IMPLEMENTED** |
| `TASK-WORKFLOW-MODEL-02` | workflow (LEGO 01) | `contracts/workflow.contract.md` ✅ (§6 surface now complete) | `docs/isolation/workflow.md` ✅ | `packages/workflow-model-lego` 54/54 ✅ (`conformance.test.mjs` 46 — the 14 `wf.*` connection-golden probes + falsification + port tests; `disabled-graph.test.mjs` 8) | `isolation_gate` 11/11 · BEHAVIOR CHANGE: NONE ✅ · `verify:all` exit 0 ✅ | **VERIFIED** |
| `TASK-WORKFLOW-MODEL-03` | workflow (LEGO 01) | `contracts/workflow.contract.md` ✅ (aggregate now complete: 27/27 members) | `docs/isolation/workflow.md` ✅ | `packages/workflow-model-lego` 61/61 ✅ (`static-data-queries.test.mjs` 7 — **51-comparison differential vs `n8n-workflow@2.9.1`, 0 divergences** + 4 negative controls) | `isolation_gate` 11/11 · BEHAVIOR CHANGE: NONE ✅ · `verify:all` exit 0 ✅ | **SUBMITTED_FOR_REVIEW** |
| `TASK-WORKFLOW-MODEL-04` | workflow (LEGO 01) | `contracts/workflow.contract.md` ✅ + `expression.contract.md` ✅ (the last instance property: `expression`, `workflow.ts:72/:134`) | `docs/isolation/workflow.md` ✅ | `packages/workflow-model-lego` 66/66 ✅ (`expression-property.test.mjs` 5 — identity vs the Expression LEGO export, 13/13 property parity, loud-failure-mode demonstration) | `verify:all` exit 0 ✅ · live gate 10/10 ✅ | **SUBMITTED_FOR_REVIEW** |
| `TASK-WORKFLOW-MODEL-01` | workflow (LEGO 01) | `contracts/workflow.contract.md` ✅ (§6 frozen surface) | `docs/isolation/workflow.md` ✅ | `packages/workflow-model-lego/test/conformance.test.mjs` 26/26 ✅ (fixtures `checksum` 8 + `toJSON` 6 + `rename` 6 + 3 negative controls) | `contract_conformance` 42/42 ✅ · `boundary_audit` PASS ✅ | **VERIFIED** |
| `TASK-409-phase3-node-lego` | node (Node Model helpers) | `contracts/node.contract.md` §12 ✅ | `docs/isolation/node.md` §5 ✅ | `packages/node-lego/test/node-model.test.mjs` 58/58 ✅ | `tools/node-lego-gate.mjs` 7/7 ✅ (`N05` differential 315 agree / 0 diverge) | **SUBMITTED_FOR_REVIEW** |
| `TASK-410-phase3-persistence-lego` | persistence | `contracts/persistence.contract.md` ✅ | `docs/isolation/persistence.md` ✅ | `packages/persistence-lego/test/persistence.test.mjs` 13/13 ✅ | `tools/persistence-lego-gate.mjs` 6/6 ✅ | **IMPLEMENTED** |
| `TASK-411-phase3-node-parameter-resolution` | node (parameter resolution) | `contracts/node.contract.md` §12 ✅ | `docs/isolation/node.md` §5 ✅ | `packages/node-lego/test/node-model.test.mjs` 58/58 ✅ (N16/N17/N18 = 76 new differential comparisons) | `tools/node-lego-gate.mjs` 7/7 ✅ (`N05` differential 315 agree / 0 diverge) | **SUBMITTED_FOR_REVIEW** |
| `TASK-412-phase3-node-parameter-issues` | node (field-type validation + issues engine) | `contracts/node.contract.md` §12 ✅ | `docs/isolation/node.md` §5 ✅ | `packages/node-lego/test/parameter-issues.test.mjs` 8/8 ✅ | `tools/node-lego-gate.mjs` 7/7 ✅ | **SUBMITTED_FOR_REVIEW** (concurrent landing — consolidated into TASK-413, ISSUE-026) |
| `TASK-413-phase3-node-parameter-issues` | node (field-type validation + issues engine, full surface) | `contracts/node.contract.md` §12 ✅ | `docs/isolation/node.md` §5 ✅ | `packages/node-lego/test/node-model.test.mjs` 74/74 ✅ + `parameter-issues.test.mjs` 8/8 ✅ (N19/N20/N21/N22 = 1107 new differential comparisons) | `tools/node-lego-gate.mjs` 7/7 ✅ (`N05` differential 1422 agree / 0 diverge) | **SUBMITTED_FOR_REVIEW** |
| `TASK-414-phase3-node-filter-execution` | node (filter execution, webhook paths, cron options) | `contracts/node.contract.md` §12 ✅ | `docs/isolation/node.md` §5 ✅ | `packages/node-lego/test/filter-execution.test.mjs` 11/11 ✅ (N23/N24 = 181 new differential comparisons) | `tools/node-lego-gate.mjs` 7/7 ✅ (`N05` differential 1609 agree / 0 diverge) | **SUBMITTED_FOR_REVIEW** |
| `TASK-415-phase3-validation-lego` | validation (LEGO 04) | `contracts/validation.contract.md` ✅ | `docs/isolation/validation.md` ✅ | `packages/validation-lego/test/conformance.test.mjs` 20/20 ✅ (Golden cases A/B/C/D, parity with n8n-workflow, 2 negative controls) | `contract_conformance` 42/42 ✅ · `boundary_audit` PASS ✅ | **VERIFIED** |
| `TASK-416-phase3-credentials-lego` | credentials | `contracts/credentials.contract.md` ✅ | `docs/isolation/credentials.md` ✅ | `packages/credentials-lego/test/conformance.test.mjs` 22/22 ✅ (cipher round-trip, OpenSSL EVP_BytesToKey parity, 2 negative controls) | `tools/credentials-lego-gate.mjs` 6/6 ✅ | **VERIFIED** |
| `TASK-417-phase3-execution-data-lego` | execution-data | `contracts/execution-data.contract.md` ✅ | `docs/isolation/execution-data.md` ✅ | `packages/execution-data-lego/test/conformance.test.mjs` 24/24 ✅ (7 reference suites, pairing rules, 2 negative controls) | `tools/execution-data-lego-gate.mjs` 6/6 ✅ | **VERIFIED** |
| `TASK-418-phase3-api-lego` | api | `contracts/api.contract.md` ✅ | `docs/isolation/api.md` ✅ | `packages/api-lego/test/conformance.test.mjs` 12/12 ✅ (envelopes, zod 400 raw issues, SPA fallback, 2 negative controls) | `tools/api-lego-gate.mjs` 6/6 ✅ | **VERIFIED** |

| Phase 3 gate | Result |
| :--- | :--- |
| `tools/execution-engine-gate.mjs` | **PASS 10/10** — no dependencies, import-closed, Rust confined, reference intact, 60/60 tests, public surface contracted (60 symbols), expression sandboxed, activation lifecycle |
| Reference tree | unmodified (15050 files, root digest `f8da3518…`) |
| Evidence | `docs/isolation/evidence/execution-engine-gate.json` |

**Reference-fixture coverage on the JS/TS track: 35/35.** `tests/reference/workflow-rust/fixtures.json`
holds 35 cases in 5 groups; `checksum` (8) + `toJSON` (6) + `rename` (6) are covered by
`packages/workflow-model-lego`, `traversal` (9) + `compareConnections` (6) by
`packages/connection-lego`. The same file is the acceptance set for the Rust port track.

**Next Phase 3 work:** caveat C1 (11/11 live smoke on the VPS + PostgreSQL), the remaining frozen
Workflow surface (`getStartNode`, `getHighestNode`, `getNodeConnectionIndexes`,
`getParentMainInputNode`, `getParentNodesByDepth`), and the runtime around the activation LEGO
(cron timer adapter, webhook HTTP servers) — see `docs/isolation/execution.md` §7.
