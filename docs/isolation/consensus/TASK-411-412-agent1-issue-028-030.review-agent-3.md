# Consensus review — agent-1 `TASK-411-issue-028-closure-differential` + `TASK-412-dual-phase-issue-029-030`

| Field | Value |
|---|---|
| Reviewer | `agent-3` (connection LEGO; owner of goldens 01–10) |
| Reviewed artefact | `arena/01a0ace4` @ `b075506e` (`3286d9cf` TASK-411, `981487ba` TASK-412, `b075506e` ledger) |
| Protocol | dual-phase (`b70413fc`) PRE-task sweep; rubric; **executed** in offline rig (rustc 1.88.0) |
| **VOTE** | **APPROVED** (both) |

## Rubric
### 1. Paths — PASS
`crates/n8n-workflow/**`, `tests/differential/**` (adopted from agent-5), `results/`, `docs/isolation/`, `tests/integration/peer_review_rubric.py`
(adopted ISSUE-031 mitigation). No `reference/n8n/**`, no `contracts/**`, no `packages/*-lego/**`.

### 2. Golden oracle — PASS, executed
* As-is: `cargo --offline test --workspace` → 20 suites ok, 0 FAILED; probe runner 88/88.
* **Independent oracle** (not the differential agent-1 wrote against): I injected my goldens 09 (cycles, ISSUE-028 repro,
  `getStartNode()` with no destination → `null` = ISSUE-029 shape) and 10 (error output, sparse slots) into `CASES`
  (`PROBE_TOTAL` 141, `get_start_node(probe["node"].as_str())`):
  **140 executed / 140 matched — 0 value mismatches.** The single non-executed probe is `adjacencyKeys`
  (case 10), a `graph/**` op with no counterpart in `n8n-workflow` — reported loudly by the runner, not silently skipped.
  So ISSUE-028 (no overflow on A→B→A, self-loop, disabled-in-cycle) and ISSUE-029 (`start()` with no destination →
  `null`, disabled-only → `null`) are both confirmed on this HEAD by goldens recorded from the real 2.9.1 runtime.
* ISSUE-030 (unknown destination throw vs `None`) is not covered by my goldens — I rely on agent-4's re-execution
  (`TypeError` pinned, 38/38) and do not add a second vote on that point.

### 3. Evidence — PASS
Both records list both sides executed (ISSUE-026), differential 38/38 accounted, D-09 declared explicitly.

## Non-blocking
1. Adopt 09 + 10 byte-identical (`git hash-object` 09: `38156657`/`dcc00c0e`); `PROBE_TOTAL` → 141; add an `adjacencyKeys`
   arm (or a declared owner-SKIP → agent-3/`graph`) so the count is exact.
2. `wf.getStartNode` arm: use `probe["node"].as_str()` (Option) — needed for the no-destination probe.
