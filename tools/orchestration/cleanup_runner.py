import argparse
import subprocess
import sys
from control_plane import ControlPlaneClient

def run_cmd(cmd, cwd=None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)

def main():
    parser = argparse.ArgumentParser(description="Authorized Post-Merge Verification & Resource Cleanup Runner")
    parser.add_argument("--branch", required=True, help="Task branch name to clean up")
    parser.add_argument("--merge-sha", required=True, help="Merge commit SHA on main")
    parser.add_argument("--pr", required=False, default=None, help="PR number")
    parser.add_argument("--skip-tests", action="store_true", help="Skip re-running post merge tests if already validated in workflow")
    args = parser.parse_args()

    branch = args.branch
    merge_sha = args.merge_sha
    print(f"[cleanup_runner] Starting authorized cleanup for branch '{branch}' (merge_sha={merge_sha[:8]})")

    # Safety checks: main/master MUST NEVER be deleted
    if branch in ("main", "master"):
        print(f"[cleanup_runner] FATAL: Refusing to delete permanent branch '{branch}'!")
        sys.exit(1)

    # 1. Verify merge_sha exists in local main history
    verify_commit = run_cmd(["git", "cat-file", "-t", merge_sha])
    if verify_commit.returncode != 0:
        print(f"[cleanup_runner] WARNING: Merge commit '{merge_sha}' not found in local git history. Fetching latest origin/main...")
        run_cmd(["git", "fetch", "origin", "main"])
        verify_commit = run_cmd(["git", "cat-file", "-t", merge_sha])
        if verify_commit.returncode != 0:
            print(f"[cleanup_runner] ERROR: Merge commit '{merge_sha}' does not exist in repository. Aborting cleanup.")
            sys.exit(1)

    # 2. Run post-merge verification on main if not skipped
    if not args.skip_tests:
        print("[cleanup_runner] Running post-merge verification (Level 0 + affected)...")
        chk = run_cmd(["cargo", "check", "--workspace"])
        if chk.returncode != 0:
            print(f"[cleanup_runner] ERROR: Post-merge cargo check failed:\n{chk.stderr}")
            sys.exit(1)
        tst = run_cmd(["cargo", "test", "-p", "n8n-workflow"])
        if tst.returncode != 0:
            print(f"[cleanup_runner] ERROR: Post-merge cargo test failed:\n{tst.stderr}")
            sys.exit(1)
        print("[cleanup_runner] Post-merge verification: PASSED")

    # 3. Coordinate State Transitions in Supabase Control Plane
    client = ControlPlaneClient()
    if client.url and client.key:
        task = client.get_task_by_key(branch)
        if task:
            task_id = task["id"]
            current_status = task["status"]
            current_version = task["version"]
            print(f"[cleanup_runner] Found task {task_id} in state '{current_status}' (v{current_version})")

            # A. Advance to POST_MERGE_VERIFY if currently in MERGING
            if current_status == "MERGING":
                st, res = client.record_merge(task_id, merge_sha, current_version)
                if st in (200, 204) and res.get("success"):
                    current_version = res.get("version", current_version + 1)
                    current_status = "POST_MERGE_VERIFY"
                    print(f"[cleanup_runner] Task transitioned to POST_MERGE_VERIFY (v{current_version})")
                else:
                    print(f"[cleanup_runner] Notice recording merge: {res}")

            # B. Start Cleanup
            if current_status == "POST_MERGE_VERIFY":
                st_start, res_start = client.start_cleanup(task_id, current_version)
                if st_start in (200, 204) and res_start.get("success"):
                    current_version = res_start.get("version", current_version + 1)
                    current_status = "CLEANUP"
                    print(f"[cleanup_runner] Task transitioned to CLEANUP (v{current_version})")
                elif res_start.get("action") == "ALREADY_COMPLETED":
                    print("[cleanup_runner] Task was already completed. Cleanup idempotent return.")
                    sys.exit(0)
                else:
                    print(f"[cleanup_runner] ERROR starting cleanup: {res_start}")
                    sys.exit(1)

            # C. Remote Branch Deletion
            del_cmd = ["git", "push", "origin", "--delete", branch]
            res_del = run_cmd(del_cmd)
            if res_del.returncode == 0:
                print(f"[cleanup_runner] Remote branch '{branch}' successfully deleted.")
            else:
                print(f"[cleanup_runner] Remote branch delete note (may already be deleted): {res_del.stderr.strip()}")

            # D. Complete Cleanup (release locks & mark task COMPLETED)
            if current_status == "CLEANUP":
                st_comp, res_comp = client.complete_cleanup(task_id, current_version)
                if st_comp in (200, 204) and res_comp.get("success"):
                    print(f"[cleanup_runner] Task {task_id} COMPLETED. All resource locks released.")
                else:
                    print(f"[cleanup_runner] Complete cleanup response: {res_comp}")
        else:
            print(f"[cleanup_runner] Notice: No task found in Supabase matching branch key '{branch}'.")
    else:
        print("[cleanup_runner] Warning: Supabase credentials not configured; skipped Control Plane state transition.")

    print("[cleanup_runner] Cleanup pipeline finished successfully.")

if __name__ == "__main__":
    main()