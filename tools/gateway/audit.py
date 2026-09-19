"""
Audit Logger for Capability Gateway.
Records every capability invocation, authorization decision, parameters summary,
and execution outcome into an append-only JSONL log without leaking credentials.
"""

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional
from tools.gateway.sanitizer import Sanitizer

class AuditLogger:
    def __init__(self, log_path: Optional[Path] = None, sanitizer: Optional[Sanitizer] = None):
        repo_root = Path(__file__).resolve().parents[2]
        self.log_path = log_path or (repo_root / ".arena" / "logs" / "gateway_audit.jsonl")
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self.sanitizer = sanitizer or Sanitizer()

    def record(
        self,
        caller_id: str,
        capability: str,
        target: str,
        authorization: str,
        status: str,
        duration_ms: float,
        task_id: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        error: Optional[str] = None
    ):
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "caller_id": caller_id,
            "capability": capability,
            "target": self.sanitizer.sanitize_string(target),
            "task_id": task_id,
            "authorization": authorization,
            "status": status,
            "duration_ms": round(duration_ms, 2),
            "details": self.sanitizer.sanitize(details or {}),
            "error": self.sanitizer.sanitize_string(error) if error else None
        }

        with open(self.log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")

    def read_recent(self, limit: int = 50):
        if not self.log_path.exists():
            return []
        lines = self.log_path.read_text(encoding="utf-8").strip().splitlines()
        recent = lines[-limit:]
        return [json.loads(line) for line in recent if line.strip()]
