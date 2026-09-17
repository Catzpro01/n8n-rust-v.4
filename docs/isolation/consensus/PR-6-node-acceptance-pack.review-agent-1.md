# Agent-1 review — PR #6: Node LEGO acceptance pack, waves 1–11 (branch `arena/01a0ac04-n8n-rust-v-4` @ 14f47aa9)

Reviewer: agent-1 (session `arena/01a0ac85-n8n-rust-v-4`) · Date: 2026-09-17 (UTC)
Mandate: dual-phase PRE-task sweep (protocol v3 §3) — open PR with machine-verified entries pending consensus.
Method: **executed in this sandbox** (worktree of the PR tip + pinned n8n-workflow@2.9.1 dist).

## Vote: **APPROVED** (all three written rubric criteria pass with executed evidence)

### R-1 — path rules ✅
15 files, +8090/−105 (vs merge-base b70413fc). Entirely within the Node LEGO
surface: `docs/isolation/node*` (acceptance pack, build script, harness doc,
golden cases, verification & readiness docs), `contracts/node.contract.md`,
`docs/isolation/node.md` (+4), `results/AGENT2-W9/W10/W11.md`.
- `reference/n8n/**`: **zero modifications**.
- `tests/reference/**`: **zero modifications**.
- `crates/**`: **untouched** (also self-attested in `node-phase3-verification.md`:
  "verifier-only run; no crate files were created or modified").

### R-2 — golden-oracle integrity ✅
- The pack is derived **by execution, never by hand**: `node-fixtures.build.cjs`
  executes the pinned `n8n-workflow@2.9.1` reference dist and freezes the
  outputs; its regression discipline is explicit in the file header (exit 1 =
  fixture drift, exit 3 = reference drift → "STOP, investigate, document. Do
  NOT silently regenerate").
- `contracts/node.contract.md` edit (+16/−1) is **purely additive**: two
  additional frozen port rows (`getNodeInputs`, `getConnectionTypes` — frozen
  during Connection CD-05) and runtime-confirmed
  `onError: 'continueErrorOutput'` output semantics. The single deleted line
  updates the barrel's location per the CLOSED ISSUE-011 mediation
  (in-tree barrel → `docs/isolation/node-barrel.ts`) — a correct propagation
  of a closed decision, not a contract weakening.
- `node-bus-outbox.json` (−104): message-history/transport status updates only.

### R-3 — physical evidence ✅ (executed here)
1. **Byte-identical re-derivation of the whole pack** (the decisive check):
   ```text
   $ NODE_FIXTURES_DIST=<pinned n8n-workflow@2.9.1 dist> node docs/isolation/node-fixtures.build.cjs --check
   node-fixtures.json is up to date (byte-identical re-derivation)
   exit: 0
   ```
2. **Entry count verified, not trusted**: the "244 entries" claim decomposes
   exactly as `234 cases + 3 throwCases + 7 serdeConformance = 244`
   (throwCases: executeFilterCondition 2, filterOperatorMatrix 1; serde:
   descriptions 5 + nodes 2). A first naive count (241) that ignored the
   `throwCases` keys was checked against the section map before the vote —
   no overclaim found.
3. Per-wave results (AGENT2-W9/W10/W11) each carry machine output (entry
   deltas, byte sizes, "no Rust touched" boundary statements) consistent with
   the on-disk state.

### Notes (non-blocking)
- The pack's `getNodeParameters.properties` (3) is shared fixture data, not
  counted as entries — consistent with the author's arithmetic (237+7).
- `isExecutable.note` documents its untouched-stub caveat inline — the kind
  of honesty the rubric rewards.
- Anti self-approval: not performed or claimed by agent-1 (session 01a0ac85).
