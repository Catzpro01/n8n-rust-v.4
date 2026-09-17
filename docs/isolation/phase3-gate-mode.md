# Phase-3 gate mode (Agent-5 harnesses)

**Status:** ACTIVE — closes the MSG-14 / MSG-19 gate work (filed 2026-09-17).
**Owner:** Agent 5 (guardian artifacts under `tests/` + `tools/phase3-rust-acceptance.sh`).
**Reference:** n8n `2.9.4` (`reference/n8n`, upstream commit `b6dc2787c45677a29a9612cd27eb911302961a83`).

## Why this exists

Starting Phase 3 turned two Phase-2 harnesses red, because both still asserted the
Phase-2 rule "no Rust may exist" (`contract_conformance.mjs` 20/21,
`boundary_audit.py` → `PHASE VIOLATION`). That was a gate-lifecycle problem, not a
regression: Phase 3 had legitimately begun (`Cargo.toml` workspace +
`crates/n8n-workflow` port). The guards below keep enforcing everything that still
matters and stop forbidding `crates/**` once the workspace is open.

## The phase rule (single source of truth)

> **Phase 3 is open when — and only when — a `[workspace]` manifest exists at the
> repo root (`Cargo.toml`).**

Both harnesses implement this exact predicate; there is no env var, no flag, no
second signal. In Phase 2 every historical assertion is byte-identical to before.

## What each harness asserts

### `tests/compatibility/contract_conformance.mjs`

| Phase | Rust checks |
| :--- | :--- |
| 2 | `Phase 2: no Rust implementation introduced` — any `.rs` / `Cargo.toml` under `crates/` or `apps/` fails (unchanged). |
| 3 | `Phase 3: Rust workspace manifest present` — root manifest declares members, each member directory carries its own `Cargo.toml`. |
| 3 | `Phase 3: workflow-rust acceptance fixtures present (35 cases)` — `tests/reference/workflow-rust/fixtures.json` holds exactly checksum 8 / compareConnections 6 / toJSON 6 / rename 6 / traversal 9, mirroring the constants in `crates/n8n-workflow/tests/reference_fixtures.rs`. |
| 3 | `Phase 3: frozen 15-symbol Workflow surface intact` — `packages/workflow-lego/manifest/ownership.json → publicSurface` still reads 1 aggregate (`Workflow`) + 12 graph + 2 content (`calculateWorkflowChecksum`, `compareConnections`) symbols. |
| 3 | `Phase 3: cargo test evidence fresh` — `docs/isolation/evidence/rust-test-record.json` exists, `result == PASS`, `referenceIntegrity == PASS`, and both `fixturesSha256` and `headCommit` match the current tree. Stale or missing evidence fails with the exact re-run command. |

### `tests/integration/boundary_audit.py`

Phase 2 behavior is unchanged. In Phase 3 the guard becomes an inventory line
(`Phase-3 Rust inventory: N file(s) … (accepted: workspace open)`) and no longer
fails the audit; undocumented cross-LEGO edges still fail exactly as before.

### `tools/phase3-rust-acceptance.sh` (+ `npm run phase3:rust`)

The live step, wired into `tests/integration/run_gate.sh` as Stage 2b:

1. Phase 2 → `SKIP`, exit 0.
2. Evidence already fresh for this exact tree state → live run skipped (pass `--force` to re-run).
3. Otherwise: `cargo test --workspace` when `cargo` is on `PATH` (the VPS path),
   else `tools/rust-offline-rig/run.sh test` (auto-runs `setup.sh` once when the
   rig is missing); plus the G04 reference-integrity check at the same tree
   state; plus a `build-fixtures.mjs --check` reproduction note when the pinned
   runtime is installed.
4. Outcome (PASS/FAIL) is written to `docs/isolation/evidence/rust-test-record.json`.

## Honesty constraints (from MSG-19, kept binding)

* A green run under the offline rig is **evidence about the code, not about the
  dependency versions** the VPS resolves (npm binary repacks + hand-pinned crate
  tags). The record always names its runner.
* **The VPS `cargo test` (real registry) stays a merge condition** for anything
  that depends on the Rust side. The `--force` re-run on the VPS is what
  promotes "green here" to "green everywhere".
* The record is keyed to the **Rust-input tree state** (`crates/`, `Cargo.toml`,
  `Cargo.lock`, `tests/reference/workflow-rust/`, the rig, the acceptance script
  itself) plus the fixtures hash: any committed or uncommitted change to those
  inputs invalidates it loudly instead of silently, while doc/result-only
  commits (including the record commit itself) keep it green.

## Reproduce

```bash
node tests/compatibility/contract_conformance.mjs   # 24/24 in Phase 3 when green
python3 tests/integration/boundary_audit.py          # PASS, Phase-3 inventory line
bash tools/phase3-rust-acceptance.sh --force         # live run, rewrites the record
bash tests/integration/run_gate.sh --offline-only    # stages 1 + 2 + 2b (live NOT RUN)
```
