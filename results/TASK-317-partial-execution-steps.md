# TASK RESULT: TASK-317-partial-execution-steps

- **STATUS**: `SUCCESS`
- **AGENT**: arena worker — session `arena/01a0aee7-n8n-rust-v-4`
- **LEGO COMPONENT**: `workflow` (reconstructed engine, JS)
- **TIMESTAMP**: `2026-09-17 17:05 UTC`
- **MANIFEST**: [`tasks/TASK-317-partial-execution-steps.yaml`](../tasks/TASK-317-partial-execution-steps.yaml)

---

### Summary (padat)

TASK-316 laid the graph foundation that partial execution runs on; this task ports the layer above
it — the steps `runPartialWorkflow2` (`workflow-execute.ts:197-317`) applies to that graph:
`getNextExecutionIndex`, `getIncomingData`, `getIncomingDataFromAnyRun`, `cleanRunData` (drop the
re-run node, its children and their AI sub-nodes from the run data), `handleCycles` (replace a start
node inside a cycle with the cycle's entry point), `anyReachableRootHasRunData` and
`findTriggerForPartialExecution` (destination trigger → parent trigger with run data → pinned
webhook → webhook → first parent). Five of the seven are exported by the pinned n8n-core 2.9.1 and
are therefore checked against the real implementation, including the trigger precedence exercised
with real `Workflow` instances and real node types across eight cases; the two `get-incoming-data`
helpers are module-private in the reference too, so they get unit tests only — stated plainly rather
than presented as equivalence-checked.

### Evidence

| check | result | exit |
| :--- | :--- | ---: |
| `npm run engine:test` | `# tests 107 · # pass 107 · # fail 0 · # skipped 0` (66 unit + 4 graph + 14 real engine + 8 partial-graph + 7 partial-steps + 8 contract) | 0 |
| ↳ `partial-steps.test.mjs` (7 cases, 5 of them vs the real n8n-core) | all pass; `cleanRunData` alone compares > 20 node/variant combinations | 0 |
| ↳ negative control: `cleanRunData` stops deleting sub-node run data | `not ok 4` → 6/7; restored → 7/7 | 1 → 0 |
| ↳ negative control: `findTriggerForPartialExecution` drops the webhook preference | `not ok 7` → 6/7; restored → 7/7 | 1 → 0 |
| ↳ negative control: contract declaring a smaller partial surface | `not ok 3` → 7/8; restored → 8/8 | 1 → 0 |
| `node tests/compatibility/contract_conformance.mjs` | `RESULT: 22/22 CHECKS PASSED` | 0 |
| `bash tests/integration/run_gate.sh --offline-only` | stages 1-3 `OFFLINE STAGES : PASS` (22/22 · AUDIT PASS · 107/107), `LIVE 11/11 : NOT RUN` | 2 (INCONCLUSIVE by design) |
| `npm run verify` (Workflow LEGO, 11 gates) | `11/11 PASS · BEHAVIOR CHANGE: NONE DETECTED` | 0 |
| `npm run rust:guard` / `test-run.mjs` | PASS / unchanged | 0 / 0 |

### What the checks caught

| finding | fix |
| :--- | :--- |
| my `handleCycles` fixture passed a start node that is not reachable from the trigger (the AI `Model` parent on the `withAiParent` fixture) and the port threw | the **real** implementation throws the identical message on that input (verified by running it) — the assertion at `handle-cycles.ts:44-47` is the reference's own. The test now feeds only subgraph-reachable start nodes and additionally asserts both sides throw the *same* message |
| the webhook-preference negative control did **not** fail | my fixture had `parentTriggers[0]` already the webhook, so dropping the preference changed nothing. `getParentNodes` order depends on the node/connection arrangement; I measured it against n8n-workflow 2.9.1 (`["Manual","Mid","Hook"]`) and rebuilt the fixture so the non-webhook trigger comes first — the mutation is now detected |
| contract citation scan flagged five more reference files | `run-data-utils.ts`, `get-incoming-data.ts`, `clean-run-data.ts`, `handle-cycles.ts`, `find-trigger-for-partial-execution.ts` registered; every line range `partial.mjs` cites is verified against `reference/n8n` |

### Faithfulness note

`handleCycles` filters strongly connected components with `cycle.size >= 1`, which keeps the
single-node components the reference's own comment says it is filtering out. That is what the
reference does, so the port does the same — the equivalence tests confirm both sides agree, and the
divergence between comment and code is left exactly as upstream has it.

### Boundary compliance

* `reference/n8n/**` read-only — `G04` re-verified the tree byte-identical (15 050 files, root
  `f8da35180669d798…`) in the same run that produced 11/11.
* **Zero Rust** (rule 1): `rust:guard` exit 0. **UI untouched** (rule 5): no `editor-ui`, `.vue`,
  CSS/SCSS or theme file in the diff.

### Handed to the next worker

1. The last partial-execution layer, then the entry point itself: `get-source-data-groups.ts`
   (164 lines), `find-start-nodes.ts` (185), `recreate-node-execution-stack.ts` (220),
   `rewire-graph.ts` (58, needs the AI tool-executor node), and finally `runPartialWorkflow2`
   (`workflow-execute.ts:197-317`) wired into the engine.
2. `partial.mjs` still has no caller in `runner.mjs` — that happens with `runPartialWorkflow2`.
3. Contract §7 still names sub-workflow execution, credentials, expressions `{{ … }}`, the
   `sourceOverwrite` branch (`:1530-1541`) and `requiredInputs` as an expression string.
4. `docs/isolation/` still has no blueprint for this module in the house format.
5. VPS `11/11` PostgreSQL smoke (caveat `C1` of `TASK-305`) still outstanding — unreachable from this
   sandbox (`157.10.160.95` → HTTP 000, no `docker`), so `run_gate.sh` stays `INCONCLUSIVE`.
