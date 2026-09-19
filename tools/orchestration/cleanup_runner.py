import argparse
import subprocess
import sys
from control_plane import ControlPlaneClient

def main():
    parser = argparse.ArgumentParser(description="Cleanup task branch after successful merge and validation")
    parser.add_argument("--branch", required=True)
    parser.add_argument("--merge-sha", required=True)
    parser.add_argument("--pr", required=True)
    args = parser.parse_args()

    branch = args.branch
    print(f"[cleanup_runner] Starting cleanup for merged branch '{branch}' (merge_sha={args.merge_sha})")

    # Safety checks: main MUST NOT be deleted
    if branch in ("main", "master"):
        print(f"[cleanup_runner] Refusing to delete permanent branch '{branch}'!")
        sys.exit(1)

    # 1. Delete remote branch if it still exists
    del_cmd = ["git", "push", "origin", "--delete", branch]
    res = subprocess.run(del_cmd, capture_output=True, text=True)
    if res.returncode == 0:
        print(f"[cleanup_runner] Remote branch '{branch}' successfully deleted.")
    else:
        print(f"[cleanup_runner] Remote branch delete notice: {res.stderr.strip()}")

    # 2. Complete cleanup in Supabase Control Plane
    client = ControlPlaneClient()
    if client.url and client.key:
        task = client.get_task_by_key(branch)
        if task:
            task_id = task["id"]
            ver = task["version"]
            st_start, res_start = client.start_cleanup(task_id, ver)
            if st_start in (200, 204):
                new_ver = res_start.get("version", ver + 1)
                client.complete_cleanup(task_id, new_ver)
                print(f"[cleanup_runner] Task {task_id} state transitioned to COMPLETED in Supabase.")

    print("[cleanup_runner] Cleanup finished successfully.")

if __name__ == "__main__":
    main()