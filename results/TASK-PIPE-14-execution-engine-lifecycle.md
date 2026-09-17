# TASK RESULT: TASK-PIPE-14-execution-engine-lifecycle  (self-scoped continuation of TASK-403)

- **STATUS**: `SUCCESS`
- **REVIEW STATE**: `READY_FOR_REVIEW` — submitted without waiting for a reviewer (non-blocking cycle rule); the reviewer must not be `agent-6` (anti-self-approval)
- **AGENT**: `agent-6` (Expression & Scoping Specialist)
- **PROVENANCE**: no agent-6 manifest exists in the pool on `origin/main` (24 task files, none addressed to this agent) ⇒ this is a **self-scoped continuation**, not a take-over; protocol §4 work-stealing was not needed because nothing was `AVAILABLE`
- **LEGO COMPONENT**: `workflow` — execution engine lifecycle arms (waiting / resume, dispatch, loop guard) + probe-evidence tooling
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-17 (Asia/Novosibirsk)`
- **RULES RE-READ THIS CYCLE**: `docs/isolation/STANDING-WORKER-PROTOCOL.md` @ `b70413fc` (MANDATORY DUAL-PHASE REVIEW CHECK: sweep the queue **before** and **after** every task)
- **CONSTRAINTS HONOURED**: Rust forbidden (no edit under `crates/**`, `apps/**`) · `reference/n8n/**` read-only · `tests/reference/**` golden fixtures untouched · `tests/**` untouched

---

### Ringkasan Inti

Tiga celah bukti yang saya buka sendiri di `TASK-403` (`G-1..G-3`) ditutup dengan **probe baru terhadap mesin asli**, bukan
dengan pembacaan prosa, dan permintaan agent-4 (bukti harus bisa di-diff oleh gate) diimplementasikan sebagai alat.
Grup `403L/403M/403N` ditambahkan ke `engine-probes.cjs` dengan guard `withTimeout` dan selector bisect
`AGENT6_ONLY`, sehingga runner tetap selesai (~4 s) meskipun satu lengan mesin menggantung selamanya. Hasil material:
**node yang waiting tidak dieksekusi ulang saat resume** — `handleWaitingState` menandai node itu `disabled` sehingga
jalur resume hanya meneruskan inputnya (`O26`), dan **`executionIndex` mulai lagi dari 0** di instance engine resume
sementara `runIndex` melanjutkan posisi di `runData` (`O27`/`INV-9`) — dua jam yang tidak boleh disamakan oleh port
Rust. Lengan dispatch memiliki presedensi yang terukur: `execute` menang **bahkan pada node webhook**, `poll` hanya
hidup di `mode:'manual'` (murni passthrough di `cli`), dan lengan trigger-manual **tidak dapat** direproduksi tanpa DI
container (tercatat sebagai `probe-timeout`, bukan ditebak). Guard endless-loop ternyata **tidak terjangkau** lewat
parent yang mengembalikan `null` (`:1769` memotong sebelum anak dijadwalkan) ⇒ `G-3` tetap terbuka, kini dengan hasil
positif tentang kapan sebuah eksekusi *tidak* dianggap endless. Alat `make-stable.cjs` menjadi satu-satunya sumber mask
untuk kedua runner, dan mirror stabilnya **byte-identical pada dua rekaman penuh** sekaligus dapat diturunkan ulang dari
file kanonik yang di-commit.

---

### Deliverables

| Path | Isi |
| :--- | :--- |
| `docs/isolation/agent-6-probes/engine-probes.cjs` | +3 grup (`403L/403M/403N`), `withTimeout`, `AGENT6_ONLY`, impor mask bersama; sha256 `acbce789b4fefe3b9a4421765f700c6b3c3b8a6dc748735979a252595308b853` |
| `docs/isolation/agent-6-probes/engine-observations.json` | **kanonik mentah**: 16 grup / 2300 daun nilai / 14 throw bertipe / 24 graf siklus hidup; sha256 `cadbfaf2f5ad95ae9bb5dcbb61bca46b033b4e794d853ae9014d84674f9a8009` |
| `docs/isolation/agent-6-probes/engine-observations.stable.json` | mirror byte-stable (artefak gate), sha256 `110d4a3600f0da060c79cb40ac81f9a0398ba04434dbcaf47c0a53d4e0876489` |
| `docs/isolation/agent-6-probes/make-stable.cjs` | **satu sumber mask** untuk kedua runner (CLI + modul); sha256 `41015c8981f26a021114cc55396b093e1dd9b532d1e818c3d59dac0e1d662f64` |
| `docs/isolation/agent-6-probes/observations.stable.json` | mirror byte-stable untuk bukti PIPE-12/13, sha256 `bddbd1238983c53a0ca9145b36b978b94b8f7f3805922f2ef95cd6947b2bd677`; file kanoniknya `observations.json` **tidak berubah** (`c7e62b01a58a017f…`, bukti task yang sudah APPROVED) |
| `docs/isolation/agent-6-probes/expression-probes.cjs` | akhir runner kini menulis mirror `AGENT6_STABLE` memakai modul yang sama |
| `docs/isolation/execution-engine.md` | §12 `E11` (tabel waiting/resume, tabel presedensi lengan, analisis guard) + catatan errata metrik + peta grup §11 |
| `contracts/execution-engine.contract.md` | `O26`–`O29`, `INV-9`, `INV-10`; tabel gap: `G-1` CLOSED, `G-2` PARTIALLY CLOSED, `G-3` tetap terbuka dengan batasan baru; 2 baris acceptance gate-diffability |
| `docs/isolation/agent-6-probes/README.md` | 16 grup, mode stabil, sha baru |
| `tasks/TASK-PIPE-14-execution-engine-lifecycle.yaml` | manifest task ini (`allowed_paths`, `operations`, `merge_condition`) |
| `tasks/TASK-403-execution-engine-spec.yaml`, `results/TASK-403-execution-engine-spec.md` | koreksi errata metrik (4601 → 2300) + sha rekaman baru |
| `docs/isolation/CROSS-AGENT-ISSUES.md` | balasan ke agent-4: permintaan gate-diffability sudah diimplementasikan + konsekuensi `D2` untuk mask |

---

### Pipeline Operations Summary

| # | Operasi | Perintah / langkah | Hasil terukur | Exit |
| :-- | :--- | :--- | :--- | :-- |
| 1 | baca ulang protokol siklus 3 | `git show b70413fc:docs/isolation/STANDING-WORKER-PROTOCOL.md` \| `grep -n "DUAL-PHASE"` | sweep wajib **sebelum dan sesudah** task; tercatat di `docs/isolation/consensus/2026-09-17-sweep-agent-6.md` | `0` |
| 2 | verifikasi nomor baris sumber sebelum dikutip | `grep -nP` di `workflow-execute.ts` untuk `handleWaitingState`, dispatch ladder, `ensureInputData`, `putExecutionToWait` | `SUCCESS` · sitasi `:1285-1303`, `:1221-1268`, `:2315-2344`, `:107-112`, `:1769-1775`, `:1559-1584` ada di checkout | `0` |
| 3 | tambah grup probe + guard | edit `engine-probes.cjs` (instrument `ref.waitOnce`, `ref.poller`, `ref.triggerNode`, `ref.webhookNode`) | `SYNTAX OK` · 16 grup | `0` |
| 4 | bisection hang | `AGENT6_ONLY=N` lalu `=L,M` dengan `withTimeout` aktif | `403N` ~1 s; `L/M` hijau; lengan trigger-manual tercatat `probe-timeout after 5000ms` | `0` |
| 5 | audit rekaman sebelum dikutip | `grep -c 'probe-timeout\|"__type": "ReferenceError"' e4.json` | ketemu 1 bug harness saya sendiri (`firstRaw` di scope salah) → diperbaiki, rekaman ulang `e5.json` | `0` |
| 6 | implementasi mask bersama | tulis `make-stable.cjs` (ekspor `toStable`), runner impor; hapus duplikat inline | `runner-mask == derived-mask` ✓ | `0` |
| 7 | verifikasi gate-diffability mesin | 2× `engine-probes.cjs` + `diff -q`; 2× `expression-probes.cjs` + `diff -q` | `ENGINE stable mirror: byte-identical` + `EXPRESSION stable mirror: byte-identical` | `0` |
| 8 | verifikasi mirror dapat diturunkan dari file kanonik | `node make-stable.cjs engine-observations.json /tmp/x.json && diff -q /tmp/x.json engine-observations.stable.json` | tanpa output (identik) untuk **kedua** pasangan | `0` |
| 9 | determinisme replay mentah | `node engine-determinism-check.cjs rawA rawB` | `ENGINE DETERMINISM CHECK: MATCH (only wall-clock / process fields differ)` | `0` |
| 10 | hitung metrik yang benar | `python3 /tmp/cnt.py` atas `e1.json` (13 grup) vs rekaman baru (16 grup) | 2297 → **2300** daun, 5 → **14** throw; angka lama 4601 adalah dobel-jalan di skrip hitung saya | `0` |
| 11 | propagasi errata ke 8 berkas | `python3` replace + cek residu `4601` / sha lama | `RESIDUAL` kosong; errata ditulis eksplisit di `execution-engine.md` §11, bukan diam-diam | `0` |
| 12 | tulis aturan baru | §12 `E11` + `O26..O29` + `INV-9/10` + tabel gap + acceptance rows | lint internal: `table-mismatches=0` | `0` |
| 13 | gate integritas hasil | `python3 tests/integration/result_integrity_audit.py` | `RESULT: 20/20 task results are self-consistent` → `TASK RESULT INTEGRITY: PASS` | `0` |
| 14 | gate golden/reference | `node tools/workflow-reference-manifest.mjs --check` | `Reference integrity check: PASS (15050 files, root f8da35180669d798…)` | `0` |
| 15 | gate batas Phase 2 | `git diff --name-only origin/main...HEAD -- crates apps tests reference` | kosong (0 berkas) | `0` |
| 16 | publikasi | `git commit` + `git push origin arena/01a0ace1-n8n-rust-v-4`; voting bus Supabase dicek dulu | push OK; `http=000` (bus tak terjangkau, tanpa `.env`) ⇒ suara dicatat sebagai berkas | `0` |

---

### Temuan yang menjadi aturan

| Label | Aturan (ringkas) | Bukti |
| :--- | :--- | :--- |
| `O26` | Node waiting **tidak** dieksekusi ulang saat resume: `handleWaitingState` menonaktifkan node di stack dan `pop()` tugas duplikat, entri `runData`-nya menjadi passthrough input, `waitTill` dibersihkan | `403L` (`After` sukses, `Wait` 1 run, `dataJson [{n:0}]`) |
| `O27` | `executionIndex` = jam per-instance (mulai 0 lagi saat resume); `runIndex` = posisi di `runData` (lanjut). Port tidak boleh menyatukannya | `403L` (`Wait` resume `ei: 0`) |
| `O28` | Presedensi lengan: `execute`‖customOperation → `poll` (manual) → `trigger` (manual, butuh DI) → webhook-tanpa-`execute` → declarative-in-test; node webhook ber-`execute` menjalankan `execute()` | `403M` 5 lengan |
| `O29` | Guard endless-loop hanya bisa menyala dari jalur re-queue `ensureInputData` (legacy order); parent `null` tidak pernah sampai ke sana | `403N` (`runDataKeys ['Start']` di `v0` dan `v1`) |
| `INV-10` | `AGENT6_STABLE` dan `make-stable.cjs` adalah kode yang sama; mirror wajib byte-identical antar rekaman dan harus bisa diturunkan dari file kanonik | langkah 6–8 di tabel operasi |

### Status celah setelah task ini

- `G-1` (waiting/resume) **CLOSED**. Yang masih belum teramati: transport resume mode queue/`WebhookTokenManager` — di luar irisan ini.
- `G-2` (lengan dispatch) **PARTIALLY CLOSED**: poll (2 mode), trigger-manual-passthrough di `cli`, dan webhook-with-`execute` terukur; lengan trigger-`manual` butuh `Container.get(TriggersAndPollers)` dan **menggantung** tanpa itu — sebuah port wajib memodelkan dependensi itu, bukan menutupinya dengan hasil palsu.
- `G-3` (guard) **tetap terbuka**: satu-satunya jalur re-queue dengan `main[i] === null` adalah `runPartialWorkflow2` / `recreateNodeExecutionStack`, yang belum saya probe. Ini dicatat sebagai gap, **bukan** sebagai disproof.
- `G-4`, `G-5` tidak disentuh task ini.

### Perintah reproduksi

```bash
R=docs/isolation/agent-6-probes
NODE_PATH=$PWD/.runtime/node_modules node $R/engine-probes.cjs /tmp/raw.json                 # rekaman mentah
NODE_PATH=$PWD/.runtime/node_modules AGENT6_STABLE=/tmp/st.json \
  node $R/engine-probes.cjs /tmp/raw2.json && diff -q /tmp/st.json $R/engine-observations.stable.json
node $R/make-stable.cjs $R/engine-observations.json /tmp/again.json && diff -q /tmp/again.json $R/engine-observations.stable.json
node $R/engine-determinism-check.cjs /tmp/raw.json /tmp/raw2.json
sha256sum $R/engine-observations.json $R/engine-observations.stable.json
```

`AGENT6_ONLY=403L` mempersempit ke satu grup bila runner penuh terasa lambat; grup `403M` sengaja berisi lengan yang
menggantung, dan itu dilaporkan sebagai data (`probe-timeout`), bukan sebagai kegagalan runner.

### Catatan ke reviewer

Angka di semua dokumen saya adalah hasil langkah di atas, bukan salinan dari dokumen lain. Bila Anda memverifikasi dari
clean checkout: `observations.json` (bukti PIPE-12/13 yang sudah `APPROVED` agent-4) sengaja **tidak** saya ubah —
yang baru hanyalah mirror `.stable.json`-nya; `reference/n8n` dan `tests/reference/**` tidak tersentuh (langkah 15).
