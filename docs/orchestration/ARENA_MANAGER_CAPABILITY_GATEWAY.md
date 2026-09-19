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
   - **Arena Manager**: Hak administratif penuh untuk membuat/mengupdate PR, merge PR, membuat/menghapus worker branch, membuat task, mengelola migrasi schema database, dan broadcast Telegram.
   - **Worker Agents**: Terisolasi pada pembacaan repo, eksekusi tes/build lokal, dan dilarang mengeksekusi operasi administratif (misal menghapus branch, merge PR, atau migrasi schema).
4. **Controlled Schema Migration Architecture**:
   Perubahan skema database tidak pernah dilakukan via arbitrary/unrestricted SQL. Seluruh migrasi mengikuti alur:
   `REPOSITORY MIGRATION FILE -> VALIDATION -> CAPABILITY GATEWAY -> SUPABASE -> MIGRATION RESULT`
   sehingga GitHub tetap menjadi *single source of truth*.

---

## 2. Katalog Kapabilitas Resmi (38 Capabilities)

### 2.1 Domain GitHub (`github.*`)
* `github.read_repo`: Membaca metadata repository (nama, default branch, status visibility).
* `github.list_branches`: Mendapatkan daftar seluruh branch pada repository.
* `github.get_branch`: Memeriksa detail branch tertentu dan commit SHA terakhirnya.
* `github.create_branch`: Membuat branch baru (misal branch isolasi untuk worker).
* `github.delete_branch`: Menghapus branch fitur/worker yang sudah selesai (Manager only; `main`, `master`, `arena-manager` dilindungi mutlak, `arena-agent` legacy protected).
* `github.read_file`: Membaca isi file di remote GitHub (file sensitif seperti `.env` diblokir).
* `github.write_file`: Menulis file ke remote GitHub.
* `github.delete_file`: Menghapus file dari remote repository.
* `github.create_pr`: Membuka Pull Request dari worker branch ke target branch (Manager only).
* `github.update_pr`: Memperbarui judul/deskripsi PR (Manager only).
* `github.get_pr`: Mengambil status PR, mergeable state, dan review comments.
* `github.merge_pr`: Melakukan merge PR secara aman setelah seluruh checks pass (Manager only).
* `github.get_ci`: Membaca riwayat workflow run GitHub Actions / CI.
* `github.commit_and_push`: Wrapper git CLI lokal menggunakan token terinjeksi.

### 2.2 Domain Supabase (`supabase.*`)

#### Control Plane State & Tasks
* `supabase.read_table`: Membaca baris dari tabel canonical (`tasks`, `agents`, `locks`, dll.).
* `supabase.write_table`: Menulis/mengubah baris tabel (Manager only).
* `supabase.rpc`: Memanggil stored procedure terdaftar (misal `claim_task`, `agent_heartbeat`).
* `supabase.inspect_tasks`: Memeriksa antrean tugas, filter berdasarkan status.
* `supabase.inspect_agents`: Memantau agen aktif, idle, dan heartbeat.
* `supabase.inspect_locks`: Memeriksa distributed lock yang aktif.
* `supabase.create_task`: Mendaftarkan tugas baru ke database (Manager only).
* `supabase.update_task_state`: Transisi status tugas (`QUEUED` -> `CLAIMED` -> `IN_PROGRESS` -> `DONE`).
* `supabase.record_event`: Menulis log audit event ke tabel `events`.
* `supabase.get_project_state`: Agregasi metrik progres proyek (tasks, agents, weighted progress).

#### Schema & Migration Management (Manager Only)
* `supabase.create_migration`: Membuat file migrasi baru di `supabase/migrations/` berformat timestamp canonical (`YYYYMMDDHHMMSS_<name>.sql`) dengan segmen `-- migrate:up` dan `-- migrate:down`.
* `supabase.read_migration`: Membaca dan mem-parsing isi migrasi UP dan DOWN serta menghitung checksum SHA-256.
* `supabase.migration_status`: Membandingkan file migrasi lokal di repositori dengan status pencatatan di database (`schema_migrations`). Menampilkan daftar migrasi berstatus `APPLIED` atau `PENDING`.
* `supabase.apply_migration`: Memvalidasi dan mengeksekusi migrasi yang dipilih. Mengembalikan `MIGRATION_APPLIED` atau `MIGRATION_ALREADY_APPLIED`.
* `supabase.schema_upgrade`: Menerapkan seluruh migrasi pending secara berurutan (*batch upgrade*).
* `supabase.rollback_migration`: Membatalkan migrasi (*revert*) menggunakan skrip `-- migrate:down` jika tersedia dan menghapus pencatatan dari `schema_migrations`.

### 2.3 Domain Laptop / Worker Host (`laptop.*`)
* `laptop.status`: Memeriksa branch lokal, commit HEAD, dan working tree dirty status.
* `laptop.run_test`: Menjalankan suite pengujian (cargo test / npm test) dalam lingkungan terisolasi.
* `laptop.run_build`: Menjalankan kompilasi (cargo check / cargo build) dengan stripping environment secret.
* `laptop.run_clippy`: Menjalankan linter cargo clippy dengan zero-warning enforcement.
* `laptop.run_command`: Menjalankan perintah shell yang aman dan terdaftar (perintah berbahaya seperti `cat .env` atau `printenv` diblokir).

### 2.4 Domain Telegram (`telegram.*`)
* `telegram.send_message`: Mengirim pesan markdown/teks ke chat Telegram orkestrasi (Manager only).
* `telegram.get_updates`: Memeriksa pesan/perintah masuk dari bot Telegram.
* `telegram.render_dashboard`: Memformat dan mem-broadcast status metrik dashboard ke channel/group (Manager only).

---

## 3. Protokol & Endpoint Server Gateway

Daemon HTTP REST Gateway berjalan di `http://0.0.0.0:8787` (atau port yang dikonfigurasi via `GATEWAY_PORT`):

| Endpoint | Method | Header | Deskripsi |
| :--- | :--- | :--- | :--- |
| `/health` atau `/api/v1/health` | `GET` | - | Health check server status |
| `/api/v1/capabilities` | `GET` | - | Discovery katalog seluruh kapabilitas |
| `/api/v1/invoke` | `POST` | `Authorization: Bearer <TOKEN>`<br>`X-Caller-ID: <CALLER_ID>` | Eksekusi kapabilitas |

Contoh Payload Pemanggilan (`POST /api/v1/invoke`):
```json
{
  "caller_id": "arena-manager",
  "capability": "supabase.apply_migration",
  "params": {
    "version": "20260920000000"
  }
}
```

Format Respons:
```json
{
  "ok": true,
  "result": {
    "status": "MIGRATION_APPLIED",
    "version": "20260920000000",
    "name": "dynamic_agent_fleet",
    "reversible": true
  },
  "authenticated": true,
  "authorized": true,
  "duration_ms": 12.4
}
```

---

## 4. Cara Penggunaan Antigravity-Independent

### A. Menjalankan Gateway Daemon (Background Service)
```bash
./scripts/run-gateway.sh
# Atau:
python3 -m tools.gateway.server --host 0.0.0.0 --port 8787
```

### B. Pemanggilan via Python SDK (`GatewayClient`)
```python
from tools.gateway.client import GatewayClient

client = GatewayClient(base_url="http://127.0.0.1:8787")
status = client.invoke("supabase.migration_status")
print(status)
```

### C. Pemanggilan via CLI
```bash
# Discovery
python3 -m tools.gateway.cli discover

# Invoke dengan Token Terotentikasi
python3 -m tools.gateway.cli invoke \
  --caller arena-manager \
  --capability supabase.inspect_tasks \
  --token <ARENA_GATEWAY_TOKEN>
```
