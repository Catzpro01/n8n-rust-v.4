# TASK RESULT: TASK-402-connection-conformance

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-3`
- **LEGO COMPONENT**: `connection`
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-17 16:05:00 UTC`

---

### Summary (5 sentences)

Closed MSG-16/MSG-18 by converging `crates/n8n-connection` on the pinned reference semantics: `get_connected_nodes` is now an exact port (per-type `checked` copies, unshift+splice merge, 5th `checked` arg), fixing proven divergences — diamonds answered `[D,B,C]` instead of `[D,C,B]`, shared children were silently deduped instead of `[C,C,B]`, and `hasPath` searched all types instead of main-only.
Ported the rest of the owned surface from source: `build_adjacency_list`, roots/leaves, input/output edges, `parse_extractable_subgraph_selection` (graph-utils.ts) and `compare_connections` (connections-diff.ts), plus the `getChildNodes`/`getParentNodes` aliases and an edge-item-type fix in the destination inversion.
Before writing code, all 32 pure probes of `tests/reference/connection/*` were replayed against the pinned runtime (32/32 match; harness confirms 5/5 connection, 18/18 full), so the fixtures pin the reference — no fixture file was modified.
Acceptance is `crates/n8n-connection/tests/connection_fixtures.rs`: 32/32 pure probes green with per-fixture executed/skipped counts asserted (14 `wf.*` probes stay Agent 1's), plus the 9 workflow-rust traversal cases as a same-answer cross-check with the Workflow crate.
Evidence re-recorded per the TASK-401 rule: `cargo test --workspace` 44/44 PASS, `contract_conformance` 24/24, `boundary_audit` PASS, `run_gate.sh --offline-only` offline PASS (live NOT RUN — VPS still required).

### Evidence

- Commit: `b29678d5` on `arena/01a0aff6-n8n-rust-v-4` (rebased onto peer `7b5d6230`, conflict-free)
- `docs/isolation/evidence/rust-test-record.json` (PASS at `3b5b6f19`, 44 passed / 0 failed)
- Peer review (STANDING PROTOCOL dual-phase): `31856a9f` + `7b5d6230` (POOL-004 persistence) — reference/ clean, crates/ clean, additive-only shared-script change (flatted pin) — no violation, no gate impact
- `docs/isolation/connection.md` §12 + `docs/isolation/connection-bus-outbox.json` (C3-MSG-01 closes MSG-16/18; notes a padding observation for Agent 1, not edited)
- Pre-verification: `/tmp/conn-ground-truth.mjs` (32/32 vs pinned runtime; scratch, not committed)
