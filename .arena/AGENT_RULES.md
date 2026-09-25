# AGENT RULES (DEC-0017, DEC-0018)

Two workflows run side by side:

- **AGENT-01** keeps the single-task workflow (`.arena/task.md`), sections
  "Start of every session" to "Never" below, until a separate MIGRATE-AGENT-01.
- **AGENT-02..10** use the pipeline workflow (DEC-0018): a task pool and a
  result pool on the agent branch — see "Pipeline agents" at the end. Your
  branch is in pipeline mode when it has `.arena/current-task.md`.

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

## Pipeline agents (AGENT-02..10, DEC-0018)

Your branch holds your own queue of work:

```text
.arena/task-pool/<TASK-ID>.md     tasks the Manager queued for you (READY = can start, ASSIGNED = waits on dependencies)
.arena/current-task.md            what you are working on now (IDLE when nothing)
.arena/result-pool/RESULT-*.md    what you delivered and the Manager has not integrated yet
.arena/progress.md                your running log
.arena/evidence/<TASK-ID>.md      evidence per task (reaches main with the Slice PR)
```

### Entry protocol (every session)

```bash
git status && git branch --show-current       # arena/agent-NN (yours)
git pull --no-rebase                          # the Manager may have queued work or rework
cat .arena/RULES.md .arena/AGENT_RULES.md
cat .arena/current-task.md                    # resume it if WORKING / BLOCKED
ls .arena/task-pool/ .arena/result-pool/
npm run arena:task -- next --push             # when IDLE: start the next READY task
```

### Loop — keep going while READY work exists

1. `next --push` picks the highest-priority READY task (rework first), merges
   `main` into your branch so dependencies from other agents are present,
   marks it WORKING and records where the task started.
2. Work inside the task's `scope`; run its `tests`; commit and push often;
   note progress in `.arena/progress.md`.
3. Write `.arena/evidence/<TASK-ID>.md` (template `.arena/templates/evidence.md`),
   commit everything.
4. `npm run arena:task -- result --summary "…" --limitations "…" --next "…" --push`
   writes the result record (exact commit range, files, tests) and sets the
   task READY_FOR_REVIEW. Your current task becomes IDLE.
5. Go to 1 immediately. Do not wait for review or integration.

Stuck on something outside your control: `block --reason "…" --push`, then
take nothing else until you `unblock` or the Manager reassigns it — one task
in progress at a time. `next` saying IDLE means no READY work: report and stop.

A task depending on a task **you** delivered can start right away (the code is
on your branch). A task depending on **another agent's** task starts once that
task is integrated to `main`.

### You never

add, delete or re-scope pool tasks, change owner / dependencies / acceptance,
set COMPLETED or merge_sha, edit results after the Manager marked them, touch
other agents' branches, merge into `main`, or edit governance. Run
`npm run arena:task -- lint` before every push; it must print OK.
