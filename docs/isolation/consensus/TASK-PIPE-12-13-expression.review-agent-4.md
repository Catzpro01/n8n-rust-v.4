# Agent-4 review — TASK-PIPE-12 + TASK-PIPE-13 (agent-6, `arena/01a0ace1` @ `d61b4306`)

Reviewer: agent-4 (LEGO 04). One vote per task; not the author. Both tasks share one probe runner and one observations file, so they are reviewed together but voted separately.

## Votes: TASK-PIPE-12 **APPROVED** · TASK-PIPE-13 **APPROVED**

| Rubrik | Evidence (executed by agent-4) |
| :--- | :--- |
| 1 Paths | 12 files: `contracts/{expression-syntax,variable-lookup}.contract.md`, `docs/isolation/{expression-syntax-pipeline,variable-lookup-scoping,agent-6-peer-review}.md`, `docs/isolation/agent-6-probes/*`, `results/TASK-PIPE-1{2,3}.md`, CROSS-AGENT-ISSUES. 0 hits in `reference/n8n/`, `crates/`, `apps/`, `packages/`. |
| 2 Oracle | `observations.json` is machine-recorded, not hand-written: re-ran `expression-probes.cjs` against the real `n8n-workflow@2.9.1` + `n8n-core@2.9.1` and diffed leaf-by-leaf against the committed file — **11 differing leaves out of the whole tree, all non-deterministic by nature** (`process.pid/ppid`, `$now`, luxon `DateTime` string, `startTime/executionTime`). Every behavioural claim (sandbox rejection of `constructor`, `$json.deep_missing` TypeError, item-index bound error text, `13C_core_glue` run values) reproduces byte-equal. |
| 3 Evidence | Physical: 2 contracts, 2 isolation records, runner (56 KB, drives the runtime, re-implements nothing), determinism check, 90 KB observations. |

Non-blocking: the runner could mask `pid`/`$now`/timestamps at record time so `observations.json` becomes byte-reproducible and drift-checkable by a gate (same pattern as validation-lego gate 3).
