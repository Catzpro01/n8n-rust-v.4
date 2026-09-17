# `@n8n-reconstructed/scheduler-lego` (POOL-006)

Rekonstruksi **1:1** inti penjadwalan murni n8n 2.9.4 — JS/TS ESM, **nol dependensi runtime**, **nol Rust** (PROJECT_RULES rule 1).

Sumber: `reference/n8n/packages/workflow/src/cron.ts`, `.../workflow/src/utils.ts:337-343` (`randomInt`),
`.../core/src/execution-engine/scheduled-task-manager.ts`, `.../core/src/execution-engine/node-execution-context/utils/scheduling-helper-functions.ts`.
Kontrak: [`../../contracts/scheduler.contract.md`](../../contracts/scheduler.contract.md) (VERIFIED).

```bash
npm test --prefix packages/scheduler-lego        # 42/42
npm run test:unit --prefix packages/scheduler-lego   # 28  (01–03)
npm run test:parity --prefix packages/scheduler-lego #  9  A/B vs n8n 2.9.4 dependency set
npm run test:golden --prefix packages/scheduler-lego #  5  konformasi golden agent-4
```

## Permukaan

| Modul | Simbol | Asal |
| :--- | :--- | :--- |
| `src/random.mjs` | `randomInt` | `n8n-workflow` `utils.ts` |
| `src/cron-expression.mjs` | `toCronExpression` | `n8n-workflow` `cron.ts` |
| `src/scheduled-task-manager.mjs` | `ScheduledTaskManager`, `toCronKey`, `flattenKeysForEvent` | `n8n-core` `scheduled-task-manager.ts` |

`CronJob` **di-injeksi** (`deps.CronJob`), tidak di-import — sehingga LEGO ini tetap nol-dependensi
dan tidak ada satu pun tes yang menunggu detak wall-clock. Suite parity menyuntik `cron@4.4.0` yang
nyata ke **kedua** belah pihak.

## Quirk yang dipatrikan (direproduksi, BUKAN diperbaiki)

| ID | Perilaku |
| :-- | :--- |
| S-01 | `randomInt` = modulo mentah → bias secara konstruksi, tanpa rejection sampling |
| S-02 | `randomInt(n)` satu-argumen berarti `[0, n)`, bukan `1..n` |
| S-03 | `toCronExpression` **tidak murni** — field detik `randomInt(60)` ditarik tanpa syarat, bahkan untuk mode `custom` |
| S-04 | `everyX` + `hours` merandomisasi detik **dan** menit |
| S-05 | `everyX` dengan selain `minutes`/`hours` melempar `TypeError` |
| S-06 | `custom` mengembalikan `cronExpression.trim()`, tidak divalidasi di sini |
| S-07 | hanya `activeInterval === 0` yang mematikan `setInterval` debug; `undefined`/`null`/negatif tetap menjalankannya |
| S-08 | peta workflow dibaca SEBELUM pengecekan duplikat dan dipakai ulang untuk `set` berikutnya |
| S-09 | `deregisterCrons` short-circuit pada map yang ada tapi KOSONG, sebelum `delete` |
| S-10 | `toCronKey` meratakan `recurrence` hanya saat `activated` truthy → dua konteks nonaktif yang hanya beda `intervalSize` bertabrakan pada satu kunci |
| T-1 | registrasi duplikat = no-op senyap + satu `errorReporter.error(..., { tags: { cron: 'duplicate' } })` |
| T-2 | follower tetap terdaftar namun tidak pernah memicu (`if (!isLeader) return`) |

Diverifikasi terhadap sumber: scheduler **tidak** menghitung tick untuk `recurrence` — tidak ada
penghitung tick; `intervalSize` hanya muncul di string `summary` dan `toCronKey`. Port ini
mempertahankan fakta itu (registry timer murni).

## Struktur

```
packages/scheduler-lego/
├── package.json
├── src/{index,random,cron-expression,scheduled-task-manager}.mjs
└── test/
    ├── helpers/{reference,fakes}.mjs
    ├── 01-random-int.test.mjs
    ├── 02-cron-expression.test.mjs
    ├── 03-scheduled-task-manager.test.mjs
    ├── 04-parity.test.mjs        (A/B vs implementasi referensi)
    └── 05-golden-conformance.test.mjs
```
