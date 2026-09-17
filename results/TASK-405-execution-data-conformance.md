# TASK-405 execution-data-conformance — result: SUCCESS

Agent-3 / LEGO execution-data. The three invented/wrong helpers are replaced
by exact ports of the four pure reference leaves, pinned by 39 cases.

## What changed

- **Ports** (`crates/n8n-execution-data`): `return_json_array`,
  `normalize_items`, `construct_execution_metadata`, `copy_input_items` —
  exact quirk ports (falsy-`json` wrap, no-double-wrap spread, binary-only
  reshape, rest-wins `pairedItem`, `undefined → null`, short-circuit order
  deciding `Inconsistent item format` vs `TypeError` on `null` elements).
  `ExecutionDataError` carries `ApplicationError` name/message parity
  (`TypeError` mappings pin the name only).
- **Removed**: `wrap_data` (double-wrapped `{json}` inputs), `extract_json`,
  `pair_items` (modulo pairing has no pure reference counterpart — the
  `item: 0` auto-assign lives in the engine `workflow-execute.ts`; all had
  zero users).
- **Model fix** (`n8n-common`, additive, this crate its only consumer):
  `INodeExecutionData` gained the open-envelope `extra` field (TS index
  signature parity; the `additionalProp` spread cases require it).
- **Fixtures** (`tests/reference/agent-3/execution-data/fixtures.json`): 25
  literal in-reference jest cases (cited per case) + 14 code-derived
  X-probes; transcribed (reference TS unrunnable in-sandbox), count pinned
  at 39. Harness asserts values plus error name/message.

## Evidence

- `cargo test --workspace`: 90 passed / 0 failed post-reconcile (59 pre-rebase + the 24-commit SWARM series; execution-data: 4 unit + 1 fixture test over 39 cases + 7 adapted engine-fixture tests)
- `cargo check --workspace --all-targets`: no warnings
- `contract_conformance.mjs`: 43/43; `rust_conformance_audit.py`: PASS 7/7; `boundary_audit.py`: PASS; `run_gate.sh --offline-only`: offline PASS (live 11/11 NOT RUN — no docker, as before)
- `phase3-rust-acceptance.sh --force`: PASS (record refreshed post-commit)
- Doc: `docs/isolation/execution-data.md` §13; bus: `connection-bus-outbox.json` `C3-MSG-03` (NOT_DELIVERED, orchestrator flush)

## Reconciliation (post-rebase onto the SWARM series)

While TASK-405 was in flight the peer swarm landed 24 commits
(`6a2aa614..9e26380a`: `preserve_order` + explicit checksum `sortObjectKeys`
port, `BinaryData` expansion with `extra`, negative goldens 04–06,
start-node fixtures, `rust_conformance_audit.py` R1–R5, 43-check gate).
This task rebased onto that tip and reconciled the overlap:

- **Convergences, not conflicts.** Their `BinaryData.extra` complements this
  task's `INodeExecutionData.extra` (different structs, auto-merged); they
  adopted this line's `serde_json::Number` approach (`d0b3aa3e`); they
  enabled `preserve_order` workspace-wide with the explicit checksum sort
  this line's A4-MSG-04 had suggested. The validation `OrderedValue` doc
  paragraph claiming the flag "is not an option" is reframed:
  `OrderedValue` is feature-independent by construction (verified immune —
  its order comes from its own `IndexMap`, and all `Value ==` asserts in
  this line's harnesses are order-insensitive under `IndexMap` equality).
- **Adapted their `execution_data_fixtures.rs`** (8 → 7 tests) to the exact
  API: `wrap_data` → `return_json_array` (proven identical on the fixture
  payloads — all are clean `{id}` objects with no `json`/`binary`/
  `pairedItem` keys), `extract_json` inlined as `payloads_of`, the four
  `pair_items` asserts replaced by the engine-shape pins they wrapped
  (all kept verbatim — the RJA/Norm shapes are what prove no count-based
  helper can be the rule), and the pure-heuristic `zero_source_items`
  test removed. Their `MapNoPair` comment is kept as-is.
- **R2 hygiene:** migrated this line's three relative-path harnesses
  (validation, node-model, execution-data) to `CARGO_MANIFEST_DIR`
  (connection already used it), so every crate passes the audit on its
  own rather than via a sibling file.
- **Verified with their rig** (`tools/rust-offline-rig` — no cargo in
  this sandbox): `check` clean, `cargo test` **90/90** (predicted exactly:
  88 − 2 old lib tests − 1 zero test + 4 new lib tests + 1 fixture
  test), `rust_conformance_audit.py` PASS 7/7, `contract_conformance.mjs`
  43/43 after the record refresh, `phase3-rust-acceptance.sh --force`
  PASS. A 31-assertion node simulation of every literal in the adapted
  test file also holds.

## Notes for reviewers

- Known limitation: malformed `binary` maps to `InvalidInput` where the
  unchecked reference spreads it through (X11/X12); full `IBinaryData`
  shape is a follow-up.
- `undefined` is unrepresentable in JSON: N6/P2 pin the serialisable
  remainder with per-case notes.
- Engine-owned behavior (`item: 0` auto-assign, `assignPairedItems`,
  `rewriteInputPairedItems`) stays out of scope — needs run context.
