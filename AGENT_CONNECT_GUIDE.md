# PANDUAN KONEKSI & EKSEKUSI ARENA AGENT (LEAST PRIVILEGE)

Dokumen ini adalah panduan teknis bagi Arena AI Agent (agent-01 s/d agent-05) untuk beroperasi dalam lingkungan terisolasi tanpa memerlukan kredensial backend berpriveleged tinggi.

---

## 1. Prinsip Keamanan Kredensial (Zero Secret Exposure)
- Agen **TIDAK DIBEKALI** `SUPABASE_SERVICE_ROLE_KEY` atau GitHub Admin PAT.
- Koordinasi distributed lease, lock status, dan event dispatch ditangani secara eksklusif oleh **Arena Bridge & Executor** yang berjalan di server VPS host.
- Agen bekerja secara deterministik di workspace masing-masing (`/srv/arena/workspaces/<agent-id>`).

---

## 2. Alur Eksekusi Agen

### Langkah 1: Membaca Penugasan Tugas (Task Manifest)
Daftar tugas resmi tersimpan secara persisten di repository:
`.arena/tasks/<TASK_ID>.yaml`

Agen memeriksa manifest tugas untuk mengetahui:
- Target LEGO & Sub-LEGO
- Batasan direktori: `allowed_paths` vs `forbidden_paths`
- Kontrak yang harus dipatuhi: `contracts/<contract>.contract.md`
- Perintah pengujian yang harus dijalankan (`cargo test -p ...`)

### Langkah 2: Menyiapkan Branch Kerja
Gunakan skrip isolasi cabang di workspace:
```bash
./scripts/arena/switch_branch.sh <agent-id> <task-id>
```
Skrip ini akan membuat/checkout cabang: `arena/<agent-id>/<task-id>`.

### Langkah 3: Eksekusi Perubahan
- Lakukan modifikasi kode HANYA pada path yang diizinkan (`allowed_paths`).
- Jika mencoba mengubah file di luar kepemilikan, executor akan menolak operasi (fail-closed).
- Catat milestone teknis pada berkas progress:
  `.arena/progress/<agent-id>-<task-id>.md`

### Langkah 4: Verifikasi & Conformance Gate
Jalankan pengujian wajib sebelum commit:
```bash
cargo check --workspace
cargo test -p <target-crate>
```

### Langkah 5: Commit, Push, dan Pull Request
1. Commit perubahan terstruktur:
   ```bash
   git add .
   git commit -m "feat(<sublego>): complete <task-id>"
   git push origin arena/<agent-id>/<task-id>
   ```
2. Buka Pull Request ke `main` di GitHub.
3. CI Actions akan menjalankan verifikasi otomatis sebelum PR dapat digabungkan.
