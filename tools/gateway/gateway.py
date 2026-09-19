"""
Capability Gateway Core.
The single unified entry point for Arena Manager and agents to invoke capabilities.
Manages Policy Enforcement, Secret Isolation, Provider Routing, Output Sanitization,
and Audit Logging.
"""

import time
from pathlib import Path
from typing import Dict, Any, Optional, List

from tools.gateway.vault import SecretVault
from tools.gateway.sanitizer import Sanitizer
from tools.gateway.policy import PolicyEngine
from tools.gateway.audit import AuditLogger

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

    def invoke(self, caller_id: str, capability: str, params: Optional[Dict[str, Any]] = None, task_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Executes a capability on behalf of caller_id.
        Enforces policy, runs the provider method, sanitizes the result, and logs the action.
        """
        params = params or {}
        start_time = time.time()
        target = str(params.get("table") or params.get("branch") or params.get("path") or params.get("command") or "")

        # 1. Policy Authorization Check
        authorized, reason = self.policy.evaluate(caller_id, capability, params)
        if not authorized:
            duration_ms = (time.time() - start_time) * 1000
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
                "authorized": False
            }

        # 2. Check handler existence
        handler = self._handlers.get(capability.lower().strip())
        if not handler:
            err = f"Capability '{capability}' is unknown or not supported"
            duration_ms = (time.time() - start_time) * 1000
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
                "authorized": True
            }

        # 3. Execution & Error Capture
        try:
            raw_result = handler(params)
            duration_ms = (time.time() - start_time) * 1000

            # 4. Deep recursive sanitization
            sanitized_result = self.sanitizer.sanitize(raw_result)

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
                "duration_ms": round(duration_ms, 2)
            }
        except Exception as e:
            duration_ms = (time.time() - start_time) * 1000
            err_msg = self.sanitizer.sanitize_string(str(e))
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
                "authorized": True,
                "duration_ms": round(duration_ms, 2)
            }
