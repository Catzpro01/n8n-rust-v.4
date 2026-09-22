"""
Arena Dispatch and Result Contracts.
Defines deterministic, versioned data contracts between Persistent Worker Host and Agent Arena.

Protocol Version: "1"
Pure data contracts with serialization, deserialization, and field-level validation.
Does NOT mutate Supabase or trigger task claims.
"""

import re
import time
import uuid
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field, asdict

PROTOCOL_VERSION = "1"

VALID_STATUSES = {"SUCCESS", "FAILURE", "TIMEOUT", "CANCELLED"}
SHA_REGEX = re.compile(r"^[0-9a-f]{7,40}$", re.IGNORECASE)
BRANCH_REGEX = re.compile(r"^[a-z0-9\-]+/[a-z0-9]+-[a-z0-9\-]+$")
SAFE_ID_REGEX = re.compile(r"^[a-zA-Z0-9_\-]+$")

class ContractValidationError(ValueError):
    """Raised when a dispatch request or result response violates contract schema."""
    pass

def validate_safe_identifier(identifier: str, field_name: str = "identifier") -> None:
    """Validates that identifier is non-empty, alphanumeric with hyphens/underscores, without path traversal."""
    if not identifier or not isinstance(identifier, str):
        raise ContractValidationError(f"{field_name} must be a non-empty string")
    if not SAFE_ID_REGEX.match(identifier):
        raise ContractValidationError(f"{field_name} '{identifier}' contains invalid characters or path separators")

@dataclass
class DispatchRequest:
    worker_id: str
    task_id: str
    task_key: str
    branch_name: str
    base_commit_sha: str
    allowed_files: List[str]
    acceptance_criteria: List[str]
    lease_expires_at: str
    dispatch_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: float = field(default_factory=time.time)
    protocol_version: str = PROTOCOL_VERSION

    def validate(self) -> None:
        """Validates all required fields for DispatchRequest."""
        if self.protocol_version != PROTOCOL_VERSION:
            raise ContractValidationError(f"Invalid protocol_version '{self.protocol_version}', expected '{PROTOCOL_VERSION}'")
        validate_safe_identifier(self.dispatch_id, "dispatch_id")
        validate_safe_identifier(self.worker_id, "worker_id")
        validate_safe_identifier(self.task_id, "task_id")
        if not self.task_key or not isinstance(self.task_key, str):
            raise ContractValidationError("task_key must be a non-empty string")
        if not self.branch_name or not BRANCH_REGEX.match(self.branch_name):
            raise ContractValidationError(f"branch_name '{self.branch_name}' does not match pattern <specialization>/<milestone>-<task>")
        if not self.base_commit_sha or not SHA_REGEX.match(self.base_commit_sha):
            raise ContractValidationError(f"base_commit_sha '{self.base_commit_sha}' is not a valid git SHA")
        if not isinstance(self.allowed_files, list) or len(self.allowed_files) == 0:
            raise ContractValidationError("allowed_files must be a non-empty list of paths")
        if not isinstance(self.acceptance_criteria, list):
            raise ContractValidationError("acceptance_criteria must be a list")
        if not self.lease_expires_at:
            raise ContractValidationError("lease_expires_at must be provided")

    def to_dict(self) -> Dict[str, Any]:
        self.validate()
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DispatchRequest":
        if not isinstance(data, dict):
            raise ContractValidationError("Data must be a dictionary")
        
        req = cls(
            worker_id=data.get("worker_id", ""),
            task_id=data.get("task_id", ""),
            task_key=data.get("task_key", ""),
            branch_name=data.get("branch_name", ""),
            base_commit_sha=data.get("base_commit_sha", ""),
            allowed_files=data.get("allowed_files", []),
            acceptance_criteria=data.get("acceptance_criteria", []),
            lease_expires_at=data.get("lease_expires_at", ""),
            dispatch_id=data.get("dispatch_id", ""),
            created_at=float(data.get("created_at", time.time())),
            protocol_version=data.get("protocol_version", "")
        )
        req.validate()
        return req

@dataclass
class ResultResponse:
    dispatch_id: str
    task_id: str
    worker_id: str
    agent_session_id: str
    status: str
    commit_sha: Optional[str] = None
    branch_name: Optional[str] = None
    files_modified: List[str] = field(default_factory=list)
    test_evidence: Dict[str, Any] = field(default_factory=dict)
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    started_at: float = field(default_factory=time.time)
    completed_at: float = field(default_factory=time.time)
    protocol_version: str = PROTOCOL_VERSION

    def validate(self) -> None:
        """Validates all required fields for ResultResponse."""
        if self.protocol_version != PROTOCOL_VERSION:
            raise ContractValidationError(f"Invalid protocol_version '{self.protocol_version}', expected '{PROTOCOL_VERSION}'")
        validate_safe_identifier(self.dispatch_id, "dispatch_id")
        validate_safe_identifier(self.task_id, "task_id")
        validate_safe_identifier(self.worker_id, "worker_id")
        validate_safe_identifier(self.agent_session_id, "agent_session_id")
        if self.status not in VALID_STATUSES:
            raise ContractValidationError(f"status '{self.status}' is invalid. Must be one of: {sorted(list(VALID_STATUSES))}")
        
        if self.status == "SUCCESS":
            if not self.commit_sha or not SHA_REGEX.match(self.commit_sha):
                raise ContractValidationError(f"SUCCESS status requires a valid commit_sha, got '{self.commit_sha}'")
            if not self.branch_name or not BRANCH_REGEX.match(self.branch_name):
                raise ContractValidationError(f"SUCCESS status requires a valid branch_name, got '{self.branch_name}'")
            if not isinstance(self.files_modified, list):
                raise ContractValidationError("files_modified must be a list of paths")
            if not isinstance(self.test_evidence, dict):
                raise ContractValidationError("test_evidence must be a dictionary")

    def to_dict(self) -> Dict[str, Any]:
        self.validate()
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ResultResponse":
        if not isinstance(data, dict):
            raise ContractValidationError("Data must be a dictionary")

        res = cls(
            dispatch_id=data.get("dispatch_id", ""),
            task_id=data.get("task_id", ""),
            worker_id=data.get("worker_id", ""),
            agent_session_id=data.get("agent_session_id", ""),
            status=data.get("status", ""),
            commit_sha=data.get("commit_sha"),
            branch_name=data.get("branch_name"),
            files_modified=data.get("files_modified", []),
            test_evidence=data.get("test_evidence", {}),
            error_code=data.get("error_code"),
            error_message=data.get("error_message"),
            started_at=float(data.get("started_at", time.time())),
            completed_at=float(data.get("completed_at", time.time())),
            protocol_version=data.get("protocol_version", "")
        )
        res.validate()
        return res
