import unittest
import tempfile
import shutil
from pathlib import Path
from tools.orchestration.workspace_manager import WorkspaceManager, WorkspaceState, WorkspaceHealth

class TestWorkspaceManager(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp(prefix="ws_test_"))
        self.manager = WorkspaceManager(workspaces_base=self.tmp_dir)

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_workspace_lifecycle_and_evidence(self):
        worker_id = "test-agent-01"
        task_key = "runtime-kernel/m1-test"
        
        # 1. Create Workspace
        meta = self.manager.create_workspace(worker_id, task_key, "branch-1", "sha-1")
        self.assertEqual(meta["state"], WorkspaceState.READY)
        self.assertIn("hash", meta["fingerprint"])

        # 2. Record Evidence
        ev_file = self.manager.record_evidence(worker_id, task_key, "test", {"passed": 10, "failed": 0})
        self.assertTrue(ev_file.exists())

        # 3. Update State
        self.manager.update_workspace_state(worker_id, task_key, WorkspaceState.WORKING, WorkspaceHealth.HEALTHY)
        inspected = self.manager.inspect_workspace(worker_id, task_key)
        self.assertEqual(inspected["state"], WorkspaceState.WORKING)

        # 4. Destroy Workspace
        destroyed = self.manager.destroy_workspace(worker_id, task_key, force=True)
        self.assertTrue(destroyed)
        self.assertIsNone(self.manager.inspect_workspace(worker_id, task_key))

if __name__ == "__main__":
    unittest.main()
