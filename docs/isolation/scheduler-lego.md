# POOL-006 — Scheduler LEGO (isolation note)

**TASK_ID**: `POOL-006-scheduler-lego`
**AGENT**: `agent-1` (Arena session `arena/01a0aff7-n8n-rust-v-4`)
**BRANCH**: `arena/01a0aff7-n8n-rust-v-4`
**BASE**: `1dafb0d0`
**REFERENCE**: n8n 2.9.4 (upstream `b6dc2787c45677a29a9612cd27eb911302961a83`)
**CONTRACT**: `contracts/scheduler.contract.md` (VERIFIED)

## 1. Alasan pengambilan lane

Lane `scheduler` diambil setelah menyurvei lane yang kontraknya sudah ada namun belum punya paket
rekonstruksi (`api`, `credentials`, `scheduler`, `trigger`, `webhook`) dan memastikan tidak ada peer
branch yang sedang mengerjakannya. `scheduler` dipilih karena permukaannya paling kecil dan murni,
serta memungkinkan verifikasi A/B terhadap dependensi referensi yang sudah terpasang.

## 2. Ruang lingkup

| Berkas | Isi |
| :--- | :--- |
| `packages/scheduler-lego/src/random.mjs` | `randomInt` |
| `packages/scheduler-lego/src/cron-expression.mjs` | `toCronExpression` |
| `packages/scheduler-lego/src/scheduled-task-manager.mjs` | `ScheduledTaskManager`, `toCronKey`, `flattenKeysForEvent` |
| `packages/scheduler-lego/src/index.mjs` | barrel |

**Tidak** direkonstruksi (dan tidak akan): eksekusi akibat tick, HTTP activation endpoint,
penghitung tick `recurrence` — lihat §5.

## 3. Dependensi

**Nol dependensi runtime.** `CronJob` di-injeksi lewat `deps.CronJob`; verifikasi A/B menyuntik
`cron@4.4.0` nyata dari `.runtime/node_modules` ke implementasi port **dan** implementasi referensi.
`reference/n8n/**` bersifat read-only dan tidak disentuh; tidak ada berkas `.rs` atau `Cargo.toml`
yang ditambahkan (PROJECT_RULES rule 1). Tidak ada berkas frontend yang diubah (rule 2).

## 4. Bukti mesin

| Pemeriksaan | Hasil |
| :--- | :--- |
| `node --test test/*.test.mjs` | **42/42 PASS** |
| `test:unit` (01–03) | **28/28 PASS** |
| `test:parity` (04, A/B vs referensi nyata) | **9/9 PASS** |
| `test:golden` (05, golden agent-4) | **5/5 PASS** |
| Meta-test mutasi M1 / M2 / M3 / M4 | keempatnya **FAIL saat port dirusak** → suite punya gigi |

Mutation matrix (dijalankan hanya pada suite parity):

| Mutan | Perusakan | Hasil |
| :--- | :--- | :--- |
| M1 | `toCronKey` tanpa `.sort()` | 6 pass / **3 fail** |
| M2 | `summary` mengabaikan `recurrence` | 8 pass / **1 fail** |
| M3 | menit `everyX`+`hours` dipatok 0 (S-04 dihapus) | 8 pass / **1 fail** |
| M4 | short-circuit entri-kosong S-09 dihapus | 8 pass / **1 fail** |

## 5. Temuan yang perlu diketahui lane lain

1. **Kontrak §4 vs implementasi.** Kontrak menyatakan scheduler menghormati `recurrence` dengan
   menghitung tick. Itu **tidak** diimplementasikan di `scheduled-task-manager.ts` — tidak ada
   penghitung tick; `intervalSize` hanya muncul pada string `summary` dan pada `toCronKey`.
   Gerbang `everyX` yang sesungguhnya hidup di
   `nodes-base/nodes/Schedule/GenericFunctions.ts` (aritmatika modulo `lastExecution`).
   Scheduler adalah **registry timer murni**; port ini mempertahankan fakta tersebut.
2. **T-1 menjelaskan golden `activateAlreadyActive`.** Pengaktifan kedua tidak pernah menggandakan
   eksekusi karena registrasi duplikat adalah no-op senyap + satu laporan error — itulah sebabnya
   golden tetap mencatat `triggerCount: 1`.
3. **Baris eksekusi golden** (`mode: 'trigger'`, `status: 'success'`) adalah wilayah
   Trigger LEGO + execution engine, **bukan** scheduler. Ditegaskan oleh pengujian penolakan di
   `test/05-golden-conformance.test.mjs`.
4. `ScheduledTaskManager` **bukan** ekspor tingkat-atas `n8n-core`; untuk A/B ia dimuat via
   `require('<rt>/n8n-core/dist/execution-engine/scheduled-task-manager.js')`.
   `toCronExpression` **adalah** ekspor `n8n-workflow`.
5. `cron@4` yang dijalankan nyata menahan event loop; setiap pengujian harus menghentikan job
   (`deregisterAllCrons`) atau `node --test` tidak akan pernah keluar. Ini yang membuat lari
   perdana suite parity menggantung ~800 s tanpa keluaran.
