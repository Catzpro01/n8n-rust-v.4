# TASK RESULT: TASK-415-extractor-ts-normalization (ISSUE-027, work-stealing §4)

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-7` (session `arena/01a0b101-n8n-rust-v-4`)
- **LEGO COMPONENT**: `tooling` (workflow isolation extractor — shared infra)
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-17 21:20 UTC`

---

### Ringkasan (≤5 kalimat)

ISSUE-027 (G06/G08 merah di lane PR #19 karena impor berekstensi `.ts` pada
`localization-envelope.ts` dkk.) diperbaiki di lapisan tooling sesuai rekomendasi
rekaman issue: `tools/workflow-isolation-extract.mjs` kini menormalisasi specifier
relatif berekstensi `.ts` pada salinan LEGO (`from/import()/require/bare import`)
menjadi tanpa ekstensi saat membangun isolated unit, dan mencatatnya di
`rewrites.json` (`legoSpecifierNormalizations`) sebagai jejak audit — invarian
"pure import rewrites" untuk berkas referensi owned tidak berubah (revert-exact
tetap ditegakkan). Bukti falsifikasi: probe sementara bergaya PR #19
(`import ... from './backend-localization-service.ts'`) dinormalisasi oleh extractor
baru dan `tsc -p .extract/tsconfig.json` exit 0; kontrol dengan ekstensi
dikembalikan menghasilkan **TS5097 persis seperti G06 PR #19**. Di branch ini
normalisasi bersifat no-op (sumber sudah tanpa ekstensi): `run-lego-tests.sh`
**34/34 PASS** dan `verify:fast` **10/10 PASS — BEHAVIOR CHANGE: NONE** sebelum
maupun sesudah perubahan. Lane PR #19 tidak perlu menulis ulang sumbernya: begitu
basis mereka memuat extractor ini (merge/rebase), G06/G08 hijau kembali.

### Bukti Mesin

```text
# 1. Falsifikasi (probe sementara, dihapus sesudahnya)
packages/workflow-lego/src/issue027-probe.ts  # import './backend-localization-service.ts'
node tools/workflow-isolation-extract.mjs
  .ts-ext normalized : 1 specifier(s) across 1 LEGO file(s) (ISSUE-027)
.extract/src/lego/issue027-probe.ts → from './backend-localization-service';  (ternormalisasi)
tsc -p .extract/tsconfig.json → exit 0
# kontrol: ekstensi dikembalikan manual ke salinan extract
tsc → error TS5097: An import path can only end with a '.ts' extension when
      'allowImportingTsExtensions' is enabled.   ← sama persis dengan G06 PR #19

# 2. Tanpa probe (kondisi branch, normalisasi no-op)
scripts/run-lego-tests.sh → # tests 34 · # pass 34 · # fail 0
npm run verify:fast         → gates: 10/10 PASS · BEHAVIOR CHANGE: NONE DETECTED
```

### Catatan governance

- Perbaikan dilakukan via §4 work-stealing pada *root cause* di tooling bersama
  (`tools/`), bukan pada berkas lane lain — lane PR #19 tetap owner sumbernya dan
  G11 mereka (yang meng-assert pola berekstensi) tetap valid di pohon mereka.
- Alternatif lemah (propagasi `allowImportingTsExtensions` ke `.extract/tsconfig.json`)
  tidak diambil karena tsconfig extract memakai `declaration: true` (TS5096 melarang
  kombinasi itu dengan emit).
