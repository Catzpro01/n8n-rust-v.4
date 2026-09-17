# TASK-POOL-VERIFY-02 — dual-phase peer sweep + merge-order safety tooling fix

**Agent:** 5 (`arena/01a0aff6-n8n-rust-v-4`)
**Date:** 2026-09-18
**Scope:** pre-task sweep mandated by `docs/isolation/STANDING-WORKER-PROTOCOL.md` §3, plus the
defect that sweep uncovered.

## Summary

The `task_consensus_votes` sweep cannot run against Supabase from this sandbox — the host aborts
the TLS handshake (`http_code=000` in 0.05 s), there is no `.env` in the repo, and the local
SQLite bus mirror the ledger points at (`/home/fern/arena/bus.db`) **does not exist in this
sandbox** (checked: `No such file or directory`), so it lives on the orchestrator's VPS and is
not reachable from a worker. GitHub pull requests were therefore used as the review transport.
Reviewing PR #16 (`arena/01a0aff7`, head `560f1133`) in a detached worktree with the pinned
reference runtime installed reproduced all four of its claimed suite results exactly
(78/78, 48/48, 65/65, 37/37, every exit 0), but the same branch carries commit `4fd6a7e0`, which
deletes 22 files / 2825 lines of the Rust port and leaves `crates/` holding only `.gitkeep` while
its root `Cargo.toml` still declares a 7-member `[workspace]` — merging it as-is would destroy
the Phase-3 port that PR #15 and the TASK-401..409 lineage carry. While verifying Agent 1's
`tools/branch-collision-check.mjs` (ISSUE-024) against that conflict I found it printed
`No path collisions with differing content. Safe to merge in any order.` and exited **0** for refs
it could not read; that is now a refusal with exit 2, pinned by a new 8-check regression test and
wired into the gate as Stage 2d.

## Evidence

### 1. Consensus sweep transport — blocked, substituted

| check | result |
| :-- | :-- |
| `https://gqctxugkxekdqxsaqrum.supabase.co` | `http_code=000`, TLS handshake aborted, 0.05 s |
| `.env` in repo | absent |
| `/home/fern/arena/bus.db` (ledger's claimed local mirror) | `ls: cannot access '/home/fern/arena/': No such file or directory` |
| `find / -name bus.db` | no match anywhere in the sandbox |
| substituted transport | `gh pr review` on PR #14 / #16 / #17 |

### 2. PR #16 (`arena/01a0aff7`, head `560f1133`) — suite claims VERIFIED

Detached worktree `/tmp/review-pr16`, `bash scripts/setup-reference-runtime.sh` first
(n8n-workflow / n8n-core / n8n-nodes-base 2.9.1, 886 packages).

| suite | without `.runtime` | with `.runtime` | PR claim |
| :-- | :-- | :-- | :-- |
| `execution-data-lego` | 68/78 (10 fail) | **78/78**, exit 0 | 78/78 ✅ |
| `scheduler-lego` | 41/48 (7 fail) | **48/48**, exit 0 | 48/48 ✅ |
| `credentials-lego` | 52/65 (13 fail) | **65/65**, exit 0 | 65/65 ✅ |
| `api-lego` | 37/37, exit 0 | **37/37**, exit 0 | 37/37 ✅ |

All 30 pre-runtime failures were environmental: 12 read
`reference runtime not installed at …/.runtime/node_modules`, the rest
`Cannot read properties of null (reading 'workflow' | 'core' | 'cron')`. Only `credentials-lego`
names the missing runtime; the other two read like product defects. Reported to the PR as a
non-blocking reproducibility gap.

Boundary: `git diff --name-only main...HEAD -- reference/n8n` → **0 files**;
`-- packages/editor-ui` → **0 files**.

### 3. PR #16 blocking finding → ISSUE-027

```console
$ git show --stat --format="" 4fd6a7e0 | tail -1
 22 files changed, 2825 deletions(-)
$ git merge-base --is-ancestor 4fd6a7e0 560f1133 && echo YES
YES
$ git ls-tree -r --name-only 560f1133  -- crates      # PR #16 head  -> crates/.gitkeep (1)
$ git ls-tree -r --name-only d2346dfb  -- crates | wc -l
33
$ git show 560f1133:Cargo.toml | head -1
[workspace]
```

Current Phase-3 conformance harness applied to that tree (the branch's own older gate instead
reports `[PASS] Phase 2: no Rust implementation introduced`, `21/21`, exit 2):

```console
[FAIL] Phase 3: Rust workspace manifest present — workspace members without a manifest:
       crates/n8n-common, crates/n8n-workflow, crates/n8n-connection, crates/n8n-validation,
       crates/n8n-node-model, crates/n8n-execution-data, crates/n8n-expression
[FAIL] Phase 3: cargo test evidence fresh — no cargo test evidence on this tree
[FAIL] negative fixtures present — no `-invalid` fixture under tests/reference
RESULT: 23/26 CHECKS PASSED   (exit 1)
```

Review posted to PR #16. GitHub refused `--request-changes`
(`Review Can not request changes on your own pull request` — every arena worker shares the
`arena-ai-coding-agent` identity), so it went up as a `COMMENT` review with the verdict in the
body, followed by a correction of the file/line counts I had misquoted.

### 4. ISSUE-026 — collision detector false green, fixed here

Before:

```console
$ node tools/branch-collision-check.mjs --scope crates/ definitely-not-a-ref also-not-a-ref
  ! cannot read definitely-not-a-ref: Command failed: git ls-tree -r definitely-not-a-ref
  ! cannot read also-not-a-ref: Command failed: git ls-tree -r also-not-a-ref

No path collisions with differing content. Safe to merge in any order.
$ echo $?
0
```

After (this branch):

| case | exit before | exit after |
| :-- | :-- | :-- |
| two bogus refs | **0** ("safe to merge") | **2** REFUSED |
| one readable + one bogus ref | **0** | **2** REFUSED |
| same path, differing content | 1 | 1 |
| same path, identical content | 0 | 0 |
| scope neither ref touches | 0 | 0 |

`tools/branch-collision-check.test.mjs` → **RESULT: 8/8 CHECKS PASSED**, exit 0. Its collision
cases run against a throwaway repo in `$TMPDIR` via `GIT_DIR`/`GIT_WORK_TREE`, so the test never
creates commits, branches, or checkouts in the real repository. Wired as gate **Stage 2d** and
exposed as `npm run collision:test` / `npm run collision:check`.

Note: ISSUE-024's detector compares content of *shared* paths and therefore cannot see a path one
branch deleted and another still ships — exactly the ISSUE-027 conflict. The two checks are
complementary.

### 5. Regression gate after the change

```console
$ bash tests/integration/run_gate.sh --offline-only
RESULT: 43/43 CHECKS PASSED          # Stage 1
AUDIT RESULT: PASS                   # Stage 2
RESULT: 7/7 crates with usable compatibility tests   # Stage 2c
######## STAGE 2d: MERGE-ORDER SAFETY TOOLING SELF-TEST (offline) ########
RESULT: 8/8 CHECKS PASSED            # Stage 2d (new)
OFFLINE STAGES : PASS
LIVE 11/11     : NOT RUN
>>> INTEGRATION GATE: INCONCLUSIVE (live verification required before merge to main) <<<
exit 2
```

Exit 2 is the designed `--offline-only` outcome; no live n8n/Postgres exists in this sandbox, so
the 11/11 live regression remains **NOT RUN** and nothing here is claimed as VERIFIED.

## Files changed

| path | change |
| :-- | :-- |
| `tools/branch-collision-check.mjs` | unreadable refs now refuse with exit 2 instead of reporting "safe to merge" |
| `tools/branch-collision-check.test.mjs` | new, 8 checks, temp-repo based |
| `tests/integration/run_gate.sh` | new Stage 2d |
| `package.json` | `collision:test`, `collision:check` scripts |
| `docs/isolation/CROSS-AGENT-ISSUES.md` | ISSUE-026 (fixed), ISSUE-027 (blocking, PR #16) |

## Still open

* **ISSUE-027** — PR #16 must rebase onto the Phase-3 lineage and restore `crates/**` plus
  `tests/reference/*-invalid/`, or drop its root `Cargo.toml`. Not mine to resolve.
* **ISSUE-021** — two engines on one path (`reconstructed-engine` vs `execution-engine`),
  orchestrator-owned.
* Live 11/11 regression — cannot run in this sandbox.
* Supabase consensus sweep — still unreachable; the mandated vote has no durable store from a
  worker. Recorded rather than silently skipped.
