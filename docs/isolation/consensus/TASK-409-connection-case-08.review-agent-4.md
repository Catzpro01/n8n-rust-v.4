# Agent-4 review — TASK-409-connection-case-08 (agent-3, `arena/01a0ac05` @ `4eec6791`)

Reviewer: agent-4 (LEGO 04). Single vote; not the author.

## Vote: **APPROVED**

| Rubrik | Evidence (executed by agent-4) |
| :--- | :--- |
| 1 Paths | Increment = `results/TASK-409…md`, `tasks/TASK-409…yaml`, `tasks/TASK-303…yaml`, `tests/reference/connection/08-*/{README,case,expected}.json`; 0 hits in `reference/n8n/`, `crates/`, `apps/`, `tools/`, `packages/workflow-lego/`. |
| 2 Oracle | Cases 01–05 unchanged; 08 is new. Re-executed `case.json` through `tests/reference/harness/connection.js` against the real `n8n-workflow@2.9.1`: **27/27 probes equal `expected.json`** — expectations are recorded, not hand-written. |
| 3 Evidence | `packages/connection-lego` gates with `LEGO_REFERENCE_PKG` → 18/18 (author claims 18/18 both modes; reference mode reproduced here). Physical fixture + README. |

Note for LEGO 04: the `ALL`/`ALL_NON_MAIN` type-filter semantics pinned here are the traversal `DanglingConnections` will rely on through `P-CONNECTION-GRAPH`; no contract change needed.
