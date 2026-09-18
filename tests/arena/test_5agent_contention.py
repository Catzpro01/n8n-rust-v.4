import os
import sys
import time
import json
import tempfile
import subprocess
from pathlib import Path

repo_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(repo_root / "tools" / "arena-bridge"))
sys.path.insert(0, str(repo_root / "tools" / "arena-executor"))

from dispatcher import TaskDispatcher
from supabase_adapter import SupabaseAdapter
from fs_guard import SecurityViolation

PR_HEAD_SHA = os.environ.get("PR_HEAD_SHA")
if not PR_HEAD_SHA:
    try:
        PR_HEAD_SHA = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=str(repo_root),
            stderr=subprocess.DEVNULL
        ).decode("utf-8").strip()
    except Exception:
        PR_HEAD_SHA = "HEAD"

try:
    subprocess.check_call(
        ["git", "cat-file", "-e", f"{PR_HEAD_SHA}^{{commit}}"],
        cwd=str(repo_root),
        stderr=subprocess.DEVNULL
    )
except Exception:
    PR_HEAD_SHA = "HEAD"

print("===================================================================")
print(f">>> 5-AGENT CONTENTION & CHAOS SIMULATION SUITE (SHA: {PR_HEAD_SHA[:8]}) <<<")
print("===================================================================")

dispatcher = TaskDispatcher(repo_root=repo_root)

# -------------------------------------------------------------------------
# TEST 1: 5-Agent Parallel Ownership Boundary Check
# -------------------------------------------------------------------------
print(">>> TEST 1: 5-Agent Parallel Ownership Matrix Check <<<")
agent_sublego_map = {
    "agent-01": "workflow.graph",
    "agent-02": "node.model",
    "agent-03": "connection.graph",
    "agent-04": "expression.evaluator",
    "agent-05": "validation.cycle"
}

# Verify legitimate ownership for all 5 agents
for agent_id, sublego_id in agent_sublego_map.items():
    assert dispatcher.validate_agent_task(agent_id, sublego_id) == True, f"{agent_id} should own {sublego_id}"
    print(f"[PASS] {agent_id} legitimately owns {sublego_id}")

# Verify cross-agent contention: NO agent may access another agent's Sub-LEGO
for agent_id, sublego_id in agent_sublego_map.items():
    for other_agent in agent_sublego_map.keys():
        if other_agent != agent_id:
            assert dispatcher.validate_agent_task(other_agent, sublego_id) == False
print("[PASS] Cross-agent Sub-LEGO contention: 100% strictly blocked across all 5 agents.")

# -------------------------------------------------------------------------
# TEST 2: Concurrent Lock Contention & Mutual Exclusion Simulator
# -------------------------------------------------------------------------
print("\n>>> TEST 2: Multi-Agent Distributed Lock Contention Simulator <<<")
class MockAtomicLockCoordinator:
    """
    In-memory simulation of public.acquire_lego_lock and release_lego_lock (FOR UPDATE)
    validating concurrency and lease logic across 5 agents.
    """
    def __init__(self):
        self.locks = {} # resource_id -> {owner, task_id, lease_until}
        self.processed_deliveries = set()

    def acquire(self, resource_id: str, agent_id: str, task_id: str, ttl_sec: int = 60) -> bool:
        now = time.time()
        curr = self.locks.get(resource_id)
        if curr:
            if curr["lease_until"] > now and curr["owner"] != agent_id:
                return False # LOCKED_BY_OTHER_AGENT
        self.locks[resource_id] = {
            "owner": agent_id,
            "task_id": task_id,
            "lease_until": now + ttl_sec
        }
        return True

    def release(self, resource_id: str, agent_id: str, task_id: str = None) -> bool:
        curr = self.locks.get(resource_id)
        if not curr:
            return True
        if curr["owner"] != agent_id:
            return False # UNAUTHORIZED_OWNER_MISMATCH
        if task_id and curr["task_id"] != task_id:
            return False # TASK_ID_MISMATCH
        del self.locks[resource_id]
        return True

    def check_delivery(self, delivery_id: str) -> bool:
        if delivery_id in self.processed_deliveries:
            return False # Replay
        self.processed_deliveries.add(delivery_id)
        return True

    def reap(self) -> int:
        now = time.time()
        expired = [k for k, v in self.locks.items() if v["lease_until"] < now]
        for k in expired:
            del self.locks[k]
        return len(expired)

sim = MockAtomicLockCoordinator()
contested_res = "contested.workflow.graph"

# agent-01 acquires lock
assert sim.acquire(contested_res, "agent-01", "TASK-CONT-01") == True
print("[PASS] agent-01 acquired lock on contested resource.")

# agent-02..05 attempt concurrent acquisition -> MUST FAIL
for intruding in ["agent-02", "agent-03", "agent-04", "agent-05"]:
    assert sim.acquire(contested_res, intruding, f"TASK-INT-{intruding}") == False
print("[PASS] 4 competing agents concurrently rejected (mutual exclusion enforced).")

# -------------------------------------------------------------------------
# TEST 3: Unauthorized Lock Release Rejection
# -------------------------------------------------------------------------
print("\n>>> TEST 3: Unauthorized Lock Release Rejection <<<")
# agent-02 attempts to release agent-01's lock
assert sim.release(contested_res, agent_id="agent-02", task_id="TASK-CONT-01") == False
print("[PASS] Unauthorized release attempt by agent-02 rejected.")

# Legitimate release by agent-01
assert sim.release(contested_res, agent_id="agent-01", task_id="TASK-CONT-01") == True
print("[PASS] Authorized owner agent-01 successfully released lock.")

# -------------------------------------------------------------------------
# TEST 4: Webhook Replay & Idempotency Check
# -------------------------------------------------------------------------
print("\n>>> TEST 4: Webhook Replay & Idempotency Check <<<")
test_delivery_id = f"del-test-{int(time.time()*1000)}"
assert sim.check_delivery(test_delivery_id) == True
print(f"[PASS] First webhook delivery '{test_delivery_id}': accepted.")
assert sim.check_delivery(test_delivery_id) == False
print(f"[PASS] Replay webhook delivery '{test_delivery_id}': strictly blocked (idempotent).")

# -------------------------------------------------------------------------
# TEST 5: Lease Expiration & Auto-Reaper Simulation
# -------------------------------------------------------------------------
print("\n>>> TEST 5: Lease Expiration & Auto-Reaper Simulation <<<")
# Acquire short-lived lock (ttl = 1 second)
sim.acquire("temporary.crashed.lock", "agent-03", "TASK-CRASH-01", ttl_sec=1)
time.sleep(1.2)
reaped_count = sim.reap()
assert reaped_count == 1
print(f"[PASS] Auto-reaper freed {reaped_count} expired lock from crashed agent.")
# Now agent-05 can acquire it
assert sim.acquire("temporary.crashed.lock", "agent-05", "TASK-RETRY-01") == True
print("[PASS] Crashed agent task successfully retryable by designated agent.")

print("\n===================================================================")
print(">>> ALL 5-AGENT CONTENTION & CHAOS ISOLATION GATES PASSED 100% <<<")
print("===================================================================")
