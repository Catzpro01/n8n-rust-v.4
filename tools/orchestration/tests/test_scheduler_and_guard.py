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
                "progress_weight": 1.0
            },
            {
                "task_key": "test/task-b",
                "specialization": "runtime-kernel",
                "milestone": "M1",
                "status": "QUEUED",
                "dependencies": [],
                "exclusive_files": ["crates/shared.rs"],
                "progress_weight": 1.0
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
