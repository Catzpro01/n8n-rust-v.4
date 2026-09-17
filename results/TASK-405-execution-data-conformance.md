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

- `cargo test --workspace`: 59 passed / 0 failed (execution-data: 4 unit + 1 fixture test over 39 cases)
- `cargo check`: no warnings
- `contract_conformance.mjs`: 24/24; `boundary_audit.py`: PASS
- `phase3-rust-acceptance.sh --force`: PASS (record refreshed post-commit)
- Doc: `docs/isolation/execution-data.md` §13; bus: `connection-bus-outbox.json` `C3-MSG-03` (NOT_DELIVERED, orchestrator flush)

## Notes for reviewers

- Known limitation: malformed `binary` maps to `InvalidInput` where the
  unchecked reference spreads it through (X11/X12); full `IBinaryData`
  shape is a follow-up.
- `undefined` is unrepresentable in JSON: N6/P2 pin the serialisable
  remainder with per-case notes.
- Engine-owned behavior (`item: 0` auto-assign, `assignPairedItems`,
  `rewriteInputPairedItems`) stays out of scope — needs run context.
