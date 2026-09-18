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
        allowed = []
        if policy_file.exists():
            try:
                with open(policy_file, "r") as f:
                    data = yaml.safe_load(f)
                    classes = data.get("execution_policy", {}).get("classes", {})
                    # Add CLASS_A and CLASS_B allowed commands
                    for cmd in classes.get("CLASS_A", {}).get("allowed_commands", []):
                        allowed.append(cmd)
                    for cmd in classes.get("CLASS_B", {}).get("allowed_commands", []):
                        allowed.append(cmd)
            except Exception as e:
                print(f"[Executor] Warning: Failed to parse execution.yaml: {e}")

        # Safe fallback baseline if policy file is missing
        if not allowed:
            allowed = [
                ["git", "status", "*"],
                ["git", "diff", "*"],
                ["cargo", "check", "*"],
                ["cargo", "test", "*"],
                ["cargo", "build", "*"],
                ["cargo", "fmt", "--check"],
                ["cargo", "clippy", "*"],
                ["npm", "test"]
            ]
        return allowed

    def _clean_environment(self) -> dict:
        """
        P0-1 Fix: Constructs a sanitized, minimal environment.
        Strictly strips all secrets, tokens, Supabase keys, and backend credentials.
        """
        tmp_dir = self.workspace_root / ".tmp"
        tmp_dir.mkdir(parents=True, exist_ok=True)

        return {
            "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin:/home/fern/.cargo/bin"),
            "HOME": str(self.workspace_root),
            "USER": "arena-worker",
            "LANG": "C.UTF-8",
            "CARGO_HOME": os.path.expanduser("~/.cargo"),
            "RUSTUP_HOME": os.path.expanduser("~/.rustup"),
            "TMPDIR": str(tmp_dir),
            "ARENA_WORKSPACE": str(self.workspace_root),
        }

    def _is_command_allowed(self, argv: list[str]) -> bool:
        """
        P0-4 Fix: Strict allowlist pattern match against execution policy.
        """
        if not argv:
            return False

        for pattern in self.execution_policy:
            if len(argv) < len(pattern):
                continue
            matched = True
            for i, p_token in enumerate(pattern):
                if p_token == "*":
                    continue
                if not fnmatch.fnmatch(argv[i], p_token):
                    matched = False
                    break
            if matched:
                return True
        return False

    def execute_command(self, argv: list[str], cwd_rel: str = ".", timeout_sec: int = 300) -> dict:
        """
        Executes an allowlisted command with sanitized environment, fail-closed security jail, and timeout.
        """
        target_cwd = self.guard.validate_path(cwd_rel, is_write=False)

        # 1. Strict Allowlist Check (P0-4)
        if not self._is_command_allowed(argv):
            return {
                "success": False,
                "exit_code": -1,
                "error": f"Security Violation: Command '{' '.join(argv)}' is not in execution policy allowlist (CLASS_A/CLASS_B)."
            }

        # 2. Sanitized Environment (P0-1)
        clean_env = self._clean_environment()
        cmd_hash = hashlib.sha256(" ".join(argv).encode()).hexdigest()[:16]
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
                "error": str(e),
                "command_hash": cmd_hash
            }

    def write_file(self, rel_path: str, content: str) -> dict:
        target = self.guard.validate_path(rel_path, is_write=True)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return {"success": True, "path": str(target.relative_to(self.workspace_root))}

    def delete_file(self, rel_path: str) -> dict:
        target = self.guard.validate_path(rel_path, is_write=True)
        if target.exists() and target.is_file():
            target.unlink()
            return {"success": True, "deleted": str(target.relative_to(self.workspace_root))}
        return {"success": False, "error": "File not found or is a directory"}
