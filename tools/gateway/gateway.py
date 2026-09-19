"""
Capability Gateway Core.
Unified entry point with token authentication, policy enforcement,
secret isolation, output sanitization, and thread-safe audit logging.
"""

import time
import threading
from pathlib import Path
from typing import Dict, Any, Optional, List

from tools.gateway.vault import SecretVault
from tools.gateway.sanitizer import Sanitizer
from tools.gateway.policy import PolicyEngine
from tools.gateway.audit import AuditLogger
from tools.gateway.auth import GatewayAuth

from tools.gateway.providers.github_provider import GitHubProvider
from tools.gateway.providers.supabase_provider import SupabaseProvider
from tools.gateway.providers.telegram_provider import TelegramProvider
from tools.gateway.providers.laptop_provider import LaptopProvider

class CapabilityGateway:
    def __init__(self, repo_root: Optional[Path] = None, env_path: Optional[Path] = None):
        self.repo_root = repo_root or Path(__file__).resolve().parents[2]
        self.vault = SecretVault(env_path=env_path)
        self.sanitizer = Sanitizer(self.vault.get_known_secret_values())
        self.policy = PolicyEngine()
        self.audit = AuditLogger(sanitizer=self.sanitizer)
        self.auth = GatewayAuth()
        self._lock = threading.Lock()

        # Initialize providers with vault & sanitizer
        self.github = GitHubProvider(self.vault, self.sanitizer, repo_root=self.repo_root)
        self.supabase = SupabaseProvider(self.vault, self.sanitizer)
        self.telegram = TelegramProvider(self.vault, self.sanitizer)
        self.laptop = LaptopProvider(self.vault, self.sanitizer, repo_root=self.repo_root)

        # Map capability names to methods
        self._handlers = {
            # GitHub capabilities
            "github.read_repo": self.github.read_repo,
            "github.list_branches": self.github.list_branches,
            "github.get_branch": self.github.get_branch,
            "github.create_branch": self.github.create_branch,
            "github.delete_branch": self.github.delete_branch,
            "github.read_file": self.github.read_file,
            "github.write_file": self.github.write_file,
            "github.delete_file": self.github.delete_file,
            "github.create_pr": self.github.create_pr,
            "github.update_pr": self.github.update_pr,
            "github.get_pr": self.github.get_pr,
            "github.merge_pr": self.github.merge_pr,
            "github.get_ci": self.github.get_ci,
            "github.commit_and_push": self.github.commit_and_push,

            # Supabase capabilities
            "supabase.read_table": self.supabase.read_table,
            "supabase.write_table": self.supabase.write_table,
            "supabase.rpc": self.supabase.rpc,
            "supabase.inspect_tasks": self.supabase.inspect_tasks,
            "supabase.inspect_agents": self.supabase.inspect_agents,
            "supabase.inspect_locks": self.supabase.inspect_locks,
            "supabase.create_task": self.supabase.create_task,
            "supabase.update_task_state": self.supabase.update_task_state,
            "supabase.record_event": self.supabase.record_event,
            "supabase.get_project_state": self.supabase.get_project_state,

            # Telegram capabilities
            "telegram.send_message": self.telegram.send_message,
            "telegram.get_updates": self.telegram.get_updates,
            "telegram.render_dashboard": self.telegram.render_dashboard,

            # Laptop capabilities
            "laptop.status": self.laptop.status,
            "laptop.run_test": self.laptop.run_test,
            "laptop.run_build": self.laptop.run_build,
            "laptop.run_clippy": self.laptop.run_clippy,
            "laptop.run_command": self.laptop.run_command,
        }

    def discover_capabilities(self) -> Dict[str, Any]:
        """Returns the full catalog of available capabilities and metadata."""
        catalog = {}
        for cap_name, handler in self._handlers.items():
            doc = handler.__doc__ or "No description provided."
            doc = doc.strip().split("\n")[0]
            catalog[cap_name] = {
                "description": doc,
                "domain": cap_name.split(".")[0],
                "operation": cap_name.split(".")[1]
            }
        return {
            "version": "1.7.0",
            "capabilities_count": len(catalog),
            "capabilities": catalog
        }

    def invoke(
        self,
        caller_id: str,
        capability: str,
        params: Optional[Dict[str, Any]] = None,
        task_id: Optional[str] = None,
        bearer_token: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Executes a capability on behalf of caller_id.
        Enforces authentication, policy, executes provider method,
        sanitizes results, and audits execution in a thread-safe manner.
        """
        params = params or {}
        start_time = time.time()
        target = str(params.get("table") or params.get("branch") or params.get("path") or params.get("command") or "")

        # 1. Authentication Check
        # Fallback to local default if called within same host context and no token passed
        # BUT validate role strictly if token is provided.
        if bearer_token:
            is_auth, auth_err, role = self.auth.authenticate(caller_id, bearer_token)
            if not is_auth:
                duration_ms = (time.time() - start_time) * 1000
                with self._lock:
                    self.audit.record(
                        caller_id=caller_id,
                        capability=capability,
                        target=target,
                        authorization="UNAUTHENTICATED",
                        status="FAILED",
                        duration_ms=duration_ms,
                        task_id=task_id,
                        error=auth_err
                    )
                return {
                    "ok": False,
                    "error": auth_err,
                    "authenticated": False,
                    "authorized": False
                }
        else:
            # Token required for remote/CLI calls
            return {
                "ok": False,
                "error": "AUTHENTICATION_REQUIRED: Gateway bearer token must be provided",
                "authenticated": False,
                "authorized": False
            }

        # 2. Policy Authorization Check
        authorized, reason = self.policy.evaluate(caller_id, role, capability, params)
        if not authorized:
            duration_ms = (time.time() - start_time) * 1000
            with self._lock:
                self.audit.record(
                    caller_id=caller_id,
                    capability=capability,
                    target=target,
                    authorization="DENIED",
                    status="FAILED",
                    duration_ms=duration_ms,
                    task_id=task_id,
                    error=reason
                )
            return {
                "ok": False,
                "error": reason,
                "authenticated": True,
                "authorized": False
            }

        # 3. Check handler existence
        handler = self._handlers.get(capability.lower().strip())
        if not handler:
            err = f"Capability '{capability}' is unknown or not supported"
            duration_ms = (time.time() - start_time) * 1000
            with self._lock:
                self.audit.record(
                    caller_id=caller_id,
                    capability=capability,
                    target=target,
                    authorization="AUTHORIZED",
                    status="FAILED",
                    duration_ms=duration_ms,
                    task_id=task_id,
                    error=err
                )
            return {
                "ok": False,
                "error": err,
                "authenticated": True,
                "authorized": True
            }

        # 4. Execution & Error Capture
        try:
            raw_result = handler(params)
            duration_ms = (time.time() - start_time) * 1000

            # 5. Deep recursive sanitization
            sanitized_result = self.sanitizer.sanitize(raw_result)

            with self._lock:
                self.audit.record(
                    caller_id=caller_id,
                    capability=capability,
                    target=target,
                    authorization="AUTHORIZED",
                    status="SUCCESS",
                    duration_ms=duration_ms,
                    task_id=task_id,
                    details={"result_summary": "ok" if isinstance(sanitized_result, dict) and sanitized_result.get("ok") else "data"}
                )

            return {
                "ok": True,
                "result": sanitized_result,
                "authenticated": True,
                "authorized": True,
                "duration_ms": round(duration_ms, 2)
            }
        except Exception as e:
            duration_ms = (time.time() - start_time) * 1000
            err_msg = self.sanitizer.sanitize_string(str(e))
            with self._lock:
                self.audit.record(
                    caller_id=caller_id,
                    capability=capability,
                    target=target,
                    authorization="AUTHORIZED",
                    status="ERROR",
                    duration_ms=duration_ms,
                    task_id=task_id,
                    error=err_msg
                )
            return {
                "ok": False,
                "error": err_msg,
                "authenticated": True,
                "authorized": True,
                "duration_ms": round(duration_ms, 2)
            }
