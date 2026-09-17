# POOL-008 — API LEGO (isolation note)

**TASK_ID**: `POOL-008-api`
**AGENT**: `agent-1` (Arena session `arena/01a0aff7-n8n-rust-v-4`)
**REFERENCE**: n8n 2.9.4 (upstream `b6dc2787c45677a29a9612cd27eb911302961a83`)
**CONTRACT**: `contracts/api.contract.md` (VERIFIED, agen-4)
**GOLDEN**: `tests/reference/agent-4/golden/api.golden.json`

## 1. Alasan pengambilan lane

`api` adalah kontrak VERIFIED terakhir yang belum punya paket. Lane lain sudah terklaim:
`trigger`/`webhook`/`validation` oleh `arena/01a0aff8`, `execution`/`expression`/`node` oleh paket
engine mereka, `persistence` oleh PR #15, `connection` oleh `workflow-lego`.

## 2. Ruang lingkup

| Berkas | Isi |
| :--- | :--- |
| `src/errors.mjs` | `ResponseError` + 11 subclass + `NodeApiError` |
| `src/response-helper.mjs` | `send`, `sendSuccessResponse`, `sendErrorResponse`, `isResponseError`, `isUniqueConstraintError`, `reportError` |
| `src/health.mjs` | payload `/healthz` dan `/healthz/readiness` |

Tidak direkonstruksi: rute/controller, middleware auth, validasi DTO zod, public API OpenAPI, dan
lapisan statis/SPA — semuanya bergantung pada `express` dan `@n8n/api-types`.

## 3. Tidak ada permukaan A/B — dinyatakan eksplisit

`@n8n/api-types` dan `express` tidak ada di `.runtime`. Sesuai pelajaran dari advisory agen-2
(POOL-002-R1) — jangan biarkan suite yang kosong berpura-pura hijau — paket ini **tidak punya
suite parity sama sekali** dan mengatakannya terus terang di `package.json` (`ab_surface: NONE`),
di README, dan di `src/index.mjs`. Bukti penggantinya:

* **Konformasi golden** terhadap rekaman live (7 pengujian, mencakup 21 kasus golden).
* **Meta-test mutasi** (7 mutan).

## 4. Bukti mesin

| Pemeriksaan | Hasil |
| :--- | :--- |
| `node --test test/*.test.mjs` | **37/37 PASS** |
| `test:unit` (01–03) | 30/30 |
| `test:golden` (04) | 7/7 |
| Mutasi M1 / M2 / M2b / M3 / M4 / M5 / M6 | 5 / **0** / 2 / 5 / 1 / 1 / 1 |

## 5. Temuan

1. **A-04c — kode mati yang nyata.** Penjaga `if (error.errorCode)` di `sendErrorResponse` tidak
   pernah bisa diamati: `errorCode` memiliki default `httpStatusCode` (dan parameter default
   TypeScript menyala pada `undefined`), sehingga nilainya selalu numerik; satu-satunya nilai falsy
   yang terjangkau adalah `0`, yang menghasilkan badan identik baik dengan maupun tanpa penjaga.
   Mutan M2 yang menghapus penjaga lolos 35/35 — **ekuivalen**, bukan celah suite. Varian teramati
   (M2b, `code := httpStatusCode`) tertangkap dengan 2 kegagalan.
2. **A-14 — badan kosong yang terekam.** Golden `executionNotFound` adalah `200` dengan badan `{}`.
   Itu bukan kasus khusus: `send()` menghasilkan `{data: undefined}`, dan `JSON.stringify` mengubah
   `{data: undefined}` menjadi `{}`. Direproduksi dan dipatrikan.
3. **Tiga bentuk kesalahan yang berbeda hidup berdampingan**, dan golden memisahkannya dengan rapi:
   amplop `{code, message}` (inti respons), isu zod bermuatan `code` **string** (lapisan DTO), dan
   `{status:'error',message}` tanpa `code` (AuthService / validator public API). Uji golden
   menegaskan bahwa dua yang terakhir **tidak dapat** dihasilkan oleh paket ini.
