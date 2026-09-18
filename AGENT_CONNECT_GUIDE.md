# 🚀 PANDUAN KONEKSI ARENA AGENT KE SUPABASE & WORKSPACE

Dokumen ini adalah panduan teknis bagi Agen AI Arena untuk terhubung, mengambil tugas, dan melaporkan kemajuan.

---

## 1. Kredensial & Endpoint Lingkungan (.env)

Seluruh kredensial telah tersedia di berkas `.env` pada direktori kerja masing-masing agen (`/home/fern/arena/workspaces/agent-X/.env`):
- `SUPABASE_URL`: Endpoint kluster Supabase
- `SUPABASE_KEY`: Service role API key
- `REPO_URL`: URL repositori n8n-rust-v.4

---

## 2. Alur Kerja Standar Agen (Lifecycle Protocol)

### Langkah 1: Membaca Task PENDING
```bash
curl -s -X GET "${SUPABASE_URL}/rest/v1/tasks?status=eq.PENDING&agent_id=eq.<AGENT_ID>&limit=1" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}"
```

### Langkah 2: Klaim Task & Update Status
Sebelum mulai coding, agen wajib mengklaim task:
1. Update `agent_status`:
   ```bash
   curl -s -X PATCH "${SUPABASE_URL}/rest/v1/agent_status?agent_id=eq.<AGENT_ID>" \
     -H "apikey: ${SUPABASE_KEY}" \
     -H "Authorization: Bearer ${SUPABASE_KEY}" \
     -H "Content-Type: application/json" \
     -d '{"state": "WORKING", "current_task": "<TASK_ID>"}'
   ```
2. Update `tasks`:
   ```bash
   curl -s -X PATCH "${SUPABASE_URL}/rest/v1/tasks?id=eq.<TASK_ID>" \
     -H "apikey: ${SUPABASE_KEY}" \
     -H "Authorization: Bearer ${SUPABASE_KEY}" \
     -H "Content-Type: application/json" \
     -d '{"status": "RUNNING"}'
   ```

### Langkah 3: Eksekusi Kode di Workspace Terisolasi
- Pindah ke direktori workspace: `cd /home/fern/arena/workspaces/<AGENT_ID>`
- Buat cabang arena baru: `./switch_arena_branch.sh <TASK_ID>`
- Perbarui `my_progress.md` dengan ringkasan objektif sesi.
- Kerjakan modifikasi kode hanya pada modul yang ditugaskan.
- Jalankan uji verifikasi mandiri (`npm test` / `node --check`).

### Langkah 4: Selesai & Lapor Tuntas
1. Catat hasil uji verifikasi di `my_progress.md`.
2. Commit dan push ke branch arena:
   ```bash
   git add .
   git commit -m "feat(<AGENT_ID>): complete <TASK_ID>"
   git push origin HEAD
   ```
3. Update `tasks` ke `COMPLETED`:
   ```bash
   curl -s -X PATCH "${SUPABASE_URL}/rest/v1/tasks?id=eq.<TASK_ID>" \
     -H "apikey: ${SUPABASE_KEY}" \
     -H "Authorization: Bearer ${SUPABASE_KEY}" \
     -H "Content-Type: application/json" \
     -d '{"status": "COMPLETED"}'
   ```
4. Kembalikan `agent_status` ke `IDLE`:
   ```bash
   curl -s -X PATCH "${SUPABASE_URL}/rest/v1/agent_status?agent_id=eq.<AGENT_ID>" \
     -H "apikey: ${SUPABASE_KEY}" \
     -H "Authorization: Bearer ${SUPABASE_KEY}" \
     -H "Content-Type: application/json" \
     -d '{"state": "IDLE", "current_task": null}'
   ```
