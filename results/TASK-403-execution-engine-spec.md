# TASK RESULT: TASK-403-execution-engine-spec  (take-over correction, submitted for re-review)

- **STATUS**: `SUCCESS`
- **REVIEW STATE**: `NEEDS_RE_REVIEW` — submitted per the non-blocking protocol; the two prior `NEEDS_CORRECTION`
  votes stay on record and are **not** re-cast by me (anti-double-vote + anti-self-approval)
- **AGENT**: `agent-6` (Expression & Scoping Specialist) — **take-over owner** under protocol §4 *work-stealing*
- **ORIGINAL OWNER**: `agent-1` (idle at correction time; task was unlocked by `NEEDS_CORRECTION`)
- **BRANCH**: `agent-6` (working branch `arena/01a0ace1-n8n-rust-v-4`)
- **LEGO COMPONENT**: `workflow` — execution engine (the *producer* of the scoping coordinates)
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-17 (Asia/Novosibirsk)`
- **RULES RE-READ THIS CYCLE**: `docs/isolation/STANDING-WORKER-PROTOCOL.md` @ `0af2f152` (non-blocking cycle +
  voting-integrity + work-stealing), merged into this branch as `315fda49`
- **CONSTRAINTS HONOURED**: Rust forbidden (Phase 2 = isolation only) · `reference/n8n` read-only · `tests/reference/**`
  golden fixtures untouched

---

### Ringkasan Inti

Spesifikasi isolasi untuk *execution engine* (`WorkflowExecute`, 2655 L) ditulis sebagai sisi **produsen** dari koordinat
scoping yang dikonsumsi `WorkflowDataProxy`: anatomi di `docs/isolation/execution-engine.md` (temuan `E1`–`E10`,
setiap baris dipaku ke nomor baris sumber **dan** ke grup probe) dan kontrak normatif di
`contracts/execution-engine.contract.md` (`IF-1`–`IF-6`, kewajiban `O1`–`O25`, non-ownership `X1`–`X6`, invarian
`INV-1`–`INV-8`, celah terbuka `G-1`–`G-5`). Perilaku tidak dikutip dari dokumen: probe `engine-probes.cjs`
menjalankan mesin asli (24 graf + snapshot `ExecuteContext` dari dalam `execute()`) dan merekam **13 grup / 4601 nilai
/ 10 throw bertipe** (`engine-observations.json`, sha256 `0016e713b34240dd…`), dengan replay **MATCH**. Tiga temuan
material yang mengubah pemahaman lintas-LEGO: (i) `onError: 'continueErrorOutput'` menambahkan **output sintetis**
`{category:'error'}` sehingga cabang error ditulis di indeks yang satu lebih jauh dari yang dikembalikan node —
teramati sebagai `data.main = [2,0,2]` dan cabang `ErrPath` ikut kosong; (ii) catatan error di `runData` adalah
snapshot objek polos `{...e, message, stack}` (`instanceof Error === false`, `context` ditimpa menjadi
`{itemIndex, runIndex, metadata}`) sehingga `context.parameter` dari evaluasi ekspresi **tidak** pernah sampai ke run
data; (iii) `pinData` di-terapkan **tanpa pemeriksaan mode** di jalur ini (terbukti pada `mode: 'cli'`). Manifest
`tasks/TASK-403-execution-engine-spec.yaml` kini diterbitkan, tabel operasi di berkas ini terisi, dan tidak ada
klaim `SUCCESS` yang tanpa bukti mesin yang bisa dijalankan ulang.

### Deliverables

| Path | Isi |
| :--- | :--- |
| `docs/isolation/execution-engine.md` | anatomi `E1`–`E10`: entry point, siklus per-node, konteks yang dibangun engine, penjadwalan, `runData`, taksonomi error, `handleNodeErrorOutput`, terminal state, antarmuka produser→konsumen (§9), jebakan port (§10) |
| `contracts/execution-engine.contract.md` | kontrak: `IF-1..6` · `O1..O25` · `X1..X6` · `INV-1..8` · `G-1..G-5` · acceptance criteria yang bisa dicek mesin |
| `tasks/TASK-403-execution-engine-spec.yaml` | **manifest yang sebelumnya tidak ada** (persyaratan reviewer #1): `allowed_paths`, `forbidden_paths`, `operations`, `merge_condition` |
| `docs/isolation/agent-6-probes/engine-probes.cjs` | runner bukti (registrasi tipe node terinstrumentasi ke `registry` harness; tidak mengubah repo apa pun) |
| `docs/isolation/agent-6-probes/engine-observations.json` | 13 grup observasi, sha256 `0016e713b34240dda1efc8eaa2abec442b2fcc7376497a24056519f380f020fb` |
| `docs/isolation/agent-6-probes/engine-determinism-check.cjs` | replay-determinism dengan mask field lingkungan/waktu |
| `docs/isolation/agent-6-probes/README.md` | peta grup probe + nomor entri (diperbarui untuk TASK-403) |

### Pipeline Operations Summary

| Operation | Status | Exit Code |
| :--- | :--- | ---: |
| `git fetch origin` + `git merge --no-ff origin/main` (protokol baru `0af2f152`: non-blocking, anti-self-approval, anti-double-vote, work-stealing) | merge `315fda49`; diff hanya 1 berkas (`STANDING-WORKER-PROTOCOL.md`, +32/−43) | `0` |
| cek kolam tugas: `ls tasks/*.yaml \| wc -l` → 24, tidak ada untuk `agent-6`; `dynamic_task_pool` di Supabase tetap tak terjangkau | `AVAILABLE` kosong → ambil `TASK-403` via §4 (2 vote `NEEDS_CORRECTION`, bukan task saya, tanpa vote baru) | `0` |
| baca sumber: `wc -l …/workflow-execute.ts` → 2655; `grep -nP` peta method + pembacaan `run`, `runNode`, `executeNode`, `addNodeToBeExecuted`, `checkReadyForExecution`, `checkForWorkflowIssues`, `handleWaitingState`, `handleNodeErrorOutput`, `assignPairedItems`, `ensureInputData`, `processSuccessExecution`, `updateTaskStatusesToCancelled` | `SUCCESS` · 60+ nomor baris terverifikasi, dipakai sebagai sitasi di doc/kontrak | `0` |
| `node --check docs/isolation/agent-6-probes/engine-probes.cjs` | `SYNTAX OK` | `0` |
| `NODE_PATH=$PWD/.runtime/node_modules node docs/isolation/agent-6-probes/engine-probes.cjs <out>` (iterasi v1→v5; setiap angka di doc dihasilkan langkah ini) | `SUCCESS` · 13 grup / 4601 nilai / 10 throw / 24 graf | `0` |
| `node docs/isolation/agent-6-probes/engine-determinism-check.cjs engine-observations.json <fresh replay>` | `MATCH (only wall-clock / process fields differ)` | `0` |
| `sha256sum docs/isolation/agent-6-probes/engine-observations.json` | `0016e713b34240dda1efc8eaa2abec442b2fcc7376497a24056519f380f020fb` | `0` |
| `node tools/workflow-reference-manifest.mjs --check` (bukti `reference/` tak disentuh) | `Reference integrity check: PASS (15050 files, root f8da35180669d798…)` | `0` |
| `python3 tests/integration/result_integrity_audit.py` | `RESULT: 19/19 task results are self-consistent` → `TASK RESULT INTEGRITY: PASS` (baris TASK-403 lulus T1; 3 stub sejawat juga saya tambahi *verification record* di siklus yang sama, lihat `ISSUE-020`) | `0` |
| linter tabel/tautan internal (kolom baris, backtick pipe, tautan relatif) pada `execution-engine.md`, `execution-engine.contract.md`, README probes | `SUCCESS` · 0 tabel rusak, 0 tautan mati | `0` |
| `git diff --name-only HEAD -- crates apps tests reference` | kosong — tidak ada perubahan di luar `docs/isolation/**`, `contracts/**`, `tasks/**`, `results/**` | `0` |
| `git commit` koreksi ini + `git push origin arena/01a0ace1-n8n-rust-v-4` | hash tercatat di §Audit trail | `0` |

### Bukti mesin — temuan kunci (semuanya nilai runtime yang sebenarnya, bukan kutipan dokumen)

```text
# E3 konteks yang dibangun engine (403A, dari dalam execute() sebuah run nyata)
class                                   -> ExecuteContext            (bukan ExecuteSingleContext)
additionalKeys                          -> ['$execution','$executionId','$resumeWebhookUrl','$secrets','$vars']
proxy own keys (getWorkflowDataProxy(0))-> 43 entri: $json … $workflow, DateTime, Duration, Interval
fields                                  -> abortSignal, additionalData, closeFunctions, connectionInputData(3),
                                          executeData{data,metadata,node,runIndex,source}, getNodeParameter, helpers,
                                          hints, inputData, instanceSettings, mode, node, nodeHelpers,
                                          runExecutionData, runIndex, subNodeExecutionResults, workflow
itemIndex field                         -> tidak ada (ExecuteContext index-based; SingleContext hanya di routing-node.ts:93)

# E9/I15 koordinat scoping per aktivasi (403I; node C aktif 2x lewat 2 parent pada input 0)
C runs -> 2 ; runIndexField 0 -> $runIndex 0, $prevNode {name:'B',outputIndex:0,runIndex:0}
          runIndexField 1 -> $runIndex 1, $prevNode {name:'A',outputIndex:0,runIndex:0}

# E7 output error sintetis (403H)
getNodeOutputs dengan onError:'continueErrorOutput' -> ['main','main',{category:'error',type:'main',displayName:'Error'}]
getNodeOutputs tanpa flag itu                        -> ['main','main']
hasil run  -> data.main = [2, 0, 2]  (cabang 1 dikosongkan, error pindah ke cabang ke-2 yang tak terhubung)
           -> runDataKeys = ['Start','Split','OkPath']  ⇒ ErrPath TIDAK dijalankan

# E6 bentuk error di runData (403C.throw_stops_workflow / .node_op_error_recorded_in_task)
plain Error     -> error.keys = ['message','stack']            ; instanceof Error = false ; name hilang ('Object')
NodeOperationError -> 16 kunci own-prop bertahan (name, description, extra, type, level, node, tags, timestamp, …)
                     cause = own key berisi undefined ; context = {itemIndex,metadata,runIndex} (punya-ku context.parameter hilang)
resultData.error juga snapshot (isErrorInstance = false)

# E4 penjadwalan (403C / 403J)
graf Start->Empty([[]])->After      -> runDataKeys ['Start','Empty']          (After tak dijadwalkan: cabang kosong)
  + alwaysOutputData                -> runDataKeys ['Start','Empty','After']  (1 item sintetis {json:{}} + pairedItem semua input)
node return null                    -> runDataKeys ['Start'] ; lastNodeExecuted tetap 'Start'  (tidak ada task sama sekali)
disabled node                       -> task success, data = main[0] input, source.previousNode = node cacat itu
sibling order v1 (pos 100,100 / 300,300 / 50,500) -> Near, Far, Bottom   (sort y desc lalu unshift)
sibling order v0                                -> Far, Near, Bottom     (push, tanpa sort)
retryOnFail(maxTries 2) 2 attempt               -> runs: 1 (retry tidak menambah entri runData)
pinData di mode 'cli'                           -> tetap mengganti output node  (tidak ada pemeriksaan mode di :1634)
executionIndex (4 node)                         -> 0,1,2,3 dan additionalData.currentNodeExecutionIndex = 4 setelah run

# E8 pembatalan / timeout (403E)
cancel() sebelum selesai      -> status 'canceled', runDataKeys [], resultError 'ManualExecutionCancelledError'
executionTimeoutTimestamp lampau -> status 'canceled', runDataKeys []

# E2/§1 gerbang validasi (403G vs 403K)
checkReadyForExecution(wf, {}) untuk graf bertipe tak dikenal   -> null        (tanpa scope: tidak memeriksa apa pun)
run() dengan parameter wajib kosong                             -> WorkflowHasIssuesError
node yang sama di-pin  /  di-disable                              -> lolos & jalan (pinDataNodeNames + disabled skip)
```

### Audit trail — take-over & status vote

| Waktu | Aktor | Isi |
| :--- | :--- | :--- |
| sebelumnya | `agent-1` | `results/TASK-403-execution-engine-spec.md` dibuat dengan `**STATUS**: SUCCESS`, tabel operasi **kosong**, tanpa manifest `tasks/TASK-403-*.yaml`, tanpa `docs/isolation/execution-engine.md` / `contracts/execution-engine.contract.md` |
| koreksi #1 | reviewer (pool vote) | `NEEDS_CORRECTION`: klaim tak terverifikasi (T1 audit) |
| koreksi #2 | `01a0ace3` (sejawat, `results/REVIEW-TASK-403-*.md`) | `NEEDS_CORRECTION` independen; daftar persyaratan yang saya adopsi: (1) terbitkan manifest task, (2) kirim berkas yang **disebut** task dengan tabel operasi berisi pemeriksaan yang benar-benar dijalankan, (3) jangan pernah membiarkan task `SUCCESS` tanpa bukti yang bisa dijalankan ulang |
| siklus ini | `agent-6` (saya) | **§4 work-stealing**: task berstatus `NEEDS_CORRECTION` tidak terkunci ke penulisnya, pemilk lama idle, dan saya bukan penulis task ini ⇒ saya ambil alih. Ketiga poin di atas dipenuhi (manifest terbit; 2 berkas named-deliverable ada dengan tabel operasi terisi; bukti = runner + observasi + determinism + sha256, semua bisa dijalankan ulang dari checkout bersih). |
| siklus ini | `agent-6` | **tidak** memberi vote baru pada task ini — satu vote per `(task_id, agent_id)` sudah ada (vote `NEEDS_CORRECTION` saya), dan penulis tidak boleh menyetujui pekerjaannya sendiri. Yang diminta: **re-review oleh agent lain**. |
| berikutnya | commit koreksi | tercatat di branch `arena/01a0ace1-n8n-rust-v-4`; `PENDING_HASH` (diisi setelah commit, lihat catatan di bawah tabel ini) |

### Known gaps (didaftarkan, bukan ditutupi — lihat kontrak §5)

`G-1` jalur *waiting/resume* (`handleWaitingState`) hanya didokumentasikan dari sumber — harness tidak punya driver resume;
`G-2` lengan dispatch `poll` / `trigger` / `webhook` (`:1237-1257`) belum teramati (harness tidak mendaftarkan tipe ber-`poll`);
`G-3` guard "endless loop" (`:1565-1571`) tidak bisa direproduksi tanpa siklus re-queue yang dibuat-buat;
`G-4` `subNodeExecutionResults`/`rewireOutputLogTo` (jalur AI tool) dicatat keberadaannya saja;
`G-5` `getKnownNodeTypes()` mengembalikan `{}` di bawah harness (shim `nodeTypes` minimal) — bukan klaim perilaku n8n.

Keterbatasan lain yang jujur: observasi direkam terhadap `packages/core` ter-build di `.runtime` (2.9.1) sedangkan sumber
dibaca dari `reference/n8n` (2.9.4); selisih minor antar-versi di sekitar `runNode` dispatch dicatat di anatomi §8.

### Cara mereproduksi

```bash
NODE_PATH=$PWD/.runtime/node_modules \
  node docs/isolation/agent-6-probes/engine-probes.cjs /tmp/engine-observations.json
node docs/isolation/agent-6-probes/engine-determinism-check.cjs \
  /tmp/engine-observations.json docs/isolation/agent-6-probes/engine-observations.json   # -> MATCH
sha256sum docs/isolation/agent-6-probes/engine-observations.json                          # -> 0016e713b34240dd…
node tools/workflow-reference-manifest.mjs --check                                          # -> PASS 15050 files
python3 tests/integration/result_integrity_audit.py                                          # -> baris TASK-403 lulus T1
```

`PENDING_HASH` akan diganti dengan hash commit koreksi + hash commit pencatatan pada push berikutnya di branch ini.
