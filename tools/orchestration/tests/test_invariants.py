import threading
import time
import unittest
from typing import Dict, Any

class MockAtomicControlPlane:
    """
    In-memory authoritative simulation of the Supabase Atomic State Transition Stored Procedures
    enforcing OCC versions, row locking, commit SHA matching, idempotency, and FSM transition constraints.
    """
    VALID_TRANSITIONS = {
        "BACKLOG": {"QUEUED", "CANCELLED"},
        "QUEUED": {"CLAIMED", "CANCELLED"},
        "CLAIMED": {"WORKING", "QUEUED", "BLOCKED", "CANCELLED"},
        "WORKING": {"PR_OPEN", "BLOCKED", "CANCELLED"},
        "PR_OPEN": {"BUILDING", "WORKING", "CANCELLED"},
        "BUILDING": {"TESTING", "BUILD_FAILED"},
        "BUILD_FAILED": {"WORKING", "CANCELLED"},
        "TESTING": {"AUDITING", "TEST_FAILED"},
        "TEST_FAILED": {"WORKING", "CANCELLED"},
        "AUDITING": {"READY_TO_MERGE", "AUDIT_FAILED"},
        "AUDIT_FAILED": {"WORKING", "CANCELLED"},
        "READY_TO_MERGE": {"MERGING", "WORKING"},
        "MERGING": {"MERGED", "BLOCKED", "POST_MERGE_VERIFY"},
        "MERGED": {"POST_MERGE_VERIFY", "BLOCKED"},
        "POST_MERGE_VERIFY": {"CLEANUP", "BLOCKED"},
        "CLEANUP": {"COMPLETED", "BLOCKED"},
        "BLOCKED": {"QUEUED", "WORKING", "CANCELLED"},
        "COMPLETED": set(),
        "CANCELLED": set()
    }

    def __init__(self):
        self._lock = threading.Lock()
        self.tasks: Dict[str, Dict[str, Any]] = {}
        self.agents: Dict[str, Dict[str, Any]] = {}
        self.locks: Dict[str, Dict[str, Any]] = {}
        self.build_jobs: Dict[str, Dict[str, Any]] = {}
        self.test_results: Dict[str, Dict[str, Any]] = {}
        self.audit_results: Dict[str, Dict[str, Any]] = {}
        self.events: Dict[str, Dict[str, Any]] = {}
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

    # RPC 4: record_build_result
    def record_build_result(self, task_id: str, commit_sha: str, status: str) -> dict:
        with self._lock:
            task = self.tasks.get(task_id)
            if not task:
                return {"success": False, "error": "TASK_NOT_FOUND"}

            # Telemetry is always recorded historically
            self.build_jobs[f"{task_id}:{commit_sha}"] = status

            # Stale check: cannot advance state if reported commit is not the task's current commit
            if task["current_commit_sha"] != commit_sha:
                return {"success": False, "error": "STALE_COMMIT", "recorded_historically": True}

            task["version"] += 1
            task["status"] = "TESTING" if status == "PASSED" else "BUILD_FAILED"
            return {"success": True, "status": task["status"], "version": task["version"]}

    def record_test_pass(self, task_id: str, commit_sha: str):
        with self._lock:
            task = self.tasks[task_id]
            self.test_results[f"{task_id}:{commit_sha}"] = "PASSED"
            if task["current_commit_sha"] != commit_sha:
                return {"success": False, "error": "STALE_COMMIT"}
            task["status"] = "AUDITING"
            task["version"] += 1
            return {"success": True}

    def record_audit_pass(self, task_id: str, commit_sha: str):
        with self._lock:
            task = self.tasks[task_id]
            self.audit_results[f"{task_id}:{commit_sha}"] = "PASS"
            if task["current_commit_sha"] != commit_sha:
                return {"success": False, "error": "STALE_COMMIT"}
            task["status"] = "READY_TO_MERGE"
            task["version"] += 1
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

    # FSM Transition Check (Section 11)
    def transition_task(self, task_id: str, target_status: str, expected_version: int) -> dict:
        with self._lock:
            task = self.tasks.get(task_id)
            if not task:
                return {"success": False, "error": "TASK_NOT_FOUND"}
            curr_status = task["status"]
            allowed = self.VALID_TRANSITIONS.get(curr_status, set())
            if target_status not in allowed:
                return {
                    "success": False,
                    "error": "INVALID_STATE_TRANSITION",
                    "from_status": curr_status,
                    "to_status": target_status
                }
            if task["version"] != expected_version:
                return {"success": False, "error": "VERSION_CONFLICT"}

            task["version"] += 1
            task["status"] = target_status
            return {"success": True, "status": target_status, "version": task["version"]}

    # Idempotent Event Bus (Section 21)
    def process_event(self, event_id: str, event_type: str, payload: dict) -> dict:
        with self._lock:
            if event_id in self.events:
                return {
                    "success": True,
                    "action": "DUPLICATE_EVENT_IGNORED",
                    "is_duplicate": True,
                    "event_id": event_id
                }
            self.events[event_id] = {
                "event_id": event_id,
                "event_type": event_type,
                "payload": payload,
                "timestamp": time.time()
            }
            return {
                "success": True,
                "action": "EVENT_RECORDED",
                "is_duplicate": False,
                "event_id": event_id
            }


class TestAtomicStateTransitionInvariants(unittest.TestCase):
    def setUp(self):
        self.db = MockAtomicControlPlane()
        self.db.seed_task("M1-RUNTIME-002", "runtime-kernel", "WorkflowRunner")
        self.db.seed_agent("Arena-A", "runtime-kernel")
        self.db.seed_agent("Arena-B", "runtime-kernel")

    def test_a_concurrent_claim(self):
        """
        Test A — Concurrent claim (Section 42):
        Agent A and Agent B claim Task X simultaneously.
        Expected: Exactly one SUCCESS, one VERSION_CONFLICT / CLAIM_CONFLICT.
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

    def test_b_concurrent_file_lock(self):
        """
        Test B — Concurrent file lock (Section 42):
        Task A and Task B request exclusive lock on the same file.
        Expected: One LOCK_ACQUIRED, one LOCK_DENIED.
        """
        r1 = self.db.acquire_file_lock("file:crates/n8n-workflow/src/runtime/runner.rs", "M1-A", "Agent-A")
        self.assertTrue(r1["acquired"])
        self.assertEqual(r1["action"], "ACQUIRED")

        r2 = self.db.acquire_file_lock("file:crates/n8n-workflow/src/runtime/runner.rs", "M1-B", "Agent-B")
        self.assertFalse(r2["acquired"])
        self.assertEqual(r2["error"], "LOCK_DENIED")
        self.assertEqual(r2["owner_task_id"], "M1-A")

    def test_c_stale_validation(self):
        """
        Test C — Stale validation (Section 42):
        Commit A: BUILD PASS, TEST PASS, AUDIT PASS.
        Commit B pushed.
        Expected: Commit A results become STALE. Merge denied until Commit B passes fresh validation.
        """
        self.db.claim_task("M1-RUNTIME-002", "Arena-A", expected_version=0)
        self.db.submit_commit("M1-RUNTIME-002", "Arena-A", "commit_aaa", expected_version=1)
        self.db.record_build_result("M1-RUNTIME-002", "commit_aaa", "PASSED")
        self.db.record_test_pass("M1-RUNTIME-002", "commit_aaa")
        self.db.record_audit_pass("M1-RUNTIME-002", "commit_aaa")

        # Arena pushes Commit B
        self.db.submit_commit("M1-RUNTIME-002", "Arena-A", "commit_bbb", expected_version=5)

        # Attempt to authorize merge using Commit A -> MUST FAIL with STALE_COMMIT
        r_old = self.db.authorize_merge("M1-RUNTIME-002", "commit_aaa", expected_version=6)
        self.assertFalse(r_old["success"])
        self.assertEqual(r_old["error"], "STALE_COMMIT")

        # Attempt to authorize merge using Commit B before it is validated -> MUST FAIL with INCOMPLETE_VALIDATION
        r_new_untested = self.db.authorize_merge("M1-RUNTIME-002", "commit_bbb", expected_version=6)
        self.assertFalse(r_new_untested["success"])
        self.assertEqual(r_new_untested["error"], "INCOMPLETE_VALIDATION")

    def test_d_double_cleanup(self):
        """
        Test D — Double cleanup (Section 42):
        Worker A and Worker B cleanup Task X simultaneously.
        Expected: Exactly one cleanup owner; second gets conflict/idempotent response.
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

    def test_e_illegal_transition(self):
        """
        Test E — Illegal transition (Section 42):
        Attempt: COMPLETED -> WORKING.
        Expected: INVALID_STATE_TRANSITION. Terminal state is immutable.
        """
        self.db.tasks["M1-RUNTIME-002"]["status"] = "COMPLETED"
        self.db.tasks["M1-RUNTIME-002"]["version"] = 15

        res = self.db.transition_task("M1-RUNTIME-002", "WORKING", expected_version=15)
        self.assertFalse(res["success"])
        self.assertEqual(res["error"], "INVALID_STATE_TRANSITION")
        self.assertEqual(self.db.tasks["M1-RUNTIME-002"]["status"], "COMPLETED", "Terminal state MUST NOT regress")

    def test_f_duplicate_event(self):
        """
        Test F — Duplicate event (Section 42):
        Send identical event twice (e.g. GitHub webhook delivery ID).
        Expected: Exactly one state change / unique historical event; second is safe idempotent no-op.
        """
        event_id = "gh-delivery-uuid-9999"
        payload = {"action": "push", "ref": "refs/heads/runtime-kernel/m1-runner"}

        # First delivery
        r1 = self.db.process_event(event_id, "push", payload)
        self.assertTrue(r1["success"])
        self.assertFalse(r1["is_duplicate"])
        self.assertEqual(r1["action"], "EVENT_RECORDED")

        # Duplicate delivery
        r2 = self.db.process_event(event_id, "push", payload)
        self.assertTrue(r2["success"])
        self.assertTrue(r2["is_duplicate"])
        self.assertEqual(r2["action"], "DUPLICATE_EVENT_IGNORED")
        self.assertEqual(len(self.db.events), 1, "Only one event record MUST exist for the delivery ID")

    def test_g_stale_build_result(self):
        """
        Test G — Stale build result (Section 42):
        Commit A build running.
        Commit B pushed (task.current_commit_sha = B).
        Build A finishes PASS.
        Expected: Build A recorded historically, but CANNOT advance current task state.
        """
        self.db.claim_task("M1-RUNTIME-002", "Arena-A", expected_version=0)
        # Commit A pushed and building
        self.db.submit_commit("M1-RUNTIME-002", "Arena-A", "commit_aaa", expected_version=1)
        self.db.tasks["M1-RUNTIME-002"]["status"] = "BUILDING"
        self.db.tasks["M1-RUNTIME-002"]["version"] = 2

        # Before Build A reports, Commit B is pushed
        self.db.submit_commit("M1-RUNTIME-002", "Arena-A", "commit_bbb", expected_version=2)
        self.assertEqual(self.db.tasks["M1-RUNTIME-002"]["current_commit_sha"], "commit_bbb")
        self.assertEqual(self.db.tasks["M1-RUNTIME-002"]["status"], "PR_OPEN")

        # Now Build A arrives reporting PASSED for commit_aaa
        res = self.db.record_build_result("M1-RUNTIME-002", "commit_aaa", "PASSED")

        # Expected: Stored historically in build_jobs, but rejected from advancing task state
        self.assertFalse(res["success"])
        self.assertEqual(res["error"], "STALE_COMMIT")
        self.assertTrue(res.get("recorded_historically"))
        self.assertIn("M1-RUNTIME-002:commit_aaa", self.db.build_jobs)
        self.assertEqual(self.db.tasks["M1-RUNTIME-002"]["status"], "PR_OPEN", "Task status MUST NOT advance to TESTING")
        self.assertEqual(self.db.tasks["M1-RUNTIME-002"]["current_commit_sha"], "commit_bbb")


if __name__ == "__main__":
    unittest.main()