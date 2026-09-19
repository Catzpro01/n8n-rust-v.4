# Arena Manager Capability Gateway — v1.7 Specification

Dokumen spesifikasi resmi arsitektur **Arena Manager Capability Gateway v1.7** pada repositori `Catzpro01/n8n-rust-v.4`.

## 1. Arsitektur & Prinsip Dasar

Arsitektur orkestrasi n8n-rust-v.4 menempatkan **Arena Manager** (1 Agen AI) sebagai project orchestrator utama menggantikan Antigravity.

Antigravity bertindak **HANYA** sebagai infrastruktur *provisioning & debugging*, sementara operasi harian dijalankan 100% secara offline tanpa ketergantungan pada proses atau workspace Antigravity.

```text
                         HUMAN
                           │
                           ▼
                  ┌─────────────────┐
                  │  ARENA MANAGER  │
                  │    1 AGENT      │
                  └────────┬────────┘
                           │
                    authenticated
                    capability calls
                  (HTTP REST / CLI)
                           │
                           ▼
                  ┌─────────────────┐
                  │ CAPABILITY      │
                  │ GATEWAY DAEMON  │
                  │                 │
                  │ GatewayAuth     │
                  │ PolicyEngine    │
                  │ SecretVault     │
                  │ Sanitizer       │
                  │ AuditLogger     │
                  └────────┬────────┘
                           │
             credentials remain exclusively
                 inside gateway vault
                           │
         ┌────────────┬────┴───────┬────────────┐
         ▼            ▼            ▼            ▼
      GitHub       Supabase     Laptop      Telegram
       Repo      State/Tasks    Builds      Dashboard
```

### Prinsip Keamanan & Desain Inti:
1. **Capabilities Instead of Credentials**: Arena Manager dan worker agents tidak pernah menerima, membaca, atau menyimpan token mentah (`GITHUB_TOKEN`, `SUPABASE_KEY`, `TELEGRAM_BOT_TOKEN`, `SSH_KEY`, `DATABASE_PASSWORD`).
2. **Independent Gateway Authentication**: Gateway memiliki layer otentikasi mandiri (`GatewayAuth`) menggunakan Bearer Token terisolasi (`agm_...` untuk Manager, `agw_...` untuk Worker). Token gateway ini hanya mengizinkan pemanggilan endpoint gateway dan tidak memiliki hak akses langsung ke GitHub atau Supabase.
3. **Role-Based Privilege Model**:
   - **Arena Manager**: Hak administratif penuh untuk membuat/mengupdate PR, merge PR, membuat/menghapus worker branch, membuat task, dan broadcast Telegram.
   - **Worker Agents**: Terisolasi pada pembacaan repo, eksekusi tes/build lokal, dan dilarang mengeksekusi operasi administratif (misal menghapus branch atau merge PR).
4. **Subprocess & Environment Isolation**:
   - Provider laptop (`laptop.run_command`, `laptop.run_test`, dll.) mengeksekusi perintah pada lingkungan terisolasi di mana seluruh variabel rahasia OS distrip sebelum proses dijalankan.
   - Perintah dump lingkungan (`env`, `printenv`, `set`, `Get-ChildItem env:`) dan pembacaan berkas kredensial (`.env`, `.credentials`, `.runner`) diblokir secara mutlak.
5. **Protected Branch & File Guard**:
   - Branch `main`, `master`, dan `arena-agent` bersifat permanen dan tidak dapat dihapus oleh operasi normal gateway.
6. **Thread-Safe Append-Only Audit Logging**: Seluruh pemanggilan kapabilitas dicatat ke `.arena/logs/gateway_audit.jsonl` (timestamp, caller, capability, target, authorization, status, latency) bebas dari data rahasia.

---

## 2. Katalog Kapabilitas (Capabilities Catalog)

### 2.1 Domain GitHub (`github.*`)
* `github.read_repo`: Mengambil metadata repositori (nama, branch default, visibilitas).
* `github.list_branches`: Mendapatkan daftar branch aktif beserta commit SHA.
* `github.get_branch`: Mengambil detail spesifik branch.
* `github.create_branch`: Membuat branch baru dari baseline ref tertentu.
* `github.delete_branch`: Menghapus branch (hanya untuk non-protected branches).
* `github.read_file`: Membaca konten file dari remote GitHub.
* `github.write_file`: Menulis atau memperbarui file pada remote GitHub.
* `github.delete_file`: Menghapus file pada remote GitHub.
* `github.create_pr`: Membuat Pull Request baru (`head` -> `base`).
* `github.update_pr`: Mengupdate judul, body, atau state PR.
* `github.get_pr`: Mengambil status PR (mergeable, merged, state, reviews).
* `github.merge_pr`: Melakukan merge PR (metode `squash`, `merge`, `rebase`).
* `github.get_ci`: Mengambil status workflow run dan check-runs CI.
* `github.commit_and_push`: Wrapper git lokal untuk commit dan push dengan kredensial vault.

### 2.2 Domain Supabase (`supabase.*`)
* `supabase.read_table`: Query tabel PostgREST (e.g. `tasks`, `agents`, `orchestration_events`).
* `supabase.write_table`: Insert baris baru ke tabel PostgREST.
* `supabase.rpc`: Eksekusi stored procedure Postgres (e.g. `claim_task`).
* `supabase.inspect_tasks`: Mengambil status seluruh task (QUEUED, CLAIMED, DONE, FAILED).
* `supabase.inspect_agents`: Mengambil daftar agent terdaftar dan status heartbeat-nya.
* `supabase.inspect_locks`: Memeriksa concurrency control dan active locks.
* `supabase.create_task`: Mendaftarkan task baru ke Control Plane.
* `supabase.update_task_state`: Memperbarui status task (OCC concurrency checks).
* `supabase.record_event`: Mencatat log event orkestrasi ke tabel audit Supabase.
* `supabase.get_project_state`: Mengambil ringkasan metrik task dan progress proyek.

### 2.3 Domain Laptop / Local Worker (`laptop.*`)
* `laptop.status`: Memeriksa branch lokal, commit HEAD, working tree clean status, dan status actions runner.
* `laptop.run_test`: Menjalankan suite `cargo test` lokal (mendukung filtering per crate atau nama test).
* `laptop.run_build`: Menjalankan `cargo check` atau `cargo build`.
* `laptop.run_clippy`: Menjalankan linter `cargo clippy -- -D warnings`.
* `laptop.run_command`: Menjalankan perintah shell terkontrol dalam isolasi environment.

### 2.4 Domain Telegram (`telegram.*`)
* `telegram.send_message`: Mengirim pesan markdown/teks ke chat Telegram orkestrasi.
* `telegram.get_updates`: Memeriksa pesan/perintah masuk dari bot Telegram.
* `telegram.render_dashboard`: Memformat dan mem-broadcast status metrik dashboard ke channel/group.

---

## 3. Protokol & Endpoint Server Gateway

Daemon HTTP REST Gateway berjalan di `http://127.0.0.1:8787` (atau port yang dikonfigurasi):

| Endpoint | Method | Header | Deskripsi |
| :--- | :--- | :--- | :--- |
| `/health` atau `/api/v1/health` | `GET` | - | Health check server status |
| `/api/v1/capabilities` | `GET` | - | Discovery katalog seluruh kapabilitas |
| `/api/v1/invoke` | `POST` | `Authorization: Bearer <TOKEN>`<br>`X-Caller-ID: <CALLER_ID>` | Eksekusi kapabilitas |

Contoh Payload Pemanggilan (`POST /api/v1/invoke`):
```json
{
  "caller_id": "arena-manager",
  "capability": "supabase.inspect_tasks",
  "params": {
    "limit": 5
  }
}
```

Format Respons:
```json
{
  "ok": true,
  "result": { ... },
  "authenticated": true,
  "authorized": true,
  "duration_ms": 124.5
}
```

---

## 4. Cara Penggunaan Antigravity-Independent

### A. Menjalankan Gateway Daemon (Background Service)
```bash
python -m tools.gateway.server --host 127.0.0.1 --port 8787
```

### B. Pemanggilan via CLI
```bash
# Discovery
python -m tools.gateway.cli discover

# Invoke dengan Token Terotentikasi
python -m tools.gateway.cli invoke \
  --caller arena-manager \
  --capability github.read_repo \
  --token <ARENA_GATEWAY_TOKEN>
```
