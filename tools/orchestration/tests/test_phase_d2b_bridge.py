"""
Phase D-2B Real Arena Bridge Integration Test Suite.

Validates all 20 required Phase D-2B safety and functional invariants:
1. Valid dispatch diterima.
2. Invalid worker rejected.
3. Invalid dispatch rejected.
4. Expired dispatch rejected.
5. Replay dispatch rejected.
6. Valid result diterima.
7. Wrong worker rejected.
8. Wrong dispatch rejected.
9. Wrong task rejected.
10. Changed file outside whitelist rejected.
11. Invalid commit rejected.
12. Duplicate result rejected.
13. Lease boundary accepted (completed_at == lease_expires_at).
14. Expired result rejected.
15. Worker restart recovery.
16. Orchestrator restart recovery.
17. ResourceGovernor prevents excessive build concurrency.
18. No production mutation.
19. No real Arena spawn.
20. 6 DONE tasks remain immutable.

Zero production mutation: 100% isolated, disposable test directories.
"""

import os
import shutil
import tempfile
import unittest
import datetime
from pathlib import Path

from tools.orchestration.dispatch_contract import (
    DispatchRequest, ResultResponse, ContractValidationError, PROTOCOL_VERSION
)
from tools.orchestration.arena_adapter import DisabledArenaAdapter
from tools.orchestration.arena_worker_bridge import ArenaWorkerBridge, CANARY_ENABLED
from tools.orchestration.file_transport import AtomicFileTransport
from tools.orchestration.resource_governor import ResourceGovernor
from tools.orchestration.autonomous_orchestrator import (
    AutonomousOrchestrator, IMMUTABLE_DONE_TASKS
)

class TestPhaseD2BArenaBridge(unittest.TestCase):
    def setUp(self):
        self.test_dir = Path(tempfile.mkdtemp(prefix="arena_test_phase_d2b_"))
        self.transport = AtomicFileTransport(repo_root=self.test_dir)
        self.governor = ResourceGovernor(lock_dir=self.test_dir / ".arena" / "run" / "locks", max_build_slots=1)
        self.bridge = ArenaWorkerBridge(
            worker_id="arena-agent-01-kernel",
            repo_root=self.test_dir,
            transport=self.transport,
            governor=self.governor,
            canary_enabled=False
        )

    def tearDown(self):
        if self.test_dir.exists():
            shutil.rmtree(self.test_dir, ignore_errors=True)

    def _sample_dispatch_request(
        self,
        worker_id: str = "arena-agent-01-kernel",
        lease_seconds: int = 1800
    ) -> DispatchRequest:
        expiry = (
            datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=lease_seconds)
        ).isoformat()
        req = DispatchRequest(
            worker_id=worker_id,
            task_id="task-runtime-kernel-m1-graph",
            task_key="runtime-kernel/m1-graph",
            branch_name="runtime-kernel/m1-graph",
            base_commit_sha="b64b6c2b607a462ba7f6eff7415902a010aa425e",
            allowed_files=["crates/runtime-kernel/src/graph.rs"],
            acceptance_criteria=["Clean build"],
            lease_expires_at=expiry
        )
        req.validate()
        return req

    # --- Test 1: Valid dispatch diterima ---
    def test_01_valid_dispatch_accepted(self):
        req = self._sample_dispatch_request()
        valid, reason = self.bridge.validate_inbound_dispatch(req)
        self.assertTrue(valid)
        self.assertIsNone(reason)

    # --- Test 2: Invalid worker rejected ---
    def test_02_invalid_worker_rejected(self):
        req = self._sample_dispatch_request(worker_id="arena-agent-02-engine")
        valid, reason = self.bridge.validate_inbound_dispatch(req)
        self.assertFalse(valid)
        self.assertIn("worker_id mismatch", reason)

    # --- Test 3: Invalid dispatch rejected ---
    def test_03_invalid_dispatch_rejected(self):
        req = self._sample_dispatch_request()
        req.dispatch_id = "invalid/dispatch/traversal/.."
        valid, reason = self.bridge.validate_inbound_dispatch(req)
        self.assertFalse(valid)
        self.assertIn("Contract validation error", reason)

    # --- Test 4: Expired dispatch rejected ---
    def test_04_expired_dispatch_rejected(self):
        req = self._sample_dispatch_request(lease_seconds=-10)
        valid, reason = self.bridge.validate_inbound_dispatch(req)
        self.assertFalse(valid)
        self.assertIn("already expired", reason)

    # --- Test 5: Replay dispatch rejected ---
    def test_05_replay_dispatch_rejected(self):
        req = self._sample_dispatch_request()
        # Mark as processed
        self.transport.mark_dispatch_processed("arena-agent-01-kernel", req.dispatch_id, "mock_sha")
        valid, reason = self.bridge.validate_inbound_dispatch(req)
        self.assertFalse(valid)
        self.assertIn("Replay detected", reason)

    # --- Test 6: Valid result diterima ---
    def test_06_valid_result_accepted(self):
        req = self._sample_dispatch_request()
        res = ResultResponse(
            dispatch_id=req.dispatch_id,
            task_id=req.task_id,
            worker_id="arena-agent-01-kernel",
            agent_session_id="session-01",
            status="SUCCESS",
            commit_sha="a" * 40,
            branch_name=req.branch_name,
            files_modified=["crates/runtime-kernel/src/graph.rs"]
        )
        submit_res = self.bridge.submit_and_validate_result(res, req, enforce_git_check=False)
        self.assertTrue(submit_res["valid"])
        self.assertEqual(submit_res["status"], "RESULT_ACCEPTED")

    # --- Test 7: Wrong worker rejected ---
    def test_07_wrong_worker_rejected(self):
        req = self._sample_dispatch_request()
        res = ResultResponse(
            dispatch_id=req.dispatch_id,
            task_id=req.task_id,
            worker_id="arena-agent-02-engine",
            agent_session_id="session-02",
            status="SUCCESS",
            commit_sha="a" * 40,
            branch_name=req.branch_name,
            files_modified=["crates/runtime-kernel/src/graph.rs"]
        )
        submit_res = self.bridge.submit_and_validate_result(res, req, enforce_git_check=False)
        self.assertFalse(submit_res["valid"])
        self.assertEqual(submit_res["status"], "INVALID_CONTRACT")

    # --- Test 8: Wrong dispatch rejected ---
    def test_08_wrong_dispatch_rejected(self):
        req = self._sample_dispatch_request()
        res = ResultResponse(
            dispatch_id="dispatch-other-1234",
            task_id=req.task_id,
            worker_id="arena-agent-01-kernel",
            agent_session_id="session-01",
            status="SUCCESS",
            commit_sha="a" * 40,
            branch_name=req.branch_name,
            files_modified=["crates/runtime-kernel/src/graph.rs"]
        )
        submit_res = self.bridge.submit_and_validate_result(res, req, enforce_git_check=False)
        self.assertFalse(submit_res["valid"])
        self.assertEqual(submit_res["status"], "INVALID_CONTRACT")

    # --- Test 9: Wrong task rejected ---
    def test_09_wrong_task_rejected(self):
        req = self._sample_dispatch_request()
        res = ResultResponse(
            dispatch_id=req.dispatch_id,
            task_id="task-wrong-m2-loop",
            worker_id="arena-agent-01-kernel",
            agent_session_id="session-01",
            status="SUCCESS",
            commit_sha="a" * 40,
            branch_name=req.branch_name,
            files_modified=["crates/runtime-kernel/src/graph.rs"]
        )
        submit_res = self.bridge.submit_and_validate_result(res, req, enforce_git_check=False)
        self.assertFalse(submit_res["valid"])
        self.assertEqual(submit_res["status"], "INVALID_CONTRACT")

    # --- Test 10: Changed file outside whitelist rejected ---
    def test_10_changed_file_outside_whitelist_rejected(self):
        req = self._sample_dispatch_request()
        res = ResultResponse(
            dispatch_id=req.dispatch_id,
            task_id=req.task_id,
            worker_id="arena-agent-01-kernel",
            agent_session_id="session-01",
            status="SUCCESS",
            commit_sha="a" * 40,
            branch_name=req.branch_name,
            files_modified=["crates/runtime-kernel/src/graph.rs", "Cargo.toml"]
        )
        submit_res = self.bridge.submit_and_validate_result(res, req, enforce_git_check=False)
        self.assertFalse(submit_res["valid"])
        self.assertEqual(submit_res["status"], "BOUNDARY_VIOLATION")

    # --- Test 11: Invalid commit rejected ---
    def test_11_invalid_commit_rejected(self):
        req = self._sample_dispatch_request()
        res = ResultResponse(
            dispatch_id=req.dispatch_id,
            task_id=req.task_id,
            worker_id="arena-agent-01-kernel",
            agent_session_id="session-01",
            status="SUCCESS",
            commit_sha="invalid-sha",
            branch_name=req.branch_name,
            files_modified=["crates/runtime-kernel/src/graph.rs"]
        )
        with self.assertRaises(ContractValidationError):
            res.validate()

    # --- Test 12: Duplicate result rejected ---
    def test_12_duplicate_result_rejected(self):
        req = self._sample_dispatch_request()
        res = ResultResponse(
            dispatch_id=req.dispatch_id,
            task_id=req.task_id,
            worker_id="arena-agent-01-kernel",
            agent_session_id="session-01",
            status="SUCCESS",
            commit_sha="a" * 40,
            branch_name=req.branch_name,
            files_modified=["crates/runtime-kernel/src/graph.rs"]
        )
        res1 = self.bridge.submit_and_validate_result(res, req, enforce_git_check=False)
        self.assertTrue(res1["valid"])
        # Second submission must be rejected as replay
        res2 = self.bridge.submit_and_validate_result(res, req, enforce_git_check=False)
        self.assertFalse(res2["valid"])
        self.assertEqual(res2["status"], "REJECTED")

    # --- Test 13: Lease boundary accepted (completed_at == lease_expires_at) ---
    def test_13_lease_boundary_accepted(self):
        req = self._sample_dispatch_request(lease_seconds=300)
        lease_dt = datetime.datetime.fromisoformat(req.lease_expires_at.replace("Z", "+00:00"))
        exact_lease_ts = lease_dt.timestamp()

        res = ResultResponse(
            dispatch_id=req.dispatch_id,
            task_id=req.task_id,
            worker_id="arena-agent-01-kernel",
            agent_session_id="session-01",
            status="SUCCESS",
            commit_sha="b" * 40,
            branch_name=req.branch_name,
            files_modified=["crates/runtime-kernel/src/graph.rs"],
            completed_at=exact_lease_ts
        )
        submit_res = self.bridge.submit_and_validate_result(res, req, enforce_git_check=False)
        self.assertTrue(submit_res["valid"])
        self.assertEqual(submit_res["status"], "RESULT_ACCEPTED")

    # --- Test 14: Expired result rejected ---
    def test_14_expired_result_rejected(self):
        req = self._sample_dispatch_request(lease_seconds=300)
        lease_dt = datetime.datetime.fromisoformat(req.lease_expires_at.replace("Z", "+00:00"))
        over_lease_ts = lease_dt.timestamp() + 5.0 # 5 seconds past lease

        res = ResultResponse(
            dispatch_id=req.dispatch_id,
            task_id=req.task_id,
            worker_id="arena-agent-01-kernel",
            agent_session_id="session-01",
            status="SUCCESS",
            commit_sha="c" * 40,
            branch_name=req.branch_name,
            files_modified=["crates/runtime-kernel/src/graph.rs"],
            completed_at=over_lease_ts
        )
        submit_res = self.bridge.submit_and_validate_result(res, req, enforce_git_check=False)
        self.assertFalse(submit_res["valid"])
        self.assertEqual(submit_res["status"], "INVALID_CONTRACT")

    # --- Test 15: Worker restart recovery ---
    def test_15_worker_restart_recovery(self):
        req = self._sample_dispatch_request()
        self.transport.write_dispatch_request(req)

        # Worker restarts with fresh bridge
        fresh_bridge = ArenaWorkerBridge(
            worker_id="arena-agent-01-kernel",
            repo_root=self.test_dir,
            transport=self.transport,
            governor=self.governor
        )
        poll_res = fresh_bridge.poll_and_process_dispatch(req.dispatch_id)
        self.assertTrue(poll_res["success"])
        self.assertEqual(poll_res["action"], "HELD_AT_GATE")

    # --- Test 16: Orchestrator restart recovery ---
    def test_16_orchestrator_restart_recovery(self):
        orch1 = AutonomousOrchestrator(repo_root=self.test_dir, dry_run=False)
        worker = {"agent_key": "arena-agent-01-kernel"}
        task = {
            "task_key": "runtime-kernel/m1-graph",
            "specialization": "runtime-kernel",
            "milestone": "M1",
            "allowed_files": ["crates/runtime-kernel/src/graph.rs"],
            "acceptance_criteria": ["Pass tests"]
        }
        req = orch1.prepare_dispatch_contract(worker, task)
        orch1.write_dispatch_safe(req)

        # New orchestrator instance recovers
        orch2 = AutonomousOrchestrator(repo_root=self.test_dir, dry_run=True)
        pending = orch2.transport.list_pending_dispatches("arena-agent-01-kernel")
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0].dispatch_id, req.dispatch_id)

    # --- Test 17: ResourceGovernor prevents excessive build concurrency ---
    def test_17_resource_governor_build_concurrency(self):
        # Max slots = 1
        slot1 = self.governor.acquire_build_slot()
        self.assertIsNotNone(slot1)
        slot2 = self.governor.acquire_build_slot()
        self.assertIsNone(slot2, "Second build slot must be denied when max_build_slots=1")
        self.governor.release_build_slot(slot1)

    # --- Test 18: No production mutation ---
    def test_18_no_production_mutation(self):
        status = self.bridge.get_bridge_status()
        self.assertEqual(status["CANARY"], "DISABLED")
        self.assertEqual(status["AUTO_CLAIM"], "DISABLED")
        self.assertEqual(status["PRODUCTION_EXECUTION"], "DISABLED")

    # --- Test 19: No real Arena spawn ---
    def test_19_no_real_arena_spawn(self):
        self.assertIsInstance(self.bridge.adapter, DisabledArenaAdapter)
        session = self.bridge.adapter.create_session("arena-agent-01-kernel", "agent-01")
        self.assertEqual(session["status"], "DISABLED")

    # --- Test 20: 6 DONE tasks remain immutable ---
    def test_20_immutable_done_tasks_untouched(self):
        orch = AutonomousOrchestrator(repo_root=self.test_dir, dry_run=True)
        eligible = orch.get_eligible_tasks(orch.get_live_tasks())
        eligible_keys = {t["task_key"] for t in eligible}
        for done_key in IMMUTABLE_DONE_TASKS:
            self.assertNotIn(done_key, eligible_keys)

if __name__ == "__main__":
    unittest.main()
