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
| **WORKFLOW MODEL LEGO 01 (Phase 3, TS reconstruction)** | **✅ IMPLEMENTED · VERIFIED 26/26 — see [`packages/workflow-model-lego/`](packages/workflow-model-lego/README.md)** |
| **WORKFLOW MODEL LEGO 02 (frozen surface closed)** | **✅ IMPLEMENTED · VERIFIED 54/54 — all 15 frozen §6 symbols + the 14 `wf.*` connection-golden probes (traversal delegated to `start-node-navigation`, single source of truth)** |
| **WORKFLOW MODEL LEGO 03 (aggregate complete)** | **✅ IMPLEMENTED · VERIFIED 61/61 — all 27 reference `Workflow` members + 51-comparison differential vs `n8n-workflow@2.9.1` (0 divergences)** |
| **NODE LEGO 02 (Phase 3, JS reconstruction)** | **✅ IMPLEMENTED · TESTED 45/45 · GATE 7/7 · DIFFERENTIAL 234 agree / 0 diverge — see [`docs/isolation/node.md`](docs/isolation/node.md) §5** |
| **NODE LEGO 02 (Phase 3, JS reconstruction)** | **✅ IMPLEMENTED · TESTED 82/82 · GATE 7/7 · DIFFERENTIAL 1422 agree / 0 diverge — see [`docs/isolation/node.md`](docs/isolation/node.md) §5** |
| **NODE LEGO 02 (Phase 3, JS reconstruction)** | **✅ IMPLEMENTED · TESTED 122/122 · GATE 7/7 · DIFFERENTIAL 1771 agree / 0 diverge — see [`docs/isolation/node.md`](docs/isolation/node.md) §5** |
| **CONNECTION LEGO 03 (Phase 3, TS reconstruction)** | **✅ IMPLEMENTED · VERIFIED 52/52 — see [`packages/connection-lego/`](packages/connection-lego/README.md)** |
| **VALIDATION LEGO 04 (Phase 3, TS reconstruction)** | **✅ IMPLEMENTED · VERIFIED 20/20 — see [`packages/validation-lego/`](packages/validation-lego/README.md)** |
| **CREDENTIALS LEGO (Phase 3, JS reconstruction)** | **✅ IMPLEMENTED · VERIFIED 22/22 · GATE 6/6 — see [`packages/credentials-lego/`](packages/credentials-lego/README.md)** |
| **EXECUTION DATA LEGO (Phase 3, JS reconstruction)** | **✅ IMPLEMENTED · VERIFIED 24/24 · GATE 6/6 — see [`packages/execution-data-lego/`](packages/execution-data-lego/README.md)** |
| **API LEGO (Phase 3, JS reconstruction)** | **✅ IMPLEMENTED · VERIFIED 12/12 · GATE 6/6 — see [`packages/api-lego/`](packages/api-lego/README.md)** |
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
- `packages/workflow-model-lego/` (02) : the remaining frozen §6 surface — `getHighestNode`, `searchNodesBFS`, `getParentNodesByDepth`, `getParentMainInputNode`, `getNodeConnectionIndexes`, `__getStartNode`, `getStartNode` (`getNodeOutputs` **and** `getNodeParameters` consumed from `node-lego` via port CD-05; `start-node-navigation` delegated to so the traversal exists once — ISSUE-027)
- `packages/workflow-model-lego/` (04) : the last instance property — `expression`, wired through a port to the `expression-lego` barrel and assigned as the constructor's last statement (`workflow.ts:134`); unresolvable port throws a loud prerequisite error, never silent `undefined` (13/13 properties)
- `packages/node-lego/` : reconstructed Node Model pure functions — `NodeHelpers` (connection IO, display conditions, naming/tool helpers), `node-validation.ts`, `node-parameters/*` (JavaScript ESM, zero dependencies, differentially pinned to `n8n-workflow@2.9.1`)
- `packages/node-lego/` : reconstructed Node Model pure functions — `NodeHelpers` (connection IO, display conditions, parameter resolution, parameter issues, naming/tool helpers), `node-validation.ts`, `node-parameters/*`, `type-validation.ts`, `utils.deepCopy` (JavaScript ESM, zero dependencies, differentially pinned to `n8n-workflow@2.9.1`)
- `packages/node-lego/` : reconstructed Node Model pure functions — `NodeHelpers` (connection IO, display conditions, parameter resolution, parameter issues, filter execution, webhook paths), `node-validation.ts`, `node-parameters/*`, `type-validation.ts`, `utils.deepCopy` (JavaScript ESM, zero dependencies, differentially pinned to `n8n-workflow@2.9.1`)
- `packages/validation-lego/` : reconstructed n8n 2.9.4 schema and type validation — `type-validation.ts`, `type-guards.ts`, `schemas.ts`, `workflow-rules.ts` (TypeScript, accepted by golden cases A/B/C/D)
- `packages/credentials-lego/` : reconstructed n8n 2.9.4 credentials boundary — `cipher.mjs`, `credentials.mjs`, `redaction.mjs`, `overwrites.mjs`, `helper.mjs` (JavaScript ESM, zero dependencies, EVP_BytesToKey OpenSSL compatibility)
- `packages/execution-data-lego/` : reconstructed n8n 2.9.4 execution data model — `item-helpers.mjs`, `paired-items.mjs`, `run-execution-data-factory.mjs`, `binary-data.mjs` (JavaScript ESM, zero dependencies, exact 2.9.4 pairing rules)
- `packages/api-lego/` : reconstructed n8n 2.9.4 HTTP API boundary — `errors.mjs`, `envelope.mjs`, `validation.mjs`, `dispatcher.mjs` (JavaScript ESM, zero dependencies, response envelopes, SPA fallback)
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
