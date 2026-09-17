# TASK RESULT: POOL-009 — pengerasan mutasi pada empat lane Agent 1 (api · credentials · execution-data · scheduler)

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-1` (Arena session `arena/01a0aff7-n8n-rust-v-4`)
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-18`

---

## Ringkasan (5 kalimat)

1. Setelah meninjau PR #14 dan menemukan 7 celah cakupan di sana, saya menjalankan disiplin yang
   sama pada **empat lane saya sendiri**: 50 mutan semantik, 43 terbunuh, 4 selamat, dan semua
   yang selamat saya buktikan statusnya — 5 celah nyata lalu saya tutup dengan tes baru,
   2 mutant ekuivalen saya dokumentasikan alasannya.
2. `execution-data-lego` **14/14 terbunuh** setelah saya menutup 3 celah (D9 `in`-test, D11
   `prettyBytes` signed, D12 penjaga `fileId`) — sebelumnya 11/14.
3. `api-lego` **13/14 terbunuh** setelah 2 celah ditutup (A-07 `errorCode` vs `httpStatusCode`,
   A-07a `form-waiting`); 1 sisanya (A-04) terbukti **ekuivalen** karena `response.code`
   diinisialisasi `0` dan `errorCode` bertipe number.
4. `credentials-lego` **11/12 terbunuh**; sisanya (R-09) terbukti ekuivalen — penjaga
   `key in replacement` tidak pernah bisa diamati karena `replacement[key]` yang absen adalah
   `undefined`, dan `typeof undefined !== 'object'`.
5. `scheduler-lego` **15/16 terbunuh**; sisanya (S-09) terbukti ekuivalen, yang berarti komentar
   "FROZEN QUIRK S-08" di sumber **salah mengklaim** dampaknya — sudah saya koreksi.

---

## 1. Matriks mutasi akhir

| Lane | Tes (sebelum → sesudah) | Mutan | Terbunuh | Selamat | Mutan ekuivalen (terbukti) |
| :--- | :--- | ---: | ---: | ---: | :--- |
| `execution-data-lego` | 78 → **82** | 14 | **14** | 0 | — |
| `credentials-lego` | 65 → 65 | 12 | **11** | 1 | R-09 |
| `api-lego` | 37 → **39** | 14 | **13** | 1 | A5 (A-04) |
| `scheduler-lego` | 48 → 48 | 16 | **15** | 1 | S9 (S-08) |
| **Total** | **228 → 234** | **56** | **53** | **3** | **3** |

Metode: setiap mutan diterapkan ke `src/`, suite `test/*.test.mjs` dijalankan, sumber
dikembalikan. `String.replaceAll` (bukan `replace`) — temuan metodologis saya sendiri: mutan
D6 pertama dilaporkan SURVIVED padahal KILLED, karena pola `input: inputIndex || undefined`
muncul **dua kali** dan `replace` hanya mengganti yang pertama.

---

## 2. Celah nyata yang saya tutup

### `execution-data-lego` (78 → 82 tes)

| Mutan | Celah | Bukti pembeda | Tes baru |
| :--- | :--- | :--- | :--- |
| D9 | `resolveSourceOverwrite` memakai `'sourceOverwrite' in item.pairedItem`, bukan uji kebenaran | `{sourceOverwrite: undefined}` → asli `undefined`, mutan `null` | `04-paired-items` — *"uses an `in` test, not truthiness (upstream L15-16)"* |
| D11 | `prettyBytes(0, {signed:true})` memakai spasi depan `' 0 B'` | asli `' 0 B'`, mutan `'0 B'` | `05-binary` — *"signed keeps the leading space on zero"* + matriks opsi baru di `06-parity` |
| D12 | mode tersimpan tanpa `fileId` harus melempar | asli melempar, mutan tidak | `05-binary` — *"refuses a stored mode with no fileId (contract I10)"* |

Nilai `prettyBytes` **divalidasi terhadap `pretty-bytes@5.6.0` yang nyata** di `.runtime`
(`' 0 B'`, `'+7 B'`, `'-7 B'`, `'+0.4 B'`), bukan terhadap ekspektasi karangan saya. Tes A/B
baru di `06-parity.test.mjs` menjalankan 26 ukuran × 11 set opsi = **286 perbandingan** terhadap
paket asli — opsi yang tidak pernah dipanggil n8n (`signed`, `bits`, `binary`, `locale`) kini
ikut terpin.

D6 (P-01: input 0 kehilangan kunci `input`) sebenarnya sudah KILLED — kesimpulan awal saya
SURVIVED adalah artefak `replace` vs `replaceAll`.

### `api-lego` (37 → 39 tes)

| Mutan | Celah | Bukti pembeda | Tes baru |
| :--- | :--- | :--- | :--- |
| A8 | A-07 mengunci `error.errorCode === 404`, bukan `httpStatusCode` | `new BadRequestError('x', 404)` → asli render form, mutan JSON 400 | `02-response-helper` — *"keys off errorCode, not httpStatusCode"* |
| A9 | A-07a cocokkan `form-waiting`, bukan sekadar `form` | URL `/form/abc` + 409 → asli JSON 409, mutan render | `02-response-helper` — *"the 409 exception requires the form-waiting path"* |

### `scheduler-lego` — perbaikan harness (bukan tes baru)

Mutasi menyingkap bahwa suite **menggantung, bukan gagal**, saat registrasi hilang:
`S13` (`if (!workflowCrons)` → `if (true)`) membuat `deregisterAllCrons()` tidak bisa menjangkau
job lama, timer `cron@4` yang nyata menahan event loop, dan `node --test` tak pernah keluar —
ini menghabiskan 15 menit waktu run saya. Pembersihan yang lama bergantung pada registry, jadi
ia ikut rusak bersama kode yang diujinya.

Perbaikan: `test/04-parity.test.mjs` kini membungkus `CronJob` yang disuntik dengan pencatat
konstruksi, dan `cleanup` menghentikan **kedua** jalur — registry **dan** log konstruksi.
Terukur: S13 kini gagal dalam **1,35 s** (42 pass / 6 fail) alih-alih menggantung.
Sebuah tes yang merah seharusnya merah cepat; tes yang menggantung menyembunyikan kegagalan.

---

## 3. Dua komentar sumber yang saya koreksi

Mutasi tidak hanya menguji tes — ia menguji dokumentasi.

* **`scheduler-lego` S-08** — komentar mengklaim "peta dibaca SEBELUM pemeriksaan duplikat,
  sehingga `workflowCrons` yang dipakai untuk `set` berikutnya adalah yang sudah ada". Mutan
  S-9 (pindahkan pembacaan setelah pemeriksaan) **selamat**, dan memang ekuivalen: `toCronKey`
  murni dan tak ada yang memutasi `cronsByWorkflow` di antaranya. Klaim "FROZEN QUIRK"
  diganti menjadi "READ ORDER" dengan catatan bahwa urutannya dipertahankan demi fidelitas
  1:1, **bukan** karena berdampak perilaku.
* **`execution-data-lego`** — D6 membuktikan P-01 memang terpin (KILLED), jadi tidak ada
  koreksi; ini dicatat hanya agar kesalahan metodologis `replace` tidak terulang.

Dua mutant ekuivalen yang tersisa (`credentials-lego` R-09, `api-lego` A5) **sengaja dibiarkan
tanpa tes baru**: menulis tes yang lolos baik pada kode asli maupun pada mutan ekuivalen hanya
akan menambah angka tanpa menambah jaminan. Keduanya saya dokumentasikan di sini.

---

## 4. Bukti mesin (setelah perubahan)

| Pemeriksaan | Hasil |
| :--- | :--- |
| `packages/execution-data-lego` | **82/82** (sebelumnya 78) |
| `packages/api-lego` | **39/39** (sebelumnya 37) |
| `packages/credentials-lego` | **65/65** |
| `packages/scheduler-lego` | **48/48** |
| `tests/compatibility/contract_conformance.mjs` | **21/21 PASSED** |
| `tests/integration/boundary_audit.py` | **PASS** (all edges documented) |
| `npm run verify:fast` | **10/10 PASS** · BEHAVIOR CHANGE: NONE DETECTED (252 perbandingan / 0 perbedaan) |

Reproduksi:

```text
bash scripts/setup-all.sh                 # .runtime + npm install per-paket
for p in api-lego credentials-lego execution-data-lego scheduler-lego; do
  (cd packages/$p && npm test)
done
node tests/compatibility/contract_conformance.mjs
python3 tests/integration/boundary_audit.py
npm run verify:fast
```

## 5. Batas bukti

* 56 mutan dipilih **untuk menyasar invarian yang terdokumentasi** (A-01..A-12, H-01..H-03,
  C-01..C-05, R-01..R-10, S-01..S-10, T-1, T-2, P-01..P-03, I3/I4/I9/I10). Ini bukan cakupan
  acak dan bukan jaminan tidak ada celah lain.
* Tiga lane (`credentials`, `scheduler`, `api`) tidak saya tambah tesnya kecuali ada mutan yang
  selamat dan terbukti bukan ekuivalen — jadi angka tes yang tetap (65, 48) berarti "tidak
  ditemukan celah", bukan "sudah lengkap".
* Paritas `prettyBytes` bergantung pada `pretty-bytes@5.6.0` di `.runtime`; bila runtime absen,
  `06-parity` melewati A/B dengan alasan yang tercetak (tidak pernah hijau palsu).
