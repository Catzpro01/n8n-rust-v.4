# n8n-rust-v.4

High-Performance Rust Port of n8n with Arena AI Virtual SSH Engine.

The port never rewrites n8n from guesswork: n8n 2.9.4 is the behavioral
reference, every component is isolated behind an explicit contract, and only then
is a Rust replacement attempted.

## Project status

| stage | state |
| :--- | :--- |
| ANATOMY (`docs/anatomy/`) | ✅ |
| CONTRACT (`contracts/`) | ✅ |
| REFERENCE SOURCE (`reference/n8n/`, n8n 2.9.4) | ✅ |
| REFERENCE RUNTIME (baseline 11/11 smoke test) | ✅ |
| **WORKFLOW ISOLATION (LEGO 01)** | **✅ VERIFIED — see [`docs/isolation/workflow.md`](docs/isolation/workflow.md)** |
| NODE MODEL (LEGO 02) · CONNECTION (03) · VALIDATION (04) | ⏸ next |
| **EXECUTION ENGINE (Phase 3, JS reconstruction)** | **✅ IMPLEMENTED · TESTED 60/60 · GATE 10/10 — see [`docs/isolation/execution.md`](docs/isolation/execution.md)** |
| **CONNECTION LEGO 03 (Phase 3, TS reconstruction)** | **✅ IMPLEMENTED · VERIFIED 52/52 — see [`packages/connection-lego/`](packages/connection-lego/README.md)** |
| **WORKFLOW MODEL LEGO 01 (Phase 3, TS reconstruction)** | **✅ IMPLEMENTED · VERIFIED 26/26 — see [`packages/workflow-model-lego/`](packages/workflow-model-lego/README.md)** |
| **NODE LEGO 02 (Phase 3, JS reconstruction)** | **✅ IMPLEMENTED · TESTED 58/58 · GATE 7/7 · DIFFERENTIAL 315 agree / 0 diverge — see [`docs/isolation/node.md`](docs/isolation/node.md) §5** |
| **TRIGGER (406) · WEBHOOK (407) LEGOs (Phase 3)** | ✅ IMPLEMENTED (peer lanes) — see `docs/isolation/LEGO-MASTER-MAP.md` §5 |
| RUST PORT (crates/**, apps/**) | ▶ Phase 3 open for the port track (`docs/isolation/PHASE-3-OPENING-RECORD.md`); the JS reconstruction track stays ZERO RUST |

“Isolated” means the TypeScript component now has an enforced boundary and a
contract. It does **not** mean it was replaced by Rust.

## Structure

- `reference/n8n/` : pristine upstream n8n 2.9.4 source (read-only, hash-pinned)
- `docs/anatomy/` : system anatomy (18 documents)
- `contracts/` : formal LEGO contracts (`workflow`, `node`, `connection`, `validation`)
- `docs/isolation/` : Phase 2 isolation records, dependency map, port contract, verification report
- `packages/workflow-lego/` : the isolated Workflow Model LEGO (boundary, ports, tests, manifests)
- `packages/execution-engine/` : reconstructed n8n 2.9.4 execute loop, node context/data proxy and error/retry policy (JavaScript ESM, zero dependencies)
- `packages/connection-lego/` : reconstructed n8n 2.9.4 connection routing — `common/**`, `graph/graph-utils.ts`, `connections-diff.ts` (TypeScript, accepted by the reference-recorded goldens)
- `packages/workflow-model-lego/` : reconstructed n8n 2.9.4 `Workflow` aggregate — nodes map, connection indexes, `renameNode` (incl. defect D-08), `calculateWorkflowChecksum` (TypeScript; graph traversal consumed from `connection-lego` via port CD-02)
- `packages/node-lego/` : reconstructed Node Model pure functions — `NodeHelpers` (connection IO, display conditions, parameter resolution, naming/tool helpers), `node-validation.ts`, `node-parameters/*`, `utils.deepCopy` (JavaScript ESM, zero dependencies, differentially pinned to `n8n-workflow@2.9.1`)
- `tools/` : boundary mapper, kernel/port/reference gates, isolation extractor, model digest, gate runner, live engine harness
- `tests/reference/` : golden workflows + baseline smoke test evidence
- `tasks/`, `results/` : inbound task manifests and execution results
- `crates/`, `apps/n8n-rust/` : (reserved) Rust implementation

## Verify a LEGO

```bash
scripts/setup-reference-runtime.sh        # n8n-workflow/core/nodes-base 2.9.1 == the n8n 2.9.4 dependency set
npm install --prefix packages/workflow-lego
npm run verify                            # 11 gates; writes docs/isolation/evidence/*

npm run verify:fast                       # same, without the live engine checks
npm run isolation:check                   # boundary + kernel + port + reference-integrity only
```

## Verify the execution engine (Phase 3)

```bash
npm run execution:test                    # tests (node:test), no install step
npm run execution:gate                    # gates; writes docs/isolation/evidence/execution-engine-gate.json
npm run verify:all                        # isolation:check + every LEGO gate (execution, connection, trigger, webhook, node)
```

## Verify the Node LEGO (Phase 3)

```bash
npm run node:test                         # 58 tests (node:test), no install step
npm install --prefix packages/workflow-lego   # brings n8n-workflow@2.9.1 = the differential target
npm run node:diff                         # 315 comparisons vs the published reference build, 0 divergences expected
npm run node:gate                         # gates N01…N07; writes docs/isolation/evidence/node-lego-gate.json
```

A failing gate means the isolation is void and must be rolled back — the records
are machine-readable in `docs/isolation/evidence/`.
