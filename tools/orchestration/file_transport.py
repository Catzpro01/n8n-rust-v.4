"""
File-based atomic transport for dispatch requests and results with strict worker namespacing.
Storage layout:
.arena/dispatch/<worker_id>/<dispatch_id>.json
.arena/results/<worker_id>/<dispatch_id>.result.json
.arena/processed/<worker_id>/<dispatch_id>.done

Enforces safe path identifiers (no '..', '/', '\\', absolute paths, or control chars).
Guarantees cross-worker isolation.
"""

import os
import json
import uuid
import re
from pathlib import Path
from typing import Optional, Dict, Any, List

from tools.orchestration.dispatch_contract import (
    DispatchRequest, ResultResponse, ContractValidationError, validate_safe_identifier
)

SAFE_ID_REGEX = re.compile(r"^[a-zA-Z0-9_\-]+$")

def assert_safe_path_component(name: str, field_desc: str = "identifier") -> None:
    """Strict check preventing path traversal, separators, or invalid chars."""
    if not name or not isinstance(name, str):
        raise ContractValidationError(f"{field_desc} must be a non-empty string")
    if not SAFE_ID_REGEX.match(name) or name in {".", ".."}:
        raise ContractValidationError(f"Unsafe {field_desc} '{name}': traversal or invalid characters detected")

class AtomicFileTransport:
    def __init__(self, repo_root: Optional[Path] = None):
        self.repo_root = (repo_root or Path(__file__).resolve().parents[2]).resolve()
        self.dispatch_base = self.repo_root / ".arena" / "dispatch"
        self.results_base = self.repo_root / ".arena" / "results"
        self.processed_base = self.repo_root / ".arena" / "processed"

        self.dispatch_base.mkdir(parents=True, exist_ok=True)
        self.results_base.mkdir(parents=True, exist_ok=True)
        self.processed_base.mkdir(parents=True, exist_ok=True)

    def _get_worker_dispatch_dir(self, worker_id: str) -> Path:
        assert_safe_path_component(worker_id, "worker_id")
        d = self.dispatch_base / worker_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _get_worker_results_dir(self, worker_id: str) -> Path:
        assert_safe_path_component(worker_id, "worker_id")
        d = self.results_base / worker_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _get_worker_processed_dir(self, worker_id: str) -> Path:
        assert_safe_path_component(worker_id, "worker_id")
        d = self.processed_base / worker_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def get_worker_workspace_dir(self, worker_id: str, task_key: Optional[str] = None) -> Path:
        """Returns isolated local filesystem workspace directory for a worker and optional task."""
        assert_safe_path_component(worker_id, "worker_id")
        ws_base = self.repo_root / ".arena" / "workspaces" / worker_id
        if task_key:
            safe_task_slug = re.sub(r"[^a-zA-Z0-9_\-]", "_", task_key)
            ws_dir = ws_base / safe_task_slug
        else:
            ws_dir = ws_base
        ws_dir.mkdir(parents=True, exist_ok=True)
        return ws_dir

    def _atomic_write_json(self, target_path: Path, data: Dict[str, Any]) -> None:
        """Writes JSON to temporary file in same directory and atomically replaces target_path."""
        temp_path = target_path.with_name(f".tmp_{uuid.uuid4().hex}_{target_path.name}")
        try:
            content = json.dumps(data, indent=2)
            with open(temp_path, "w", encoding="utf-8") as f:
                f.write(content)
                f.flush()
                os.fsync(f.fileno())
            temp_path.replace(target_path)
        except Exception:
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except Exception:
                    pass
            raise

    def write_dispatch_request(self, request: DispatchRequest) -> Path:
        """Writes DispatchRequest atomically into worker's isolated namespace."""
        assert_safe_path_component(request.worker_id, "worker_id")
        assert_safe_path_component(request.dispatch_id, "dispatch_id")
        worker_dir = self._get_worker_dispatch_dir(request.worker_id)
        target_path = worker_dir / f"{request.dispatch_id}.json"
        self._atomic_write_json(target_path, request.to_dict())
        return target_path

    def read_dispatch_request(self, worker_id: str, dispatch_id: str) -> Optional[DispatchRequest]:
        """Reads DispatchRequest strictly from specified worker's isolated namespace."""
        assert_safe_path_component(worker_id, "worker_id")
        assert_safe_path_component(dispatch_id, "dispatch_id")
        worker_dir = self._get_worker_dispatch_dir(worker_id)
        target_path = worker_dir / f"{dispatch_id}.json"
        if not target_path.exists():
            return None
        try:
            data = json.loads(target_path.read_text(encoding="utf-8"))
            req = DispatchRequest.from_dict(data)
            if req.worker_id != worker_id or req.dispatch_id != dispatch_id:
                return None
            return req
        except (json.JSONDecodeError, ContractValidationError):
            return None

    def list_pending_dispatches(self, worker_id: str) -> List[DispatchRequest]:
        """Lists all valid pending DispatchRequests for a worker that are not yet marked processed."""
        assert_safe_path_component(worker_id, "worker_id")
        worker_dir = self._get_worker_dispatch_dir(worker_id)
        pending = []
        for p in sorted(worker_dir.glob("*.json")):
            dispatch_id = p.stem
            if self.is_dispatch_processed(worker_id, dispatch_id):
                continue
            req = self.read_dispatch_request(worker_id, dispatch_id)
            if req:
                pending.append(req)
        return pending

    def write_result_response(self, response: ResultResponse) -> Path:
        """Writes ResultResponse atomically into worker's isolated namespace."""
        assert_safe_path_component(response.worker_id, "worker_id")
        assert_safe_path_component(response.dispatch_id, "dispatch_id")
        worker_dir = self._get_worker_results_dir(response.worker_id)
        target_path = worker_dir / f"{response.dispatch_id}.result.json"
        self._atomic_write_json(target_path, response.to_dict())
        return target_path

    def read_result_response(self, worker_id: str, dispatch_id: str) -> Optional[ResultResponse]:
        """Reads ResultResponse strictly from specified worker's isolated namespace."""
        assert_safe_path_component(worker_id, "worker_id")
        assert_safe_path_component(dispatch_id, "dispatch_id")
        worker_dir = self._get_worker_results_dir(worker_id)
        target_path = worker_dir / f"{dispatch_id}.result.json"
        if not target_path.exists():
            return None
        try:
            data = json.loads(target_path.read_text(encoding="utf-8"))
            res = ResultResponse.from_dict(data)
            if res.worker_id != worker_id or res.dispatch_id != dispatch_id:
                return None
            return res
        except (json.JSONDecodeError, ContractValidationError):
            return None

    # --- Replay Protection Mechanics (P1-1) ---

    def is_dispatch_processed(self, worker_id: str, dispatch_id: str) -> bool:
        """Checks if a dispatch_id has already been marked completed/processed."""
        assert_safe_path_component(worker_id, "worker_id")
        assert_safe_path_component(dispatch_id, "dispatch_id")
        p_file = self._get_worker_processed_dir(worker_id) / f"{dispatch_id}.done"
        return p_file.exists()

    def mark_dispatch_processed(self, worker_id: str, dispatch_id: str, result_sha: str) -> bool:
        """
        Durable atomic marker for processed dispatch.
        Stores SHA of result. Returns True on success, False if already marked.
        """
        assert_safe_path_component(worker_id, "worker_id")
        assert_safe_path_component(dispatch_id, "dispatch_id")
        p_dir = self._get_worker_processed_dir(worker_id)
        target_path = p_dir / f"{dispatch_id}.done"
        
        # O_CREAT | O_EXCL ensures atomic single-winner recording
        try:
            fd = os.open(str(target_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, result_sha.encode("utf-8"))
            os.close(fd)
            return True
        except FileExistsError:
            return False

    def get_processed_result_sha(self, worker_id: str, dispatch_id: str) -> Optional[str]:
        """Reads stored SHA for an already processed dispatch."""
        assert_safe_path_component(worker_id, "worker_id")
        assert_safe_path_component(dispatch_id, "dispatch_id")
        target_path = self._get_worker_processed_dir(worker_id) / f"{dispatch_id}.done"
        if target_path.exists():
            try:
                return target_path.read_text(encoding="utf-8").strip()
            except Exception:
                return None
        return None

    def delete_dispatch(self, worker_id: str, dispatch_id: str) -> bool:
        """Cleans up dispatch, result, and done files for a given worker and dispatch_id."""
        assert_safe_path_component(worker_id, "worker_id")
        assert_safe_path_component(dispatch_id, "dispatch_id")
        d_file = self._get_worker_dispatch_dir(worker_id) / f"{dispatch_id}.json"
        r_file = self._get_worker_results_dir(worker_id) / f"{dispatch_id}.result.json"
        p_file = self._get_worker_processed_dir(worker_id) / f"{dispatch_id}.done"
        deleted = False
        for f in (d_file, r_file, p_file):
            if f.exists():
                try:
                    f.unlink()
                    deleted = True
                except Exception:
                    pass
        return deleted
