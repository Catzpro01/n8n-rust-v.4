import os
import json
import time
import hashlib
import subprocess
from pathlib import Path
try:
    from .fs_guard import FilesystemGuard, SecurityViolation
except (ImportError, ValueError):
    from fs_guard import FilesystemGuard, SecurityViolation

class StructuredExecutor:
    def __init__(self, workspace_root: Path, allowed_paths: list[str], forbidden_paths: list[str]):
        self.workspace_root = workspace_root.resolve()
        self.guard = FilesystemGuard(self.workspace_root, allowed_paths, forbidden_paths)

    def execute_command(self, argv: list[str], cwd_rel: str = ".", timeout_sec: int = 300) -> dict:
        """
        Executes an allowed command inside the workspace jail with timeout and logging.
        """
        target_cwd = self.guard.validate_path(cwd_rel, is_write=False)

        # Disallow raw shell metacharacters or dangerous binaries
        dangerous_bins = {"sudo", "su", "systemctl", "ufw", "iptables", "dd", "mkfs", "rm"}
        if not argv or argv[0] in dangerous_bins:
            return {
                "success": False,
                "exit_code": -1,
                "error": f"Binary '{argv[0] if argv else None}' is strictly disallowed"
            }

        cmd_hash = hashlib.sha256(" ".join(argv).encode()).hexdigest()[:16]
        start_time = time.time()

        try:
            proc = subprocess.run(
                argv,
                cwd=str(target_cwd),
                capture_output=True,
                text=True,
                timeout=timeout_sec,
                env=dict(os.environ, ARENA_WORKSPACE=str(self.workspace_root))
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
