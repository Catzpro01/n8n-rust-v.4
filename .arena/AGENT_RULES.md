# AGENT RULES (DEC-0017)

## Start of every session

```bash
git status
git branch --show-current              # must be arena/agent-NN (yours)
git pull --ff-only                     # get the Manager's latest task.md
cat .arena/RULES.md .arena/AGENT_RULES.md
cat .arena/task.md                     # YOUR task; owner must be you
cat .arena/progress.md                 # where you (or your predecessor) stopped
```

If the branch is not `arena/agent-NN`, or `.arena/task.md` is missing, names a
different owner, or is `COMPLETED` / `UNASSIGNED`: you have no work — stop and
report that; do not pick work yourself.

## Doing the task

1. Set `status: WORKING` in `.arena/task.md` (and `updated_at`). Commit, push.
2. Stay inside `scope`. Run every command in `tests`.
3. Keep `.arena/progress.md` current (done / remaining / evidence). Commit and
   push at least after every meaningful step, so the Manager sees real progress
   and another agent could continue if you disappear.
4. Stuck on something outside your control: `status: BLOCKED` plus
   `blocked_reason: ...`. Commit, push, stop. Resume with `status: WORKING`.
5. Done: write `.arena/evidence/<task-id>.md` (template in
   `.arena/templates/evidence.md`) with `Commit:` and `Tests:` lines, set
   `status: READY_FOR_REVIEW`, commit, push, report.
6. Before every push: `npm run arena:task -- lint` must print `OK`.

## What you may change in `.arena/task.md`

Only `status`, `blocked_reason` and `updated_at`. Everything else — id, owner,
branch, scope, tests, acceptance, depends_on — is the Manager's.

Your transitions: `ASSIGNED → WORKING → READY_FOR_REVIEW`,
`WORKING ↔ BLOCKED`, `READY_FOR_REVIEW → WORKING` (you found a problem).
You never set `COMPLETED`, `UNASSIGNED` or `ASSIGNED`.

If the Manager sets `review_note` and moves you back to `WORKING`, fix what the
note says, then deliver again.

## Never

Merge to `main`, open a PR to `main` yourself (the Manager builds the one Slice
PR), edit rules, touch another agent's branch, or put credentials anywhere.
