# Arena Manager Capability Gateway — v1.7 Specification

Dokumen spesifikasi resmi arsitektur **Arena Manager Capability Gateway v1.7** pada repositori `Catzpro01/n8n-rust-v.4`.

## 1. Arsitektur & Prinsip Dasar

Arsitektur orkestrasi n8n-rust-v.4 menempatkan **Arena Manager** sebagai Wakil Teknis Delegasi (Delegated Technical Operator) dari Antigravity:

```text
ANTIGRAVITY
= ROOT AUTHORITY / TRUST ANCHOR
      │
      │ delegated capability authority
      ▼
CAPABILITY GATEWAY
= SECURITY + CREDENTIAL BOUNDARY
      │
      │ authenticated capability calls
      ▼
ARENA MANAGER
= DELEGATED TECHNICAL OPERATOR
      │
      ├── GITHUB       (Source of Truth)
      ├── SUPABASE     (Shared Control Plane)
      ├── LAPTOP       (Trusted Build/Test Webhook Worker)
      ├── WORKERS      (Coding Workforce)
      └── TELEGRAM     (Observability / Alert Channel)
```

### Prinsip Keamanan & Desain Inti:
1. **Capabilities Instead of Credentials**: Arena Manager dan worker agents tidak pernah menerima, membaca, atau menyimpan token mentah (`GITHUB_TOKEN`, `SUPABASE_KEY`, `TELEGRAM_BOT_TOKEN`, `SSH_KEY`, `DATABASE_PASSWORD`).
2. **Independent Gateway Authentication**: Gateway memiliki layer otentikasi mandiri (`GatewayAuth`) menggunakan Bearer Token terisolasi (`agm_...` untuk Manager, `agw_...` untuk Worker). Token gateway ini hanya mengizinkan pemanggilan endpoint gateway dan tidak memiliki hak akses langsung ke GitHub atau Supabase.
3. **Role-Based Privilege Model**:
   - **Arena Manager**: Hak administratif penuh untuk membuat/mengupdate PR, merge PR, membuat/menghapus worker branch, membuat task, dan broadcast Telegram.
   - **Worker Agents**: Terisolasi pada pembacaan repo, eksekusi tes/build lokal, dan dilarang mengeksekusi operasi administratif (misal menghapus branch atau merge PR).
4. **Laptop Webhook Agent Architecture**:
   - Laptop menjalankan daemon `tools/gateway/laptop_webhook_agent.py` di port 8989.
   - Menggunakan verifikasi **HMAC SHA-256 Request Signatures** (`X-Webhook-Signature`, `X-Webhook-Timestamp`, `X-Webhook-Request-ID`).
   - Proteksi Replay Attack (toleransi waktu 60 detik + pelacakan Request ID unik).
   - Operation-based payload (`cargo_check`, `cargo_test`, `cargo_test_package`, `cargo_clippy`, `cargo_build`). **DILARANG arbitrary shell command**.
5. **Persistent Manager Orchestrator Daemon**:
   - Modul `tools/gateway/orchestrator_daemon.py` menjalankan loop otonom independen dari turn AI.
   - Mengelola pemantauan heartbeat, perpanjangan lease, dan *reaping* task kadaluarsa/stale worker.
6. **Thread-Safe Append-Only Audit Logging**: Seluruh pemanggilan kapabilitas dicatat ke `.arena/logs/gateway_audit.jsonl` (timestamp, caller, capability, target, authorization, status, latency) bebas dari data rahasia.

---

## 2. Katalog Kapabilitas Lengkap (Capabilities Catalog)

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
* `supabase.register_worker`: Mendaftarkan worker dinamis ke tabel `agents`.
* `supabase.claim_task_lease`: Mengklaim task secara atomik dengan timeout sewa (lease).
* `supabase.worker_heartbeat`: Mengirimkan pulsa heartbeat aktif worker.
* `supabase.reap_expired_leases`: Membersihkan sewa task yang habis masa berlakunya.
* `supabase.record_checkpoint`: Mencatat snapshot kemajuan kerja di `agent_checkpoints`.

### 2.3 Domain Laptop / Webhook Worker (`laptop.*`)
* `laptop.status`: Memeriksa branch lokal, commit HEAD, working tree clean status, runner status, dan status webhook agent.
* `laptop.run_test`: Menjalankan suite `cargo test` melalui signed HMAC webhook ke Laptop Webhook Agent.
* `laptop.run_build`: Menjalankan `cargo check` atau `cargo build` via webhook.
* `laptop.run_clippy`: Menjalankan linter `cargo clippy -- -D warnings` via webhook.
* `laptop.run_command`: Menjalankan perintah shell terkontrol dalam isolasi environment.

### 2.4 Domain Telegram (`telegram.*`)
* `telegram.send_message`: Mengirim pesan markdown/teks ke chat Telegram orkestrasi.
* `telegram.get_updates`: Memeriksa pesan/perintah masuk dari bot Telegram.
* `telegram.render_dashboard`: Memformat dan mem-broadcast status metrik dashboard ke channel/group.

---

## 3. Protokol & Endpoint Gateway

### A. Capability Gateway REST Server (`http://127.0.0.1:8787`):
- `GET /health`: Pemeriksaan kesehatan gateway.
- `GET /api/v1/capabilities`: Discovery daftar kapabilitas.
- `POST /api/v1/invoke`: Eksekusi kapabilitas dengan header `Authorization: Bearer <TOKEN>` dan `X-Caller-ID: <CALLER_ID>`.

### B. Laptop Webhook Agent Server (`http://127.0.0.1:8989`):
- `GET /health`: Status daemon eksekusi lokal.
- `GET /status`: Konfigurasi ruang kerja dan operasi yang diizinkan.
- `POST /webhook/execute`: Eksekusi tugas terotentikasi HMAC SHA-256.
- `POST /webhook/cancel`: Pembatalan proses pekerjaan aktif.

---

## 4. Cara Pengoperasian Mandiri (Antigravity-Independent)

```bash
# 1. Menjalankan Laptop Webhook Agent (Background Service)
python -m tools.gateway.laptop_webhook_agent --port 8989

# 2. Menjalankan Capability Gateway Daemon (Background Service)
python -m tools.gateway.server --host 127.0.0.1 --port 8787

# 3. Menjalankan Persistent Manager Orchestrator Daemon
python -m tools.gateway.orchestrator_daemon

# 4. Arena Manager Memanggil Kapabilitas via CLI
python -m tools.gateway.cli invoke \
  --caller arena-manager \
  --capability github.read_repo \
  --token <ARENA_GATEWAY_TOKEN>
```
