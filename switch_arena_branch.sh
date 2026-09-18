#!/usr/bin/env bash
# Legacy wrapper for scripts/arena/switch_branch.sh
AGENT="${ARENA_AGENT_ID:-agent-01}"
TASK="${1:-session-$(date +%s)}"
exec "$(dirname "$0")/scripts/arena/switch_branch.sh" "$AGENT" "$TASK"
