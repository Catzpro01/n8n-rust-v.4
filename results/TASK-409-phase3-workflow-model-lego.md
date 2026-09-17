# TASK RESULT: TASK-409-phase3-workflow-model-lego

- **STATUS**: `SUCCESS`
- **AGENT**: `arena-worker`
- **LEGO COMPONENT**: `workflow`
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-17 17:28 UTC`

---

`packages/workflow-model-lego/` reconstructs the n8n 2.9.4 `Workflow` aggregate in strict
TypeScript — `setNodes`, `setConnections`, `setPinData`, `setSettings`, `overrideStaticData`,
`getNode`, `getNodes`, `getPinDataOfNode`, `renameNodeInParameterValue`, `renameNode`,
`getChildNodes`, `getParentNodes`, `getConnectedNodes`, plus `calculateWorkflowChecksum`,
`observable-object.ts`, `global-state.ts` and the node-reference rewriting half of
`node-reference-parser-utils.ts`. It closes the last 20 of the 35 reference fixture cases
(`checksum` 8, `toJSON` 6, `rename` 6); the other 15 were closed by TASK-405's
`packages/connection-lego`, so **all 35 are now covered on the JS/TS track**. The graph traversal
is *not* copied: port CD-02 resolves the real `packages/connection-lego` build at runtime and a
test asserts symbol identity with it. **26/26 tests pass**, including three negative controls
proving the oracle rejects a checksum without key sorting, a `renameNode` that "fixes" D-08, and a
`renameNode` with a collision guard.

### Environment correction (recorded so the numbers are reproducible)

The first sweep in this sandbox reported `ISOLATION = FAILED (6 gates): G06…G11`, and the
expression/reference suites errored. Cause: a fresh sandbox carries neither `.runtime/` (the pinned
reference runtime) nor any `node_modules`, because both are gitignored and therefore absent from the
snapshot. That is a missing build environment, not a regression. `scripts/setup-reference-runtime.sh`
plus `npm install` in `packages/{workflow-lego,connection-lego,expression-lego,workflow-model-lego}`
were run, and only then was the sweep re-run — every number below is from the re-run.

### Pipeline Operations Summary

| Operation | Status | Exit Code |
| :--- | :--- | :--- |
| `setup-reference-runtime.sh` (fresh sandbox) | ✓ SUCCESS | `0` (n8n-workflow/core/nodes-base 2.9.1) |
| `npm install` × 4 packages | ✓ SUCCESS | `0` |
| `tsc -p tsconfig.json` (strict) | ✓ SUCCESS | `0` |
| `npm run workflow-model-lego:test` | ✓ SUCCESS | `0` (26/26) |
| `node tests/compatibility/contract_conformance.mjs` | ✓ SUCCESS | `0` (42/42) |
| `python3 tests/integration/boundary_audit.py` | ✓ SUCCESS | `0` (PASS) |
| `npm run connection-lego:test` | ✓ SUCCESS | `0` (52/52) |
| `npm --prefix packages/expression-lego test` | ✓ SUCCESS | `0` (46/46) |
| `node --test packages/reconstructed-engine/*.test.mjs` | ✓ SUCCESS | `0` (28/28) |
| `node tools/workflow-isolation-gate.mjs` | ✓ SUCCESS | `0` (11/11) |
| `node tools/execution-engine-gate.mjs` | ✓ SUCCESS | `0` (9/9) |
| `tests/reference/harness/run.js` | ✓ SUCCESS | `0` (18/18) |
| `build-fixtures.mjs --check` | ✓ SUCCESS | `0` (no drift) |
| `npm run verify:all` | ✓ SUCCESS | `0` |

### Detailed Logs

#### Operation: conformance suite

```text
$ npm run workflow-model-lego:test
# tests 26
# pass 26
# fail 0
```

26 = provenance (1) + port integrity (1) + `checksum` (8) + whitelist cross-check (1) +
`toJSON` (6) + `rename` (6) + negative controls (3).

#### Operation: full branch sweep (no regression)

```text
$ node tests/compatibility/contract_conformance.mjs
[PASS] Phase 3: Rust confined to crates/** and apps/** — 22 Rust file(s) …, workspace manifest present
[PASS] Phase 3: frozen Workflow surface intact — 15/15 frozen symbols present
RESULT: 42/42 CHECKS PASSED

$ python3 tests/integration/boundary_audit.py
AUDIT RESULT: PASS (all edges documented)

$ node tools/workflow-isolation-gate.mjs
gates: 11/11 PASS · BEHAVIOR CHANGE: NONE DETECTED

$ node tools/execution-engine-gate.mjs
Execution LEGO gate: 9/9 PASS

$ node tests/reference/harness/run.js
REFERENCE TESTS: 18 PASS / 0 FAIL / 0 UNKNOWN

$ node tests/reference/workflow-rust/build-fixtures.mjs --check
fixtures match the pinned reference: 8 checksum, 6 diff, 6 shape, 6 rename, 9 traversal cases

$ npm run verify:all   → exit 0   (106 assertions: 28 + 52 + 26)
```

Note on one gate line: `Phase 3: Rust-port acceptance fixtures present — checksum:3 …` reports
`Object.keys()` of each fixture *group* (`checksum` is an object with `algorithm`, `whitelist`,
`cases`), not a case count. It is a presence check; the case counts are the 8/6/6/9/6 above.

#### Operation: not executed — live 11/11 regression stage

`docker` is not installed in this sandbox and the VPS n8n instance is unreachable from it, so
`run_gate.sh` still reports the live stage as `NOT RUN` / `INCONCLUSIVE`. Unchanged caveat C1 /
ISSUE-010; nothing in this task touches that path.
