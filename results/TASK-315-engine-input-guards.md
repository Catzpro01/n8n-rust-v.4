# TASK RESULT: TASK-315-engine-input-guards

- **STATUS**: `SUCCESS`
- **AGENT**: arena worker — session `arena/01a0aee7-n8n-rust-v-4`
- **LEGO COMPONENT**: `workflow` (reconstructed engine, JS)
- **TIMESTAMP**: `2026-09-17 15:40 UTC`
- **MANIFEST**: [`tasks/TASK-315-engine-input-guards.yaml`](../tasks/TASK-315-engine-input-guards.yaml)

---

### Summary (padat)

Inventorying every method of the reference `WorkflowExecute` against the reconstruction turned up
four input-shaping guards that decide *what data a node is handed*, none of them ported:
`handleExecuteOnce` (`:990-1002`, applied at `:1219` — a node with `executeOnce: true` receives only
the first item of every input slot), `ensureInputData` (`:2315-2348`, called at `:1580-1584` — a node
is not run before its inputs are ready, and a slot whose ancestors are all disabled never waits),
the `Workflow#getHighestNode` it depends on (`workflow.ts:492-568`), and the endless-loop guard
(`:1564-1568`) without which the "put it back on the stack and try later" path can spin forever. All
four are now ported; `getHighestNode` lives in `graph.mjs` next to the other traversal ports and is
checked **against the real `Workflow#getHighestNode`** in n8n-workflow 2.9.1 over six fixtures,
every node, and four connection indexes. Two of my own assumptions did not survive contact with the
reference: n8n-workflow 2.9.1's `Workflow` constructor takes `nodes` as an **array** (not the
by-name map of later versions), and a slot with no incoming connection at all counts as "no valid
incoming node", so the node runs as-is rather than waiting.

### Evidence

| check | result | exit |
| :--- | :--- | ---: |
| `npm run engine:test` | `# tests 91 · # pass 91 · # fail 0 · # skipped 0` (66 unit + 4 graph + 14 real engine + 7 contract) | 0 |
| ↳ `PORT getHighestNode is identical to Workflow#getHighestNode` | 6 fixtures × every node × `connectionIndex ∈ {undefined,0,1,2}`, asserts > 50 comparisons | 0 |
| ↳ negative control: `executeOnce` narrowing removed | `not ok 67, 91` → 89/91; restored → 91/91 | 1 → 0 |
| ↳ negative control: `ensureInputData` call removed | `not ok 73` → 90/91; restored → 91/91 | 1 → 0 |
| `node tests/compatibility/contract_conformance.mjs` | `RESULT: 22/22 CHECKS PASSED` | 0 |
| `bash tests/integration/run_gate.sh --offline-only` | stages 1-3 `OFFLINE STAGES : PASS` (22/22 · AUDIT PASS · 91/91), `LIVE 11/11 : NOT RUN` | 2 (INCONCLUSIVE by design) |
| `npm run verify` (Workflow LEGO, 11 gates) | `11/11 PASS · BEHAVIOR CHANGE: NONE DETECTED` | 0 |
| `npm run rust:guard` / `test-run.mjs` | PASS / unchanged | 0 / 0 |

The `executeOnce` case is also checked end to end against the real engine: three pinned items into a
`Set` node give `data.main[0].length === 3` without the flag and `=== 1` with it, on both engines.

### What the checks caught

| finding | fix |
| :--- | :--- |
| `new real.Workflow({ nodes: {…} })` threw `parameters.nodes is not iterable` | n8n-workflow **2.9.1** takes the node list as an array; the fixture now passes an array |
| first `ensureInputData` fixture expected "not ready" for a slot with no incoming connection | `:2317-2325` treats that slot as "no valid incoming node" → the node runs as-is; fixture rebuilt so **both** slots have a real ancestor |
| contract test: 1 new export + 3 new methods undeclared | §2 of the contract updated; G23/G24/G25 added |

### Honest limitation recorded

The release pass replaces missing slots with `[]` (`:2144-2152`), so in a normal run
`ensureInputData` never returns `false` — its "not ready" branches are reachable only through a
restored `IRunExecutionData` whose stack entry still carries a `null` slot. The endless-loop guard is
therefore **defensive**, and it is exercised end to end exactly that way (test 73 feeds such a
restored state in and asserts the run aborts with `Stopped execution because it seems to be in an
endless loop`). It is ported because the reference has it, not because a live workflow hits it today.

### Behaviour changes (all n8n's own behaviour, now reproduced)

1. A node with `executeOnce: true` is handed only the first item of every input slot — the handler
   and `ctx.inputData` both see the narrowed data.
2. A node is only run when `ensureInputData` says its inputs are ready; otherwise the entry goes back
   on the stack.
3. The same `node:runIndex` arriving twice in a row aborts the run with an `ApplicationError`
   instead of spinning.

### Boundary compliance

* `reference/n8n/**` read-only — `G04` re-verified the tree byte-identical (15 050 files, root
  `f8da35180669d798…`) in the same run that produced 11/11.
* **Zero Rust** (rule 1): `rust:guard` exit 0. **UI untouched** (rule 5): no `editor-ui`, `.vue`,
  CSS/SCSS or theme file in the diff.

### Handed to the next worker

1. The method inventory still open in `workflow-execute.ts`: `runPartialWorkflow2` (`:197-317` —
   partial execution to a destination node, which the UI's "execute step" uses), `getCustomOperation`
   (`:893`), `rethrowLastNodeError` (`:966`), `checkForWorkflowIssues` (`:1305`),
   `updateTaskStatusesToCancelled` (`:2641`), and the node-type dispatch
   (`executeNode`/`executePollNode`/`executeTriggerNode`, `:1004-1185` — Node LEGO territory).
2. Contract §7: sub-workflow execution, credentials, expressions `{{ … }}`, the `sourceOverwrite`
   branch (`:1530-1541`), `requiredInputs` as an expression string, node implementations.
3. `docs/isolation/` still has no blueprint for this module in the house format.
4. VPS `11/11` PostgreSQL smoke (caveat `C1` of `TASK-305`) still outstanding — unreachable from this
   sandbox (`157.10.160.95` → HTTP 000, no `docker`), so `run_gate.sh` stays `INCONCLUSIVE`.
