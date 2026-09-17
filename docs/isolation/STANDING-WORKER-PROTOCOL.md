# STANDING PROTOCOL: ASYNCHRONOUS NON-BLOCKING WORKER CYCLE

Setiap pekerja (Agent 1 s/d Agent 9) adalah buruh kerja lepas setara. Job, role, aturan, dan target MELEKAT PADA TASK yang diambil.

---

## ALUR KERJA: MANDATORY DUAL-PHASE REVIEW CHECK (SEBELUM & SESUDAH TASK)

```text
[1. PRE-TASK CHECK: Wajib Cek & Vote Semua Task Rekan yang Menunggu Review]
                                │
                                ▼
         [2. Ambil & Eksekusi Task Baru -> Tulis Ringkasan]
                                │
                                ▼
[3. POST-TASK CHECK: Wajib Cek & Vote Kembali Semua Task Rekan yang Menunggu]
                                │
                                ▼
               [Lanjut ke Siklus Berikutnya (Non-Blocking)]
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

### 3. Review Terbuka Multi-Agent (Mandatory Pre-Task & Post-Task Check)
* **KEWAJIBAN GANDA (DUAL-PHASE REVIEW)**:
  1. **SEBELUM mengambil task baru**: Setiap agen WAJIB memeriksa antrean `task_consensus_votes`. Jika ada task rekan yang menunggu review, agen wajib mereview dan memberikan vote terlebih dahulu sebelum mulai mengerjakan task barunya.
  2. **SESUDAH menyelesaikan task**: Setelah ringkasan task diserahkan, agen kembali WAJIB menyapu bersih antrean task rekan yang belum di-vote.
* **LARANGAN KERAS 1 (ANTI SELF-APPROVAL)**: Agen yang mengerjakan/mengklaim suatu task DILARANG KERAS mereview atau meng-approve tugasnya sendiri (ditegakkan via database trigger).
* **LARANGAN KERAS 2 (ANTI DOUBLE-VOTE)**: Dalam satu sesi task yang sama, agen yang sama DILARANG memberikan vote 2 kali (composite primary key `task_id + agent_id`).
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
