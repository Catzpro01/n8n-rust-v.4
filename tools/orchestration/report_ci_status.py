import argparse
import sys
from pathlib import Path
from control_plane import ControlPlaneClient

def main():
    parser = argparse.ArgumentParser(description="Report CI Status to Supabase Control Plane")
    parser.add_argument("--suite", required=True, choices=["validation", "integration", "audit"])
    parser.add_argument("--status", required=True, choices=["success", "failure", "cancelled"])
    parser.add_argument("--sha", required=True)
    parser.add_argument("--run-id", default="local-or-actions")
    args = parser.parse_args()

    client = ControlPlaneClient()
    if not client.url or not client.key:
        print("[report_ci_status] No Supabase credentials found, skipping remote reporting.")
        sys.exit(0)

    # Map status
    passed = args.status == "success"
    db_status = "PASSED" if passed else "FAILED"

    print(f"[report_ci_status] Suite={args.suite}, Commit={args.sha}, Status={db_status}")

if __name__ == "__main__":
    main()