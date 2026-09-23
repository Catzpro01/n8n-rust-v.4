# P4.9 — Compatibility & Performance Acceptance (#107)

> Modul: `crates/n8n-common/src/compat.rs`. Ini slice **verifikasi** — alat
> yang menilai hasil P4.1–P4.8, bukan mesin eksekusi baru.

## Kenapa bentuknya begitu

P4.9 = acceptance akhir. Yang dibutuhkan: bukti bahwa kata wire n8n 2.9.4
(methods, prefixes, modes) dan decision path canonical terpenuhi. Maka
dibangun tiga alat **deterministik, tanpa IO, tanpa dependensi baru**:

1. **`CompatCase` / `CompatMatrix`** — kumpulan kasus harapan verbatim (n8n)
   yang dijalankan terhadap hasil runtime, dengan statistika pass/fail.
2. **`ReplayCapsule` / `replay_admission` / `replay_resolution`** —
   **Deterministic Ingress Replay** yang ditunda dari #111-#8: membuktikan
   decision/ routing sama saat direplay (admission-only / resolution-only /
   dry-run / compatibility). Sanitized (metadata only).
3. **`AcceptanceSuite`** — pencatat verdict eksplisit, bukan klaim bisu.

## Batas & kompatibilitas

- Tidak mengubah perilaku produksi, kontrak, ataupun workflow JSON.
- Banyak kasus dibatasi `MAX_COMPAT_CASES` = 512.
- Replay hanya membandingkan; tak boleh memicu efek dedupe/queue (pure).
- Default matrix: 12 kasus ✓ verbatim prefixes `webhook`, `webhook-test`,
  `webhook-waiting`, `form`, `form-test`, `form-waiting`; methods DELETE/GET/
  HEAD/PATCH/POST/PUT; modes webhook/trigger/manual/internal.

## Status acceptance P4 (self-assessment untuk integrasi Manager)

| Gate | Hasil |
|---|---|
| Boundary/positive/negative | simulasi penuh tiap slice |
| Compatibility | matrix verbatim di atas + `default_path_prefix` |
| Resource-bounded | journals/queues/capsules/cases semua capped |
| Race/failure | leader lease fail-closed (P4.7), hot-swap reader-safe (P4.8) |
| Verify | rig offline **288 green**, 0 warning, fmt bersih |

> Final acceptance P4 **hanya** oleh Manager setelah reconciliation → main
> (agent tidak self-declare).
