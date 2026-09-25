# WORKFLOW — git-native task model (DEC-0017) + pipeline (DEC-0018)

```text
                    GitHub repository (code authority)
                              │
            ┌─────────────────┴──────────────────┐
      arena-manager                      arena/agent-01 … arena/agent-10
   (Manager: plan, index)              (.arena/task.md = the agent's task)
            │                                    │
            └──── assign → work → push → status ─┘
                              │
               integrate → ONE Slice PR → main
```

| Layer | What it is |
|---|---|
| Arena session | the agent runtime (nothing else to run) |
| `arena/agent-NN` | the agent's workspace and its task authority |
| `.arena/task.md` | one task: id, owner, branch, status, depends_on, scope, tests, acceptance |
| `.arena/progress.md` | the agent's running log (never reaches `main`) |
| `.arena/evidence/<id>.md` | task evidence (reaches `main` with the Slice PR) |
| `arena-manager` | Manager plan / index — not task status |
| `main` | integrated, verified code + evidence + decisions + register |

## Statuses

`UNASSIGNED → ASSIGNED → WORKING → READY_FOR_REVIEW → COMPLETED`, with
`WORKING ↔ BLOCKED`, rework `READY_FOR_REVIEW → WORKING`, and reassignment
`(active) → UNASSIGNED` on the old branch.

| Transition | Who |
|---|---|
| → ASSIGNED (new task) | Manager (`assign`, `reassign`) |
| ASSIGNED → WORKING, WORKING ↔ BLOCKED, WORKING → READY_FOR_REVIEW | agent |
| READY_FOR_REVIEW → WORKING | agent, or Manager with `review_note` (`rework`) |
| READY_FOR_REVIEW → COMPLETED | Manager, after merge (`complete --merge-sha`) |
| active → UNASSIGNED | Manager (`reassign`, needs reason) |

## Task file

```markdown
---
id: P5-M04-01
title: Short imperative title
slice: P5-M04
owner: AGENT-01
branch: arena/agent-01
status: ASSIGNED
depends_on: []
scope:
  - apps/n8n-lego/src/example/**
tests:
  - node --test apps/n8n-lego/test/example.test.mjs
acceptance:
  - what must be true when this task is done
assigned_by: MANAGER
assigned_at: 2026-09-25T00:00:00Z
updated_at: 2026-09-25T00:00:00Z
---

Free-form description, context, links.
```

Ids: `<slice>-NN` (for example `P5-M04-01`) or legacy `TASK-NNNN`. No new
milestone numbers.

## Dependencies

`depends_on: [P5-M04-01, P5-M04-02]` — the Manager assigns the task only after
both are completed. A and B run in parallel on two agents; C waits for both.

## Commands (`npm run arena:task -- …`)

| Command | Who | Effect |
|---|---|---|
| `lint` | agent | validates task.md, allowed transition since the last push, progress/evidence, untouched rules |
| `status --fetch` | Manager | table of every agent branch: status, task, STALE, unmet deps, invalid files |
| `assign --agent AGENT-03 --task draft.md --push` | Manager | merges main into the agent branch, writes task.md + progress.md |
| `reassign --from AGENT-01 --to AGENT-04 --reason "…" --push` | Manager | releases on the old branch, carries its commits to the new one |
| `rework --agent AGENT-03 --note "…" --push` | Manager | READY_FOR_REVIEW → WORKING with a review note |
| `integrate --slice P5-M04 --agents AGENT-01,AGENT-03 --push` | Manager | squashes accepted work onto `arena/manager/P5-M04` (the Slice PR head) |
| `complete --agent AGENT-03 --merge-sha <sha> --push` | Manager | COMPLETED; the SHA must be on main and contain the evidence |

The tools only use git. No server, session registration, heartbeat, daemon or
database is needed — and none of the commands handles credentials.

## Pipeline mode (DEC-0018) — AGENT-02..10

```text
Milestone → Slice → TASK POOL (per agent branch) → work → RESULT POOL (per agent branch)
          → Manager integration queue → batch Slice integration → ONE Slice PR → main
```

| Path on `arena/agent-NN` | Content |
|---|---|
| `.arena/task-pool/<ID>.md` | task file (same front matter as above) — the task authority |
| `.arena/current-task.md` | pointer: `task_id`, `status` (IDLE / WORKING / BLOCKED), `started_at`, `base_commit` |
| `.arena/result-pool/RESULT-<n>.md` | result: `task_id`, `agent`, `slice`, `status` (READY_FOR_REVIEW / REWORK / COMPLETED), `commit`, `ranges`, `files_changed`, `tests`, Summary / Limitations / Next |
| `.arena/progress.md`, `.arena/evidence/<ID>.md` | as above |
| `arena-manager:.arena/integration/QUEUE.md` | Manager's queue snapshot (index only) |

Pool task statuses: `UNASSIGNED`, `ASSIGNED` (queued, dependencies not met),
`READY` (can start), `WORKING`, `BLOCKED`, `READY_FOR_REVIEW` (result
delivered), `COMPLETED` (integrated and merged; Manager only).
`READY_FOR_REVIEW` is never `COMPLETED`.

| Command | Who | Effect |
|---|---|---|
| `next --push` | agent | merge main, start the highest-priority READY task (rework first, then `order`, then id) |
| `result --summary … --push` | agent | result record with the task's exact commit ranges; task READY_FOR_REVIEW; current IDLE |
| `block --reason … / unblock` | agent | BLOCKED with a reason, and back |
| `pool-init --agent AGENT-NN --push` | Manager | make the branch a pipeline workspace (AGENT-01 refused) |
| `assign --agent … --task draft.md --push` | Manager | queue in the pool: READY if dependencies are met, else ASSIGNED |
| `queue [--write]` | Manager | results per Slice + what each Slice waits for |
| `integrate --slice S [--tasks …] --push` | Manager | batch-apply results onto `arena/manager/S`; already-applied ranges skipped |
| `rework --agent A --task ID --note …` | Manager | result REWORK, task READY with rework_note |
| `reassign --from A --to B --task ID --reason …` | Manager | history on both sides, work carried |
| `complete --agent A --task ID --merge-sha … --push` | Manager | task and result COMPLETED |

Dependency rule: a dependency is met when its evidence is on `main`, or when
the same agent already delivered it on its own branch.
