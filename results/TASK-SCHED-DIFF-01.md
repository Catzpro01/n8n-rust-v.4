# TASK-SCHED-DIFF-01 — Scheduler/cron registry differential (ISSUE-023 three-way evidence)

**Status: SUCCESS** — `node tools/activation-differential.mjs` extended with direct unit-level parity
scenarios S13–S16 (scheduler-lego canonical surface vs execution-engine): **65 agree / 0 diverge /
0 harness errors** across all 16 scenarios. No fix was required — the consolidated scheduler-lego
surface and the execution-engine surface are behaviorally identical on every measured dimension.

## What was added (`tools/activation-differential.mjs`)

| Scenario | Compares | Reference |
| :--- | :--- | :--- |
| S13 | `toCronExpression` **exact-string parity**, all 7 modes + custom `.trim()` + `everyX` hours double-random, fixed `randomInt=()=>42` injected into both; default-random range check | `cron.ts` L52-72 |
| S14 | `toCronKey` parity for plain / recurrence-activated / recurrence-inactive ctx (+ activation-toggle key sensitivity) | `scheduled-task-manager.ts` L139-161 |
| S15 | duplicate detection under **recurrence** ctx end-to-end (registry size 1, duplicate signaled, deregister stops job) | `scheduled-task-manager.ts` L60-79 |
| S16 | deregister semantics (2 crons → both jobs stopped, map cleaned, unknown-id no-throw) | `scheduled-task-manager.ts` L107-126 |

## Falsifiability control

Induced a key-sorting bug into `packages/scheduler-lego/src/cron.mjs` (`toCronKey` returned
unsorted JSON) → **3 DIVERGE / 62 agree** (exactly the three S14 key comparisons; S15 correctly stays
AGREE because duplicate detection is key-function-internal-consistent per engine — cross-engine key
identity is S14's job). Revert → 65/0. Control recorded.

## Review sweep (same turn, `results/REVIEW-SWEEP-2026-09-18.md`)

Dual-phase verdicts for all six peers' `SUBMITTED_FOR_REVIEW` results: TASK-406, TASK-407, TASK-408,
TASK-409, TASK-ENGINE-ACTIVATION-01, TASK-ENGINE-VERIFY-02 — all **APPROVE** on fresh re-run evidence.
TASK-409's N05 initially failed on the merged tree with `Cannot find module 'n8n-workflow'` (env-only:
`packages/workflow-lego/node_modules` wiped by sandbox re-provision; `npm install` restores, 92 pkgs).

## Full matrix on this branch

`verify:all` **real exit 0** — isolation 4/4 · prototype 28/28 · Execution gate 10/10 · connection 52/52 ·
Trigger gate 5/5 · Webhook gate 5/5 · Scheduler gate 6/6 · Node gate 7/7 (N05: node differential **234
agree / 0 diverge**) · activation differential **65/0** · engine differential **84/0** · conformance
42/42 · boundary PASS.

## ISSUE-023 state after this task

All three implementations of the cron/registry surface (trigger-lego seam → scheduler-lego,
execution-engine standalone, scheduler-lego canonical) are behaviorally identical on every surface the
two instruments measure (activation-level 43/0 → 65/0 with S13–S16; engine differential 84/0). The
ownership/consolidation decision itself remains **OPEN for the orchestrator** (recorded in ISSUE-023
ADDENDUM 3); the evidence base it needs is now complete.

**Files:** `tools/activation-differential.mjs` (S13–S16, scheduler-lego import, header note),
`tasks/TASK-SCHED-DIFF-01.yaml`, `results/REVIEW-SWEEP-2026-09-18.md`,
`docs/isolation/CROSS-AGENT-ISSUES.md` (ADDENDUM 3).
