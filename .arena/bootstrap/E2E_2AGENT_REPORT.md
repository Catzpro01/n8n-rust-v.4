# Laporan Resmi: Verifikasi E2E 2-Agent & Penegakan Isolasi Sub-LEGO (Authoritative Control Plane)

## Ringkasan Eksekutif
Berdasarkan audit temuan tingkat lanjut, seluruh inferensi nama berbasis substring (`task_id.split("-")[0]`) dan celah fallback fail-open telah **dihapus total**. Kini, rantai orkestrasi beroperasi secara **100% Authoritative & Fail-Closed** berbasis *Task Manifest* (`.arena/tasks/<task_id>.yaml`) dan *Sub-LEGO Registry* (`.arena/registry/sublego.yaml`).

---

### 1. Matrix Penegakan Kepemilikan Sub-LEGO (Ownership Matrix)

| Skenario Uji | Agen Peminta | Target Sub-LEGO | Pemilik Asli | Hasil Evaluasi | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Legitimate Dispatch 1** | `agent-01` | `workflow.graph` | `agent-01` | **ALLOWED** (Enqueued & Executed) | ✅ PASS |
| **Cross-Agent Access 1** | `agent-01` | `expression.compiler` | `agent-04` | **DENIED** (`Ownership violation`) | ✅ PASS |
| **Legitimate Dispatch 2** | `agent-04` | `expression.evaluator` | `agent-04` | **ALLOWED** (Enqueued & Executed) | ✅ PASS |
| **Cross-Agent Access 2** | `agent-04` | `workflow.graph` | `agent-01` | **DENIED** (`Ownership violation`) | ✅ PASS |
| **Forged Queue Injection** | `agent-01` | Injeksi Sub-LEGO lain | `agent-04` | **BLOCKED** (`Security Rejection`) | ✅ PASS |
| **Unknown Sub-LEGO** | Sembarang | `nonexistent.sublego.foo` | Tidak Terdaftar | **FAIL-CLOSED REJECT** (`Security Violation`) | ✅ PASS |

---

### 2. Eliminasi Fallback Fail-Open di Executor (`cli.py`)

- **Kondisi Sebelumnya**: Jika Sub-LEGO tidak ditemukan, fungsi mengembalikan `["**"]` (mengizinkan akses penuh ke seluruh workspace).
- **Kondisi Baru (Fix)**:
  ```python
  def load_sublego_rules(sublego_id: str, repo_dir: Path) -> tuple[list[str], list[str]]:
      if not sublego_id:
          raise SecurityViolation("Missing sublego_id in execution job (fail-closed)")
      ...
      # Jika tidak ditemukan di sublego.yaml:
      raise SecurityViolation(f"Unknown Sub-LEGO '{sublego_id}' not found in registry (fail-closed)")
  ```
- **Bukti Uji Nyata di VPS**:
  ```
  Enqueued unknown sublego job: test_unknown_1789732382.json
  [RESULT] Unknown sublego result: success=False, error=Security Violation: Unknown Sub-LEGO 'nonexistent.sublego.foo' not found in registry (fail-closed)
  [PASS] Unknown Sub-LEGO strictly rejected (fail-closed, 0% fallback to allow all).
  ```

---

### 3. Alur Baru Webhook Bridge: Dual Distributed Locking

Di `tools/arena-bridge/server.py`:
1. **Validasi Task Manifest**: Membaca `.arena/tasks/<task-id>.yaml`. Jika berkas tidak ada $\rightarrow$ **HTTP 422 Unprocessable Entity (Fail-Closed)**.
2. **Validasi Agent Mismatch**: Memastikan `manifest.agent == branch.agent`. Jika tidak cocok $\rightarrow$ **HTTP 403 Forbidden**.
3. **Validasi Sub-LEGO Ownership**: Memanggil `dispatcher.validate_agent_task(agent_id, sublego_id)`. Jika bukan pemilik resmi di `sublego.yaml` $\rightarrow$ **HTTP 403 Forbidden**.
4. **Dual Locking di Supabase**:
   - `acquire_lock(sublego_id, "sublego", agent_id, task_id)`: Mengunci balok Sub-LEGO agar tidak ada agen lain yang mengutak-atik Sub-LEGO tersebut secara bersamaan.
   - `acquire_lock(f"task:{task_id}", "task", agent_id, task_id)`: Mengunci lease task.
5. **Dispatch ke Queue**: Hanya jika seluruh validasi di atas lulus, job descriptor dikirimkan ke `/srv/arena/runtime/queue/incoming/`.

---

### 4. Hasil Eksekusi Riil End-to-End di VPS Host (`157.10.160.95`)

- **Task 1 (`TASK-WFL-GRAPH-01`)**:
  - Agen: `agent-01`
  - Sub-LEGO: `workflow.graph`
  - Workspace: `/srv/arena/workspaces/agent-01`
  - Command: `cargo check`
  - Hasil: **`exit_code: 0`, Success: True**
- **Task 2 (`TASK-EXP-EVAL-01`)**:
  - Agen: `agent-04`
  - Sub-LEGO: `expression.evaluator`
  - Workspace: `/srv/arena/workspaces/agent-04`
  - Command: `cargo test -p n8n-expression`
  - Hasil: **`exit_code: 0`, 2 passed; 0 failed, Success: True**
- **Audit Logging**: Kedua eksekusi tercatat di tabel Supabase `execution_runs` dan berkas bukti `/srv/arena/runtime/queue/completed/`.
