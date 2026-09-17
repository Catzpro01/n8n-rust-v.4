# TASK RESULT: TASK-WORKFLOW-MODEL-02

- **STATUS**: `SUCCESS`
- **AGENT**: `arena-worker`
- **LEGO COMPONENT**: `workflow`
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-18 (measured on base `d347cfc4`)`

---

`packages/workflow-model-lego/` now carries the **whole** frozen Workflow surface of
`contracts/workflow.contract.md` §6: `getHighestNode`, `searchNodesBFS`, `getParentNodesByDepth`,
`getParentMainInputNode`, `getNodeConnectionIndexes`, `__getStartNode` and `getStartNode` were
added 1:1 from `reference/n8n/packages/workflow/src/workflow.ts` (L491-570, 630-686, 620-622,
687-738, 746-810, 817-864, 866-890), with `dedupe` (`utils.ts:477-479`), `STARTING_NODE_TYPES`
plus five node-type constants (`constants.ts:29-59`) and `IConnectedNode` (`interfaces.ts:3136`)
landing in `src/utils.ts`, `src/node-type-constants.ts` and `src/interfaces.ts`. With those seven
members the **14 `wf.*` probes** of `tests/reference/connection/01..04` — which
`contracts/connection.contract.md` §7 assigned to this LEGO and `packages/connection-lego` had
never claimed — are now asserted here against the values recorded from the real n8n 2.9.4
runtime; the suite went from 26 to **44 tests / 44 pass / 0 fail**, and `tsc -p tsconfig.json`
exits 0 under `strict`. Port CD-05 was re-cut for this: `getNodeOutputs` is resolved from
`packages/node-lego/src/index.mjs` through the new `src/node-port.ts`, and the constructor
parameter `nodeParametersPort` became `nodeHelpersPort` (old name kept as a deprecated alias).
Two things that would otherwise have been silently wrong are pinned by evidence rather than by
reading: the reference passes `nodeType.description` and **not** the node type (verified by an
observed call — `getNodeOutputs` fired once for `Tool` with `outputs: ["main"]`), and the 14/14
result is proven insensitive to `getNodeParameters`, which is still not reconstructed anywhere on
this branch (filed as **ISSUE-026**).

---

## Machine evidence

```
$ npm --prefix packages/workflow-model-lego test
# tests 44
# pass 44
# fail 0
TEST_EXIT=0

$ ./node_modules/.bin/tsc -p tsconfig.json          # strict
TSC=0

$ node tests/compatibility/contract_conformance.mjs
RESULT: 42/42 CHECKS PASSED

$ python3 tests/integration/boundary_audit.py
AUDIT RESULT: PASS (all edges documented)

$ node tools/workflow-isolation-gate.mjs
[PASS] G01 boundary drift gate … G11 live verification (7/7 PASS)
gates: 11/11 PASS · BEHAVIOR CHANGE: NONE DETECTED
GATE_EXIT=0

$ NODE_PATH=$PWD/.runtime/node_modules node tests/reference/harness/run.js
REFERENCE TESTS: 18 PASS / 0 FAIL / 0 UNKNOWN

$ node tests/reference/workflow-rust/build-fixtures.mjs --check
fixtures match the pinned reference: 8 checksum, 6 diff, 6 shape, 6 rename, 9 traversal cases

$ npm run verify:all
VERIFY_EXIT=0
```

Lane gates observed on the same tree: `connection-lego` 52/52 · `node-lego` 7/7 (conformance
45/45, differential **234 agree / 0 diverge**) · `expression-lego` 46/46 · `execution-engine`
60/60 · `trigger-lego` 11/11 · `webhook-lego` 10/10 · `scheduler-lego` 6/6 (9 pass / 0 fail) ·
`persistence-lego` 6/6 (13 pass / 0 fail).

Diff shape: `src/workflow.ts` +427, `test/conformance.test.mjs` +187, `src/interfaces.ts` +32,
`src/errors.ts` +14, `src/index.ts` +3, plus new `src/node-port.ts` (49), `src/utils.ts` (9),
`src/node-type-constants.ts` (23).

---

## The 14 probes, case by case

| golden case | probes | pinned behaviour reproduced |
| --- | --- | --- |
| `01-linear` | 4 | highest node / start node of a plain chain; `getNodeConnectionIndexes` on a direct edge |
| `02-multi-output` | 4 | `getNodeConnectionIndexes(IF,B)` → `{sourceIndex:1,destinationIndex:0}`; `Merge <- Sparse` → `undefined` (the sparse third branch) |
| `03-connection-types` | 3 | `getParentMainInputNode('Tool')` → `'Tool'`; `getNodeConnectionIndexes('Agent','Tool','ai_tool')` → `{sourceIndex:0,destinationIndex:0}` and `undefined` for the default `main` type |
| `04-cycle` | 3 | `getParentNodesByDepth('Merge')` → `[{A,[0],1},{Loop,[0],1},{IF,[1,0],1},{Trigger,[0],2}]`; highest node of `End` in the cycle |

Controls added alongside them: reversing the `04-cycle` ancestor order is rejected (the oracle is
order-sensitive), returning `null` where the reference returns `undefined` is rejected, and the
14/14 result is re-derived under a deliberately mangling `getNodeParameters` — all 14 outputs are
byte-identical, so the acceptance set is not being satisfied by the stand-in.

---

## Corrections this task makes to earlier claims

1. **`getNodeOutputs` argument.** The first draft of `getParentMainInputNode` passed `nodeType`.
   `packages/node-lego/src/connection-io.mjs:67` and `reference …/workflow.ts:702` both read
   `nodeTypeData.outputs`, so that shape makes the callee's dynamic branch throw, the reference's
   `try/catch` swallows it, `console.warn` fires and `outputs` collapses to `[]` — the probe would
   still have returned `'Tool'`, for the wrong reason. Fixed to `nodeType.description`; the call is
   now observed with `outputs: ["main"]`.
2. **Harness invocation.** `tests/reference/harness/run.js` filters on **suite names**
   (`execution-data` | `expression` | `connection`), not on a JSON path. Passing
   `tests/reference/workflow-rust/fixtures.json` selects zero suites and prints
   `0 PASS / 0 FAIL / 0 UNKNOWN`. That is a bad command, not a red gate; run it with no argument
   for all three suites (18 cases).
3. **`packages/reconstructed-engine`.** It has no `package.json` by design and is driven by the
   root script `npm run reconstructed-engine:test`. `npm --prefix packages/reconstructed-engine
   test` exits 254 with `ENOENT` and must not be reported as a lane failure.

## Known gaps (not hidden)

- **ISSUE-026** — `NodeHelpers.getNodeParameters` is not reconstructed on this branch. The
  Workflow constructor requires it whenever a node type resolves; until it exists, every caller
  must inject it. The 14 golden probes do not read `node.parameters`, which is proven above rather
  than asserted.
- Pre-existing and unchanged: ISSUE-010 / ISSUE-011 / ISSUE-019–020 / ISSUE-025 remain open; the
  live 11/11 stage of `tests/integration/run_gate.sh` is not runnable in this sandbox (no docker,
  VPS `157.10.160.95:5678` → `Connection reset by peer`), so G11 is reported at its 7/7 sandbox
  subset; `result_integrity_audit.py` still fails on 6 pre-existing gateway stubs (report-only).
