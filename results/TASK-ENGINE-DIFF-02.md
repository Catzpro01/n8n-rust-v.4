# TASK RESULT: TASK-ENGINE-DIFF-02

- **STATUS**: `SUCCESS`
- **AGENT**: `arena-worker`
- **LEGO COMPONENT**: `integration` (differential closure across `packages/execution-engine` + `packages/reconstructed-engine`)
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-17 15:45:00 UTC` (rebased onto `c0fc18f9`, final tree `29f57321`+)

---

### Summary (3–5 kalimat)

Ketiga divergensi `TASK-ENGINE-DIFF-01` (`19 agree / 5 diverge`) ditutup dengan bukti baris sumber: **S6** — `getMainOutputCount(description, node)` kini mengikuti aturan umum `NodeHelpers.getNodeOutputs` (`node-helpers.ts:1146-1181`): output error **selalu** di-append saat `onError === 'continueErrorOutput'`, jadi jumlah output = `declared + 1` (node dua-output → tiga; bukan kasus khusus “minimal dua”), `getNodeOutputs` diekspor dan diuji, dan E2E split memakai fixture **satu output** — fixture dua-output itulah yang menyembunyikan bug `main:[[]]`. **S3** — kedua engine tidak lagi mengarang nilai: key `finished` **absen** pada error stop, persis objek yang dikembalikan `getFullRunData()` (`workflow-execute.ts:2452-2461`) yang hanya diberi nilai di cabang sukses (`:2429-2440`); `waitTill` juga hanya muncul saat waiting. **S7** — pass-through node `disabled` (`handleDisabledNode` `:909-920`, dipanggil `:1199`) dikonfirmasi dua implementasi independen (varian *early-continue* milik task ini dan varian *shared-tail* `TASK-ENGINE-DISABLED-01`); hasil merge memakai varian shared-tail yang identik perilakunya, dan task prototipe kini membawa `hints: []` seperti `taskStartedData` (`:1506-1511`). Hasil akhir di tree ter-merge: `DIFFERENTIAL: 24 agree / 0 diverge / 0 not-comparable (0 harness errors)`, suite `40/40` (execution) dan `28/28` (prototipe), gate `9/9`, konformansi `42/42`, boundary `PASS`. Tidak ada berkas `reference/n8n/**`, `crates/**`, `apps/**`, atau frontend yang disentuh.

### Evidence

- `node tools/engine-differential.mjs` → `DIFFERENTIAL: 24 agree / 0 diverge / 0 not-comparable across 24 comparisons (0 harness errors)` (sebelum: `19 agree / 5 diverge`)
- `node --test packages/execution-engine/test/*.test.mjs` → `# pass 40, # fail 0` (POOL-003: split fixture satu-output + unit test `getMainOutputCount`/`getNodeOutputs` + assertion `finished` absen saat error stop; 7 test sandbox `04-expression-sandbox` milik peer tetap hijau)
- `node --test packages/reconstructed-engine/*.test.mjs` → `# pass 28, # fail 0` (termasuk test pass-through node disabled dan `error-policy.test.mjs` yang kini menegaskan `finished === undefined` dengan sitasi)
- `node tools/execution-engine-gate.mjs` → `Execution LEGO gate: 9/9 PASS`, `E07 POOL-003 … 12 pass / 0 fail`, `E08 … 49 exported symbols documented`, `E09 … 7 pass / 0 fail`
- `npm run verify:all` → exit `0` (`isolation:check` + `reconstructed-engine:test` 28/28 + `execution:gate` 9/9)
- `node tests/compatibility/contract_conformance.mjs` → `RESULT: 42/42 CHECKS PASSED` (exit 0)
- `python3 tests/integration/boundary_audit.py` → `AUDIT RESULT: PASS` (exit 0)

### Per-divergence closure

| # | Sebelum (DIFF-01) | Akar masalah (baris sumber) | Perbaikan yang mendarat | Bukti |
| :--- | :--- | :--- | :--- | :--- |
| S6 | reconstruction kehilangan seluruh data split: `Mixed.main = [[]]`, `Sink/ErrSink = undefined` | `getMainOutputCount(description)` tidak melihat `node.onError`, padahal `getNodeOutputs` menambahkan output error saat `continueErrorOutput` (`node-helpers.ts:1146-1181`) | `getMainOutputCount(description = {}, node = null)` → `declared + 1` untuk `continueErrorOutput`; ekspor baru `getNodeOutputs()`; callsite oper loop mengirim `executionData.node`; kontrak menjadi 49 simbol | S6 `AGREE` (success + error branch json); unit test `['main','main']` → 3; E2E satu-output |
| S3 | prototipe `finished=false`, reconstruction `finished=true` | `fullRunData.finished = true` hanya di cabang tanpa error/`waitTill` (`:2429-2440`); `getFullRunData()` (`:2452-2461`) tidak punya field itu | kedua engine tidak menyetel `finished` sama sekali pada error stop (`finished: true` tetap di jalur sukses, `waitTill` di jalur waiting) | S3 `AGREE`; assertion `Object.hasOwn(run,'finished') === false` |
| S7 | prototipe melewati node disabled sehingga anak-anaknya kelaparan | `handleDisabledNode` mengembalikan `[inputData.main[0]]` (`:909-920`, dipanggil `:1199`) | dua implementasi independen; yang mendarat = varian shared-tail `TASK-ENGINE-DISABLED-01` (disabled node lewat `invoke` yang sama sehingga R3/R7/R6/assign tetap berlaku); task membawa `hints: []` (`:1506-1511`) | S7 `AGREE` (task pass-through + item downstream); test regresi di kedua sisi |

### Rekonsiliasi pasca-rebase (dua kali)

Dua worker lain mengerjakan himpunan divergensi yang sama saat commit ini masih lokal
(`f79dc9bc` TASK-ENGINE-CONSOLIDATE-01, `82e5c6ba` TASK-ENGINE-DISABLED-01). Rebase dijalankan
dua kali (`f79dc9bc`/`ef740e66`, lalu `c0fc18f9` dari merge `cbbb17b1`+`f3a0fc16`); hasilnya satu
implementasi per perilaku, bukan tiga tumpukan:

1. **S6** — resolusi konflik memakai aturan umum `declared + 1` (dan ekspor `getNodeOutputs`), bukan
   kasus khusus `count >= 2`; ini satu-satunya perubahan engine yang tersisa dari task ini.
2. **S3** — memakai bentuk paling ketat: key `finished` absen, bukan `false` eksplisit; prototipe
   ikut disamakan (`runner.mjs` + `error-policy.test.mjs`) sehingga harness membandingkan nilai yang
   identik.
3. **S7** — blok *early-continue* milik task ini dibuang saat rebase kedua; yang mendarat adalah
   varian shared-tail `TASK-ENGINE-DISABLED-01`. Konflik deklarasi `receivedItems`/`runIndex` dari
   rebase diperbaiki manual (dua deklarasi hilang saat resolusi; dipulihkan sebelum verifikasi).
4. **Harness** — proyeksi `taskShape` yang sempat diajukan task ini **dibatalkan** demi proyeksi
   semantik yang ditambahkan lane DISABLED-01 pada baris S7 yang sama (`present`/`status`/data json
   + json downstream). Satu instrumen, dikelola satu lane, tahan terhadap task yang hilang dan
   terhadap jam-dinding. `tools/engine-differential.mjs` pada tree final sepenuhnya milik lane itu.
5. **Kontrak** — `contracts/execution.contract.md` mendapat simbol ke-49 (`getNodeOutputs`) dan §7
   delta 1 ditulis ulang: sandbox `node:vm` berbatas (`expression-sandbox.mjs`, gate `E09`) sudah
   ada, sementara kalimat lama masih berbunyi “JEXL sandbox is not reconstructed yet” — temuan
   review sweep di bawah.

---

### Pipeline Operations Summary

| Operation | Status | Exit Code |
| :--- | :--- | :--- |
| `read_reference` (node-helpers.ts 1146-1181) | ✓ SUCCESS | `0` |
| `read_reference` (workflow-execute.ts 909-920, 1178-1199, 1506-1511, 1760-1820, 2429-2461) | ✓ SUCCESS | `0` |
| `edit_file` (execution-engine: workflow-execute.mjs getNodeOutputs + getMainOutputCount(node)) | ✓ SUCCESS | `0` |
| `edit_file` (execution-engine: index.mjs exports) | ✓ SUCCESS | `0` |
| `edit_file` (execution-engine: test/03 single-output split fixture + helper unit test + finished assertion) | ✓ SUCCESS | `0` |
| `edit_file` (reconstructed-engine: error-policy.test.mjs `finished === undefined` + sitasi) | ✓ SUCCESS | `0` |
| `edit_file` (reconstructed-engine: runner.test.mjs test pass-through node disabled) | ✓ SUCCESS | `0` |
| `edit_file` (contracts/execution.contract.md: simbol ke-49 + §7 delta 1 + status 40/40) | ✓ SUCCESS | `0` |
| `edit_file` (README.md + docs/isolation/execution.md: 40/40 · 9/9) | ✓ SUCCESS | `0` |
| `run_shell` (execution suite 40/40) | ✓ SUCCESS | `0` |
| `run_shell` (prototype suite 28/28) | ✓ SUCCESS | `0` |
| `run_shell` (differential 24 agree / 0 diverge) | ✓ SUCCESS | `0` |
| `run_shell` (`npm run verify:all`) | ✓ SUCCESS | `0` |
| `run_shell` (contract_conformance 42/42) | ✓ SUCCESS | `0` |
| `run_shell` (boundary_audit PASS) | ✓ SUCCESS | `0` |
| `edit_file` (docs/isolation/CROSS-AGENT-ISSUES.md addendum + rekonsiliasi) | ✓ SUCCESS | `0` |
| `write_file` (results/TASK-ENGINE-DIFF-02.md) | ✓ SUCCESS | `0` |

### Detailed Logs

#### Operation: `run_shell` (differential, tree final)

```text
S1 linear happy path                 AGREE (3/3)
S2 retry then success                AGREE (3/3)
S3 retry exhausted → stop            AGREE (7/7)  — `finished` absen di kedua engine
S4 continueRegularOutput passthrough AGREE (3/3)
S5 continueErrorOutput hard throw    AGREE (2/2)
S6 item-error split                  AGREE (2/2)  — reconstructed: success + error branch json
S7 disabled node passthrough         AGREE (3/3)  — task semantik + item downstream
S8 trivial expression                AGREE (1/1)
-------------------------------------------------------
DIFFERENTIAL: 24 agree / 0 diverge / 0 not-comparable across 24 comparisons (0 harness errors)
```

#### Operation: `run_shell` (suites)

```text
execution-engine : # tests 40 / # pass 40 / # fail 0   (POOL-001 14, POOL-002 7, POOL-003 12, sandbox 7)
reconstructed    : # tests 28 / # pass 28 / # fail 0
```

#### Operation: `run_shell` (gates)

```text
Execution LEGO gate: 9/9 PASS   (E01…E09; E08 = 49 exported symbols documented)
contract_conformance.mjs → RESULT: 42/42 CHECKS PASSED
boundary_audit.py        → AUDIT RESULT: PASS (all edges documented)
```

#### Catatan konsolidasi (untuk orchestrator, bukan keputusan worker)

Kedua engine sekarang sepakat pada seluruh 8 skenario diferensial, tetapi duplikasi `ISSUE-021`
**belum** selesai: yang berubah hanya bahwa tidak ada lagi divergensi perilaku sebagai alasan
memilih salah satu. Rekomendasi tetap seperti `docs/isolation/execution.md` §7 — putuskan satu
engine per jalur bahasa sebelum Phase 3 keluar, dengan `packages/execution-engine` sebagai kandidat
utama (cakupan lebih luas: join multi-input, stack/waiting, pin data, 40 test) dan prototipe
diubah menjadi smoke harness atau dipindahkan ke `tools/`.

---

### Dual-phase review sweep (offline — Supabase `task_consensus_votes` unreachable, ISSUE-019)

| Phase | Target | Action | Verdict |
| :--- | :--- | :--- | :--- |
| 1 (before starting) | `results/TASK-ENGINE-DIFF-01.md` + `tools/engine-differential.mjs` | re-ran the peer harness read-only and re-read the cited reference lines (S3 `:2438`, S6 `node-helpers.ts:1170`, S7 `:909-920`) | EVIDENCE VALID — 5 divergences reproduced, triaged as two reconstruction bugs + two prototype bugs |
| 1 (before starting) | `results/TASK-ENGINE-ERROR-01.md` (prototype error policy) | `npm run reconstructed-engine:test` read-only before any edit | 21/21 PASS — no NEEDS_CORRECTION |
| 2 (after finishing) | both engine packages | suites re-run after the edits and after both rebases | execution 40/40, prototype 28/28 |
| 2 (after finishing) | Phase-3 gates | `verify:all` + conformance + boundary + reference manifest | exit 0 · 42/42 · PASS |
| 2 (after finishing) | `f79dc9bc` / `82e5c6ba` (peer S3/S6/S7 fixes) | conflict-by-conflict reconciliation during two rebases | MERGED — one implementation per behaviour (see Rekonsiliasi section) |
| 2 (after finishing) | `ef740e66` (peer bounded expression sandbox) contract coverage | gate `E08` + `contracts/execution.contract.md` §7 delta 1 | NEEDS_CORRECTION → FIXED — kontrak masih menulis sandbox “not reconstructed yet” padahal `expression-sandbox.mjs` sudah dipakai `expression.mjs`; delta 1 + baris ownership ditulis ulang sesuai perilaku sebenarnya (vm terbatas, membran read-only, timeout 100 ms, code generation off) |

No self-approval and no double-voting: the artifacts reviewed in phase 1 and the peer fixes
reconciled in phase 2 were produced by other workers (`TASK-ENGINE-DIFF-01`,
`TASK-ENGINE-ERROR-01`, `TASK-ENGINE-CONSOLIDATE-01`, `TASK-ENGINE-DISABLED-01`, the expression
lane), and every verdict above is a re-run command, not an opinion. The consensus ledger stays
unreachable, so the sweep is recorded here (same convention as `results/TASK-ENGINE-ERROR-01.md`).
