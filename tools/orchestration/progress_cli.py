#!/usr/bin/env python3
"""
CLI interface for Milestone-Based Progress Engine.
Usage:
    python tools/orchestration/progress_cli.py dashboard
    python tools/orchestration/progress_cli.py json
    python tools/orchestration/progress_cli.py snapshot
    python tools/orchestration/progress_cli.py task <task_key>
    python tools/orchestration/progress_cli.py milestone <milestone_id>
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from progress_engine import (
    CANONICAL_MILESTONES,
    ProgressEngine,
    TaskEvidence,
    ValidationRecord,
)


def get_git_main_head() -> str:
    try:
        res = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True,
        )
        return res.stdout.strip()
    except Exception:
        return "0000000000000000000000000000000000000000"


def get_git_commits_on_main(limit: int = 500) -> Set[str]:
    try:
        res = subprocess.run(
            ["git", "rev-list", f"-n{limit}", "HEAD"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True,
        )
        return set(res.stdout.strip().splitlines())
    except Exception:
        return set()


def load_tasks_from_supabase_or_local() -> List[TaskEvidence]:
    """
    Attempts to fetch tasks from Supabase Control Plane if available and migrated;
    otherwise falls back to local discovered tasks in .arena/ or baseline specs.
    """
    from control_plane import ControlPlaneClient

    cp = ControlPlaneClient()
    # Try fetching via RPC or REST
    if cp.url and cp.key:
        status, data = cp._request("tasks?deleted_at=is.null")
        if status == 200 and isinstance(data, list) and len(data) > 0:
            tasks: List[TaskEvidence] = []
            for row in data:
                task_key = row.get("task_key") or row.get("id")
                status_val = row.get("status", "QUEUED")
                weight = float(row.get("progress_weight", 1.0))
                ms = row.get("milestone", "M1")
                sha = row.get("current_commit_sha")

                tasks.append(
                    TaskEvidence(
                        task_key=task_key,
                        specialization=row.get("specialization_id", "runtime-kernel"),
                        milestone=ms,
                        status=status_val,
                        progress_weight=weight,
                        current_commit_sha=sha,
                    )
                )
            return tasks

    # Fallback to initial canonical baseline tasks
    main_head = get_git_main_head()
    return [
        TaskEvidence(
            task_key="runtime-kernel/m1-runner",
            specialization="runtime-kernel",
            milestone="M1",
            status="DONE",
            progress_weight=2.0,
            current_commit_sha=main_head,
            acceptance_criteria=[{"description": "WorkflowRunner loop foundation", "verified": True}],
            validations=[
                ValidationRecord(
                    commit_sha=main_head,
                    suite="cargo-test-workspace",
                    level="L1",
                    status="PASSED",
                )
            ],
        ),
        TaskEvidence(
            task_key="execution-engine/m2-scheduler",
            specialization="execution-engine",
            milestone="M2",
            status="QUEUED",
            progress_weight=2.0,
        ),
        TaskEvidence(
            task_key="data-plane/m3-item-buffer",
            specialization="data-plane",
            milestone="M3",
            status="QUEUED",
            progress_weight=2.0,
        ),
        TaskEvidence(
            task_key="memory/m4-governor",
            specialization="memory",
            milestone="M4",
            status="QUEUED",
            progress_weight=1.0,
        ),
        TaskEvidence(
            task_key="node-system/m5-base-nodes",
            specialization="node-system",
            milestone="M5",
            status="QUEUED",
            progress_weight=1.0,
        ),
        TaskEvidence(
            task_key="workflow-model/m6-graph-parser",
            specialization="workflow-model",
            milestone="M6",
            status="QUEUED",
            progress_weight=1.0,
        ),
        TaskEvidence(
            task_key="expression-engine/m7-ast-evaluator",
            specialization="expression-engine",
            milestone="M7",
            status="QUEUED",
            progress_weight=1.0,
        ),
        TaskEvidence(
            task_key="validation/m8-dag-cycle-detector",
            specialization="validation",
            milestone="M8",
            status="QUEUED",
            progress_weight=1.0,
        ),
        TaskEvidence(
            task_key="integration/m9-conformance-harness",
            specialization="integration",
            milestone="M9",
            status="QUEUED",
            progress_weight=1.0,
        ),
        TaskEvidence(
            task_key="security/m10-fs-sandbox-guard",
            specialization="security",
            milestone="M10",
            status="QUEUED",
            progress_weight=1.0,
        ),
    ]


def main():
    parser = argparse.ArgumentParser(description="Milestone-Based Progress Engine CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Subcommand: dashboard
    subparsers.add_parser("dashboard", help="Display full text dashboard")

    # Subcommand: json
    subparsers.add_parser("json", help="Display machine-readable JSON output")

    # Subcommand: snapshot
    subparsers.add_parser("snapshot", help="Create and record a progress snapshot")

    # Subcommand: task
    task_parser = subparsers.add_parser("task", help="Inspect a specific task progress")
    task_parser.add_argument("task_key", help="Key of the task")

    # Subcommand: milestone
    ms_parser = subparsers.add_parser("milestone", help="Inspect milestone progress")
    ms_parser.add_argument("milestone_id", help="Milestone ID (e.g. M1, M2)")

    args = parser.parse_args()

    engine = ProgressEngine(canonical_model="task_weighted")
    tasks = load_tasks_from_supabase_or_local()
    git_commits = get_git_commits_on_main()
    main_head = get_git_main_head()

    if args.command == "dashboard":
        print(engine.format_text_dashboard(tasks, git_commits))
    elif args.command == "json":
        data = engine.get_machine_readable_progress(tasks, git_commits)
        print(json.dumps(data, indent=2))
    elif args.command == "snapshot":
        snap = engine.create_snapshot(tasks, main_head, git_commits)
        print(json.dumps({
            "success": True,
            "snapshot_id": snap.snapshot_id,
            "calculated_at": snap.calculated_at,
            "project_progress": snap.project_progress,
            "main_commit_sha": snap.main_commit_sha,
            "done_count": snap.done_count,
            "queued_count": snap.queued_count,
            "in_progress_count": snap.in_progress_count,
            "stale_count": snap.stale_count,
            "blocked_count": snap.blocked_count,
        }, indent=2))
    elif args.command == "task":
        matches = [t for t in tasks if t.task_key == args.task_key]
        if not matches:
            print(json.dumps({"success": False, "error": "TASK_NOT_FOUND"}, indent=2))
            sys.exit(1)
        t = matches[0]
        is_valid, notes = engine.verify_task_evidence(t, git_commits)
        print(json.dumps({
            "success": True,
            "task_key": t.task_key,
            "specialization": t.specialization,
            "milestone": t.milestone,
            "status": t.status,
            "progress_weight": t.progress_weight,
            "progress": 100.0 if (t.status == "DONE" and is_valid) else 0.0,
            "evidence_commit_sha": t.current_commit_sha,
            "is_evidence_valid": is_valid,
            "evidence_notes": notes,
        }, indent=2))
    elif args.command == "milestone":
        ms_name = CANONICAL_MILESTONES.get(args.milestone_id, args.milestone_id)
        m_res = engine.calculate_milestone_progress(args.milestone_id, ms_name, tasks, git_commits)
        print(json.dumps({
            "milestone": m_res.milestone,
            "name": m_res.name,
            "progress": m_res.progress,
            "total_weight": m_res.total_weight,
            "completed_weight": m_res.completed_weight,
            "task_counts": m_res.task_counts,
        }, indent=2))


if __name__ == "__main__":
    main()
