# Progress — Agent 2 · P4.1 Canonical Ingress Contracts

- **Agent:** arena-agent-2 (P4 Marathon, mandate: P4 Master Prompt dari owner)
- **Task:** P4.1 — Canonical Ingress Contracts (Issue #109, parent #99)
- **Branch:** `arena/p4.1-ingress-contracts` (base `main@75189576`)
- **Status:** ✅ implementasi + verifikasi hijau; PR menyusul pada sesi yang sama
- **Last updated:** 2026-09-23

## Hasil slice ini

| Item | Lokasi |
| :--- | :--- |
| Modul kontrak `ingress.contracts@0.1.0` | `crates/n8n-common/src/ingress_contract.rs` |
| Re-export publik | `crates/n8n-common/src/lib.rs` |
| Dok kontrak (FROZEN) | `docs/architecture/p4/ingress-contracts.md` |
| Evidence gate A–I | `docs/architecture/p4/evidence/P4.1-EVIDENCE.md` |

30 tes baru (30/30 hijau), total workspace 181 hijau, 0 warning.
Tidak ada perubahan: `Cargo.toml` root, `Cargo.lock`, `contracts/**`, file agent lain.

## Keputusan penting (jangan diubah tanpa nalar kontrak)

1. **Kontrak hidup di `n8n-common`**, mengikuti precedent `expression_contract.rs`:
   `contracts/**` global read-only (`.arena/policies/paths.yaml`) dan penambahan crate
   baru akan menyentuh `Cargo.lock` (juga read-only) — dua-duanya dihindari.
2. **Naming overlap sengaja:** `ExecutionMode` penuh (10 nilai n8n) vs
   `n8n-workflow/trigger.rs::ExecutionMode` (subset 4) — beda layer, konvergensi
   lewat adapter eksplisit di P4.2+. Jangan "dirapikan" diam-diam.
3. **Fencing = exact match.** Generation lebih tua ATAU lebih baru sama-sama ditolak.
4. **Binary tidak pernah inline** — selalu `PayloadRef::External` (sha256 lowercase hex).
5. **Activation tanpa `ACTIVE→FAILED` langsung** — eskalasi wajib lewat `DEGRADED`.

## Verifikasi di sandbox (replikasi)

```bash
# rig (toolchain 1.88.0 dari npm + vendor git tags; /tmp tmpfs 1GiB → JANGAN pakai /tmp)
RUST_RIG=/var/tmp/rust-rig bash tools/rust-offline-rig/setup.sh
RUST_RIG=/var/tmp/rust-rig bash tools/rust-offline-rig/run.sh test
```

**Rig-repair knowhow (sesi ini, 2026-09-23):** bila build aneh (import `regex_syntax::ast/hir`
hilang), penyebabnya file 0-byte hasil clone saat disk penuh + rlib basi. Obatnya:
`find $RUST_RIG/vendorsrc -size 0 -type f` → hapus clone korup → hapus `$RUST_RIG/vendor`
dan `$RUST_RIG/target` → ulangi setup.sh. Rig tidak tahan lintas sesi (di luar /home/user)
— setup ulang ~1 menit bila repo sudah ada.

## Langkah berikut (P4.2)

Branch BARU dari `main@HEAD` setelah PR P4.1 merge. Scope: activation runtime —
record store, transaksi transisi memakai `CANONICAL_TRANSITIONS`, generation issuance,
reconciler startup. Konsumen pertama kontrak ini. Jangan sentuh
`n8n-workflow/trigger.rs` (milik agent-01/P3) — adapter diekspresikan di sisi P4.

## Interaksi agent lain (log)

- P3 (owner merge) sedang jalan di `apps/n8n-lego/**` (slice C/D, PR #113/#114) — nol overlap
  dengan file slice ini. `main` bergerak selama sesi (454ef1d3→75189576) — anti-staleness
  ditegakkan ulang sebelum branch dibuat.
