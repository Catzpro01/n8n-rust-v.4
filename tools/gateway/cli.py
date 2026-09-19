"""
CLI Interface for Arena Manager Capability Gateway.
Allows Arena Manager (or scripts/agents) to invoke capabilities from terminal / subshell
using authenticated tokens:
    python -m tools.gateway.cli discover
    python -m tools.gateway.cli invoke --caller arena-manager --capability github.read_repo --token <GATEWAY_TOKEN>
"""

import sys
import os
import json
import argparse
from tools.gateway.gateway import CapabilityGateway
from tools.gateway.auth import GatewayAuth

def main():
    parser = argparse.ArgumentParser(description="Arena Manager Capability Gateway CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Command: discover
    subparsers.add_parser("discover", help="List all available capabilities")

    # Command: token (for manager / worker convenience on local host)
    token_parser = subparsers.add_parser("token", help="Retrieve assigned token for a role")
    token_parser.add_argument("--role", default="manager", choices=["manager", "worker"], help="Role name")

    # Command: invoke
    invoke_parser = subparsers.add_parser("invoke", help="Invoke a capability")
    invoke_parser.add_argument("--caller", required=True, help="Caller identifier (e.g., arena-manager, worker-1)")
    invoke_parser.add_argument("--capability", required=True, help="Capability name (e.g., github.read_repo)")
    invoke_parser.add_argument("--params", default="{}", help="JSON string of capability parameters")
    invoke_parser.add_argument("--task-id", default=None, help="Optional task ID for correlation")
    invoke_parser.add_argument("--token", default=None, help="Gateway bearer token (or set ARENA_GATEWAY_TOKEN)")

    args = parser.parse_args()
    gateway = CapabilityGateway()

    if args.command == "discover":
        catalog = gateway.discover_capabilities()
        print(json.dumps(catalog, indent=2))
        sys.exit(0)

    elif args.command == "token":
        auth = GatewayAuth()
        token = auth.get_token_for_role(args.role)
        print(token)
        sys.exit(0)

    elif args.command == "invoke":
        try:
            params = json.loads(args.params)
        except json.JSONDecodeError as e:
            print(json.dumps({"ok": False, "error": f"Invalid JSON params: {e}"}))
            sys.exit(1)

        token = args.token or os.environ.get("ARENA_GATEWAY_TOKEN")
        # If no token passed on CLI, check if local auth can provide the role token
        if not token:
            if args.caller == "arena-manager":
                token = gateway.auth.get_token_for_role("manager")
            elif args.caller.startswith("arena-agent-") or args.caller.startswith("worker-"):
                token = gateway.auth.get_token_for_role("worker")

        res = gateway.invoke(
            caller_id=args.caller,
            capability=args.capability,
            params=params,
            task_id=args.task_id,
            bearer_token=token
        )
        print(json.dumps(res, indent=2))
        if not res.get("ok"):
            sys.exit(1)
        sys.exit(0)

if __name__ == "__main__":
    main()
