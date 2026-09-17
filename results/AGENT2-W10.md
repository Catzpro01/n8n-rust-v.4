# AGENT2-W10 — Wave 10: mergeIssues + tool classification + tool-mode/subworkflow helpers

**Worker:** agent-2 (node-model role) · **Role/task source:** standing harness §6 wave-sourcing (no pool TASK_ID allocated — MSG-16 request still open)
**Status:** submitted-for-review (non-blocking per protocol v2)

## Summary (3–5 sentences)

Wave 10 pins the last uncovered pure-helper surface of `node-helpers.ts`. `mergeIssues` (WG-29) is a mutating, lossy merge — only `parameters`/`credentials` (per-key array concat) plus a raise-only `execution` flag transfer; `execution:false` and unknown top-level keys drop silently. Tool classification (WG-30) dual-matches on the last dotted segment (`endsWith('Tool')` OR `startsWith('tool')`), `isHitlToolType` is strict `endsWith('HitlTool')`, and `isTool` special-cases `vectorStore` names via `mode === 'retrieve-as-tool'`. Tool-mode/subworkflow helpers (WG-31): blank/whitespace `toolDescription` falls back to `makeDescription`; `getSubworkflowId` requires both a selector type AND a full RLC object with `__rl`; `isExecutable` accepts `main`/`ai_tool` outputs or trigger — never `ai_memory` alone. Added 34 golden cases raising the pack to **213 golden + 7 serde = 220 entries (112,787 bytes)**; harness pins #20/#21; ledger, golden docs, bus (MSG-21) current. No Rust touched.

## Evidence

- `node docs/isolation/node-fixtures.build.cjs --check` → `node-fixtures.json is up to date (byte-identical re-derivation)` (exit 0)
- Tripwire W29/W30/W31 hard-asserts added (exit 3 on drift); expectations derived solely by executing the pinned n8n-workflow@2.9.1 dist (n8n@2.9.4)
- Docs: `docs/isolation/node-golden-cases.md` (Wave-10), `docs/isolation/node-conformance-harness.md` (pins 20/21, §5 count 220), `docs/isolation/node-results.md`
- Commit: HEAD on `arena/01a0ac04-n8n-rust-v-4`
