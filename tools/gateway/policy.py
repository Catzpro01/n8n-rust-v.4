"""
Authorization Policy Engine for Capability Gateway.
Enforces security boundaries, protected branch freeze, and prevents destructive actions
independent of LLM hallucination or user misdirection.
"""

from typing import Tuple, Dict, Any

PROTECTED_BRANCHES = {"main", "master", "arena-agent"}
PROTECTED_FILES = {
    ".env", ".env.local", ".env.production",
    ".credentials", ".credentials_rsaparams", ".credentials_migrated",
    ".runner", ".service", "id_rsa", "id_ed25519"
}

class PolicyEngine:
    def __init__(self):
        pass

    def evaluate(self, caller_id: str, capability: str, params: Dict[str, Any]) -> Tuple[bool, str]:
        """
        Evaluates whether caller_id is authorized to execute capability with given params.
        Returns: (is_authorized, reason)
        """
        cap = capability.lower().strip()

        # 1. Branch Deletion Protections
        if cap in ("github.delete_branch", "git.delete_branch"):
            branch = params.get("branch") or params.get("branch_name") or ""
            branch = branch.strip().lower()
            if branch in PROTECTED_BRANCHES:
                return False, f"POLICY_VIOLATION: Cannot delete protected branch '{branch}'"
            if branch.startswith("origin/"):
                branch_pure = branch[7:]
                if branch_pure in PROTECTED_BRANCHES:
                    return False, f"POLICY_VIOLATION: Cannot delete protected branch '{branch_pure}'"

        # 2. File Protection (Read / Write / Delete)
        if any(action in cap for action in ("write_file", "delete_file", "read_file")):
            path = str(params.get("path") or params.get("file_path") or "").replace("\\", "/").lower()
            # Check direct match or filename in protected list
            parts = [p.strip() for p in path.split("/")]
            for part in parts:
                if part in PROTECTED_FILES or part.endswith(".pem") or part.endswith(".key"):
                    return False, f"POLICY_VIOLATION: Access to security credential file '{part}' is strictly forbidden"
            if ".git/" in path:
                return False, "POLICY_VIOLATION: Direct modification of internal .git structures is forbidden"

        # 3. Repository Deletion / Critical Settings
        if "delete_repo" in cap or "transfer_repo" in cap:
            return False, "POLICY_VIOLATION: Repository deletion/transfer is strictly prohibited"

        # 4. Worker Scope Fence
        # If caller is a worker agent, they cannot invoke manager-level capabilities
        if caller_id.startswith("arena-agent-") or caller_id.startswith("worker-"):
            # Workers can only work on their assigned arena/<worker-id>/... branches and files
            if cap in ("github.delete_branch", "supabase.migrate", "github.merge_pr"):
                return False, f"POLICY_VIOLATION: Worker agent '{caller_id}' cannot execute administrative operation '{cap}'"

        return True, "AUTHORIZED"
