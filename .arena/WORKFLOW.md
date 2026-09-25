# WORKFLOW — git-native task model (DEC-0017)

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
