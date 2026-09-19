# Demarcation: Native Arena vs Capability Gateway

Dokumen pembagian batas tanggung jawab operasional antara **Native Arena Execution Environment** dan **Privileged Capability Gateway** pada repositori `Catzpro01/n8n-rust-v.4`.

---

## 1. Filosofi & Batas Keamanan

Lingkungan kerja AI Agent pada platform Arena memiliki dua lapisan eksekusi yang berbeda:

```text
┌────────────────────────────────────────────────────────┐
│               NATIVE ARENA EXECUTION                   │
│ • Unprivileged sandbox workspace                       │
│ • bash, git CLI, cargo, gh CLI, python3, npm           │
│ • Menulis/mengedit kode, menjalankan compiler & test    │
│ • Scoped branch: arena/<agent-id>                      │
│ • ZERO RAW SECRETS (hanya dummy egress token)          │
└──────────────────────────┬─────────────────────────────┘
                           │
             Terotentikasi via Bearer Token
                  (agm_... / agw_...)
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│             PRIVILEGED CAPABILITY GATEWAY              │
│ • Trusted Execution Environment (Host Daemon / Docker) │
│ • Memegang Master Vault (Supabase Service Key, Bot PAT)│
│ • Validasi Role & Kebijakan (PolicyEngine)             │
│ • Sanitasi Output & Deep Audit Trail (AuditLogger)     │
│ • External Side Effects: PR Merge, DB Migration, Alert │
└────────────────────────────────────────────────────────┘
```

---

## 2. Matriks Komparasi

| Dimensi | Native Arena Workspace | Capability Gateway |
| :--- | :--- | :--- |
| **Tujuan Utama** | Pengembangan kode, kompilasi, & pengujian lokal | Operasi privileged, control-plane, & side effects |
| **Akses File Sistem** | Sandbox `/home/user/n8n-rust-v.4` | Repo Root dengan proteksi file sensitif |
| **Kredensial** | Dummy proxy tokens saja (tidak ada master keys) | Master Vault (`SecretVault`) terisolasi |
| **Operasi Git/GitHub** | `git commit`, `git push` ke working branch | Admin PR merge, protected branch delete/protect |
| **Supabase State** | Tidak ada akses langsung ke database | REST & RPC Control Plane, atomic OCC, migrations |
| **Schema Upgrade** | Hanya menulis file SQL di `supabase/migrations/` | Validasi, eksekusi, & rollback terkelola |
| **Notifikasi** | Tidak dapat mengirim pesan Telegram | Broadcast dashboard & incident alert terformat |
| **Role Enforcement** | Mengikuti sandbox context | Strict RBAC (Manager vs Worker tokens) |

---

## 3. Alur Kerja Kolaboratif (Best Practice)

1. **Worker Agent** bekerja di **Native Arena**:
   - Membaca issue / task manifest.
   - Mengedit file source code di `crates/` atau `packages/`.
   - Menguji dengan `cargo check` atau script pengujian lokal.
   - Melakukan `git commit` dan `git push` ke branch kerjanya.

2. **Arena Manager** berkoordinasi via **Capability Gateway**:
   - Membaca antrean task dari Supabase (`supabase.inspect_tasks`).
   - Menerapkan schema migration jika ada perubahan tabel (`supabase.apply_migration`).
   - Memeriksa CI run (`github.get_ci`).
   - Menggabungkan PR ke branch target (`github.merge_pr`).
   - Mem-broadcast pembaruan metrik ke tim (`telegram.render_dashboard`).
