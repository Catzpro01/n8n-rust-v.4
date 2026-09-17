# 04-disabled-node

Golden fixture for `disabled` semantics in **start-node selection and highest-node resolution**
(NOT traversal — see `_scope_warning` in `expected.json`; ISSUE-015/ISSUE-017).

Node layout:

- `Manual Trigger` (`n8n-nodes-base.manualTrigger`, **`disabled: true`**) → `Code`
- `Solo` (`n8n-nodes-base.noOp`, **`disabled` omitted**) → `Code`

Expected values are transcribed from the reference with per-case line citations and are
double-sourced: the runtime-derived group `startNode` in
`tests/reference/workflow-rust/fixtures.json` encodes the same semantics measured on the
pinned n8n-workflow 2.9.1 runtime (the 2.9.4 dependency set). The Rust conformance test
asserts the port against both sources; the two sources agreeing is part of the evidence.

Consumed by: `crates/n8n-workflow/tests/reference_fixtures.rs`
(`disabled_node_golden_matches_transcribed_spec`).
