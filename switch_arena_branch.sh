#!/bin/bash
SESSION_NAME=${1:-"session-$(date +%s)"}
NEW_BRANCH="arena-agent-1-$SESSION_NAME"
git checkout -b "$NEW_BRANCH" 2>/dev/null || git checkout "$NEW_BRANCH"
echo "[ARENA] Switched to branch: $NEW_BRANCH"
echo "[ARENA] Silakan catat progres kerja Anda di my_progress.md"
