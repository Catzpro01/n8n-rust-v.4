# TASK RESULT: TASK-419-isolation-gate-guard

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-4` (seat) — Arena session `arena/01a0b105-n8n-rust-v-4`
- **LEGO COMPONENT**: `integration` (repository regression gate / localization gate)
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-17 22:25 UTC`
- **BASE**: `b4818f00` (Phase 4H tip — ISSUE-027 closed, Rust rig re-verified)
- **MANIFEST**: `tasks/TASK-419-isolation-gate-guard.yaml`
- **RECORD**: `docs/isolation/localization.md` §4.7 (+ §4 row, mutation M15, §5 limitation CLOSED),
  `docs/isolation/CROSS-AGENT-ISSUES.md` → "ISSUE-027 follow-up — regression guard G16"
- **ID NOTE**: this work was claimed twice over by other lanes while it was in flight — first as
  `TASK-415` (colliding with `1dcb96b5` run-path *and* agent-7's `1f86b03e` extractor fix), then as
  `TASK-417` (colliding with Phase 4H's `TASK-417-verify-11-11-and-rust-rig`). This lane yielded both
  times and renumbered to **TASK-419**; no other lane's ids, records or files were touched. Cause:
  `dynamic_task_pool` / `task_consensus_votes` are unreadable from every sandbox (ISSUE-019, HTTP 000),
  so no worker can see another's claim. ID allocation needs an orchestrator-side fix.

---

### Why this task exists

Phase 4H closed ISSUE-027 correctly: the shared extractor fix was adopted (`cherry-pick -x 1f86b03e`) and
both directions were proven with a real `tsc` via `npm run issuez027:falsify` (exit 0 fixed / exit 2 with
9× TS5097 in the control). What that leaves open is *durability*: the falsifier is a tool somebody has to
remember to run, and the two reasons the regression was invisible in the first place are untouched by it —

1. the authoring sandbox could not compile at all (no registry access, no `node_modules`), so G06/G08 never
   executed there, and §5 honestly recorded that;
2. the localization gate reported **12/12 PASS** next to a red repository gate, because it asserted the
   extension-style import pattern (G11) without ever compiling the unit that pattern must survive.

So this task puts the check where it runs by default, re-proves it can go red against the *adopted*
extractor, and repairs the documentation that still claimed the typed checks could not run.

### Pipeline Operations Summary

| Operation | Status | Exit Code |
| :--- | :--- | :--- |
| `npm run setup:reference` (n8n-workflow/core/nodes-base 2.9.1 → `.runtime/`) | ✓ SUCCESS | `0` |
| `npm install --prefix packages/workflow-lego` (typescript 5.9.3) | ✓ SUCCESS | `0` |
| `git fetch` + `git rebase origin/arena/01a0b105-n8n-rust-v-4` (`8797d0f9` → `b4818f00`) | ✓ duplicate cherry-pick **skipped** (their `a85f51bb` is byte-identical), 7 conflicts resolved | `0` |
| `edit_file` `tools/localization-gate.mjs` — new check **G16** + `isolatedUnitCompile` evidence | ✓ SUCCESS | `0` |
| `mutation_test` **M15** (ISSUE-027 normalization write disabled, in the adopted extractor) | ✓ gate **exit 1 · FAIL 16/17**, G16 red | `1` |
| restore extractor byte-identical (`git diff` vs the adopted commit empty) | ✓ **exit 0 · PASS 17/17** | `0` |
| `npm run verify` — AFTER | ✓ **11/11 PASS · BEHAVIOR CHANGE: NONE DETECTED** | `0` |
| `sync_from_main` (25 result records, docs only) | ✓ SUCCESS | `0` |
| `read_messages` (Supabase pool) | ✗ UNREACHABLE (`HTTP 000`, ISSUE-019) | — |

---

### Ringkasan (protocol §1 — padat, dengan bukti mesin)

Phase 4H menutup ISSUE-027 dengan benar (extractor bersama diadopsi via `cherry-pick -x 1f86b03e`, dua arah
dibuktikan dengan `tsc` nyata lewat `npm run issuez027:falsify`: exit 0 dengan perbaikan, exit 2 dengan 9×
TS5097 pada kontrol), tetapi yang tersisa adalah **durabilitas**: falsifier adalah alat yang harus *diingat*
untuk dijalankan, dan dua sebab regresi ini tak terlihat sebelumnya tidak sembuh olehnya — sandbox penulis
tidak bisa mengompilasi sama sekali sehingga G06/G08 tak pernah jalan, dan gate lokalisasi melaporkan
**12/12 PASS** tepat di sebelah gate repositori yang merah karena ia meng-assert pola impor berekstensi (G11)
tanpa pernah mengompilasi unit yang harus tahan pola itu. Tugas ini memasang penjaganya di jalur yang jalan
sendiri: **check `G16`** di `tools/localization-gate.mjs`, aktif pada setiap `npm run localization:gate` /
`localization:all`, berisi audit statis bahwa setiap path `.ts` relatif berkutip di
`packages/workflow-lego/src/**` berada di salah satu dari empat posisi yang dinormalkan extractor (`from` /
bare `import` / `import()` / `require()`), **ditambah** eksekusi nyata `extract + tsc -p
.extract/tsconfig.json` (perintah yang sama dengan G06, supaya dua gate tidak bisa berbeda pendapat lagi),
dengan jumlah normalisasi dibaca dari audit **terstruktur** `.extract/rewrites.json →
legoSpecifierNormalizations` — bukan dikerok dari stdout — lalu di-cross-check terhadap jumlah yang dihitung
independen dari sumber, sehingga regresi regex di implementasi mana pun tidak bisa melaporkan "nothing to
normalize" yang menenangkan; tanpa typescript, evidence mencatat `COMPILE STAGE NOT RUN — typescript is not
installed` alih-alih lolos diam-diam. Arah-gagal diulang terhadap extractor **hasil adopsi**, bukan varian
lokal: mutasi **M15** (penulisan normalisasi dilumpuhkan, `if (false) writeFileSync(abs, after)`) membuat gate
**exit 1 · FAIL 16/17 dengan G16 merah**, dan setelah berkas dipulihkan byte-identical kembali **exit 0 ·
PASS 17/17** — jadi penjaga ini melindungi tool yang bukan milik lane ini dan akan merah di lane mana pun yang
menonaktifkan normalisasi ISSUE-027. Bukti mesin di tip hasil rebase: `npm run verify` → **11/11 PASS ·
BEHAVIOR CHANGE: NONE DETECTED** (G05 pure import rewrites PASS, G06 0 error, G07 `tsc --noEmit` 0 error,
G08 **19/19**, G09 252 perbandingan / 0 perbedaan dengan strict 218 identik + 34 seksi port terdeklarasi,
G11 live engine **7/7** R0..R6), `npm run localization:all` → **79/79 test + 17/17 gate**,
`bash scripts/run-lego-tests.sh` → **19/19**, `contract_conformance.mjs` → **22/22**, `boundary_audit.py` →
**PASS**, `npm run isolation:check` → **4/4**, dan extractor melaporkan **11 specifier `.ts` pada 4 berkas
LEGO**. Konvergensi dijaga, bukan duplikasi: lane ini sempat menulis perbaikan sejenis sendiri (tiga bentuk
specifier) sebelum `1f86b03e` terlihat di sini, varian itu **dibuang** saat rebase (commit cherry-pick lane ini
menjadi kosong dan di-skip karena `a85f51bb` di basis byte-identical), sehingga satu tool bersama punya satu
implementasi dan kontribusi lane ini hanyalah penjaga di atasnya; tidak ada berkas di
`packages/workflow-lego/src/**`, `packages/workflow-lego/test/**`, `reference/n8n/**`, `packages/frontend/**`,
`crates/**`, `apps/**`, atau `packages/reconstructed-engine/**` yang diubah. Dokumentasi yang sudah tidak
benar ikut diperbaiki: §5 masih mengklaim `tsc --noEmit` tidak bisa dijalankan di sandbox ini — klaim itu
kini **CLOSED** dengan bukti (typescript 5.9.3 terpasang, G06/G07/G16 jalan nyata), tabel §4 bertambah baris
G16 dan gate 16/16 → **17/17**, tabel mutasi bertambah **M15**, dan §4.7 baru menjelaskan mengapa probe
sekali jalan tidak cukup. Terakhir, 25 rekaman `results/*.md` yang dimiliki `origin/main` (`1c4965a2`) tetapi
tidak dimiliki branch ini disinkronkan byte-identical (SWARM-PHASE4-06..10, SWARM-ROUND3-01..15,
SWARM-ROUND4-01..05) — 24 path `crates/**` + `Cargo.toml` yang juga hanya ada di main **sengaja tidak**
disinkron karena itu disposisi Rust yang sudah diarsip reversibel di TASK-413 (`legacy/rust-port/`, guard
hijau) dan sedang menunggu arbitrase orchestrator (A4-MSG-05 / ISSUE-023).

---

### Reproduce

```bash
npm run setup:reference                            # .runtime/ — n8n-workflow/core/nodes-base 2.9.1 (≈80 s)
npm install --prefix packages/workflow-lego        # typescript 5.9.3 — tanpa ini G06/G07/G16 tidak jalan
npm run verify                                     # 11/11 PASS · BEHAVIOR CHANGE: NONE DETECTED
npm run localization:all                           # 79/79 tests + 17/17 gate (G16 termasuk)
node tools/workflow-isolation-extract.mjs          # ".ts-ext normalized : 11 specifier(s) across 4 LEGO file(s) (ISSUE-027)"
npm run issuez027:falsify                          # Phase 4H's one-off proof — still green/red as recorded
bash scripts/run-lego-tests.sh                     # 19/19
node tests/compatibility/contract_conformance.mjs  # 22/22
python3 tests/integration/boundary_audit.py        # PASS
npm run isolation:check                            # 4/4
```

Fail direction (M15), against the adopted extractor:

```bash
# disable the ISSUE-027 normalization write, then:
node tools/localization-gate.mjs --quiet           # FAIL (16/17) — G16 red · exit 1
git checkout <adopted-commit> -- tools/workflow-isolation-extract.mjs
node tools/localization-gate.mjs --quiet           # PASS (17/17) · exit 0
```

### Deliverables

| Path | Change |
| :--- | :--- |
| `tools/localization-gate.mjs` | new check **G16** (static four-form specifier audit + real `extract`/`tsc` run + count cross-check against the extractor's structured audit + loud `COMPILE STAGE NOT RUN`), evidence field `isolatedUnitCompile` (incl. `normalizationsByFile` and ISSUE-027 provenance), header doc lists G12–G16. Gate is now **17** checks. |
| `docs/isolation/localization.md` | §4 evidence row for G16 + gate count 16/16 → 17/17; §4.1 mutation **M15**; new **§4.7** (why a one-off falsification is not enough, what G16 enforces, convergence not duplication, coordination note); §5 `tsc could not run` limitation **CLOSED**; status header M1–M15. |
| `docs/isolation/CROSS-AGENT-ISSUES.md` | "ISSUE-027 follow-up — regression guard G16" appended; their ISSUE-027 closure and ISSUE-023 follow-up kept verbatim (both sides of the append-point conflict). |
| `docs/isolation/evidence/localization-gate.json`, `gate-report.json`, `live-verification.json`, `model-digest.comparison.json`, `docs/isolation/workflow-verification.md` | regenerated by the AFTER runs on the rebased head (11/11, 17/17). |
| `results/SWARM-PHASE4-06..10.md`, `results/SWARM-ROUND3-01..15.md`, `results/SWARM-ROUND4-01..05.md` | 25 audit-trail records synced byte-identical from `origin/main` (`1c4965a2`); the 24 main-only `crates/**` + `Cargo.toml` paths deliberately **not** synced (TASK-413 archive, arbitration pending). |
| `docs/isolation/validation-bus-outbox.json` | envelopes **A4-MSG-04** (verification request, renumbered TASK-419), **A4-MSG-05** (review sweep + Rust-track arbitration), **A4-MSG-06** (answer to agent-7's ISSUE-027 request on PR #19). |
