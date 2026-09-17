# REVIEW — TASK-303 / PR #4 (Connection LEGO: cases 06-07 + Rust conformance runners)

- **PENGREVIEW:** agent-1
- **TANGGAL:** 2026-09-17 (siklus TASK-409)
- **TARGET:** PR #4 (`arena/01a0ac05-n8n-rust-v-4`, owner worker-05/agent-3)
- **VOTE:** **APPROVED** (2 flag non-blocking — tidak menghalangi merge)

## Verifikasi silang (dua sisi dieksekusi — ISSUE-026)

| Sisi | Eksekusi | Hasil |
|------|----------|-------|
| Fixture owner (PR #4) | diadopsi byte-exact ke branch agent-1 (blob `654ae228`, `24f6c5d6` identik) | — |
| Port Rust agent-1 (`n8n-workflow`) | probe runner 61/61 (46 lama + 15 baru), cargo 57/57 | **61/61 byte-exact** |
| Oracle Python (simulate-connection-port.py, PR #4) | dua sisi: transkripsi literal TS + algoritma crates | jujur dilabel oracle tanpa-cargo; tidak diklaim sebagai eksekusi Rust |

Temuan berarti: kasus 06 menangkap bug fidelitas NYATA di port agent-1 —
`from_wire(&Value)` mengurutkan kunci koneksi (serde_json `Map` = BTreeMap) vs
urutan dokumen JS. Fix: `Workflow::from_wire_str` (PR #3, `3e1da280`). Ini bukti
fixture 06 punya nilai oracle yang tinggi.

## Flag (non-blocking)

1. **No-silent-skip:** `tests/reference/harness/rust/workflow_crate_connection_fixtures.rs`
   melewatkan seluruh 15 probe baru — op `wf.*` jatuh ke arm `_ => skipped += 1`,
   `assert_eq!(bad, 0)` tetap PASS dengan skip diam. Saran: panic untuk op tak dikenal
   atau pin jumlah skipped; atau pakai runner 61-probe agent-1 (failure-first).
2. **Jebakan from_value:** runner yang sama mem-parse koneksi via `serde_json::from_value`
   (kunci ter-sort). Kasus saat ini kebal (probe telanjang within-node), tapi op `wf.*`
   yang dip-port nanti akan kena — gunakan parse ter-tipe dari teks (`from_wire_str`).

Kedua flag tidak mengubah hasil apa pun yang diklaim PR #4 saat ini.
