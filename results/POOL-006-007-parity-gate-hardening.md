# TASK RESULT: parity-gate hardening (response to the agent-2 advisory)

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-1` (Arena session `arena/01a0aff7-n8n-rust-v-4`)
- **TRIGGER**: advisory `7196779e` oleh **agent-2** (POOL-002-R1), yang melakukan **pengukuran**
  pada branch ini, bukan sekadar menduga
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-18`

---

## Ringkasan (5 kalimat)

1. Advisory agent-2 terbukti benar dan saya terima: dengan `.runtime/` disembunyikan, suite
   scheduler melaporkan 33 pass / 9 skipped dengan **exit 0** — verdikt hijau tanpa satu pun
   pemeriksaan diferensial — dan hal yang sama berlaku bagi suite credentials.
2. Perbaikan pertama: `test:parity` kini **gagal keras** saat runtime absen (exit 1), dengan satu
   tes penjaga yang tidak pernah di-skip; opt-out tetap mungkin tetapi harus eksplisit melalui
   `LEGO_ALLOW_NO_REFERENCE=1` — hijau harus berarti *diperiksa*.
3. Perbaikan kedua: vektor yang direkam dari referensi nyata disimpan di
   `fixtures/reference-vectors.json` dan diuji oleh `test:vectors`, sehingga bukti A/B tetap
   terbukti **offline** di session segar yang tidak punya `.runtime/`.
4. Vektor scheduler ikut mematrikan tiga temuan langsung terhadap referensi: tabrakan kunci S-10
   (dua konteks nonaktif yang hanya beda `recurrence.intervalSize` menghasilkan kunci identik),
   T-1 (registrasi ganda = ukuran tetap 1 + tepat satu laporan `cron:duplicate`), dan S-09 (map
   kosong yang sudah ada selamat dari `deregisterCrons`).
5. Hasil akhir: scheduler **48/48**, credentials **65/65**, gate repositori tetap hijau
   (contract_conformance 21/21, boundary_audit PASS, verify:fast 10/10).

---

## Bukti mesin

| Kondisi | scheduler-lego | credentials-lego |
| :--- | :--- | :--- |
| runtime ada | 48 pass / 0 fail, **exit 0** | 65 pass / 0 fail, **exit 0** |
| runtime disembunyikan | 36 pass / **7 fail**, **exit 1** | 46 pass / **13 fail**, **exit 1** |
| runtime disembunyikan + `LEGO_ALLOW_NO_REFERENCE=1` | 34 pass / 9 skipped, exit 0 | 47 pass / 12 skipped, exit 0 |
| `test:vectors` saat runtime disembunyikan | **5/5 pass** | **6/6 pass** |

## Artefak

- `packages/scheduler-lego/{fixtures/reference-vectors.json,tools/record-reference-vectors.mjs,test/06-reference-vectors.test.mjs}`
- `packages/credentials-lego/{fixtures/reference-vectors.json,tools/record-reference-vectors.mjs,test/06-reference-vectors.test.mjs}`
- `paritySkip()` + tes penjaga di kedua `test/helpers/reference.mjs` dan kedua `test/04-parity.test.mjs`

## Catatan untuk agent-2

Kedua remedy yang Anda tawarkan diterapkan, bukan salah satunya: fail-on-missing **dan** vektor
terekam. Terima kasih — ini cacat nyata pada klaim evidence saya, dan saya tidak akan menemukannya
sendiri karena sandbox saya selalu punya `.runtime/`.
