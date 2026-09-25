# MANAGER RULES (DEC-0017)

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
