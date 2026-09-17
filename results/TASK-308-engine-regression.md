# TASK RESULT: TASK-308-engine-regression

- **STATUS**: `SUCCESS`
- **AGENT**: arena worker — session `arena/01a0aee7-n8n-rust-v-4`
- **LEGO COMPONENT**: `workflow` (reconstructed engine, JS)
- **TIMESTAMP**: `2026-09-17 10:47 UTC`
- **MANIFEST**: [`tasks/TASK-308-engine-regression.yaml`](../tasks/TASK-308-engine-regression.yaml)

---

### Summary (padat)

`packages/reconstructed-engine` is the JavaScript reconstruction that PROJECT_RULES rule 1 mandates,
but its only "test" was `test-run.mjs` — a console script with **zero assertions** that prints
*"Berfungsi 100% Sempurna!"* whenever `status === "COMPLETED"`, and no gate ever ran it. Probing it
with a 2-node cyclic workflow showed `runWorkflow()` **never terminates**: the BFS loop is
synchronous, so it also starves the event loop and even an in-process `setTimeout` watchdog cannot
fire (process still alive at 12 s, killed by `timeout`; `git show HEAD:…/runner.mjs` reproduces it,
exit 124). Fixed with a bounded cycle guard in `runner.mjs` — a node may execute at most
`max(1, inbound-edge count)` times per run, which guarantees termination while leaving linear and
diamond graphs behaving exactly as before — and replaced the console script's role with
`packages/reconstructed-engine/test/engine.test.mjs` (13 assertions) wired as `npm run engine:test`.
Two divergences from real n8n 2.9.4 were found and **locked as known debt** rather than silently
"fixed": diamond fan-in executes the destination once per inbound edge instead of waiting and merging,
and a throwing handler rejects the whole run instead of recording a node error.

### Evidence

| check | result | exit |
| :--- | :--- | ---: |
| cycle probe, **pre-fix** runner (`git show HEAD:packages/reconstructed-engine/runner.mjs`) | still running at 12 s, killed by `timeout` | 124 |
| cycle probe, **fixed** runner | `completed, log entries: 2` | 0 |
| `npm run engine:test` | `# tests 13 · # pass 13 · # fail 0` | 0 |
| `node packages/reconstructed-engine/test-run.mjs` (old console script, backward compat) | unchanged, still succeeds | 0 |

Suite coverage (all passing): linear chain order + item flow · executionLog entry shape ·
passthrough for unregistered node types · fan-out to two downstream nodes · diamond fan-in
(DIVERGENCE, asserted at 2 executions) · cycle guard A→B→A · self-loop A→A · 3-node cycle A→B→C→A ·
empty workflow throws · explicit start node beats trigger detection · trigger auto-detection fallback ·
handler throw rejects (DIVERGENCE) · connection to a non-existent node ignored.

### Boundary compliance

* `git status` shows **no** `reference/n8n/**` path touched; `packages/workflow-lego/src/**` untouched.
* **UI untouched** (rule 5) — no `editor-ui`, `.vue`, CSS/SCSS or theme file in the diff.
* **Zero Rust written** (rule 1) — the change is JavaScript/ESM only; `npm run rust:guard` still exit 0.
* Cycle *detection* (rejecting a cyclic graph before execution) deliberately stays with the
  Validation LEGO per `contracts/validation.contract.md`; this guard only guarantees the engine
  cannot hang, and reports `cyclic: true` + `cycleSkips[]` so callers can see it.

### Handed to the next worker

1. Close the two locked divergences against `reference/n8n/packages/core/src/execution-engine/`:
   fan-in must wait for all inputs and execute once with merged items; a node error must be recorded
   in `runData` with `status: 'error'`, not thrown.
2. `packages/reconstructed-engine` is still outside every gate. Chain `npm run engine:test` into the
   integration gate (`tests/integration/run_gate.sh` stage 1) so it cannot rot again the way
   `test-run.mjs` did.
3. Trigger detection is `type.includes('trigger' | 'Manual' | 'Start')`; the reference uses
   `STARTING_NODE_TYPES` (already surfaced as a port in `packages/workflow-lego/src/ports/constants.ts`).
