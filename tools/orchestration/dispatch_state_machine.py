"""
Deterministic Dispatch State Machine.
Defines in-memory transition states for task execution lifecycle:
IDLE -> DISPATCH_CREATED -> DISPATCHED -> RUNNING -> RESULT_RECEIVED -> VALIDATING -> [VALID / INVALID / FAILED / TIMEOUT / CANCELLED]

Pure in-memory state machine. Does NOT mutate Supabase task status.
"""

from enum import Enum
from typing import Dict, Set, Optional

class DispatchState(Enum):
    IDLE = "IDLE"
    DISPATCH_CREATED = "DISPATCH_CREATED"
    DISPATCHED = "DISPATCHED"
    RUNNING = "RUNNING"
    RESULT_RECEIVED = "RESULT_RECEIVED"
    VALIDATING = "VALIDATING"
    VALID = "VALID"
    INVALID = "INVALID"
    FAILED = "FAILED"
    TIMEOUT = "TIMEOUT"
    CANCELLED = "CANCELLED"

class DispatchStateMachine:
    VALID_TRANSITIONS: Dict[DispatchState, Set[DispatchState]] = {
        DispatchState.IDLE: {DispatchState.DISPATCH_CREATED},
        DispatchState.DISPATCH_CREATED: {DispatchState.DISPATCHED, DispatchState.CANCELLED},
        DispatchState.DISPATCHED: {DispatchState.RUNNING, DispatchState.TIMEOUT, DispatchState.CANCELLED},
        DispatchState.RUNNING: {DispatchState.RESULT_RECEIVED, DispatchState.FAILED, DispatchState.TIMEOUT, DispatchState.CANCELLED},
        DispatchState.RESULT_RECEIVED: {DispatchState.VALIDATING, DispatchState.CANCELLED},
        DispatchState.VALIDATING: {DispatchState.VALID, DispatchState.INVALID, DispatchState.FAILED},
        DispatchState.VALID: set(),       # Terminal
        DispatchState.INVALID: set(),     # Terminal
        DispatchState.FAILED: set(),      # Terminal
        DispatchState.TIMEOUT: set(),     # Terminal
        DispatchState.CANCELLED: set(),   # Terminal
    }

    def __init__(self, dispatch_id: str, initial_state: DispatchState = DispatchState.IDLE):
        self.dispatch_id = dispatch_id
        self._state = initial_state
        self._history = [(initial_state, "Initialization")]

    @property
    def current_state(self) -> DispatchState:
        return self._state

    def can_transition_to(self, new_state: DispatchState) -> bool:
        return new_state in self.VALID_TRANSITIONS.get(self._state, set())

    def transition_to(self, new_state: DispatchState, reason: Optional[str] = None) -> bool:
        """Transitions state if valid. Returns True if transition succeeded, False otherwise."""
        if not self.can_transition_to(new_state):
            return False
        self._state = new_state
        self._history.append((new_state, reason or ""))
        return True

    def get_history(self) -> list:
        return list(self._history)
