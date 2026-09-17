# TASK RESULT: TASK-314-engine-wait-resume

- **STATUS**: `SUCCESS`
- **AGENT**: arena worker — session `arena/01a0aee7-n8n-rust-v-4`
- **LEGO COMPONENT**: `workflow` (reconstructed engine, JS)
- **TIMESTAMP**: `2026-09-17 14:35 UTC`
- **MANIFEST**: [`tasks/TASK-314-engine-wait-resume.yaml`](../tasks/TASK-314-engine-wait-resume.yaml)

---

### Summary (padat)

A workflow containing a Wait node simply could not run in the reconstruction: `waitTill` was listed
as a non-goal in §7 of the contract and the engine had no way to park or resume an execution. It now
reproduces the whole path — `ctx.putExecutionToWait(date)` (`base-execute-context.ts:107-112`), the
parked node recorded with `executionStatus: 'waiting'` and pushed back on the stack
(`workflow-execute.ts:1821`, `:1948-1959`), run `status: 'waiting'` with `waitTill` on the result
(`:2391-2396`, `:2435-2436`), and resume through the constructor's `runExecutionData` argument plus
`processRunExecutionData()` (`:105-108`, `:1400-1412`), where `handleWaitingState` (`:1285-1302`)
clears `waitTill`, marks the parked node `disabled` and pops its waiting entry so the node neither
runs twice nor looks like it did. Reading that path exposed two more divergences I had shipped: a
**disabled node was being executed** (the reference never executes one — `handleDisabledNode`
(`:909-920`) passes its first main input through), and `findStartNode` could pick a disabled node as
the start (`workflow.ts:824`, `:839`, `:853` skip them). Both are fixed, and both were confirmed
against the real engine first.

### Evidence

| check | result | exit |
| :--- | :--- | ---: |
| `npm run engine:test` | `# tests 82 · # pass 82 · # fail 0 · # skipped 0` (59 unit + 3 graph + 13 real engine + 7 contract) | 0 |
| ↳ negative control: `handleWaitingState` neutralised | `not ok 61, 62, 63, 81` → 78/82; restored → 82/82 | 1 → 0 |
| ↳ negative control: pause branch neutralised | `not ok 60, 61, 62, 63, 81` → 77/82; restored → 82/82 | 1 → 0 |
| ↳ negative control: disabled-node passthrough neutralised | `not ok 37, 82` → 80/82; restored → 82/82 | 1 → 0 |
| `node tests/compatibility/contract_conformance.mjs` | `RESULT: 22/22 CHECKS PASSED` | 0 |
| `bash tests/integration/run_gate.sh --offline-only` | stages 1-3 `OFFLINE STAGES : PASS` (22/22 · AUDIT PASS · 82/82), `LIVE 11/11 : NOT RUN` | 2 (INCONCLUSIVE by design) |
| `npm run verify` (Workflow LEGO, 11 gates) | `11/11 PASS · BEHAVIOR CHANGE: NONE DETECTED` | 0 |
| `npm run rust:guard` / `test-run.mjs` | PASS / unchanged | 0 / 0 |

Ground truth captured from the real engine before porting (`/tmp/probe7.mjs`, `/tmp/probe8.mjs`,
n8n-core 2.9.1, real `Wait` and `Limit` nodes):

| probe | measured |
| :--- | :--- |
| Trigger → Wait(5 min) → After, 1st run | `status: waiting`, `waitTill: 2026-09-17T12:48:24.622Z`, `Wait` entry `executionStatus=waiting` with `data=[[{}]]`, `lastNodeExecuted: "Wait"`, stack `[{node:"Wait"}]`, **no `After` entry** |
| same, resumed via `new WorkflowExecute(ad, 'manual', run1.data).processRunExecutionData(workflow)` | `status: success`, `Wait` has **one** entry with `executionStatus=success` (the waiting entry was popped, not duplicated), `After` runs, `lastNodeExecuted: "After"`, stack `[]` |
| disabled `Limit` (`maxItems: 0`) with `pinData: {Lim: [{json:{pinned:true}}]}` | `Lim` outputs `[[{}]]` — its **input**, not the pin and not the empty Limit result; `After` runs; `lastNodeExecuted: "After"` |

### What the checks caught

| finding | fix |
| :--- | :--- |
| contract test: 2 new methods, 1 new instance field, 3 new result keys and the `waiting` status were undeclared | §2/§3 of the contract updated |
| contract test: `waitTill` was still declared a **non-goal** while the implementation now uses the name | removed from §7, with a note that the conformance test forced the correction |
| contract test: 2 citations to reference files it did not know | registered `run-execution-data-factory.ts`, `base-execute-context.ts` |
| my own first placement of the `:1769` null-output check | it ran on the error path too and 6 tests failed; the reference reaches that line only *inside* the `try`, so it is now guarded by `executionError === undefined` |
| existing test asserted "a disabled node falls through to the handler" | the real engine does not execute a disabled node at all — test rewritten to assert the handler is **not** called and the input flows on |

### Public API added

```js
const paused = await new WorkflowExecutionEngine(json).runWorkflow();   // status 'waiting'
const done   = await new WorkflowExecutionEngine(json, paused.runExecutionData)
  .processRunExecutionData();                                            // status 'success'
```

* `ctx.putExecutionToWait(date)` — what a node calls to park the run (the real Wait node does exactly
  this, `Wait.node.ts:621-624`).
* `engine.handleWaitingState(state)` and `engine.processRunExecutionData(options)`.
* `result.paused`, `result.waitTill`, `result.runExecutionData` (a JSON-round-trippable
  `IRunExecutionData` snapshot — one test persists it through `JSON.parse(JSON.stringify(…))` and
  resumes from that, because n8n stores it in the database).
* Status precedence `canceled` > `error` > `waiting` > `success` (`:2383-2400`).

### Behaviour changes (all n8n's own behaviour, now reproduced)

1. A `disabled` node is no longer executed; its first main input passes through and its pin data is
   ignored. A node whose output object is `null` records no `runData` entry and ends its branch.
2. A `disabled` trigger is no longer chosen as the start node.
3. Every result now carries `paused`, `waitTill` and `runExecutionData`; `status` can be `'waiting'`.

### Boundary compliance

* `reference/n8n/**` read-only — `G04` re-verified the tree byte-identical (15 050 files, root
  `f8da35180669d798…`) in the same run that produced 11/11.
* **Zero Rust** (rule 1): `rust:guard` exit 0. **UI untouched** (rule 5): no `editor-ui`, `.vue`,
  CSS/SCSS or theme file in the diff.
* Out of scope and said so in §7: the **scheduler** that decides *when* to resume (n8n's `WaitTracker`
  + the database) and the persisted `IRunExecutionData` fields this engine does not maintain
  (`contextData`, `metadata`, `manualData`, `pushRef`, `runtimeData`).

### Handed to the next worker

1. Contract §7 now lists: sub-workflow execution, credentials, expressions `{{ … }}`, the
   `sourceOverwrite` branch (`:1530-1541`), `requiredInputs` as an expression string, and node
   implementations.
2. `docs/isolation/` still has no blueprint for this module in the house format (§1 of the contract
   covers the boundary).
3. VPS `11/11` PostgreSQL smoke (caveat `C1` of `TASK-305`) still outstanding — unreachable from this
   sandbox (`157.10.160.95` → HTTP 000, no `docker`), so `run_gate.sh` stays `INCONCLUSIVE`.
