"""
Authorization Policy Engine for Capability Gateway.
Enforces role-based permissions, protected branch freeze, and prevents destructive actions
independent of LLM hallucination or agent error.
"""

from typing import Tuple, Dict, Any

PROTECTED_BRANCHES = {"main", "master", "arena-agent"}
PROTECTED_FILES = {
    ".env", ".env.local", ".env.production",
    ".credentials", ".credentials_rsaparams", ".credentials_migrated",
    ".runner", ".service", "id_rsa", "id_ed25519", "gateway_tokens.json"
}

# Administrative capabilities reserved exclusively for Arena Manager
MANAGER_ONLY_CAPABILITIES = {
    "github.delete_branch",
    "github.create_pr",
    "github.update_pr",
    "github.merge_pr",
    "supabase.create_task",
    "supabase.update_task_state",
    "telegram.send_message",
    "telegram.render_dashboard",
}

class PolicyEngine:
    def __init__(self):
        pass

    def evaluate(self, caller_id: str, role: str, capability: str, params: Dict[str, Any]) -> Tuple[bool, str]:
        """
        Evaluates whether caller_id with authenticated role is authorized
        to execute capability with given params.
        Returns: (is_authorized, reason)
        """
        cap = capability.lower().strip()

        # 1. Branch Deletion Protections (Frozen branches)
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
            parts = [p.strip() for p in path.split("/")]
            for part in parts:
                if part in PROTECTED_FILES or part.endswith(".pem") or part.endswith(".key"):
                    return False, f"POLICY_VIOLATION: Access to security credential file '{part}' is strictly forbidden"
            if ".git/" in path:
                return False, "POLICY_VIOLATION: Direct modification of internal .git structures is forbidden"

        # 3. Repository Deletion / Critical Settings
        if "delete_repo" in cap or "transfer_repo" in cap:
            return False, "POLICY_VIOLATION: Repository deletion/transfer is strictly prohibited"

        # 4. Worker Role Fencing
        if role == "worker" or caller_id.startswith("arena-agent-") or caller_id.startswith("worker-"):
            if cap in MANAGER_ONLY_CAPABILITIES:
                return False, f"POLICY_VIOLATION: Worker agent '{caller_id}' cannot execute manager-only capability '{cap}'"

            # Worker laptop restrictions
            if cap in ("laptop.run_command", "laptop.run_build", "laptop.run_test", "laptop.run_clippy"):
                # Allowed for local tasks within workspace
                pass

        return True, "AUTHORIZED"
