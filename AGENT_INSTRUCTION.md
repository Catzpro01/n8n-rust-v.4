# AGENT 1 INSTRUCTION PROMPT (MODULE: WORKFLOW)
Branch Dasar: `agent-1` | Workspace: `/home/fern/arena/workspaces/agent-1`
Skuad: Skuad A (Lead): Workflow Engine, Canvas DAG & Navigation

## 🚨 PROTOKOL WAJIB: CABANG ARENA & PEWARISAN KONTEKS (ZERO-REREAD HANDOVER)
1. **Pembuatan Branch Cabang Arena**:
   - Setiap kali mulai mengerjakan task baru atau sesi baru, buat branch cabang dari `agent-1`:
     `./switch_arena_branch.sh <task_id_atau_nama_pekerjaan>`
     (Branch otomatis bernama: `arena-agent-1-<nama>`)
   - Seluruh pekerjaan kode, dokumen, dan commit dilakukan di branch `arena-*` tersebut.
2. **Kewajiban Memelihara `my_progress.md`**:
   - File `my_progress.md` adalah dokumen hidup pewarisan konteks tercepat.
   - Setiap ada fungsi selesai, error yang ditemukan, atau keputusan teknis yang diambil, catat langsung di `my_progress.md`.
3. **Pewarisan Konteks Singkat untuk Sesi Baru (Anti Baca Ulang Kode)**:
   - Jika sesi terputus atau agen baru menggantikan, agen baru **DILARANG membaca ulang seluruh isi codebase**.
   - Agen baru cukup membaca `my_progress.md` (< 50 baris) untuk langsung tahu:
     - Apa tugasnya
     - Apa yang sudah selesai
     - File mana yang sedang dikerjakan
     - Masalah/error apa yang sedang dihadapi
     - Langkah spesifik berikutnya yang harus dieksekusi.

## Protokol Komunikasi & Status Supabase:
1. SEBELUM mengeksekusi task:
   - Update tabel `agent_status`: `state = 'WORKING'`, `current_task = '<TASK_ID>'`.
   - Update tabel `tasks`: `status = 'RUNNING'`.
   - Update `my_progress.md` dengan Task ID dan objektif sesi.
2. SESUDAH tuntas:
   - Jalankan uji verifikasi (Level 1 Contract test / syntax check).
   - Update `my_progress.md` dengan bukti hasil pengujian.
   - Commit & push perubahan ke remote branch `arena-agent-1-*`.
   - Update tabel `tasks`: `status = 'COMPLETED'`.
   - Update tabel `agent_status`: `state = 'IDLE'`, `current_task = null`.

