# AGENT2-W11 — Wave 11: tool-description update + getContext + assert extras

**Worker:** agent-2 (node-model role) · **Role/task source:** standing harness §6 wave-sourcing (no pool TASK_ID allocated — MSG-16 asks still open)
**Status:** submitted-for-review (non-blocking; protocol v3 dual-phase review honored — sweep report below)

## Summary (3–5 sentences)

Wave 11 pins the remaining uncovered pure helpers of the node-model surface. `getUpdatedToolDescription` (WG-32) auto-upgrades a manual-mode `toolDescription` only when it provably came from an auto source (equals previous `makeDescription`, blank/whitespace, or equals the node-type description) — custom text is preserved (`undefined`). `getContext` (WG-33) keys context on `flow` or `node:<node.name>` — **node NAME, not id** — lazily CREATES missing keys by mutating `runExecutionData.contextData`, and throws three byte-exact `ApplicationError` arms (unknown type carries `extra.contextType`). WG-34 pins `getParameterValueByPath` (lodash join) and the remaining `assertParamIs*` arms: boolean / of-any-types (`must be string or number`) / validator-driven array with sparse-safe for-loop and byte-exact element message. Added 24 golden cases → **237 golden + 7 serde = 244 entries (119,684 bytes)**; harness pins #22/#23; ledger, golden docs, bus (MSG-22) current. No Rust touched; `crates/` + `reference/` diff vs main stays empty.

## Dual-phase review sweep (protocol v3)

- **Pre/post-task sweep** of `results/` on main (17 files): TASK-202-node skipped under **anti-self-approval** (agent-2's own); TASK-402/403 already voted in MSG-16 (anti-double-vote respected); remaining 15 files are 2026-09-16 pipeline-era ping artifacts (pre-consensus DB era) with no pending consensus vote to cast.
- **Votes cast this cycle:** none (nothing peer-authored, pending, and unvoted). Machine evidence: `git log origin/main` — only protocol commits `0af2f152..b70413fc` since last sync; no new peer results.

## Evidence

- `node docs/isolation/node-fixtures.build.cjs --check` → `node-fixtures.json is up to date (byte-identical re-derivation)` (exit 0)
- Tripwire W32/W33/W34 hard-asserts added (exit 3 on oracle drift); expectations derived solely by executing pinned n8n-workflow@2.9.1 dist (n8n@2.9.4)
- `wc -l crates/n8n-node-model/src/lib.rs` → 65 (stub unchanged, 0/6 frozen ports), `git diff origin/main HEAD -- crates/ reference/` empty
- Commit: HEAD on `arena/01a0ac04-n8n-rust-v-4` (includes merge of main v3 `b70413fc`)
