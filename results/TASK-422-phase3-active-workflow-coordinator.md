# TASK-422 — Active workflow leadership coordinator

Status: **SUBMITTED_FOR_REVIEW**

Added `ActiveWorkflowCoordinator`, a port-driven reconstruction of active-workflow startup and
leadership transitions. Eight focused tests cover the permission matrix, bounded batches,
concurrency lock, follower behavior, inactive rows, active-version error handling, retry policy,
and takeover/stepdown/shutdown lifecycle.

Evidence: trigger suite **19/19 PASS**, trigger gate **5/5 PASS**, scheduler consumer regression and
gate **6/6 PASS**, reference tree unchanged, and `npm run verify:all` exit 0.
