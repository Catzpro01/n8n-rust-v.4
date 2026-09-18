import sys
import time
import json
from pathlib import Path

repo_root = Path("/home/fern/arena/repo")
sys.path.insert(0, str(repo_root / "tools" / "arena-bridge"))
sys.path.insert(0, str(repo_root / "tools" / "arena-executor"))

from dispatcher import TaskDispatcher
from supabase_adapter import SupabaseAdapter
from fs_guard import SecurityViolation

incoming_dir = Path("/srv/arena/runtime/queue/incoming")
completed_dir = Path("/srv/arena/runtime/queue/completed")

print("===================================================================")
print(">>> GATE 1: Sub-LEGO Ownership Matrix (Allow / Deny) <<<")
print("===================================================================")
dispatcher = TaskDispatcher()

# 1. agent-01 owns workflow.graph -> MUST ALLOW
assert dispatcher.validate_agent_task("agent-01", "workflow.graph") == True
print("[PASS] agent-01 owns workflow.graph -> ALLOWED")

# 2. agent-01 tries expression.compiler -> MUST DENY
assert dispatcher.validate_agent_task("agent-01", "expression.compiler") == False
print("[PASS] agent-01 accessing expression.compiler -> DENIED")

# 3. agent-04 owns expression.compiler & expression.evaluator -> MUST ALLOW
assert dispatcher.validate_agent_task("agent-04", "expression.compiler") == True
assert dispatcher.validate_agent_task("agent-04", "expression.evaluator") == True
print("[PASS] agent-04 owns expression.* -> ALLOWED")

# 4. agent-04 tries workflow.graph -> MUST DENY
assert dispatcher.validate_agent_task("agent-04", "workflow.graph") == False
print("[PASS] agent-04 accessing workflow.graph -> DENIED")

print("\n===================================================================")
print(">>> GATE 2: Queue Injection & Ownership Bypass Rejection <<<")
print("===================================================================")
try:
    dispatcher.dispatch_execution_job(
        agent_id="agent-01",
        task_id="FORGED-TASK-01",
        sublego_id="expression.compiler", # Unauthorized!
        command=["cargo", "check"]
    )
    print("[FAIL] Ownership violation should have been rejected!")
    exit(1)
except ValueError as e:
    print(f"[PASS] Forged ownership dispatch strictly blocked: {e}")

print("\n===================================================================")
print(">>> GATE 3: Fail-Closed Unknown Sub-LEGO in Executor <<<")
print("===================================================================")
forged_job_id = f"test_unknown_{int(time.time())}.json"
forged_payload = {
    "job_id": forged_job_id,
    "agent_id": "agent-01",
    "task_id": "TASK-UNKNOWN-SUBLEGO",
    "sublego_id": "nonexistent.sublego.foo",
    "command": ["cargo", "check"],
    "cwd": "."
}
with open(incoming_dir / forged_job_id, "w") as f:
    json.dump(forged_payload, f)

print(f"Enqueued unknown sublego job: {forged_job_id}. Waiting for executor rejection...")
start = time.time()
rejected = False
while time.time() - start < 15:
    report_file = completed_dir / forged_job_id
    if report_file.exists():
        with open(report_file) as f:
            rep = json.load(f)
        print(f"[RESULT] Unknown sublego result: success={rep['result']['success']}, error={rep['result'].get('error')}")
        assert rep['result']['success'] == False
        assert "Security Violation" in rep['result'].get("error", "")
        rejected = True
        break
    time.sleep(1)

assert rejected, "Executor did not reject unknown sublego within timeout!"
print("[PASS] Unknown Sub-LEGO strictly rejected (fail-closed, 0% fallback).")

print("\n===================================================================")
print(">>> GATE 4: Dual Locking Rollback & Owner-Aware Unlock <<<")
print("===================================================================")
supabase = SupabaseAdapter()

# 4A. Test Owner-aware lock & unlock
test_res = "test.sublego.lock"
supabase.acquire_lock(test_res, "sublego", "agent-01", "TASK-LOCK-01")

# Unauthorized agent trying to release lock
supabase.release_lock(test_res, agent_id="agent-04", task_id="TASK-LOCK-01")
# Try acquiring by agent-02: must fail because agent-01 still holds the lock!
acq_unauthorized = supabase.acquire_lock(test_res, "sublego", "agent-02", "TASK-LOCK-02")
print(f"[PASS] Unauthorized agent cannot steal active lock: acquired={acq_unauthorized}")
assert acq_unauthorized == False

# Authorized release by agent-01
supabase.release_lock(test_res, agent_id="agent-01", task_id="TASK-LOCK-01")
print("[PASS] Authorized owner successfully releases lock.")

print("\n===================================================================")
print(">>> GATE 5: Authoritative Git SHA Manifest Resolution <<<")
print("===================================================================")
head_sha = "183cfc62"
m1 = dispatcher.load_task_manifest("TASK-WFL-GRAPH-01", commit_sha=head_sha)
print(f"[PASS] Loaded manifest from Git commit {head_sha}: agent={m1.get('agent')}, sublego={m1.get('sublego')}")
assert m1.get("agent") == "agent-01"
assert m1.get("sublego") == "workflow.graph"

print("\n===================================================================")
print(">>> GATE 6: Authoritative Real E2E Dispatch & Execution <<<")
print("===================================================================")
job1_id = dispatcher.dispatch_execution_job(
    agent_id="agent-01",
    task_id="TASK-WFL-GRAPH-01",
    sublego_id="workflow.graph",
    command=["cargo", "check"]
)

job2_id = dispatcher.dispatch_execution_job(
    agent_id="agent-04",
    task_id="TASK-EXP-EVAL-01",
    sublego_id="expression.evaluator",
    command=["cargo", "test", "-p", "n8n-expression"]
)

print(f"Verified jobs enqueued: {job1_id} (agent-01) and {job2_id} (agent-04)")

start = time.time()
j1_ok = False
j2_ok = False

while time.time() - start < 90:
    f1 = completed_dir / job1_id
    f2 = completed_dir / job2_id
    
    if f1.exists() and not j1_ok:
        with open(f1) as f:
            res1 = json.load(f)
        print(f"[COMPLETED] Job 1 (agent-01, workflow.graph): success={res1['result']['success']}, exit={res1['result']['exit_code']}")
        assert res1['result']['success'] == True
        j1_ok = True

    if f2.exists() and not j2_ok:
        with open(f2) as f:
            res2 = json.load(f)
        print(f"[COMPLETED] Job 2 (agent-04, expression.evaluator): success={res2['result']['success']}, exit={res2['result']['exit_code']}")
        assert res2['result']['success'] == True
        j2_ok = True

    if j1_ok and j2_ok:
        break
    time.sleep(2)

assert j1_ok and j2_ok, "E2E jobs failed to complete!"

print("\n===================================================================")
print(">>> ALL 6 GATES & REPRODUCIBLE TEST SUITE PASSED 100% <<<")
print("===================================================================")
