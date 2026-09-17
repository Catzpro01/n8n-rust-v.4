# TASK RESULT: PHASE4B-02 — Backend Native Localization Hub hardening (6 locales)

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-1` (Arena session `arena/01a0b104-n8n-rust-v-4`)
- **LEGO COMPONENT**: `localization-hub` (Phase 4B, 6 bahasa: id · en · jv · ar · zh · ru)
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-18`

---

## Ringkasan (5 kalimat)

1. Saya mengangkat hub lokalisasi 6 bahasa dari `origin/main` (`8f3f1af4`) menjadi modul yang
   **terbukti**, bukan sekadar enam kamus yang kebetulan sama: paritas kunci terhadap English base
   text kini dipaksakan (`parityReport()`), dan satu kunci yang hanya ada di satu lokal langsung
   menggagalkan gate (`L01`, tes 3).
2. Semantik referensi `reference/n8n/packages/frontend/@n8n/i18n` dikembalikan 1:1 — fallback
   `jv → id → en` (dan `ar | zh | ru → en`), interpolasi `{name}` verbatim tanpa escape HTML
   (`warnHtmlMessage: false`), pilihan plural `one | many` dengan `{count}`, `numberFormats` per
   lokal, serta aturan `GetBaseTextKey` yang mengeluarkan kunci berawalan `_` dari daftar translasi.
3. Normalisasi lokal yang tadinya diam-diam gagal (`setLocale('en-US')`) sekarang menangani
   BCP-47, kode warisan (`in`, `jw`, `zho`, `chi`, `cmn`, `arb`), negosiasi `Accept-Language`
   berbobot `q`, dan metadata RTL (hanya `ar`) — plus port persistensi preferensi pengguna dan
   notifikasi perubahan lokal untuk konsumen settings.
4. Dua sumber kebenaran dihapus: adapter Phase 4A tidak lagi menyimpan daftar dua bahasa sendiri,
   melainkan memproyeksikan `SUPPORTED_LOCALES`; hub juga tetap **tanpa impor** sama sekali sehingga
   batas LEGO-nya bersih (`L03`), dan `reference/n8n/**` (bundle Vue editor) tetap byte-identik
   (`L04`, 15.050 file, root `f8da35180669d798…`).
5. Bukti mesin: `npm run i18n:check` **5/5 PASS**, `node --test test/06-localization.test.mjs`
   **24/24 PASS**, `npm run isolation:check` tanpa drift, dan regresi penuh `npm run verify`
   **11/11 PASS** dengan verifikasi live **7/7** — perilaku model workflow tidak berubah
   (`BEHAVIOR CHANGE: NONE DETECTED`).

---

## 1. Bukti mesin

| Perintah | Hasil | Artefak |
| :--- | :--- | :--- |
| `npm run i18n:check` | **5/5 PASS** (L01–L05) | `docs/isolation/evidence/localization-hub.json` |
| `node --test packages/workflow-lego/test/06-localization.test.mjs` | **24/24 PASS** (offline, tanpa reference runtime) | — |
| `tsc --noEmit -p packages/workflow-lego/tsconfig.json` | **0 error** | — |
| `npm run isolation:check` | boundary + kernel + port + reference integrity **PASS** | manifest tidak berubah |
| `npm run verify` | **11/11 PASS** · live **7/7** (R0–R6) · digest 252 section / 18 workflow, 0 perbedaan | `docs/isolation/evidence/gate-report.json`, `live-verification.json`, `model-digest.comparison.json` |

## 2. Permukaan yang diverifikasi (L01–L05)

| Check | Klaim | Cara dibuktikan |
| :--- | :--- | :--- |
| `L01` | 6 lokal terdaftar, **23 kunci** identik ke English base text, tepat satu lokal RTL | `parityReport()` + probe injeksi kunci |
| `L02` | Suite perilaku lulus | `node --test test/06-localization.test.mjs` (19/19) |
| `L03` | Hub 0 impor; adapter 1 impor relatif | scan AST-teks pada sumber TS |
| `L04` | Bundle Vue n8n tidak tersentuh | `tools/workflow-reference-manifest.mjs --check` |
| `L05` | Tidak ada daftar bahasa kedua di adapter | scan literal pada adapter |

## 2.1 Gabungan dengan pass Phase 4B kedua (`da1654a8`)

Pass kedua di branch ini memperluas kamus dari 9 → **23 kunci per lokal** dan menambah
`isRTL`/`getDirection`, `formatExecutionMessage`, penekan banner update, dan `localStorage`.
Semua dipertahankan: kamusnya di-merge verbatim (paritas sekarang memaku 23 kunci), sedangkan akses
`localStorage` dipindahkan ke port persistensi (`attachBrowserStorage()` → `hydrate()`) agar hub tetap
bebas global di Node. Satu bug ikut ditutup: `formatExecutionMessage` versi seed memakai
`String.replace` sehingga hanya kemunculan **pertama** sebuah parameter yang diganti; versinya
sekarang berjalan di atas interpolasi `translate()` (semua kemunculan, HTML tetap verbatim).

## 3. Yang **tidak** dikerjakan (sengaja)

- **UI tidak disentuh** — `reference/n8n/packages/frontend/**` dan `editor-ui` tetap 100% asli
  (PROJECT_RULES §2); hub ini adalah sisi backend yang menyuplai payload pengaturan.
- **Tidak ada Rust** — penambahan hanya di `packages/`, `tools/`, `contracts/`, `docs/`
  (PROJECT_RULES §1).
- **Wording terjemahan tidak diklaim** — n8n hanya mengirim base text Inggris, jadi enam terjemahan
  adalah teks produk; gate memaku mekanisme + paritas kunci, bukan bunyi kalimat.
- **`packages/reconstructed-engine/src/settings-localization.ts` dibiarkan** — paket itu dikarantina
  `ISSUE-022` (tanpa package.json/tsconfig/tes, tidak diimpor apa pun); hub ini yang kanonik.
