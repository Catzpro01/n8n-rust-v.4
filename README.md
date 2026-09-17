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
| NODE MODEL (LEGO 02) · CONNECTION (03) · VALIDATION (04) | ✅ verified (agent 2/3/4 lanes) |
| **PHASE 6: QUEUE · EVENTS · REALTIME** | **✅ INTEGRATED — [`contracts/queue.contract.md`](contracts/queue.contract.md), [`events`](contracts/events.contract.md), [`realtime`](contracts/realtime.contract.md) (4/4 cross-LEGO integration tests)** |
| **PHASE 7: EXECUTION (runtime)** | **✅ VERIFIED — [`contracts/execution.contract.md`](contracts/execution.contract.md), [`docs/isolation/execution.md`](docs/isolation/execution.md)** |
| RUST IMPLEMENTATION | ⏸ not started — forbidden in phases 2-7 (`PROJECT_RULES.md` §1) |

“Isolated” means the TypeScript component now has an enforced boundary and a
contract. It does **not** mean it was replaced by Rust.

## Structure

- `reference/n8n/` : pristine upstream n8n 2.9.4 source (read-only, hash-pinned)
- `docs/anatomy/` : system anatomy (18 documents)
- `contracts/` : formal LEGO contracts (16: `workflow`, `node`, `connection`, `validation`, …, `queue`, `events`, `realtime`, `execution`)
- `docs/isolation/` : Phase 2 isolation records, dependency map, port contract, verification report
- `packages/workflow-lego/` : the isolated Workflow Model LEGO (boundary, ports, tests, manifests)
- `packages/{queue,events,realtime}-lego/` : phase 6 LEGOs (queue mode, event bus, SSE/WebSocket push)
- `packages/execution-lego/` : phase 7 EXECUTION LEGO (active executions, activation, context hooks, crash recovery)
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

A failing gate means the isolation is void and must be rolled back — the records
are machine-readable in `docs/isolation/evidence/`.
