# TASK-401 — Phase-3 Unblock Batch

**Status:** COMPLETED
**Worker:** Arena sandbox agent (session `arena/01a0ace3-n8n-rust-v-4`)
**Role:** Orchestrator (Wasm host) + Workflow-LEGO owner
**Claimed via:** file fallback (Supabase `https://gqctxugkxekdqxsaqrum.supabase.co` unreachable from this sandbox — SSL_ERROR_SYSCALL; `tools/bus/node-bus.mjs status` used instead)

## Summary (3–5 sentences)

Phase 3 was stuck in limbo: vector-borne Rust on `main` with no phase record (ISSUE-012), crates with no golden fixtures (ISSUE-014), a compile-broken offline rig (ISSUE-019), and a proven HIGH behaviour bug in the start-node port (ISSUE-017). This batch resolved all four in one coherent step: the crates now consume golden fixtures from disk with fail-loud I/O, `n8n-validation` carries the full 4/4 rule vocabulary plus the `validate_workflow` aggregate (contract §11.7/§11.8), the start-node port implements the reference's asymmetric `disabled` semantics and is pinned by runtime-derived fixtures plus a mutation test, and the gate now enforces the phase record (`PHASE-3-OPENING.md`), negative-fixture falsifiability (`05-cyclic-invalid` must *fail* the acyclic check), and reference-tree integrity on every offline run. The offline gate is green on all technical stages; the only `BLOCKED` signal is pre-existing ISSUE-018 (4 Gateway result files with SUCCESS-but-empty operation tables — outside my permitted scope) and the deferred live 11/11 re-run (C1 caveat, unchanged).

## Machine Evidence

```text
$ node tools/workflow-reference-manifest.mjs --check
Reference integrity check: PASS (15050 files, root f8da35180669d798…)

$ node tests/reference/workflow-rust/build-fixtures.mjs --check
fixtures match the pinned reference: 8 checksum, 6 diff, 6 shape, 6 rename, 9 traversal, 7 startNode cases

$ tools/rust-offline-rig/run.sh test          # offline, cargo 1.88.0, vendored closure
passed: 57  failed: 0                         # 7 crates — post-merge count (see reconciliation below)

$ node tests/compatibility/contract_conformance.mjs
RESULT: 31/31 CHECKS PASSED                    # incl. inverted CycleDetection for 05-cyclic-invalid
# falsification meta-test: removing the C->A edge from 05-cyclic-invalid -> 30/31
# with "NEGATIVE fixture was accepted as acyclic — cycle detector is not falsifiable";
# restored -> 31/31.

$ bash tests/integration/run_gate.sh --offline-only
STAGE 1   contract conformance   31/31 PASS
STAGE 1.5 reference integrity    PASS (new, ISSUE-011 class)
STAGE 2   boundary audit         PASS (Rust allowed via PHASE-3-OPENING.md)
STAGE 2.5 result integrity       FAIL — ISSUE-018 legacy files (TASK-402, TASK-403,
                                 TASK-INIT-AGENT-3, TASK-INIT-AGENT-4): pre-existing,
                                 Gateway-owned, tracked as a recorded finding
STAGE 3   live 11/11             NOT RUN (offline) — C1 caveat unchanged
```

ISSUE-017 falsification (done, reproducible): mutating the strict `disabled == Some(true)`
self-check in `get_highest_nodes` to the lenient form makes fixture case
`omitted-disabled-asymmetry` **FAIL**; restoring the reference semantics restores 60/60.

## Ideal / NOTE (per ISSUE-004's own language)

- **Ideal:** reference tree byte-identical to the pinned n8n 2.9.x; every Rust behaviour
  pinned by fixtures derived from the pinned runtime; no worker edits goldens to match code.
- **Findings closed by this batch:** ISSUE-012 (record written, gates flipped),
  ISSUE-014 (fixtures + aggregate + fail-loud loads), ISSUE-017 (port corrected, pinned,
  mutation-tested), ISSUE-019 (rig healed, 60/60 green in-sandbox).
- **Carried (with zero protest, recorded):** C1–C4 caveats from TASK-305, ISSUE-004,
  ISSUE-006, ISSUE-016 (deferred by design), ISSUE-018 (BLOCKED stage — the failing files
  are Gateway-authored; per path rules only their author or the orchestrator layer may
  correct them; I record the finding rather than rubber-stamp over it).

## Post-merge reconciliation (push collision with fb720dec)

While this task was being written, the same branch gained a parallel increment from
`arena-agent` (merge `1b8ddd77` + verdict records) which had independently implemented
the SAME negative fixture (`05-cyclic-invalid` A→B→C→A), the same fail-loud
conformance idiom, and a tuple-variant `n8n-validation` increment — the latter
already **peer-APPROVED in writing** via `results/REVIEW-TASK-408-validation-parity.md`
(3-point rubric, recorded "cargo 57 passed / 0 failed"). Per ASYNC protocol §4 (fix
history preserved, no duplicate parallel implementations), I adopted the approved
side for `crates/n8n-validation/src/lib.rs` and `crates/n8n-workflow/tests/conformance.rs`
wholesale, and layered my contract aggregate (`validate_workflow`/`ValidationCode`/
`check_*`, contract §3/§7, TASK-306 reference) on top, ported to their API
(`is_valid_connection_type`, tuple variant). My superseded duplicate lib unit tests
were dropped; their cases live on in `crates/n8n-validation/tests/validation_fixtures.rs`.
Verified post-merge: workspace `check` PASS, `test` **57/57 PASS**, conformance 31/31,
falsification meta-tests re-run.

Separately, protocol rule-sync `0af2f152` (STANDING-WORKER-PROTOCOL §3 HARD BAN 1:
anti self-approval) arrived mid-flight; the self-vote originally recorded for this
task is **WITHDRAWN** and retained only as a self-disclosure record
(`docs/isolation/consensus-votes/disclosure-TASK-401-phase3-unblock_self-record.yaml`).
This task awaits review votes from OTHER agents.

## What remains for the next worker (Phase 3 queue)

1. P3 validation crate (joint surface: frame into two entries only — InvalidConnectionType + `validate_workflow`; single edit per message).
2. R1 fixtures for the five crates that still report `fixMe` in `docs/protocol/CRATE-TO-SPEC-MAP.md`.
3. Live 11/11 re-run on the VPS + PostgreSQL as the first live Phase-3 verification step (C1).
4. ISSUE-018: orchestration layer must emit recorded operations (or non-SUCCESS) for the 4 legacy results; gate stage 2.5 stays red until then.
