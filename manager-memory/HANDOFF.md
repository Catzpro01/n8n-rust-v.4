# Manager session handoff (§8)

> Update this file at each meaningful event: a merge, a decision, or a blocker change. SHAs listed here are hints only. Verify them against the remote before acting.

| Field | Value |
|---|---|
| SESSION | Manager session 2026-09-25, part 4 (MANAGER-01) |
| MAIN | `600a2145` (merge of #304, P5-M08). Verify it against the remote |
| EXECUTION MODEL | **DEC-0019 (owner): the Manager executes every task itself.** There are no agent branches, task files, task pool or distribution. Persistent branches are `main` and `arena-manager` only. Each Slice is delivered by one PR from a short-lived Manager branch, which `cleanup.yml` deletes after merge. DEC-0017 is SUPERSEDED; DEC-0018 was never merged (PR #299 closed) |
| DONE THIS SESSION | 15 branches were archived as `archive/*` tags and deleted. PR #299 was closed. 16 distribution issues were closed as not planned (#92, #94, #259-#265, #267-#270, #277, #294, #295). **TASK-0018 COMPLETE** (PR #300 -> `b8d58abb`): the original work by an Arena agent session is in tag `archive/arena-01a0d83c-n8n-rust-v-4-ff929203`, and the Manager adapted it. It was verified live after the merge: cleanup run 36131798803 on self-hosted `MDMTEST-n8n-wsl-3` finished with `cleanup finished: DELETED`. **DEC-0019** delivered: PR #301 -> `bf688c0e`, re-verified on fresh main (decisions ok, workforce 104/104, cleanup 28/28, gates PASS); promoted canonical in #302 -> `20c20caf` |
| KEEP OPEN | #266, #282, #285, #286, #271, #272, #245, #256 and the roadmap/feature issues |
| LEGACY REMOVAL | DONE, PR #303 -> `75c497b7`. Removed: the engine, arena-bridge/executor/gateway, the Supabase control plane, CI Supabase reporting, the no-op audit.yml, agent docs and scripts. Kept: decisions-check, the checks.mjs DEC-0015 verdict, cleanup_runner.py (git-only), setup_laptop_runner.ps1. Manager tooling: persist.sh is handoff-only; the engine store on arena-manager `manager-memory/state` is historical. FINDING: `main` has no branch protection (owner action) |
| DECISIONS | DEC-0001..0016 canonical, DEC-0017 SUPERSEDED, DEC-0019 ACTIVE and canonical (#302). DEC-0014 (one PR per Slice, 8 gates) and DEC-0015 (runner verification) still apply |
| BLOCKERS | **B2 (owner action):** rotate the gateway tokens exposed in the archived `arena-manager` history, and replace the broad Manager PAT (expires 2026-10-23) with a fine-grained token |
| NEXT_ACTION | **P5-M08 VERIFYING** (merged by #304 -> `600a2145`, tree identical to head `c102cff9`; register stays `in-progress`). Fresh-main verification passed: backend 2442/2442, frontend 451/0 (1 skipped), 7 gates, workforce 7/7, decisions ok, live smoke with file storage OK. CI: GitHub-hosted 3/3 PASS, self-hosted Windows 2/2 PASS, main push 4/4 PASS; **5 self-hosted Linux jobs (Level 0/1/2, Post-Merge Cleanup) are WAITING_RUNNER**, which is never PASS (DEC-0015). When they pass: one governance PR marks P5-M08 and P5-F-DEBT-010 `implemented` and fills evidence §6 (the P5-M03 #292 pattern); if they fail: REGRESSION task. Then the queue: P5-M09 (credentials, users, /docs; new), P5-M07, P9-S01, P3-S01, P4-S01, P6-S01/S02, P2-S02/S03. P5-M10 is blocked (no backing models); P5-M02 is blocked; P5-M06 needs a mail-transport decision |
| OWNER RULES | **Never touch any self-hosted runner setting, whatever happens** (owner, 2026-09-25). Leave `main` branch protection as it is (disabled). Leave B2 token rotation for now. State any scope change up front |
| CREDENTIAL | Environment variable only, supplied by the owner per session. It is never stored in Git, memory or evidence |
| REHYDRATE | See `README.md` → *Rehydrate a new Manager session* |

## History (session 2 header, superseded by the table above)
## Session 2026-09-25 (2) outcomes
- P5-M03 COMPLETE: `/api/v1` boundary + workflows resource. The register was re-planned into P5-M06 (email recovery, needs a mail-transport decision), P5-M07 (service-principal REST/UI) and P5-M08 (remaining /api/v1 resources + openapi/docs, P5-F-DEBT-010).
- **CI gap found and fixed (TASK-0022, PR #293):** register-only PRs used to trigger no workflow. #293 is merged (`7d120367`), so register/.ai/contract/engine changes now trigger the gate. Other workflows keep their own filters; if a PR shows 0 runs, dispatch `n8n-lego.yml` on the branch.
- **P5-M02 finding:** the engine has no credential-consuming node (only manualTrigger/start/noOp/set/code/function*; HTTP/credential nodes NOT IMPLEMENTED), so SecretRef resolution in the execution path has no consumer. P5-M02 waits for native-node work (#116 / P6-S04, proposed). The register re-plan recording this dependency is still to do (journal `jrn-p5-m02-no-consumer`).
- REQ-0002: a detector false positive on my own TASK-0022 title. It was resolved as REJECTED (FALSE_POSITIVE). Word task titles neutrally, avoiding "skip … test" and "merge without".

## Ship chain (updated 2026-09-25)
- `ship.sh` uses `ci-verdict.py` (DEC-0015 verdict: ALL_GREEN / ALLOWED_BY_DEC-0015 / PENDING / BLOCKED; one endpoint at 1 s, API limit 5000/h).
- For Slice deliveries, export `SLICE_ID` and `MQ_ID` (after MQ_ADMIT). `mq-premerge.mjs` then records head-anchored CI evidence, checks, classify, authorize and merge-start, and refuses the merge unless the MQ item is READY at the exact head (ship.sh store gate, the fix for the P5-M01 ordering finding).
- After the merge: MQ_MERGE_RESULT, COMMIT(merge) + MAIN_VERIFICATION evidence, MQ_VERIFY, SLICE_UPDATE_ACCEPTANCE.

## Next queue (session 2026-09-25, end)
1. **Authorized Phase A slices, not yet registered as Slice objects.** Each must first be scoped from the code (as was done for P5-M01), and the register re-planned where the code/measurements demand it:
   - P5-M03: COMPLETE. New planned slices: P5-M06, P5-M07, P5-M08 (P5-M08 is the natural next API slice; P5-M07 is independent).
   - P5-M02: dependency-blocked (no credential-consuming node); needs a register re-plan note.
   - P9-S01: per-node cost ledger.
   - P3-S01, P4-S01, P6-S01, P6-S02, P2-S02, P2-S03.
2. **P5-M04 and P5-M05** (new, planned):
   - P5-M04: measure first.
   - P5-M05: depends on P8-S01 (not authorized).
3. **TASK-0018** (GOVERNANCE, unassigned): cleanup.yml / cleanup_runner.py aborts when main has moved past the merge commit (fetch-depth 1).
4. **Improvement candidate** (needs a governance decision): SLICE_COMPLETE gate 8 should accept a register commit on main that descends from the verified SHA.
5. **Security blocker B2 (owner):** rotate the gateway tokens found in arena-manager history; replace the broad PAT (expires 2026-10-23).
