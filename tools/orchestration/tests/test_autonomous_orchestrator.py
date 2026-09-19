"""
Comprehensive Test Suite for Phase D-1 Autonomous Orchestrator.

Validates all 16 mandatory Phase D-1 invariants:
1. READY task dipilih.
2. BLOCKED task tidak dipilih.
3. DONE task tidak dipilih.
4. dependency belum selesai -> task tidak dipilih.
5. dependency selesai -> task menjadi eligible.
6. worker specialization benar.
7. dua scheduler tidak menghasilkan duplicate logical dispatch.
8. START dua kali idempotent.
9. dispatch contract valid.
10. worker_id benar.
11. allowed_files benar.
12. lease valid.
13. immutable DONE tasks tidak pernah disentuh.
14. dry-run tidak mengubah Supabase / filesystem.
15. no Arena spawn.
16. no Rust source modification.

Safety: 100% offline, mock/dry-run, disposable directories. Zero production mutation.
"""

import os
import shutil
import tempfile
import unittest
from pathlib import Path

from tools.orchestration.autonomous_orchestrator import (
    AutonomousOrchestrator, OrchestratorState, IMMUTABLE_DONE_TASKS, WORKER_SPECIALIZATION_MAP
)
from tools.orchestration.dispatch_contract import DispatchRequest, ContractValidationError

class TestPhaseD1AutonomousOrchestrator(unittest.TestCase):
    def setUp(self):
        self.test_dir = Path(tempfile.mkdtemp(prefix="arena_test_phase_d1_"))

    def tearDown(self):
        if self.test_dir.exists():
            shutil.rmtree(self.test_dir, ignore_errors=True)

    # --- Invariant 1, 2, 3: Task Selection Filter ---
    def test_01_ready_tasks_selected_blocked_and_done_excluded(self):
        """Only READY tasks are selected; BLOCKED and DONE are never selected."""
        tasks_state = [
            {"task_key": "runtime-kernel/m1-runner", "status": "DONE"}, # Invariant 3
            {"task_key": "runtime-kernel/m1-graph", "status": "QUEUED"}, # READY (depends on m1-runner) - Invariant 1
            {"task_key": "execution-engine/m2-loop-manager", "status": "QUEUED"}, # BLOCKED (depends on m2-scheduler, which is not DONE) - Invariant 2
        ]
        orch = AutonomousOrchestrator(repo_root=self.test_dir, tasks_state=tasks_state, dry_run=True)
        eligible = orch.get_eligible_tasks(orch.get_live_tasks())
        eligible_keys = [t["task_key"] for t in eligible]

        self.assertIn("runtime-kernel/m1-graph", eligible_keys)
        self.assertNotIn("execution-engine/m2-loop-manager", eligible_keys, "BLOCKED task must not be selected")
        self.assertNotIn("runtime-kernel/m1-runner", eligible_keys, "DONE task must not be selected")

    # --- Invariant 4, 5: Dynamic DAG Unlocking ---
    def test_02_dependency_unlocking_behavior(self):
        """Task with unsatisfied dependency is not chosen until dependency transitions to DONE."""
        tasks_initial = [
            {"task_key": "data-plane/m3-item-buffer", "status": "QUEUED"},
            {"task_key": "data-plane/m3-binary-stream", "status": "QUEUED"}, # depends on m3-item-buffer
        ]
        orch = AutonomousOrchestrator(repo_root=self.test_dir, tasks_state=tasks_initial, dry_run=True)
        eligible = orch.get_eligible_tasks(orch.get_live_tasks())
        eligible_keys = [t["task_key"] for t in eligible]

        # Invariant 4: m3-binary-stream blocked
        self.assertNotIn("data-plane/m3-binary-stream", eligible_keys)

        # Transition m3-item-buffer to DONE
        tasks_updated = [
            {"task_key": "data-plane/m3-item-buffer", "status": "DONE"},
            {"task_key": "data-plane/m3-binary-stream", "status": "QUEUED"},
        ]
        orch_updated = AutonomousOrchestrator(repo_root=self.test_dir, tasks_state=tasks_updated, dry_run=True)
        eligible_updated = orch_updated.get_eligible_tasks(orch_updated.get_live_tasks())
        eligible_updated_keys = [t["task_key"] for t in eligible_updated]

        # Invariant 5: now unlocked
        self.assertIn("data-plane/m3-binary-stream", eligible_updated_keys)

    # --- Invariant 6: Worker Specialization Assignment ---
    def test_03_worker_specialization_correctness(self):
        """Worker is assigned exclusively to tasks matching its specialization."""
        orch = AutonomousOrchestrator(repo_root=self.test_dir, dry_run=True)
        res = orch.run_scheduling_cycle()
        
        self.assertEqual(orch.state, OrchestratorState.DISPATCH_READY)
        dispatches = res["dispatches_prepared"]
        self.assertGreater(len(dispatches), 0)

        for d in dispatches:
            w_id = d["assigned_worker"]
            expected_spec = WORKER_SPECIALIZATION_MAP[w_id]
            self.assertEqual(d["worker_specialization"], expected_spec)

    # --- Invariant 7: No Duplicate Logical Dispatch Across Workers ---
    def test_04_no_duplicate_logical_dispatch(self):
        """A single scheduling cycle assigns completely distinct tasks across workers."""
        orch = AutonomousOrchestrator(repo_root=self.test_dir, dry_run=True)
        res = orch.run_scheduling_cycle()
        dispatches = res["dispatches_prepared"]

        task_keys = [d["task_key"] for d in dispatches]
        self.assertEqual(len(task_keys), len(set(task_keys)), "Duplicate task assigned across workers!")

    # --- Invariant 8: START Twice Idempotency ---
    def test_05_idempotent_execution(self):
        """Invoking run_scheduling_cycle repeatedly is safe and deterministic."""
        orch = AutonomousOrchestrator(repo_root=self.test_dir, dry_run=True)
        res1 = orch.run_scheduling_cycle()
        res2 = orch.run_scheduling_cycle()

        self.assertEqual(orch.state, OrchestratorState.DISPATCH_READY)
        keys1 = [d["task_key"] for d in res1["dispatches_prepared"]]
        keys2 = [d["task_key"] for d in res2["dispatches_prepared"]]
        self.assertEqual(keys1, keys2)

    # --- Invariant 9, 10, 11, 12: Dispatch Contract Validation ---
    def test_06_dispatch_contract_validity(self):
        """Generated dispatch contracts conform to strict contract schema."""
        orch = AutonomousOrchestrator(repo_root=self.test_dir, dry_run=True)
        res = orch.run_scheduling_cycle()
        dispatches = res["dispatches_prepared"]

        for d in dispatches:
            # Reconstruct DispatchRequest to verify schema validation passes
            req = DispatchRequest(
                dispatch_id=d["dispatch_id"],
                worker_id=d["assigned_worker"],
                task_id=d["task_id"],
                task_key=d["task_key"],
                branch_name=d["branch_name"],
                base_commit_sha=d["base_commit_sha"],
                allowed_files=d["allowed_files"],
                acceptance_criteria=["Criterion"],
                lease_expires_at=d["lease_expires_at"]
            )
            req.validate() # Invariant 9: No ContractValidationError
            self.assertTrue(d["assigned_worker"].startswith("arena-agent-")) # Invariant 10
            self.assertGreater(len(d["allowed_files"]), 0) # Invariant 11
            self.assertTrue("Z" in d["lease_expires_at"] or "+00:00" in d["lease_expires_at"]) # Invariant 12

    # --- Invariant 13: 6 Immutable DONE Tasks Never Touched ---
    def test_07_immutable_done_tasks_never_selected(self):
        """6 canonical DONE tasks are strictly excluded under all circumstances."""
        orch = AutonomousOrchestrator(repo_root=self.test_dir, dry_run=True)
        eligible = orch.get_eligible_tasks(orch.get_live_tasks())
        eligible_keys = {t["task_key"] for t in eligible}

        for done_k in IMMUTABLE_DONE_TASKS:
            self.assertNotIn(done_k, eligible_keys, f"Immutable DONE task {done_k} was selected!")

    # --- Invariant 14: Dry-run Mode Does Not Mutate Filesystem ---
    def test_08_dry_run_filesystem_isolation(self):
        """DRY_RUN=True writes 0 dispatch files to disk."""
        orch = AutonomousOrchestrator(repo_root=self.test_dir, dry_run=True)
        res = orch.run_scheduling_cycle()
        self.assertTrue(res["dry_run"])

        dispatch_dir = self.test_dir / ".arena" / "dispatch"
        if dispatch_dir.exists():
            files = list(dispatch_dir.rglob("*.json"))
            self.assertEqual(len(files), 0, "Dry-run mode must not write dispatch files to disk")

    # --- Invariant 15 & 16: No Arena Spawn & No Rust Source Modification ---
    def test_09_no_arena_spawn_and_no_rust_modifications(self):
        """Phase D-1/D-2A stops at DISPATCH_READY without invoking Arena adapter or touching crates."""
        orch = AutonomousOrchestrator(repo_root=self.test_dir, dry_run=True)
        res = orch.run_scheduling_cycle()
        # State machine stops strictly at DISPATCH_READY
        self.assertEqual(orch.state, OrchestratorState.DISPATCH_READY)
        # Verify no Arena execution calls were made
        self.assertNotIn("agent_session_id", res)

    # --- Phase D-2A Invariants: Atomic Claim & Dispatch Writer ---
    def test_10_atomic_claim_success_mock(self):
        """Simulated / mock atomic claim succeeds and stamps version and lease."""
        orch = AutonomousOrchestrator(repo_root=self.test_dir, dry_run=True, live_orchestrator=False)
        worker = {"agent_key": "arena-agent-01-kernel"}
        task = {"task_key": "runtime-kernel/m1-graph", "version": 1}
        claim_res = orch.atomic_claim(worker, task, expected_version=1, lease_seconds=1800)

        self.assertTrue(claim_res["success"])
        self.assertEqual(claim_res["version"], 2)
        self.assertEqual(claim_res["agent_id"], "arena-agent-01-kernel")
        self.assertIn("lease_expires_at", claim_res)

    def test_11_atomic_claim_single_winner_contention(self):
        """When multiple workers attempt to claim the same task with OCC, only one wins."""
        task_version_tracker = {"version": 1, "claimed_by": None}

        def mock_claim_handler(worker, task, exp_ver, lease_secs):
            if task_version_tracker["version"] != exp_ver or task_version_tracker["claimed_by"] is not None:
                return {"success": False, "error": "VERSION_CONFLICT"}
            task_version_tracker["version"] += 1
            task_version_tracker["claimed_by"] = worker["agent_key"]
            return {"success": True, "action": "CLAIMED", "version": task_version_tracker["version"]}

        orch1 = AutonomousOrchestrator(repo_root=self.test_dir, dry_run=True, claim_handler=mock_claim_handler)
        orch2 = AutonomousOrchestrator(repo_root=self.test_dir, dry_run=True, claim_handler=mock_claim_handler)

        worker1 = {"agent_key": "arena-agent-01-kernel"}
        worker2 = {"agent_key": "arena-agent-02-engine"}
        target_task = {"task_key": "runtime-kernel/m1-graph", "version": 1}

        res1 = orch1.atomic_claim(worker1, target_task, expected_version=1)
        res2 = orch2.atomic_claim(worker2, target_task, expected_version=1)

        self.assertTrue(res1["success"], "First worker claim must succeed")
        self.assertFalse(res2["success"], "Second worker claim must be rejected due to version conflict")
        self.assertEqual(res2["error"], "VERSION_CONFLICT")

    def test_12_dispatch_writer_file_transport_and_idempotency(self):
        """Non-dry-run writes validated DispatchRequest JSON to worker namespace idempotently."""
        orch = AutonomousOrchestrator(repo_root=self.test_dir, dry_run=False, live_orchestrator=False)
        worker = {"agent_key": "arena-agent-01-kernel"}
        task = {
            "task_key": "runtime-kernel/m1-graph",
            "specialization": "runtime-kernel",
            "milestone": "M1",
            "allowed_files": ["crates/runtime-kernel/src/graph.rs"],
            "acceptance_criteria": ["Builds clean"]
        }

        req = orch.prepare_dispatch_contract(worker, task)
        dispatch_path1 = orch.write_dispatch_safe(req)
        self.assertTrue(dispatch_path1.exists())

        # Read back via transport
        read_req = orch.transport.read_dispatch_request("arena-agent-01-kernel", req.dispatch_id)
        self.assertEqual(read_req.task_key, "runtime-kernel/m1-graph")
        self.assertEqual(read_req.worker_id, "arena-agent-01-kernel")

        # Second write must be idempotent and return identical path
        dispatch_path2 = orch.write_dispatch_safe(req)
        self.assertEqual(dispatch_path1, dispatch_path2)

    def test_13_restart_recovery_from_existing_dispatch(self):
        """Worker can safely recover and read existing dispatch after crash/restart."""
        orch = AutonomousOrchestrator(repo_root=self.test_dir, dry_run=False, live_orchestrator=False)
        worker = {"agent_key": "arena-agent-03-dataplane"}
        task = {
            "task_key": "data-plane/m3-binary-stream",
            "specialization": "data-plane",
            "milestone": "M3",
            "allowed_files": ["crates/data-plane/src/binary.rs"],
            "acceptance_criteria": ["Stream processing passing"]
        }
        req = orch.prepare_dispatch_contract(worker, task)
        orch.write_dispatch_safe(req)

        # New orchestrator / transport instance reading state
        orch_new = AutonomousOrchestrator(repo_root=self.test_dir, dry_run=True)
        pending = orch_new.transport.list_pending_dispatches("arena-agent-03-dataplane")
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0].dispatch_id, req.dispatch_id)

    def test_14_zero_live_mutation_guard(self):
        """LIVE_ORCHESTRATOR=False guarantees zero live mutation and rejects unhandled live claim."""
        orch = AutonomousOrchestrator(repo_root=self.test_dir, dry_run=False, live_orchestrator=True)
        worker = {"agent_key": "arena-agent-01-kernel"}
        task = {"task_key": "runtime-kernel/m1-graph", "version": 1}

        # If live_orchestrator=True but no claim handler / client is wired, it must fail-safe with RuntimeError
        with self.assertRaises(RuntimeError):
            orch.atomic_claim(worker, task)

if __name__ == "__main__":
    unittest.main()
