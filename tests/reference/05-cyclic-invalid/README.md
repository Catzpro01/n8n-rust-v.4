# 05-cyclic-invalid — negative fixture for `CYCLE_DETECTED`

Added per ISSUE-012 / R5: a validation golden that no crate consumed, so nothing would fail if
the cycle rule were dropped. `case.json` is a structurally valid 3-node `main` cycle
(`A → B → C → A`); with `{ allowCycles: false }` the only permitted error is:

```
CYCLE_DETECTED  node: A  path: connections.C.main  message: "Cycle detected: A → B → C → A"
```

The expected message matches `workflow-rules.ts` `detectCycles` (first back-edge, path from the
grey node, joined with ` → `) and golden case D7 in `docs/isolation/validation-golden-cases.md`.

Consumed by `crates/n8n-validation/tests/cyclic_invalid.rs` (asserts `Err(CycleDetected("A → B → C → A"))`
and that the same graph is accepted when only `main` rules apply... precisely: that the cycle is
detected on the `main` graph, per contract §4.4). The TS side can execute the same pair through
the Agent-4 golden harness in `tests/reference/agent-4/validation/`.
