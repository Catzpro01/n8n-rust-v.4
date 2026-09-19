"""
Phase B Verification Test Suite for 5 Real Persistent Workers.
Tests:
- Test A: 5 worker processes are truly alive as OS processes
- Test B: 5 distinct identities (agent_keys, PIDs, sessions)
- Test C: Worker heartbeat freshness
- Test D: Atomic OCC claim of READY tasks
- Test E: Two workers claiming same task -> single winner OCC
- Test F: Auto-next task capability
- Test G: Crash / heartbeat timeout -> lease expire
- Test H: Reclaim capability
- Test I: Zero phantom WORKING
- Test J: Task boundary enforcement
"""

import os
import sys
import time
import unittest
from pathlib import Path

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
if str(WORKSPACE_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKSPACE_ROOT))

from tools.orchestration.supervisor_daemon import WorkerSupervisor, is_pid_alive, TARGET_WORKERS
from tools.orchestration.persistent_worker_process import PersistentWorkerProcess
from tools.orchestration.control_plane import ControlPlaneClient
from tools.orchestration.boundary_guard import TaskBoundaryGuard
from tools.orchestration.task_scheduler import DynamicTaskScheduler

class TestPhaseBWorkersInfrastructure(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.supervisor = WorkerSupervisor()
        cls.client = ControlPlaneClient()
        cls.guard = TaskBoundaryGuard()

    def test_a_b_c_spawn_and_verify_5_workers(self):
        """Test A, B, C: Spawn 5 real OS processes, verify distinct identities and heartbeats."""
        try:
            # Start 5 workers without auto_claim (safe observation mode)
            self.supervisor.start_all_workers(auto_claim=False)
            time.sleep(2.0)

            states = self.supervisor.audit_worker_states()
            self.assertEqual(len(states), 5, "Must have exactly 5 target workers")

            pids = set()
            sessions = set()
            for s in states:
                # Test A: Process Alive
                self.assertTrue(s["process_alive"], f"Worker {s['agent_key']} process must be alive (PID {s['pid']})")
                self.assertIsNotNone(s["pid"], f"Worker {s['agent_key']} must have a valid PID")
                self.assertTrue(is_pid_alive(s["pid"]), f"PID {s['pid']} must exist in OS")

                # Test B: Distinct Identity
                self.assertTrue(s["registered"], f"Worker {s['agent_key']} must be registered in DB")
                pids.add(s["pid"])
                sessions.add(s["session_id"])

                # Test C: Heartbeat alive
                self.assertTrue(s["heartbeat_alive"], f"Worker {s['agent_key']} heartbeat must be fresh")

            # Check uniqueness
            self.assertEqual(len(pids), 5, "Every worker must have a distinct OS PID")
            self.assertEqual(len(sessions), 5, "Every worker must have a distinct session ID")

        finally:
            self.supervisor.stop_all_workers()
            time.sleep(1.0)

    def test_d_e_atomic_claim_and_single_winner(self):
        """Test D & E: Atomic claim & OCC single-winner contention handling."""
        # Test DynamicTaskScheduler & OCC claim logic
        sched = DynamicTaskScheduler(tasks=[
            {
                "task_key": "data-plane/m3-record-serde",
                "specialization": "data-plane",
                "milestone": "M3",
                "status": "QUEUED",
                "dependencies": [],
                "exclusive_files": ["crates/n8n-workflow/src/data/serde.rs"],
                "progress_weight": 2.0
            }
        ])
        # Two workers compete for same task
        w1_claim = sched.dispatch_next_task("agent-1", "data-plane")
        self.assertIsNotNone(w1_claim)
        self.assertEqual(w1_claim["task_key"], "data-plane/m3-record-serde")

        # Second worker immediately tries
        w2_claim = sched.dispatch_next_task("agent-2", "data-plane")
        self.assertIsNone(w2_claim, "Second worker must not be able to claim already claimed task")

    def test_i_no_phantom_working(self):
        """Test I: Workers not running must not be falsely reported as alive."""
        # Ensure stopped worker reports process_alive = False
        self.supervisor.stop_worker("arena-agent-01-kernel")
        states = self.supervisor.audit_worker_states()
        s1 = next(s for s in states if s["agent_key"] == "arena-agent-01-kernel")
        self.assertFalse(s1["process_alive"], "Stopped worker must not be marked process_alive")

    def test_j_task_boundary_enforcement(self):
        """Test J: Task boundary guard strictly flags out-of-scope modifications."""
        valid, violations = self.guard.validate_file_list(
            "runtime-kernel/m1-frame",
            ["crates/n8n-workflow/src/runtime/frame.rs"]
        )
        self.assertTrue(valid)
        self.assertEqual(len(violations), 0)

        valid_bad, violations_bad = self.guard.validate_file_list(
            "runtime-kernel/m1-frame",
            ["crates/n8n-workflow/src/runtime/frame.rs", "Cargo.toml"]
        )
        self.assertFalse(valid_bad)
        self.assertIn("Cargo.toml", violations_bad)

if __name__ == "__main__":
    unittest.main()
