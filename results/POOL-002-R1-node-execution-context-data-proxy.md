# TASK RESULT: POOL-002-R1-node-execution-context-data-proxy

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-2`
- **LEGO COMPONENT**: `node` (port unit: execution context + data proxy)
- **EXIT CODE**: `0`
- **BRANCH**: `arena/01a0aff7-n8n-rust-v-4` (baseline `fc4e5631`)
- **TIMESTAMP**: `2026-09-18 (Asia/Novosibirsk)`
- **SUPERSEDES**: `POOL-002` (agent-8, `FAILED` — that record is preserved verbatim)

---

### What shipped

`packages/reconstructed-engine/` — a reference-faithful ESM port of the n8n 2.9.4 execution
surface (workflow data proxy incl. `$env` provider, run-execution-data + factory, node
execution contexts, additional keys + `$secrets` proxy, execution metadata, the six error
classes, all of `constants.ts`) plus nine gates that compare it to the pinned reference.

| Artifact | Content |
|---|---|
| `src/*.mjs` (10 files) | the port; every symbol documents its reference `file:line` |
| `fixtures/corpus.json` | 19 data-proxy scenarios + 3 execute-context scenarios + deferred-probe set |
| `fixtures/legacy-runner.lock.json` | POOL-001 non-entanglement pin (sha256 + traceable commit blob) |
| `fixtures/data-proxy.golden.json` | 318 reference-recorded probe results (values *and* errors), 116 KB |
| `fixtures/reference-snapshot.json` | recorded constant values, sandbox key set, context method set, additional-key set |
| `manifest/port-surface.json` | generated per-module/per-class classification: ported / deferred / out-of-scope / additions + class hierarchy check |
| `test/00…07`, `test/oracle/10` | the gates, incl. recorders (`record-golden.mjs`, `record-surface.mjs`) and an offline host stub that throws on anything unmodelled |
| `docs/isolation/node-execution-context.md` | boundary, deferral table, verbatim-quirk table for the Rust port, verification map |
| `scripts/run-engine-tests.sh`, `npm run verify:engine[:offline]` | one command for both modes |

### Verification

| Run | Result |
|---|---|
| `npm run verify:engine` (oracle `n8n-workflow@2.9.1`/`n8n-core@2.9.1` installed) | **96/96 pass** |
| `npm run verify:engine:offline` (`.runtime` hidden) | **96/96 pass**; oracle gate prints `oracle equivalence NOT RUN`, host-dependent probes degrade to "must raise" |
| `test/07-falsification` | control green; **15/15 mutations caught** (each re-runs the whole suite in a temp copy) |
| `test/05-surface-coverage` | 0 undeclared gaps, 0 undeclared additions, 43/43 sandbox keys, 5/5 additional keys, 4/4 class hierarchies match |

### Bugs this method found (and that a read-the-source review would not have)

1. `contextReader` normalised `node` → swallowed *"The request data of context type "node"
   the node parameter has to be set!"*; fixed by sharing ONE `getContext` implementation.
2. `WorkflowOperationError` was ported against an older `(message, error, options)` shape;
   2.9.x is `(message, node?, description?)` — found by comparing own-property shapes with
   the live reference classes.
3. `$env` was "deferred" and returned `undefined`; the reference *throws* under the default
   env-block setting. Fixed by porting `workflow-data-proxy-env-provider.ts` outright.
4. `sendChunk`/`logAiEvent` were listed as declared deviations but match the reference
   exactly — the stale declarations were removed (a deviation that stops being true is a
   documentation bug; gate 10 now asserts every declaration is still observable).
5. Falsification exposed two coverage holes (`$execution.mode`, the unconnected-node
   `branchIndex` default); the corpus grew two scenarios and re-recording closed them.
6. Harness traps fixed on the way: JSON turns `undefined` call args into `null` (needs a
   sentinel); goldens keyed by a re-parsed rendered string lose `Date`/args (store `_path`);
   nested `node --test` inherits `NODE_OPTIONS`/`NODE_TEST_CONTEXT` and reports nothing.

### Cross-lane evidence produced while finishing (2026-09-18)

Recorded from the live 2.9.1 runtime, not inferred from source — see
`docs/isolation/CROSS-AGENT-ISSUES.md` (ISSUE-016 update) for the tables:

- **Pinned + disabled node:** `WorkflowDataProxy` substitutes pinned output **regardless of
  `disabled`** (`getPinDataIfManualExecution` checks only `mode === 'manual'`,
  `workflow-data-proxy-helpers.ts:3-12`) while `$('n').isExecuted` stays `false`. Scenario
  `pinned-and-disabled-node`; gate 07 catches both "fixes" (filtering pin data by `disabled`,
  and counting a pinned node as executed).
- **`$input` is not fed by pin data:** the `pinDataToTask` fallback
  (`workflow-data-proxy.ts:909-926`) lives in the paired-item/placeholder path; `$input.all()`
  reads `connectionInputData` and raises when it is empty. Scenario
  `pinned-upstream-substitutes-input` — my own first hypothesis, disproved by recording.
- **H-07 agreement with POOL-005:** `constructExecutionMetaData` spreads
  `{ json, pairedItem: itemData, ...rest }`, so an item that already carries `pairedItem` wins.
  The port reproduces this exactly (verified against the live `n8n-core` module) and is now
  pinned offline in gate 03 with a gate-07 mutant for the inversion.

### Note for POOL-001 / Phase 3

`runner.mjs` now carries its own minimal `WorkflowDataProxy` (`$json`/`$input`/`$execution`
shorthands, `mode: 'manual'` hardcoded, `runIndex: -1` semantics). That is fine while the two
lanes are decoupled — gate 06 makes "decoupled" an assertion — but when the loop is migrated it
should import `src/workflow-data-proxy.mjs` and the reference-recorded behaviour in
`fixtures/data-proxy.golden.json` becomes the migration test.

### Scope discipline

- No writes outside `packages/reconstructed-engine/**`, `docs/isolation/node-execution-context.md`,
  `scripts/run-engine-tests.sh`, this `tasks/`+`results/` record, the outbox, and the root
  `package.json` (two added scripts).
- `packages/reconstructed-engine/{runner.mjs,test-run.mjs,runner.test.mjs}` (POOL-001) untouched —
  gate 06 pins them by sha256, verifies the pin traces to a real commit blob, and forbids imports in
  either direction. (The lane's own `cc2d111f` rewrite of `runner.mjs` landed on this branch during
  the work; the pin was re-recorded to it rather than reverted — that file is not this lane's to own.)
- No Rust, no `crates/**`, no UI files. POOL-003 (error/retry) stays **reported**, not fixed:
  its overlap (`NodeOperationError`, `setDescriptiveErrorMessage`, retry/continue-on-fail
  policy) is ported and pinned here so that task can consume rather than re-port it.
- `reference/n8n` remains read-only; `.runtime` stays gitignored (it does not survive
  sandbox snapshots, which is exactly why gates 00–07 must pass offline).
