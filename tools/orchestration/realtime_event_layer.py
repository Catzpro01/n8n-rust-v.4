"""
Realtime Event Layer abstraction using Supabase Realtime Broadcast.
Provides asynchronous informational event propagation across the distributed workforce.
Events are informational only; state authority remains strictly with the Control Plane and OCC transactions.
"""

import json
import logging
import datetime
from typing import Dict, Any, Optional, Callable, List

logger = logging.getLogger(__name__)

class RealtimeEventLayer:
    """
    Realtime broadcast emitter and listener abstraction.
    Supports informational event propagation for workforce lifecycle:
    - agent.registered
    - agent.heartbeat
    - agent.available
    - agent.offline
    - task.queued
    - task.claimed
    - task.working
    - task.reclaimable
    - task.completed
    - dispatch.created
    - result.received
    - validation.failed
    - build.started
    - build.completed
    - test.started
    - test.completed
    """
    def __init__(self, channel_name: str = "orchestration_broadcast"):
        self.channel_name = channel_name
        self.subscribers: Dict[str, List[Callable[[Dict[str, Any]], None]]] = {}
        self.event_history: List[Dict[str, Any]] = []

    def emit(self, event_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Emits an informational event to the realtime broadcast channel.
        """
        envelope = {
            "event": event_type,
            "channel": self.channel_name,
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "payload": payload
        }
        self.event_history.append(envelope)
        logger.debug(f"[RealtimeEvent] Emitted {event_type}: {payload.get('task_id') or payload.get('agent_id')}")

        # Dispatch locally to in-process subscribers
        callbacks = self.subscribers.get(event_type, [])
        for cb in callbacks:
            try:
                cb(envelope)
            except Exception as e:
                logger.error(f"Error in realtime event subscriber callback for {event_type}: {e}")

        # Wildcard subscribers
        for cb in self.subscribers.get("*", []):
            try:
                cb(envelope)
            except Exception as e:
                logger.error(f"Error in wildcard realtime subscriber: {e}")

        return envelope

    def subscribe(self, event_type: str, callback: Callable[[Dict[str, Any]], None]):
        """
        Subscribes a listener to a specific event type or '*' for all events.
        """
        if event_type not in self.subscribers:
            self.subscribers[event_type] = []
        self.subscribers[event_type].append(callback)

    def clear(self):
        self.event_history.clear()
        self.subscribers.clear()
