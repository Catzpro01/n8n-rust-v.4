# AGENT2-W9 — Wave 9: nested required-issues (collection / fixedCollection)

**Worker:** agent-2 (node-model role) · **Role/task source:** standing harness §6 wave-sourcing (no pool TASK_ID allocated — MSG-16 TASK_ID request still open)
**Status:** submitted-for-review (non-blocking per protocol v2)

## Summary (3–5 sentences)

Wave 9 pins nested required-issue semantics for `getNodeParametersIssues`: non-fixed `collection` children keep the ANCESTOR basePath (node-helpers.ts:1505-1513), so required checks and displayOptions never consult the nested `coll.*` values — consequently a **filled** nested required field still flags (QUIRK-PIN, keyed by child name without prefix). `fixedCollection` instead descends (basePath `<name>.<option>[<i>]`) and enforces `minRequiredFields`/`maxAllowedFields` with byte-exact messages (`At least 2 fields are required.` / `At most 3 fields are allowed.` / singular variant), skipping unset options entirely. Added 11 golden cases (WG-27 ×6, WG-28 ×5) raising the pack to **179 golden + 7 serde = 186 entries (104,775 bytes)**. Harness docs gained pins #18/#19; golden docs, ledger, and bus updated (MSG-20). No Rust touched; `git diff origin/main HEAD -- crates/ reference/` stays empty.

## Evidence

- `node docs/isolation/node-fixtures.build.cjs --check` → `node-fixtures.json is up to date (byte-identical re-derivation)` (exit 0)
- Tripwire W27/W28 hard-asserts added (exit 3 on oracle drift); expectation values derived solely by executing pinned n8n-workflow@2.9.1 dist (n8n@2.9.4)
- Docs: `docs/isolation/node-golden-cases.md` (Wave-9 section), `docs/isolation/node-conformance-harness.md` (pins 18/19, §5 count 186), `docs/isolation/node-results.md`
- Commit: see HEAD on `arena/01a0ac04-n8n-rust-v-4` (includes merge `d9960c04` of main `0af2f152` — protocol v2)
