"""
Arena Adapter Interface.
Abstract base class and default NO-OP / DISABLED implementation for Agent Arena execution.

SAFETY GUARANTEE:
Default implementation explicitly raises/returns DISABLED or NOT_ENABLED.
Does NOT spawn any processes, does NOT connect to external networks,
does NOT claim tasks or mutate state.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
from tools.orchestration.dispatch_contract import DispatchRequest, ResultResponse

class ArenaAdapter(ABC):
    """Abstract interface governing communication with Agent Arena execution engines."""

    @abstractmethod
    def create_session(self, worker_id: str, agent_key: str) -> Dict[str, Any]:
        """Initializes a new Agent Arena session context."""
        pass

    @abstractmethod
    def dispatch(self, request: DispatchRequest) -> Dict[str, Any]:
        """Dispatches a task specification to the Agent Arena session."""
        pass

    @abstractmethod
    def poll(self, dispatch_id: str) -> Dict[str, Any]:
        """Polls current status of dispatched task execution."""
        pass

    @abstractmethod
    def cancel(self, dispatch_id: str) -> Dict[str, Any]:
        """Cancels a currently active task execution in Agent Arena."""
        pass

    @abstractmethod
    def collect_result(self, dispatch_id: str) -> Optional[ResultResponse]:
        """Collects the execution result once complete."""
        pass

class DisabledArenaAdapter(ArenaAdapter):
    """
    Default safe implementation. All lifecycle methods return DISABLED status.
    Guarantees no real execution takes place until explicitly configured.
    """

    def create_session(self, worker_id: str, agent_key: str) -> Dict[str, Any]:
        return {
            "status": "DISABLED",
            "message": "ArenaAdapter is currently disabled in Phase C infrastructure"
        }

    def dispatch(self, request: DispatchRequest) -> Dict[str, Any]:
        return {
            "status": "NOT_ENABLED",
            "dispatch_id": request.dispatch_id,
            "message": "ArenaAdapter dispatch is disabled"
        }

    def poll(self, dispatch_id: str) -> Dict[str, Any]:
        return {
            "status": "NOT_ENABLED",
            "dispatch_id": dispatch_id,
            "message": "ArenaAdapter polling is disabled"
        }

    def cancel(self, dispatch_id: str) -> Dict[str, Any]:
        return {
            "status": "NOT_ENABLED",
            "dispatch_id": dispatch_id,
            "message": "ArenaAdapter cancel is disabled"
        }

    def collect_result(self, dispatch_id: str) -> Optional[ResultResponse]:
        return None

class ExternalFileTransportArenaAdapter(ArenaAdapter):
    """
    File-transport based adapter for real external Arena Agents.
    Operates via atomic JSON contracts on the local filesystem:
    - DISPATCH: .arena/dispatch/<worker_id>/<dispatch_id>.json
    - RESULT: .arena/results/<worker_id>/<dispatch_id>.result.json
    """
    def __init__(self, transport: Optional[Any] = None):
        from tools.orchestration.file_transport import AtomicFileTransport
        self.transport = transport or AtomicFileTransport()

    def create_session(self, worker_id: str, agent_key: str) -> Dict[str, Any]:
        return {
            "status": "READY",
            "worker_id": worker_id,
            "agent_key": agent_key,
            "transport": "file_transport"
        }

    def dispatch(self, request: DispatchRequest) -> Dict[str, Any]:
        path = self.transport.write_dispatch_request(request)
        return {
            "status": "DISPATCHED",
            "dispatch_id": request.dispatch_id,
            "file_path": str(path)
        }

    def poll(self, dispatch_id: str) -> Dict[str, Any]:
        return {
            "status": "AWAITING_RESULT",
            "dispatch_id": dispatch_id
        }

    def cancel(self, dispatch_id: str) -> Dict[str, Any]:
        return {
            "status": "CANCELLED",
            "dispatch_id": dispatch_id
        }

    def collect_result(self, dispatch_id: str) -> Optional[ResultResponse]:
        # Collect result if written by external worker
        for worker_dir in self.transport.results_base.glob("*"):
            if worker_dir.is_dir():
                res = self.transport.read_result_response(worker_dir.name, dispatch_id)
                if res:
                    return res
        return None
