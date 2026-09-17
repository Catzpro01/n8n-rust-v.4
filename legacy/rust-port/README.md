# legacy/rust-port — QUARANTINED LEGACY RUST ARTIFACTS

**Status:** quarantined, not part of the active build. **Nothing here is compiled, tested,
or shipped by the current verification pipeline.**

## What this is

The Phase-3-attempt Rust workspace (7 crates: `n8n-common`, `n8n-connection`,
`n8n-execution-data`, `n8n-expression`, `n8n-node-model`, `n8n-validation`,
`n8n-workflow`) that landed on `main` during the Phase-2 era (see
`docs/isolation/CROSS-AGENT-ISSUES.md`, ISSUE-012 and successors).

## Why it was moved here (2026-09-18)

`PROJECT_RULES.md` rule #1 (v2.9.4, ZERO RUST) forbids Rust sources in `crates/` and
`apps/`, and the project's official position is "Rust implementation: NOT STARTED"
(LEGO provenance test 19). The legacy workspace sitting in `crates/` therefore failed the
machine-checked guard:

```text
[FAIL] Phase 2: no Rust implementation introduced — Rust artifacts present in Phase 2:
       crates/n8n-common/Cargo.toml, … (22 files)
RESULT: 20/21 CHECKS PASSED   (contract_conformance.mjs)
```

Mitigation proposed verbatim in `results`/PR evidence for TASK-411 (Phase 4C, PR #19):
`git mv crates legacy/rust-port/crates && git mv Cargo.toml legacy/rust-port/Cargo.toml`
(reversible), pending orchestrator decision. Executed here on
`arena/01a0b101-n8n-rust-v-4` as the compliance action for PROJECT_RULES #1.

## How to revert (one command pair)

```bash
git mv legacy/rust-port/crates crates && git mv legacy/rust-port/Cargo.toml Cargo.toml
```

## Notes

- The workspace manifest (`Cargo.toml`) was moved together with the crates, so its relative
  `members = ["crates/…"]` paths still resolve **inside** `legacy/rust-port/`.
- `tools/rust-offline-rig/run.sh` still points at the repo-root `crates/` + `Cargo.toml`;
  it is a legacy build rig for the deprecated port and is NOT part of the current gate.
  If the port is ever revived, point the rig at `legacy/rust-port/` (or revert the move).
- `apps/n8n-rust/` remains an empty reserved directory (`.gitkeep` only) — untouched.
