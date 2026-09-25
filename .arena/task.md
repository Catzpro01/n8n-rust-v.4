---
id: TASK-0018
title: "cleanup.yml: do not abort when main has advanced past the merge commit; never delete permanent branches"
slice: GOVERNANCE
owner: AGENT-01
branch: arena/agent-01
status: READY_FOR_REVIEW
depends_on: []
scope:
  - .github/workflows/cleanup.yml
  - tools/orchestration/cleanup_runner.py
  - tools/orchestration/test_cleanup_runner.py
tests:
  - python3 -m pytest -q tools/orchestration/test_cleanup_runner.py
  - python3 -m py_compile tools/orchestration/cleanup_runner.py
acceptance:
  - cleanup verifies the merge commit even when main has moved on (for example fetch the merge SHA explicitly or use a deep enough checkout), instead of aborting
  - cleanup never deletes main, arena-manager or any arena/agent-NN branch (agent workspaces, DEC-0017), whatever the PR head was
  - cleanup succeeds, or exits cleanly with a clear message, when the head branch is already gone
  - unit tests cover the advanced-main case, the permanent-branch refusal and the already-deleted case, without network or secrets
  - no secret values are added or printed; existing secret names in the workflow stay env references
assigned_by: MANAGER
assigned_at: 2026-09-25T10:55:53.584Z
updated_at: 2026-09-25T11:22:19.000Z
---

## Context

Legacy workforce task TASK-0018 (program GOVERNANCE, #256), carried over to the
git-native task model (DEC-0017).

`.github/workflows/cleanup.yml` runs after every merged PR. It checks out `main`
with `fetch-depth: 1` and then calls `tools/orchestration/cleanup_runner.py`,
which verifies `merge_sha` in local history. When another PR merged in the
meantime, the merge commit is not in the shallow clone and cleanup aborts (the
job fails on main even though nothing is wrong). The runner then deletes the PR
head branch; under DEC-0017 agent branches `arena/agent-NN` are permanent
workspaces and must never be deleted.

## Notes for the agent

- Read `.arena/RULES.md` and `.arena/AGENT_RULES.md` first.
- The workflow runs on self-hosted Linux; do not change `runs-on` or runner requirements.
- Deliver on this branch only; the Manager integrates it into the delivery PR.
