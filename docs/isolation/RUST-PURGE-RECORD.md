# RUST PURGE RECORD — PROJECT_RULES #1 (ZERO RUST) enforcement

**Date:** 2026-09-17 10:37 UTC
**Executed by:** Arena worker session on branch `arena/01a0aee7-n8n-rust-v-4`
**Task:** `TASK-307-rust-guard` (see `tasks/TASK-307-rust-guard.yaml`)
**State before:** `d721b603` · **State after:** this branch tip

---

## 1. Why

`PROJECT_RULES.md` rule 1 is unambiguous:

> **ZERO RUST**: Rekonstruksi menggunakan JavaScript / TypeScript / Node.js murni 1:1 dari source
> code n8n v2.9.4 asli. **Dilarang menulis kode Rust di `crates/` atau `apps/`.**

Every task manifest in `tasks/` repeats it as `forbidden_paths: [crates/**, apps/**]`.

At `d721b603` that rule was violated by 22 tracked artifacts, and the repository's own two
offline harnesses were **failing** because of it:

```text
$ node tests/compatibility/contract_conformance.mjs
[FAIL] Phase 2: no Rust implementation introduced — Rust artifacts present in Phase 2: …
RESULT: 20/21 CHECKS PASSED          (exit 1)

$ python3 tests/integration/boundary_audit.py
-- Phase-2 Rust guard: VIOLATION ['crates/n8n-common/Cargo.toml', …]
PHASE VIOLATION: Rust introduced during Phase 2
AUDIT RESULT: FAIL                   (exit 1)
```

`docs/isolation/LEGO-MASTER-MAP.md` nevertheless carried `No premature Rust | PASS` and
`Rust status: … verified clean (crates/, apps/n8n-rust/ contain only .gitkeep)`. **That claim was
false** and has been corrected in place, with this record as its evidence.

---

## 2. What was removed (verified with `wc -l` before deletion)

| crate | `Cargo.toml` | `.rs` sources | `.rs` lines |
| :--- | ---: | ---: | ---: |
| `n8n-common` | 10 | `src/lib.rs` (1) | 34 |
| `n8n-connection` | 12 | `src/lib.rs` (1) | 244 |
| `n8n-execution-data` | 11 | `src/lib.rs` (1) | 55 |
| `n8n-expression` | 13 | `src/lib.rs` (1) | 78 |
| `n8n-node-model` | 11 | `src/lib.rs` (1) | 65 |
| `n8n-validation` | 13 | `src/lib.rs` (1) | 175 |
| `n8n-workflow` | 15 | `src/{lib,traversal,rename,diff,connections,checksum,ordered}.rs` + `tests/{conformance,reference_fixtures}.rs` (9) | 2 089 |
| **total** | **85** | **15** | **2 740** |

22 tracked files / 2 825 lines removed. Nothing was rewritten or translated — the rule forbids the
Rust artefacts, and re-deriving them as TypeScript from Rust would break rule 1's "1:1 dari source
code n8n v2.9.4 asli" just as surely.

**Kept:** `crates/.gitkeep`, `apps/n8n-rust/.gitkeep` — both directories stay reserved and empty.

**Recoverable:** everything is still in history at `d721b603`:

```bash
git show d721b603:crates/n8n-workflow/src/lib.rs          # verified: 502 lines
git ls-tree -r --name-only d721b603 -- crates
```

**Deliberately retained:** `tests/reference/workflow-rust/` (`README.md`, `build-fixtures.mjs`,
`fixtures.json`). It contains **no** Rust artifact — it is the golden corpus *derived from the
pinned reference runtime*, and it still re-derives cleanly after the purge:

```text
$ node tests/reference/workflow-rust/build-fixtures.mjs --check
fixtures match the pinned reference: 8 checksum, 6 diff, 6 shape, 6 rename, 9 traversal cases   (exit 0)
```

Any native JavaScript/TypeScript reconstruction of the Workflow Model can assert against those
numbers; the corpus is implementation-language agnostic and was not collateral damage.

---

## 3. Guard added so it cannot silently regress

`tools/rust-guard.mjs` → `npm run rust:guard`, and appended to `npm run isolation:check`.

Detection set is **identical** to the two pre-existing harnesses (name ends `.rs`, or equals
`Cargo.toml`), so the three guards can never disagree about what counts as a violation.
`Cargo.lock` / `*.toml` / `build.rs` hits are warnings only. Missing guarded directory = clean
(absent means nothing to offend), never an error.

Negative test — a planted violation is caught by all three, and removing it restores green:

```text
$ mkdir -p crates/n8n-probe/src && echo 'pub fn probe() -> u8 { 1 }' > crates/n8n-probe/src/lib.rs
$ node tools/rust-guard.mjs                    → RESULT: FAIL — 2 Rust artifact(s)   (exit 1)
$ node tests/compatibility/contract_conformance.mjs → 20/21                          (exit 1)
$ python3 tests/integration/boundary_audit.py       → AUDIT RESULT: FAIL             (exit 1)
$ rm -rf crates/n8n-probe && node tools/rust-guard.mjs                               (exit 0)
```

---

## 4. Post-purge verification (all run in this sandbox, 2026-09-17)

Reference runtime installed first (`scripts/setup-reference-runtime.sh` → `n8n-workflow` /
`n8n-core` / `n8n-nodes-base` **2.9.1**, 885 packages). Without it, gates G08–G10 fail on
`LEGO_REFERENCE_PKG must point at an installed n8n-workflow package` — an environment gap, not a
code regression.

| command | result | exit |
| :--- | :--- | ---: |
| `node tools/rust-guard.mjs` | `RESULT: PASS — no .rs / Cargo.toml under crates, apps` | 0 |
| `npm run rust:guard` | same, via npm script | 0 |
| `npm run isolation:check` | boundary + kernel + port + reference + rust guard | 0 |
| `node tests/compatibility/contract_conformance.mjs` | `RESULT: 21/21 CHECKS PASSED` (was 20/21) | 0 |
| `python3 tests/integration/boundary_audit.py` | `AUDIT RESULT: PASS (all edges documented)` (was FAIL) | 0 |
| `bash tests/integration/run_gate.sh --offline-only` | `OFFLINE STAGES : PASS` / `LIVE 11/11 : NOT RUN` → INCONCLUSIVE by design | 2 |
| `npm run verify:fast` | `gates: 10/10 PASS · BEHAVIOR CHANGE: NONE DETECTED` | 0 |
| `npm run verify` | `gates: 11/11 PASS` · G11 live `7/7 PASS · R0…R6:PASS` | 0 |
| `node tests/reference/workflow-rust/build-fixtures.mjs --check` | fixtures match the pinned reference | 0 |

Evidence files rewritten by the gate run (tracked by design): `docs/isolation/evidence/gate-report.json`,
`docs/isolation/evidence/live-verification.json`, `docs/isolation/evidence/model-digest.comparison.json`,
`docs/isolation/workflow-verification.md`.

---

## 5. Still open — explicitly **not** claimed here

* **VPS 11/11 smoke re-run** (`tests/reference/baseline/SMOKE_TEST_RESULTS.md`, host `157.10.160.95`,
  PostgreSQL) was **not** executed: this sandbox has no route to that host, and `docker` is absent so
  `tests/integration/regression_gate.py` cannot run either. `run_gate.sh` therefore reports
  **INCONCLUSIVE**, which is the script's own contract for "offline stages green, live not run".
  Caveat `C1` of `TASK-305-phase2-final-verdict` stays **open**.
* `ISSUE-004` (runtime cycles) and `ISSUE-006` (global state / env coupling) remain open; they are
  inherited from upstream n8n 2.9.4 and are untouched by this change.
* `PROJECT_RULES.md` #1 is unconditional: no phase transition authorizes Rust. `crates/` and
  `apps/` remain empty placeholders and stay guarded while the reconstruction proceeds only in
  JavaScript / TypeScript / Node.js.
