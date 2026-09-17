# `@n8n-reconstructed/credentials-lego` (POOL-007)

Rekonstruksi **1:1** inti kredensial murni n8n 2.9.4 — JS ESM, **nol dependensi runtime**
(hanya `node:crypto`), **nol Rust** (PROJECT_RULES rule 1).

Sumber: `reference/n8n/packages/core/src/encryption/cipher.ts`,
`.../core/src/credentials.ts`, `.../core/src/constants.ts` (`CREDENTIAL_ERRORS`),
`.../cli/src/credentials/credentials.service.ts` (`redactValues`, `redactCollectionOption`,
`unredactRestoreValues`, `unredact`), `.../cli/src/constants.ts` (`CREDENTIAL_BLANKING_VALUE`),
`.../workflow/src/constants.ts` (`CREDENTIAL_EMPTY_VALUE`).
Kontrak: [`../../contracts/credentials.contract.md`](../../contracts/credentials.contract.md) (VERIFIED).

```bash
npm test --prefix packages/credentials-lego        # 58/58
npm run test:unit --prefix packages/credentials-lego   # 38  (01–03)
npm run test:parity --prefix packages/credentials-lego # 12  A/B vs n8n-core@2.9.1
npm run test:golden --prefix packages/credentials-lego #  8  konformasi golden agen-4
```

## Permukaan

| Modul | Simbol | Asal |
| :--- | :--- | :--- |
| `src/cipher.mjs` | `Cipher`, `getKeyAndIv`, `OPENSSL_SALTED_HEADER` | `core/src/encryption/cipher.ts` |
| `src/credentials.mjs` | `Credentials`, `CredentialDataError`, `CREDENTIAL_ERRORS`, `ICredentials` | `core/src/credentials.ts` |
| `src/redaction.mjs` | `redactValues`, `redactCollectionOption`, `unredactRestoreValues`, `unredact`, `CREDENTIAL_BLANKING_VALUE`, `CREDENTIAL_EMPTY_VALUE` | `cli/src/credentials/credentials.service.ts` |
| `src/support.mjs` | `isObjectLiteral`, `jsonParse`, `deepCopy`, `isINodePropertyCollection`, `ApplicationError` | helper SHARED yang direproduksi lokal |

**Satu-satunya delta terhadap upstream adalah injeksi dependensi:** `Cipher` menerima
`instanceSettings` lewat konstruktor (upstream: `@Service()` + DI) dan `Credentials` menerima
`deps.cipher` (upstream: `Container.get(Cipher)`). Pola ini sama dengan injeksi `CronJob` di
scheduler LEGO, dan membuat paket ini bebas dependensi.

## Quirk yang dipatrikan (direproduksi, BUKAN diperbaiki)

| ID | Perilaku |
| :-- | :--- |
| C-01 | Header OpenSSL `Salted__` (8 byte) → setiap cipherteks berawalan `U2FsdGVkX1` |
| C-02 | Penurunan kunci `EVP_BytesToKey` dengan **MD5 dan satu iterasi** |
| C-03 | Kunci enkripsi dibaca sebagai **latin1 (`'binary'`)**, bukan UTF-8 |
| C-04 | `decrypt` mengembalikan **string kosong** untuk input <16 byte, bukan melempar |
| C-05 | Garam acak 8 byte baru setiap `encrypt` → payload sama tidak pernah menghasilkan cipherteks sama |
| C-06 | `decrypt` mengembalikan **string**, tidak pernah mengurai JSON (itu tugas `Credentials`) |
| K-01 | `setData` **meng-assert** objek literal biasa: array, `Date`, instance kelas, `null`, dan objek ber-prototipe-null semuanya melempar `AssertionError` |
| K-02 | Tiga pesan berbeda: `NO_DATA`, `DECRYPTION_FAILED`, `INVALID_JSON` |
| K-03 | `updateData` = dekripsi → gabung → hapus → enkripsi ulang (garam baru) |
| K-04 | `getDataToSave` melempar `ApplicationError` **polos** tanpa `extra`, bukan `CredentialDataError` |
| K-05 | `extra` pada `CredentialDataError` adalah **snapshot** `{name, type, id}`, bukan tampilan hidup |
| R-01 | `oauthTokenData` / `csrfSecret` diblankir **tanpa deklarasi properti**, dan `toString()`-nya tidak dijaga → `null` melempar |
| R-02 | Kunci tanpa properti yang cocok dibiarkan apa adanya |
| R-03 | Untuk `fixedCollection`, redaksi bersarang berjalan **sebelum** pemeriksaan password |
| R-04 | Nilai berawalan ekspresi `={{` dilewati, kecuali `noDataExpression`; nilai non-string melempar `TypeError` |
| R-05 | `CREDENTIAL_EMPTY_VALUE` hanya untuk `toString().length === 0` |
| R-06 | `props.find(...)` mengambil properti **pertama** dengan nama cocok |
| R-07 | `redactValues` memutasi dan mengembalikan objek yang sama |
| R-08 | `redactCollectionOption` menangani bentuk array dan objek, dan melewati `null` |
| R-09 | `unredactRestoreValues` memasuki objek apa pun, termasuk array (berjalan per indeks) |
| R-10 | Kunci terblankir yang tidak ada di `savedData` dipulihkan sebagai `undefined` |

## Yang TIDAK direkonstruksi

- `CredentialsService.redact(data, credential)` — resolusi `ICredentialType` lewat
  `LoadNodesAndCredentials` adalah dependensi SHARED berbasis registry, dan kegagalan pencarian
  ditelan. Yang diportasi hanya paruh murninya yang bekerja pada daftar properti yang sudah
  teresolusi.
- `CredentialsHelper` (resolusi `{id,name}`, OAuth refresh, `applyDefaultsAndOverwrites`),
  aturan akses project, dan seluruh lapisan HTTP.
