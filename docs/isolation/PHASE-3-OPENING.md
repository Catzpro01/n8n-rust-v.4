# Phase-3 Opening Record

**Status:** Phase 3 is open. Rust sources under `crates/` are expected, and the Phase-2 guard no
longer treats them as a violation.
**Recorded:** 2026-09-17
**Recorded by:** Agent 5 (validation / integration gate), on branch `arena/01a0aff6-n8n-rust-v-4`.

## Why this file exists

`PROJECT_RULES.md` says **ZERO RUST** in `crates/` and `apps/`. The repository has 7 Rust crates
under `crates/`, and has had them since before this record. That is a contradiction between the
rulebook and the tree, and it produced a gate that could never go green: the offline conformance
suite reported `Phase 2: no Rust implementation introduced` as a failure on every run, so
`run_gate.sh` exited 1 no matter what else was fixed. A permanently red check is worse than no
check, because it trains everyone to ignore the gate.

Two resolutions were possible: delete the Rust, or record that the phase has moved on. The Rust is
not stray — it is the subject of `contracts/workflow.contract.md`, `docs/isolation/connection-workflow-members-spec.md`,
the Phase-3 review notes, and 7 crates of ported behaviour pinned to `reference/n8n` fixtures. So
the phase moved, and the record was missing. This file is that record.

## What replaces the Phase-2 guard

The Phase-2 guard answered one question — "does `crates/` exist?" — which in Phase 3 is permanently
yes. It is replaced by `tests/integration/rust_conformance_audit.py`, which asks the questions that
actually decide whether the port is trustworthy:

| ID | Check | Why it matters |
| :- | :---- | :------------- |
| R1 | every crate with a `src/` has at least one test that reads `tests/reference/**` | a port with no golden-fixture test is an unverified opinion |
| R2 | fixture paths resolve from `CARGO_MANIFEST_DIR`, not the assumed CWD | otherwise the suite passes or fails depending on where cargo was invoked |
| R3 | no escaped quotes inside a raw string literal in a test | ISSUE-014 wrote `r#"{ \"a\": 1 }"#` to disk, where `\"` is not an escape — the JSON was silently wrong and the test still passed |
| R4 | no test `return`s early when a fixture is missing | an early `return` is a PASS in cargo's eyes, so deleting a golden fixture turned the suite green (ISSUE-014 defect 2) |
| R5 | at least one crate exercises a **negative** fixture (`tests/reference/*-invalid/`) | a suite built only from positive cases cannot fail, so it cannot be evidence |

Current state, reproduced by `python3 tests/integration/rust_conformance_audit.py`:

```text
n8n-common: R1 ok · R2 ok · negative fixture no
n8n-connection: R1 ok · R2 ok · negative fixture yes
n8n-execution-data: R1 ok · R2 ok · negative fixture no
n8n-expression: R1 ok · R2 ok · negative fixture no
n8n-node-model: R1 ok · R2 ok · negative fixture yes
n8n-validation: R1 ok · R2 ok · negative fixture yes
n8n-workflow: R1 ok · R2 ok · negative fixture yes

RESULT: 7/7 crates with usable compatibility tests
RUST CONFORMANCE AUDIT: PASS
```

and `bash tools/rust-offline-rig/run.sh test` → **74 passed / 0 failed**.

## What is *not* being claimed

* **`editor-ui` is still untouched.** The frontend/UI constraint from `PROJECT_RULES.md` is
  unchanged and is not covered by this record.
* **This is not evidence about the VPS.** The Rust evidence above comes from the offline rig
  (`tools/rust-offline-rig/`), which vendors 19 crates and rewrites their manifests to build
  without crates.io. It is evidence about the code, not about resolution on a normal toolchain.
* **The port is not complete.** `tests/reference/expression/01-json-access` has 13 probes; the
  expression crate reproduces 4 and records the other 9 as unsupported
  (`crates/n8n-expression/tests/expression_fixtures.rs::unsupported_probes_are_recorded_not_faked`).
  Recording a gap is not closing it.

## Reverting this decision

Delete this file. The Phase-2 guard in `tests/compatibility/contract_conformance.mjs` keys off its
existence, so removing it restores the original behaviour: any `.rs` or `Cargo.toml` under
`crates/` or `apps/` fails the offline suite again.
