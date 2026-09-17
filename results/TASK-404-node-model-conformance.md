# TASK-404 node-model-conformance — result: SUCCESS

Agent-2 / LEGO node. `n8n-node-model` pinned against 42 real reference nodes;
`renameFormFields` leaf ported; representation fidelity fixed.

## What changed

- **Corpus** (`tests/reference/agent-2/node-model/`): `build-fixtures.mjs`
  extracts `nodes[]` from a frozen list of 10 workflow JSONs (2 in-repo
  goldens + 8 pinned-reference files), recording per-node `expectExtraKeys`.
  Self-guarding: asserts node completeness + key coverage (credentials,
  webhookId, alwaysOutputData, onError, continueOnFail, disabled, notes,
  notesInFlow, retryOnFail, float typeVersions, formFields) and `--check`
  byte-compares.
- **Harness** (`crates/n8n-node-model/tests/node_fixtures.rs`): per node —
  field fidelity, exact `extra` keys + verbatim values, semantic load/save
  round-trip, parse fixpoint, real-data `rename_form_fields` pin; count
  pinned at 42.
- **Representation fix**: `type_version: f64 → serde_json::Number`,
  `position: [f64; 2] → [Number; 2]` (`1` stayed `1`, not `1.0` — the
  round-trip pin caught it), `disabled` gained `skip_serializing_if`.
  Zero downstream impact (no readers; all construction via `json!`).
- **`rename_form_fields`** (P-NODE-RENAME leaf): exact port of the 29-line
  reference incl. the full guard chain; mutates in place; `FnMut` callback.
  `n8n-workflow`'s inline form-rename left untouched (offered dedup via
  outbox, no action required).
- **Removed** dead `NodeTypeDescription` (zero users, no contract shape) +
  trimmed unused deps (`n8n-common`, `thiserror`).
- **Boundary**: strict per contract §2 (required stays required, like the
  workspace's strict `Vec<INode>` parsing); 4 degenerate mock files excluded
  with rationale, boundary unit-tested both sides.

## Evidence

- `cargo test --workspace`: 56 passed / 0 failed (node-model: 7 unit + 1 fixture test over 42 nodes)
- `cargo check`: no warnings
- `contract_conformance.mjs`: 24/24; `boundary_audit.py`: PASS
- `phase3-rust-acceptance.sh --force`: PASS (record refreshed post-commit)
- Doc: `docs/isolation/node.md` §5; bus: `node-bus-outbox.json` `MSG-04`/`MSG-05` (NOT_DELIVERED, orchestrator flush)

## Notes for reviewers

- Deferred: full `INodeTypeDescription` (§3, dozens of fields, no consumer),
  `getNodeParameters`/`getNodeOutputs` (1966-line engine-coupled context, no
  fixtures), `applyAccessPatterns` completion (agent-1's `rename.rs`, review
  §6 documents the subset).
- Post-task rebase: peer `53c8bf1a` (evidence timestamp refresh, no file
  overlap, reviewed PASS) landed first; rebased conflict-free and re-ran
  acceptance `--force` (PASS at `04a1a097`, 56/56).
- 6 §2 keys have zero occurrences in 2000 surveyed reference nodes
  (`maxTries`, `waitBetweenTries`, `executeOnce`, `extendsCredential`,
  `rewireOutputLogTo`, `forceCustomOperation`) — retention is generic
  (`flatten`), proven via the 8 observed keys.
