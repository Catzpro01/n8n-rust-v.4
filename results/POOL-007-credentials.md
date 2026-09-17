# TASK RESULT: POOL-007-credentials

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-1` (Arena session `arena/01a0aff7-n8n-rust-v-4`)
- **LEGO COMPONENT**: `credentials`
- **PHASE**: 2 (contract-first isolation; ZERO RUST)
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-18`

---

## Ringkasan (5 kalimat)

1. Mengambil lane **Credentials** setelah survei lane: `trigger` dan `webhook` sedang digarap
   session `arena/01a0aff8` (terdeteksi dari `tools/{trigger,webhook}-lego-gate.mjs` di branch itu)
   dan `validation` sudah tercakup `packages/node-lego/src/type-validation.mjs` mereka —
   `credentials` bebas dan punya inti murni yang terenkripsi secara offline plus golden berisi
   cipherteks nyata.
2. Merekonstruksi **1:1** empat modul n8n 2.9.4 di `packages/credentials-lego` (`Cipher` OpenSSL
   `Salted__`, kelas `Credentials` + model error, helper redaksi bersentinel, dan empat helper
   SHARED yang direproduksi lokal) dengan **nol dependensi runtime** selain `node:crypto`.
3. **58/58 tes lulus**: 38 unit, 12 A/B parity terhadap `n8n-core@2.9.1` yang **benar-benar**
   berjalan (container DI-nya diisi dari luar sehingga kelas referensi bisa dipakai apa adanya),
   dan 8 konformasi atas golden `credentials.golden.json` agen-4.
4. Lima meta-test mutasi (M1–M5) semuanya membuat suite **gagal** saat port dirusak — jadi suite
   ini terbukti punya gigi, bukan sekadar tes yang selalu hijau.
5. Dua puluh quirk dipatrikan apa adanya, termasuk penurunan kunci `EVP_BytesToKey` **MD5 satu
   iterasi**, kunci yang dibaca sebagai **latin1 bukan UTF-8**, `decrypt` yang mengembalikan string
   kosong untuk input di bawah 16 byte, dan redaksi `oauthTokenData`/`csrfSecret` yang berjalan
   tanpa deklarasi properti.

---

## Bukti mesin

| Pemeriksaan | Hasil |
| :--- | :--- |
| `node --test test/*.test.mjs` | **58/58 PASS** |
| `test:unit` (01–03) | **38/38 PASS** |
| `test:parity` (04) | **12/12 PASS** A/B vs `n8n-core@2.9.1` |
| `test:golden` (05) | **8/8 PASS** vs golden agen-4 |
| Mutasi M1 / M2 / M3 / M4 / M5 | 1 / 2 / 3 / 2 / 1 kegagalan |
| `node tests/compatibility/contract_conformance.mjs` | **21/21 PASS** |
| `python3 tests/integration/boundary_audit.py` | **PASS** (Rust guard bersih) |
| `npm run verify:fast` | **10/10 PASS**, G09 252 perbandingan / 0 perbedaan |

## Artefak

- `packages/credentials-lego/**` (4 modul `src`, 5 berkas tes, 1 helper)
- `packages/credentials-lego/README.md`
- `docs/isolation/credentials-lego.md`
- `docs/isolation/credentials-bus-outbox.json`

## Catatan untuk mediator / lane lain

- **Golden berisi cipherteks nyata tanpa kunci**: `createNameTooShort` merekam
  `U2FsdGVkX1/UZSYEHw2EzySqyXZ44s+iZHOeMmkAwQxwRJBU+y+Ua72MXSC1VrB8`. Isinya tidak bisa
  didekripsi, tetapi struktur amplopnya terverifikasi (header `Salted__`, garam 8 byte, body
  kelipatan 16).
- **Redaksi hidup di `cli/`, bukan `core/`** — lane lain tidak akan menemukannya di `n8n-core`,
  dan tidak ada permukaan A/B untuk itu; verifikasinya lewat golden dan mutasi.
- `getWithoutData` (golden `hasData: false`) adalah urusan lapisan API: inti kredensial
  **selalu** menyertakan `data` di `getDataToSave()`.
