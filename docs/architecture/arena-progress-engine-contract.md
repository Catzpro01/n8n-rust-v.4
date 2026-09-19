# Arena Milestone-Based Progress Engine Contract

## 0. Status & Scope
- **Repository**: `Catzpro01/n8n-rust-v.4`
- **Architecture Role**: Supabase (Control Plane / State Engine) × GitHub (Code Source of Truth) × Laptop (Verification Worker)
- **Document Authority**: Canonical Progress Specification & RPC Contract
- **Non-Negotiable Rule**: Progress **DILARANG KERAS** dihitung berdasarkan Lines of Code (LOC), jumlah commit, jumlah file, ukuran diff, atau klaim verbal agent.

---

## 1. Progress Hierarchy
Struktur kemajuan proyek diatur secara berjenjang dan deterministik:

```text
PROJECT (n8n-rust-v4)
└── MILESTONE (M1..M10)
    └── TASK (Canonical Task Unit)
        └── ACCEPTANCE CRITERIA (Concrete Verified Assertions)
```

---

## 2. Definisi Struktur Entitas TASK
Setiap unit kerja (TASK) dalam Control Plane wajib memiliki atribut:

| Atribut | Tipe | Deskripsi / Aturan |
| :--- | :--- | :--- |
| `task_key` | `TEXT UNIQUE` | Identifier unik human-readable (contoh: `runtime-kernel/m1-runner`). |
| `specialization` | `TEXT` | Salah satu dari 10 spesialisasi domain kanonik. |
| `milestone` | `TEXT` | Identifier milestone (contoh: `M1`, `M2`). |
| `status` | `TEXT` | Salah satu dari 10 status kanonik yang valid. |
| `acceptance_criteria` | `JSONB` | Array assertion objektif yang wajib dipenuhi. |
| `validation_level` | `TEXT` | `L0` (Syntax/lint), `L1` (Unit test), `L2` (Integration/workspace), `L3` (Conformance). |
| `current_commit_sha` | `TEXT` | Hash commit Git terbaru pada branch task. |
| `merge_commit_sha` | `TEXT` | Hash merge commit pada `main` (jika sudah di-merge). |
| `progress_weight` | `NUMERIC(5,2)` | Bobot kontribusi task terhadap milestone (Default: 1.00). |
| `timestamps` | `OBJECT` | `created_at`, `claimed_at`, `completed_at`, `updated_at`. |

---

## 3. Status Kanonik State Machine (10 Status)
Hanya 10 status berikut yang diakui oleh Progress Engine:

1. `QUEUED`: Task terdaftar di backlog aktif dan siap diambil agent.
2. `CLAIMED`: Task telah di-reserve oleh agent terotorisasi dengan lease aktif.
3. `IN_PROGRESS`: Agent sedang aktif mengedit file dalam boundaries yang diizinkan.
4. `BLOCKED`: Task terhambat oleh dependensi atau kendala lingkungan.
5. `READY_TO_MERGE`: Task telah lolos validasi lokal L0/L1 dan PR siap di-merge.
6. `MERGED`: PR telah di-merge ke branch `main`.
7. `POST_MERGE_VERIFY`: Task sedang melalui verifikasi build/test pasca-merge di `main`.
8. `DONE`: Seluruh bukti selesai (commit di `main`, validasi fresh PASS, acceptance criteria verified, cleanup selesai). **Hanya status ini yang dihitung sebagai selesai (100%)**.
9. `FAILED`: Task gagal dalam verifikasi atau pengujian kritis.
10. `STALE`: Validasi kadaluarsa karena adanya commit baru tanpa re-test, atau lease expired.

> [!IMPORTANT]
> **Konservatisme Progress**:
> `CLAIMED`, `IN_PROGRESS`, `READY_TO_MERGE`, `MERGED`, dan `POST_MERGE_VERIFY` **TIDAK DIHITUNG SEBAGAI SELESAI (0% progress contribution)**. Sebuah task hanya bernilai $100\%$ progress jika berstatus `DONE`.

---

## 4. Pembobotan Task (Weighting Rules)
- **Default Weight**: Setiap task memiliki bobot standar `1.0`.
- **Explicit Weights**:
  - `1.0`: Normal (komponen standar, penambahan test, refactor terisolasi).
  - `2.0`: Besar (implementasi modul inti, migrasi state machine).
  - `3.0`: Sangat Besar (arsitektur kernel, core data plane zero-copy).
- **Larangan**: Bobot tidak boleh berubah secara dinamis berdasarkan baris kode yang ditulis.

---

## 5. Formula Perhitungan Progress Kanonik & Reality Check

### A. Reality Check: Pembedaan Scope
Sistem membedakan secara tegas tiga tingkat cakupan:
1. `REGISTERED_TASK_SCOPE`: Kumpulan task yang saat ini telah terdaftar di database.
2. `PROJECT_SCOPE`: Seluruh ruang lingkup dekomposisi pekerjaan n8n-rust yang sesungguhnya.
3. `MILESTONE_SCOPE`: Kumpulan task dalam satu milestone spesifik.

> [!IMPORTANT]
> **Reality Check Mutlak**:
> Jika dekomposisi task proyek belum lengkap, kemajuan dari task yang terdaftar **DILARANG KERAS** disebut sebagai persentase penyelesaian proyek (*Project Completion*).
> Dashboard wajib menampilkan:
> ```text
> PROJECT SCOPE: INCOMPLETE
> REGISTERED TASK SCOPE PROGRESS: XX%
> PROJECT COMPLETION PROGRESS   : NOT AVAILABLE (Awaiting Full Project Decomposition)
> ```

### B. Progress Milestone
$$\text{milestone\_progress}(m) = \frac{\sum_{t \in \text{Tasks}(m), \text{status}(t) = \text{DONE}} \text{weight}(t)}{\sum_{t \in \text{Tasks}(m)} \text{weight}(t)} \times 100$$
*(Jika $\sum \text{weight}(t) = 0$, maka progress milestone bernilai $0.0\%$).*

### C. Single Canonical Formula: Task-Weighted Project Progress
Sistem menetapkan **Task-Weighted Model** sebagai SATU-SATUNYA formula kanonik proyek:
$$\text{project\_progress} = \frac{\sum_{t \in \text{PROJECT\_SCOPE}, \text{status}(t) = \text{DONE}} \text{weight}(t)}{\sum_{t \in \text{PROJECT\_SCOPE}} \text{weight}(t)} \times 100$$

Jika `PROJECT_SCOPE` belum terdekomposisi penuh, formula ini diterapkan pada task yang telah terdaftar dan dilabeli sebagai **Registered Task Scope Progress**:
$$\text{registered\_scope\_progress} = \frac{\sum_{t \in \text{REGISTERED\_SCOPE}, \text{status}(t) = \text{DONE}} \text{weight}(t)}{\sum_{t \in \text{REGISTERED\_SCOPE}} \text{weight}(t)} \times 100$$

*Catatan*: Model agregasi berbasis bobot milestone (Weighted Milestones) HANYA berlaku sebagai **OPTIONAL ANALYTICAL VIEW** untuk keperluan pelaporan ringkas tingkat tinggi, dan **BUKAN** formula resmi progress proyek.

---

## 6. Evidence-Based Progress & Anti-Stale Validation

Sebuah task hanya diakui sebagai `DONE` jika memenuhi seluruh bukti nyata berikut:
1. `task.status == 'DONE'`.
2. `current_commit_sha` ada dan valid (40 karakter heksadesimal).
3. Terdapat catatan test result `PASSED` untuk level validasi yang disyaratkan (`L0`..`L3`).
4. **Anti-Stale Rule**: `validation.commit_sha == task.current_commit_sha`.
   Jika commit berubah setelah validasi dijalankan, maka status validasi otomatis menjadi `STALE`, dan task tidak boleh dihitung sebagai `DONE`.
5. Semua butir `acceptance_criteria` terverifikasi.
6. Kode GitHub eksis dan commit terverifikasi di branch `main`. Keberadaan file kode semata di repo **TIDAK PERNAH** membuktikan task selesai tanpa verifikasi acceptance criteria.
7. **Status INCONSISTENT**: Jika database mencatat status `DONE` tetapi bukti Git atau hasil validasi tidak cocok, task ditandai sebagai `INCONSISTENT` pada laporan audit, dikecualikan dari bobot `DONE`, dan tidak boleh mengubah riwayat secara diam-diam.

---

## 7. Progress Snapshot & Observability

### A. Skema Snapshot (`public.progress_snapshots`)
- `id`: UUID Primary Key.
- `calculated_at`: Timestamp kalkulasi.
- `main_commit_sha`: HEAD commit dari branch `main`.
- `project_progress`: Angka persentase (0.00 – 100.00).
- `milestone_progress`: JSONB agregat per milestone.
- `done_count`, `in_progress_count`, `queued_count`, `blocked_count`, `stale_count`: Ringkasan jumlah task.
- `metadata`: JSONB audit kontekstual.

### B. Event Observability Bus
Setiap kalkulasi progress material meng-emit event ke tabel `public.events`:
- `PROGRESS_UPDATED`: Snapshot baru berhasil dihitung dan dicatat.
- `MILESTONE_COMPLETED`: Milestone mencapai status 100%.
- `TASK_COMPLETED`: Task berhasil divalidasi `DONE`.
- `TASK_REOPENED`: Task dikembalikan ke status `QUEUED` atau `IN_PROGRESS`.
- `VALIDATION_BECAME_STALE`: Deteksi ketidakcocokan SHA validasi.
- `TASK_BLOCKED`: Task terblokir.

---

## 8. RPC Supabase Contract

### `get_project_progress()`
- **Method**: `STABLE FUNCTION`
- **Output JSON**:
```json
{
  "project_progress": 62.50,
  "total_weight": 40.00,
  "completed_weight": 25.00,
  "done_count": 25,
  "in_progress_count": 5,
  "queued_count": 8,
  "blocked_count": 1,
  "stale_count": 1,
  "milestones": [
    {
      "milestone": "M1",
      "name": "Runtime Kernel",
      "progress": 100.0,
      "total_weight": 10.0,
      "completed_weight": 10.0,
      "task_counts": { "done": 10, "in_progress": 0, "queued": 0, "blocked": 0, "stale": 0 }
    }
  ],
  "tasks": [
    {
      "task_key": "runtime-kernel/m1-runner",
      "milestone": "M1",
      "status": "DONE",
      "progress": 100.0,
      "evidence_commit_sha": "88dd4e56..."
    }
  ]
}
```

### `get_milestone_progress(p_milestone TEXT)`
- **Output JSON**: `{ "milestone": "M1", "progress": 100.0, "total_weight": 10.0, "completed_weight": 10.0, "task_counts": { ... } }`

### `get_task_progress(p_task_key TEXT)`
- **Output JSON**: `{ "success": true, "task_key": "...", "status": "DONE", "progress": 100.0, "evidence_commit_sha": "...", "acceptance_criteria": [...] }`

### `record_progress_snapshot(p_main_commit_sha TEXT, p_metadata JSONB)`
- **Output JSON**: `{ "success": true, "snapshot_id": "...", "project_progress": 62.50, "calculated_at": "..." }`

---

## 9. Concurrency & Reconciliation Safety
1. **Read-Only Invariant**: Progress Engine tidak pernah memodifikasi status task secara sepihak saat melakukan perhitungan progress.
2. **Reconciliation Inconsistency**: Jika database mengklaim task `DONE` namun commit SHA tidak ditemukan di GitHub atau hasil validasi tidak cocok, task ditandai sebagai `INCONSISTENT` pada hasil audit, dikecualikan dari bobot `DONE`, dan dicatat sebagai audit discrepancy tanpa merusak riwayat database.

---

## 10. Pemetaan 10 Spesialisasi Domain Kanonik ke Milestone
1. `runtime-kernel` $\rightarrow$ `M1: Runtime Kernel`
2. `execution-engine` $\rightarrow$ `M2: Execution Engine`
3. `data-plane` $\rightarrow$ `M3: Data Plane`
4. `memory` $\rightarrow$ `M4: Memory`
5. `node-system` $\rightarrow$ `M5: Node System`
6. `workflow-model` $\rightarrow$ `M6: Workflow Model`
7. `expression-engine` $\rightarrow$ `M7: Expression Engine`
8. `validation` $\rightarrow$ `M8: Validation`
9. `integration` $\rightarrow$ `M9: Integration`
10. `security` $\rightarrow$ `M10: Security`
