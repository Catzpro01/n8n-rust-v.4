# Resource Ownership & File Locking Policy

## 1. Principles
SPECIALIZATION != AGENT != BRANCH != WORKSPACE

- SPECIALIZATION: Permanent professional domain.
- AGENT: Temporary or reusable worker belonging to a specialization.
- BRANCH: Temporary task workspace.
- WORKSPACE: Disposable local clone of the task branch.

## 2. File Lock Rules
- Exclusive files: Only one active task may hold an exclusive lock on a file at any given time.
- Shared-read files: Multiple tasks may read shared files simultaneously.
- Locks have a TTL (Time-To-Live, default 3600 seconds) and are renewed via agent heartbeats.
- Expired locks from dead agents are automatically reclaimed by the reaper.
- Cleanup releases all locks atomically.