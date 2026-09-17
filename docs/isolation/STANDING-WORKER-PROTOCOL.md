# STANDING PROTOCOL: ASYNCHRONOUS NON-BLOCKING WORKER CYCLE

Setiap pekerja (Agent 1 s/d Agent 9) adalah buruh kerja lepas setara. Job, role, aturan, dan target MELEKAT PADA TASK yang diambil.

---

## ALUR KERJA NON-BLOCKING (TIDAK SALING MENGUNCI)

```text
[Eksekusi Task & Tulis Ringkasan]
              │
              ▼
[Submit Task ke Antrean Review Asinkron]
              │
              ├───► [Review Task Rekan Lain yang Menunggu (Jika Ada)]
              │
              └───► [LANGSUNG Ambil Task Baru yang Tersedia di Pool (JANGAN MENUNGGU!)]
```

---

### 1. Eksekusi Task & Penulisan Ringkasan Padat
* Pekerja mengambil task yang berstatus `AVAILABLE` dari `dynamic_task_pool`.
* Bekerja sesuai batasan `allowed_paths` dan `forbidden_paths` (NO RUST).
* **Wajib Menulis Ringkasan di `results/<TASK_ID>.md`**:
  - Maksimal 3-5 kalimat padat, spesifik, to the point.
  - Cantumkan bukti mesin (*evidence* / commit hash / test log).

---

### 2. Bebas Bergerak Langsung (Non-Blocking / Jangan Menunggu Approve)
* **TIDAK ADA BATASAN**: Pekerja **DILARANG BERHENTI ATAU MENUNGGU** tugasnya di-approve.
* Setelah menulis ringkasan dan men-submit task ke antrean review:
  1. Jika ada task rekan yang siap direview, luangkan review kilat berdasarkan 3 rubrik tertulis.
  2. **Langsung ambil task berikutnya yang tersedia di pool tanpa menunggu approval!**

---

### 3. Review Terbuka Multi-Agent (Bukan Cuma 1 Agent)
* Siapa pun rekan agen yang sempat atau sedang senggang berhak memeriksa task yang sudah di-submit.
* Suara penilaian dicatat transparan di `task_consensus_votes`.

---

### 4. Tugas yang Tidak Di-Approve / Diprotes Bisa Diambil Alih (Work-Stealing on Rejection)
* Jika suatu task mendapat penolakan / masukan revisi (`NEEDS_CORRECTION`), status dan riwayat review-nya terlihat transparan di sistem.
* **Tugas tersebut TIDAK mengunci pembuat awalnya**:
  - Pembuat awal bisa memperbaikinya jika sempat, **ATAU**
  - **Dapat diambil alih oleh agen lain** yang sedang senggang untuk memperbaiki kekurangannya sesuai catatan protes yang tercatat.
* Riwayat perbaikan dan review sebelumnya tetap terekam (*audit trail*) sehingga tidak ada duplikasi pekerjaan.

---

### 5. Definisi Selesai Mutlak Proyek
* Proyek hanya selesai jika:
  1. Seluruh task di `dynamic_task_pool` habis tuntas, DAN
  2. Seluruh review tuntas disetujui tanpa ada tugas berstatus `NEEDS_CORRECTION`.
