# TASK RESULT: ISSUE-024 — cross-branch path-collision detector

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-1` (Arena session `arena/01a0aff7-n8n-rust-v-4`)
- **DELIVERABLE**: `tools/branch-collision-check.mjs`
- **EXIT CODE**: `1` on the current tree — by design (collisions exist)
- **TIMESTAMP**: `2026-09-18`

---

## Ringkasan (5 kalimat)

1. Menemukan bahwa dua rekonstruksi independen menempati **path yang sama**: 41 path di empat branch
   aktif memiliki isi yang berbeda, dan git tidak memberi peringatan apa pun sampai waktu merge.
2. Tabrakan terbesar adalah branch saya dengan `arena/01a0aff8` (PR #14): 57 path bersama, **23
   berbeda isi** — mencakup `api-lego`, `credentials-lego`, `scheduler-lego`, dan
   `execution-data-lego`.
3. Identitas path bukan kepemilikan: `packages/api-lego/src/errors.mjs` milik saya adalah
   `@n8n-reconstructed/api-lego` (amplop respons + `ResponseError`), sedangkan milik mereka adalah
   `@lego/api` (dispatcher + amplop + validasi DTO) — dua paket berbeda, satu path.
4. Saya mengirimkan **detektornya** (`tools/branch-collision-check.mjs`), yang membandingkan
   sepasang ref, mengklasifikasikan SAMA vs BERBEDA menurut hash blob, dan keluar dengan kode 1 bila
   ada tabrakan — sehingga setiap agen bisa memeriksanya sebelum merge.
5. Saya **tidak** mengganti nama paket saya sendiri secara sepihak: itu akan tampak seperti menyerahkan
   lane, bukan menyelesaikannya; saya tawarkan sebagai remedy siap eksekusi setelah ada keputusan.

---

## Bukti mesin

| Perbandingan | Path bersama | Isi berbeda |
| :--- | --- | :--- |
| `01a0aff7` ↔ `01a0aff8` (PR #14) | 57 | **23** |
| `01a0aff8` ↔ `01a0afff` (PR #17) | 58 | **10** |
| `01a0aff8` ↔ `01a0aff6` (PR #15) | 38 | 4 |
| `01a0aff7` ↔ `01a0afff` | 36 | 2 |
| `01a0aff7` ↔ `01a0aff6` | 35 | 1 |
| `01a0aff6` ↔ `01a0afff` | 35 | 1 |
| **Total** | | **41** |

Paket terdampak: `execution-data-lego` 7, `execution-engine` 7, `credentials-lego` 6, `api-lego` 4,
`scheduler-lego` 4, `reconstructed-engine` 3, `persistence-lego` 3.

Lawan `main`: hanya `packages/reconstructed-engine/runner.mjs` yang bertabrakan (untuk tiga branch);
PR #15 bersih terhadap `main`.

## Pemakaian

```bash
node tools/branch-collision-check.mjs                         # semua branch origin/*
node tools/branch-collision-check.mjs --scope packages/ A B   # dua ref tertentu
```

Kode keluar: `0` bersih · `1` ada tabrakan · `2` kesalahan pemakaian.

## Rekomendasi

Satu pemilik per lane, **atau** namespace direktori (`packages/agent1-<lane>/`). Sampai salah satunya
dipilih, jangan menggabungkan dua branch ini ke `main` berurutan tanpa menjalankan detektor.
