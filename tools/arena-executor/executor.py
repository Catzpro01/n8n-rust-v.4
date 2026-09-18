import os
import json
import time
import hashlib
import fnmatch
import subprocess
import yaml
from pathlib import Path
try:
    from .fs_guard import FilesystemGuard, SecurityViolation
except (ImportError, ValueError):
    from fs_guard import FilesystemGuard, SecurityViolation

# Dangerous flags that can be used to redirect compiler/build output outside sandbox
DANGEROUS_FLAGS = {
    "--manifest-path",
    "--target-dir",
    "--out-dir",
    "--config",
    "-C",
    "--emit",
    "--remap-path-prefix"
}

class StructuredExecutor:
    def __init__(self, workspace_root: Path, allowed_paths: list[str], forbidden_paths: list[str]):
        self.workspace_root = workspace_root.resolve()
        self.guard = FilesystemGuard(self.workspace_root, allowed_paths, forbidden_paths)
        self.execution_policy = self._load_execution_policy()

    def _load_execution_policy(self) -> list[list[str]]:
        """
        Loads strict command allowlist patterns from .arena/policies/execution.yaml.
        """
        repo_root = Path(__file__).resolve().parent.parent.parent
        policy_file = repo_root / ".arena" / "policies" / "execution.yaml"

        if not policy_file.exists():
            return [
                ["cargo", "check"],
                ["cargo", "check", "--workspace"],
                ["cargo", "test"],
                ["cargo", "test", "-p", "*"],
                ["cargo", "fmt", "--check"],
                ["cargo", "clippy"],
                ["git", "status", "--short"],
                ["git", "diff"],
                ["git", "log", "-n", "10", "--oneline"]
            ]

        try:
            with open(policy_file, "r") as f:
                data = yaml.safe_load(f)
            classes = data.get("execution_policy", {}).get("classes", {})
            allowed = []
            for cls_key in ["CLASS_A", "CLASS_B"]:
                cmds = classes.get(cls_key, {}).get("allowed_commands", [])
                allowed.extend(cmds)
            return allowed
        except Exception as e:
            print(f"[StructuredExecutor] Warning loading policy file: {e}")
            return [["cargo", "check"], ["cargo", "check", "--workspace"], ["cargo", "test"]]

    def _is_command_allowed(self, argv: list[str]) -> bool:
        """
        Verifies command matches allowlist AND inspects arguments for dangerous escape flags.
        """
        if not argv:
            return False

        # 1. Semantic check: reject any dangerous compiler redirect / path injection flags
        for arg in argv:
            for flag in DANGEROUS_FLAGS:
                if arg == flag or arg.startswith(flag + "="):
                    print(f"[StructuredExecutor] Rejected command containing dangerous argument: {arg}")
                    return False

        # 2. Check each argument if it looks like a filesystem path - ensure it cannot traverse outside
        for arg in argv[1:]:
            if "/" in arg or "\\" in arg:
                if arg.startswith("-"):
                    continue
                try:
                    self.guard.validate_path(arg, is_write=False)
                except SecurityViolation as e:
                    print(f"[StructuredExecutor] Path violation in argument '{arg}': {e}")
                    return False

        # 3. Match against allowlisted command templates
        for pattern in self.execution_policy:
            if len(argv) < len(pattern):
                continue
            
            matched = True
            for i, p_token in enumerate(pattern):
                if not fnmatch.fnmatch(argv[i], p_token):
                    matched = False
                    break
            
            # If template ends with wildcards or exact match
            if matched:
                if len(argv) == len(pattern) or pattern[-1] == "*":
                    return True

        return False

    def _clean_environment(self) -> dict:
        """
        Enforces strict zero-leak environment jail.
        """
        ALLOWED_ENV_VARS = {
            "PATH",
            "HOME",
            "USER",
            "LANG",
            "CARGO_HOME",
            "RUSTUP_HOME",
            "TMPDIR"
        }
        cleaned = {k: v for k, v in os.environ.items() if k in ALLOWED_ENV_VARS}
        cleaned["ARENA_WORKSPACE"] = str(self.workspace_root)
        cleaned.pop("SUPABASE_KEY", None)
        cleaned.pop("SUPABASE_SERVICE_ROLE_KEY", None)
        cleaned.pop("GITHUB_TOKEN", None)
        cleaned.pop("GITHUB_WEBHOOK_SECRET", None)
        return cleaned

    def execute_command(self, argv: list[str], cwd_rel: str = ".", timeout_sec: int = 300) -> dict:
        """
        Executes an allowlisted command with sanitized environment, fail-closed security jail, and timeout.
        """
        target_cwd = self.guard.validate_path(cwd_rel, is_write=False)

        # 1. Strict Allowlist & Semantic Argument Check
        if not self._is_command_allowed(argv):
            return {
                "success": False,
                "exit_code": -1,
                "error": f"Security Violation: Command '{' '.join(argv)}' is rejected by execution policy or contains dangerous arguments."
            }

        # 2. Prepare Environment
        clean_env = self._clean_environment()
        cmd_hash = hashlib.sha256(" ".join(argv).encode()).hexdigest()[:12]

        start_time = time.time()
        try:
            proc = subprocess.run(
                argv,
                cwd=str(target_cwd),
                capture_output=True,
                text=True,
                timeout=timeout_sec,
                env=clean_env
            )
            duration = time.time() - start_time
            return {
                "success": proc.returncode == 0,
                "exit_code": proc.returncode,
                "stdout": proc.stdout,
                "stderr": proc.stderr,
                "duration_sec": round(duration, 3),
                "command_hash": cmd_hash
            }
        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "exit_code": -9,
                "error": f"Command timed out after {timeout_sec}s",
                "command_hash": cmd_hash
            }
        except Exception as e:
            return {
                "success": False,
                "exit_code": -1,
                "error": f"Execution error: {str(e)}",
                "command_hash": cmd_hash
            }
