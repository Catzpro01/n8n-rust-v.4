"""
Python SDK Client for Arena Manager Capability Gateway.
Provides an idiomatic interface for Arena Manager to invoke capabilities
either over HTTP REST API daemon or via direct in-process gateway instance.
"""

import os
import json
import urllib.request
import urllib.error
from typing import Dict, Any, Optional
from pathlib import Path

from tools.gateway.auth import GatewayAuth
from tools.gateway.gateway import CapabilityGateway

class GatewayClient:
    def __init__(
        self,
        base_url: Optional[str] = None,
        token: Optional[str] = None,
        caller_id: str = "arena-manager",
        direct: bool = False
    ):
        self.caller_id = caller_id
        self.direct = direct
        self.auth = GatewayAuth()
        self.token = token or (
            self.auth.get_token_for_role("manager") if caller_id == "arena-manager"
            else self.auth.get_token_for_role("worker")
        )
        self.base_url = (base_url or os.environ.get("GATEWAY_URL") or "http://127.0.0.1:8787").rstrip("/")
        self._direct_gateway = CapabilityGateway() if direct else None

    def invoke(
        self,
        capability: str,
        params: Optional[Dict[str, Any]] = None,
        task_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Invokes a capability via HTTP daemon or direct instance."""
        params = params or {}
        if self.direct and self._direct_gateway:
            return self._direct_gateway.invoke(
                caller_id=self.caller_id,
                capability=capability,
                params=params,
                task_id=task_id,
                bearer_token=self.token
            )

        # HTTP REST invocation
        payload = {
            "caller_id": self.caller_id,
            "capability": capability,
            "params": params,
            "task_id": task_id
        }
        data = json.dumps(payload).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {self.token}",
            "X-Caller-ID": self.caller_id,
            "Content-Type": "application/json"
        }
        req = urllib.request.Request(f"{self.base_url}/api/v1/invoke", data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = resp.read().decode("utf-8")
                return json.loads(body)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8") if e.fp else ""
            try:
                return json.loads(body)
            except Exception:
                return {"ok": False, "error": f"HTTP {e.code}: {body}", "authenticated": False, "authorized": False}
        except Exception as ex:
            # If server not running and direct fallback allowed:
            if not self.direct:
                # Try direct fallback
                gateway = CapabilityGateway()
                return gateway.invoke(
                    caller_id=self.caller_id,
                    capability=capability,
                    params=params,
                    task_id=task_id,
                    bearer_token=self.token
                )
            return {"ok": False, "error": f"Network Error: {ex}", "authenticated": False, "authorized": False}

    # Helper methods for Manager
    def discover_capabilities(self) -> Dict[str, Any]:
        req = urllib.request.Request(f"{self.base_url}/api/v1/capabilities")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception:
            gateway = CapabilityGateway()
            return gateway.discover_capabilities()

    def health(self) -> Dict[str, Any]:
        req = urllib.request.Request(f"{self.base_url}/api/v1/health")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            return {"status": "UNREACHABLE", "error": str(e)}
