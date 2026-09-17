# Agent-1 review — PR #4: LEGO 03 Connection seam + cases 06–10 (branch `arena/01a0ac05-n8n-rust-v-4` @ e72ef004)

Reviewer: agent-1 (session `arena/01a0ac85-n8n-rust-v-4`) · Date: 2026-09-17 (UTC)
Mandate: dual-phase PRE-task sweep (protocol v3 §3) — PR explicitly requests consensus review.
Method: **executed in this sandbox** (worktree of the PR tip; npm registry + rig toolchain), not read-only.

## Vote: **APPROVED** (all three written rubric criteria pass with executed evidence)

### R-1 — path rules ✅
67 files, +3846/−13 (vs merge-base 286bac64). All within the connection LEGO
surface: `packages/connection-lego/**`, `tests/reference/connection/**`
(new cases 09/10 dirs), `tests/reference/harness/**` (new rust runners +
additive harness ops), `crates/n8n-connection` spec runners, and the agent's
own docs/contract/results/task files.
- `reference/n8n/**`: **zero modifications** (diff empty) — red line intact.
- `tests/reference/harness/connection.js` (the only pre-existing-file edit,
  9+/1−): **purely additive** — new probe ops
  (`wf.getChildNodes/ getParentNodes/ sourceKeys/ destKeys/
  rebuildThenGetParentNodes`), `c.rename` support, and `Agent`/`SubTool`
  input/output stubs for the new AI cases. No existing probe's semantics
  changed (the single deleted line is the pre-edit `generic()` one-liner,
  replaced by its 3-line superset).

### R-2 — golden-oracle integrity ✅
- New case directories (09 two-node-cycle-start-highest, 10 error-output +
  sparse slots) are **additions** with expected outputs recorded from the
  pinned runtime (2.9.1), matching the existing case pattern.
- No existing `expected.json` was modified; reference pin untouched.
- The branch's own discipline is visible in code: the workflow-crate runner
  carries an explicit `SKIPPED_OPS` allow-list where every skipped op names
  its owner, and any unlisted op is a hard panic — "no silent skips"
  (agent-1 flag 1) and document-order key parsing (agent-1 flag 2) are both
  implemented as commented, testable invariants.

### R-3 — physical evidence ✅ (executed here)
| Claim | This session's execution (PR tip, rustc 1.88 / node 22) |
| :--- | :--- |
| connection-lego 31/31 | `node --test test/*.test.mjs` (default **and** `LEGO_PORT_MODE=strict`): 31 tests, **0 fail** (20 pass + 11 skipped, both modes identical) — `n8n-workflow@2.9.1` resolved, verified 2.9.1 on disk |
| workspace green | `tools/rust-offline-rig/run.sh test` on the PR tree: **65/65 pass, 0 fail** |
| spec runner 82/0 | `run-connection-rig-with-spec.sh test -- --nocapture`: **"connection fixtures: 82 ok / 0 mismatch / 59 skipped (no API yet)"** — exact match |
| workflow-crate 55/1 (D-11) | `run-workflow-crate-vs-connection-fixtures.sh`: **56 ok / 0 mismatch** / 85 skipped, `assert_eq!(bad, 0)` holds — the D-11 divergence was fixed since the claim was written (latest commit), strictly better than recorded |
| reconstructed-engine probe | moved out of `tests/reference/connection` (scanner hygiene), self-noticed in the final commit |

### Notes (non-blocking)
- The "55/1 (D-11)" figure in older wave records is now stale (56/0) — the
  on-disk test is the truth and it asserts `bad == 0`; no action needed.
- Issue tracking: the branch documents ISSUE-033 (companion to agent-4's
  ISSUE-034) with both sides executed — consistent with the ISSUE-026 rule.
- Anti self-approval: this task was not performed or claimed by agent-1
  (session 01a0ac85); vote stands as an independent review.
