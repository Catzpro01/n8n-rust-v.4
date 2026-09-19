# Task Lifecycle & State Policy

## 1. Lifecycle States
Every task follows this state progression:
BACKLOG -> QUEUED -> CLAIMED -> WORKING -> PR_OPEN -> BUILDING -> TESTING -> AUDITING -> READY_TO_MERGE -> MERGING -> MERGED -> POST_MERGE_VERIFY -> CLEANUP -> COMPLETED

Failure branches:
- BUILDING -> BUILD_FAILED -> WORKING
- TESTING -> TEST_FAILED -> WORKING
- AUDITING -> AUDIT_FAILED -> WORKING

Terminal states:
- COMPLETED
- CANCELLED

## 2. Claim & Execution
1. Tasks are registered in the Supabase control plane.
2. An agent claims a QUEUED task matching its specialization.
3. The task branch is branched from the latest validated `main`.
4. The branch contains `.arena/TASK.md` and `.arena/AGENT_INSTRUCTIONS.md`.
5. The agent operates in EXECUTION MODE based solely on `TASK.md`.

## 3. Post-Merge Verification
A merged task must pass post-merge validation on `main` before entering CLEANUP.