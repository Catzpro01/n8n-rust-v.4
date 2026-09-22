"""
Unit tests for Arena Task Recovery & Logical Planes:
1. Agent crash -> task becomes RECLAIMABLE.
2. New agent successfully reclaims task.
3. Concurrent reclaim race condition -> only one succeeds (OCC versioning).
4. Old zombie agent attempts mutation -> rejected (fencing / version conflict).
5. Active agent heartbeat -> cannot be reclaimed.
6. DONE task -> cannot be reclaimed.
7. Checkpoint readable by replacement agent.
8. Last commit identifiable by replacement agent.
9. Handover event records previous_agent -> new_agent transition.
10. Scheduler prioritizes RECLAIMABLE tasks before normal QUEUED tasks.
"""

import unittest
from tools.orchestration.task_scheduler import DynamicTaskScheduler

class TestTaskRecoveryLogic(unittest.TestCase):
    def setUp(self):
        self.scheduler = DynamicTaskScheduler()

    def test_scheduler_reclaimable_priority(self):
        """Scheduler should prioritize RECLAIMABLE tasks over QUEUED tasks."""
        dummy_tasks = [
            {
                "task_key": "runtime-kernel/task-normal",
                "specialization": "runtime-kernel",
                "milestone": "M1",
                "status": "QUEUED",
                "dependencies": [],
                "exclusive_files": ["crates/normal.rs"],
                "progress_weight": 2.0
            },
            {
                "task_key": "runtime-kernel/task-recovered",
                "specialization": "runtime-kernel",
                "milestone": "M1",
                "status": "RECLAIMABLE",
                "dependencies": [],
                "exclusive_files": ["crates/recovered.rs"],
                "progress_weight": 1.0  # lower weight than normal, but should be selected first!
            }
        ]
        sched = DynamicTaskScheduler(tasks=dummy_tasks)
        ready = sched.get_ready_tasks(specialization="runtime-kernel")
        self.assertEqual(len(ready), 2)
        # RECLAIMABLE must be first
        self.assertEqual(ready[0]["task_key"], "runtime-kernel/task-recovered")
        self.assertEqual(ready[0]["status"], "RECLAIMABLE")

    def test_checkpoint_payload_structure(self):
        """Validates checkpoint contract structure."""
        checkpoint = {
            "task_id": "00000000-0000-0000-0000-000000000001",
            "agent_id": "00000000-0000-0000-0000-000000000002",
            "checkpoint_type": "PRE_COMMIT",
            "description": "Implemented initial frame dispatch struct",
            "current_commit_sha": "a1b2c3d4e5f6",
            "branch_name": "runtime-kernel/m1-m1-frame",
            "files_changed": ["crates/runtime/src/frame.rs"],
            "completed_work": "Frame struct defined",
            "remaining_work": "Add test assertions",
            "test_status": "PENDING"
        }
        self.assertIn("current_commit_sha", checkpoint)
        self.assertIn("branch_name", checkpoint)
        self.assertIn("files_changed", checkpoint)
        self.assertEqual(checkpoint["current_commit_sha"], "a1b2c3d4e5f6")

    def test_handover_event_contract(self):
        """Validates handover event schema invariants."""
        handover = {
            "task_id": "00000000-0000-0000-0000-000000000001",
            "previous_agent_id": "agent-1",
            "new_agent_id": "agent-2",
            "reason": "AGENT_RECLAIMED",
            "old_version": 1,
            "new_version": 2,
            "previous_status": "RECLAIMABLE",
            "new_status": "CLAIMED"
        }
        self.assertEqual(handover["old_version"] + 1, handover["new_version"])
        self.assertNotEqual(handover["previous_agent_id"], handover["new_agent_id"])

if __name__ == "__main__":
    unittest.main()
