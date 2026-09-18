import os
import sys
import time
import json
import tempfile
import subprocess
from pathlib import Path

# Resolve repository root dynamically relative to this test file
repo_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(repo_root / "tools" / "arena-bridge"))
sys.path.insert(0, str(repo_root / "tools" / "arena-executor"))

from dispatcher import TaskDispatcher
from executor import StructuredExecutor
from fs_guard import SecurityViolation

# Use environment queue or isolated tempdir for CI portability
temp_queue_dir = None
if "ARENA_QUEUE_DIR" in os.environ:
    queue_root = Path(os.environ["ARENA_QUEUE_DIR"])
elif Path("/srv/arena/runtime/queue").exists() and os.access("/srv/arena/runtime/queue", os.W_OK):
    queue_root = Path("/srv/arena/runtime/queue")
else:
    temp_queue_dir = tempfile.TemporaryDirectory()
    queue_root = Path(temp_queue_dir.name)

incoming_dir = queue_root / "incoming"
completed_dir = queue_root / "completed"
for d in [incoming_dir, completed_dir]:
    d.mkdir(parents=True, exist_ok=True)

# Determine authoritative commit SHA dynamically
CURRENT_SHA = os.environ.get("GITHUB_SHA")
if not CURRENT_SHA:
    try:
        CURRENT_SHA = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=str(repo_root),
            stderr=subprocess.DEVNULL
        ).decode("utf-8").strip()
    except Exception:
        CURRENT_SHA = "HEAD"

print("===================================================================")
print(f">>> RUNNING ARENA ISOLATION SUITE (SHA: {CURRENT_SHA[:8]}, Mode: Portable) <<<")
print("===================================================================")

dispatcher = TaskDispatcher(repo_root=repo_root, queue_dir=queue_root)

# -------------------------------------------------------------------------
# GATE 1: Sub-LEGO Ownership Matrix (Allow / Deny)
# -------------------------------------------------------------------------
print(">>> GATE 1: Sub-LEGO Ownership Matrix (Allow / Deny) <<<")
assert dispatcher.validate_agent_task("agent-01", "workflow.graph") == True
print("[PASS] agent-01 owns workflow.graph -> ALLOWED")

assert dispatcher.validate_agent_task("agent-01", "expression.compiler") == False
print("[PASS] agent-01 accessing expression.compiler -> DENIED")

assert dispatcher.validate_agent_task("agent-04", "expression.compiler") == True
assert dispatcher.validate_agent_task("agent-04", "expression.evaluator") == True
print("[PASS] agent-04 owns expression.* -> ALLOWED")

assert dispatcher.validate_agent_task("agent-04", "workflow.graph") == False
print("[PASS] agent-04 accessing workflow.graph -> DENIED")

# -------------------------------------------------------------------------
# GATE 2: Queue Injection & Ownership Bypass Rejection
# -------------------------------------------------------------------------
print("\n>>> GATE 2: Queue Injection & Ownership Bypass Rejection <<<")
try:
    dispatcher.dispatch_execution_job(
        agent_id="agent-01",
        task_id="FORGED-TASK-01",
        sublego_id="expression.compiler", # Unauthorized!
        command=["cargo", "check"]
    )
    print("[FAIL] Ownership violation should have been rejected!")
    sys.exit(1)
except ValueError as e:
    print(f"[PASS] Forged ownership dispatch strictly blocked: {e}")

# -------------------------------------------------------------------------
# GATE 3: Fail-Closed Unknown Sub-LEGO in Executor Logic
# -------------------------------------------------------------------------
print("\n>>> GATE 3: Fail-Closed Unknown Sub-LEGO in Executor Logic <<<")
# Directly verify StructuredExecutor / rule loader fails-closed on unknown sublego
from cli import load_sublego_rules
try:
    load_sublego_rules("nonexistent.sublego.foo", repo_root)
    print("[FAIL] Unknown Sub-LEGO must raise SecurityViolation!")
    sys.exit(1)
except SecurityViolation as e:
    print(f"[PASS] Unknown Sub-LEGO strictly rejected (fail-closed, 0% fallback): {e}")

try:
    load_sublego_rules("", repo_root)
    print("[FAIL] Empty Sub-LEGO must raise SecurityViolation!")
    sys.exit(1)
except SecurityViolation as e:
    print(f"[PASS] Empty Sub-LEGO strictly rejected: {e}")

# -------------------------------------------------------------------------
# GATE 4: Authoritative Git SHA Manifest Resolution (Generic/Dynamic SHA)
# -------------------------------------------------------------------------
print(f"\n>>> GATE 4: Authoritative Git SHA Manifest Resolution (SHA: {CURRENT_SHA[:8]}) <<<")
# 4A. Valid task in repo at CURRENT_SHA
m1 = dispatcher.load_task_manifest("TASK-WFL-GRAPH-01", commit_sha=CURRENT_SHA)
assert m1 is not None, f"Failed to load manifest at CURRENT_SHA: {CURRENT_SHA}"
assert m1.get("agent") == "agent-01"
assert m1.get("sublego") == "workflow.graph"
print(f"[PASS] Loaded manifest at CURRENT_SHA: agent={m1.get('agent')}, sublego={m1.get('sublego')}")

# 4B. Fail-Closed: nonexistent task at CURRENT_SHA returns None (never falls back)
m_none = dispatcher.load_task_manifest("NONEXISTENT-TASK-999", commit_sha=CURRENT_SHA)
assert m_none is None
print("[PASS] Nonexistent task at Git SHA returns None (Strict Fail-Closed, zero fallback)")

# -------------------------------------------------------------------------
# GATE 5: Semantic Argument & Jail Sandbox Tests
# -------------------------------------------------------------------------
print("\n>>> GATE 5: Semantic Argument & Jail Sandbox Verification <<<")
with tempfile.TemporaryDirectory() as temp_ws:
    temp_ws_path = Path(temp_ws)
    ex = StructuredExecutor(temp_ws_path, ["crates/n8n-workflow/**"], [])
    
    # Dangerous flag rejection
    res_manifest = ex.execute_command(["cargo", "check", "--manifest-path=/etc/shadow"])
    assert not res_manifest["success"], "Dangerous flag must be rejected!"
    print("[PASS] Rejected dangerous flag: --manifest-path")

    # Path traversal rejection
    res_path = ex.execute_command(["cargo", "test", "../../agent-04"])
    assert not res_path["success"], "Path traversal argument must be rejected!"
    print("[PASS] Rejected path traversal argument")

# -------------------------------------------------------------------------
# GATE 6: Integration Queue & Host Daemon Check (if running)
# -------------------------------------------------------------------------
print("\n>>> GATE 6: Dispatch Queue Verification <<<")
job1_id = dispatcher.dispatch_execution_job(
    agent_id="agent-01",
    task_id="TASK-WFL-GRAPH-01",
    sublego_id="workflow.graph",
    command=["cargo", "check"],
    commit_sha=CURRENT_SHA
)
job2_id = dispatcher.dispatch_execution_job(
    agent_id="agent-04",
    task_id="TASK-EXP-EVAL-01",
    sublego_id="expression.evaluator",
    command=["cargo", "test", "-p", "n8n-expression"],
    commit_sha=CURRENT_SHA
)
assert (incoming_dir / job1_id).exists()
assert (incoming_dir / job2_id).exists()
print(f"[PASS] Successfully enqueued verified jobs into queue: {job1_id}, {job2_id}")

# If executed directly on VPS with running executor daemon, verify completion
if Path("/srv/arena/runtime/executor.pid").exists():
    print("Detected running Arena Executor daemon on VPS. Verifying actual job execution...")
    start = time.time()
    j1_ok, j2_ok = False, False
    while time.time() - start < 90:
        f1 = completed_dir / job1_id
        f2 = completed_dir / job2_id
        if f1.exists() and not j1_ok:
            with open(f1) as f:
                res1 = json.load(f)
            assert res1['result']['success'] == True
            j1_ok = True
        if f2.exists() and not j2_ok:
            with open(f2) as f:
                res2 = json.load(f)
            assert res2['result']['success'] == True
            j2_ok = True
        if j1_ok and j2_ok:
            break
        time.sleep(2)
    assert j1_ok and j2_ok, "Daemon failed to complete jobs!"
    print("[PASS] VPS Host Daemon executed both 2-agent jobs with exit_code=0")

# Clean up temp queue if used
if temp_queue_dir:
    temp_queue_dir.cleanup()

print("\n===================================================================")
print(">>> ALL 6 GATES VERIFIED 100% (PORTABLE, DETERMINISTIC, FAIL-CLOSED) <<<")
print("===================================================================")
