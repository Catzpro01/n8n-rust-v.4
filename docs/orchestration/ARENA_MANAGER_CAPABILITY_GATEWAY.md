# Arena Manager Capability Gateway — v1.7 Specification

Dokumen spesifikasi resmi arsitektur **Arena Manager Capability Gateway v1.7** pada repositori `Catzpro01/n8n-rust-v.4`.

## 1. Arsitektur & Prinsip Dasar

Arsitektur orkestrasi n8n-rust-v.4 menempatkan **Arena Manager** (1 Agen AI) sebagai project orchestrator utama menggantikan Antigravity.

```text
                         HUMAN
                           │
                           ▼
                  ┌─────────────────┐
                  │  ARENA MANAGER  │
                  │    1 AGENT      │
                  └────────┬────────┘
                           │
                    capability calls
                           │
                           ▼
                  ┌─────────────────┐
                  │ CAPABILITY      │
                  │ GATEWAY         │
                  │                 │
                  │ Auth            │
                  │ Authorization   │
                  │ Rate Limiting   │
                  │ Audit Log       │
                  │ Sanitization    │
                  └────────┬────────┘
                           │
         ┌────────────┬────┴───────┬────────────┐
         ▼            ▼            ▼            ▼
      GitHub       Supabase     Laptop      Telegram
       Repo      State/Tasks    Builds      Dashboard
```

### Prinsip Keamanan Inti:
1. **Capabilities Instead of Credentials**: Arena Manager dan worker agents tidak pernah menerima, membaca, atau menyimpan token, API key, atau secrets (`GITHUB_TOKEN`, `SUPABASE_KEY`, `TELEGRAM_BOT_TOKEN`).
2. **Strict Redaction / Zero Leakage**: Sanitizer gateway menyaring semua output stdout/stderr, respons REST API, JSON payloads, dan error trace dari token GitHub (`ghp_`), JWT Supabase (`eyJ...`), Telegram token (`bot...`), serta exact secret values.
3. **Branch Protection & Fencing**:
   - Branch `main`, `master`, dan `arena-agent` bersifat terproteksi permanen. Penghapusan branch ini di-reject langsung oleh `PolicyEngine`.
   - File konfigurasi rahasia (`.env`, `.credentials`, `.runner`, ssh keys) diblokir dari akses baca/tulis/hapus.
   - Worker agents (`arena-agent-*`, `worker-*`) diisolasi dalam scope pengerjaan lokal dan diblokir dari operasi administratif (misal `github.delete_branch`, `github.merge_pr`).
4. **Append-Only Audit Logging**: Seluruh pemanggilan kapabilitas dicatat ke `.arena/logs/gateway_audit.jsonl` (timestamp, caller, capability, status, latency) bebas dari data rahasia.

---

## 2. Katalog Kapabilitas (Capabilities Catalog)

### 2.1 Domain GitHub (`github.*`)
* `github.read_repo`: Mengambil metadata repositori (nama, branch default, visibilitas).
* `github.list_branches`: Mendapatkan daftar branch aktif beserta commit SHA.
* `github.get_branch`: Mengambil detail spesifik branch.
* `github.create_branch`: Membuat branch baru dari baseline ref tertentu.
* `github.delete_branch`: Menghapus branch (dicek oleh PolicyEngine; `main` dan `arena-agent` terproteksi).
* `github.read_file`: Membaca konten file dari remote GitHub.
* `github.write_file`: Menulis atau memperbarui file pada remote GitHub.
* `github.delete_file`: Menghapus file pada remote GitHub.
* `github.create_pr`: Membuat Pull Request baru (`head` -> `base`).
* `github.update_pr`: Mengupdate judul, body, atau state PR.
* `github.get_pr`: Mengambil status PR (mergeable, merged, state, reviews).
* `github.merge_pr`: Melakukan merge PR (mendukung metode `squash`, `merge`, `rebase`).
* `github.get_ci`: Mengambil status workflow run dan check-runs CI.
* `github.commit_and_push`: Wrapper lokal untuk commit dan push menggunakan kredensial vault.

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
* `laptop.run_command`: Menjalankan perintah shell terkontrol dan aman dengan sanitasi output.

### 2.4 Domain Telegram (`telegram.*`)
* `telegram.send_message`: Mengirim pesan markdown/teks ke chat Telegram orkestrasi.
* `telegram.get_updates`: Memeriksa pesan/perintah masuk dari bot Telegram.
* `telegram.render_dashboard`: Memformat dan mem-broadcast status metrik dashboard ke channel/group.

---

## 3. Cara Penggunaan oleh Arena Manager

### 3.1 Via Python API
```python
from tools.gateway.gateway import CapabilityGateway

gateway = CapabilityGateway()

# 1. Menemukan kapabilitas yang tersedia
catalog = gateway.discover_capabilities()

# 2. Memanggil kapabilitas
result = gateway.invoke(
    caller_id="arena-manager",
    capability="supabase.inspect_tasks",
    params={"limit": 5}
)

if result["ok"]:
    tasks = result["result"]
    print("Tasks retrieved:", len(tasks))
else:
    print("Error:", result["error"])
```

### 3.2 Via Terminal / Subprocess CLI
```bash
# Discovery
python -m tools.gateway.cli discover

# Invoke Read Repo
python -m tools.gateway.cli invoke --caller arena-manager --capability github.read_repo

# Invoke Laptop Status
python -m tools.gateway.cli invoke --caller arena-manager --capability laptop.status

# Invoke Telegram Broadcast
python -m tools.gateway.cli invoke --caller arena-manager --capability telegram.send_message --params '{"text": "Status update from Arena Manager"}'
```

---

## 4. Struktur Modul

```text
tools/gateway/
├── __init__.py
├── vault.py                 # SecretVault: resolusi kredensial terisolasi
├── sanitizer.py             # Sanitizer: recursive redaction token & pattern
├── policy.py                # PolicyEngine: branch protection, file guard, worker fence
├── audit.py                 # AuditLogger: JSONL audit log terstruktur
├── gateway.py               # CapabilityGateway: facade & router
├── cli.py                   # Antarmuka CLI untuk Arena Manager
├── providers/
│   ├── github_provider.py   # GitHub REST API & Git operations
│   ├── supabase_provider.py # PostgREST & RPC operations
│   ├── laptop_provider.py   # Cargo & local process execution
│   └── telegram_provider.py # Telegram bot API operations
└── tests/
    └── test_gateway.py      # Automated verification suite
```
