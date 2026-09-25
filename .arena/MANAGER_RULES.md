# MANAGER RULES (DEC-0017, DEC-0018)

The Manager is an Arena agent with the Manager role. It works from
`arena-manager` and the repository; there is no Manager runtime or server.

## Loop

```text
inspect repository → active milestone / slice (register on main)
→ split into tasks with depends_on
→ assign: write .arena/task.md on each arena/agent-NN (npm run arena:task -- assign)
→ monitor: npm run arena:task -- status --fetch
→ review READY_FOR_REVIEW work → rework (review_note) or accept
→ integrate accepted tasks into the ONE Slice branch (arena:task integrate) → one Slice PR
→ checks green → merge per DEC-0014 / DEC-0015 → verify fresh main
→ complete each task (merge_sha on main) → assign the next tasks
```

## Rules

1. The task file on the agent branch is the only task authority. The plan or
   index kept on `arena-manager` is a plan, never task status.
2. One active task per agent. A task has one owner at a time.
3. Assign a task only when every `depends_on` task is completed (COMPLETED on
   its agent branch or its evidence file merged to `main`). Independent tasks
   go to different agents at the same time.
4. Hybrid ownership: a task stays with its owner. When the owner is inactive
   (`status` marks it STALE, default 24 h without commits) or blocked on
   itself, reassign with a reason: `arena:task reassign --from --to --reason`.
   The previous owner's commits are carried into the new branch; nothing is
   deleted or force-pushed.
5. One Slice = one delivery PR (DEC-0014). Integration squashes each accepted
   agent diff onto the Slice branch; `.arena/task.md` and `.arena/progress.md`
   never reach `main`, evidence files do.
6. COMPLETED only after the Slice PR merged and fresh `main` was verified; the
   8 Slice gates (DEC-0014) and runner verification (DEC-0015) still apply.
7. When no agent is available, the Manager may execute a task itself and
   records it as Manager-executed (DEC-0016); it never impersonates an agent.
8. The Manager hands agents no credentials. Agents push with their own
   Arena-provided access; branch protection keeps `main` Manager-only.
9. Governance files change only through a Manager decision merged to `main`.

## Pipeline agents (DEC-0018): manage the flow, not each task

AGENT-01 stays on the single-task workflow until MIGRATE-AGENT-01. AGENT-02..10
work from a task pool and deliver into a result pool on their own branch.

```text
milestone → slices → dependency graph → fill task pools AHEAD of time
→ agents run next → work → result → next … without waiting for you
→ queue: results per Slice → batch-integrate a Slice → ONE Slice PR → main
→ complete tasks (merge SHA) → cross-agent dependencies unlock on the next `next`
```

1. Keep every active agent's pool non-empty: at least one READY task plus the
   follow-ups that unlock after it (ASSIGNED, with `depends_on`). `status`
   shows ready / waiting / working / review / done per agent.
2. Put dependent tasks on the same agent when possible (same-branch
   dependencies unlock immediately); cross-agent dependencies unlock only after
   the dependency is integrated to `main`.
3. `queue` (and `queue --write` for the index on `arena-manager`) lists
   READY_FOR_REVIEW results per Slice and what each Slice still waits for.
   The index is never task authority.
4. Integrate when a Slice is complete enough: `integrate --slice <S> --push`
   applies each result from its own commit ranges (a task can be integrated
   while its agent already works on the next one). Ranges already on the Slice
   branch are skipped. Open the ONE Slice PR when the Slice is complete (DEC-0014).
5. Rework: `rework --agent A --task ID --note "…"` → task READY with the note,
   result REWORK; the agent takes rework before new work; only new ranges are
   integrated afterwards.
6. Reassign: `reassign --from A --to B --task ID --reason "…"` → old pool keeps
   the task as UNASSIGNED with reassigned_to / reason / reassigned_at, new pool
   gets it READY with previous_owner / reason / reassigned_at, in-progress and
   delivered work is carried over. Nothing is deleted or force-pushed.
7. After the Slice merge and fresh-main verification:
   `complete --agent A --task ID --merge-sha <sha> --push` for each task.
8. Roll out in stages (DEC-0018): pilot one agent end to end, then a few, then
   the rest; `pool-init --agent AGENT-NN --push` creates the workspace.
