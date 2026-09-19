"""
Strict Read-Only Verification for Arena Control Plane (Supabase Cloud).
Checks credentials, connectivity, 12 tables, 18 RPCs, 10 milestones, 10 specializations,
and counts registered tasks without mutating any state or registering new tasks.
"""

import json
import sys
import urllib.request
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from tools.orchestration.control_plane import load_env_config

def main():
    print("=================================================================")
    print("READ-ONLY CONTROL PLANE VERIFICATION (n8n-rust-v.4)")
    print("=================================================================")

    # 1. Baca credential
    cfg = load_env_config()
    url = cfg.get("SUPABASE_URL", "").rstrip("/")
    key = cfg.get("SUPABASE_SERVICE_ROLE_KEY", "")

    print("1. Credential Check:")
    print(f"   - SUPABASE_URL present       : {bool(url)} ({url[:20]}...)" if url else "   - SUPABASE_URL present       : False")
    print(f"   - SERVICE_ROLE_KEY present   : {bool(key)} (prefix={key[:10]}... length={len(key)})" if key else "   - SERVICE_ROLE_KEY present   : False")

    if not url or not key:
        print("\n[FATAL] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env")
        return

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
    }

    def req(endpoint):
        url_full = f"{url}/rest/v1/{endpoint}"
        r = urllib.request.Request(url_full, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(r, timeout=10) as resp:
                data = resp.read().decode("utf-8")
                return resp.status, json.loads(data) if data else {}
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8")
        except Exception as e:
            return 0, str(e)

    # 2. Verifikasi Koneksi
    st_root, spec_json = req("")
    print("\n2. Connection Check:")
    print(f"   - HTTP Status                : {st_root}")
    if st_root != 200:
        print("   [FAIL] Supabase is NOT reachable.")
        return
    print("   [PASS] Supabase Cloud Reachable & OpenAPI Spec Loaded.")

    # 3. Verifikasi 12 Tabel Canonical
    canonical_tables = [
        "milestones", "specializations", "agents", "tasks", "task_files",
        "locks", "build_jobs", "test_results", "audit_results", "events",
        "task_state_transitions", "progress_snapshots"
    ]
    print("\n3. Canonical Tables Verification (12 tables):")
    tables_pass = True
    for tbl in canonical_tables:
        st, res = req(f"{tbl}?limit=1")
        ok = (st in (200, 204))
        if not ok:
            tables_pass = False
        status_str = "[PASS]" if ok else f"[FAIL HTTP {st}]"
        print(f"   {status_str:14s} public.{tbl}")

    # 4. Verifikasi 18 RPC Canonical
    canonical_rpcs = [
        "claim_task", "start_task", "submit_commit", "record_build_result",
        "record_test_result", "record_audit_result", "authorize_merge",
        "record_merge", "start_cleanup", "complete_cleanup", "acquire_file_lock",
        "release_file_lock", "reap_expired_leases", "get_project_progress",
        "get_milestone_progress", "get_task_progress", "record_progress_snapshot",
        "get_latest_progress_snapshot"
    ]
    exposed_paths = set(spec_json.get("paths", {}).keys())
    print("\n4. Canonical RPC Verification (18 RPCs):")
    rpcs_pass = True
    for rpc in canonical_rpcs:
        rpc_path = f"/rpc/{rpc}"
        exists = rpc_path in exposed_paths
        if not exists:
            rpcs_pass = False
        status_str = "[PASS]" if exists else "[FAIL NOT FOUND]"
        print(f"   {status_str:18s} {rpc_path}")

    # 5. Verifikasi Seed 10 Milestones
    st_m, milestones = req("milestones?select=id,name,weight&order=id.asc")
    print("\n5. Seed Milestones Verification (10 Milestones):")
    if st_m == 200 and isinstance(milestones, list):
        print(f"   - Total Milestones           : {len(milestones)}/10")
        for m in milestones:
            print(f"     * {m['id']:4s}: {m['name']:22s} (weight={m['weight']})")
    else:
        print(f"   [FAIL] Could not fetch milestones: HTTP {st_m}")

    # 6. Verifikasi Seed 10 Specializations
    st_s, specs = req("specializations?select=id,slug,name,milestone&order=slug.asc")
    print("\n6. Seed Specializations Verification (10 Specializations):")
    if st_s == 200 and isinstance(specs, list):
        print(f"   - Total Specializations      : {len(specs)}/10")
        for s in specs:
            print(f"     * {s['slug']:20s} -> Milestone {s['milestone']:4s} (UUID={s['id']})")
    else:
        print(f"   [FAIL] Could not fetch specializations: HTTP {st_s}")

    # 7. Hitung Task yang Terdaftar
    st_t, tasks = req("tasks?deleted_at=is.null&select=task_key,status,progress_weight,milestone")
    print("\n7. Registered Tasks Count & Breakdown:")
    if st_t == 200 and isinstance(tasks, list):
        total_w = sum(float(t.get("progress_weight", 0.0)) for t in tasks)
        by_status = {}
        for t in tasks:
            st_val = t.get("status", "UNKNOWN")
            by_status[st_val] = by_status.get(st_val, 0) + 1
        print(f"   - Total Tasks Terdaftar      : {len(tasks)}")
        print(f"   - Total Progress Weight       : {total_w:.1f}")
        print(f"   - Status Breakdown            : {by_status}")
    else:
        print(f"   [FAIL] Could not fetch tasks: HTTP {st_t}")

    print("\n=================================================================")
    print("VERIFICATION SUMMARY:")
    print(f"   - Credentials Valid           : True")
    print(f"   - Supabase Connection         : PASS")
    print(f"   - 12 Canonical Tables         : {'PASS (12/12)' if tables_pass else 'FAIL'}")
    print(f"   - 18 Canonical RPCs           : {'PASS (18/18)' if rpcs_pass else 'FAIL'}")
    print(f"   - Seed 10 Milestones          : {'PASS (10/10)' if st_m == 200 and len(milestones) == 10 else 'FAIL'}")
    print(f"   - Seed 10 Specializations     : {'PASS (10/10)' if st_s == 200 and len(specs) == 10 else 'FAIL'}")
    print(f"   - Tasks in Database           : {len(tasks)} tasks (Total weight: {total_w:.1f})")
    print("   - PHASE C STATUS              : STOP GATE ACTIVE (Workforce NOT OPENED)")
    print("=================================================================")

if __name__ == "__main__":
    main()
