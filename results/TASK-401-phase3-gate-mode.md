# TASK RESULT: TASK-401-phase3-gate-mode

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-5`
- **LEGO COMPONENT**: `integration`
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-17 15:35:00 UTC`

---

### Summary (5 sentences)

Implemented the Phase-3 gate mode MSG-14/MSG-19 requested: both Agent-5 harnesses now detect Phase 3 by the root `[workspace]` manifest and, instead of forbidding `crates/**`, assert the workspace members, the 35 workflow-rust fixture cases (8/6/6/6/9), the frozen 15-symbol Workflow surface, and fresh `cargo test` evidence (`contract_conformance` 24/24, `boundary_audit` PASS).
Added `tools/phase3-rust-acceptance.sh` (wired as `run_gate.sh` Stage 2b, `npm run phase3:rust`) which runs `cargo test` on PATH or the offline rig, plus the G04 reference check and a fixtures-reproduction note, recording everything in `docs/isolation/evidence/rust-test-record.json`.
Extended the offline rig from 12 to 19 vendored crates (indexmap 2.2.6 + equivalent/hashbrown, regex 1.10.6 + automata/syntax/aho-corasick) with `repo:tag:alias` clone specs and a hardened manifest rewriter, since the old closure could not resolve the current workspace.
Evidence on this branch: `cargo test --workspace` 37/37 PASS incl. all 35 reference fixtures, G04 PASS (15050 files, root `f8da3518`), fixtures re-derived byte-exactly, workflow isolation gate `verify:fast` 10/10 PASS with BEHAVIOR CHANGE NONE.
Phase-2 strictness is byte-preserved (no workspace manifest → old rule), and per MSG-19 the VPS `cargo test` on the real registry stays a merge condition — the rig run is evidence about the code, not the resolved versions.

### Evidence

- Commits: `3e9effd5` (gate mode) + `a2aca602` (rig extension) + `aaf5d265` (input-keyed freshness) on `arena/01a0aff6-n8n-rust-v-4`
- `docs/isolation/evidence/rust-test-record.json` (PASS at `aaf5d265`, 37 passed / 0 failed)
- Freshness semantics verified both ways: dirty Rust inputs → `23/24` with `commit and re-run`; committed input change → stale with the changed file named; re-run → `24/24`
- `docs/isolation/phase3-gate-mode.md` (gate-mode spec)
- `bash tests/integration/run_gate.sh --offline-only` → OFFLINE STAGES PASS, LIVE 11/11 NOT RUN (no n8n/PostgreSQL here — VPS re-run still required per caveat C1)
