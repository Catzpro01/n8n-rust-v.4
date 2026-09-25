# arena-manager audit (read-only) — DEC-0008 preparation

- Audited: 2026-09-25, anonymous read-only fetch. No write was performed.
- `arena-manager` = `28eea83167588b38ce5c090c4bc27daf18b45325`
- merge-base with main = `d0eefa2d4b3a067984dcdd889a048606cd161d8f`
- The branch is 12 commits ahead of `main` `93259311` and 438 behind it. All 12 commits are by the owner (Catzpro01).
- Status: **nothing is migrated yet**.
  - Preservation (archive tag) needs a write credential.
  - Every recovery listed below needs a PR plus a Manager decision.

## Unique commits

| # | Commit | Date | Subject | Files |
|---|---|---|---|---|
| 1 | `7d8157c53d7a148d6ad3e9ae08fa82481ebdd823` | 2026-09-20 | feat(orchestrator): finalize Arena Manager as Antigravity delegated technical operator v1.7 | 51 |
| 2 | `5dc7d7e85bae9e7934ba67c5a8f3935440f42b54` | 2026-09-20 | chore(audit): record capability gateway invocation and E2E verification logs | 1 |
| 3 | `b5c7399e2046e780512fc5c38feb5102ffa0de0b` | 2026-09-20 | chore(audit): record capability gateway invocation and verification events in audit log | 1 |
| 4 | `50715c9c85c22f972bb93e5cc8819edc0051502c` | 2026-09-20 | fix(heartbeat): prevent blind WORKING->AVAILABLE override; add regression test | 3 |
| 5 | `50231cc07db5c37f88c2f0494b14c738094414da` | 2026-09-25 | ci: optimize parallel matrix runners, enable shallow fetch, and accelerate rust builds | 5 |
| 6 | `83b95552fb980c662f481c6a2d4ed8e885cc95e5` | 2026-09-25 | style: auto-format rust codebase with rustfmt | 5 |
| 7 | `070fdeb409ce317ea22ce9c5112d806d09eba085` | 2026-09-25 | ci: mount tmpfs RAM disk, optimize checkout flags, filter affected crates, and expand 10-runner matrix | 2 |
| 8 | `c8dc8567d4f7ee0d2a8f6ed5f867b5125d6b89e8` | 2026-09-25 | ci: add codegen-units=8, enable paths-ignore for docs/logs, and activate sparse crates protocol | 3 |
| 9 | `d2c5f98c0b010df7a151a5d051b0ed2860f27687` | 2026-09-25 | ci: enable target-cpu=native, incremental=0, clean=false, and 8-thread test concurrency | 2 |
| 10 | `3e12228b6fc8e041ac316aa16f8a26aa519352d4` | 2026-09-25 | ci: add cancel-in-progress concurrency and streamline level 0 fast linting | 3 |
| 11 | `c072ff27fb2fc15c2dd2f866a8f5b83467052270` | 2026-09-25 | ci: restore cargo check in level 0 and finalize maximum performance pipeline | 1 |
| 12 | `28eea83167588b38ce5c090c4bc27daf18b45325` | 2026-09-25 | ci: enable zero-test bypass when no rust crates are modified | 1 |

## Classification

| Group | Commits | Content | Classification | Action |
|---|---|---|---|---|
| A | 1–3 | Orchestrator v1.7 plus audit logs: `.arena/gateway_tokens.json`, `.arena/logs/gateway_audit.jsonl`, `.arena/runtime/supervisor_pids.json`, `supabase/.temp/*`, task `.evidence/*` and `workspace.json`, `supabase/functions/gateway/*`, `tools/gateway/{service_manager,worker_fleet_daemon,orchestrator_daemon,server}.py`, `tools/orchestration/{arena_cli,arena_external_worker,autonomous_planner,project_adapter,repository_scanner,run_gate2_reverification,telegram_monitor,workspace_manager}.py` and tests | **SECURITY + MIXED** | Never port verbatim. Treat the tokens as **compromised; the owner must rotate them**. Runtime state (PIDs, logs, `.temp`, per-task evidence) is not source. The code files (Supabase gateway, orchestration tools) are candidates for a reviewed recovery PR that excludes every secret and runtime file. They overlap with the new control plane (#259–#267), so a Manager decision is required per file: keep as adapter, supersede, or retire. |
| B | 4 | `50715c9c` heartbeat fix: prevent a blind WORKING→AVAILABLE override, plus a regression test | **VALUABLE, DEPENDENT** | It conflicts on `main` because `worker_fleet_daemon.py` exists only in group A. Recover it together with the group-A daemon, or re-implement it. The same invariant already holds in `tools/workforce`, where the AgentState release to AVAILABLE is a Manager-only edge taken only at zero active work (DEC-0005). |
| C | 5–11 | CI/Rust tuning: shallow fetch, tmpfs, affected-crate filter, `codegen-units`, sparse protocol, `target-cpu=native`, `clean: false`, test threads, cancel-in-progress, Cargo dev/test profiles | **CANDIDATE, NEEDS REVIEW** | The series applies cleanly on current `main` (cumulative cherry-pick test). Risks: `target-cpu=native` with shared caches across Windows and WSL runners; `clean: false` on persistent self-hosted runners; CRLF line endings added to `Cargo.toml`. Recover only via a PR with exact-head CI on the 10 runners. |
| D | 12 | `28eea831` "zero-test bypass" | **REJECT AS-IS: gate weakening** | It removes the default test set when "no crate changed". The detection uses `git diff HEAD~1 HEAD`, so in a multi-commit PR, crates changed in earlier commits are silently untested. This conflicts with "never weaken a gate". A fixed version could diff against the PR base and keep a minimum test set; that needs a Manager decision. |

## Preservation plan (execute once a write credential exists)

1. `git tag archive/arena-manager-28eea831 28eea83167588b38ce5c090c4bc27daf18b45325` and push the tag. This destroys nothing.
2. Publish this audit on the migration issue.
3. Rotate the gateway tokens (owner action). Consider GitHub secret-scanning / history purge; purging requires an explicit owner decision.
4. Recovery PRs, in this order: group C (CI) → groups A+B code without secrets → group D only as a fixed variant.
5. Rebuild `arena-manager` from `main` as Manager memory. Force-push **only** `arena-manager`, and **only** after step 1 is verified.


## Outcome (2026-09-25)

The Manager executed this plan. Nothing was lost, and the full history is in the archive tag.

| Step | Result |
|---|---|
| 1. Archive | `archive/arena-manager-28eea831` → `28eea831` pushed and verified (TASK-0004) |
| 3. Token rotation | **Owner action still open (B2).** The tokens remain in the archived history. |
| Group C (commits 5–11) | Recovered with review corrections in PR #278 (DEC-0012). Follow-up hotfix #280 fixes the Level 1 empty-match abort. Commit 6 (rustfmt) was already on `main`. |
| Groups A+B (commits 1–4) | PR #279 (DEC-0013): recovered the Supabase RPC path fix and the heartbeat NULL-state fix, with a hermetic test. Runtime state and tokens rejected. Orchestrator v1.7 retired, superseded by `tools/workforce`. |
| Group D (commit 12) | Rejected as a gate weakening. TASK-0007 is superseded by the DEC-0012 Level 1 design, which always runs the minimum test set. |
| 5. Rebuild | This branch, rebuilt from `main` as Manager memory (TASK-0008). |

**Correction to the audit above.** The note about "CRLF line endings added to `Cargo.toml`" was a misreading. `Cargo.toml` is CRLF on `main`, and the recovered profiles keep that format.
