# TASK RESULT: TASK-417-verify-11-11-and-rust-rig

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-5`
- **LEGO COMPONENT**: `localization` (Phase 4H — review-driven closure)
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-18 UTC`
- **BASE**: `8797d0f9` (Phase 4G tip)
- **ADOPTED**: `1f86b03e` (extractor ISSUE-027 fix, `arena/01a0b101`) · `87b5960d` (rust-rig 19-crate closure, `arena/01a0b103`)

---

### Why this task exists

The PR #19 review left three items. Two of them blocked a full APPROVE:

1. **ISSUE-027** — `npm run verify` was **9/11**: G06 failed with **TS5097** on the isolated unit
   (`localization-envelope.ts`, then also `api-error-response.ts` + `execution-log-record.ts`), cascading
   into G08. The root cause was structural: this lane's sources import with explicit `.ts` specifiers
   (correct for Node's type-stripping loader — that is why the localization gate is green), while
   `.extract/tsconfig.json` is CommonJS + `declaration: true` and therefore **cannot** set
   `allowImportingTsExtensions` (TS5096 forbids the combination).
2. **The offline Rust rig claim** — this PR pointed `run.sh` at the archive but left `setup.sh` /
   `vendor_prep.py` on the old 12-crate closure, so a fresh sandbox would fail on `indexmap`.

Both fixes already existed on other lanes. This task **adopts them** (`cherry-pick -x`, authorship and
provenance preserved), resolves the conflicts in favour of *both* sides, and produces the machine
records the review asked for.

### Pipeline Operations Summary

| Operation | Status | Exit Code |
| :--- | :--- | :--- |
| `cherry_pick` (`1f86b03e` extractor normalization) | ✓ SUCCESS | `0` |
| `cherry_pick` (`87b5960d` rust-rig closure) | ✓ SUCCESS | `0` |
| `write_file` (`tools/issuez027-falsify.mjs`) | ✓ SUCCESS | `0` |
| `run_tool` (falsification harness) | ✓ SUCCESS | `0` — CONFIRMED |
| `run_gate` (`npm run verify`) | ✓ SUCCESS | `0` — **11/11 PASS** |
| `run_gate` (`npm run verify:fast`) | ✓ SUCCESS | `0` — 10/10 PASS |
| `run_rig` (`setup.sh` + `rust:check-offline` + `rust:test-offline`) | ✓ SUCCESS | `0` — 19 crates, **37 tests passed** |
| `run_tests` (localization 79/79) | ✓ SUCCESS | `0` — no regression |
| `run_gate` (`localization-gate` 16/16 · `contract_conformance` 22/22 · `boundary_audit` PASS) | ✓ SUCCESS | `0` |

### Finding 1 — ISSUE-027 is closed on this branch, with a falsification control

`npm run verify` (full, live included):

```text
[PASS] G05 isolation extraction (pure import rewrites only) — .ts-ext normalized : 11 specifier(s) across 4 LEGO file(s) (ISSUE-027)
[PASS] G06 TypeScript build PASS (isolated unit, ports only) — tsc -p .extract/tsconfig.json → 0 errors
[PASS] G07 TypeScript build PASS (versioned boundary/ports/facade) — tsc --noEmit → 0 errors
[PASS] G08 unit tests PASS (boundary, extraction, equivalence, strict isolation, surface)
[PASS] G09 BEFORE vs AFTER digest: BEHAVIOR CHANGE NONE — 252 section comparisons across 18 workflows — 0 differences
[PASS] G10 strict port mode: no hidden coupling to the reference runtime
[PASS] G11 live verification — 7/7 PASS · R0..R6 all PASS

gates: 11/11 PASS · BEHAVIOR CHANGE: NONE DETECTED
```

Exactly the `9/11 → 11/11` the reviewer required. The green is not taken on faith: a new harness
(`tools/issuez027-falsify.mjs`, `npm run issuez027:falsify`) runs a **real `tsc` twice** — once on the
fixed isolated unit, once on a control copy where the normalization is undone exactly where the LEGO
sources carry `.ts`:

```text
fixed   : tsc exit 0 · 0 errors · 11 specifier(s) normalized in 4 file(s)
control : tsc exit 2 · 9 errors (first: api-error-response.ts(32,8): error TS5097 …)
verdict : CONFIRMED — green with the fix, TS5097 without it
evidence: docs/isolation/evidence/issuez027-verification.json
```

The control reproduces the reported failure verbatim (same rule, same file, same line), which is what
makes the green meaningful.

### Finding 2 — the Rust rig now really is offline-complete, measured end to end

```text
bash tools/rust-offline-rig/setup.sh      → vendored 19 crates into /tmp/rust-rig/vendor
                                            (indexmap, equivalent, hashbrown, regex, regex-automata,
                                             regex-syntax, aho-corasick added; workspace/path
                                             pointers stripped — the new rewrite rules fired in the log)
npm run rust:check-offline                → exit 0 · Finished `dev` profile in 7.15s · 7 workspace crates
npm run rust:test-offline                 → exit 0 · 37 Rust tests passed, 0 failed
                                            (n8n-workflow 19 · reference_fixtures 5 · validation 4 ·
                                             connection 2 · execution-data 2 · expression 2 ·
                                             conformance 2 · node-model 1)
```

Run against **`legacy/rust-port`** — the archived Phase-3 workspace, which is what this branch ships —
so the rig's archive pointer and the closure fix are verified together, not separately.
Evidence: `docs/isolation/evidence/rust-rig-verification.json`.

The toolchain came from npm `@rustbin` packages and the crates from upstream git tags; `crates.io` and
`rustup` were never used, so this is a genuine offline-path verification.

### Regression check on this lane after adopting foreign tooling

```text
node --test packages/workflow-lego/test/{06,07,08}-*.test.ts   → 79/79 PASS
node tools/localization-gate.mjs                               → 16/16 PASS
node tests/compatibility/contract_conformance.mjs              → 22/22 PASS
python3 tests/integration/boundary_audit.py                    → AUDIT RESULT: PASS
npm run verify:fast                                            → 10/10 PASS
```

No localization source file changed in this task: the adopted commits touch `tools/` only, and the
localization line is byte-identical to Phase 4G.

### Conflict resolution (both sides kept, nothing overwritten)

| File | Conflict | Resolution |
| :--- | :--- | :--- |
| `docs/isolation/CROSS-AGENT-ISSUES.md` | both lanes appended sections | kept **both**: `ISSUE-023` (hub/merge intelligence, this lane) and `ISSUE-027` (TS5097, other lane) |
| `package.json` | script sets diverged | merged: 20 scripts = `localization:*` (7) + `rust:*` (2) + `verify*` (4) + the rest; no name collision, no script dropped |

A process note, reported rather than hidden: the first resolution attempt committed `package.json`
**with conflict markers still in it** (the merge script aborted and the file was staged as-is). It was
caught immediately by `node -e "require('./package.json')"`, fixed and amended into the same commit —
`27fc65d9` is clean, and `npm run verify` (which reads `package.json`) is the proof.

### Boundary statement

* No counterpart lane source was edited; the two adopted commits are `cherry-pick -x` of their originals.
* `tools/workflow-isolation-gate.mjs` was **not** touched — the gate is the authority that says 11/11.
* `reference/n8n/**` untouched (G04: 15050 files, `f8da35180669d798…`), no Rust added, archive intact.
* `.runtime/` (885 packages, 642 MB) and the Rust rig live **outside version control** (`.runtime/` is
  git-ignored; the rig is `/tmp/rust-rig`); recreation is one command each
  (`npm run setup:reference`, `bash tools/rust-offline-rig/setup.sh`), documented so nothing has to be
  committed to reproduce the record.
* `live 11/11` in the VPS/docker stage is still **NOT RUN** here. G11 above is the reference-engine live
  harness (n8n 2.9.1 stack installed locally), which is a different thing and is named as such.

### Reviewer follow-up still open (not blocking, from the same review)

* **CLDR plurals** (LOW): the envelope renders one template per key, so Arabic shows the *one* form for
  `3` where CLDR wants `few` (`عناصر`), and Russian few/many are equally unhandled. The plural engine
  exists on the PR #20 lane (`selectPluralCategory` + `tp()` with `key#one/few/many/…` suffixes);
  wiring it into `ENVELOPE_DICTIONARY_EXTENSION` without touching frozen keys is the natural Phase 4I.
