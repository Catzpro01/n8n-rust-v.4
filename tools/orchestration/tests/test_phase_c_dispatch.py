"""
Comprehensive Test Suite for Phase C.2 Dispatch & Arena Adapter Infrastructure.
Covers all P0 and P1 security, isolation, lease, recovery, and replay invariants:

1. path traversal dispatch_id
2. absolute path dispatch_id
3. Windows path dispatch_id
4. worker namespace isolation
5. worker_id validation
6. wrong worker result
7. wrong task result
8. expired lease
9. exact lease boundary
10. malformed timestamp
11. stale PID lock
12. live PID lock
13. malformed lock
14. non-owner release
15. owner release
16. duplicate result
17. conflicting replay
18. process restart replay behavior
19. DisabledArenaAdapter NO-OP guarantee
20. State machine illegal transitions

Safety: 100% offline/local in isolated temp directories.
Zero Supabase calls. Zero actual process killing.
"""

import os
import json
import uuid
import shutil
import tempfile
import unittest
from pathlib import Path

from tools.orchestration.dispatch_contract import (
    DispatchRequest, ResultResponse, ContractValidationError, PROTOCOL_VERSION
)
from tools.orchestration.file_transport import AtomicFileTransport
from tools.orchestration.arena_adapter import DisabledArenaAdapter
from tools.orchestration.result_validator import ResultValidator, GitResultValidator
from tools.orchestration.resource_governor import ResourceGovernor
from tools.orchestration.dispatch_state_machine import DispatchStateMachine, DispatchState

class TestPhaseC2DispatchInfrastructure(unittest.TestCase):
    def setUp(self):
        self.test_dir = Path(tempfile.mkdtemp(prefix="arena_test_phase_c2_"))
        self.transport = AtomicFileTransport(repo_root=self.test_dir)

    def tearDown(self):
        if self.test_dir.exists():
            shutil.rmtree(self.test_dir, ignore_errors=True)

    # --- 1, 2, 3: Path Traversal Tests (P0-1) ---
    def test_01_path_traversal_dispatch_id_rejected(self):
        """Rejects relative traversal patterns."""
        for evil_id in ["../evil", "../../evil", "a/b", "a\\b", "..", "."]:
            with self.assertRaises(ContractValidationError):
                self.transport.read_dispatch_request("worker-01", evil_id)
            with self.assertRaises(ContractValidationError):
                self.transport.read_result_response("worker-01", evil_id)

    def test_02_absolute_path_dispatch_id_rejected(self):
        """Rejects absolute POSIX paths."""
        for evil_id in ["/tmp/evil", "/etc/passwd"]:
            with self.assertRaises(ContractValidationError):
                self.transport.read_dispatch_request("worker-01", evil_id)

    def test_03_windows_path_dispatch_id_rejected(self):
        """Rejects Windows drive letters and UNC paths."""
        for evil_id in ["C:/evil", "C:\\evil", "\\\\unc\\share"]:
            with self.assertRaises(ContractValidationError):
                self.transport.read_dispatch_request("worker-01", evil_id)

    # --- 4, 5: Worker Namespace Isolation & worker_id Validation (P0-2) ---
    def test_04_worker_namespace_isolation(self):
        """Worker A cannot read Worker B's dispatch or result."""
        req_a = DispatchRequest(
            dispatch_id="disp-001",
            worker_id="worker-A",
            task_id="task-001",
            task_key="runtime-kernel/m1-frame",
            branch_name="runtime-kernel/m1-frame",
            base_commit_sha="06c5133ec20661c416cdc099b1aaf7cb8ee3353d",
            allowed_files=["crates/n8n-workflow/src/runtime/frame.rs"],
            acceptance_criteria=[],
            lease_expires_at="2026-09-20T01:00:00Z"
        )
        self.transport.write_dispatch_request(req_a)

        # Worker A can read
        self.assertIsNotNone(self.transport.read_dispatch_request("worker-A", "disp-001"))
        # Worker B reading Worker A's dispatch returns None (NOT FOUND / ISOLATED)
        self.assertIsNone(self.transport.read_dispatch_request("worker-B", "disp-001"))

        # Result isolation
        res_b = ResultResponse(
            dispatch_id="disp-002",
            task_id="task-002",
            worker_id="worker-B",
            agent_session_id="sess-002",
            status="SUCCESS",
            commit_sha="abcdef1234567890",
            branch_name="runtime-kernel/m1-frame"
        )
        self.transport.write_result_response(res_b)
        self.assertIsNotNone(self.transport.read_result_response("worker-B", "disp-002"))
        self.assertIsNone(self.transport.read_result_response("worker-A", "disp-002"))

    def test_05_worker_id_validation(self):
        """Rejects unsafe or empty worker_id."""
        for bad_w in ["../worker", "worker/a", "", " "]:
            with self.assertRaises(ContractValidationError):
                self.transport.read_dispatch_request(bad_w, "valid-disp-id")

    # --- 6, 7, 8, 9, 10: ResultValidator & Lease Boundary Tests (P0-4) ---
    def test_06_wrong_worker_result_rejected(self):
        """Rejects result if worker_id doesn't match expected."""
        res = ResultResponse(
            dispatch_id="disp-001",
            task_id="task-001",
            worker_id="worker-imposter",
            agent_session_id="sess-001",
            status="SUCCESS",
            commit_sha="abcdef1234567890",
            branch_name="runtime-kernel/m1-frame"
        )
        is_valid, errors = ResultValidator.validate(res, expected_worker_id="worker-legit")
        self.assertFalse(is_valid)
        self.assertTrue(any("worker_id mismatch" in e for e in errors))

    def test_07_wrong_task_result_rejected(self):
        """Rejects result if task_id doesn't match expected."""
        res = ResultResponse(
            dispatch_id="disp-001",
            task_id="task-wrong",
            worker_id="worker-01",
            agent_session_id="sess-001",
            status="SUCCESS",
            commit_sha="abcdef1234567890",
            branch_name="runtime-kernel/m1-frame"
        )
        is_valid, errors = ResultValidator.validate(res, expected_task_id="task-correct")
        self.assertFalse(is_valid)
        self.assertTrue(any("task_id mismatch" in e for e in errors))

    def test_08_expired_lease_rejected(self):
        """Rejects result completed after lease has expired."""
        res = ResultResponse(
            dispatch_id="disp-001",
            task_id="task-001",
            worker_id="worker-01",
            agent_session_id="sess-001",
            status="SUCCESS",
            commit_sha="abcdef1234567890",
            branch_name="runtime-kernel/m1-frame",
            completed_at=1789840000.0
        )
        is_valid, errors = ResultValidator.validate(
            res,
            expected_lease_expires_at="2026-09-20T00:00:00Z"  # epoch ~1789862400 in test mock or earlier
        )
        # 1789840000 > 1726790400 (if 2024) or past timestamp
        is_valid_exp, errors_exp = ResultValidator.validate(
            res,
            expected_lease_expires_at="2026-01-01T00:00:00Z"  # earlier than completed_at
        )
        self.assertFalse(is_valid_exp)
        self.assertTrue(any("lease expired" in e for e in errors_exp))

    def test_09_exact_lease_boundary_accepted(self):
        """completed_at == lease_expires_at is accepted."""
        ts = 1789830000.0
        import datetime
        dt_str = datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc).isoformat()
        res = ResultResponse(
            dispatch_id="disp-001",
            task_id="task-001",
            worker_id="worker-01",
            agent_session_id="sess-001",
            status="SUCCESS",
            commit_sha="abcdef1234567890",
            branch_name="runtime-kernel/m1-frame",
            completed_at=ts
        )
        is_valid, errors = ResultValidator.validate(res, expected_lease_expires_at=dt_str)
        self.assertTrue(is_valid, f"Expected boundary equality to pass, got errors: {errors}")

    def test_10_malformed_timestamp_handled(self):
        """Handles malformed lease timestamp safely without crashing."""
        res = ResultResponse(
            dispatch_id="disp-001",
            task_id="task-001",
            worker_id="worker-01",
            agent_session_id="sess-001",
            status="SUCCESS",
            commit_sha="abcdef1234567890",
            branch_name="runtime-kernel/m1-frame"
        )
        is_valid, errors = ResultValidator.validate(res, expected_lease_expires_at="not-a-timestamp")
        self.assertFalse(is_valid)
        self.assertTrue(any("malformed lease timestamp format" in e for e in errors))

    # --- 11, 12, 13: Stale Lock Recovery & Malformed Lock (P0-3) ---
    def test_11_stale_pid_lock_reclaimed(self):
        """Reclaims slot lock if owner PID is dead."""
        # Mock PID checker: PID 99999 is dead, current PID is alive
        def mock_pid_alive(pid: int) -> bool:
            return pid == os.getpid()

        gov = ResourceGovernor(
            lock_dir=self.test_dir / "gov_locks",
            is_pid_alive_fn=mock_pid_alive
        )
        # Create stale lock file with dead PID 99999
        stale_lock = gov.lock_dir / "build_0.lock"
        stale_lock.write_text("99999:123456.0", encoding="utf-8")

        # Now acquire should detect dead PID, reclaim slot, and succeed
        slot = gov.acquire_build_slot(timeout_seconds=0.0)
        self.assertIsNotNone(slot)
        self.assertEqual(slot, 0)
        gov.release_build_slot(slot)

    def test_12_live_pid_lock_not_reclaimed(self):
        """Does NOT reclaim slot lock if owner PID is alive."""
        def mock_pid_alive(pid: int) -> bool:
            return True  # All PIDs are alive

        gov = ResourceGovernor(
            lock_dir=self.test_dir / "gov_locks_live",
            is_pid_alive_fn=mock_pid_alive
        )
        # Create lock belonging to another alive process (PID 88888)
        lock_file = gov.lock_dir / "build_0.lock"
        lock_file.write_text("88888:123456.0", encoding="utf-8")

        # Acquire must fail because PID is alive
        slot = gov.acquire_build_slot(timeout_seconds=0.0)
        self.assertIsNone(slot)

    def test_13_malformed_lock_reclaimed(self):
        """Reclaims lock if lock content is corrupted or empty."""
        gov = ResourceGovernor(
            lock_dir=self.test_dir / "gov_locks_malformed",
            is_pid_alive_fn=lambda p: False
        )
        corrupted_lock = gov.lock_dir / "build_0.lock"
        corrupted_lock.write_text("garbage content", encoding="utf-8")

        slot = gov.acquire_build_slot(timeout_seconds=0.0)
        self.assertIsNotNone(slot)
        gov.release_build_slot(slot)

    # --- 14, 15: Atomic Lock Ownership Release (P1-2) ---
    def test_14_non_owner_release_rejected(self):
        """Non-owner cannot release a lock held by another process."""
        gov = ResourceGovernor(lock_dir=self.test_dir / "gov_locks_owner")
        slot = gov.acquire_build_slot(timeout_seconds=0.0)
        self.assertIsNotNone(slot)

        # Attempt release from non-owner PID (e.g. 999999)
        released = gov.release_build_slot(slot, caller_pid=999999)
        self.assertFalse(released, "Non-owner release must be rejected")

        # Slot must still be held
        self.assertIsNone(gov.acquire_build_slot(timeout_seconds=0.0))

        # Real owner can release
        self.assertTrue(gov.release_build_slot(slot, caller_pid=os.getpid()))

    def test_15_owner_release_succeeds(self):
        """Real owner can release lock cleanly."""
        gov = ResourceGovernor(lock_dir=self.test_dir / "gov_locks_owner2")
        slot = gov.acquire_build_slot(timeout_seconds=0.0)
        self.assertTrue(gov.release_build_slot(slot))

    # --- 16, 17, 18: Replay Protection Tests (P1-1) ---
    def test_16_duplicate_result_detected(self):
        """First result accepted; duplicate result marked processed."""
        self.assertFalse(self.transport.is_dispatch_processed("worker-01", "disp-100"))
        # First completion
        success = self.transport.mark_dispatch_processed("worker-01", "disp-100", "commit-sha-1")
        self.assertTrue(success)
        self.assertTrue(self.transport.is_dispatch_processed("worker-01", "disp-100"))

        # Second attempt to mark processed
        second_attempt = self.transport.mark_dispatch_processed("worker-01", "disp-100", "commit-sha-1")
        self.assertFalse(second_attempt, "Duplicate marking must be rejected")

    def test_17_conflicting_replay_rejected(self):
        """Conflicting result with same dispatch_id retains original commit SHA."""
        self.transport.mark_dispatch_processed("worker-01", "disp-200", "original-sha")
        # Attempted conflicting replay
        self.assertFalse(self.transport.mark_dispatch_processed("worker-01", "disp-200", "rogue-sha"))
        # Verify stored SHA is still original
        self.assertEqual(self.transport.get_processed_result_sha("worker-01", "disp-200"), "original-sha")

    def test_18_process_restart_replay_behavior(self):
        """Replay protection survives process restart (file-backed)."""
        self.transport.mark_dispatch_processed("worker-01", "disp-300", "persistent-sha")
        # Re-initialize transport as new instance simulating process restart
        new_transport = AtomicFileTransport(repo_root=self.test_dir)
        self.assertTrue(new_transport.is_dispatch_processed("worker-01", "disp-300"))
        self.assertEqual(new_transport.get_processed_result_sha("worker-01", "disp-300"), "persistent-sha")

    # --- 19: Disabled ArenaAdapter NO-OP ---
    def test_19_disabled_arena_adapter_noop(self):
        adapter = DisabledArenaAdapter()
        self.assertEqual(adapter.create_session("w1", "arena-agent-01-kernel")["status"], "DISABLED")
        self.assertEqual(adapter.poll("disp-1")["status"], "NOT_ENABLED")
        self.assertIsNone(adapter.collect_result("disp-1"))

    # --- 20: State Machine Illegal Transitions ---
    def test_20_state_machine_illegal_transitions(self):
        sm = DispatchStateMachine(dispatch_id="disp-001")
        # Cannot jump from IDLE to TERMINAL
        self.assertFalse(sm.transition_to(DispatchState.VALID))
        self.assertFalse(sm.transition_to(DispatchState.FAILED))

        # Advance to VALID
        self.assertTrue(sm.transition_to(DispatchState.DISPATCH_CREATED))
        self.assertTrue(sm.transition_to(DispatchState.DISPATCHED))
        self.assertTrue(sm.transition_to(DispatchState.RUNNING))
        self.assertTrue(sm.transition_to(DispatchState.RESULT_RECEIVED))
        self.assertTrue(sm.transition_to(DispatchState.VALIDATING))
        self.assertTrue(sm.transition_to(DispatchState.VALID))

        # Terminal cannot go back to DISPATCHED or VALIDATING
        self.assertFalse(sm.transition_to(DispatchState.DISPATCHED))
        self.assertFalse(sm.transition_to(DispatchState.VALIDATING))

if __name__ == "__main__":
    unittest.main()
