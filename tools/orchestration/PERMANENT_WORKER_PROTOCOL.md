# Arena Worker Protocol & Operating Instructions

## Purpose
This document establishes the permanent, non-negotiable operational protocol for Agent Arena workers in the `n8n-rust-v.4` autonomous multi-worker environment.

This protocol applies universally to all arena workers (`arena-agent-01-kernel` through `arena-agent-05-security`) and is independent of specific tasks.

---

## 1. Zero Self-Selection Invariant
1. The Agent Arena **NEVER** selects or chooses tasks autonomously.
2. The Agent Arena **NEVER** claims tasks directly from Supabase or Git.
3. The Agent Arena operates strictly in a **WAIT $\rightarrow$ EXECUTE $\rightarrow$ REPORT** loop driven exclusively by dispatch contracts.

---

## 2. Dispatch Lifecycle & Execution Rules

### Step 1: Wait for Dispatch
- The worker monitors its isolated namespace: `.arena/dispatch/<worker_id>/<dispatch_id>.json`.
- The worker must never inspect or consume files from other worker namespaces (`.arena/dispatch/<other_worker_id>/`).

### Step 2: Ingest & Validate Contract
Before reading or editing any project files, the worker must validate:
1. `worker_id` matches its own registered identity.
2. `dispatch_id` matches the filename.
3. `protocol_version` matches canonical `1.0.0`.
4. `base_commit_sha` exists and is checked out as baseline.
5. `branch_name` matches format `<specialization>/<milestone>-<task-name>`.
6. `allowed_files` whitelist is present and non-empty.
7. `lease_expires_at` has not expired (`current_time < lease_expires_at`).

If any check fails:
- Immediately reject dispatch.
- Do NOT modify any files.
- Record failure reason in result response.

### Step 3: Strict Scope Boundary (Allowed Files)
- The worker is **STRICTLY FORBIDDEN** from modifying, creating, or deleting files outside the `allowed_files` list.
- Touching files outside `allowed_files` results in immediate **REJECTION** by the `TaskBoundaryGuard` and `ResultValidator`.
- The worker must never touch the 6 IMMUTABLE DONE tasks:
  1. `runtime-kernel/m1-runner`
  2. `execution-engine/m2-state-machine`
  3. `data-plane/m3-item-buffer`
  4. `security/m10-fs-sandbox`
  5. `runtime-kernel/m1-frame`
  6. `expression-engine/m7-tokenizer`
- Touching workspace configuration (`Cargo.toml`, root files, `.arena/`, `.github/`) without explicit whitelist permission is strictly forbidden.

### Step 4: Verification & Acceptance Criteria
- Implement code strictly to satisfy `acceptance_criteria` specified in `DispatchRequest`.
- Run required unit tests or local checks within resource limits governed by `ResourceGovernor`.
- Do not run uncoordinated background heavy builds.

### Step 5: Git Commit Contract
- Commit all changes on `branch_name`.
- Baseline commit must strictly be `base_commit_sha`.
- Never force-push (`git push --force`).
- Never delete or rebase branches created by other agents.
- Obtain genuine commit SHA.

### Step 6: Atomic Result Submission
- Write execution outcome atomically into:
  `.arena/results/<worker_id>/<dispatch_id>.result.json`.
- Adhere strictly to the `ResultResponse` schema:
  - `dispatch_id`
  - `task_id`
  - `worker_id`
  - `agent_session_id`
  - `status` (`SUCCESS` or `FAILED`)
  - `commit_sha` (required if SUCCESS)
  - `branch_name` (required if SUCCESS)
  - `files_modified`
  - `test_evidence`
  - `started_at` & `completed_at` (epoch seconds)
  - `error_code` & `error_message` (if FAILED)

### Step 7: Await Next Cycle
- Once the result is written, the worker must stop immediately and await the next dispatch from the Autonomous Orchestrator.
- The worker must **NEVER** mark a task as `DONE` or `COMPLETED` in Supabase directly; status transitions to `COMPLETED/DONE` are authorized solely by the Autonomous Orchestrator and Build/Test Gate after verification.
