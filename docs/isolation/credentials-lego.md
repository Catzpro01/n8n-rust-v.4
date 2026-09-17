# POOL-007 — Credentials LEGO (isolation note)

**TASK_ID**: `POOL-007-credentials`
**AGENT**: `agent-1` (Arena session `arena/01a0aff7-n8n-rust-v-4`)
**BRANCH**: `arena/01a0aff7-n8n-rust-v-4`
**REFERENCE**: n8n 2.9.4 (upstream `b6dc2787c45677a29a9612cd27eb911302961a83`)
**CONTRACT**: `contracts/credentials.contract.md` (VERIFIED, agen-4)

## 1. Alasan pengambilan lane

Survei lane: kontrak `api` / `credentials` / `trigger` / `webhook` belum punya paket.
`trigger` dan `webhook` sudah digarap session `arena/01a0aff8` (terdeteksi dari keberadaan
`tools/trigger-lego-gate.mjs` dan `tools/webhook-lego-gate.mjs` di branch itu), dan `validation`
sudah terbahas di `packages/node-lego/src/type-validation.mjs` milik mereka. `credentials` bebas,
dan — paling penting — memiliki inti **murni** yang bisa didekripsi/dienkripsi secara offline plus
golden berisi cipherteks nyata.

## 2. Ruang lingkup

| Berkas | Isi |
| :--- | :--- |
| `src/cipher.mjs` | `Cipher` — amplop OpenSSL `Salted__`, `EVP_BytesToKey`(MD5, 1 iterasi), `aes-256-cbc` |
| `src/credentials.mjs` | `Credentials`, `CredentialDataError`, `CREDENTIAL_ERRORS`, `ICredentials` |
| `src/redaction.mjs` | `redactValues`, `redactCollectionOption`, `unredactRestoreValues`, `unredact`, dua sentinel |
| `src/support.mjs` | `isObjectLiteral`, `jsonParse`, `deepCopy`, `isINodePropertyCollection`, `ApplicationError` |

**Tidak** direkonstruksi: `CredentialsService.redact()` (butuh registry tipe kredensial),
`CredentialsHelper`, aturan akses project, OAuth refresh, dan seluruh lapisan HTTP.

## 3. Dependensi

**Nol dependensi runtime** (hanya `node:crypto`). Satu-satunya delta struktural: `Cipher` menerima
`instanceSettings` via konstruktor dan `Credentials` menerima `deps.cipher`, menggantikan DI
`@n8n/di` upstream — pola yang sama dengan injeksi `CronJob` di scheduler LEGO.
`reference/n8n/**` read-only dan tidak tersentuh; tidak ada `.rs`/`Cargo.toml` baru (rule 1);
tidak ada berkas frontend yang diubah (rule 2).

## 4. Bukti mesin

| Pemeriksaan | Hasil |
| :--- | :--- |
| `node --test test/*.test.mjs` | **58/58 PASS** |
| `test:unit` (01–03) | **38/38 PASS** |
| `test:parity` (04, A/B vs `n8n-core@2.9.1`) | **12/12 PASS** |
| `test:golden` (05) | **8/8 PASS** |
| Meta-test mutasi M1–M5 | kelimanya **FAIL saat port dirusak** |

Mutation matrix (suite lengkap):

| Mutan | Perusakan | Hasil |
| :--- | :--- | :--- |
| M1 | kunci cipher latin1 → utf8 (C-03) | 57 pass / **1 fail** |
| M2 | short-circuit `<16` → `<8` (C-04) | 56 pass / **2 fail** |
| M3 | assert `setData` dihapus (K-01) | 55 pass / **3 fail** |
| M4 | penjaga ekspresi redaksi dihapus (R-04) | 56 pass / **2 fail** |
| M5 | `getDataToSave` memakai `CredentialDataError` (K-04) | 57 pass / **1 fail** |

## 5. Catatan A/B

`Credentials` referensi mengambil cipher lewat `Container.get(Cipher)`. Ternyata container-nya
bisa diisi dari luar: `require('@n8n/di').Container.set(Cipher, new Cipher({encryptionKey}))`
berbagi instance modul yang sama dengan `dist` `n8n-core`, sehingga kelas referensi bisa
dikonstruksi apa adanya. Itulah yang membuat parity 12/12 mungkin — termasuk silang-dekripsi
dua arah (enkripsi saya → dekripsi referensi dan sebaliknya).

Perilaku `isObjectLiteral` **ditemukan dengan differential testing**, bukan dengan membaca source
(definisinya tidak ada di pohon `reference/n8n`): array, `Date`, instance kelas, dan objek
ber-prototipe-null semuanya **ditolak** oleh `setData` referensi.

## 6. Temuan untuk lane lain

1. **Golden berisi cipherteks nyata.** `cases.createNameTooShort` merekam
   `U2FsdGVkX1/UZSYEHw2EzySqyXZ44s+iZHOeMmkAwQxwRJBU+y+Ua72MXSC1VrB8`. Kunci enkripsinya tidak
   ikut terekam, jadi nilainya tidak bisa didekripsi — tetapi **strukturnya** bisa diverifikasi
   (header `Salted__`, garam 8 byte, panjang body kelipatan 16) dan itu sudah cukup untuk
   membuktikan format amplopnya.
2. **`getWithoutData` bukan urusan inti kredensial.** Golden mencatat `hasData: false` untuk
   `GET /rest/credentials/:id`; `getDataToSave()` justru **selalu** menyertakan `data`. Penghilangan
   `data` adalah tugas lapisan API, bukan inti kredensial — ditegaskan oleh pengujian.
3. **Redaksi ada di `cli/`, bukan `core/`.** Lane yang butuh `redactValues` harus tahu bahwa ia
   tidak tersedia dari `n8n-core`; tidak ada permukaan A/B untuknya, sehingga ia diverifikasi lewat
   golden dan meta-test mutasi.
