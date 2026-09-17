# Consensus review — worker `01a0ace3` TASK-401 unblock batch (`ee7e476d`) as it touches `crates/n8n-connection`, + sweep record `40ca8e84`

| Field | Value |
|---|---|
| Reviewer | `agent-3` — **connection LEGO owner**; this is the crate that ports my contract/spec |
| Reviewed artefact | `arena/01a0ace3` @ `40ca8e84`; the connection hunk is commit `ee7e476d` (`crates/n8n-connection/src/lib.rs` + `tests/connection_fixtures.rs`) |
| Protocol | dual-phase POST-task sweep (after case 10); rubric; **executed** in offline rig |
| **VOTE** | **APPROVED** (connection slice; the other crates in that batch are outside my oracle — abstain, no protest) |

## Rubric
1. **Paths — PASS.** Rust only in `crates/**` (Orchestrator/porter lane, permitted by Phase 3); `reference/n8n/**`,
   `contracts/connection.contract.md`, `packages/connection-lego/**`, my goldens untouched.
2. **Golden oracle — PASS, executed.** The new `get_connected_nodes` is a line-for-line port of
   `common/get-connected-nodes.ts` (depth countdown, `unshift`+move-to-front, per-type copy of `checkedNodes`,
   missing key → `[]`) — the doc-comment names exactly the four "looks like a bug, is behaviour" points from my port spec §3.
   I ran the crate's own fixture consumer over **all ten** of my golden cases (their test only wires 01 and 03):
   `63 asserted / 0 mismatch / 78 skipped` — 01:8/4, 02:4/6, 03:8/3, 04:3/9, 05:0/1, 06:0/9, 07:2/4, 08:23/4, 09:5/17, 10:10/21.
   That includes case 10's duplicate `Log` in unbounded children (unshift-before-dedup) and case 08's `ALL` reachability —
   the two places a "clean" rewrite would diverge. Case 06 stays 0-asserted because that case is `wf.*`/byDest-rename only.
3. **Evidence — PASS.** `40ca8e84` sweep record lists pre/post votes with rubric; TASK-411 vocabulary frame is an honest
   grandfathering note, not a retroactive rewrite.

## Non-blocking
* Wire cases 02, 04, 07, 08, 09, 10 into `connection_fixtures.rs` with pinned `(asserted, skipped)` counts as above — free
  coverage, byte-identical adoption from `arena/01a0ac05`.
* `byDestination` op is skipped although `map_connections_by_destination` exists — one arm gives +9 asserted probes
  (case 06 rename-stale-destination becomes meaningful).
