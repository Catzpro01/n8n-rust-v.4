# TASK RESULT: POOL-008-api

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-1` (Arena session `arena/01a0aff7-n8n-rust-v-4`)
- **LEGO COMPONENT**: `api`
- **PHASE**: 2 (contract-first isolation; ZERO RUST)
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-18`

---

## Ringkasan (5 kalimat)

1. Mengambil lane **API** — kontrak VERIFIED terakhir yang belum punya paket setelah `trigger`,
   `webhook`, `validation`, `execution`, `expression`, `node`, `persistence`, dan `connection`
   terbukti terklaim lane lain.
2. Merekonstruksi **1:1** inti respons murni n8n 2.9.4 di `packages/api-lego`: `ResponseError` +
   11 subclass, `send`/`sendSuccessResponse`/`sendErrorResponse` beserta helpernya, dan payload
   health — **nol dependensi runtime** selain `node:stream`.
3. **37/37 tes lulus**, dengan bukti berupa konformasi terhadap golden rekaman live (21 kasus)
   karena lane ini **tidak punya permukaan A/B**: `@n8n/api-types` dan `express` tidak ada di
   `.runtime` yang dipin — dan hal itu saya nyatakan eksplisit, bukan disembunyikan.
4. Tujuh belas quirk dipatrikan, termasuk `ResponseError` yang meng-hardcode `name`, `level` yang
   mengikuti pita status, dan `executionNotFound` yang mengembalikan badan kosong karena
   `{data: undefined}` diserialisasi menjadi `{}`.
5. Meta-test mutasi menemukan satu hal yang lebih berharga daripada sekadar "tertangkap": penjaga
   `if (error.errorCode)` adalah **kode mati** — mutan yang menghapusnya ekuivalen secara perilaku,
   sementara varian yang teramati tertangkap dengan 2 kegagalan.

---

## Bukti mesin

| Pemeriksaan | Hasil |
| :--- | :--- |
| `node --test test/*.test.mjs` | **37/37 PASS** |
| `test:unit` (01–03) | 30/30 |
| `test:golden` (04) | 7/7 (mencakup 21 kasus golden) |
| Permukaan A/B | **TIDAK ADA** — dinyatakan di `package.json`, README, dan `src/index.mjs` |
| Mutasi M1 / M2 / M2b / M3 / M4 / M5 / M6 | 5 / **0 (ekuivalen)** / 2 / 5 / 1 / 1 / 1 |
| Gate repositori | contract_conformance 21/21 · boundary_audit PASS · verify:fast 10/10 |

## Artefak

- `packages/api-lego/**` (3 modul `src`, 4 berkas tes, 1 helper)
- `packages/api-lego/README.md`, `docs/isolation/api-lego.md`, `docs/isolation/api-bus-outbox.json`

## Catatan untuk lane lain

- Bentuk respons n8n itu **tiga**, bukan satu: amplop `{code, message}` (inti), isu zod dengan
  `code` string (lapisan DTO), dan `{status:'error',message}` tanpa `code` (AuthService / validator
  public API). Uji golden menegaskan dua yang terakhir mustahil dihasilkan inti respons.
- `sendErrorResponse` selalu menyertakan `code`; karena itu setiap badan tanpa `code` pasti berasal
  dari lapisan lain.
