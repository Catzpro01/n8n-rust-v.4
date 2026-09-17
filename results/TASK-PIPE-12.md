# TASK RESULT: TASK-PIPE-12

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-6`
- **BRANCH**: `agent-6` (working branch `arena/01a0ace1-n8n-rust-v-4`)
- **PERAN SESAAAT (Role)**: Expression & Scoping Specialist
- **LEGO COMPONENT**: `expression` — syntax-resolution half
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-17 (Asia/Novosibirsk)`
- **RULES**: Rust forbidden · results in `docs/isolation/` + `contracts/` · `reference/n8n` read-only

---

### Ringkasan Inti

Menulis ulang anatomi lengkap pipeline sintaksis `{{ … }}` n8n 2.9.4 ke
`docs/isolation/expression-syntax-pipeline.md` (12 tahap: deteksi `=`, pemecahan chunk, seeding
`data.process` + deny/allow globals, `extendSyntax`, kompilasi `@n8n/tournament`, koersif
return-type, taksonomi error) dengan kontrak normatifnya di `contracts/expression-syntax.contract.md`
(I/O O1–O11, sandbox C1–C10, perluasan X1–X8, DEV-1..4). Semua angka perilaku diambil dari runtime
asli melalui probe `docs/isolation/agent-6-probes/expression-probes.cjs` (266 entri bagian PIPE-12,
55 di antaranya error bertipe) — tidak ada satu pun perilaku yang dikira-kira atau ditulis ulang dari
memori. Tiga temuan material: (D1) error runtime **tidak** lolos sebagai `null` dari `renderExpression`
karena gerbang `shouldWrapInTry` berjalan di AST *post-polyfill*, (D2) `{{ process.version }}`
mengembalikan **PID** proses, dan (D3/DEV-2) dua splitter (`expression-parser.ts` vs
`tournament/ExpressionSplitter`) **berbeda** dalam menangani backslash ganjil/genap — keduanya harus
dipertahankan di port.

### Deliverables

| Berkas | Isi | Baris |
| :--- | :--- | ---: |
| `docs/isolation/expression-syntax-pipeline.md` | anatomi + tabel panggilan + grammar + sandbox + aturan perluasan + temuan | (lihat §0–§12) |
| `contracts/expression-syntax.contract.md` | kontrak normatif irisan sintaksis | — |
| `docs/isolation/agent-6-probes/expression-probes.cjs` | runner oracle (menggerakkan n8n asli) | — |
| `docs/isolation/agent-6-probes/observations.json` | 503 entri observasi (PIPE-12 266 · PIPE-13 214 · fixture 23) | sha256 `c7e62b01…` |
| `docs/isolation/agent-6-probes/determinism-check.cjs` | pembanding dua hasil replay | — |
| `docs/isolation/agent-6-probes/README.md` | cara menjalankan + rincian per grup + integritas | — |

`crates/**`, `apps/**`, `tests/**`, `contracts/expression.contract.md` (punya Agent 3), dan
`reference/n8n/**` **tidak** disentuh.

### Pipeline Operations Summary

| Operation | Status | Exit Code |
| :--- | :--- | ---: |
| `scripts/setup-reference-runtime.sh .runtime` (599 paket: `n8n-workflow@2.9.1`, `n8n-core@2.9.1`, `@n8n/tournament@1.0.6`, `luxon@3.7.2`) | `SUCCESS` | `0` |
| `node docs/isolation/agent-6-probes/expression-probes.cjs docs/isolation/agent-6-probes/observations.json` | `SUCCESS` · 503 entri terekam | `0` |
| replay ke `/tmp/replayE.json` lalu `node docs/isolation/agent-6-probes/determinism-check.cjs observations.json /tmp/replayE.json` (diulang setelah grup `13E` masuk, agar angka kedua task konsisten satu berkas) | `MATCH (only environment-dependent fields differ)` | `0` |
| `sha256sum docs/isolation/agent-6-probes/observations.json` | `c7e62b01a58a017fe9643147442b8d9ce875be79928a45dd25f552c8a6b100c1` | `0` |
| `node tools/workflow-reference-manifest.mjs --check` (bukti `reference/` tak diubah) | `Reference integrity check: PASS (15050 files, root f8da35180669d798…)` | `0` |
| `node --check docs/isolation/agent-6-probes/expression-probes.cjs` | `SYNTAX OK` | `0` |
| verifikasi ulang 7 kasus borderline terhadap runtime (`{{ nope?.x }}`, `{{ new nope() }}`, `nope()`, `1 in {}`, `[1,2,3].map`, `={{ $json + 1 }}`, `=\\{{1}}` vs `=\\\\{{1}}`) | `SUCCESS` · 7/7 cocok dengan yang didokumentasikan | `0` |
| `git status --porcelain` (pembatasan jalur) | hanya `docs/isolation/**` + `contracts/**` + `results/**` | `0` |

### Bukti Mesin — vektor kunci (setiap baris adalah keluaran runtime yang sebenarnya, bukan kutipan dokumen)

```text
# mode mentah vs penggabungan teks  (verified via harness + tests/reference/harness)
={{1}}                          -> 1            (number)
={{1}}<spasi>                   -> "1 "          (string)     satu karakter di luar kurung membatalkan mode mentah
=abc                            -> "abc"         (tidak ada {{ }}, dikembalikan apa adanya)
=={{1}}                         -> "=1"          (= kedua adalah teks)
=x{{1                           -> "x1"          (kurung buka tak tertutup tetap dievaluasi)
={{ [1,2,3].map(n=>n*2) }}      -> [2,4,6]       (objek murni, tanpa koersi)

# pemisahan ganda (divergensi yang harus dipertahankan port)
=\{{1}}                        -> "\{{1}}"       (backslash ganjil  -> teks utuh, tidak dinormalisasi)
=\\{{1}}                       -> "\1"           (backslash genap    -> kode + \ yang dinormalisasi)

# gerbang perluasan sintaksis (extendSyntax)
=isEmpty()                      -> "isEmpty()"                       (bukan ekspresi)
={{ $json.a.isEmpty() }}        -> false   (boolean) ← source rewritten ke: {{ extend($json.a, "isEmpty", []) }}
={{ $json.a.trim().isEmpty() }} -> undefined  (runtime error ditelan wrapper try/catch — lihat D1)
={{ $if($json.a, "y", "n") }}   -> "y"       ← source rewritten ke: {{ $json.a ? "y" : "n" }}

# sandbox + taksonomi error
={{ {}.constructor }}           -> THREW ExpressionError: Expression contains invalid constructor function call
={{ {}["constructor"] }}        -> THREW ExpressionError: Cannot access "constructor" due to security concerns
={{ {}["pro"+"to"+"__"] }}      -> undefined   ← kunci dinamis melewati denylist statis (dicatat, jangan "diperbaiki" diam-diam)
={{ $ }}                        -> THREW ExpressionError: Cannot access "$" without calling it as a function
={{ nope?.x }}                  -> undefined   (bukan ReferenceError; proxy `has()` selalu true)
={{ process.version }}          -> 2448        ← PID proses! (2448 pada run terekam; BERBEDA tiap run — cacat upstream, anatomy D2 → keputusan port DEV-1)
={{}}                           -> THREW ApplicationError: invalid syntax (jalur parameter) | SyntaxError "Not a expression statement" (jalur resolveWithoutWorkflow)
```

Slice ini mencatat **266 entri**; untuk seluruh berkas: 418 outcome records = **353 nilai + 65 throw**
bertipe, masing-masing dengan kelas + pesan + `context` lengkap (tidak ada entri yang berakhir "tidak diketahui").

### Catatan untuk peer (TAHAP 3)

Review atas rekan sudah dikerjakan dan tercatat di
[`docs/isolation/agent-6-peer-review.md`](../docs/isolation/agent-6-peer-review.md)
(4 suara `NEEDS_CORRECTION`; tabel `task_consensus_votes` Supabase tidak terjangkau dari sandbox —
`http=000`, dan tabelnya memang tidak ada di `docs/supabase_migration.sql`, jadi ledger repo-lokal ini
menjadi replikanya). Tidak ada `APPROVED` yang saya berikan pada siklus ini; sesuai *zero-protest rule*
keempat task tersebut tetap terbuka sampai pemiliknya memperbaiki catatan operasinya.

**STATUS**: `SUCCESS`
