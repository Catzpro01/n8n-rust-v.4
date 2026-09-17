# TASK-CGRAPH-01 — Executable golden for 05-cyclic-invalid (observed)

**Status: SUCCESS** — `tests/reference/05-cyclic-invalid/` now carries `case.json` +
`expected.json` **observed** (never hand-written) via `tests/reference/harness/cyclic-graph.js`
(`UPDATE=1` writes; verify mode re-observes and exits non-zero on drift), consumed by an additive
consumer test in `packages/connection-lego/test/cyclic-golden.test.mjs` — lane suite **58/58**
(52 + 6). The audit's last "absent golden" row (04 + 05) is now fully closed (04 by TASK-DGRAPH-01).

## What the golden records (three clearly separated sections)

| Probe | Section | Observed |
| :--- | :--- | :--- |
| C-01 | **reference behaviour** (real `n8n-workflow@2.9.1`) | the cyclic fixture A→B→C→A **constructs fine** (`constructed: true, nodeCount: 3`); `getStartNode()` → **null** (no STARTING_NODE_TYPES / trigger node); `getStartNode("B")` → **"A"** (single-candidate shortcut `!node.disabled`, workflow.ts :823-827) |
| C-02 | **reference behaviour** (Connection LEGO 1:1) | traversal is cycle-safe and terminates: getChildNodes(A) = `["C","B"]`, getChildNodes(B) = `["A","C"]`, getParentNodes(A) = `["C","B"]` |
| C-03 | **NEW CAPABILITY** (agent-4 `workflow-rules.ts`, not reference behaviour) | `detectCycles(fixture)` → `CYCLE_DETECTED` `"Cycle detected: A → B → C → A"` (path `connections/C/main`); `detectCycles(acyclic-twin)` → `[]`; **`validateWorkflow(fixture)` → `valid: true`** |

## Finding (recorded in the golden + N2 pins it)

`validateWorkflow` composes only `checkNodeUniqueness` + `checkDanglingConnections`
(`workflow-rules.ts:168`) — its own `detectCycles` is **never called**, so a cyclic workflow is
reported valid. This is the TS-side mirror of the audit's R5 concern ("a hardcoded-Ok cycle check
passes everything"). N2 pins the observed gap: if the composition ever changes, the golden drifts
and the four protocol items (tests/reference/README.md) are required.

## Falsifiability (in the consumer test)

- Test 0 re-observes via the harness (any hand-edit of expected.json fails CI).
- N1: an always-`[]` "stub" detector must NOT match the golden (the exact R5 stub scenario).
- N2: the composition gap is asserted live AND against the golden row.

## Scope warning (in case.json)

Reference n8n 2.9.4 does NOT validate cycles — grep: "cyclic" absent from
`reference/n8n/packages/workflow/src` and `packages/core/src`. A port that rejects a cycle at
construction or plain traversal DIVERGES. Cycle detection lives only in the additive validator;
the Rust `detect_cycles` (n8n-validation lib.rs:48) must match `workflow-rules.ts`, not the
runtime — C-03 is its R5/R6 oracle, C-01/C-02 the do-not-"fix" pins.

## Matrix

connection-lego **58/58** (additive) · `verify:all` **real exit 0** (8 lanes) · activation
differential **65/0** · conformance 42/42 · boundary PASS.
