# TASK RESULT: TASK-316-partial-graph-foundation

- **STATUS**: `SUCCESS`
- **AGENT**: arena worker — session `arena/01a0aee7-n8n-rust-v-4`
- **LEGO COMPONENT**: `workflow` (reconstructed engine, JS)
- **TIMESTAMP**: `2026-09-17 16:25 UTC`
- **MANIFEST**: [`tasks/TASK-316-partial-graph-foundation.yaml`](../tasks/TASK-316-partial-graph-foundation.yaml)

---

### Summary (padat)

Partial execution — "Execute step" / "Execute to node" in the editor UI — is driven by
`runPartialWorkflow2` (`workflow-execute.ts:197-317`), and every one of its steps is built on a
second graph representation rather than on `Workflow`: `DirectedGraph` (an adjacency list,
`partial-execution-utils/directed-graph.ts:39-566`), `filterDisabledNodes` and `findSubgraph`. None
of it existed in the reconstruction. This task ports those three 1:1 into a new
`packages/reconstructed-engine/partial.mjs`, including Tarjan's strongly-connected-components
algorithm, identity-based node removal with connection rewiring, and the six-rule backwards search
that keeps only the branches reaching the trigger. Because the pinned n8n-core 2.9.1 **exports the
real implementations**, the port does not have to be trusted on reading: eight new tests run every
fixture through both and compare class surface, import, traversals, DFS, cycle components, node
removal, disabled-node rewiring and the subgraph search. The remaining partial-execution steps
(`findStartNodes`, `cleanRunData`, `handleCycles`, `recreateNodeExecutionStack`,
`findTriggerForPartialExecution`, `rewireGraph`) build on this module and are the next slice.

### Evidence

| check | result | exit |
| :--- | :--- | ---: |
| `npm run engine:test` | `# tests 100 · # pass 100 · # fail 0 · # skipped 0` (66 unit + 4 graph + 14 real engine + 8 partial-graph + 8 contract) | 0 |
| ↳ `partial-equivalence.test.mjs` (8 cases vs the real n8n-core 2.9.1) | all pass; `findSubgraph` alone compares > 50 destination/trigger pairs | 0 |
| ↳ negative control: `filterDisabledNodes` without `skipConnectionFn` | `not ok 7` → 7/8; restored → 8/8 | 1 → 0 |
| ↳ negative control: `findSubgraph` following non-`main` parents | `not ok 8` → 7/8; restored → 8/8 | 1 → 0 |
| ↳ negative control: contract declaring a smaller partial surface | `not ok 3` → 7/8; restored → 8/8 | 1 → 0 |
| `node tests/compatibility/contract_conformance.mjs` | `RESULT: 22/22 CHECKS PASSED` | 0 |
| `bash tests/integration/run_gate.sh --offline-only` | stages 1-3 `OFFLINE STAGES : PASS` (22/22 · AUDIT PASS · 100/100), `LIVE 11/11 : NOT RUN` | 2 (INCONCLUSIVE by design) |
| `npm run verify` (Workflow LEGO, 11 gates) | `11/11 PASS · BEHAVIOR CHANGE: NONE DETECTED` | 0 |
| `npm run rust:guard` / `test-run.mjs` | PASS / unchanged | 0 / 0 |

### What the checks caught

| finding | fix |
| :--- | :--- |
| my first `findSubgraph` fixture built **three separate graph instances** and the port threw `assert.ok(nodeExists)` in `getDirectParentConnections` | the reference looks nodes up by **object identity** and asserts they exist — destination, trigger and graph must come from the same instance. The test now builds one graph per side, and the reference would throw on the same input |
| the ported class surface was assumed to match | a test now compares `Object.getOwnPropertyNames(DirectedGraph.prototype)` against the real class: identical except `toWorkflow`, which is declared `deliberatelyOmitted` in the contract and asserted absent |
| contract citation scan flagged `directed-graph.ts`, `filter-disabled-nodes.ts`, `find-subgraph.ts` as unregistered | `partial.mjs` added to the scanned sources and all three registered, so every line range it cites is checked against `reference/n8n` |

### Deliberate omissions

* `DirectedGraph#toWorkflow` (`directed-graph.ts:456-463`) constructs a `Workflow` instance, which
  belongs to the Workflow LEGO (`packages/workflow-lego`, `contracts/workflow.contract.md`). It is
  declared in the contract's `deliberatelyOmitted` list and machine-checked as absent, so it cannot
  be "half ported" later by accident.
* The remaining partial-execution steps are **not** ported yet; `partial.mjs` is a foundation
  module with its own equivalence tests and no caller in `runner.mjs` yet.

### Boundary compliance

* `reference/n8n/**` read-only — `G04` re-verified the tree byte-identical (15 050 files, root
  `f8da35180669d798…`) in the same run that produced 11/11.
* **Zero Rust** (rule 1): `rust:guard` exit 0. **UI untouched** (rule 5): no `editor-ui`, `.vue`,
  CSS/SCSS or theme file in the diff.

### Handed to the next worker

1. The rest of partial execution, all exported by the pinned n8n-core and therefore testable the
   same way: `findTriggerForPartialExecution`, `findStartNodes`, `cleanRunData`, `handleCycles`,
   `recreateNodeExecutionStack`, `rewireGraph`, `getNextExecutionIndex`
   (`partial-execution-utils/*`), then `runPartialWorkflow2` itself (`:197-317`).
2. `get-source-data-groups.ts` (164 lines) and `get-incoming-data.ts` (34 lines) sit in the same
   directory and feed `recreateNodeExecutionStack`.
3. Contract §7 still names sub-workflow execution, credentials, expressions `{{ … }}`, the
   `sourceOverwrite` branch (`:1530-1541`) and `requiredInputs` as an expression string.
4. `docs/isolation/` still has no blueprint for this module in the house format.
5. VPS `11/11` PostgreSQL smoke (caveat `C1` of `TASK-305`) still outstanding — unreachable from this
   sandbox (`157.10.160.95` → HTTP 000, no `docker`), so `run_gate.sh` stays `INCONCLUSIVE`.
