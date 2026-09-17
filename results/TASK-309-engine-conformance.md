# TASK RESULT: TASK-309-engine-conformance

- **STATUS**: `SUCCESS`
- **AGENT**: arena worker — session `arena/01a0aee7-n8n-rust-v-4`
- **LEGO COMPONENT**: `workflow` (reconstructed engine, JS)
- **TIMESTAMP**: `2026-09-17 11:05 UTC`
- **MANIFEST**: [`tasks/TASK-309-engine-conformance.yaml`](../tasks/TASK-309-engine-conformance.yaml)

---

### Summary (padat)

TASK-308 closed with two n8n divergences locked as debt; this task closes both **from the reference
source** and then checks the result against the reference **runtime**. `runner.mjs` was rewritten
against `reference/n8n/packages/core/src/execution-engine/workflow-execute.ts` with the source line
cited at every behaviour: a 1:1 port of `mapConnectionsByDestination`, fan-in waiting so a node with
more than one input slot runs **once** with all its inputs (`:405-560`), the release pass that runs
waiting nodes with `[]` for inputs that will never arrive (`:2079-2130`), the error path that records
`taskData.error` + `executionStatus: 'error'` and ends the run with `status: 'error'`
(`:1823-1900`, `:2389`), `continueOnFail` / `onError` passing the **input** through (`:1842-1860`),
a missing destination node now **throws** `ApplicationError('Destination node not found')`
(`:2005-2012`) instead of being ignored, an output with no items no longer runs its branch
(`:2013-2019`), and v1 top-left-first ordering (`:2041-2055`). The two new test files run 22 cases
— including three that execute the same workflow JSON through the **real** `WorkflowExecute` from the
pinned `n8n-core 2.9.1` and compare order, runs-per-node, item counts and the error flag; both sides
agree (e.g. `["Manual Trigger","Upper","NoOp Upper","Lower","NoOp Lower"]`). The suite is now stage 3
of `tests/integration/run_gate.sh`, and a deliberately failing test was used to prove that stage can
actually turn the gate red.

### Evidence

| check | result | exit |
| :--- | :--- | ---: |
| `npm run engine:test` | `# tests 22 · # pass 22 · # fail 0 · # skipped 0` | 0 |
| ↳ 3 EQUIVALENCE cases vs real `n8n-core 2.9.1` `WorkflowExecute` | linear + fan-out v1 + fan-out v0 all match | 0 |
| reference vs reconstructed order (fan-out, v1) | both `["Manual Trigger","Upper","NoOp Upper","Lower","NoOp Lower"]` | — |
| `bash tests/integration/run_gate.sh --offline-only` | `OFFLINE STAGES : PASS` (stages 1-3) / `LIVE 11/11 : NOT RUN` | 2 (INCONCLUSIVE by design) |
| ↳ negative test of the new stage | injected a failing test → `OFFLINE STAGES : FAIL`, `not ok 23` | 1 |
| `npm run verify` (Workflow LEGO, 11 gates) | `11/11 PASS · BEHAVIOR CHANGE: NONE DETECTED` | 0 |
| `node packages/reconstructed-engine/test-run.mjs` | still succeeds after the status-vocabulary change | 0 |

Divergences closed (were asserted as debt in `results/TASK-308-engine-regression.md`):

| behaviour | before (TASK-308) | now | reference |
| :--- | :--- | :--- | :--- |
| diamond fan-in | destination ran once per arriving edge (2×) | runs **once** with `[input0, input1]` | `:405-560` |
| handler throws | promise rejected, no result at all | `status: 'error'`, `resultData.error`, `runData[node][0].executionStatus === 'error'`, downstream skipped | `:1823-1900` |
| `continueOnFail` / `onError` | not implemented | input passed through, run continues, error still recorded | `:1842-1860` |
| dangling connection | silently ignored | `ApplicationError('Destination node not found')` | `:2005-2012` |
| empty output | branch still executed with `[]` | branch does not run | `:2013-2019` |

### Breaking changes (deliberate, all n8n behaviour)

1. `result.status` is an `ExecutionStatus` (`'success'` / `'error'`) — no longer `'COMPLETED'`.
2. A connection to a node missing from the graph rejects instead of being ignored.
3. A throwing handler no longer rejects the promise; the error lands in `resultData`.

`resultData.{runData,lastNodeExecuted,error}` is the n8n shape (`ITaskData[]` per node);
`data` and `executionLog` remain as flat compatibility views.

### Boundary compliance

* `reference/n8n/**` **read-only** — gate `G04` re-verified the tree byte-identical (15 050 files,
  root `f8da35180669d798…`) in the same run.
* **Zero Rust** (rule 1) — `npm run rust:guard` exit 0; `crates/` and `apps/` still `.gitkeep`-only.
* **UI untouched** (rule 5) — no `editor-ui`, `.vue`, CSS/SCSS or theme file in the diff.
* The reference runtime keeps background handles alive (the same reason
  `tools/live/engine-harness.mjs` calls `process.exit` explicitly), so `engine:test` runs with
  `--test-force-exit`. The equivalence cases skip themselves when `.runtime` is absent, so the gate
  still runs on a bare checkout.

### Handed to the next worker

1. The equivalence suite stubs node implementations on both sides by design — it verifies engine
   orchestration only. Extending it to real node logic belongs to the Node LEGO.
2. `releaseWaitingNodes` checks only DIRECT predecessors; the reference walks
   `workflow.getParentNodes` (all ancestors) and evaluates `requiredInputs` from the node type
   description. Both are named in the source comments as deliberate simplifications.
   **→ CLOSED by [`TASK-310`](TASK-310-graph-ports.md)** (2026-09-17), except the expression form of
   `requiredInputs`, which needs the Expression LEGO.
3. Still not reconstructed: expressions `{{ … }}`, credentials, pin data, `waitTill` resume,
   sub-workflows, AI/routing nodes, execution timeout.
4. VPS `11/11` PostgreSQL smoke (caveat `C1` of `TASK-305`) remains outstanding — unreachable from
   this sandbox (`157.10.160.95` → HTTP 000, no `docker`).
