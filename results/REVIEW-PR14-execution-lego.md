# TASK RESULT: review PR #14 (`packages/execution-engine` + 14 LEGO packages) — verifikasi independen, mutasi, dan arbitrase tabrakan

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-1` (Arena session `arena/01a0aff7-n8n-rust-v-4`)
- **TARGET**: PR #14, branch `arena/01a0aff8` @ `ec4dcb4f` (334 berkas, +40.231 / −242)
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-18`
- **VOTE**: **APPROVE** dengan 7 tindak lanjut terlampir (bukan blokir merge; lihat §6)

---

## Ringkasan (5 kalimat)

1. Saya mengekstrak seluruh tree PR #14 ke sandbox bersih dan menjalankan `npm run verify:all`:
   **hijau penuh** — 57 gate lulus, 0 gagal, tetapi hanya setelah empat `npm install` per-paket
   yang tidak dilakukan oleh script setup mana pun (lihat ISSUE-025).
2. Klaim utama PR terverifikasi dan justru **understated**: eksekusi engine 67 tes lulus
   (badan PR menulis 32/32) dan gate engine 10/10 (badan PR menulis 8/8) — branch sudah tumbuh
   melewati teks PR-nya.
3. Harness diferensial mereka benar-benar membandingkan dengan build referensi nyata:
   engine 84 agree / 0 diverge, aktivasi 65/0, error-surface 4 agree / 14 delta-terdokumentasi / 0
   diverge, node-lego 1.609 agree / 0 diverge.
4. Uji mutasi saya menemukan **7 celah cakupan nyata** (bukan mutant ekuivalen):
   4 di `packages/execution-engine`, 3 di `packages/api-lego` — semuanya saya buktikan dengan probe
   yang menunjukkan perilaku asli ≠ perilaku mutan.
5. Untuk ISSUE-024 saya mengukur bahwa dua rekonstruksi yang bertabrakan itu **komplementer, bukan
   redundan**: gabungan

   109 simbol ekspor, cabang saya 82, cabang mereka 61, irisan 34 — jadi merge
   menang-ambil-semua menghancurkan 27–48 simbol tak peduli siapa yang menang.

---

## 1. Bukti mesin — reproduksi `verify:all`

```text
cd /tmp/p14f                       # git archive refs/peer/arena/01a0aff8-n8n-rust-v-4
npm run verify:all                 # setelah 4x npm install per-paket (lihat ISSUE-025)
```

| Tahap `verify:all` | Hasil |
| :--- | :--- |
| `isolation:check` (4 checker) | PASS |
| `reconstructed-engine:test` | 28 pass / 0 fail |
| `execution:gate` | **10/10 PASS** (E01–E10) |
| `connection-lego:test` | 58 pass / 0 fail |
| `validation-lego:test` | 20 pass / 0 fail |
| `workflow-model-lego:test` | 66 pass / 0 fail |
| `trigger:gate` | 5/5 PASS |
| `webhook:gate` | 5/5 PASS |
| `scheduler:gate` | 6/6 PASS |
| `node:gate` | 7/7 PASS (N05: 1.609 agree / 0 diverge) |
| `persistence:gate` | 6/6 PASS |
| `credentials:gate` | 6/6 PASS |
| `execution-data:gate` | 6/6 PASS |
| `api:gate` | 6/6 PASS |
| **Exit code `verify:all`** | **`0`** |

Rincian `packages/execution-engine` (badan PR: 32/32; kenyataan 67/67):

| Berkas tes | pass | fail |
| :--- | ---: | ---: |
| `01-execution-loop.test.mjs` (POOL-001) | 14 | 0 |
| `02-node-context-data-proxy.test.mjs` (POOL-002) | 7 | 0 |
| `03-error-retry.test.mjs` (POOL-003) | 12 | 0 |
| `04-expression-sandbox.test.mjs` | 7 | 0 |
| `05-activation.test.mjs` | 20 | 0 |
| `06-error-surface.test.mjs` | 7 | 0 |
| **Total** | **67** | **0** |

Harness diferensial (dijalankan terpisah, tidak termasuk `verify:all`):

| Harness | Hasil |
| :--- | :--- |
| `tools/engine-differential.mjs` | 84 agree / 0 diverge / 0 not-comparable |
| `tools/activation-differential.mjs` | 65 agree / 0 diverge |
| `tools/error-surface-differential.mjs` | 4 agree / **14 documented-delta** / 0 diverge |
| `tools/node-lego-differential.mjs` (via N05) | 1.609 agree / 0 diverge (2 NOT-DIFFABLE) |

Catatan untuk 14 *documented-delta* pada error-surface: semuanya berasal dari perbedaan tag
(`{"packageName":"workflow-lego"}` vs `{"node":"n8n-nodes-base.test"}`) antara build terbitan 2.9.1
dan source 2.9.4 yang dipin. Itu bukan divergence rekonstruksi, dan pelaporannya jujur —
tetapi berarti perbandingan itu **tidak** membuktikan paritas error-surface terhadap source 2.9.4.

`reference/n8n` tidak tersentuh: E04 melaporkan *Reference integrity check: PASS (15050 files,
root f8da35180669…)* di setiap gate. E03 mengonfirmasi 23 berkas Rust repo-wide semuanya di dalam
`crates/**` + `apps/**` (warisan `main`, bukan tambahan PR ini) — sesuai `PROJECT_RULES.md` aturan 1.

---

## 2. Uji mutasi — `packages/execution-engine` (10 mutant)

Mutasi diterapkan ke `src/`, suite `test/*.test.mjs` dijalankan, lalu sumber dikembalikan.

| # | Mutasi | Hasil |
| :--- | :--- | :--- |
| M1 | `RETRY_LIMITS.maxTriesMax` 5 → 6 | **KILLED** (66/1) |
| M2 | `RETRY_LIMITS.maxTriesMin` 2 → 1 | **KILLED** (66/1) |
| M3 | `node.maxTries \|\| default` → `?? default` | **KILLED** (66/1) |
| M4 | `waitBetweenTriesDefault` 1000 → 2000 | **KILLED** (66/1) |
| M5 | preseden: `onError` menang atas `continueOnFail` | **SURVIVED** — celah nyata |
| M6 | deteksi item error: `keys.length === 1` → `>= 1` | **SURVIVED** — celah nyata |
| M7 | indeks output error: terakhir → `0` | **KILLED** (66/1) |
| M8 | `mergeErrorInformation`: `.message` digugurkan | **KILLED** (66/1) |
| M9 | urutan merge `{...pairedJson, ...item.json}` dibalik | **SURVIVED** — celah nyata |
| M10 | `errorPassThrough`: `main[0]` → semua cabang | **SURVIVED** — celah nyata |

**Terbunuh 6/10.** Keempat yang selamat saya buktikan **bukan** mutant ekuivalen
(`/tmp/probe-ee.mjs`, ringkasan di bawah):

| # | Input pembeda | Asli | Mutan |
| :--- | :--- | :--- | :--- |
| M5 | `{continueOnFail:true, onError:'continueErrorOutput'}` | `continueRegularOutput` / source `continueOnFail` | `continueErrorOutput` / source `onError` |
| M6 | item `{json:{error:'boom', a:1, b:2}}` | tetap di output sukses | dipindah ke output error |
| M9 | `pairedJson={error:'source-error',id:7}`, `item.json={error:'item-error'}` | `{error:'item-error', id:7}` | `{error:'source-error', id:7}` |
| M10 | `main` dengan 2 cabang input | `[[{json:{a:1}}]]` | `[[{json:{a:1}}],[{json:{b:2}}]]` |

Kenapa lolos: tes hanya memakai `{continueOnFail:true, onError:'stopWorkflow'}` — kombinasi di mana
`onError` bukan strategi *continue*, sehingga aturan preseden (dokumentasi mereka sendiri,
`error-handling.mjs` §"Resolution order is upstream's") tidak pernah benar-benar diuji;
`splitErrorOutputs` tidak pernah diimpor langsung oleh tes apa pun (hanya lewat engine, dan di situ
`pairedJson` tidak pernah bertabrikan kuncinya); dan `errorPassThrough` hanya diuji dengan satu
cabang input, padahal "hanya `main[0]`" adalah inti semantiknya.

## 3. Uji mutasi — `packages/api-lego` (8 mutant)

| # | Mutasi | Hasil |
| :--- | :--- | :--- |
| A1 | cabang `raw` pada `formatSuccessResponse` dimatikan | **SURVIVED** — celah nyata |
| A2 | status default error 500 → 400 | **KILLED** (11/1) |
| A3 | `errorCode` diabaikan, selalu pakai `httpStatusCode` | **SURVIVED** — celah nyata |
| A4 | pesan default unauthenticated `Unauthorized` → `Forbidden` | **KILLED** (10/2) |
| A5 | `required` tidak lagi menolak `null` | **SURVIVED** — celah nyata |
| A6 | `formatZodIssue` menggugurkan `path` | **KILLED** (10/2) |
| A7 | `healthz/readiness` dihapus dari dispatcher | **KILLED** (11/1) |
| A8 | pencocokan method peka-huruf | **SURVIVED** — **mutant ekuivalen** (kedua sisi sudah `toUpperCase`) |

**Terbunuh 4/8** (dari 7 mutant bermakna: 4/7). Probe `/tmp/probe-api.mjs`:

| # | Input pembeda | Asli | Mutan |
| :--- | :--- | :--- | :--- |
| A1 | `formatSuccessResponse({a:1}, true)` | `{status:200, body:{a:1}}` | `{status:200, body:{data:{a:1}}}` |
| A3 | `new InternalServerError('boom')` (`errorCode=0`, `http=500`) | `code: 0` | `code: 500` |
| A5 | `validateDto({name:{required:true,type:'string'}}, {name:null})` | `valid:false, received:'null'` | `valid:true` |

A1 adalah temuan paling relevan: `formatSuccessResponse` **diekspor dan dikontrak** (A05/A06) tetapi
tidak pernah dipanggil oleh satu pun dari 12 tesnya — fungsi publik dengan nol cakupan.

---

## 4. ISSUE-025 (baru) — `verify:all` gagal pada clone bersih

`npm run verify:all` pada tree PR #14 yang baru diekstrak gagal tiga kali karena dependensi
per-paket yang tidak dipasang:

| Urutan | Gejala | Perbaikan |
| :--- | :--- | :--- |
| 1 | `sh: 1: tsc: not found` (`connection-lego` build) | `npm install --prefix packages/connection-lego` |
| 2 | `sh: 1: tsc: not found` (`validation-lego` build) | `npm install --prefix packages/validation-lego` |
| 3 | `workflow-model-lego` 25 pass / **17 FAIL** — `Cannot find package 'luxon'` dari `packages/expression-lego/src/extensions.mjs` | `npm install --prefix packages/expression-lego` |
| 4 | `node-lego-gate` N05 `[HARNESS-ERROR] Cannot find module 'n8n-workflow'` | `npm install --prefix packages/workflow-lego` |

Ini keluarga yang sama dengan **ISSUE-023** yang saya laporkan kemarin (`.runtime` tidak lengkap),
sekarang pada level paket. Dua hal yang patut dipuji: `workflow-model-lego` mencetak pesan yang
menyuruh menjalankan perintah perbaikan yang tepat, dan N05 melaporkan kegagalan sebagai
`[HARNESS-ERROR]` — keduanya mendiagnosis diri sendiri, bukan gagal bisu. Rekomendasi: satu script
`scripts/setup-all.sh` yang menjalankan `setup-reference-runtime.sh` **dan** `npm install` untuk
setiap paket dengan `devDependencies`.

---

## 5. ISSUE-024 — arbitrase tabrakan: dua rekonstruksi itu komplementer

Perbandingan simbol ekspor aktual (`import()` pada kedua `src/index.mjs`), bukan sekadar jumlah berkas:

| Lane | Cabang saya | PR #14 | Irisan | **Gabungan** | Hilang jika PR #14 menang | Hilang jika saya menang |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| `api-lego` | 21 | 18 | 10 | 29 | 11 | 8 |
| `credentials-lego` | 19 | 14 | 7 | 26 | 12 | 7 |
| `execution-data-lego` | 38 | 21 | 15 | 44 | 23 | 6 |
| `scheduler-lego` | 4 | 8 | 2 | 10 | 2 | 6 |
| **Total** | **82** | **61** | **34** | **109** | **48** | **27** |

Contoh konkret komplementaritas:

* `api-lego` — saya punyai permukaan *response-helper* Express
  (`send`, `sendSuccessResponse`, `sendErrorResponse`, `healthz`, `readiness`, `reportError`,
  `NodeApiError`, `ContentTooLargeError`, `TooManyRequestsError`, `NotImplementedError`);
  mereka punyai permukaan *dispatch + DTO*
  (`ApiDispatcher`, `validateDto`, `formatZodIssue`, `formatSuccessResponse`,
  `formatPublicApiError`, `formatUnauthenticatedResponse`, `formatErrorResponse`,
  `WorkflowValidationError`).
* `scheduler-lego` — mereka punyai `getSchedulingFunctions`, `CronTimerAdapter`,
  `createCronTimerJob`, `matchesCron`, `parseCronExpression`, `toCronKey`; saya hanya
  `ScheduledTaskManager`, `toCronExpression`, `randomInt`, `DEFAULT_TIME`. Lane ini **menang telak
  untuk mereka** dan saya akui.
* `execution-data-lego` — saya punyai seluruh lapis penyimpanan biner
  (`storeBinaryData*`, `prepareBinaryDataMetadata`, `getBinaryDataBuffer`, `prettyBytes`,
  `defaultMimeLookup`, `runExecutionDataV0ToV1`, …); mereka punyai `prepareBinaryData`,
  `prepareInputPairedItems`, `applyAlwaysOutputData`, `formatFileSize`, `FILE_TYPES`.

Ukuran penguji (tes · assert · berkas tes):

| Lane | Saya (tes · assert · berkas) | PR #14 (tes · assert · berkas) |
| :--- | :--- | :--- |
| `api-lego` | 37 · 121 · 4 | 12 · 48 · 1 |
| `credentials-lego` | 65 · 183 · 6 | 22 · 47 · 1 |
| `execution-data-lego` | 78 · 229 · 7 | 24 · 55 · 1 |
| `scheduler-lego` | 48 · 121 · 6 | 16 · 46 · 2 |

**Kesimpulan arbitrase: tidak ada pemenang yang bisa dibenarkan.** Rekomendasi yang saya ajukan
(berurutan sesuai biaya):

1. **Union merge per lane** — gabungkan kedua permukaan; setelah itu urutan merge tidak lagi
   menghancurkan apa pun karena kedua sisi menjadi superset yang sama.
2. Jika union terlalu mahal: **satu pemilik per lane**, dipilih pada lane tempat selisihnya paling
   kecil. Dari tabel di atas: `scheduler-lego` → PR #14, `execution-data-lego` → saya,
   `credentials-lego`/`api-lego` → arbitrase (selisih kecil, permukaan berbeda).
3. Jangan pernah merge dua branch ini berurutan tanpa menjalankan
   `node tools/branch-collision-check.mjs --scope packages/ <ref A> <ref B>` terlebih dahulu.

Saya **tidak** akan menghapus atau mengganti nama empat paket saya sendiri tanpa keputusan
orchestrator; tawaran sebelumnya untuk menamespace direktori (`packages/agent1-<lane>-lego/`)
masih berlaku dan saya jalankan atas permintaan.

---

## 6. Vote dan tindak lanjut

**APPROVE** — branch ini mereproduksi hijau penuh di sandbox independen, semua gate-nya
berbasis bukti (bukan klaim), diferensialnya berjalan melawan build referensi nyata, dan
`reference/n8n` tetap utuh. Tujuh celah cakupan di bawah ini adalah *untested paths*, bukan
perilaku salah: tidak ada satu pun mutan yang memperlihatkan implementasi mereka menyimpang dari
source yang dipin. Memblokir rekonstruksi terbesar di repo ini demi 7 assertion yang hilang
tidak sebanding — tetapi saya mencatatnya sebagai utang yang harus dilunasi.

Tindak lanjut (non-blocking, saya sarankan dikerjakan sebelum lane ini dipakai beban nyata):

1. Tes preseden `continueOnFail` vs `onError` dengan `onError` yang *continue-strategy* (M5).
2. Tes item `json.error` dengan >2 kunci harus tetap di output sukses (M6).
3. Tes `splitErrorOutputs` secara langsung dengan `resolvePairedItem` yang bertabrikan kunci (M9).
4. Tes `errorPassThrough` dengan dua cabang input — semantik "hanya `main[0]`" (M10).
5. Panggil `formatSuccessResponse` di suite `api-lego`, termasuk jalur `raw` (A1).
6. Tes `errorCode` yang berbeda dari `httpStatusCode` — `InternalServerError` sudah `0` vs `500` (A3).
7. Tes `validateDto` dengan nilai `null` pada field `required` (A5).

---

## 7. Batas bukti

* Semua angka diukur di sandbox saya pada tree hasil `git archive` dari `ec4dcb4f`, dengan
  `reference/n8n` milik branch mereka ikut terekstrak (bukan symlink ke punya saya) — jadi
  E04 benar-benar menghash tree mereka sendiri.
* Saya tidak menjalankan ulang mutasi pada 12 lane sisanya (`expression`, `trigger`, `webhook`,
  `node`, `persistence`, `validation`, `connection`, `workflow-model`, dll.); angka 6/10 dan 4/8
  hanya berlaku untuk `execution-engine` dan `api-lego`.
* 14 *documented-delta* pada error-surface berarti paritas lane itu belum terbukti terhadap
  source 2.9.4; hanya terhadap build terbitan 2.9.1.
* Saya tidak memiliki toolchain Rust, jadi klaim apa pun yang menyangkut `crates/**` tidak
  termasuk dalam vote ini.
