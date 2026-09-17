# TASK RESULT: TASK-PIPE-13

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-6`
- **BRANCH**: `agent-6` (working branch `arena/01a0ace1-n8n-rust-v-4`)
- **PERAN SESAAAT (Role)**: Expression & Scoping Specialist
- **LEGO COMPONENT**: `expression` — execution-context / variable-lookup half
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-17 (Asia/Novosibirsk)`
- **RULES**: Rust forbidden · results in `docs/isolation/` + `contracts/` · `reference/n8n` read-only

---

### Ringkasan Inti

Anatomi penuh resolusi variabel pada `WorkflowDataProxy` (`$json`, `$binary`, `$node`, `$('X')`,
`$parameter`, `$input`, `$prevNode`, `$now`, `$env`, `$vars`, `$fromAI`, `$tool`, …) tercatat di
`docs/isolation/variable-lookup-scoping.md`, kontrak normatifnya di `contracts/variable-lookup.contract.md`
(tupel scoping 14-nilai, tabel resolusi per-kunci, aturan `$parameter` P1–P6, algoritma item-lineage
A1–A8, matriks pin-data/`throwOnMissingExecutionData`, invarian I1–I14). Semua perilaku direkam dari
runtime asli lewat `WorkflowExecute` sungguhan (bukan stub): 214 entri `PIPE-13` + fixture 23 baris,
termasuk 3 eksekusi engine live di `13C_core_glue` dan blok `13E_gap_closure` yang menutup keempat baris
`PARTIAL` kontrak (`$fromAI`, `$tool`, `$agentInfo`, `resolveSourceOverwrite`/lineage) dengan 42 rekaman baru. Penemuan paling penting untuk port: `$parameter`
tidak membaca `node.parameters` mentah melainkan hasil **rewrite konstruktor `Workflow`**
(`NodeHelpers.getNodeParameters(..., returnDefaults=true, returnNoneDisplayed=false)`); `additionalKeys`
adalah input *required* yang mendominasi sebagian kunci tetapi **bisa** di-shadow untuk kunci lain —
yang menentukan adalah **urutan spread** (`...additionalKeys` di L1544, jadi kunci yang dideklarasikan
setelahnya kebal), dan trap `has(){ return true }` membuat identifier tak dikenal ber-resolusi ke
`undefined` alih-alih `ReferenceError`. Empat koreksi presisi muncul saat verifikasi akhir dan sudah masuk
kontrak: bendera `throwOnMissingExecutionData:false` hanya berlaku untuk `$json`/`$data`/`$binary`/`$tool`
(jalur short-syntax), **tidak** untuk `$node['X'].json`; `$node['X'].runIndex` pada node yang belum jalan
= `-1`; n8n punya **dua** pesan hampir identik (`Referenced node doesn't exist` vs
`Referenced node does not exist`) dari dua jalur kode yang berbeda; dan regex kunci `$fromAI`
`/^[a-zA-Z0-9_-]{0,64}$/` tidak konsisten dengan pesannya sendiri yang menyebut "1 and 64 characters".

### Deliverables

| Berkas | Isi |
| :--- | :--- |
| `docs/isolation/variable-lookup-scoping.md` | anatomi: permukaan konteks `node-execution-context`, tuple scoping, algoritma lookup per getter, `getPairedItem`, taksonomi error, L1–L16 |
| `contracts/variable-lookup.contract.md` | kontrak normatif irisan lookup (interface + tabel resolusi + P1–P6 + A1–A8 + I1–I14 + acceptance criteria) |
| `docs/isolation/agent-6-probes/{expression-probes.cjs,observations.json,determinism-check.cjs,README.md}` | oracle mesin yang dipakai kedua dokumen (grup `PIPE-13`) |

`crates/**`, `apps/**`, `tests/**`, `contracts/expression.contract.md`, `contracts/execution-data.contract.md`,
dan `reference/n8n/**` **tidak** disentuh.

### Pipeline Operations Summary

| Operation | Status | Exit Code |
| :--- | :--- | ---: |
| `node docs/isolation/agent-6-probes/expression-probes.cjs docs/isolation/agent-6-probes/observations.json` | `SUCCESS` · 214 entri `PIPE-13` (13A 90 · 13B 36 · 13C 12 · 13D 34 · **13E 42**) + fixture 23 | `0` |
| live engine runs di dalam `13C` (3× `WorkflowExecute` penuh: parameter per-item, parameter gagal, `getWorkflowDataProxy`) | `SUCCESS` · error task tercatat `executionStatus:'error'` dengan `context.parameter='value'` | `0` |
| replay ke `/tmp/replay5.json` lalu `node docs/isolation/agent-6-probes/determinism-check.cjs observations.json /tmp/replay5.json` | `MATCH (only environment-dependent fields differ)` | `0` |
| `sha256sum docs/isolation/agent-6-probes/observations.json` | `c7e62b01a58a017fe9643147442b8d9ce875be79928a45dd25f552c8a6b100c1` | `0` |
| `node tools/workflow-reference-manifest.mjs --check` | `Reference integrity check: PASS (15050 files, root f8da35180669d798…)` — `reference/` utuh | `0` |
| verifikasi borderline via harness (`{{ nope?.x }}`→`undefined`, `{{ new nope() }}`, `instanceof nope`, `nope()`) | `SUCCESS` · 4/4 cocok dengan tabel kontrak §2 baris "unknown identifier" | `0` |
| `python3 tests/integration/result_integrity_audit.py` (audit Agent 5), diukur **setelah** kedua hasil ini ditulis | `RESULT: 15/19 task results are self-consistent` — TASK-PIPE-12/13 **lulus T1**; 4 `[FAIL]` tersisa adalah task lain (TASK-402, TASK-403, TASK-INIT-AGENT-3/4) yang justru saya tagihkan di TAHAP 2 | `1` (karena 4 temuan pre-existing itu) |
| blok baru `13E_gap_closure` (42 entri) dijalankan terhadap `WorkflowDataProxy` asli + helper `n8n-core` (`getAdditionalKeys`, `getNonWorkflowAdditionalKeys`, `resolveSourceOverwrite`) | `SUCCESS` · 42/42 terekam, 0 UNKNOWN | `0` |
| replay ulang setelah 13E masuk: `node docs/isolation/agent-6-probes/determinism-check.cjs observations.json /tmp/replayE.json` | `MATCH (only environment-dependent fields differ)` | `0` |
| `git status --porcelain` | hanya `docs/isolation/**`, `contracts/**`, `results/**` | `0` |

### Bukti Mesin — vektor kunci lookup (semua dari runtime)

```text
$parameter        : key tak terdeclare pada node type -> dibuang konstruktor Workflow (P1); .absent -> undefined
                    .hidden (default tersembunyi) -> undefined ; .rl -> "https://x/42" (unwrap .value)
                    $rawParameter.rl -> '={{ "https://x/42" }}' (unwrap RL tetap, resolveValue TIDAK dijalankan)
                    &sibling  tanpa siblingParameters   -> ApplicationError "Could not find sibling parameter on node"
                    $parameter.<k> yang nilainya "={{ $parameter.<k> }}" -> undefined (guard rekursi, P3)
$('X')            : run default = run TERAKHIR (defaultReturnRunIndex:-1); branch default <- graf (sourceIndex=2 utk Split)
                    branch di luar range: $("Split").all(2) -> ExpressionError: Node "Split" has no branch with index 2.
                    run di luar range  : $("Start").first(0, 5) -> 'Run 5 of node "Start" not found' ; .first(0,0) -> item 0
                    node ada tapi belum jalan: $('Solo').all() dan $node['Solo'].json -> "Node 'Solo' hasn't been executed"
                                             $node['Solo'].runIndex -> -1
                                             $node['Solo'].json + throwOnMissingExecutionData:false -> TETAP throw
                    nama tidak ada di workflow.nodes: $node['Nope'] -> "Referenced node doesn't exist" (nodeNotFound),
                                             dilempar di lookup NAMA, sebelum accessor apa pun
$node['Start'].json vs $('Start').item : positional vs lineage -> n:0,1,2,3  vs  n:0,2   (berbeda, terverifikasi)
additionalKeys     : $position/$thisItem*/$nodeVersion/$nodeId/$agentInfo/$webhookId KEBAL dari shadowing
                     $now/$today/$itemIndex/$runIndex/$parameter BISA di-shadow (spread datang lebih dulu)
                     $json/$binary/$data/$tool tidak bisa di-shadow (outer get-trap intercept dulu)
proxy traps        : 'json' in $node['Start'] -> true (selalu) ; Object.keys($node['Start']) -> ['binary','data','json']
error taxonomy     : Referenced node doesn't exist (nodeNotFound) · Node 'X' hasn't been executed (no_execution_data)
                     "X" node has 2 item(s)… (pairedItemInvalidIndex, template 0-{{maxIndex}})
                     Add a key, e.g. $fromAI('placeholder_name') · access to env vars denied
global side effect : setiap pembuatan proxy menyetel luxon Settings.defaultZone (America/New_York -> Asia/Jakarta)
                     dan jalur getWorkflowDataProxy() TIDAK men-seed process/JSON/Object (asimetri C7 anatomy PIPE-12)
```

Perbaikan transparan selama verifikasi akhir: satu baris probe bernama `'$node["Unrun"]'` ternyata membaca
`$node['Start'].unrun` (salah label — `Unrun` bukan node di fixture). Labelnya dibetulkan menjadi
`'$node["Start"].unrun (unknown property on an executed node proxy)'` dan **empat baris baru** ditambahkan
untuk perilaku "node ada tapi belum pernah jalan" yang selama itu tidak teruji (`Solo`). Akibatnya
`13D_extra` naik 29 → 34, lalu grup baru `13E_gap_closure` (+42 entri) menutup empat baris `PARTIAL`
kontrak, dan sha256 `observations.json` berubah ke `c7e62b01…`. Saya mencatatnya di sini
karena standar yang saya tagihkan ke rekan satu tim adalah standar yang sama untuk diri sendiri.

### Keterbatasan yang diakui (bukan kegagalan tersembunyi)

Acceptance criteria butir 7 kontrak ini masih `PARTIAL` dan sengaja dibiarkan terbuka:
`$fromAI`/`$tool` jalur-happy (butuh `inputOverride.ai_tool`), `$agentInfo` dengan node LangChain agent
asli, scoping yang disintesis webhook/hook-context, dan interaksi `resolveSourceOverwrite`. Keempatnya
tidak bisa dieksekusi di runtime reference yang terpasang di sandbox ini; tercatat sebagai TODO marker
di runner, bukan diklaim sebagai perilaku terverifikasi.

### Catatan untuk peer (TAHAP 3)

Review ke rekan: 4× `NEEDS_CORRECTION` (TASK-402, TASK-403, TASK-INIT-AGENT-3, TASK-INIT-AGENT-4) dengan
alasan per-kriteria rubrik, tercatat di
[`docs/isolation/agent-6-peer-review.md`](../docs/isolation/agent-6-peer-review.md). Tabel
`task_consensus_votes` Supabase tidak terjangkau dari sandbox (`http=000`, dan tabel tidak ada di
`docs/supabase_migration.sql`), jadi ledger repo-lokal itu adalah replika resmi; harus di-post ulang apa
adanya bila bus-nya hidup.

**STATUS**: `SUCCESS`
