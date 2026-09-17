# TASK RESULT: TASK-409-connection-case-08 (+ case 09 addendum)

- **Status**: `SUCCESS` (submitted to async review queue — non-blocking protocol `0af2f152`)
- **Pekerja**: `agent-3`
- **Peran sesaat**: Connection LEGO (03) — golden coverage
- **Manifest**: `tasks/TASK-409-connection-case-08.yaml`

## Ringkasan inti
Menambah kasus golden `tests/reference/connection/08-traversal-depth-and-type-filter` (27 probe) yang menutup celah
cakupan traversal: semantik `depth` (0/1/2/3/-1), filter `ALL` / `ALL_NON_MAIN` saat satu node punya edge `main` + `ai_*`
(sebelumnya hanya 1 probe masing-masing), dedupe+urutan `unshift` pada diamond, rekursi non-main 2 hop, dan quirk
`ALL` diteruskan ke rekursi. Semua expected direkam dari runtime `n8n-workflow@2.9.1`, bukan ditulis tangan. Ini
menutup R-02 (type filter) sebagai kasus yang dapat dieksekusi oleh runner Rust Agent 1 (`connection_probe_fixtures.rs`).

## Bukti mesin
```
$ cd tests/reference/harness && UPDATE=1 node run.js connection && node run.js
REFERENCE TESTS: 21 PASS / 0 FAIL / 0 UNKNOWN          (connection 8/8)
$ cd packages/connection-lego && node --test test/*.test.mjs      → # pass 18  # fail 0
$ LEGO_PORT_MODE=strict node --test test/*.test.mjs               → # pass 18  # fail 0  (case 08 replayed through the seam in both modes)
```
Files: `tests/reference/connection/08-*/{case,expected,README}.json|md`, this record, manifest. No other paths.

## Tahap 3 (non-blocking) — agent-1 review on PR #4: APPROVED + 2 flags → both applied
| Flag | Fix | Proof |
| :--- | :--- | :--- |
| 1 silent skips in `workflow_crate_connection_fixtures.rs` | explicit `SKIPPED_OPS` (owner-labelled) + `panic!` on unknown op, in both runners | runners report `skipped` only from the list |
| 2 `from_value` sorts keys | typed parse from file text; `from_value` path removed (legacy file marked DEPRECATED) | case 08 `ALL`/`ALL_NON_MAIN` went 4 mismatch → 0; spec runner **57/0** on cases 01–08 |

## Addendum — case 09 (ISSUE-028 pinned), same task family
Agent 5's Stage 2k found a stack overflow in `crates/n8n-workflow::get_highest_nodes` on `A→B→A` (ISSUE-028, owner
agent-1). No golden covered `getStartNode`/`getHighestNode` without an acyclic entry. Added
`tests/reference/connection/09-two-node-cycle-start-highest` (22 probes, recorded from the runtime): 2-node cycle,
self-loop, disabled node inside a cycle, plus graph-utils on a pure-cycle selection. Harness now **22 PASS / 0 FAIL**
(connection 9/9). Agent-1's probe runner will turn ISSUE-028 into a permanent red/green instead of a one-off Stage 2k
finding. Not touched: `crates/**`.
