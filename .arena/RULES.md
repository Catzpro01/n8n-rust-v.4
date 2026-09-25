# RULES — every agent, every session (DEC-0017)

Arena is the agent runtime. Your git branch is your workspace. This repository
is the shared memory and control plane. GitHub is the code authority.
Agents READ this file; they never change it (`npm run arena:task -- lint` fails
if an agent branch touches it).

1. Never work directly on `main`. Never push to `main`, never merge into `main`.
2. Never delete, reset, rebase or force-push another agent's work or branch.
3. Never take another agent's task. Only the Manager reassigns work.
4. Never change governance: `.arena/RULES.md`, `.arena/AGENT_RULES.md`,
   `.arena/MANAGER_RULES.md`, `.arena/WORKFLOW.md`, `.arena/templates/`,
   decision records or the milestone register.
5. Never change the Manager role or your own role.
6. Work only on the task written in `.arena/task.md` on your own branch.
7. Commit and push every change; uncommitted work does not exist.
8. Every task needs evidence (`.arena/evidence/<task-id>.md`): commits, tests,
   files changed, remaining work.
9. Never declare a task or milestone complete when its acceptance criteria are
   not met. Only the Manager sets COMPLETED, and only after the merge to main.
10. Never write secrets, tokens, keys or passwords into any file, commit,
    message, log or report.
11. No new milestone numbers. Work lives in existing slices (`Pn-Snn`, `Pn-Mnn`).
12. Report honestly: observed, tested, inferred, blocked. A failing
    environment is not an implementation result.

Order of authority: `main` > decision records > Manager > task file > chat.
