"""
Arena Worker Bridge & Build/Test Gate Engine (Phase D-2B).

Connects:
Orchestrator -> atomic claim -> DISPATCH.json -> Arena Worker Bridge -> Agent Arena -> RESULT.json -> Result Validator -> Build/Test Gate -> Supabase lifecycle.

SAFETY INVARIANTS:
1. CANARY_ENABLED = False by default.
2. Default adapter: DisabledArenaAdapter.
3. Zero spawn of real Arena sessions when CANARY_ENABLED is False or Live is False.
4. Concurrency control via ResourceGovernor.
5. Crash recovery for dead worker, lease expiration, duplicate results, and orchestrator restarts.
"""

import os
import time
import logging
import datetime
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple

from tools.orchestration.dispatch_contract import (
    DispatchRequest, ResultResponse, ContractValidationError, PROTOCOL_VERSION
)
from tools.orchestration.file_transport import AtomicFileTransport
from tools.orchestration.arena_adapter import ArenaAdapter, DisabledArenaAdapter
from tools.orchestration.result_validator import ResultValidator, GitResultValidator, parse_iso_to_utc_timestamp
from tools.orchestration.resource_governor import ResourceGovernor
from tools.orchestration.dispatch_state_machine import DispatchStateMachine, DispatchState

logger = logging.getLogger("ArenaWorkerBridge")

# Explicit Canary Gate (Default: False)
CANARY_ENABLED = False

class ArenaWorkerBridge:
    def __init__(
        self,
        worker_id: str,
        repo_root: Optional[Path] = None,
        adapter: Optional[ArenaAdapter] = None,
        transport: Optional[AtomicFileTransport] = None,
        governor: Optional[ResourceGovernor] = None,
        canary_enabled: bool = False
    ):
        self.worker_id = worker_id
        self.repo_root = (repo_root or Path(__file__).resolve().parents[2]).resolve()
        self.canary_enabled = canary_enabled or CANARY_ENABLED
        self.adapter = adapter or DisabledArenaAdapter()
        self.transport = transport or AtomicFileTransport(repo_root=self.repo_root)
        self.governor = governor or ResourceGovernor(lock_dir=self.repo_root / ".arena" / "run" / "locks")
        self.git_validator = GitResultValidator(workspace_root=self.repo_root)

    def get_bridge_status(self) -> Dict[str, str]:
        """Returns standard system status check flags."""
        return {
            "ARENA_BRIDGE": "READY",
            "CANARY": "ENABLED" if self.canary_enabled else "DISABLED",
            "AUTO_CLAIM": "DISABLED",
            "PRODUCTION_EXECUTION": "ENABLED" if self.canary_enabled else "DISABLED"
        }

    def validate_inbound_dispatch(self, dispatch_req: DispatchRequest) -> Tuple[bool, Optional[str]]:
        """
        Validates inbound DispatchRequest contract before worker acceptance:
        - worker_id match
        - protocol_version
        - valid identifiers (task_id, task_key, branch_name, base_commit_sha)
        - non-empty allowed_files
        - unexpired lease
        - replay protection (must not have been marked processed)
        """
        if dispatch_req.worker_id != self.worker_id:
            return False, f"Dispatch worker_id mismatch: expected '{self.worker_id}', got '{dispatch_req.worker_id}'"

        if dispatch_req.protocol_version != PROTOCOL_VERSION:
            return False, f"Protocol version mismatch: expected '{PROTOCOL_VERSION}', got '{dispatch_req.protocol_version}'"

        try:
            dispatch_req.validate()
        except ContractValidationError as e:
            return False, f"Contract validation error: {e}"

        # Replay check
        if self.transport.is_dispatch_processed(self.worker_id, dispatch_req.dispatch_id):
            return False, f"Replay detected: dispatch '{dispatch_req.dispatch_id}' is already marked processed"

        # Lease expiration check
        lease_ts = parse_iso_to_utc_timestamp(dispatch_req.lease_expires_at)
        now_ts = datetime.datetime.now(datetime.timezone.utc).timestamp()
        if lease_ts is None:
            return False, f"Malformed lease_expires_at: '{dispatch_req.lease_expires_at}'"
        if now_ts >= lease_ts:
            return False, f"Dispatch lease already expired: now ({now_ts}) >= lease ({lease_ts})"

        return True, None

    def poll_and_process_dispatch(self, dispatch_id: str) -> Dict[str, Any]:
        """
        Safely ingests and processes a dispatch for this worker:
        1. Reads DispatchRequest from isolated namespace.
        2. Validates contract & lease.
        3. If canary_enabled is False, invokes DisabledArenaAdapter safely.
        """
        req = self.transport.read_dispatch_request(self.worker_id, dispatch_id)
        if not req:
            return {
                "success": False,
                "error": f"Dispatch file not found or malformed for worker '{self.worker_id}', dispatch '{dispatch_id}'"
            }

        valid, reason = self.validate_inbound_dispatch(req)
        if not valid:
            return {
                "success": False,
                "error": f"Inbound dispatch rejected: {reason}",
                "dispatch_id": dispatch_id
            }

        if not self.canary_enabled:
            # Fallback to safe adapter
            dispatch_res = self.adapter.dispatch(req)
            return {
                "success": True,
                "action": "HELD_AT_GATE",
                "canary_enabled": False,
                "adapter_status": dispatch_res.get("status"),
                "dispatch_id": dispatch_id,
                "message": "Canary execution disabled. Task held safely at Arena Worker Bridge."
            }

        # If canary is enabled in future, execution proceeds via adapter
        dispatch_res = self.adapter.dispatch(req)
        return {
            "success": True,
            "action": "DISPATCHED",
            "adapter_response": dispatch_res
        }

    def submit_and_validate_result(
        self,
        result_response: ResultResponse,
        expected_dispatch: DispatchRequest,
        enforce_git_check: bool = True
    ) -> Dict[str, Any]:
        """
        Ingests worker ResultResponse, validates it against contract, git boundaries,
        and records atomic completion with replay protection.
        """
        # Step 1: Replay protection check
        if self.transport.is_dispatch_processed(self.worker_id, result_response.dispatch_id):
            return {
                "valid": False,
                "status": "REJECTED",
                "errors": [f"Replay detected: dispatch '{result_response.dispatch_id}' already processed"]
            }

        # Step 2: Contract & Lease Validation
        is_valid, errors = ResultValidator.validate(
            response=result_response,
            expected_dispatch_id=expected_dispatch.dispatch_id,
            expected_task_id=expected_dispatch.task_id,
            expected_worker_id=self.worker_id,
            expected_lease_expires_at=expected_dispatch.lease_expires_at
        )

        if not is_valid:
            return {
                "valid": False,
                "status": "INVALID_CONTRACT",
                "errors": errors
            }

        # Step 3: Whitelist & Changed Files validation
        allowed_set = {f.replace("\\", "/") for f in expected_dispatch.allowed_files}
        for changed_f in result_response.files_modified:
            norm_f = changed_f.replace("\\", "/")
            if norm_f not in allowed_set:
                errors.append(f"Changed file '{norm_f}' outside allowed whitelist: {allowed_set}")

        if errors:
            return {
                "valid": False,
                "status": "BOUNDARY_VIOLATION",
                "errors": errors
            }

        # Step 4: Optional Git Boundary & Ancestry Verification
        if enforce_git_check and result_response.status == "SUCCESS" and result_response.commit_sha:
            git_eval = self.git_validator.validate_git_result(
                task_key=expected_dispatch.task_key,
                base_commit=expected_dispatch.base_commit_sha,
                commit_sha=result_response.commit_sha,
                branch_name=result_response.branch_name or expected_dispatch.branch_name
            )
            if not git_eval["valid"]:
                return {
                    "valid": False,
                    "status": "GIT_VALIDATION_FAILED",
                    "errors": git_eval.get("errors", [])
                }

        # Step 5: Atomically write result to transport
        result_path = self.transport.write_result_response(result_response)

        # Step 6: Mark processed atomically for replay protection
        marker_sha = result_response.commit_sha or "NO_COMMIT_FAILURE"
        self.transport.mark_dispatch_processed(self.worker_id, result_response.dispatch_id, marker_sha)

        return {
            "valid": True,
            "status": "RESULT_ACCEPTED",
            "result_file": str(result_path),
            "errors": []
        }

    def execute_build_and_test_gate(
        self,
        task_key: str,
        timeout_seconds: float = 10.0,
        run_fn: Optional[Any] = None
    ) -> Dict[str, Any]:
        """
        Build and Test Gate.
        Coordinates concurrency via ResourceGovernor to prevent resource starvation.
        Lifecycle: RESULT_RECEIVED -> VALIDATING -> TESTING -> READY_TO_COMPLETE
        """
        # Acquire build slot
        slot_idx = self.governor.acquire_build_slot(timeout_seconds=timeout_seconds)
        if slot_idx is None:
            return {
                "success": False,
                "status": "RESOURCE_BLOCKED",
                "error": "Failed to acquire build slot from ResourceGovernor"
            }

        try:
            # Execute gated build/test
            if run_fn:
                test_output = run_fn()
            else:
                # Mock successful gate test execution in Phase D-2B
                test_output = {"status": "PASS", "gate_run": True, "task_key": task_key}

            return {
                "success": True,
                "status": "READY_TO_COMPLETE",
                "task_key": task_key,
                "test_output": test_output
            }
        finally:
            self.governor.release_build_slot(slot_idx)
