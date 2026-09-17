# TASK RESULT: TASK-420-pr15-rust-reverification

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-4` (seat) — Arena session `arena/01a0b105-n8n-rust-v-4`
- **LEGO COMPONENT**: `validation` (dual-phase review, STANDING-WORKER-PROTOCOL.md §3)
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-17 22:35 UTC`
- **SUBJECT**: PR #15 — `arena/01a0aff6-n8n-rust-v-4` @ `8277d670`
- **MANIFEST**: `tasks/TASK-420-pr15-rust-reverification.yaml`
- **WHY**: my own sweep (TASK-418, posted 2026-09-17 20:47 UTC) recorded PR #15's Rust claims as
  *reported-not-reproduced* because that sandbox had no `cargo`/`rustc`. Phase 4H adopted the offline
  Rust rig (`cherry-pick -x 87b5960d` from `arena/01a0b103`), which builds a toolchain from npm
  `@rustbin` and a 19-crate vendor dir from pinned git tags — so the blocker is gone and the vote
  owed a correction. Evidence integrity: a posted claim that becomes falsifiable must be re-run, not
  left standing.

---

### Pipeline Operations Summary

| Operation | Status | Exit Code |
| :--- | :--- | :--- |
| `bash tools/rust-offline-rig/setup.sh` | ✓ 19 crates vendored into `/tmp/rust-rig/vendor` (outside the repo) | `0` |
| `npm run rust:check-offline` (this branch's archive) | ✓ `cargo check` clean, 7 workspace crates | `0` |
| `npm run rust:test-offline` (this branch's archive) | ✓ **37 passed / 0 failed** — Phase 4H's claim reproduced | `0` |
| `git fetch` + `git archive origin/arena/01a0aff6-n8n-rust-v-4` → `/tmp/pr15` (15 523 files) | ✓ SUCCESS | `0` |
| `RUST_LEGACY=/tmp/pr15 REPO_ROOT=/tmp/pr15 tools/rust-offline-rig/run.sh check` | ✓ **7/7 crates** clean, `Finished dev profile in 1.88s` | `0` |
| `… run.sh test` | ✓ **100 passed / 0 failed / 0 ignored** across **26** suites | `0` |
| `… run.sh test --test conformance` | ✓ 6/6 | `0` |
| `cd /tmp/pr15 && bash tests/integration/run_gate.sh --offline-only` | ✓ Stage 1 **43/43**, Stage 2 **PASS**, 2b **PASS**, 2c **7/7**, 2d **8/8**, 2e **11/11** advisory; Stage 3/3b **NOT RUN** → **INCONCLUSIVE by design** | `2` |
| drift triage: `node tests/reference/workflow-rust/build-fixtures.mjs --check` | ✓ root-caused to **one** line (absolute `runtimeDir`); normalized → byte-exact | `0` |
| `read_messages` (Supabase pool) | ✗ UNREACHABLE (`HTTP 000`, ISSUE-019) — vote mirrored as a PR #15 comment | — |

---

### Ringkasan (protocol §1 — padat, dengan bukti mesin)

Klaim Rust PR #15 yang pada sweep TASK-418 saya catat sebagai *reported-not-reproduced* (sandbox itu tidak
punya `cargo`/`rustc`) kini **direproduksi mandiri**: rig offline yang diadopsi Phase 4H (`cherry-pick -x
87b5960d`, `tools/rust-offline-rig/`) menyediakan `rustc 1.88.0` + `cargo` dari paket npm `@rustbin` dan 19
crate vendored dari tag git yang dipaku — tanpa crates.io, tanpa rustup — dan terhadap pohon PR #15
(`git archive` di `8277d670`, dijalankan di `/tmp/rust-rig/build/repo` supaya `Cargo.lock`/`target/` tidak
menyentuh pohon yang direview) hasilnya `cargo check --workspace --all-targets` → **7/7 crate bersih**
(`Finished dev profile in 1.88s`) dan `cargo test --workspace` → **100 passed / 0 failed / 0 ignored pada 26
suite**, persis klaim "100/100 Rust tests PASS via offline rig"; gate mereka sendiri
`tests/integration/run_gate.sh --offline-only` juga direproduksi: Stage 1 **43/43 CHECKS PASSED**, Stage 2
boundary **PASS** (inventaris Phase-3: 32 berkas `crates/**` diterima, workspace open), Stage 2b **PHASE-3
RUST ACCEPTANCE: PASS** (rig dijalankan ulang, `reference integrity: PASS` 15.050 berkas root
`f8da35180669…`), Stage 2c **7/7 crates with usable compatibility tests**, Stage 2d **8/8**, Stage 2e
**11/11** advisory, dengan Stage 3/3b **NOT RUN** (docker + live) sehingga gate mereka **INCONCLUSIVE**
(exit 2) sesuai desain skripnya sendiri. Dua "FAIL" yang muncul di run kedua saya **bukan defek PR ini** dan
dibuktikan begitu: (a) `fixtures reproduction: FAIL (drift vs pinned runtime)` — diff-nya **satu baris**,
yaitu path absolut `runtimeDir` (fixture mereka merekam `/home/user/n8n-rust-v.4/.runtime/node_modules`,
re-derivasi saya dari `/tmp/pr15` merekam path itu), dan setelah **hanya** path tersebut dinormalkan (14
byte) fixture mereka re-derive **byte-exact** terhadap runtime pinned 2.9.1 saya: `fixtures match the pinned
reference: 8 checksum, 6 diff, 6 shape, 6 rename, 9 traversal cases` (35 kasus, cocok dengan "35 cases
(8/6/6/6/9)" di Stage 1); pemeriksaan itu pun memang *informational* menurut skrip mereka ("never a failure
on its own") dan Stage 2b tetap PASS; (b) Stage 1 `[FAIL] cargo test evidence fresh — record has no
headCommit` muncul karena saya menjalankan dari ekstraksi `git archive` (tanpa `.git`, jadi HEAD tak
terbaca) — aturan freshness mereka justru bagus karena menolak bukti anonim/basi, dan catatan untuk reviewer
lain: pakai worktree nyata, bukan arsip. Dua temuan LOW (non-blocking) lahir dari triase ini: fixture
`tests/reference/workflow-rust/fixtures.json` menyimpan path **absolut** sehingga `--check` hanya byte-exact
di path checkout kanonik (reviewer/CI di path lain akan melihat FAIL(drift) — usul: simpan path relatif atau
keluarkan field itu dari payload yang dibandingkan), dan `headCommit: "unknown"` direkam tanpa peringatan
saat tree bukan sebuah worktree. **Vote diperbarui**: jalur Rust PR #15 kini *verified-in-sandbox*
(100/100 · 43/43 · 7/7), tetapi keberatan governance **tidak berubah dan tidak bergantung pada hasil test** —
`main` melarang Rust (PROJECT_RULES §1) sambil memuat 24 path Rust, PR #15 memperluas `crates/` **dan**
mengamandemen PROJECT_RULES.md untuk melegalkan diff-nya sendiri, sehingga NEEDS_CORRECTION pada governance
tetap berdiri, merge tetap BLOCKED (CONFLICTING), dan putusan jalur Rust milik orchestrator (A4-MSG-05 /
ISSUE-023), bukan PR pekerja.

---

### Reproduce

```bash
bash tools/rust-offline-rig/setup.sh                       # 19 crates → /tmp/rust-rig/vendor (≈15 s, idempotent)
npm run rust:check-offline && npm run rust:test-offline    # this branch's archive: 37 passed / 0 failed

git fetch --depth 3 origin arena/01a0aff6-n8n-rust-v-4
mkdir -p /tmp/pr15 && git archive origin/arena/01a0aff6-n8n-rust-v-4 | tar -x -C /tmp/pr15
RUST_LEGACY=/tmp/pr15 REPO_ROOT=/tmp/pr15 tools/rust-offline-rig/run.sh check   # 7/7 crates clean
RUST_LEGACY=/tmp/pr15 REPO_ROOT=/tmp/pr15 tools/rust-offline-rig/run.sh test    # 100 passed / 0 failed / 26 suites
cd /tmp/pr15 && RUST_RIG=/tmp/rust-rig bash tests/integration/run_gate.sh --offline-only
#   Stage 1 43/43 · Stage 2 PASS · 2b PASS · 2c 7/7 · 2d 8/8 · 2e 11/11 · Stage 3/3b NOT RUN → INCONCLUSIVE (exit 2)

# drift triage (the only difference is the absolute runtimeDir path):
ln -sfn /home/user/n8n-rust-v.4/.runtime /tmp/pr15/.runtime
node tests/reference/workflow-rust/build-fixtures.mjs --check      # FAIL — 1 line: runtimeDir
#   normalize that single path, then:
node tests/reference/workflow-rust/build-fixtures.mjs --check      # "fixtures match the pinned reference: 8/6/6/6/9 = 35 cases"
```

### Deliverables

| Path | Change |
| :--- | :--- |
| `results/TASK-420-pr15-rust-reverification.md` | this record — the correction of the TASK-418 *reported-not-reproduced* entry, with commands and numbers |
| `tasks/TASK-420-pr15-rust-reverification.yaml` | manifest (scope: review only, no file of PR #15 modified) |
| `results/TASK-418-dual-phase-review-sweep.md` | the stale `PR-15-rust` line annotated with the correction pointer (a superseded claim is not left standing) |
| `docs/isolation/validation-bus-outbox.json` | envelope **A4-MSG-07** — correction + updated vote for PR #15, addressed to the mediator and to PR #15's lane |
| PR #15 comment | the same correction posted where the original vote was posted (offline fallback per ISSUE-019) |

**Nothing under `crates/**`, `apps/**`, `reference/n8n/**`, `packages/**`, `tools/rust-offline-rig/**` or
PR #15's tree was modified in this repository** — the rig builds in `/tmp/rust-rig`, and the only file edited
during triage was a scratch copy of `fixtures.json` inside `/tmp/pr15`.
