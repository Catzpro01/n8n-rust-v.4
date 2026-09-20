#!/usr/bin/env python3
"""
Arena Executor Worker Daemon (Strict Fail-Closed Sub-LEGO Isolation)
Listens on /srv/arena/runtime/queue/incoming/, executes tasks via StructuredExecutor,
records results to /srv/arena/runtime/queue/completed/, and syncs execution_runs to Supabase.
"""
import os
import sys
import time
import json
import signal
import yaml
from pathlib import Path

# Add sibling tools to path
repo_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(repo_root / "tools" / "arena-executor"))
sys.path.insert(0, str(repo_root / "tools" / "arena-bridge"))

from executor import StructuredExecutor
from fs_guard import SecurityViolation
try:
    from supabase_adapter import SupabaseAdapter
except (ImportError, ValueError):
    SupabaseAdapter = None

RUNNING = True

def handle_signal(signum, frame):
    global RUNNING
    print(f"[ArenaExecutor] Received signal {signum}, initiating clean shutdown...")
    RUNNING = False

def load_sublego_rules(sublego_id: str, repo_dir: Path) -> tuple[list[str], list[str]]:
    """
    STRICT FAIL-CLOSED Sub-LEGO Rule Loader.
    NEVER defaults to ["**"]. If sublego_id is missing, unknown, or registry invalid,
    raises SecurityViolation immediately.
    """
    if not sublego_id:
        raise SecurityViolation("Missing sublego_id in execution job (fail-closed)")

    sublego_yaml = repo_dir / ".arena" / "registry" / "sublego.yaml"
    if not sublego_yaml.exists():
        raise SecurityViolation(f"Registry file not found at {sublego_yaml} (fail-closed)")

    try:
        with open(sublego_yaml, "r") as f:
            data = yaml.safe_load(f)
            for item in data.get("sublegos", []):
                if item.get("id") == sublego_id:
                    allowed = item.get("allowed_paths")
                    forbidden = item.get("forbidden_paths", [".env*", ".git/**"])
                    if not allowed or not isinstance(allowed, list):
                        raise SecurityViolation(f"Sub-LEGO '{sublego_id}' defines no valid allowed_paths (fail-closed)")
                    return allowed, forbidden
    except SecurityViolation:
        raise
    except Exception as e:
        raise SecurityViolation(f"Registry corruption or error reading sublego.yaml: {e}")

    # If sublego_id was not matched in the registry: STRICT REJECT
    raise SecurityViolation(f"Unknown Sub-LEGO '{sublego_id}' not found in registry (fail-closed)")

def process_job(job_file: Path, incoming_dir: Path, processing_dir: Path, completed_dir: Path,
                workspaces_root: Path, repo_dir: Path, supabase):
    job_id = job_file.name
    processing_file = processing_dir / job_id
    completed_file = completed_dir / job_id

    # Move to processing (atomic rename)
    try:
        job_file.rename(processing_file)
    except FileNotFoundError:
        return

    try:
        with open(processing_file, "r") as f:
            job = json.load(f)
    except Exception as e:
        print(f"[ArenaExecutor] Corrupt job file {processing_file}: {e}")
        processing_file.unlink(missing_ok=True)
        return

    agent_id = job.get("agent_id")
    task_id = job.get("task_id")
    sublego_id = job.get("sublego_id", "")
    command_argv = job.get("command", [])
    cwd_rel = job.get("cwd", ".")
    timeout_sec = job.get("timeout_sec", 120)

    print(f"[ArenaExecutor] [START] Job {task_id} for {agent_id} (Sub-LEGO: {sublego_id}): {' '.join(command_argv)}")

    ws_path = workspaces_root / agent_id
    if not ws_path.exists():
        ws_path.mkdir(parents=True, exist_ok=True)
    if not (ws_path / ".git").exists():
        try:
            import subprocess
            subprocess.run(["git", "init"], cwd=str(ws_path), capture_output=True)
        except Exception:
            pass


    try:
        # 1. Strictly load sublego rules (fail-closed)
        allowed_paths, forbidden_paths = load_sublego_rules(sublego_id, repo_dir)
        structured_ex = StructuredExecutor(ws_path, allowed_paths, forbidden_paths)
        exec_res = structured_ex.execute_command(command_argv, cwd_rel=cwd_rel, timeout_sec=timeout_sec)
    except SecurityViolation as sec_err:
        print(f"[ArenaExecutor] [SECURITY REJECT] Job {task_id}: {sec_err}")
        exec_res = {
            "success": False,
            "exit_code": -1,
            "error": f"Security Violation: {str(sec_err)}",
            "command_hash": "rejected"
        }
    except Exception as err:
        print(f"[ArenaExecutor] [ERROR] Job {task_id}: {err}")
        exec_res = {
            "success": False,
            "exit_code": -1,
            "error": f"System error: {str(err)}",
            "command_hash": "error"
        }

    # Prepare job completion report
    report = {
        "task_id": task_id,
        "agent_id": agent_id,
        "sublego_id": sublego_id,
        "command": command_argv,
        "result": exec_res,
        "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }

    with open(completed_file, "w") as f:
        json.dump(report, f, indent=2)

    processing_file.unlink(missing_ok=True)

    # Sync to Supabase audit log
    if supabase:
        status_str = "SUCCESS" if exec_res.get("success") else "FAILED"
        exit_code = exec_res.get("exit_code", -1)
        summary = exec_res.get("error") or (exec_res.get("stdout", "")[:200] if exec_res.get("stdout") else "Done")
        cmd_hash = exec_res.get("command_hash", "none")
        supabase.record_execution_run(
            task_id=task_id,
            agent_id=agent_id,
            command_hash=cmd_hash,
            argv=command_argv,
            status=status_str,
            exit_code=exit_code,
            summary=summary,
            log_path=str(completed_file)
        )

    print(f"[ArenaExecutor] [DONE] Job {task_id} (Success: {exec_res.get('success')})")

def main():
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    workspaces_root = Path(os.environ.get("ARENA_WORKSPACES_ROOT", "/srv/arena/workspaces"))
    runtime_dir = Path("/srv/arena/runtime")
    queue_dir = runtime_dir / "queue"
    incoming_dir = queue_dir / "incoming"
    processing_dir = queue_dir / "processing"
    completed_dir = queue_dir / "completed"

    for d in [incoming_dir, processing_dir, completed_dir]:
        d.mkdir(parents=True, exist_ok=True)

    pid_file = runtime_dir / "executor.pid"
    pid_file.write_text(str(os.getpid()))

    supabase = SupabaseAdapter() if SupabaseAdapter else None
    print(f"[ArenaExecutor] Worker Daemon active (Fail-Closed Sub-LEGO). PID={os.getpid()}, WorkspaceRoot={workspaces_root}")

    try:
        while RUNNING:
            job_files = sorted(list(incoming_dir.glob("*.json")))
            if job_files:
                for job_file in job_files:
                    if not RUNNING:
                        break
                    process_job(
                        job_file, incoming_dir, processing_dir, completed_dir,
                        workspaces_root, repo_root, supabase
                    )
            else:
                time.sleep(1)
    finally:
        if pid_file.exists():
            pid_file.unlink()
        print("[ArenaExecutor] Worker Daemon cleanly exited.")

if __name__ == "__main__":
    main()
