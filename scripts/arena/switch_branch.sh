#!/usr/bin/env bash
set -euo pipefail

AGENT_ID="${1:-${ARENA_AGENT_ID:-}}"
TASK_ID="${2:-${ARENA_TASK_ID:-}}"

if [[ -z "$AGENT_ID" ]]; then
    echo "ERROR: Missing agent ID. Usage: $0 <agent-id> [task-id]"
    exit 1
fi

if [[ -z "$TASK_ID" ]]; then
    TASK_ID="task-$(date +%s)"
fi

TARGET_BRANCH="arena/${AGENT_ID}/${TASK_ID}"

echo "[ArenaBranch] Switching to branch: ${TARGET_BRANCH}"
if git rev-parse --verify "${TARGET_BRANCH}" >/dev/null 2>&1; then
    git checkout "${TARGET_BRANCH}"
else
    git checkout -b "${TARGET_BRANCH}"
fi

echo "[ArenaBranch] Active branch: $(git branch --show-current)"
echo "[ArenaBranch] Workspace ready for ${AGENT_ID} on ${TASK_ID}"
