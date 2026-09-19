"""
Unit tests for DynamicTaskScheduler and TaskBoundaryGuard.
Validates DAG ready queue, parallel agent isolation, and hard boundary enforcement.
"""

import unittest
from tools.orchestration.task_scheduler import DynamicTaskScheduler
from tools.orchestration.boundary_guard import TaskBoundaryGuard

class TestSchedulerAndBoundaryGuard(unittest.TestCase):
    def setUp(self):
        self.scheduler = DynamicTaskScheduler()
        self.guard = TaskBoundaryGuard()

    def test_initial_ready_queue(self):
        """With m1-runner DONE, tasks depending only on m1-runner should be ready."""
        ready = self.scheduler.get_ready_tasks()
        ready_keys = {t["task_key"] for t in ready}
        
        # M1 tasks depending on m1-runner:
        self.assertIn("runtime-kernel/m1-frame", ready_keys)
        self.assertIn("runtime-kernel/m1-graph", ready_keys)
        self.assertIn("runtime-kernel/m1-cancellation", ready_keys)
        self.assertIn("runtime-kernel/m1-lifecycle", ready_keys)
        # M2 state-machine also depends on m1-runner:
        self.assertIn("execution-engine/m2-state-machine", ready_keys)
        
        # Tasks depending on m1-frame (which is QUEUED) must NOT be ready:
        self.assertNotIn("runtime-kernel/m1-memory-governor", ready_keys)
        self.assertNotIn("runtime-kernel/m1-error-propagation", ready_keys)

    def test_scheduler_exclusive_file_conflict(self):
        """Simulate two tasks requiring the same exclusive file."""
        # Inject two dummy tasks sharing exclusive file
        tasks = [
            {
                "task_key": "test/task-a",
                "specialization": "runtime-kernel",
                "milestone": "M1",
                "status": "QUEUED",
                "dependencies": [],
                "exclusive_files": ["crates/shared.rs"],
                "progress_weight": 1.0,
                "version": 1
            },
            {
                "task_key": "test/task-b",
                "specialization": "runtime-kernel",
                "milestone": "M1",
                "status": "QUEUED",
                "dependencies": [],
                "exclusive_files": ["crates/shared.rs"],
                "progress_weight": 1.0,
                "version": 1
            }
        ]
        sched = DynamicTaskScheduler(tasks=tasks)
        # Dispatch to agent-1
        t1 = sched.dispatch_next_task("agent-1", "runtime-kernel")
        self.assertIsNotNone(t1)
        self.assertEqual(t1["task_key"], "test/task-a")
        
        # Now task-a is CLAIMED with exclusive file 'crates/shared.rs'
        # Ready queue for agent-2 should NOT include task-b
        ready_for_agent_2 = sched.get_ready_tasks(specialization="runtime-kernel")
        self.assertEqual(len(ready_for_agent_2), 0)

    def test_multi_agent_parallel_dispatch_5_agents(self):
        """Simulate 5 agents claiming tasks simultaneously without conflict."""
        agents = [
            ("agent-rk-1", "runtime-kernel"),
            ("agent-rk-2", "runtime-kernel"),
            ("agent-ee-1", "execution-engine"),
            ("agent-dp-1", "data-plane"),
            ("agent-sec-1", "security")
        ]
        claimed = []
        for a_id, spec in agents:
            t = self.scheduler.dispatch_next_task(a_id, spec)
            if t:
                claimed.append((a_id, t["task_key"], t["exclusive_files"]))

        # Check that no two claimed tasks share any exclusive files
        all_exclusive = []
        for _, _, ex_list in claimed:
            for f in ex_list:
                self.assertNotIn(f, all_exclusive, f"File conflict detected across parallel workers: {f}")
                all_exclusive.append(f)

    def test_atomic_claim_and_versioning(self):
        """Validates optimistic concurrency control on task claims."""
        task_key = "runtime-kernel/m1-frame"
        t = self.scheduler.get_task(task_key)
        initial_version = t["version"]

        # 1. Attempt to claim with wrong version should fail
        success = self.scheduler.atomic_claim(task_key, "agent-1", initial_version - 1)
        self.assertFalse(success)
        self.assertEqual(self.scheduler.get_task(task_key)["status"], "QUEUED")

        # 2. Claim with correct version should succeed
        success = self.scheduler.atomic_claim(task_key, "agent-1", initial_version)
        self.assertTrue(success)
        t_after = self.scheduler.get_task(task_key)
        self.assertEqual(t_after["status"], "CLAIMED")
        self.assertEqual(t_after["version"], initial_version + 1)
        self.assertEqual(t_after["assigned_agent_id"], "agent-1")

        # 3. Second agent attempting to claim the already-claimed task should fail
        success = self.scheduler.atomic_claim(task_key, "agent-2", initial_version + 1)
        self.assertFalse(success)

    def test_lease_expiry_and_reclaim(self):
        """Validates that expired leases transition to RECLAIMABLE and can be reclaimed."""
        task_key = "runtime-kernel/m1-frame"
        
        # Dispatch with a 10-second lease
        t = self.scheduler.dispatch_next_task("agent-1", "runtime-kernel", lease_duration=10.0)
        self.assertIsNotNone(t)
        self.assertEqual(t["task_key"], task_key)
        self.assertEqual(t["status"], "CLAIMED")
        self.assertEqual(t["assigned_agent_id"], "agent-1")

        # Advance time by 5 seconds (lease still valid)
        self.scheduler.advance_time(5.0)
        t_current = self.scheduler.get_task(task_key)
        self.assertEqual(t_current["status"], "CLAIMED")

        # Advance time by another 6 seconds (11 seconds total) -> Lease EXPIRED
        self.scheduler.advance_time(6.0)
        t_expired = self.scheduler.get_task(task_key)
        self.assertEqual(t_expired["status"], "RECLAIMABLE")
        self.assertIsNone(t_expired["assigned_agent_id"])

        # Agent 2 should now be able to reclaim this task
        # RECLAIMABLE tasks are prioritized in get_ready_tasks
        ready = self.scheduler.get_ready_tasks(specialization="runtime-kernel")
        self.assertTrue(any(x["task_key"] == task_key for x in ready))

        t2 = self.scheduler.dispatch_next_task("agent-2", "runtime-kernel", lease_duration=3600.0)
        self.assertIsNotNone(t2)
        self.assertEqual(t2["task_key"], task_key)
        self.assertEqual(t2["status"], "CLAIMED")
        self.assertEqual(t2["assigned_agent_id"], "agent-2")

    def test_boundary_guard_valid_files(self):
        """Task boundary guard allows modifications inside allowed_files."""
        task_key = "runtime-kernel/m1-frame"
        # Allowed files for m1-frame is ["crates/n8n-workflow/src/runtime/frame.rs"]
        modified = ["crates/n8n-workflow/src/runtime/frame.rs"]
        is_valid, violations = self.guard.validate_file_list(task_key, modified)
        self.assertTrue(is_valid)
        self.assertEqual(len(violations), 0)

    def test_boundary_guard_violating_files(self):
        """Task boundary guard rejects modifications outside allowed_files."""
        task_key = "runtime-kernel/m1-frame"
        # Attempt to modify cargo.toml or another crate file
        modified = [
            "crates/n8n-workflow/src/runtime/frame.rs",
            "Cargo.toml",
            "crates/n8n-expression/src/lib.rs"
        ]
        is_valid, violations = self.guard.validate_file_list(task_key, modified)
        self.assertFalse(is_valid)
        self.assertEqual(len(violations), 2)
        self.assertIn("Cargo.toml", violations)
        self.assertIn("crates/n8n-expression/src/lib.rs", violations)

if __name__ == "__main__":
    unittest.main()
