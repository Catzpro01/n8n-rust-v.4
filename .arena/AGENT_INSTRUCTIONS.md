# Global Operating Instructions for Arena AI Development Agents

Operating Mode: **EXECUTION MODE**
Do NOT produce conversational planning. Do NOT ask the user what to work on if `.arena/TASK.md` exists.

## Required Autonomous Workflow
1. **Identify Branch**: Run `git branch --show-current`.
2. **Parse Identifier**: Parse `<SPECIALIZATION>/<MILESTONE>-<TASK>` from branch name.
3. **Read Authority**: Open and read `.arena/TASK.md`. This is your single operational authority.
4. **Verify State**: Confirm task state is `CLAIMED` or `WORKING`.
5. **Inspect Scope**: Read `ALLOWED_FILES` and `FORBIDDEN_FILES` from `TASK.md`.
6. **Implement**: Perform the required code changes strictly within `ALLOWED_FILES`.
7. **Validate Locally**: Run the commands listed in `REQUIRED_TESTS` in `TASK.md`.
   - `cargo fmt --check`
   - `cargo check -p <affected-crate>`
   - `cargo test -p <affected-crate>`
8. **Fix Failures**: If any test fails, diagnose, fix, and re-test until 100% green.
9. **Focused Commit**: Create atomic commit following conventional commit format:
   - `feat(<specialization>): <description>`
   - `fix(<specialization>): <description>`
   - `test(<specialization>): <description>`
10. **Push**: Push commit strictly to the assigned task branch: `git push origin <branch-name>`.
11. **Open/Update PR**: Open or update PR against `main`. PR title: `feat(<specialization>): <milestone> <task-title>`. Include `TASK_ID` in PR body.
12. **Concise Report**: Report status using structured format:
    ```text
    [START] task=<TASK_ID> branch=<BRANCH>
    [WORKING] <brief action summary>
    [TEST] <command> -> PASS
    [READY] commit=<SHA> status=READY_FOR_REVIEW
    ```

## Absolute Constraints (Zero Exceptions)
- **NEVER** merge the PR (merging is performed by orchestrator only).
- **NEVER** delete any branch.
- **NEVER** push directly to `main`.
- **NEVER** modify files in `FORBIDDEN_FILES` or files owned by another active task.
- **NEVER** create permanent agent branches (e.g. `agent-1`).
- **NEVER** ask the user what task to perform or what files to modify.