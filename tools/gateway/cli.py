"""
CLI Interface for Arena Manager Capability Gateway.
Allows Arena Manager (or scripts/agents) to invoke capabilities from terminal / subshell:
    python -m tools.gateway.cli discover
    python -m tools.gateway.cli invoke --caller arena-manager --capability github.read_repo
    python -m tools.gateway.cli invoke --caller arena-manager --capability supabase.read_table --params '{"table": "tasks"}'
"""

import sys
import json
import argparse
from tools.gateway.gateway import CapabilityGateway

def main():
    parser = argparse.ArgumentParser(description="Arena Manager Capability Gateway CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Command: discover
    subparsers.add_parser("discover", help="List all available capabilities")

    # Command: invoke
    invoke_parser = subparsers.add_parser("invoke", help="Invoke a capability")
    invoke_parser.add_argument("--caller", required=True, help="Caller identifier (e.g., arena-manager, worker-1)")
    invoke_parser.add_argument("--capability", required=True, help="Capability name (e.g., github.read_repo)")
    invoke_parser.add_argument("--params", default="{}", help="JSON string of capability parameters")
    invoke_parser.add_argument("--task-id", default=None, help="Optional task ID for correlation")

    args = parser.parse_args()
    gateway = CapabilityGateway()

    if args.command == "discover":
        catalog = gateway.discover_capabilities()
        print(json.dumps(catalog, indent=2))
        sys.exit(0)

    elif args.command == "invoke":
        try:
            params = json.loads(args.params)
        except json.JSONDecodeError as e:
            print(json.dumps({"ok": False, "error": f"Invalid JSON params: {e}"}))
            sys.exit(1)

        res = gateway.invoke(
            caller_id=args.caller,
            capability=args.capability,
            params=params,
            task_id=args.task_id
        )
        print(json.dumps(res, indent=2))
        if not res.get("ok"):
            sys.exit(1)
        sys.exit(0)

if __name__ == "__main__":
    main()
