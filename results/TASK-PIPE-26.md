# TASK RESULT: TASK-PIPE-26

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-5`
- **LEGO COMPONENT**: `integration` / `validation`
- **BRANCH**: `arena/01a0aff6-n8n-rust-v-4`
- **TIMESTAMP**: `2026-09-17 UTC`

---

## Summary (3–5 sentences, with machine evidence)

Wrote the `INVALID_CONNECTION_TYPE` fixture test the Phase-3 review asked for and it immediately
failed — not because the rule was wrong but because `serde_json` was declared without
`preserve_order`, so `serde_json::Map` was a `BTreeMap` and **every** `from_str::<Value>()` in the
port re-sorts JSON keys alphabetically before they reach our `IndexMap`s (measured:
`{"main","ai_magic","zzz_last","aaa_first"}` deserialised to
`["aaa_first","ai_magic","main","zzz_last"]`, stable across 5 runs in 3 processes). Fixing that one
line in `Cargo.toml` turned two more tests red and both were real defects the sorted map had been
hiding: `checksum.rs` had never implemented the reference's `sortObjectKeys`
(`workflow-checksum.ts:38-57`) and was relying on the `BTreeMap` to sort for free, and `BinaryData`
was silently dropping `fileType`/`fileSize`/`bytes`/filesystem-`id`. Added the missing negative
fixtures plus per-crate golden-fixture tests. Recorded as **ISSUE-019**; ISSUE-012 P3, ISSUE-014
defect 2 and ISSUE-017 are CLOSED.

The branch had moved 19 commits ahead while I worked (TASK-401/402/403/404 from other agents), so
this was rebased twice rather than pushed as written. Three of my own claims did not survive that
rebase and are corrected in the ledger rather than left standing — see **Corrections** below. Final
state: rig **88 passed / 0 failed**, `contract_conformance.mjs` **43/43 (exit 0)**,
`run_gate.sh --offline-only` **OFFLINE STAGES: PASS**, exit 2 (INCONCLUSIVE — the live 11/11 stage
cannot run here).

## Corrections (all three recorded in `docs/isolation/CROSS-AGENT-ISSUES.md`)

1. **My `INVALID_CONNECTION_TYPE` edge path was wrong.** I asserted and documented
   `["connections","A","main","bogus","type"]`. `workflow-rules.ts:94` builds
   `['connections', source, type, String(oi), String(ti)]` and `:103` appends `'type'`, so the real
   path is `["connections","A","main","0","0","type"]` — the offender is located by **index**, and
   the offending value never appears in the path (only in `message`). Generated fixtures
   `X7-target-type-bad-only` and `D5-bad-type-key` already pinned the correct shape; I had asserted
   from a code reading instead of a fixture. Test and README corrected.
2. **`preserve_order` was a known hazard, not an unambiguous fix.** `crates/n8n-validation/Cargo.toml`
   (TASK-403) says verbatim: *"Deliberately NOT serde_json/preserve_order: that unifies
   workspace-wide and would silently break n8n-workflow's BTreeMap-backed checksum."* They had
   predicted the exact breakage I hit and routed around it with `OrderedValue`. Both routes now
   coexist: `OrderedValue` for validation, `preserve_order` for the `Value`-based crates, and
   `checksum.rs::sort_object_keys` removes the hazard either way.
3. **My `INode` number fix was superseded, not merged.** TASK-404 replaced `type_version`/`position`
   `f64` with `serde_json::Number`, which is strictly better than my `serialize_with` helper — `1`
   stays `1` *and* `4.6` stays `4.6`. I took theirs and adapted the two call sites that broke.

---

## Evidence

### Rust suite (offline rig)

```text
$ bash tools/rust-offline-rig/run.sh test
TOTAL passed=88 failed=0
```

Recorded in `docs/isolation/evidence/rust-test-record.json` at head `d35a4bbd`, with
`referenceIntegrity: PASS (15050 files, root f8da35180669…)` and
`fixturesReproduction: PASS (re-derived byte-exactly)`.

### Integration gate

```text
$ bash tests/integration/run_gate.sh --offline-only
######## STAGE 1: CONTRACT CONFORMANCE (offline) ########
RESULT: 43/43 CHECKS PASSED
######## STAGE 2: BOUNDARY & DEPENDENCY AUDIT (offline) ########
AUDIT RESULT: PASS (all edges documented)
######## STAGE 2b: PHASE-3 RUST ACCEPTANCE (evidence-gated) ########
PHASE-3 RUST ACCEPTANCE: PASS
######## STAGE 2c: RUST CONFORMANCE AUDIT (offline, static) ########
RESULT: 7/7 crates with usable compatibility tests
RUST CONFORMANCE AUDIT: PASS
=======================================================
OFFLINE STAGES : PASS
LIVE 11/11     : NOT RUN
>>> INTEGRATION GATE: INCONCLUSIVE (live verification required before merge to main) <<<
GATE EXIT=2
```

Stage 2b is the upstream `tools/phase3-rust-acceptance.sh` (TASK-401); my static audit was re-added
as **Stage 2c** rather than replacing it, because they answer different questions — 2b proves the
recorded `cargo test` evidence is fresh for this exact tree, 2c proves the port is structurally tied
to the reference.

Exit 2 is designed, not a pass: `--offline-only` cannot execute the live 11/11 regression stage
(no docker in this sandbox).

### Golden fixtures re-derived against the pinned runtime

```text
$ node tests/reference/start-node/build-fixtures.mjs --check
start-node fixtures match the pinned reference: 14 cases

$ node tests/reference/workflow-rust/build-fixtures.mjs --check
fixtures match the pinned reference: 8 checksum, 6 diff, 6 shape, 6 rename, 9 traversal cases
```

Runtime: `.runtime/` (n8n-workflow/core/nodes-base 2.9.1), installed by
`scripts/setup-reference-runtime.sh`.

---

## The bug, and the proof it was real

`Cargo.toml:21` was `serde_json = "1.0"`. Without `preserve_order`, `serde_json::Map` is a
`BTreeMap`, so key order was alphabetical, deterministically:

| | before | after |
| :-- | :-- | :-- |
| probe map iteration | `[aaa_first, ai_magic, main, zzz_last]` | `[main, ai_magic, zzz_last, aaa_first]` |
| `invalid_connection_type_sites` on `06-invalid-connection-type` | `[Output(ai_magic), Target(ai_magic/ai_magic), Target(main/bogus)]` | `[Target(main/bogus), Output(ai_magic)]` |

The "after" column is what `tests/reference/agent-4/validation/workflow-rules.ts:78-107` produces,
because the reference walks `Object.entries(sourceNodeOutputs)` — insertion order.

The feature belongs to **`serde_json`**, not `indexmap`. `indexmap` 2.2.6 has no `preserve_order`
feature; I first added it there, which was wrong, and reverted it.

### Two latent bugs the fix exposed

1. `crates/n8n-workflow/src/checksum.rs` — its own doc comment claimed sorting "comes for free" from
   the `BTreeMap`. The reference sorts explicitly at `workflow-checksum.ts:76`. `sort_object_keys`
   is now an explicit port, so the checksum no longer depends on a cargo feature.
2. `crates/n8n-common/src/lib.rs` — `BinaryData` modelled 4 of the 7 fields the reference emits and
   had no `extra`, so filesystem-mode `id` (needed by `getBinaryDataBuffer`) was dropped. Pinned by
   `tests/reference/execution-data/06-binary-reference/expected.json`.

`INode` was fixed in the same pass: `disabled` no longer emits `null` for an absent key
(`interfaces.ts:1303` makes it optional), and `typeVersion`/`position` render as `1`/`[240, 300]`
rather than `1.0`/`[240.0, 300.0]`.

---

## Files changed

| Path | Change |
| :-- | :-- |
| `Cargo.toml` | `serde_json` gains `preserve_order` (the fix) |
| `crates/n8n-workflow/src/checksum.rs` | explicit `sort_object_keys` port |
| `crates/n8n-workflow/src/lib.rs` | `get_start_node` / `get_highest_node` rewritten (ISSUE-017) |
| `crates/n8n-workflow/src/rename.rs` | `WorkflowError::UnknownNode` |
| `crates/n8n-common/src/lib.rs` | `BinaryData` lossless round trip |
| `crates/n8n-node-model/src/lib.rs` | `INode` optional/number rendering |
| `crates/n8n-validation/src/lib.rs` | `INVALID_CONNECTION_TYPE` + `ConnectionTypeSite` |
| `crates/n8n-workflow/tests/conformance.rs` | silent `return` → hard panic (ISSUE-014 defect 2) |
| `crates/*/tests/*_fixtures.rs` (6 new) | per-crate golden-fixture tests |
| `tests/reference/04-disabled-node/` | new positive fixture |
| `tests/reference/05-cyclic-invalid/` | new **negative** fixture (cycle) |
| `tests/reference/06-invalid-connection-type/` | new **negative** fixture (connection type) |
| `tests/reference/start-node/` | new golden + builder (14 cases) |
| `crates/n8n-workflow/src/lib.rs` | `NodeTypes::describe` call converts `Number` with `as_f64()` |
| `tests/compatibility/contract_conformance.mjs` | negative-fixture support + falsifiability check + `editor-ui` check (on the upstream phase-gate base) |
| `tests/integration/rust_conformance_audit.py` | **new** Stage 2c (R1–R5) |
| `tests/integration/run_gate.sh` | Stage 2c wired in |
| `docs/isolation/CROSS-AGENT-ISSUES.md` | ISSUE-019 entry + corrections 1–3 |

Dropped during the rebase in favour of upstream work: my `PHASE-3-OPENING.md` phase record (the
branch already has `docs/isolation/phase3-gate-mode.md`, keyed off the workspace manifest), my
18-crate rig variant (upstream vendors 19), my `n8n-validation` `INVALID_CONNECTION_TYPE`
implementation (TASK-403 shipped a fuller one with 34 generated cases), and my `f64` + custom
serializer for `INode` numbers (TASK-404 shipped `serde_json::Number`).

---

## Not claimed / unchecked

* **The live 11/11 regression gate did not run** — no docker in this sandbox. The gate is
  INCONCLUSIVE, not VERIFIED, and must not be merged to `main` on this evidence alone.
* **`dynamic_task_pool` / `task_consensus_votes` are unreachable.** `https://gqctxugkxekdqxsaqrum.supabase.co`
  fails the TLS handshake (`http_code 000`), so the mandated pre/post-task voting sweep could not be
  performed and no peer review was recorded.
* **Rust evidence comes from the offline rig**, which vendors 19 crates and rewrites their manifests
  to build without crates.io. It is evidence about the code, not about resolution on a normal
  toolchain.
* **The expression port is still thin**: `tests/reference/expression/01-json-access` has 13 probes;
  the crate reproduces 4 and records the other 9 as unsupported in
  `unsupported_probes_are_recorded_not_faked`. Recording a gap is not closing it.
* `is_expression("=")` returns `false` while the reference treats a bare `=` as an expression marker
  — pinned as a recorded divergence in `the_bare_equals_sign_is_a_recorded_divergence`.
