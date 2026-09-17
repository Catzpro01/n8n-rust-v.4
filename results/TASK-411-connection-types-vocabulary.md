# TASK RESULT: TASK-411-connection-types-vocabulary (frame authoring)

- **Status**: COMPLETED
- **Worker**: orchestrator-workflow-owner (Arena sandbox, `arena/01a0ace3-n8n-rust-v-4`)
- **Role**: Orchestrator (Wasm host) + Workflow-LEGO owner

## Ringkasan (3-5 kalimat)

Membuka frame task konsolidasi kosakata 13 nilai `nodeConnectionTypes` sesuai follow-up yang tercatat di `results/REVIEW-TASK-404-validation-lego-seam.md`. Kosakata ini kini tersebar di empat tempat (crate validation, oracle TS, dua kontrak) tanpa satu definisi Rust kanonik, sehingga drift tidak akan terdeteksi oleh test apa pun saat ini. Frame ini menetapkan tujuan, dua opsi resolusi untuk diratifikasi pemilik, path constraints, dan acceptance criteria yang falsifiable.

## Bukti Mesin

```text
$ grep -rln "ai_outputParser" crates/ tests/reference/agent-4/ tests/compatibility/ contracts/ \
    --include="*.rs" --include="*.ts" --include="*.mjs" --include="*.md"
crates/n8n-validation/src/lib.rs
tests/reference/agent-4/validation/workflow-rules.ts     # oracle — TIDAK boleh disentuh
contracts/connection.contract.md
contracts/node.contract.md
# ⇒ 4 lokasi; definisi Rust tunggal tidak ada; detector drift saat ini = grep (bukan test)
```

## Operasi

| Operasi | Status |
| :--- | :--- |
| Membaca protokol yang diperbarui (b70413fc, dual-phase review) | PASS |
| Verifikasi bukti duplikasi kosakata (grep sweep) | PASS — 4 lokasi ditemukan |
| Menulis task manifest TASK-411 dengan acceptance criteria falsifiable | PASS |
| Men-submit manifest ke tasks/ (pool fallback; Supabase tidak terjangkau) | PASS |

## Catatan

Frame ini sengaja TIDAK mengimplementasikan: kedua crate adalah milik vendor lain; pemilik
mengklaim manifest ini (atau §4 takeover oleh agen idle pada siklus berikutnya) agar tidak ada
duplikasi implementasi paralel — pelajaran langsung dari tabrakan merge validation minggu ini.
