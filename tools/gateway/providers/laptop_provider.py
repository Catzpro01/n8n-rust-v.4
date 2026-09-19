"""
Laptop Capability Provider for Arena Manager Gateway.
Enables local execution of builds, tests, clippy, git inspection,
and local system operations inside the controlled repository environment.
All process outputs and error traces are strictly sanitized against the vault,
and child processes run in isolated environments without access to host secrets.
"""

import os
import subprocess
import shutil
from pathlib import Path
from typing import Dict, Any, Optional
from tools.gateway.vault import SecretVault
from tools.gateway.sanitizer import Sanitizer

BLOCKED_COMMAND_KEYWORDS = [
    # Destructive commands
    "rm -rf", "del /f", "del /s", "format", "shutdown", "curl", "wget",
    # Environment dumping attempts
    "env", "printenv", "set", "get-childitem env:", "dir env:", "gci env:",
    # File reading attempts on secrets
    "cat .env", "type .env", "more .env", "head .env", "tail .env",
    "cat .credentials", "type .credentials", "type .runner", "cat .runner"
]

class LaptopProvider:
    def __init__(self, vault: SecretVault, sanitizer: Sanitizer, repo_root: Optional[Path] = None):
        self.vault = vault
        self.sanitizer = sanitizer
        self.repo_root = repo_root or Path(__file__).resolve().parents[3]

    def _get_isolated_env(self) -> Dict[str, str]:
        """
        Creates an isolated environment dictionary for subprocess execution.
        Strips ALL API keys, tokens, database secrets, and credentials.
        """
        env = os.environ.copy()
        # Remove known sensitive environment variables
        sensitive_substrings = ["TOKEN", "SECRET", "KEY", "PASS", "AUTH", "CREDENTIAL", "JWT", "RUNNER"]
        keys_to_remove = []
        for k in env:
            k_upper = k.upper()
            if any(sub in k_upper for sub in sensitive_substrings):
                keys_to_remove.append(k)

        for k in keys_to_remove:
            env.pop(k, None)

        # Inject safe placeholders
        env["ARENA_ENVIRONMENT"] = "isolated"
        return env

    def _execute_cmd(self, cmd: list, cwd: Optional[Path] = None, timeout: int = 120) -> Dict[str, Any]:
        target_cwd = cwd or self.repo_root
        isolated_env = self._get_isolated_env()
        try:
            res = subprocess.run(
                cmd,
                cwd=str(target_cwd),
                capture_output=True,
                text=True,
                timeout=timeout,
                env=isolated_env
            )
            return {
                "exit_code": res.returncode,
                "stdout": self.sanitizer.sanitize_string(res.stdout),
                "stderr": self.sanitizer.sanitize_string(res.stderr),
                "success": (res.returncode == 0)
            }
        except subprocess.TimeoutExpired:
            return {
                "exit_code": -1,
                "stdout": "",
                "stderr": f"Command timed out after {timeout} seconds",
                "success": False
            }
        except Exception as e:
            return {
                "exit_code": -1,
                "stdout": "",
                "stderr": self.sanitizer.sanitize_string(str(e)),
                "success": False
            }

    def status(self, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Returns the local workspace status (git branch, commit, dirty status)."""
        branch_res = self._execute_cmd(["git", "rev-parse", "--abbrev-ref", "HEAD"])
        commit_res = self._execute_cmd(["git", "rev-parse", "HEAD"])
        status_res = self._execute_cmd(["git", "status", "--porcelain"])

        runner_active = False
        runner_dir = Path("C:/actions-runner")
        if runner_dir.exists():
            runner_active = True

        return {
            "branch": branch_res["stdout"].strip(),
            "commit": commit_res["stdout"].strip(),
            "is_clean": len(status_res["stdout"].strip()) == 0,
            "runner_installed": runner_active,
            "repo_path": str(self.repo_root)
        }

    def run_test(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Runs cargo test on a specific crate or whole workspace."""
        crate = params.get("crate")
        test_filter = params.get("test_name")

        cmd = ["cargo", "test"]
        if crate:
            cmd.extend(["-p", crate])
        if test_filter:
            cmd.append(test_filter)

        return self._execute_cmd(cmd, timeout=300)

    def run_build(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Runs cargo check or cargo build."""
        mode = params.get("mode", "check") # "check" or "build"
        crate = params.get("crate")

        cmd = ["cargo", mode]
        if crate:
            cmd.extend(["-p", crate])

        return self._execute_cmd(cmd, timeout=300)

    def run_clippy(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Runs cargo clippy."""
        crate = params.get("crate")
        cmd = ["cargo", "clippy"]
        if crate:
            cmd.extend(["-p", crate])
        cmd.extend(["--", "-D", "warnings"])
        return self._execute_cmd(cmd, timeout=300)

    def run_command(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Runs a safe shell command within the repository root."""
        cmd = params.get("command")
        if not cmd:
            raise ValueError("Parameter 'command' is required")

        cmd_str = cmd if isinstance(cmd, str) else " ".join(cmd)
        cmd_lower = cmd_str.lower().strip()

        # Strict keyword check
        for b in BLOCKED_COMMAND_KEYWORDS:
            if b in cmd_lower:
                raise PermissionError(f"Command pattern '{b}' is blocked by laptop provider security policy")

        # Specific single word environment dumps
        if cmd_lower in ["env", "set", "printenv"]:
            raise PermissionError(f"Environment dumping command '{cmd_lower}' is strictly forbidden")

        if isinstance(cmd, str):
            cmd_list = cmd.split()
        else:
            cmd_list = cmd

        timeout = params.get("timeout", 60)
        return self._execute_cmd(cmd_list, timeout=timeout)
