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
RESULT: 8/8 CHECKS PASSED            # Stage 2d (new, blocking)
RESULT: 11/11 CHECKS PASSED          # Stage 2e self-test (new, blocking)
OFFLINE STAGES : PASS
LIVE 11/11     : NOT RUN
>>> INTEGRATION GATE: INCONCLUSIVE (live verification required before merge to main) <<<
exit 2
```

Exit 2 is the designed `--offline-only` outcome; no live n8n/Postgres exists in this sandbox, so
the 11/11 live regression remains **NOT RUN** and nothing here is claimed as VERIFIED.

### 10. ISSUE-027 blind spot closed: `tools/destructive-deletion-check.mjs` (new)

ISSUE-024's collision detector compares blob hashes of paths present on **both** sides, so a path
one branch deleted never enters the comparison — which is why it could not see PR #16 emptying
`crates/`. The new tool takes `git merge-base --octopus A B` for each pair and reports a path as
destructively deleted when it exists at that merge base, is absent from one ref, and is still
shipped by another.

```console
$ node tools/destructive-deletion-check.mjs $(git for-each-ref --format='%(refname)' refs/remotes/origin | grep -v '/HEAD$')
arena/01a0aff7-n8n-rust-v-4  <->  arena/01a0aff8-n8n-rust-v-4   (merge base fc4e5631)
  arena/01a0aff7-n8n-rust-v-4 deletes 22 path(s) that arena/01a0aff8-n8n-rust-v-4 still ships
DESTRUCTIVE: 22 distinct path(s) removed across 1 ref(s) (44 ref-pair incidences).
Deleting refs (distinct paths each would remove):
  arena/01a0aff7-n8n-rust-v-4 — 22
```

That 22 agrees with the commit that caused it (`4fd6a7e0` → `22 files changed, 2825 deletions(-)`).
Self-test `tools/destructive-deletion-check.test.mjs` → **11/11 CHECKS PASSED**, covering the
ISSUE-027 shape, symmetry under argument order, a three-ref comparison, the "absent from the merge
base is not a deletion" rule, and the ISSUE-026 refusal for unreadable refs.

Wired as gate **Stage 2e, deliberately advisory** (never sets `fail=1`): ISSUE-027 is live, so a
blocking check would be permanently red until the orchestrator settles that merge order, and a
permanently red gate trains everyone to ignore it. The self-test does fail the gate; the survey
does not. Promote Stage 2e to blocking when ISSUE-027 closes.

## Files changed

| path | change |
| :-- | :-- |
| `tools/branch-collision-check.mjs` | unreadable refs now refuse with exit 2 instead of reporting "safe to merge" |
| `tools/branch-collision-check.test.mjs` | new, 8 checks, temp-repo based |
| `tests/integration/run_gate.sh` | new Stage 2d (blocking self-test) and Stage 2e (advisory survey) |
| `package.json` | `collision:test`, `collision:check`, `deletion:test`, `deletion:check` scripts |
| `tools/destructive-deletion-check.mjs` | new — detects the delete/modify class the collision detector cannot see |
| `tools/destructive-deletion-check.test.mjs` | new, 11 checks, temp-repo based |
| `docs/isolation/CROSS-AGENT-ISSUES.md` | ISSUE-026 (fixed), ISSUE-027 (blocking, PR #16, + tooling follow-up), ISSUE-028 (vote transport) |

### 6. Post-task sweep — PR #14 (`arena/01a0aff8` @ `6b1a4639`) → APPROVE

```console
$ node --test packages/execution-engine/test/*.test.mjs
# tests 85   # pass 85   # fail 0
$ node tools/execution-engine-gate.mjs
[PASS] E01 … E11     Execution LEGO gate: 11/11 PASS   (exit 0)
```

Per suite: `01-execution-loop` 14/0 · `02-node-context-data-proxy` 7/0 · `03-error-retry` 12/0 ·
`04-expression-sandbox` 7/0 · `05-activation` 20/0 · `06-error-surface` 7/0 · `07-wait-tracker`
18/0 = **85/0**. Boundary at merge base `fc4e5631`: `reference/n8n` 0, `packages/editor-ui` 0,
Rust added 0. The PR **body** is stale (says 32 tests / 8 gates / POOL-003 11) — the evidence is
better than the description, not worse. Caveat raised: E03 sees 23 Rust files repo-wide, so this
branch does not carry the Phase-3 workspace; merge it before PR #16 or after ISSUE-027 is resolved.

### 7. Post-task sweep — PR #17 (`arena/01a0afff` @ `b2352dde`) → mirror APPROVE, "replacement" claim REQUEST_CHANGES

```console
$ npm run verify:all
# tests 21   # pass 21   # fail 0        <- reconstructed-engine:test (error-policy 16 + runner 5)
[PASS] E01 … E08   Execution LEGO gate: 8/8 PASS
exit 0
$ node --test packages/execution-engine/test/*.test.mjs
# tests 32   # pass 32   # fail 0
```

Mirror spot-checks against its own rule 1 both hold: POOL-001 → `83a77195` (same hash cited inside
`results/POOL-001-core-workflow-execute-loop.md`); POOL-005 → `1dafb0d0`, correctly annotated as
living on the PR #16 branch (no `results/POOL-005*` at this tip).

Blocking: the body claims this branch "contains PR #14's commits verbatim" and can merge "as #14's
replacement". The `a7275c06` half is true, but PR #14 has since advanced:

```console
$ git merge-base --is-ancestor 6b1a4639 b2352dde && echo YES || echo NO
NO
$ git rev-list --count b2352dde..6b1a4639
122
```

Those 122 commits include `2d70d2c4` (WaitTracker/TASK-428), `a1ce0723` (webhook response
headers), `fdd64014` (jsonrepair) and `cf0df209` (node-reference parser) — i.e. the E09/E10/E11
gates and 53 of PR #14's 85 tests. Merging PR #17 as PR #14's replacement would silently drop them.

### 8. Consensus-vote transport is unusable from a worker → ISSUE-028

```console
$ gh pr review 16 --request-changes --body-file /tmp/review16.md
failed to create review: Message: Review Can not request changes on your own pull request
$ gh pr review 14 --approve --body-file /tmp/rev14.md
failed to create review: Message: Review Can not approve your own pull request
```

Every arena worker authenticates as the same `arena-ai-coding-agent` login, which is the author of
all four open PRs, so GitHub treats each as "your own pull request" and rejects both formal
verdicts. All three of my reviews went up as `COMMENT` with the verdict stated in the body and a
header explaining why the formal state was unavailable. Consequence: the protocol's
no-self-approval / no-double-vote rules have no enforceable substrate, and any "approval count" on
these PRs is a count of COMMENTs. Orchestrator action requested in the ledger.

### 9. Correction made this session

My first PR #16 review stated that `4fd6a7e0` "deletes all 23 Rust files". Wrong — I quoted the
PR's overall deletion total from memory instead of the commit's own stat. Actual:
`22 files changed, 2825 deletions(-)`. The finding and its verdict were unaffected; a correction
was posted to PR #16 and the ledger text fixed before commit.

## Still open

* **ISSUE-027** — PR #16 must rebase onto the Phase-3 lineage and restore `crates/**` plus
  `tests/reference/*-invalid/`, or drop its root `Cargo.toml`. Not mine to resolve.
* **ISSUE-021** — two engines on one path (`reconstructed-engine` vs `execution-engine`),
  orchestrator-owned.
* Live 11/11 regression — cannot run in this sandbox.
* Supabase consensus sweep — still unreachable, and GitHub refuses formal verdicts on a shared
  bot identity (**ISSUE-028**). The mandated vote has no durable, enforceable store from a worker.
  Recorded rather than silently skipped.
* **PR #17** must rebase onto `6b1a4639` or drop its "PR #14's replacement" claim (122 commits).
* PR #14's body is stale (32 tests / 8 gates); refresh so the next reviewer is not misled.
