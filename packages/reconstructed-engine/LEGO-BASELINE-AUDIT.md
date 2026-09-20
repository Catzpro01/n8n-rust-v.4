# LEGO Baseline Audit — Worker 4

Tanggal: 2026-09-20 · Kontrak: `contracts/ts-baseline-runtime.contract.md` §4 + §9
Auditor: Worker 4 (LEGO Integration) · Scope: baca `workflow-lego`, `execution-lego`,
`reconstructed-engine` — tulis HANYA 3 file baru (audit ini + adapter + test adapter).

**Pernyataan utama: baseline TIDAK membuat execution engine kedua.**
Satu-satunya engine baseline adalah `WorkflowExecutionEngine` di
`packages/reconstructed-engine/runner.mjs`. Runtime `apps/n8n-ts` WAJIB delegasi
ke sana via `ts-runtime-adapter.mjs`. Cara verifikasi: `tests/runtime/08-regression.test.mjs`
+ `grep -rn "while (queue.length" apps/n8n-ts/src` harus kosong.

---

## 1. `packages/workflow-lego` — Model Graph (DOKUMENTASI SAJA di baseline)

Sumber dibaca:
- `packages/workflow-lego/src/model-surface.ts` (15-simbol frozen surface)
- `packages/workflow-lego/src/index.ts` (barrel + `LEGO_PROVENANCE`)
- `packages/workflow-lego/manifest/ownership.json`

Simbol tersedia (frozen, parity-test enforced):

| Simbol | Asal | Dipakai baseline? | Alasan |
|---|---|---|---|
| `Workflow` | `n8n-workflow` re-export (`model-surface.ts:32`) | TIDAK (kode) | butuh dep `n8n-workflow@2.9.1`; baseline nol-dep. Dipakai sebagai **rujukan perilaku** (nama unik, traversal, checksum). |
| `getChildNodes/getParentNodes/getConnectedNodes/getNodeByName` | `n8n-workflow` (`model-surface.ts:32`) | TIDAK (kode) | traversal graph penuh di luar baseline; adapter hanya validasi dangling-ref, bukan traversal. |
| `mapConnectionsByDestination` | `n8n-workflow` | TIDAK | index turunan tidak dibutuhkan untuk BFS linear baseline. |
| `calculateWorkflowChecksum` | `n8n-workflow` | TIDAK | checksum konten di luar baseline (tidak ada persistensi). |
| `compareConnections` + graph-utils (`buildAdjacencyList`, `hasPath`, ...) | `n8n-workflow/dist/cjs/*` (`model-surface.ts:19-31`) | TIDAK | diff/adjacency di luar baseline. |
| `WorkflowSnapshot`, `WorkflowParameters`, dsb (types) | `n8n-workflow` | RUJUKAN | bentuk data `nodes[]` + `connections{}` diikuti adapter. |

Aturan anti-duplikasi (mengikat Worker 1):
- JANGAN menyalin traversal (`getChildNodes` dkk), checksum, atau diff ke `apps/n8n-ts`.
- Jika baseline nanti butuh graph traversal → impor dari `@lego/workflow`, bukan tulis ulang.
- Validasi ringan di adapter (`nama unik`, `dangling-ref`) BUKAN graph engine — itu input
  validation milik API boundary, setara DTO validation di `contracts/api.contract.md`.

## 2. `packages/execution-lego` — Execution Runtime Lifecycle (KONSEP SAJA di baseline)

Sumber dibaca:
- `packages/execution-lego/src/index.ts` (re-export dari `reconstructed-engine/src/execution-engine.ts`)
- `packages/execution-lego/src/model-surface.ts` (`EXECUTION_REFERENCE`, consumed/provided ports, invarian X1–X17)
- `packages/reconstructed-engine/src/execution-engine.ts` (1547 baris — implementasi 1:1 n8n 2.9.4)

Simbol tersedia:

| Simbol | Dipakai baseline? | Alasan |
|---|---|---|
| `ActiveExecutions` (X1–X8) | TIDAK (kode) | butuh repository/persistence/concurrency/event ports + lifecycle async (`postExecutePromise`). Baseline eksekusi sinkron tanpa persistensi. |
| `ActiveWorkflows` (X9–X12) | TIDAK | aktivasi trigger/polling/cron di luar baseline (tidak ada scheduler). |
| `ExecutionContextService` + `ExecutionContextHookRegistry` (X13–X15) | TIDAK | hook decrypt/merge konteks milik deployment penuh; baseline teruskan `locale` saja. |
| `ExecutionRecoveryService` (X16–X17) | TIDAK | recovery dari event-log butuh DB + push; baseline stateless. |
| `MemoryExecutionRepository`, `MemoryExecutionPersistence`, `MemoryWorkflowRepository`, `MemoryConcurrencyControl`, `Emitter` | TIDAK | in-memory ports untuk deployment penuh; baseline tidak menyimpan eksekusi antar-request. |
| Error taxonomy (`UnexpectedError`, `OperationalError`, `UserError`, `ExecutionCancelledError`, `NodeCrashedError`, `WorkflowCrashedError`, `WorkflowActivationError`, ...) | KONSEP | envelope error baseline (`{code,message,hint}`) selaras dengan taksonomi ini; `EXECUTION_FAILED` ≈ `UnexpectedError`. Migrasi Rust nanti memetakan 1:1. |
| `createExecutionRuntime()` factory | TIDAK | perakitan deployment penuh; baseline merakit SATU engine + 5 handler via `createBaselineEngine()`. |
| `isWorkflowIdValid`, `createDeferred`, `deepMerge`, loggers | TIDAK | util port; baseline punya util sendiri yang minimal (`body.ts`, `logger.ts`). Tidak diduplikasi maknanya — hanya tidak diimpor agar nol-dep. |

Alasan arsitektur: `execution-lego` adalah runtime lifecycle PENUH (registry eksekusi aktif,
aktivasi workflow, recovery crash, push) yang membutuhkan ports DB/queue/push. Baseline adalah
runtime SINKRON STATELESS (satu request = satu eksekusi = satu response). Memakai lifecycle
penuh di baseline akan menambah kompleksitas + dependensi tanpa nilai. Yang dipakai adalah
**kontrak perilakunya** (status `COMPLETED/failed/crashed`, envelope error, item shape
`[{json}]`) agar migrasi ke lifecycle penuh nanti bersifat aditif, bukan rewrite.

## 3. `packages/reconstructed-engine` — SATU-SATUNYA engine baseline (DIPAKAI PENUH)

### 3.1 `runner.mjs` — `WorkflowExecutionEngine` (DIPAKAI — inti baseline)

- Konstruktor `(workflowDefinition, options)` — `runner.mjs:22-51`: registry node + koneksi + locale.
- `registerNodeType(typeName, handler)` — `runner.mjs:53-55`: satu-satunya cara menambah perilaku node.
- `runWorkflow(startNodeName, initialData, options)` — `runner.mjs:78-174`: **loop BFS DAG**,
  passthrough untuk type tanpa handler (`runner.mjs:119-124`), `executionLog` + `data` (`runner.mjs:126-164`),
  locale enforce terakhir (`runner.mjs:172`).
- `interceptApiResponse`, `localizeNodeMetadata`, `setLocale/getLocale` — locale boundary.

Keputusan: runtime WAJIB memanggil `runWorkflow()` ini. Loop BFS di `runner.mjs:100-165`
adalah SATU-SATUNYA loop eksekusi yang boleh ada. Duplikatnya di `apps/n8n-ts` = pelanggaran.

### 3.2 `localization.mjs` + `node-catalog.mjs` (DIPAKAI — via engine, tidak langsung)

- `UniversalLocaleEnforcer`, `normalizeSupportedLocale`, `SUPPORTED_LOCALE_CODES`
  (`localization.mjs:14, ±500 baris`) — hanya field human-facing yang diterjemahkan;
  machine tokens (`name/type/value/...`) diproteksi.
- `registerBuiltInNodeCatalog`, `nodeAliasOf`, `getNodeCatalogEntry`, `BUILTIN_NODE_ALIASES`
  (`node-catalog.mjs`, 626 baris) — label/deskripsi 6 locale untuk 15 node inti.
- Runtime TIDAK mengimpor keduanya langsung — cukup lewat engine (`activeLocale`).
  Test membuktikan additive-only: machine fields tak berubah apa pun locale-nya.

### 3.3 `src/execution-engine.ts` (TIDAK DIPAKAI di baseline — referensi migrasi)

File 1547-baris ini adalah implementasi TypeScript 1:1 dari `execution-lego` (X1–X17).
Baseline tidak mengimpornya karena: (a) butuh kompilasi TS + ports deployment;
(b) lifecycle-nya (registry/recovery/push) di luar kebutuhan sinkron-stateless.
Status: **referensi terverifikasi untuk migrasi Rust tahap 2** (setelah baseline frozen),
bukan dead code — test-nya tetap dijaga (`execution-lego/test/*`).

### 3.4 File TS lain di `src/` (TIDAK DIPAKAI di baseline)

`engine-i18n.ts`, `localized-run-reporter.ts`, `node-catalog-dictionary.ts`,
`binary-buffer-manager.ts`, `paired-item-tracker.ts`, `persistence-integrity.ts`, dsb
adalah perluasan locale/persistensi enterprise. Baseline memakai `.mjs` seam
(`runner/localization/node-catalog`) yang sudah stabil + ter-test, bukan permukaan TS
eksperimental. Tidak ada yang diduplikasi ke runtime.

## 4. Adapter `ts-runtime-adapter.mjs` — desain keputusan

| Keputusan | Rasional |
|---|---|
| `validateBaselineWorkflow()` kembalikan `{ok, errors}` — jangan throw | error API butuh `hint` terstruktur; throw hanya untuk bug internal. |
| Validasi dangling-ref untuk source DAN target koneksi | kontrak §3: keduanya `UNKNOWN_NODE`. |
| `main` non-array → `MALFORMED_REQUEST`; tipe koneksi non-`main` diabaikan | kontrak §4: hanya `main` dibaca baseline. |
| `set` = passthrough murni | transform `keepOnlySet/values` adalah semantik parameter penuh (butuh expression engine) — di luar baseline. |
| `code` = passthrough + `codeSkipped:true`, TANPA eval | eksekusi JS user = sandbox work (P1 security-sandbox), dilarang di baseline. Marker membuat perilaku eksplisit + ter-test. |
| `if` = passthrough | branching multi-output butuh routing engine (`connection` LEGO) — di luar baseline. |
| `manualTrigger` abaikan input, kembalikan `triggeredAt+status` | meniru trigger n8n: memulai rantai dengan item segar. |
| Unknown type = passthrough (diwarisi `runner.mjs:119-124`) | kompatibel n8n (node tak dikenal tidak mematikan baseline); dicatat di log server sebagai `warn`. |

## 5. Peta akhir: apa dipakai di mana

```
POST /api/v1/workflows/run
  └─ apps/n8n-ts/src/routes/run.ts          (Worker 1: HTTP boundary, envelope)
       ├─ validateBaselineWorkflow()         (Worker 4: adapter, kontrak §3)
       └─ createBaselineEngine()             (Worker 4: adapter, kontrak §4)
            └─ WorkflowExecutionEngine       (runner.mjs — SATU-SATUNYA engine)
                 ├─ UniversalLocaleEnforcer  (localization.mjs — additive-only)
                 └─ node catalog             (node-catalog.mjs — label/deskripsi)

TIDAK dipakai baseline (terdokumentasi, bukan dihapus):
  workflow-lego/*  (graph/checksum/diff — nol-dep baseline, rujukan perilaku)
  execution-lego/* (lifecycle penuh X1–X17 — butuh DB/queue/push)
  reconstructed-engine/src/* (perluasan TS — referensi migrasi Rust)
```

## 6. Risiko + mitigasi

| Risiko | Mitigasi |
|---|---|
| Worker 1 tergoda menulis loop eksekusi sendiri | adapter menyediakan engine siap pakai; regression test grep loop BFS; review manajer. |
| Validasi menyimpang antara adapter dan runtime | runtime DILARANG validasi sendiri selain envelope HTTP (`content-type`, `body-limit`, `input` shape); semua validasi workflow via adapter. |
| Locale mengubah machine fields | `localization.mjs` proteksi token; test adapter + regression menegaskan additive-only. |
| `n8n-workflow` dep menyusup ke runtime | `apps/n8n-ts/package.json` `dependencies:{}` — CI gagal jika ada dep runtime. |
