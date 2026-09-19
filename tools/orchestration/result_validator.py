"""
Result and Git Validation Interfaces.

Provides:
- ResultValidator: Pure validation of ResultResponse data against strict contract invariants,
  including worker_id binding and UTC-aware lease expiration boundary checks (P0-4).
- GitResultValidator: Read-only inspection of git ancestry, commit existence, and boundary compliance.
Does NOT execute git commit, merge, or checkout.
Does NOT mutate Supabase state.
"""

import subprocess
import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

from tools.orchestration.dispatch_contract import (
    ResultResponse, ContractValidationError, PROTOCOL_VERSION, SHA_REGEX, BRANCH_REGEX
)
from tools.orchestration.boundary_guard import TaskBoundaryGuard

def parse_iso_to_utc_timestamp(ts_str: str) -> Optional[float]:
    """Parses an ISO 8601 string to a UTC epoch timestamp."""
    if not ts_str or not isinstance(ts_str, str):
        return None
    try:
        # Standardize Z to +00:00 for datetime.fromisoformat
        clean_ts = ts_str.replace("Z", "+00:00")
        dt = datetime.datetime.fromisoformat(clean_ts)
        if dt.tzinfo is None:
            # Assume UTC if naive
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        return dt.timestamp()
    except Exception:
        return None

class ResultValidator:
    """Pure, deterministic validator for ResultResponse objects with worker and lease binding."""

    @staticmethod
    def validate(
        response: ResultResponse,
        expected_dispatch_id: Optional[str] = None,
        expected_task_id: Optional[str] = None,
        expected_worker_id: Optional[str] = None,
        expected_lease_expires_at: Optional[str] = None
    ) -> Tuple[bool, List[str]]:
        """
        Validates a ResultResponse against schema requirements and optional expected IDs & lease expiration.
        Returns (is_valid, list_of_errors).
        """
        errors = []
        try:
            response.validate()
        except ContractValidationError as e:
            errors.append(str(e))

        if expected_dispatch_id and response.dispatch_id != expected_dispatch_id:
            errors.append(f"dispatch_id mismatch: expected '{expected_dispatch_id}', got '{response.dispatch_id}'")

        if expected_task_id and response.task_id != expected_task_id:
            errors.append(f"task_id mismatch: expected '{expected_task_id}', got '{response.task_id}'")

        if expected_worker_id and response.worker_id != expected_worker_id:
            errors.append(f"worker_id mismatch: expected '{expected_worker_id}', got '{response.worker_id}'")

        # Branch to task_key pattern validation
        if response.branch_name:
            if not BRANCH_REGEX.match(response.branch_name):
                errors.append(f"invalid branch_name format: '{response.branch_name}'")

        # Lease Expiration Validation (P0-4)
        if expected_lease_expires_at:
            lease_ts = parse_iso_to_utc_timestamp(expected_lease_expires_at)
            if lease_ts is None:
                errors.append(f"malformed lease timestamp format: '{expected_lease_expires_at}'")
            else:
                # Boundary rule: completed_at strictly <= lease_expires_at is accepted.
                # If completed_at > lease_expires_at, lease is expired.
                if response.completed_at > lease_ts:
                    errors.append(
                        f"lease expired: completed_at ({response.completed_at}) > lease_expires_at ({lease_ts})"
                    )

        return (len(errors) == 0, errors)

class GitResultValidator:
    """Read-only validator for git results produced by workers/agents."""

    def __init__(self, workspace_root: Optional[Path] = None):
        self.workspace_root = (workspace_root or Path(__file__).resolve().parents[2]).resolve()
        self.boundary_guard = TaskBoundaryGuard(workspace_root=self.workspace_root)

    def verify_commit_exists(self, commit_sha: str) -> bool:
        """Verifies that commit_sha exists in git object database."""
        if not commit_sha or not SHA_REGEX.match(commit_sha):
            return False
        try:
            res = subprocess.run(
                ["git", "cat-file", "-e", f"{commit_sha}^{{commit}}"],
                cwd=self.workspace_root,
                capture_output=True
            )
            return res.returncode == 0
        except Exception:
            return False

    def verify_ancestry(self, base_commit: str, commit_sha: str) -> bool:
        """Verifies that base_commit is an ancestor of commit_sha."""
        if not self.verify_commit_exists(base_commit) or not self.verify_commit_exists(commit_sha):
            return False
        try:
            # git merge-base --is-ancestor <base> <commit>
            res = subprocess.run(
                ["git", "merge-base", "--is-ancestor", base_commit, commit_sha],
                cwd=self.workspace_root,
                capture_output=True
            )
            return res.returncode == 0
        except Exception:
            return False

    def validate_git_result(
        self,
        task_key: str,
        base_commit: str,
        commit_sha: str,
        branch_name: str
    ) -> Dict[str, Any]:
        """
        Performs full read-only git validation:
        - Commit exists
        - Ancestry is valid
        - Boundary conforms to allowed_files
        """
        result = {
            "valid": False,
            "commit_exists": False,
            "ancestry_ok": False,
            "boundary_ok": False,
            "files_modified": [],
            "violations": [],
            "errors": []
        }

        if not BRANCH_REGEX.match(branch_name):
            result["errors"].append(f"Invalid branch name format: {branch_name}")

        commit_exists = self.verify_commit_exists(commit_sha)
        result["commit_exists"] = commit_exists
        if not commit_exists:
            result["errors"].append(f"Commit '{commit_sha}' does not exist")
            return result

        ancestry_ok = self.verify_ancestry(base_commit, commit_sha)
        result["ancestry_ok"] = ancestry_ok
        if not ancestry_ok:
            result["errors"].append(f"Base commit '{base_commit}' is not an ancestor of '{commit_sha}'")

        try:
            boundary_ok, violations = self.boundary_guard.verify_commit_boundary(task_key, commit_sha)
            modified_files = self.boundary_guard.get_commit_modified_files(commit_sha)
            result["boundary_ok"] = boundary_ok
            result["violations"] = violations
            result["files_modified"] = modified_files
            if not boundary_ok:
                result["errors"].append(f"Boundary violations detected: {violations}")
        except Exception as e:
            result["boundary_ok"] = False
            result["errors"].append(f"Failed to inspect commit boundary: {e}")

        result["valid"] = result["commit_exists"] and result["ancestry_ok"] and result["boundary_ok"] and len(result["errors"]) == 0
        return result
