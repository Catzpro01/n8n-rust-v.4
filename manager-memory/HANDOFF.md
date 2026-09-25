# Manager session handoff (§8)

> Update this file at each meaningful event: a merge, a decision, or a blocker change. SHAs listed here are hints only. Verify them against the remote before acting.

| Field | Value |
|---|---|
| SESSION | Manager session 2026-09-25 (MANAGER-01) |
| MAIN | `0437096984d1a2e5e1a216df76a8e31bf8802192` (merge of PR #279) |
| ARENA-MANAGER | Rebuilt from `main` under TASK-0008. Previous history is preserved in tag `archive/arena-manager-28eea831` |
| COMPLETED THIS SESSION | TASK-0001 (#273), TASK-0002 (#274), TASK-0003 (worker branches `arena/agent-01..10`), TASK-0004 (archive + audit), TASK-0009 (#275, DEC-0010), TASK-0010 (#276, DEC-0011), TASK-0005 (#278, DEC-0012), TASK-0011 (#280, Level 1 hotfix), TASK-0006 (#279, DEC-0013) |
| SUPERSEDED | TASK-0007, superseded by TASK-0005 (DEC-0012) |
| IN PROGRESS | TASK-0008: rebuild `arena-manager` (this commit) |
| DECISIONS | DEC-0001..0010 are canonical. DEC-0011, DEC-0012 and DEC-0013 are ACTIVE on main; their promotion records are pending |
| BLOCKERS | **B2 (owner action):** rotate the gateway tokens exposed in the archived `arena-manager` history, and replace the broad Manager PAT (expires 2026-10-23) with a fine-grained, repo-only token |
| KNOWN NON-REGRESSIONS | The Python orchestration/gateway suite fails the same 11 tests on clean `main` as it did before these changes; the failures are environmental and pre-existing. A `lego-scale-stress` SIGKILL was caused by a full RAM-backed `/tmp`; clean `/tmp` and rerun |
| LESSONS | Test every branch of CI shell logic under `bash -e -o pipefail`: `grep` with no match exits 1 (JRN-0015). Never edit a running shell script; run a copy instead |
| NEXT_ACTION | 1) Promotion PR for DEC-0011, DEC-0012 and DEC-0013. 2) Seed the next READY slices from the backlog, using the #254 consolidation mapping (no new P numbers). 3) Refill the 10 open slots from the READY queue (DEC-0010: no slot/runner binding) |
| CREDENTIAL | Environment variable only, supplied by the secure runtime or by the owner per session. It is never stored in Git, memory or evidence |
| REHYDRATE | See `README.md` → *Rehydrate a new Manager session* |
