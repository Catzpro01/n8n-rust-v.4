# @lego/connection — Connection LEGO (Module 03)

Directory-decoupled seam for n8n 2.9.4's connection layer: input/output port mapping
(`IConnections` source ⇄ destination), typed traversal (`main`, `error`-less multi-output, `ai_*`),
main-graph utilities and connection diff. **No algorithm is rewritten** — every symbol is the
reference function (contract: `contracts/connection.contract.md`, owner: agent-3).

```
src/model-surface.ts        ← the ONLY import point for other LEGOs (P-CONNECTION-GRAPH, 12 functions)
src/ports/{contracts,runtime,vocabulary}.ts
src/adapters/reference/     LEGO_PORT_MODE=reference (default): binds to pinned n8n-workflow@2.9.1
src/adapters/strict/        LEGO_PORT_MODE=strict: verbatim vendored reference sources, zero node_modules
src/kernel/vocabulary.ts    NodeConnectionTypes + IConnection types (copied 1:1, drift-checked)
manifest/ownership.json     owns / doesNotOwn / ports / pinned sha256
test/01..04*.test.mjs       boundary, fixture conformance, seam parity, strict isolation
```

## Run (Node ≥ 22.6, no install needed)

```bash
cd packages/connection-lego
node --test test/*.test.mjs                        # reference mode (uses tests/reference/harness/node_modules)
LEGO_PORT_MODE=strict node --test test/*.test.mjs  # strict mode
```

Reference runtime lookup: `LEGO_REFERENCE_PKG` (absolute path to an n8n-workflow install) → falls back to
`tests/reference/harness/node_modules/n8n-workflow`.

## What is deliberately NOT here
- `Workflow.getNodeConnectionIndexes / getHighestNode / getStartNode / getParentMainInputNode / getParentNodesByDepth` → LEGO 01 (CD-04); `wf.*` fixture probes stay in `tests/reference/harness/connection.js`.
- declared port counts (`NodeHelpers.getNodeInputs/Outputs`) → LEGO 02 (CD-05).
- cycle detection / topological sort → LEGO 04 + core `partial-execution-utils` (ISSUE-003 Option A, D-10).
- Rust: `crates/n8n-connection` (orchestrator-owned), gate in `tests/reference/harness/rust/`.

## Ownership note (MSG-18)
`packages/workflow-lego/src/model-surface.ts` also re-exports `graph-utils` + `connections-diff` (frozen 15-symbol
surface). Both seams bind to the same reference bodies, so there is no divergence; the transfer of `common/**`
traversal ownership is tracked in `docs/isolation/connection.md` §0.6 and TASK-303.
