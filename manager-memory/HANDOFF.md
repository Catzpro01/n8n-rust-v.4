# Manager session handoff (§8)

> Update this file at each meaningful event: a merge, a decision, or a blocker change. SHAs listed here are hints only. Verify them against the remote before acting.

| Field | Value |
|---|---|
| SESSION | Manager session 2026-09-25 (MANAGER-01) |
| MAIN | `944d4fc51001f9ffd13a1c0ccfadd4165ea12aa9` (merge of PR #290: register P5-M01 implemented + DEC-0016 canonical) |
| ARENA-MANAGER | Rebuilt from `main` 04370969 under TASK-0008 (`c5d42a98`), then updated with memory-only commits. Previous history is preserved in tag `archive/arena-manager-28eea831` |
| COMPLETED THIS SESSION | TASK-0001 (#273), TASK-0002 (#274), TASK-0003 (worker branches `arena/agent-01..10`), TASK-0004 (archive + audit), TASK-0009 (#275, DEC-0010), TASK-0010 (#276, DEC-0011), TASK-0005 (#278, DEC-0012), TASK-0011 (#280, Level 1 hotfix), TASK-0006 (#279, DEC-0013), TASK-0008 (arena-manager rebuild `c5d42a98`; dispatch CI n8n-lego 36082659623 + TypeScript 36082661458), TASK-0012 (#281, promotion of DEC-0011..0013), TASK-0013 (#283, DEC-0014 Slice delivery rule), TASK-0014 (#284, promotion of DEC-0014) |
| SUPERSEDED | TASK-0007, superseded by TASK-0005 (DEC-0012) |
| IN PROGRESS | none. COMPLETED this session: TASK-0015 (#287), TASK-0016 (#288), Slice P5-M01 = SLICE-0001/TASK-0017 (#289), TASK-0019 (#290). The runners came back online (5 Windows + 5 WSL) and every deferred self-hosted check passed |
| STORE INCIDENT | The raw store was lost twice: first a partial workspace restore, then a Manager `rm` during restore. It was never in arena-manager, because `.gitignore` has `state/`. It was rebuilt empty on 2026-09-25, with sequences above the old IDs and a LOST record in the journal. **Restore at session start:** `cp -r manager-memory/state` into a new directory, then verify it. `~/manager-state/persist.sh` force-adds the state and verifies it with ls-tree |
| DECISIONS | DEC-0001..0016 are all canonical on main. DEC-0015 = two-phase / WAITING_RUNNER (owner model B). DEC-0016 = Manager-executed Slice tasks when no worker session is attached |
| DELIVERY MODEL (DEC-0014) | Slice = delivery boundary, Task = execution boundary, PR = Slice delivery boundary. Every Slice has exactly one delivery PR; P0-P11 and future-program tasks need a registered OPEN Slice (`SLICE_CREATE`); the Manager admits the delivery with `MQ_ADMIT {sliceId}` once every task is READY_FOR_REVIEW; `SLICE_COMPLETE {milestoneRegister}` enforces the 8-point gate and completes all tasks. GOVERNANCE work stays one task = one PR |
| BLOCKERS | **B2 (owner action):** rotate the gateway tokens exposed in the archived `arena-manager` history, and replace the broad Manager PAT (expires 2026-10-23) with a fine-grained, repo-only token |
| KNOWN NON-REGRESSIONS | The Python orchestration/gateway suite fails the same 11 tests on clean `main` as it did before these changes; the failures are environmental and pre-existing. A `lego-scale-stress` SIGKILL was caused by a full RAM-backed `/tmp`; clean `/tmp` and rerun |
| ID NOTE | The session label "TASK-0009" (#276) is store TASK-0010; store TASK-0009 is #275 (JRN-0016) |
| LESSONS | The browser gate `settings-compat` (/rest/license, fixed 2.5s wait) is flaky: rerun the single job on the same head before classifying (JRN-0019). The test catalog comes from `node apps/n8n-lego/scripts/fetch-n8n-catalog.mjs --dir <dir>`. Run workforce tests with `*.test.mjs`, not the directory (JRN-0017). Test every branch of CI shell logic under `bash -e -o pipefail`: `grep` with no match exits 1 (JRN-0015). Never edit a running shell script; run a copy instead |
| NEXT_ACTION | 1) Register the next Slices (SLICE_CREATE with acceptance criteria) and their tasks from the backlog, using the #254 consolidation mapping (no new P numbers). 2) Refill the 10 open slots from the READY queue (DEC-0010: no slot/runner binding). 3) Owner action on blocker B2 |
| CREDENTIAL | Environment variable only, supplied by the secure runtime or by the owner per session. It is never stored in Git, memory or evidence |
| REHYDRATE | See `README.md` → *Rehydrate a new Manager session* |

## Ship chain (updated 2026-09-25)
- `ship.sh` uses `ci-verdict.py` (DEC-0015 verdict: ALL_GREEN / ALLOWED_BY_DEC-0015 / PENDING / BLOCKED; one endpoint at 1 s, API limit 5000/h).
- For Slice deliveries, export `SLICE_ID` and `MQ_ID` (after MQ_ADMIT). `mq-premerge.mjs` then records head-anchored CI evidence, checks, classify, authorize and merge-start, and refuses the merge unless the MQ item is READY at the exact head (ship.sh store gate, the fix for the P5-M01 ordering finding).
- After the merge: MQ_MERGE_RESULT, COMMIT(merge) + MAIN_VERIFICATION evidence, MQ_VERIFY, SLICE_UPDATE_ACCEPTANCE.

## Next queue (session 2026-09-25, end)
1. **Authorized Phase A slices, not yet registered as Slice objects.** Each must first be scoped from the code (as was done for P5-M01), and the register re-planned where the code/measurements demand it:
   - P5-M03: auth API compat. /api/v1 mount; service-principal REST/UI. Email recovery needs mail transport, so decide inside the slice.
   - P5-M02: credential runtime via SecretRef over the P2.27 broker.
   - P9-S01: per-node cost ledger.
   - P3-S01, P4-S01, P6-S01, P6-S02, P2-S02, P2-S03.
2. **P5-M04 and P5-M05** (new, planned):
   - P5-M04: measure first.
   - P5-M05: depends on P8-S01 (not authorized).
3. **TASK-0018** (GOVERNANCE, unassigned): cleanup.yml / cleanup_runner.py aborts when main has moved past the merge commit (fetch-depth 1).
4. **Improvement candidate** (needs a governance decision): SLICE_COMPLETE gate 8 should accept a register commit on main that descends from the verified SHA.
5. **Security blocker B2 (owner):** rotate the gateway tokens found in arena-manager history; replace the broad PAT (expires 2026-10-23).
