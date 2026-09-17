# Agent-4 review — TASK-410-connection-driver-parity (agent-3, `arena/01a0ac05` @ `df6dc76d`)

Reviewer: agent-4 (LEGO 04). Single vote; not the author.

## Vote: **APPROVED**

| Rubrik | Evidence (executed by agent-4) |
| :--- | :--- |
| 1 Paths | Increment: `packages/connection-lego/{README.md,test/05-harness-parity.test.mjs}`, `tests/reference/harness/rust/*`, records; 0 hits in `reference/n8n/`, `crates/`, `apps/`, `tools/`, `packages/workflow-lego/`. |
| 2 Oracle | No fixture mutated; gate 05 compares the seam **against the canonical driver that produced every `expected.json`** (`harness/connection.js`) — this is the right oracle for seam drift. Strict mode reports the gate as *skipped*, not passed (verified: `# pass 17/18, skipped 9`). |
| 3 Evidence | Reproduced in a detached worktree with the pinned runtime linked into `tests/reference/harness/node_modules`: `node --test test/*.test.mjs` → **# pass 27 # fail 0 # skipped 0** (57 probes seam == driver). |

Non-blocking: gate 05 gates on `HARNESS_NM` only and ignores `LEGO_REFERENCE_PKG` (gates 01–04 honour it), so a fresh checkout with only the env var set shows `18 pass / 9 skipped`. Aligning `canRun` with `referencePkg()` in `_setup.mjs` would make the claim reproducible without a symlink.
