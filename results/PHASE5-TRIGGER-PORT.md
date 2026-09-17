# TASK RESULT: PHASE5-TRIGGER-PORT — registry trigger 1:1 + gate T01–T06

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-3` (Arena session `arena/01a0b104-n8n-rust-v-4`) — hardening untuk LEGO 07
- **LEGO COMPONENT**: `trigger` (`ActiveWorkflows` + validasi aktivasi + helper cron)
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-18`

---

## Ringkasan (5 kalimat)

1. `trigger-engine.ts` (dan salinan `InternalTriggerEngine` di facade) bukan rekonstruksi: ia
   mengarang semantik sendiri — menolak aktivasi kedua (`Workflow is already active`), menolak
   workflow tanpa node trigger dengan pesan yang sebenarnya milik **lapisan API**, dan
   `allActive()` memakai urutan penyisipan.
2. Saya ganti dengan port setia ke tiga sumber referensi: `n8n-core` `ActiveWorkflows`,
   `n8n-workflow` `WorkflowActivationError`/`WorkflowDeactivationError`/`TriggerCloseError` +
   `validateWorkflowHasTriggerLikeNode` (+ `STARTING_NODES`), dan `toCronExpression`/`randomInt`
   (berbasis `crypto.getRandomValues`, sama seperti referensi).
3. Facade sekarang memakai port itu (salinan `InternalTriggerEngine` dihapus) dan menjalankan
   kebijakan lapisan API secara eksplisit: validasi `STARTING_NODES` sebelum registrasi, sehingga
   workflow yang hanya berisi `manualTrigger` **ditolak** — sesuai perilaku n8n asli.
4. Gate baru `npm run trigger:check` (T01–T06) menjalankan port dan kelas referensi berdampingan atas
   **objek `Workflow` yang sama** dengan stub logger/poller/cron agar urutan panggilan ikut
   dibandingkan: **6/6 check · 78 panggilan diferensial · 0 divergensi**.
5. Empat kontrol negatif menggigit (urutan `Object.keys`, pembungkusan error aktivasi, skip node
   `disabled`, field menit acak pada `everyX/hours`), suite trigger-lego naik **2/2 → 13/13**, dan
   seluruh baterai tetap hijau: `verify` 12/12 · connection 9/9 · i18n 5/5 · engine typecheck 0 error.

---

## 1. Sebelum vs sesudah

| Aspek | Sebelum | Sesudah |
| :--- | :--- | :--- |
| Aktivasi kedua | `throw new Error('Workflow is already active')` | **legal** — trigger dijalankan lagi, entri diganti (seperti referensi) |
| Workflow tanpa trigger | `throw` di registry | diterima dengan `triggerResponses: []`; penolakan ada di lapisan API |
| Validasi aktivasi | tidak ada (heuristik `type.includes('trigger')`) | `validateWorkflowHasTriggerLikeNode` port + `STARTING_NODES` |
| `allActive()` | urutan penyisipan (`Map`) | `Object.keys` (id numerik lebih dulu) |
| Error | `Error` generik | `WorkflowActivationError` / `WorkflowDeactivationError` / `TriggerCloseError` dengan `name`, `message`, `node`, `workflowId`, `level` yang sama |
| `toCronExpression` | `Math.random`, `everyHour` kehilangan field menit (bug) | port `crypto`-based yang identik dengan `workflow/src/cron.ts` |
| Duplikasi kode | facade punya salinan kedua | satu port, dipakai facade |
| Cakupan tes | 2 tes boundary | 13 tes perilaku + 78 panggilan diferensial |

## 2. Gate `T01`–`T06`

| Check | Cakupan | Oracle |
| :--- | :--- | :--- |
| `T01` | 7 export + 6 anggota registry | `ActiveWorkflows.prototype` |
| `T02` | add, add ganda, workflow tanpa trigger, `get`, urutan id, `remove` dua kali, remove-all | `ActiveWorkflows` atas objek `Workflow` yang sama |
| `T03` | error aktivasi (name/message/node/level/`cause` yang tidak diekspos), close-error yang dilaporkan vs dibungkus, state akhir | idem |
| `T04` | `validateWorkflowHasTriggerLikeNode` — node disabled, tipe tak dikenal, `STARTING_NODES` | `n8n-workflow` fungsi asli |
| `T05` | `toCronExpression` 8 bentuk × 3 undian acak (crypto dibekukan) | `n8n-workflow` `toCronExpression` |
| `T06` | `packages/trigger-lego/test/*.test.mjs` | 13/13 |

Negatif kontrol: `T02` menangkap urutan penyisipan; `T03` menangkap error yang tidak dibungkus;
`T04` menangkap node `disabled` yang tidak dilewati; `T05` menangkap field menit acak yang hilang.

## 3. Perubahan perilaku yang disengaja (dan alasannya)

- **`manualTrigger` tidak bisa mengaktifkan workflow** — `STARTING_NODES` milik CLI dipakai facade.
  Suite integrasi diperbarui: skenario 06 kini memakai `n8n-nodes-base.scheduleTrigger` **dan**
  memaku penolakan untuk `manualTrigger`.
- **Pesan "Workflow cannot be activated…"** tetap ada, tetapi sekarang berasal dari validator
  lapisan API (tempatnya di n8n), bukan dari registry.

## 4. Perintah verifikasi

```bash
npm run trigger:check      # T01..T06 · 6/6 · 78 differential calls
node --test packages/trigger-lego/test/*.test.mjs     # 13/13
npm run engine:typecheck   # 0 errors (strict)
npm run verify             # 12 gates G01-G12 · live 7/7 · BEHAVIOR CHANGE NONE
npm run connection:check && npm run i18n:check        # 9/9 · 5/5
```

## 5. Rekonsiliasi dengan track spesifikasi paralel (commit `81954043`)

Branch ini juga menerima track paralel **Phase 4-13 "trigger spec"** (invariant T1–T10 di
`packages/trigger-lego/src/model-surface.ts` + 4 tes boundary) yang menulis ulang file yang sama.
Rebase menabrak file itu; penyelesaiannya:

- port referensi dipertahankan sebagai `TriggerEngine` (dipakai facade + diverifikasi gate), dan
- seluruh permukaan spesifikasi track paralel (`ActiveWorkflows` spek, `createManualTrigger`,
  `shouldAddTriggersAndPollers`, `activationError`, `POLL_INTERVAL_TOO_SHORT`, tipe
  `WorkflowActivateMode`/`TriggerHandle`/`PollHandle`) dipulihkan **verbatim** di bagian bawah file
  yang sama dengan catatan bahwa itu bukan yang dipakai facade.

Perbedaan semantik yang terdokumentasi antar keduanya: `ActiveWorkflows` spek menolak aktivasi kedua
(`Workflow is already active`) dan menelan `TriggerCloseError`; referensi `n8n-core` **mengizinkan**
aktivasi kedua dan **melaporkan** (bukan menelan) `TriggerCloseError` lewat error reporter. Registry
referensi yang dipakai produksi; penamaan tetap jelas agar tidak ada dua kebenaran yang tersembunyi.

## 6. Catatan terbuka (bukan bagian task ini)

- Cabang **polling** (`activatePolling`) didelegasikan lewat hook `polling`; implementasinya milik
  Scheduler LEGO (deviation tercatat di manifest). Saat LEGO 09 menyediakan `ScheduledTaskManager`
  penuh, hook itu bisa diisi dan `T`-check ditambah untuk jalur poll.
- `packages/trigger-lego` masih paket stub (manifest + model-surface); teks port hidup di
  `packages/reconstructed-engine` mengikuti pola paket engine lainnya. Pemindahan fisik ke paket LEGO
  menunggu keputusan struktur (ISSUE-021) bersama LEGO lain.
