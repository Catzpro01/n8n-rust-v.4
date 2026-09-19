import threading
import time
import unittest
from typing import Dict, Any

class MockAtomicControlPlane:
    """
    In-memory simulation of the Supabase Atomic State Transition Stored Procedures
    enforcing OCC versions, row locking, commit SHA matching, and idempotent transitions.
    """
    def __init__(self):
        self._lock = threading.Lock()
        self.tasks: Dict[str, Dict[str, Any]] = {}
        self.agents: Dict[str, Dict[str, Any]] = {}
        self.locks: Dict[str, Dict[str, Any]] = {}
        self.build_jobs: Dict[str, Dict[str, Any]] = {}
        self.test_results: Dict[str, Dict[str, Any]] = {}
        self.audit_results: Dict[str, Dict[str, Any]] = {}
        self.transitions: list = []

    def seed_task(self, task_id: str, specialization: str, title: str):
        with self._lock:
            self.tasks[task_id] = {
                "id": task_id,
                "title": title,
                "specialization": specialization,
                "status": "QUEUED",
                "assigned_agent_id": None,
                "current_commit_sha": None,
                "merge_commit_sha": None,
                "version": 0
            }

    def seed_agent(self, agent_id: str, specialization: str):
        with self._lock:
            self.agents[agent_id] = {
                "id": agent_id,
                "specialization": specialization,
                "status": "AVAILABLE",
                "current_task_id": None,
                "version": 0
            }

    # RPC 1: claim_task
    def claim_task(self, task_id: str, agent_id: str, expected_version: int) -> dict:
        with self._lock:
            task = self.tasks.get(task_id)
            if not task:
                return {"success": False, "error": "TASK_NOT_FOUND"}
            if task["status"] == "CLAIMED" and task["assigned_agent_id"] == agent_id:
                return {"success": True, "action": "IDEMPOTENT_RETURN", "version": task["version"]}
            if task["status"] != "QUEUED":
                return {"success": False, "error": "INVALID_STATE", "current_status": task["status"]}
            if task["version"] != expected_version:
                return {"success": False, "error": "VERSION_CONFLICT", "current_version": task["version"]}

            agent = self.agents.get(agent_id)
            if not agent or agent["status"] != "AVAILABLE":
                return {"success": False, "error": "AGENT_NOT_AVAILABLE"}
            if task["specialization"] != agent["specialization"]:
                return {"success": False, "error": "SPECIALIZATION_MISMATCH"}

            # Atomic transition
            task["version"] += 1
            task["status"] = "CLAIMED"
            task["assigned_agent_id"] = agent_id

            agent["status"] = "WORKING"
            agent["current_task_id"] = task_id
            agent["version"] += 1

            self.transitions.append({
                "task_id": task_id, "from": "QUEUED", "to": "CLAIMED", "actor": agent_id,
                "version": task["version"]
            })
            return {"success": True, "status": "CLAIMED", "version": task["version"]}

    # RPC 11: acquire_file_lock
    def acquire_file_lock(self, resource: str, task_id: str, agent_id: str, ttl_sec: int = 3600) -> dict:
        with self._lock:
            now = time.time()
            curr = self.locks.get(resource)
            if curr:
                if curr["expires_at"] > now and curr["task_id"] != task_id:
                    return {
                        "acquired": False,
                        "error": "LOCK_DENIED",
                        "owner_task_id": curr["task_id"]
                    }
                # Renew
                curr["task_id"] = task_id
                curr["agent_id"] = agent_id
                curr["expires_at"] = now + ttl_sec
                return {"acquired": True, "action": "RENEWED"}
            else:
                self.locks[resource] = {
                    "resource": resource,
                    "task_id": task_id,
                    "agent_id": agent_id,
                    "expires_at": now + ttl_sec
                }
                return {"acquired": True, "action": "ACQUIRED"}

    # RPC 3: submit_commit
    def submit_commit(self, task_id: str, agent_id: str, commit_sha: str, expected_version: int) -> dict:
        with self._lock:
            task = self.tasks.get(task_id)
            if not task:
                return {"success": False, "error": "TASK_NOT_FOUND"}
            if task["assigned_agent_id"] != agent_id:
                return {"success": False, "error": "NOT_TASK_OWNER"}
            if task["version"] != expected_version:
                return {"success": False, "error": "VERSION_CONFLICT"}

            task["version"] += 1
            task["current_commit_sha"] = commit_sha
            task["status"] = "PR_OPEN"
            return {"success": True, "status": "PR_OPEN", "version": task["version"]}

    # RPC 4, 5, 6: validations
    def record_build_pass(self, task_id: str, commit_sha: str):
        with self._lock:
            task = self.tasks[task_id]
            if task["current_commit_sha"] != commit_sha:
                return {"success": False, "error": "STALE_COMMIT"}
            self.build_jobs[f"{task_id}:{commit_sha}"] = "PASSED"
            return {"success": True}

    def record_test_pass(self, task_id: str, commit_sha: str):
        with self._lock:
            task = self.tasks[task_id]
            if task["current_commit_sha"] != commit_sha:
                return {"success": False, "error": "STALE_COMMIT"}
            self.test_results[f"{task_id}:{commit_sha}"] = "PASSED"
            return {"success": True}

    def record_audit_pass(self, task_id: str, commit_sha: str):
        with self._lock:
            task = self.tasks[task_id]
            if task["current_commit_sha"] != commit_sha:
                return {"success": False, "error": "STALE_COMMIT"}
            self.audit_results[f"{task_id}:{commit_sha}"] = "PASS"
            task["status"] = "READY_TO_MERGE"
            return {"success": True}

    def authorize_merge(self, task_id: str, commit_sha: str, expected_version: int) -> dict:
        with self._lock:
            task = self.tasks.get(task_id)
            if not task:
                return {"success": False, "error": "TASK_NOT_FOUND"}
            if task["current_commit_sha"] != commit_sha:
                return {"success": False, "error": "STALE_COMMIT"}
            if task["version"] != expected_version:
                return {"success": False, "error": "VERSION_CONFLICT"}

            b_pass = self.build_jobs.get(f"{task_id}:{commit_sha}") == "PASSED"
            t_pass = self.test_results.get(f"{task_id}:{commit_sha}") == "PASSED"
            a_pass = self.audit_results.get(f"{task_id}:{commit_sha}") == "PASS"

            if not (b_pass and t_pass and a_pass):
                return {"success": False, "error": "INCOMPLETE_VALIDATION"}

            task["version"] += 1
            task["status"] = "MERGING"
            return {"success": True, "status": "MERGING", "version": task["version"]}

    # RPC 9 & 10: cleanup
    def start_cleanup(self, task_id: str, expected_version: int) -> dict:
        with self._lock:
            task = self.tasks.get(task_id)
            if not task:
                return {"success": False, "error": "TASK_NOT_FOUND"}
            if task["status"] == "CLEANUP":
                return {"success": False, "error": "ALREADY_IN_CLEANUP"}
            if task["status"] == "COMPLETED":
                return {"success": True, "action": "ALREADY_COMPLETED", "status": "COMPLETED"}
            if task["status"] != "POST_MERGE_VERIFY":
                return {"success": False, "error": "INVALID_STATE"}
            if task["version"] != expected_version:
                return {"success": False, "error": "VERSION_CONFLICT"}

            task["version"] += 1
            task["status"] = "CLEANUP"
            return {"success": True, "status": "CLEANUP", "version": task["version"]}

    def complete_cleanup(self, task_id: str, expected_version: int) -> dict:
        with self._lock:
            task = self.tasks.get(task_id)
            if not task:
                return {"success": False, "error": "TASK_NOT_FOUND"}
            if task["status"] == "COMPLETED":
                return {"success": True, "action": "ALREADY_COMPLETED", "status": "COMPLETED"}
            if task["status"] != "CLEANUP":
                return {"success": False, "error": "INVALID_STATE"}
            if task["version"] != expected_version:
                return {"success": False, "error": "VERSION_CONFLICT"}

            task["version"] += 1
            task["status"] = "COMPLETED"
            return {"success": True, "status": "COMPLETED", "version": task["version"]}


class TestAtomicStateTransitionInvariants(unittest.TestCase):
    def setUp(self):
        self.db = MockAtomicControlPlane()
        self.db.seed_task("M1-RUNTIME-002", "runtime-kernel", "WorkflowRunner")
        self.db.seed_agent("Arena-A", "runtime-kernel")
        self.db.seed_agent("Arena-B", "runtime-kernel")

    def test_invariant_1_minimum_concurrency_claim(self):
        """
        Section 37: Two agents (Arena-A & Arena-B) attempt to claim M1-RUNTIME-002 simultaneously.
        Result: Exactly one succeeds (CLAIMED), other gets VERSION_CONFLICT or INVALID_STATE.
        NEVER both CLAIMED.
        """
        results = []

        def try_claim(agent_id: str):
            res = self.db.claim_task("M1-RUNTIME-002", agent_id, expected_version=0)
            results.append((agent_id, res))

        t1 = threading.Thread(target=try_claim, args=("Arena-A",))
        t2 = threading.Thread(target=try_claim, args=("Arena-B",))

        t1.start()
        t2.start()
        t1.join()
        t2.join()

        successes = [r for r in results if r[1].get("success") is True and r[1].get("status") == "CLAIMED"]
        failures = [r for r in results if r[1].get("success") is False]

        self.assertEqual(len(successes), 1, "Exactly one agent MUST succeed claiming the task")
        self.assertEqual(len(failures), 1, "The competing agent MUST fail with version conflict or invalid state")
        self.assertIn(failures[0][1].get("error"), ("VERSION_CONFLICT", "INVALID_STATE"))

    def test_invariant_2_minimum_file_lock(self):
        """
        Section 38: Two tasks request exclusive lock on runner.rs.
        Result: M1-A acquires lock, M1-B denied.
        """
        r1 = self.db.acquire_file_lock("file:crates/n8n-workflow/src/runtime/runner.rs", "M1-A", "Agent-A")
        self.assertTrue(r1["acquired"])
        self.assertEqual(r1["action"], "ACQUIRED")

        r2 = self.db.acquire_file_lock("file:crates/n8n-workflow/src/runtime/runner.rs", "M1-B", "Agent-B")
        self.assertFalse(r2["acquired"])
        self.assertEqual(r2["error"], "LOCK_DENIED")
        self.assertEqual(r2["owner_task_id"], "M1-A")

    def test_invariant_3_minimum_stale_validation(self):
        """
        Section 39: Commit A has PASS on build, test, audit.
        Arena pushes commit B.
        Validation for commit A must NOT authorize merge for commit B.
        """
        self.db.claim_task("M1-RUNTIME-002", "Arena-A", expected_version=0)
        # Commit A submitted
        self.db.submit_commit("M1-RUNTIME-002", "Arena-A", "commit_aaa", expected_version=1)
        # All validations pass for commit A
        self.db.record_build_pass("M1-RUNTIME-002", "commit_aaa")
        self.db.record_test_pass("M1-RUNTIME-002", "commit_aaa")
        self.db.record_audit_pass("M1-RUNTIME-002", "commit_aaa")

        # Now Arena pushes Commit B
        self.db.submit_commit("M1-RUNTIME-002", "Arena-A", "commit_bbb", expected_version=2)

        # Attempt to authorize merge using Commit A -> MUST FAIL with STALE_COMMIT
        r_old = self.db.authorize_merge("M1-RUNTIME-002", "commit_aaa", expected_version=3)
        self.assertFalse(r_old["success"])
        self.assertEqual(r_old["error"], "STALE_COMMIT")

        # Attempt to authorize merge using Commit B before it is validated -> MUST FAIL with INCOMPLETE_VALIDATION
        r_new_untested = self.db.authorize_merge("M1-RUNTIME-002", "commit_bbb", expected_version=3)
        self.assertFalse(r_new_untested["success"])
        self.assertEqual(r_new_untested["error"], "INCOMPLETE_VALIDATION")

    def test_invariant_4_minimum_cleanup_idempotency(self):
        """
        Section 40: Two cleanup workers run simultaneously on POST_MERGE_VERIFY task.
        Result: Only one acquires CLEANUP ownership.
        Final state: COMPLETED and idempotent.
        """
        self.db.tasks["M1-RUNTIME-002"]["status"] = "POST_MERGE_VERIFY"
        self.db.tasks["M1-RUNTIME-002"]["version"] = 10

        c_results = []
        def try_cleanup(worker_id: str):
            res = self.db.start_cleanup("M1-RUNTIME-002", expected_version=10)
            c_results.append((worker_id, res))

        t1 = threading.Thread(target=try_cleanup, args=("Worker-1",))
        t2 = threading.Thread(target=try_cleanup, args=("Worker-2",))
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        start_successes = [r for r in c_results if r[1].get("success") is True and r[1].get("status") == "CLEANUP"]
        self.assertEqual(len(start_successes), 1, "Only one worker can enter CLEANUP state")

        # Complete cleanup
        comp = self.db.complete_cleanup("M1-RUNTIME-002", expected_version=11)
        self.assertTrue(comp["success"])
        self.assertEqual(comp["status"], "COMPLETED")

        # Second cleanup attempt returns ALREADY_COMPLETED idempotently
        comp2 = self.db.complete_cleanup("M1-RUNTIME-002", expected_version=12)
        self.assertTrue(comp2["success"])
        self.assertEqual(comp2["action"], "ALREADY_COMPLETED")

if __name__ == "__main__":
    unittest.main()