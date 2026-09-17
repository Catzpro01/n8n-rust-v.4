# `@n8n-reconstructed/api-lego` (POOL-008)

Rekonstruksi **1:1** inti respons REST n8n 2.9.4 yang murni — JS ESM, **nol dependensi runtime**
(hanya `node:stream`), **nol Rust** (PROJECT_RULES rule 1).

Sumber: `reference/n8n/packages/cli/src/response-helper.ts`,
`.../cli/src/errors/response-errors/**`, konstanta `FORM_TRIGGER_PATH_IDENTIFIER` dari
`n8n-workflow`, serta kontrak `contracts/api.contract.md` (VERIFIED, agen-4) untuk payload health.

```bash
npm test --prefix packages/api-lego         # 37/37
npm run test:unit --prefix packages/api-lego    # 30  (01–03)
npm run test:golden --prefix packages/api-lego  #  7  konformasi golden agen-4
```

## Permukaan

| Modul | Simbol |
| :--- | :--- |
| `src/errors.mjs` | `ResponseError` + 11 subclass, `NodeApiError` |
| `src/response-helper.mjs` | `send`, `sendSuccessResponse`, `sendErrorResponse`, `isResponseError`, `isUniqueConstraintError`, `reportError` |
| `src/health.mjs` | `healthz`, `readiness` |

## TIDAK ada permukaan A/B — dan itu dinyatakan, bukan disembunyikan

`@n8n/api-types` dan `express` **tidak** termasuk dalam set dependensi `.runtime` yang dipin, jadi
tidak ada implementasi referensi untuk didiff. LEGO ini **tidak mengklaim parity**; buktinya adalah
konformasi terhadap golden rekaman live (`api.golden.json`) ditambah meta-test mutasi.

## Quirk yang dipatrikan (direproduksi, BUKAN diperbaiki)

| ID | Perilaku |
| :-- | :--- |
| A-01 | `ResponseError` meng-hardcode `name = 'ResponseError'` — `error.name` selalu sama, untuk semua subclass |
| A-02 | `level` mengikuti pita status: 4xx → `warning`, 502–504 → `info`, selainnya (termasuk 500/501) → `error` |
| A-03 | Parameter default TypeScript menyala pada `undefined` eksplisit, jadi `BadRequestError(m)` tetap `errorCode` 400 |
| A-04 | Amplop selalu dimulai `{code: 0, message}`; `code` hanya ditimpa bila `errorCode` truthy |
| A-04c | **Penjaga `if (error.errorCode)` adalah kode mati** — `errorCode` selalu numerik, dan satu-satunya nilai falsy yang terjangkau (`0`) menghasilkan badan yang identik |
| A-05 | `NodeApiError` digabungkan ke atas amplop dengan `Object.assign` |
| A-06 | `stacktrace` hanya ditambahkan saat development — produksi tidak pernah membocorkan stack |
| A-07 | Dua pengecualian form-trigger mem-bypass JSON dan `res.render` (404 form, 409 `form-waiting`) |
| A-08 | `sendSuccessResponse` mem-`pipe` `Readable` **sebelum** memeriksa `raw`; `raw` mengirim string lewat `res.send` |
| A-09 | `send()` melewatkan respons sukses bila `res.headersSent` sudah benar |
| A-10 | Pesan unique/duplicate ditulis ulang; pemeriksaannya uji substring case-insensitive pada `message` |
| A-11 | `reportError` diam untuk `ResponseError` dengan status ≤ 404 |
| A-12 | `isResponseError` melakukan duck-typing pada dua field numerik (inilah yang mengizinkan external hooks) |
| A-14 | `executionNotFound` → 200 dengan badan **kosong**, karena `{data: undefined}` diserialisasi menjadi `{}` |
| H-01 | `/healthz` tanpa syarat: selalu `200 {status:'ok'}` |
| H-02 | `/healthz/readiness` → 200 hanya bila DB terhubung **dan** termigrasi |
| H-03 | Keduanya **tidak** dibungkus amplop `{data}` |

## Bukti mesin

| Pemeriksaan | Hasil |
| :--- | :--- |
| `node --test test/*.test.mjs` | **37/37 PASS** |
| Mutasi M1 / M2 / M2b / M3 / M4 / M5 / M6 | 5 / **0** / 2 / 5 / 1 / 1 / 1 kegagalan |

**M2 tidak tertangkap karena ekuivalen**, dan itu justru temuan: penjaga `if (error.errorCode)` tidak
pernah bisa diamati. Varian yang teramati (M2b) tertangkap dengan 2 kegagalan.
