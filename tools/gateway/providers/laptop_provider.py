"""
Laptop Capability Provider for Arena Manager Gateway.
Bridges capability calls (laptop.run_test, laptop.run_build, laptop.run_clippy, laptop.status)
either locally or via authenticated signed Webhooks to the Laptop Webhook Agent.
All outputs and error traces are strictly sanitized against the vault.
"""

import os
import time
import json
import uuid
import urllib.request
import urllib.error
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional

from tools.gateway.vault import SecretVault
from tools.gateway.sanitizer import Sanitizer
from tools.gateway.laptop_webhook_agent import compute_webhook_signature

BLOCKED_COMMAND_KEYWORDS = [
    "rm -rf", "del /f", "del /s", "format", "shutdown", "curl", "wget",
    "env", "printenv", "set", "get-childitem env:", "dir env:", "gci env:",
    "cat .env", "type .env", "more .env", "head .env", "tail .env",
    "cat .credentials", "type .credentials", "type .runner", "cat .runner"
]

class LaptopProvider:
    def __init__(self, vault: SecretVault, sanitizer: Sanitizer, repo_root: Optional[Path] = None, webhook_url: str = "http://127.0.0.1:8989"):
        self.vault = vault
        self.sanitizer = sanitizer
        self.repo_root = repo_root or Path(__file__).resolve().parents[3]
        self.webhook_url = webhook_url.rstrip("/")

    def _call_webhook(self, operation: str, params: Dict[str, Any], timeout: int = 180) -> Optional[Dict[str, Any]]:
        """Sends signed webhook request to Laptop Webhook Agent if running."""
        secret = self.vault.get("LAPTOP_WEBHOOK_SECRET") or "arena-laptop-worker-local-secret"
        req_id = f"req-{uuid.uuid4().hex[:12]}"
        timestamp = str(time.time())

        payload = {
            "operation": operation,
            "request_id": req_id,
            "timeout": timeout,
            **params
        }
        body_bytes = json.dumps(payload).encode("utf-8")
        signature = compute_webhook_signature(secret, timestamp, req_id, body_bytes)

        headers = {
            "Content-Type": "application/json",
            "X-Webhook-Signature": signature,
            "X-Webhook-Timestamp": timestamp,
            "X-Webhook-Request-ID": req_id
        }

        req = urllib.request.Request(f"{self.webhook_url}/webhook/execute", data=body_bytes, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout + 10) as resp:
                raw = resp.read().decode("utf-8")
                res = json.loads(raw)
                return self.sanitizer.sanitize(res)
        except Exception:
            # If webhook agent is offline, fallback to direct isolated local execution
            return None

    def _get_isolated_env(self) -> Dict[str, str]:
        env = os.environ.copy()
        sensitive = ["TOKEN", "SECRET", "KEY", "PASS", "AUTH", "CREDENTIAL", "JWT", "RUNNER"]
        for k in list(env.keys()):
            if any(s in k.upper() for s in sensitive):
                env.pop(k, None)
        env["ARENA_ENVIRONMENT"] = "isolated"
        return env

    def _execute_local(self, cmd: list, timeout: int = 120) -> Dict[str, Any]:
        isolated_env = self._get_isolated_env()
        try:
            res = subprocess.run(
                cmd,
                cwd=str(self.repo_root),
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
                "stderr": f"Command timed out after {timeout}s",
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
        """Workspace status and webhook connectivity check."""
        webhook_online = False
        try:
            req = urllib.request.Request(f"{self.webhook_url}/health", method="GET")
            with urllib.request.urlopen(req, timeout=2) as resp:
                webhook_online = (resp.status == 200)
        except Exception:
            webhook_online = False

        branch_res = self._execute_local(["git", "rev-parse", "--abbrev-ref", "HEAD"])
        commit_res = self._execute_local(["git", "rev-parse", "HEAD"])
        status_res = self._execute_local(["git", "status", "--porcelain"])

        runner_dir = Path("C:/actions-runner")

        return {
            "branch": branch_res["stdout"].strip(),
            "commit": commit_res["stdout"].strip(),
            "is_clean": len(status_res["stdout"].strip()) == 0,
            "runner_installed": runner_dir.exists(),
            "webhook_agent_online": webhook_online,
            "repo_path": str(self.repo_root)
        }

    def run_test(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Runs cargo test through signed webhook if online, or local sandbox."""
        crate = params.get("crate")
        timeout = params.get("timeout", 300)

        # Attempt signed webhook execution
        if crate:
            wh_res = self._call_webhook("cargo_test_package", {"package": crate, "test_filter": params.get("test_name", "")}, timeout=timeout)
        else:
            wh_res = self._call_webhook("cargo_test", {}, timeout=timeout)

        if wh_res is not None:
            return wh_res

        # Fallback to local isolated execution
        cmd = ["cargo", "test"]
        if crate:
            cmd.extend(["-p", crate])
        if params.get("test_name"):
            cmd.append(params["test_name"])
        return self._execute_local(cmd, timeout=timeout)

    def run_build(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Runs cargo check or cargo build."""
        mode = params.get("mode", "check")
        timeout = params.get("timeout", 300)

        wh_op = "cargo_check" if mode == "check" else "cargo_build"
        wh_res = self._call_webhook(wh_op, {}, timeout=timeout)
        if wh_res is not None:
            return wh_res

        cmd = ["cargo", mode]
        if params.get("crate"):
            cmd.extend(["-p", params["crate"]])
        return self._execute_local(cmd, timeout=timeout)

    def run_clippy(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Runs cargo clippy."""
        timeout = params.get("timeout", 300)
        wh_res = self._call_webhook("cargo_clippy", {}, timeout=timeout)
        if wh_res is not None:
            return wh_res

        cmd = ["cargo", "clippy"]
        if params.get("crate"):
            cmd.extend(["-p", params["crate"]])
        cmd.extend(["--", "-D", "warnings"])
        return self._execute_local(cmd, timeout=timeout)

    def run_command(self, params: Dict[str, Any]) -> Dict[str, Any]:
        cmd = params.get("command")
        if not cmd:
            raise ValueError("Parameter 'command' is required")

        cmd_str = cmd if isinstance(cmd, str) else " ".join(cmd)
        cmd_lower = cmd_str.lower().strip()

        for b in BLOCKED_COMMAND_KEYWORDS:
            if b in cmd_lower:
                raise PermissionError(f"Command pattern '{b}' is blocked by laptop provider security policy")

        if cmd_lower in ["env", "set", "printenv"]:
            raise PermissionError(f"Environment dumping command '{cmd_lower}' is strictly forbidden")

        cmd_list = cmd.split() if isinstance(cmd, str) else cmd
        timeout = params.get("timeout", 60)
        return self._execute_local(cmd_list, timeout=timeout)
