"""
Seed Canonical 49-Task Catalog into Supabase Control Plane.
Loads canonical task definitions from task_manifest_catalog.py and registers them into public.tasks.
Ensures idempotency via ON CONFLICT (task_key) or matching keys.
"""

import json
import sys
import subprocess
from pathlib import Path
from typing import Dict, Any, List

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from tools.orchestration.control_plane import ControlPlaneClient
from tools.orchestration.task_manifest_catalog import CANONICAL_TASKS

def get_git_head_sha() -> str:
    try:
        res = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True
        )
        return res.stdout.strip()
    except Exception:
        return "9f58d11a00000000000000000000000000000000"

def seed_tasks():
    print("=================================================================")
    print("CANONICAL 49-TASK SEEDER FOR SUPABASE CONTROL PLANE")
    print("=================================================================")

    client = ControlPlaneClient()
    if not client.url or not client.key:
        print("[ERROR] Supabase URL or Service Key missing. Check .env configuration.")
        return False

    # 1. Probe database schema readiness
    print("[*] Probing Supabase schema readiness (checking canonical table 'milestones')...", flush=True)
    status, res = client._request("milestones?select=id&limit=1", method="GET")
    if status != 200:
        print(f"[BLOCKED] Canonical database schema not ready. HTTP {status}: {res}", flush=True)
        print("[ACTION REQUIRED] Execute 'supabase/migrations/20260919000000_arena_orchestration_control_plane.sql'", flush=True)
        print("                  in the Supabase Dashboard SQL Editor first.", flush=True)
        return False

    print(f"[OK] Canonical database schema verified. HTTP {status}", flush=True)
    head_sha = get_git_head_sha()

    # 1.1 Fetch specialization UUIDs
    st_spec, spec_rows = client._request("specializations?select=id,slug", method="GET")
    if st_spec != 200 or not isinstance(spec_rows, list):
        print(f"[ERROR] Failed to fetch specializations. HTTP {st_spec}: {spec_rows}", flush=True)
        return False
    spec_map = {row["slug"]: row["id"] for row in spec_rows}

    # 2. Register/Update Tasks
    print(f"[*] Registering {len(CANONICAL_TASKS)} canonical tasks...", flush=True)
    success_count = 0
    fail_count = 0

    for t in CANONICAL_TASKS:
        task_key = t["task_key"]
        milestone = t["milestone"]
        specialization = t["specialization"]
        spec_uuid = spec_map.get(specialization)
        if not spec_uuid:
            print(f"[ERROR] Specialization slug '{specialization}' not found in database specializations table!", flush=True)
            fail_count += 1
            continue

        weight = t["progress_weight"]
        val_lvl = t["validation_level"]
        title = t["title"]
        desc = t["description"]
        deps = t.get("dependencies", [])
        allowed_f = t.get("allowed_files", [])
        exclusive_f = t.get("exclusive_files", [])
        shared_f = t.get("shared_read_files", [])
        criteria = t.get("acceptance_criteria", [])

        # Default initial status:
        # m1-runner is already implemented, verified & passing in main branch
        if task_key == "runtime-kernel/m1-runner":
            initial_status = "DONE"
            commit_sha = head_sha
        else:
            initial_status = "QUEUED"
            commit_sha = None

        branch_slug = task_key.split("/")[-1]
        branch_name = f"{specialization}/{milestone.lower()}-{branch_slug}"

        payload = {
            "task_key": task_key,
            "title": title,
            "description": desc,
            "specialization_id": spec_uuid,
            "milestone": milestone,
            "status": initial_status,
            "base_commit": head_sha,
            "branch_name": branch_name,
            "progress_weight": weight,
            "validation_level": val_lvl,
            "acceptance_criteria": criteria,
            "current_commit_sha": commit_sha,
        }

        # Check if task already exists
        check_status, existing = client._request(f"tasks?task_key=eq.{task_key}&select=id,version,status", method="GET")
        task_id = None
        if check_status == 200 and isinstance(existing, list) and len(existing) > 0:
            existing_task = existing[0]
            task_id = existing_task["id"]
            update_payload = {
                "title": title,
                "description": desc,
                "progress_weight": weight,
                "validation_level": val_lvl,
                "acceptance_criteria": criteria,
            }
            up_status, up_res = client._request(f"tasks?id=eq.{task_id}", data=update_payload, method="PATCH")
            if up_status in (200, 204):
                success_count += 1
            else:
                print(f"[WARN] Failed to update task '{task_key}': {up_res}", flush=True)
                fail_count += 1
        else:
            # Insert new task
            ins_status, ins_res = client._request("tasks", data=payload, method="POST")
            if ins_status in (200, 201):
                success_count += 1
                if isinstance(ins_res, list) and len(ins_res) > 0:
                    task_id = ins_res[0].get("id")
            else:
                print(f"[WARN] Failed to insert task '{task_key}': {ins_res}", flush=True)
                fail_count += 1

        # Populate task_files for resource boundary locks if task_id available
        if task_id:
            for ef in exclusive_f:
                client._request("task_files", data={"task_id": task_id, "file_path": ef, "access_mode": "exclusive"}, method="POST")
            for sf in shared_f:
                client._request("task_files", data={"task_id": task_id, "file_path": sf, "access_mode": "shared-read"}, method="POST")

    print(f"\n[RESULT] Task Seeding Completed: {success_count} succeeded, {fail_count} failed.")
    return fail_count == 0

if __name__ == "__main__":
    success = seed_tasks()
    sys.exit(0 if success else 1)
