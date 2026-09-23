# WORKER 4 — LEGO INTEGRATION (audit + adapter, tanpa engine kedua)

## Kontrak acuan
`contracts/ts-baseline-runtime.contract.md` §4 + §9.

## Scope (allowed_paths — EKSKLUSIF)
- `packages/reconstructed-engine/ts-runtime-adapter.mjs` (BARU — adapter frozen interface)
- `packages/reconstructed-engine/ts-runtime-adapter.test.mjs` (BARU — test adapter)
- `packages/reconstructed-engine/LEGO-BASELINE-AUDIT.md` (BARU — laporan audit)

## Forbidden (tegas)
- `crates/**`, `apps/**`, `reference/n8n/**`
- `deploy/**`, `scripts/**`, `tests/**`
- File existing di `packages/**` SELAIN tiga file baru di atas — DILARANG mengubah
  `runner.mjs`, `localization.mjs`, `node-catalog.mjs`, `src/*`, `workflow-lego/*`,
  `execution-lego/*` (audit = baca saja; integrasi = file adapter baru saja).
- `.github/**`, root `package.json`

## Deliverables

### 1. `packages/reconstructed-engine/LEGO-BASELINE-AUDIT.md`
Audit yang menjawab (dengan bukti path file + baris):
- `workflow-lego`: simbol apa yang tersedia (`Workflow`, graph utils, checksum),
  mengapa baseline TIDAK mengimpor kode-nya langsung (dependensi `n8n-workflow`),
  dan aturan "jangan duplikasi graph logic".
- `execution-lego`: simbol runtime (`ActiveExecutions`, `createExecutionRuntime`, ...),
  mengapa baseline TIDAK memakai lifecycle penuh-nya (butuh DB/queue/push),
  dan apa yang DIPAKAI secara konsep (error taxonomy, status lifecycle).
- `reconstructed-engine`: `WorkflowExecutionEngine` (`runner.mjs`) sebagai SATU-SATUNYA
  engine baseline; `localization.mjs` + `node-catalog.mjs` sebagai locale layer;
  `src/execution-engine.ts` sebagai referensi masa depan (bukan runtime baseline).
- Tabel keputusan: DIPAKAI / TIDAK (dengan alasan) per simbol.
- Pernyataan eksplisit: "baseline tidak membuat execution engine kedua" + cara verifikasi.

### 2. `packages/reconstructed-engine/ts-runtime-adapter.mjs` (frozen interface)
```js
export function validateBaselineWorkflow(workflow) // → { ok: boolean, errors: [{ message, hint }] }
export function createBaselineEngine(workflow, opts) // → WorkflowExecutionEngine (handler terdaftar)
export const BASELINE_KNOWN_NODE_TYPES // string[] — type dengan handler bawaan
```
- `validateBaselineWorkflow` mengimplementasikan SEMUA aturan validasi kontrak §3
  (nodes array, name/type valid, duplikat, startNode opsional via arg kedua?,
  koneksi dangling). Kembalikan errors terstruktur — JANGAN throw.
  Tanda tangan penuh: `validateBaselineWorkflow(workflow, { startNode } = {})`.
- `createBaselineEngine(workflow, { locale, input } = {})` membuat
  `WorkflowExecutionEngine`, mendaftarkan handler bawaan §4
  (manualTrigger, noOp, set-passthrough, code-skip, if-passthrough),
  dan mengembalikan engine siap `runWorkflow()`.
- Handler harus deterministik dan aman: tidak `eval`, tidak akses fs/net.
- Adapter TIDAK boleh mengimpor `apps/*`, `deploy/*`, `tests/*`, `crates/*`.

### 3. `packages/reconstructed-engine/ts-runtime-adapter.test.mjs`
- Test adapter TANPA server: validasi ok/gagal per kasus §3, engine run linear sukses,
  unknown type passthrough, locale fallback. Dijalankan via `node --test`.

## Acceptance
- Tiga file baru ada; NOL perubahan pada file existing (verifikasi via `git status`).
- `node --test packages/reconstructed-engine/ts-runtime-adapter.test.mjs` PASS.
- `apps/n8n-ts/src/engine.ts` (Worker 1) dapat memakai adapter ini tanpa perubahan adapter.
- Audit secara eksplisit memetakan ketiga LEGO dan menyatakan tidak ada engine kedua.
