# TASK-411 connection-types-vocabulary — mutation-test acceptance evidence

| Field | Value |
| :--- | :--- |
| STATUS | `SUCCESS` (evidence complement — no repo code changed) |
| AGENT | `agent-1` (session `arena/01a0ac85-n8n-rust-v-4`) |
| ROLE | Rust-side work-steal (protocol §4; agent-4's review note: *"agent-1 (Rust owner of TASK-408) may apply the rebase; agent-4 cannot (NO-RUST)"*) |
| TIMESTAMP | 2026-09-17 (UTC) |
| Closes | acceptance item 2 of `docs/isolation/consensus/TASK-411-vocabulary-implementation.review-agent-4.md` (NEEDS_CORRECTION `a6ca2d99`): *"state it in the record with the observed failing fixture names from a one-off mutation run"* |

## Scope note (honesty, rubric 3)

The *rebase* half of that review (item 1) was already applied by the original
author before PR #7 — verified on `main`: single definition site of
`NODE_CONNECTION_TYPES` in `crates/n8n-connection` (`pub use` in
`crates/n8n-validation`), `parity.rs` + `cyclic_invalid.rs` +
`connection_types_vocabulary.rs` present, and the full merged tree green:
**105/105 tests, 0 failures** (`tools/rust-offline-rig/run.sh test`, rustc 1.88).
This record adds only the missing **mutation run evidence**; zero lines of
repository code were modified (`git status` on `crates/` clean before and after).

## Method

One-off mutations applied to the rig's **build copy** (`/tmp/rust-rig/build/repo`),
never the repository tree; pristine sources re-copied afterwards and the full
suite re-run (105/105 — baseline restored).

- **Variant A — removal**: delete `"ai_tool"` from `NODE_CONNECTION_TYPES`,
  array bound `13 → 12` (compiles).
- **Variant B — replacement** (keeps bound 13 so every target compiles):
  `"ai_tool" → "ai_tool_removed"`.

## Observed results (executed, not predicted)

**Variant A (removal):**
```text
error: could not compile `n8n-validation` (test "connection_types_vocabulary")
  --> crates/n8n-validation/tests/connection_types_vocabulary.rs:26:5
```
The vocabulary test pins the `[&str; 13]` bound — a one-entry removal is
rejected **at compile time** (the crate refuses to build with a wrong vocabulary).

**Variant B (replacement):** three independent layers all FAIL.

1. **Vocabulary test (runtime list pin):**
```text
test canonical_vocabulary_matches_n8n_294_exactly ... FAILED
  left:  [..., "ai_tool_removed", "ai_vectorStore", "main"]
  right: [..., "ai_tool", "ai_vectorStore", "main"]
```
2. **Validator unit test — proves the validator consumes the shared const**
   (the test uses `"ai_tool"` as a valid key and expects the *edge* type
   `ai_widget` to be the one rejected):
```text
test tests::test_unknown_edge_connection_type_is_rejected ... FAILED
  (panics at crates/n8n-validation/src/lib.rs:839)
```
3. **Parity vs the TS oracle — the requested D-fixture failure:**
```text
test rust_report_matches_the_ts_oracle_on_every_d_fixture ... FAILED
  1 parity failure(s) against the TS oracle:
    D08-ai-edges-ignored
      expected: {"errors":[],"valid":true}
      actual:   {"valid":false,"errors":[ INVALID_CONNECTION_TYPE ×4 —
                 "Unknown connection type \"ai_tool\"" on nodes A & B ]}
```

## Deviation from the review's prediction (recorded, not papered over)

Agent-4's review predicted parity failures on **D05 and D08**. Observed:
**D08 only**. D05 cannot detect a vocabulary mutation: its workflow uses the
invalid type `"foo"` (never in the vocabulary), and the frozen
`INVALID_CONNECTION_TYPE` message text (`Unknown connection type "{ty}" on
node "{source}"`) does not enumerate the allowed list — so no entry removal
changes D05's report. The acceptance intent (*"the validator rejects removing
one entry"*) is met with margin: removal is caught at compile time
(variant A) and a same-length corruption is caught at runtime by the
vocabulary test **and** the validator's own unit test **and** parity D08
(variant B). If agent-4 wants D05 in the mutation surface, the lever is a
fixture/message change — a contract decision, not a Rust one.

## Verdict

Acceptance item 2 of the NEEDS_CORRECTION is satisfied with executed evidence.
Both review items are now resolved (item 1 by the original author via PR #7,
item 2 by this record) — recommended disposition for the task: **APPROVED /
consensus complete**, subject to the normal anti-self-approval constraint
(agent-1 cannot vote the final consensus on a record it co-authored; the vote
belongs to another agent).
