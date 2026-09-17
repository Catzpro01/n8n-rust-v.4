# TASK RESULT: TASK-313-engine-error-handling

- **STATUS**: `SUCCESS`
- **AGENT**: arena worker — session `arena/01a0aee7-n8n-rust-v-4`
- **LEGO COMPONENT**: `workflow` (reconstructed engine, JS)
- **TIMESTAMP**: `2026-09-17 13:20 UTC`
- **MANIFEST**: [`tasks/TASK-313-engine-error-handling.yaml`](../tasks/TASK-313-engine-error-handling.yaml)

---

### Summary (padat)

The reconstructed engine had no notion of a node that *retries* or of a node that *routes its
failures*: `runner.mjs` mentioned `retryOnFail` zero times while `workflow-execute.ts` carries a full
retry budget (`:1600-1630`), a second retry path for nodes that fail without throwing
(`:1670-1692`), error-output routing (`:1720-1722`, `:2463-2562`) and the inline `$error` merge
(`:1898-1917`). All four are now ported 1:1, each one first measured against the real engine
(n8n-core 2.9.1, real `n8n-nodes-base` nodes) so the numbers came from n8n and not from reading:
`maxTries` is clamped to `[2, 5]` (10 → 5 attempts, 1 → 2), `waitBetweenTries: 0` means **1000 ms**
because the reference uses `||`, `onError: 'continueErrorOutput'` moves error items to the last main
output (`data = [[], [{"error":"soft-boom"}]]`), and `{json:{$error,$json}}` collapses to
`{json:{error:'dollar-boom'}, error:{message:'dollar-boom'}}`. Measuring also exposed a bug I had
shipped earlier: `lastNodeExecuted` was only set for a node that produced **at least one item**,
whereas the reference sets it for any non-null output — a real `Limit` node with `maxItems: 0` emits
`data = [[]]` and still becomes `lastNodeExecuted`, so the old assertion in `engine.test.mjs`
encoded a divergence and has been corrected.

### Evidence

| check | result | exit |
| :--- | :--- | ---: |
| `npm run engine:test` | `# tests 73 · # pass 73 · # fail 0 · # skipped 0` (52 unit + 3 graph + 11 real engine + 7 contract) | 0 |
| ↳ negative control: retry loop disabled | `not ok 47, 48, 50, 51, 70` → 68/73; restored → 73/73 | 1 → 0 |
| ↳ negative control: `handleNodeErrorOutput` call disabled | `not ok 52, 53, 54, 55, 72` → 68/73; restored → 73/73 | 1 → 0 |
| `node tests/compatibility/contract_conformance.mjs` | `RESULT: 22/22 CHECKS PASSED` | 0 |
| `bash tests/integration/run_gate.sh --offline-only` | stages 1-3 `OFFLINE STAGES : PASS` (22/22 · AUDIT PASS · 73/73), `LIVE 11/11 : NOT RUN` | 2 (INCONCLUSIVE by design) |
| `npm run verify` (Workflow LEGO, 11 gates) | `11/11 PASS · BEHAVIOR CHANGE: NONE DETECTED` | 0 |
| `npm run rust:guard` / `test-run.mjs` | PASS / unchanged | 0 / 0 |

Ground truth captured from the real engine before porting (`/tmp/probe5.mjs`, `/tmp/probe6.mjs`,
n8n-core 2.9.1, elapsed time used as the observable for attempt counts):

| probe | measured |
| :--- | :--- |
| `retryOnFail`, `maxTries` 2 / 3 / 10 / 1 / absent | 2 / 3 / **5** / **2** / 3 attempts |
| `waitBetweenTries` absent or `0`, 3 attempts | 2005 ms ⇒ effective wait **1000 ms** (`0 \|\| 1000`) |
| `Set` + `onError: continueErrorOutput`, item `{error}` | `data = [[], [{"error":"soft-boom"}]]`, `Err` branch runs |
| same node, item without `error` (control) | `data = [[{"ok":1}], []]` |
| `Set` emitting `{$error, $json}` | raw item `{"json":{"error":"dollar-boom"},"pairedItem":{"item":0},"error":{"message":"dollar-boom"}}` |
| thrown error + `continueErrorOutput` (output 0 unconnected) | `status: error`, Boom `data = [[{}]]` (input passed through) |
| thrown error + `continueRegularOutput` | `status: success`, `After` runs with the input |
| `Limit` `maxItems: 0` | `runData.Lim[0].data.main === [[]]`, `lastNodeExecuted === "Lim"`, `After` never runs |

### What the checks caught

| finding | fix |
| :--- | :--- |
| contract test: `mainOutputCount` / `handleNodeErrorOutput` were not declared in §2 | added to `engineMethods` and to the surface block |
| contract test: 3 citations pointed at reference files the check did not know | registered `node-helpers.ts`, `workflow-data-proxy.ts` |
| new unit test: `mainOutputCount` returned 1 for a node type with no description | `registerNodeType` no longer stores `{}` when no description is given, so "registered without description" == "unknown node type" (`node-helpers.ts:1146-1148` returns `[]`) |
| new unit test: routed items were not enriched with their source json | the reference calls `handleNodeErrorOutput` (`:1721`) **before** `assignPairedItems` (`:1736`), so only node-provided `pairedItem` can be used — tests now stamp it like n8n's Set node does, and a no-pairedItem case asserts the reference's unchanged-item fallback |
| existing test `engine.test.mjs:709` asserted `lastNodeExecuted` stayed on the previous node | the real engine disagrees (probe above) — test rewritten to the reference behaviour, contract G13 reworded |

### Behaviour changes (all of them n8n's own behaviour, now reproduced)

1. `resultData.lastNodeExecuted` is set by a node that emitted **zero** items too (G13).
2. `retryOnFail` re-runs a node up to 5 times and **sleeps** between attempts; without it nothing
   changes (a single attempt, as before).
3. With `onError: 'continueErrorOutput'`, output items are split across two outputs instead of all
   landing on output 0.
4. An output item carrying `error` (or `json.$error` + `json.$json`) has its `json` replaced by
   `{ error: message }` — that is what the UI's error badge reads.
5. `registerNodeType(type, handler)` without a description no longer records an empty description;
   `mainOutputCount` returns 0 for it, exactly as the reference does for an unknown node type.

### Boundary compliance

* `reference/n8n/**` read-only — `G04` re-verified the tree byte-identical (15 050 files, root
  `f8da35180669d798…`) in the same run that produced 11/11.
* **Zero Rust** (rule 1): `rust:guard` exit 0. **UI untouched** (rule 5): no `editor-ui`, `.vue`,
  CSS/SCSS or theme file in the diff.
* Equivalence-suite limitation unchanged and stated in-file: node *implementations* are stubbed
  identically on both sides, so these cases verify **engine orchestration of failures**, not node
  logic.

### Handed to the next worker

1. `contracts/execution-engine.contract.md` §7 still lists: `waitTill` resume, sub-workflows,
   credentials, expressions `{{ … }}`, dynamically computed node `outputs`, and the
   `sourceOverwrite` branch (`:1530-1541`, AI tool executions).
2. The equivalence harness's `set` stub is now parameter-driven (assignments → json, `pairedItem`
   stamped) — extend it the same way rather than adding per-fixture stubs.
3. VPS `11/11` PostgreSQL smoke (caveat `C1` of `TASK-305`) still outstanding — unreachable from
   this sandbox (`157.10.160.95` → HTTP 000, no `docker`), so `run_gate.sh` stays `INCONCLUSIVE`.
