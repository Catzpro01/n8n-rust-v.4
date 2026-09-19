# Arena Control Plane — Authoritative RPC Contract & State Transitions

Dokumen ini mendefinisikan secara kanonik dan deterministik 13 Stored Procedures / RPCs pada Supabase Control Plane untuk koordinasi multi-agent Arena AI.

---

## Actor Authorization Matrix

| Operation | ARENA_AGENT | GITHUB_ACTION | BUILD_WORKER | AUDIT_WORKER | CLEANUP_WORKER | ANTIGRAVITY | SYSTEM |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `claim_task` | **YES** | NO | NO | NO | NO | NO | **YES** |
| `start_task` | **YES** | NO | NO | NO | NO | **YES** | **YES** |
| `submit_commit` | **YES** | NO | NO | NO | NO | **YES** | **YES** |
| `record_build_result` | NO | **YES** | **YES** | NO | NO | **YES** | **YES** |
| `record_test_result` | NO | **YES** | **YES** | NO | NO | **YES** | **YES** |
| `record_audit_result` | NO | **YES** | NO | **YES** | NO | **YES** | **YES** |
| `authorize_merge` | NO | NO | NO | NO | NO | **YES** | **YES** |
| `record_merge` | NO | **YES** | NO | NO | NO | **YES** | **YES** |
| `start_cleanup` | NO | NO | NO | NO | **YES** | **YES** | **YES** |
| `complete_cleanup` | NO | NO | NO | NO | **YES** | **YES** | **YES** |
| `acquire_file_lock` | **YES** | NO | NO | NO | NO | **YES** | **YES** |
| `release_file_lock` | **YES** | NO | NO | NO | NO | **YES** | **YES** |
| `reap_expired_leases` | NO | NO | NO | NO | NO | **YES** | **YES** |

---

## 1. `claim_task`
* **Caller Actor Types**: `ARENA_AGENT`, `SYSTEM`
* **Input Parameters**:
  - `p_task_id UUID`: ID tugas yang akan diklaim.
  - `p_agent_id UUID`: ID pekerja agen Arena.
  - `p_expected_version BIGINT`: Versi OCC tugas yang diharapkan.
* **Preconditions**:
  - `tasks.status == 'QUEUED'`
  - `agents.status == 'AVAILABLE'`
  - `tasks.specialization_id == agents.specialization_id`
  - Tidak ada konflik lock aktif pada `task_files` berkategori `exclusive`.
* **Transaction Boundary**: Single atomic database transaction (`FOR UPDATE` pada row `tasks` dan `agents`).
* **Database Rows Modified**:
  - `tasks`: `status = 'CLAIMED'`, `assigned_agent_id = p_agent_id`, `claimed_at = NOW()`, `version += 1`, `updated_at = NOW()`.
  - `agents`: `status = 'WORKING'`, `current_task_id = p_task_id`, `version += 1`, `updated_at = NOW()`.
  - `task_state_transitions`: Menambahkan 1 baris riwayat audit `QUEUED -> CLAIMED`.
* **Version/OCC Requirement**: Wajib menyertakan `expected_version`. Jika `tasks.version != expected_version`, batalkan transaksi.
* **Success Result**: `{"success": true, "status": "CLAIMED", "version": <new_version>}`
* **Error Codes**: `TASK_NOT_FOUND`, `AGENT_NOT_FOUND`, `INVALID_STATE`, `VERSION_CONFLICT`, `AGENT_NOT_AVAILABLE`, `SPECIALIZATION_MISMATCH`, `LOCK_CONFLICT`.
* **Idempotency**: Jika `tasks.status == 'CLAIMED'` dan `tasks.assigned_agent_id == p_agent_id`, kembalikan `{"success": true, "action": "IDEMPOTENT_RETURN", "version": tasks.version}`.
* **State Transition**: `QUEUED -> CLAIMED`
* **Side Effects**: Agent terikat eksklusif ke task, tidak dapat mengklaim task lain.

---

## 2. `start_task`
* **Caller Actor Types**: `ARENA_AGENT`, `ANTIGRAVITY`, `SYSTEM`
* **Input Parameters**:
  - `p_task_id UUID`
  - `p_agent_id UUID`
  - `p_expected_version BIGINT`
* **Preconditions**:
  - `tasks.id == p_task_id` dan `tasks.status == 'CLAIMED'`
  - `tasks.assigned_agent_id == p_agent_id`
* **Transaction Boundary**: Single atomic database transaction (`FOR UPDATE` pada `tasks`).
* **Database Rows Modified**:
  - `tasks`: `status = 'WORKING'`, `version += 1`, `updated_at = NOW()`.
  - `task_state_transitions`: Menambahkan baris `CLAIMED -> WORKING`.
* **Version/OCC Requirement**: `tasks.version == p_expected_version`.
* **Success Result**: `{"success": true, "status": "WORKING", "version": <new_version>}`
* **Error Codes**: `TASK_NOT_FOUND`, `NOT_TASK_OWNER`, `INVALID_STATE`, `VERSION_CONFLICT`.
* **Idempotency**: Jika status == `'WORKING'`, return `ALREADY_WORKING`.
* **State Transition**: `CLAIMED -> WORKING`
* **Side Effects**: Memulai penghitungan waktu aktif pengerjaan.

---

## 3. `submit_commit`
* **Caller Actor Types**: `ARENA_AGENT`, `ANTIGRAVITY`, `SYSTEM`
* **Input Parameters**:
  - `p_task_id UUID`
  - `p_agent_id UUID`
  - `p_commit_sha TEXT`: Git commit SHA baru yang dipush.
  - `p_expected_version BIGINT`
* **Preconditions**:
  - `tasks.assigned_agent_id == p_agent_id`
  - `tasks.status IN ('WORKING', 'PR_OPEN', 'BUILD_FAILED', 'TEST_FAILED', 'AUDIT_FAILED')`
* **Transaction Boundary**: Single atomic database transaction (`FOR UPDATE` pada `tasks`).
* **Database Rows Modified**:
  - `tasks`: `current_commit_sha = p_commit_sha`, `status = 'PR_OPEN'`, `version += 1`, `updated_at = NOW()`.
  - `task_state_transitions`: Menambahkan baris transisi ke `PR_OPEN` dengan metadata `commit_sha`.
* **Version/OCC Requirement**: `tasks.version == p_expected_version`.
* **Success Result**: `{"success": true, "status": "PR_OPEN", "commit_sha": p_commit_sha, "version": <new_version>}`
* **Error Codes**: `TASK_NOT_FOUND`, `NOT_TASK_OWNER`, `INVALID_STATE`, `VERSION_CONFLICT`.
* **Idempotency**: Jika SHA identik dan status `PR_OPEN`, return sukses idempoten.
* **State Transition**: `* -> PR_OPEN`
* **Side Effects**: **MENGINVALIDASI SELURUH HASIL VALIDASI LAMA**. Seluruh build/test/audit untuk commit sebelumnya menjadi STALE.

---

## 4. `record_build_result`
* **Caller Actor Types**: `GITHUB_ACTION`, `BUILD_WORKER`, `ANTIGRAVITY`, `SYSTEM`
* **Input Parameters**:
  - `p_task_id UUID`
  - `p_commit_sha TEXT`
  - `p_workflow_run_id TEXT`
  - `p_status TEXT`: `'PASSED'` atau `'FAILED'`
  - `p_log_url TEXT` (opsional)
* **Preconditions**: `tasks.id == p_task_id`
* **Transaction Boundary**: Single atomic database transaction.
* **Database Rows Modified**:
  - `build_jobs`: Selalu menyisipkan 1 baris riwayat telemetry build.
  - `tasks`: Jika `p_commit_sha == tasks.current_commit_sha`: `status = ('TESTING' IF PASSED ELSE 'BUILD_FAILED')`, `version += 1`.
  - `task_state_transitions`: Dicatat jika status berubah.
* **Version/OCC Requirement**: State task hanya maju jika SHA cocok dengan `current_commit_sha`.
* **Success Result**: `{"success": true, "status": <new_status>, "version": <new_version>}`
* **Error Codes**: `TASK_NOT_FOUND`, `STALE_COMMIT` (hasil tetap disimpan di `build_jobs`, tetapi state task ditolak untuk maju).
* **Idempotency**: Build run ID yang sama tidak mengeksekusi transisi ganda.
* **State Transition**: `BUILDING/PR_OPEN -> TESTING` (jika PASS) atau `BUILD_FAILED` (jika FAIL).
* **Side Effects**: Membuka jalan untuk eksekusi Level 2 / test runner jika PASS.

---

## 5. `record_test_result`
* **Caller Actor Types**: `GITHUB_ACTION`, `BUILD_WORKER`, `ANTIGRAVITY`, `SYSTEM`
* **Input Parameters**:
  - `p_task_id UUID`
  - `p_commit_sha TEXT`
  - `p_suite TEXT`
  - `p_command TEXT`
  - `p_passed INTEGER`, `p_failed INTEGER`, `p_skipped INTEGER`, `p_duration_ms INTEGER`
  - `p_status TEXT`: `'PASSED'` atau `'FAILED'`
  - `p_log_ref TEXT` (opsional)
* **Preconditions**: `tasks.id == p_task_id`
* **Transaction Boundary**: Single atomic database transaction.
* **Database Rows Modified**:
  - `test_results`: Selalu menyisipkan 1 baris hasil pengujian.
  - `tasks`: Jika `p_commit_sha == tasks.current_commit_sha`: `status = ('AUDITING' IF PASSED ELSE 'TEST_FAILED')`, `version += 1`.
  - `task_state_transitions`: Dicatat jika status berubah.
* **Success Result**: `{"success": true, "status": <target_status>, "version": <new_version>}`
* **Error Codes**: `TASK_NOT_FOUND`, `STALE_COMMIT`.
* **State Transition**: `TESTING -> AUDITING` (jika PASS) atau `TEST_FAILED` (jika FAIL).
* **Side Effects**: Memungkinkan auditor menjalankan audit arsitektur jika test PASS.

---

## 6. `record_audit_result`
* **Caller Actor Types**: `GITHUB_ACTION`, `AUDIT_WORKER`, `ANTIGRAVITY`, `SYSTEM`
* **Input Parameters**:
  - `p_task_id UUID`
  - `p_commit_sha TEXT`
  - `p_auditor TEXT`
  - `p_status TEXT`: `'PASS'`, `'FAIL'`, atau `'PASS_WITH_NOTES'`
  - `p_findings JSONB`
  - `p_severity TEXT`: `'NONE'`, `'LOW'`, `'MEDIUM'`, `'HIGH'`, `'CRITICAL'`
* **Preconditions**: `tasks.id == p_task_id`
* **Transaction Boundary**: Single atomic database transaction.
* **Database Rows Modified**:
  - `audit_results`: Selalu menyisipkan 1 baris hasil audit.
  - `tasks`: Jika SHA cocok: `status = ('READY_TO_MERGE' IF PASS/NOTES & NOT CRITICAL ELSE 'AUDIT_FAILED')`, `version += 1`.
* **Success Result**: `{"success": true, "status": <target_status>, "version": <new_version>}`
* **Error Codes**: `TASK_NOT_FOUND`, `STALE_COMMIT`.
* **State Transition**: `AUDITING -> READY_TO_MERGE` atau `AUDIT_FAILED`.
* **Side Effects**: Memberikan lampu hijau bagi otorisasi merge jika lulus.

---

## 7. `authorize_merge`
* **Caller Actor Types**: `ANTIGRAVITY`, `SYSTEM`
* **Input Parameters**:
  - `p_task_id UUID`
  - `p_commit_sha TEXT`
  - `p_expected_version BIGINT`
* **Preconditions**:
  - `tasks.status == 'READY_TO_MERGE'`
  - `tasks.current_commit_sha == p_commit_sha`
  - **Triple Validation Gate**:
    1. Ada record `build_jobs` dengan status `PASSED` untuk `p_commit_sha`.
    2. Ada record `test_results` dengan status `PASSED` untuk `p_commit_sha`.
    3. Ada record `audit_results` dengan status `PASS`/`PASS_WITH_NOTES` (non-critical) untuk `p_commit_sha`.
* **Transaction Boundary**: Single atomic database transaction (`FOR UPDATE` pada `tasks`).
* **Database Rows Modified**:
  - `tasks`: `status = 'MERGING'`, `version += 1`, `updated_at = NOW()`.
  - `task_state_transitions`: Menambahkan baris audit transisi ke `MERGING`.
* **Success Result**: `{"success": true, "status": "MERGING", "version": <new_version>}`
* **Error Codes**: `TASK_NOT_FOUND`, `INVALID_STATE`, `STALE_COMMIT`, `VERSION_CONFLICT`, `INCOMPLETE_VALIDATION`.
* **State Transition**: `READY_TO_MERGE -> MERGING`
* **Side Effects**: Membuka gerbang bagi proses merge PR di GitHub.

---

## 8. `record_merge`
* **Caller Actor Types**: `GITHUB_ACTION`, `ANTIGRAVITY`, `SYSTEM`
* **Input Parameters**:
  - `p_task_id UUID`
  - `p_merge_commit_sha TEXT`
  - `p_expected_version BIGINT`
* **Preconditions**: `tasks.status == 'MERGING'`
* **Transaction Boundary**: Single atomic database transaction (`FOR UPDATE` pada `tasks`).
* **Database Rows Modified**:
  - `tasks`: `status = 'POST_MERGE_VERIFY'`, `merge_commit_sha = p_merge_commit_sha`, `merged_at = NOW()`, `version += 1`, `updated_at = NOW()`.
* **Success Result**: `{"success": true, "status": "POST_MERGE_VERIFY", "version": <new_version>}`
* **Error Codes**: `TASK_NOT_FOUND`, `INVALID_STATE`, `VERSION_CONFLICT`.
* **Idempotency**: Jika status sudah `POST_MERGE_VERIFY` atau `MERGED`, return `ALREADY_MERGED`.
* **State Transition**: `MERGING -> POST_MERGE_VERIFY`
* **Side Effects**: Memicu verifikasi final di branch `main`.

---

## 9. `start_cleanup`
* **Caller Actor Types**: `CLEANUP_WORKER`, `ANTIGRAVITY`, `SYSTEM`
* **Input Parameters**:
  - `p_task_id UUID`
  - `p_expected_version BIGINT`
* **Preconditions**:
  - `tasks.status == 'POST_MERGE_VERIFY'`
  - Verifikasi post-merge di `main` telah PASS.
* **Transaction Boundary**: Single atomic database transaction (`FOR UPDATE` pada `tasks`).
* **Database Rows Modified**:
  - `tasks`: `status = 'CLEANUP'`, `version += 1`, `updated_at = NOW()`.
* **Success Result**: `{"success": true, "status": "CLEANUP", "version": <new_version>}`
* **Error Codes**: `TASK_NOT_FOUND`, `INVALID_STATE`, `VERSION_CONFLICT`, `ALREADY_IN_CLEANUP`.
* **Idempotency**: Jika status `COMPLETED`, return `ALREADY_COMPLETED`.
* **State Transition**: `POST_MERGE_VERIFY -> CLEANUP`
* **Side Effects**: Mengunci hak eksklusif worker untuk melakukan penghapusan remote branch.

---

## 10. `complete_cleanup`
* **Caller Actor Types**: `CLEANUP_WORKER`, `ANTIGRAVITY`, `SYSTEM`
* **Input Parameters**:
  - `p_task_id UUID`
  - `p_expected_version BIGINT`
* **Preconditions**:
  - `tasks.status == 'CLEANUP'`
  - Remote branch dan local workspace telah terhapus.
* **Transaction Boundary**: Single atomic database transaction (`FOR UPDATE` pada `tasks` dan `agents`).
* **Database Rows Modified**:
  - `locks`: Menghapus seluruh lock yang terikat pada `task_id`.
  - `agents`: `status = 'AVAILABLE'`, `current_task_id = NULL`, `version += 1`, `updated_at = NOW()`.
  - `tasks`: `status = 'COMPLETED'`, `completed_at = NOW()`, `deleted_at = NOW()`, `version += 1`, `updated_at = NOW()`.
* **Success Result**: `{"success": true, "status": "COMPLETED", "version": <new_version>}`
* **Error Codes**: `TASK_NOT_FOUND`, `INVALID_STATE`, `VERSION_CONFLICT`.
* **Idempotency**: Jika sudah `COMPLETED`, return `ALREADY_COMPLETED`.
* **State Transition**: `CLEANUP -> COMPLETED` (Terminal State, Immutable).
* **Side Effects**: Melepaskan seluruh resource lock ke pool, agen kembali tersedia.

---

## 11. `acquire_file_lock`
* **Caller Actor Types**: `ARENA_AGENT`, `ANTIGRAVITY`, `SYSTEM`
* **Input Parameters**:
  - `p_resource TEXT`: e.g. `'file:crates/n8n-workflow/src/runtime/runner.rs'`
  - `p_task_id UUID`
  - `p_agent_id UUID`
  - `p_ttl_seconds INTEGER DEFAULT 3600`
* **Preconditions**: Resource belum dikunci atau lease sebelumnya telah expired (`expires_at < NOW()`).
* **Transaction Boundary**: Single atomic database transaction (`FOR UPDATE` pada row `locks`).
* **Database Rows Modified**: `locks` (Insert row baru atau Update renew lease).
* **Success Result**: `{"acquired": true, "action": "ACQUIRED" | "RENEWED", "expires_at": <timestamptz>}`
* **Error Codes**: `LOCK_DENIED` (jika sedang dikunci oleh task lain yang aktif).
* **Side Effects**: Memberikan hak kepemilikan eksklusif atas file kepada task terkait.

---

## 12. `release_file_lock`
* **Caller Actor Types**: `ARENA_AGENT`, `ANTIGRAVITY`, `SYSTEM`
* **Input Parameters**:
  - `p_resource TEXT`
  - `p_task_id UUID`
  - `p_agent_id UUID`
* **Preconditions**: Resource dikunci oleh `p_task_id`.
* **Transaction Boundary**: Single atomic database transaction (`FOR UPDATE` pada `locks`).
* **Database Rows Modified**: Menghapus row dari `locks`.
* **Success Result**: `{"released": true, "status": "RELEASED"}`
* **Error Codes**: `UNAUTHORIZED_TASK_MISMATCH`.
* **Idempotency**: Jika lock tidak ditemukan, return `{"released": true, "status": "NOT_FOUND"}`.

---

## 13. `reap_expired_leases`
* **Caller Actor Types**: `ANTIGRAVITY`, `SYSTEM`
* **Input Parameters**: Tidak ada.
* **Preconditions**: Dipanggil secara berkala atau pada saat rekonsiliasi.
* **Transaction Boundary**: Single atomic database transaction.
* **Database Rows Modified**:
  - `locks`: Menghapus semua baris dengan `expires_at < NOW()`.
  - `agents`: Menandai agent yang `last_heartbeat < NOW() - 10 minutes` menjadi `OFFLINE`.
* **Success Result**: `{"success": true, "reaped_locks_count": <int>, "offline_agents_count": <int>, "timestamp": <now>}`
* **Side Effects**: Mencegah dead agent mengunci file/repo secara permanen.