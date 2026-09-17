# STANDING PROTOCOL: SIKLUS KERJA BURUH LEPAS & KONSENSUS KETAT (5-STEP CYCLE)

Setiap pekerja (Agent 1 s/d Agent 9) adalah buruh kerja lepas setara tanpa spesialisasi permanen. Peran, aturan, dan target MELEKAT PADA TASK yang diambil.

---

## 5 TAHAPAN WAJIB SIKLUS KERJA (STRICT WORKER CYCLE)

```text
[1. Eksekusi Task & Tulis Ringkasan]
              │
              ▼
[2. Cari & Review Task Rekan Lain Berdasarkan Rubrik Tertulis]
              │
              ▼
[3. Cek Feedback Review pada Task Milik Sendiri]
              │
         (Ada Protes?) ──► [Perbaiki sampai 100% Setuju]
              │
       (Semua Setuju)
              │
              ▼
[4. Pengesahan Konsensus & Merge ke Main]
              │
              ▼
[5. Ambil Task Baru yang Belum Dikerjakan di Pool]
```

---

### TAHAP 1: Eksekusi Task & Buat Ringkasan (Deliverable Summary)
* Pekerja mengambil task dari `dynamic_task_pool`.
* Menjalankan pekerjaan sesuai spesifikasi, role sesaat, target, dan batasan direktori (`allowed_paths` & `forbidden_paths: NO RUST`).
* **Wajib Menulis Ringkasan di `results/<TASK_ID>.md`**:
  - **Status**: SUCCESS / FAILED.
  - **Pekerja**: Identitas agent.
  - **Peran Sesaat (Role)**: Sesuai modul task.
  - **Ringkasan Inti**: Maksimal 3-5 kalimat, padat, spesifik, to the point (apa yang dibuat, berkas apa yang disentuh).
  - **Bukti Mesin (Evidence)**: Log perintah, jumlah tes pass/fail, atau hash verifikasi.

---

### TAHAP 2: Review Task Rekan Berdasarkan Rubrik Tertulis
* Setelah menyelesaikan tugasnya, pekerja **TIDAK BOLEH** langsung mengambil tugas baru.
* Pekerja **WAJIB mereview task rekan lain** yang sedang menunggu review di tabel `task_consensus_votes`.
* **Rubrik Penilaian Tertulis (Dilarang Sembarang Vote)**:
  1. **Aturan Jalur Berkas**: Apakah ada file di luar `allowed_paths` atau melanggar `forbidden_paths` (misal menyentuh `crates/` saat dilarang)?
  2. **Integritas Golden Oracle**: Apakah perilaku kode/spesifikasi menyimpang dari n8n v2.9.4 asli?
  3. **Keberadaan Bukti Nyata**: Apakah tugas benar-benar menghasilkan deliverable fisik atau hanya laporan kosong?
* **Pemberian Suara**:
  - Berikan suara `APPROVED` jika memenuhi 3 rubrik di atas.
  - Berikan suara `NEEDS_CORRECTION` beserta alasan spesifik jika ada pelanggaran rubrik.

---

### TAHAP 3: Resolusi Feedback (Zero Protest Rule)
* Pekerja memeriksa hasil review dari rekan-rekannya terhadap tugas yang dia serahkan di Tahap 1.
* **Aturan Mutlak**: **JIKA ADA 1 AGEN YANG PROTES (`NEEDS_CORRECTION`), TUGAS HARUS DIBETULKAN**.
* Pekerja wajib memperbaiki kodenya dan meminta verifikasi ulang sampai **100% SUARA SETUJU (UNANIMOUS APPROVED)** tanpa ada satu pun yang menolak.

---

### TAHAP 4: Pengesahan & Penutupan Task
* Setelah mengantongi persetujuan penuh (semua vote `APPROVED`), task ditandai `COMPLETED` di Supabase.
* Hasil kerja di-merge ke branch utama (`main`).

---

### TAHAP 5: Pengambilan Task Baru
* Hanya setelah Tahap 1 s/d 4 selesai tuntas, pekerja berhak kembali ke `dynamic_task_pool` untuk mengambil tugas baru dengan prioritas tertinggi yang berstatus `AVAILABLE`.
