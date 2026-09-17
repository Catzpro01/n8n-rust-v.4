# TASK RESULT: TASK-311-execution-details

- **STATUS**: `SUCCESS`
- **AGENT**: arena worker — session `arena/01a0aee7-n8n-rust-v-4`
- **LEGO COMPONENT**: `workflow` (reconstructed engine, JS)
- **TIMESTAMP**: `2026-09-17 11:45 UTC`
- **MANIFEST**: [`tasks/TASK-311-execution-details.yaml`](../tasks/TASK-311-execution-details.yaml)

---

### Summary (padat)

Four more behaviours of the reference execution loop are now reconstructed, each read off
`workflow-execute.ts` and then **checked against the real engine**: execution timeout
(`:1486-1496` → `status: 'canceled'`, `timedOut: true`), pin data (`:1632-1637` → the pinned node is
not executed and its pinned output flows on, a `disabled` node ignores its pin), `alwaysOutputData`
(`:1742-1767` → an empty output emits one `{ json: {}, pairedItem }` item so the branch continues),
and `assignPairedItems` (`:2581-2641`, 1:1 port). Probing the real engine first was what made this
round honest: it showed that `pinData` is an argument of `run()`, not of the `Workflow` constructor
(`:123-130`) — my first probe silently ran without pins and "confirmed" the wrong thing. It also
caught a **genuine divergence** that reading the source alone had missed: before every node runs the
reference re-stamps its *input* items with `pairedItem: { item, input: inputIndex || undefined }`
(`:1517-1552`), so a passthrough node hands on `input: undefined` for input 0; the reconstruction was
emitting `{ item: 0 }` only. That step is now ported, and disabling it makes the equivalence test fail
(`not ok 49`, 48/49) — so the test discriminates. `lastNodeExecuted` now follows the last node that
produced data or the failing node (`:1739`, `:1778`) instead of merely the last node visited.

### Evidence

| check | result | exit |
| :--- | :--- | ---: |
| `npm run engine:test` | `# tests 49 · # pass 49 · # fail 0 · # skipped 0` | 0 |
| ↳ 7 EQUIVALENCE cases vs real `n8n-core 2.9.1` `WorkflowExecute` | linear · fan-out v1 · fan-out v0 · **pinData** · **alwaysOutputData** · **timeout** · **pairedItem** | 0 |
| ↳ negative control (input re-stamp disabled) | `not ok 49 — pairedItem differs on "NoOp"`, 48/49 → restored 49/49 | 1 → 0 |
| `bash tests/integration/run_gate.sh --offline-only` | stages 1-3 `OFFLINE STAGES : PASS` (21/21 · AUDIT PASS · 49/49), `LIVE 11/11 : NOT RUN` | 2 (INCONCLUSIVE by design) |
| `npm run verify` (Workflow LEGO, 11 gates) | `11/11 PASS · BEHAVIOR CHANGE: NONE DETECTED` | 0 |
| `npm run rust:guard` / `test-run.mjs` | PASS / unchanged | 0 / 0 |

Reference values captured from the real engine during the probe (used as the fixtures' ground truth):

| case | real n8n-core 2.9.1 output |
| :--- | :--- |
| pinData on `Set` | `Set output: [{"json":{"pinned":true},"pairedItem":{"item":0}}]`, `executionStatus: success` |
| Limit `maxItems: 0` + `alwaysOutputData` | `Lim output: [{"json":{},"pairedItem":[{"item":0,"input":0}]}]`, nodes `['Trigger','Lim','After']` |
| same, without the flag | nodes `['Trigger','Lim']` — branch ends |
| `executionTimeoutTimestamp` elapsed | `status: canceled`, nodes `[]` |

### Breaking changes

1. Output items now carry `pairedItem`, exactly like n8n. Payload assertions moved behind a
   `payload()` helper — the same convention `tools/live/engine-harness.mjs` already uses
   ("the engine decorates items with pairedItem; compare the payload only").
2. `runWorkflow(startNode, initialData, options)` gained `options.executionTimeoutTimestamp` and
   `options.pinData` (both optional; `pinData` also still reads from the workflow definition).

### Boundary compliance

* `reference/n8n/**` read-only — `G04` re-verified the tree byte-identical (15 050 files, root
  `f8da35180669d798…`) in the same run that produced 11/11.
* **Zero Rust** (rule 1): `rust:guard` exit 0. **UI untouched** (rule 5): no `editor-ui`, `.vue`,
  CSS/SCSS or theme file in the diff.

### Handed to the next worker

1. Not reconstructed: the `sourceOverwrite` branch of the input re-stamp (`:1530-1541`, AI tool
   executions), `waitTill` resume, sub-workflows, credentials, expressions `{{ … }}`, AI/routing
   nodes, and the `requiredInputs` **expression** form.
2. The equivalence suite still stubs node implementations on both sides; extending it to real node
   logic belongs to the Node LEGO.
3. VPS `11/11` PostgreSQL smoke (caveat `C1` of `TASK-305`) still outstanding — unreachable from this
   sandbox (`157.10.160.95` → HTTP 000, no `docker`), so `run_gate.sh` stays `INCONCLUSIVE`.
