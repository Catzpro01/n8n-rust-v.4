"""
Workspace Manager & Evidence Pack Abstraction for Arena Autonomous Platform.
Encapsulates isolated execution environments, state transitions, health monitoring,
environment fingerprinting, and forensic evidence collection.
"""

import os
import sys
import json
import time
import shutil
import hashlib
import platform
import subprocess
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

class WorkspaceState:
    CREATING = "CREATING"
    PREPARING = "PREPARING"
    READY = "READY"
    WORKING = "WORKING"
    TESTING = "TESTING"
    WAITING = "WAITING"
    RECOVERING = "RECOVERING"
    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    STALE = "STALE"
    ORPHANED = "ORPHANED"
    QUARANTINED = "QUARANTINED"
    COMPLETED = "COMPLETED"
    DESTROYED = "DESTROYED"

class WorkspaceHealth:
    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    STALE = "STALE"
    ORPHANED = "ORPHANED"
    CORRUPTED = "CORRUPTED"
    RECOVERABLE = "RECOVERABLE"

class WorkspaceManager:
    def __init__(self, repo_root: Optional[Path] = None, workspaces_base: Optional[Path] = None):
        self.repo_root = (repo_root or Path(__file__).resolve().parents[2]).resolve()
        self.workspaces_base = (workspaces_base or (self.repo_root / ".arena" / "workspaces")).resolve()
        self.workspaces_base.mkdir(parents=True, exist_ok=True)

    def get_workspace_dir(self, worker_id: str, task_key: str) -> Path:
        safe_worker = "".join(c for c in worker_id if c.isalnum() or c in ("-", "_"))
        safe_task = "".join(c for c in task_key.replace("/", "-") if c.isalnum() or c in ("-", "_"))
        ws_dir = self.workspaces_base / f"{safe_worker}_{safe_task}"
        return ws_dir

    def create_workspace(self, worker_id: str, task_key: str, branch_name: str, base_commit_sha: str) -> Dict[str, Any]:
        ws_dir = self.get_workspace_dir(worker_id, task_key)
        ws_dir.mkdir(parents=True, exist_ok=True)
        evidence_dir = ws_dir / ".evidence"
        evidence_dir.mkdir(parents=True, exist_ok=True)

        meta = {
            "worker_id": worker_id,
            "task_key": task_key,
            "branch_name": branch_name,
            "base_commit_sha": base_commit_sha,
            "state": WorkspaceState.READY,
            "health": WorkspaceHealth.HEALTHY,
            "created_at": time.time(),
            "last_active_at": time.time(),
            "fingerprint": self.generate_fingerprint()
        }
        (ws_dir / "workspace.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        return meta

    def generate_fingerprint(self) -> Dict[str, Any]:
        """Generates deterministic host environment fingerprint."""
        fp = {
            "os": platform.system(),
            "os_release": platform.release(),
            "architecture": platform.machine(),
            "python_version": platform.python_version(),
            "timestamp": time.time()
        }
        # Cargo/Rust version check
        try:
            res = subprocess.run(["cargo", "--version"], capture_output=True, text=True)
            if res.returncode == 0:
                fp["cargo_version"] = res.stdout.strip()
        except Exception:
            fp["cargo_version"] = "unavailable"

        # Git version check
        try:
            res = subprocess.run(["git", "--version"], capture_output=True, text=True)
            if res.returncode == 0:
                fp["git_version"] = res.stdout.strip()
        except Exception:
            fp["git_version"] = "unavailable"

        raw_str = f"{fp.get('os')}:{fp.get('architecture')}:{fp.get('python_version')}:{fp.get('cargo_version')}"
        fp["hash"] = hashlib.sha256(raw_str.encode("utf-8")).hexdigest()[:16]
        return fp

    def record_evidence(self, worker_id: str, task_key: str, evidence_type: str, data: Dict[str, Any]) -> Path:
        ws_dir = self.get_workspace_dir(worker_id, task_key)
        evidence_dir = ws_dir / ".evidence"
        evidence_dir.mkdir(parents=True, exist_ok=True)

        file_path = evidence_dir / f"{evidence_type}.json"
        wrapped = {
            "evidence_type": evidence_type,
            "worker_id": worker_id,
            "task_key": task_key,
            "recorded_at": time.time(),
            "data": data
        }
        file_path.write_text(json.dumps(wrapped, indent=2), encoding="utf-8")
        return file_path

    def inspect_workspace(self, worker_id: str, task_key: str) -> Optional[Dict[str, Any]]:
        ws_dir = self.get_workspace_dir(worker_id, task_key)
        meta_file = ws_dir / "workspace.json"
        if not meta_file.exists():
            return None
        try:
            return json.loads(meta_file.read_text(encoding="utf-8"))
        except Exception:
            return None

    def update_workspace_state(self, worker_id: str, task_key: str, state: str, health: Optional[str] = None) -> bool:
        ws_dir = self.get_workspace_dir(worker_id, task_key)
        meta_file = ws_dir / "workspace.json"
        if not meta_file.exists():
            return False
        try:
            data = json.loads(meta_file.read_text(encoding="utf-8"))
            data["state"] = state
            if health:
                data["health"] = health
            data["last_active_at"] = time.time()
            meta_file.write_text(json.dumps(data, indent=2), encoding="utf-8")
            return True
        except Exception:
            return False

    def list_workspaces(self) -> List[Dict[str, Any]]:
        results = []
        for d in self.workspaces_base.glob("*"):
            if d.is_dir() and (d / "workspace.json").exists():
                try:
                    data = json.loads((d / "workspace.json").read_text(encoding="utf-8"))
                    results.append(data)
                except Exception:
                    pass
        return results

    def destroy_workspace(self, worker_id: str, task_key: str, force: bool = False) -> bool:
        ws_dir = self.get_workspace_dir(worker_id, task_key)
        if not ws_dir.exists():
            return True
        meta = self.inspect_workspace(worker_id, task_key)
        if meta and meta.get("state") in (WorkspaceState.WORKING, WorkspaceState.TESTING) and not force:
            return False
        try:
            shutil.rmtree(ws_dir, ignore_errors=True)
            return True
        except Exception:
            return False
