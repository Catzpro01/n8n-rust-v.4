# n8n-rust-v.4

Native JavaScript/TypeScript reconstruction of n8n 2.9.4 with Arena AI Virtual SSH Engine.

The reconstruction never rewrites n8n from guesswork: n8n 2.9.4 is the behavioral
reference, every component is isolated behind an explicit contract, and only then
is its backend data flow reconstructed as a modular LEGO.

> **Governing rule:** [`PROJECT_RULES.md`](PROJECT_RULES.md) (v2.9.4 NATIVE) — rule 1
> **ZERO RUST**. The reconstruction is JavaScript / TypeScript / Node.js, 1:1 from the n8n 2.9.4
> source, and `crates/` + `apps/` must contain no Rust artifacts. A former Rust prototype was
> removed on 2026-09-17; the unconditional guard and evidence are recorded in
> [`docs/isolation/RUST-PURGE-RECORD.md`](docs/isolation/RUST-PURGE-RECORD.md).

## Project status

| stage | state |
| :--- | :--- |
| ANATOMY (`docs/anatomy/`) | ✅ |
| CONTRACT (`contracts/`) | ✅ |
| REFERENCE SOURCE (`reference/n8n/`, n8n 2.9.4) | ✅ |
| REFERENCE RUNTIME (baseline 11/11 smoke test) | ✅ |
| **WORKFLOW ISOLATION (LEGO 01)** | **✅ VERIFIED — see [`docs/isolation/workflow.md`](docs/isolation/workflow.md)** |
| NODE MODEL (LEGO 02) · CONNECTION (03) · VALIDATION (04) | ⏸ next |
| IMPLEMENTATION LANGUAGE | JavaScript / TypeScript / Node.js only; Rust is unconditionally forbidden by PROJECT_RULES #1 and `npm run rust:guard` |

“Isolated” means the TypeScript component now has an enforced boundary and a
contract. It does **not** mean its native JavaScript/TypeScript reconstruction is complete.

## Structure

- `reference/n8n/` : pristine upstream n8n 2.9.4 source (read-only, hash-pinned)
- `docs/anatomy/` : system anatomy (18 documents)
- `contracts/` : formal LEGO contracts (`workflow`, `node`, `connection`, `validation`)
- `docs/isolation/` : Phase 2 isolation records, dependency map, port contract, verification report
- `packages/workflow-lego/` : the isolated Workflow Model LEGO (boundary, ports, tests, manifests)
- `packages/reconstructed-engine/` : the Workflow Execution Engine reconstructed in JavaScript (rule 1 ZERO RUST) — contract [`contracts/execution-engine.contract.md`](contracts/execution-engine.contract.md), `npm run engine:test`
- `tools/` : boundary mapper, kernel/port/reference gates, isolation extractor, model digest, gate runner, live engine harness
- `tests/reference/` : golden workflows + baseline smoke test evidence
- `tasks/`, `results/` : inbound task manifests and execution results
- `crates/`, `apps/n8n-rust/` : placeholder directories, **empty by rule** (`.gitkeep` only); Rust artifacts are forbidden

## Verify a LEGO

```bash
scripts/setup-reference-runtime.sh        # n8n-workflow/core/nodes-base 2.9.1 == the n8n 2.9.4 dependency set
npm install --prefix packages/workflow-lego
npm run verify                            # 11 gates; writes docs/isolation/evidence/*

npm run verify:fast                       # same, without the live engine checks
npm run engine:test:strict                # 114/114; pinned runtime required, no parity skips allowed
npm run isolation:check                   # boundary + kernel + port + reference-integrity + rust guard
npm run rust:guard                        # PROJECT_RULES #1: no .rs / Cargo.toml under crates/ or apps/
```

A failing gate means the isolation is void and must be rolled back — the records
are machine-readable in `docs/isolation/evidence/`.
