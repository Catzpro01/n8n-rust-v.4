import datetime
import json
import re
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

VALID_STATUSES = {
    "QUEUED",
    "CLAIMED",
    "IN_PROGRESS",
    "BLOCKED",
    "READY_TO_MERGE",
    "MERGED",
    "POST_MERGE_VERIFY",
    "DONE",
    "FAILED",
    "STALE",
    "INCONSISTENT",
}

STATUS_IN_PROGRESS_GROUP = {
    "IN_PROGRESS",
    "WORKING",
    "CLAIMED",
    "READY_TO_MERGE",
    "MERGED",
    "POST_MERGE_VERIFY",
}

VALID_SPECIALIZATIONS = {
    "runtime-kernel",
    "execution-engine",
    "data-plane",
    "memory",
    "node-system",
    "workflow-model",
    "expression-engine",
    "validation",
    "integration",
    "security",
}

CANONICAL_MILESTONES = {
    "M1": "Runtime Kernel",
    "M2": "Execution Engine",
    "M3": "Data Plane",
    "M4": "Memory",
    "M5": "Node System",
    "M6": "Workflow Model",
    "M7": "Expression Engine",
    "M8": "Validation",
    "M9": "Integration",
    "M10": "Security",
}


@dataclass
class ValidationRecord:
    commit_sha: str
    suite: str
    level: str  # L0, L1, L2, L3
    status: str  # PASSED, FAILED
    passed_count: int = 0
    failed_count: int = 0
    timestamp: str = ""


@dataclass
class TaskEvidence:
    task_key: str
    specialization: str
    milestone: str
    status: str
    progress_weight: float = 1.00
    validation_level: str = "L1"
    current_commit_sha: Optional[str] = None
    merge_commit_sha: Optional[str] = None
    acceptance_criteria: List[Dict[str, Any]] = field(default_factory=list)
    validations: List[ValidationRecord] = field(default_factory=list)
    timestamps: Dict[str, str] = field(default_factory=dict)


@dataclass
class TaskProgressResult:
    task_key: str
    milestone: str
    specialization: str
    status: str
    progress: float  # 100.0 if DONE with verified evidence, else 0.0
    progress_weight: float
    evidence_commit_sha: Optional[str]
    is_evidence_valid: bool
    evidence_notes: List[str]


@dataclass
class MilestoneProgressResult:
    milestone: str
    name: str
    progress: float
    total_weight: float
    completed_weight: float
    decomposition_status: str  # COMPLETE, PARTIAL, NOT_STARTED
    task_counts: Dict[str, int]
    tasks: List[TaskProgressResult] = field(default_factory=list)


@dataclass
class ProjectProgressResult:
    project_scope_status: str  # COMPLETE or INCOMPLETE
    registered_scope_progress: float
    project_scope_progress: Optional[float]  # None if PROJECT_SCOPE is INCOMPLETE
    project_progress: float  # Returns registered_scope_progress for backward compatibility
    total_weight: float
    completed_weight: float
    done_count: int
    in_progress_count: int
    queued_count: int
    blocked_count: int
    stale_count: int
    inconsistent_count: int
    registered_task_count: int
    project_scope_task_count: Optional[int]
    milestones: List[MilestoneProgressResult]
    tasks: List[TaskProgressResult]
    reconciliation_discrepancies: List[Dict[str, Any]] = field(default_factory=list)
    optional_analytical_milestone_weighted_progress: Optional[float] = None


@dataclass
class ProgressSnapshot:
    snapshot_id: str
    calculated_at: str
    main_commit_sha: str
    project_scope_status: str
    registered_scope_progress: float
    project_progress: float
    registered_task_count: int
    project_scope_task_count: Optional[int]
    done_count: int
    in_progress_count: int
    queued_count: int
    blocked_count: int
    stale_count: int
    inconsistent_count: int
    milestone_progress: List[Dict[str, Any]]
    metadata: Dict[str, Any] = field(default_factory=dict)


class ProgressEngine:
    """
    Milestone-Based Progress Engine for n8n-rust-v.4.
    Adheres strictly to the canonical contract:
    - Specialization != Agent != Branch != Workspace
    - Never calculates progress based on LOC, commit count, file count, or diff size.
    - Only status DONE with valid, fresh, verified evidence contributes to progress (100%).
    - Explicitly separates REGISTERED_TASK_SCOPE from canonical PROJECT_SCOPE.
    - If PROJECT_SCOPE is incomplete, displays 'PROJECT SCOPE: INCOMPLETE' and does not claim project completion.
    - Single Canonical Project Progress Formula:
        project_progress = sum(weight of DONE tasks) / sum(weight of all tasks in canonical PROJECT_SCOPE) * 100
    - Read-only calculations (concurrency safe).
    """

    def __init__(self, canonical_model: str = "task_weighted", expected_project_task_count: Optional[int] = None):
        """
        canonical_model:
          - 'task_weighted': Canonical model (single source of truth for project progress)
          - 'milestone_weighted': Optional analytical view for reporting only.
        expected_project_task_count: Expected total tasks in full project scope (if fully decomposed).
        """
        self.canonical_model = canonical_model
        self.expected_project_task_count = expected_project_task_count
        self.events_bus: List[Dict[str, Any]] = []

    def verify_task_evidence(
        self,
        task: TaskEvidence,
        git_commits_on_main: Optional[Set[str]] = None,
        main_head_sha: Optional[str] = None,
    ) -> Tuple[bool, List[str]]:
        """
        Validates whether a task's claim of completion has complete, non-stale evidence.
        Returns: (is_valid, notes)
        """
        notes = []

        if task.status != "DONE":
            return False, [f"Task status is '{task.status}', not 'DONE'"]

        # 1. current_commit_sha must exist and be valid SHA
        if not task.current_commit_sha or not re.match(r"^[0-9a-fA-F]{7,40}$", task.current_commit_sha):
            notes.append("Missing or invalid current_commit_sha")
            return False, notes

        # 2. Evidence of validation
        matching_validations = [
            v for v in task.validations
            if v.commit_sha == task.current_commit_sha and v.status == "PASSED"
        ]

        stale_validations = [
            v for v in task.validations
            if v.commit_sha != task.current_commit_sha
        ]

        if not matching_validations:
            if stale_validations:
                notes.append(f"Validation is STALE: validation for commit '{stale_validations[0].commit_sha}' does not match current_commit_sha '{task.current_commit_sha}'")
            else:
                notes.append("No PASSED validation record found for current_commit_sha")
            return False, notes

        # 3. Validation level check (must meet or exceed task.validation_level)
        level_order = {"L0": 0, "L1": 1, "L2": 2, "L3": 3}
        required_level_val = level_order.get(task.validation_level, 1)
        passed_levels = [level_order.get(v.level, 0) for v in matching_validations]
        if max(passed_levels) < required_level_val:
            notes.append(f"Required validation level '{task.validation_level}' not satisfied (highest passed: {max(passed_levels)})")
            return False, notes

        # 4. Acceptance criteria check
        if task.acceptance_criteria:
            for idx, criterion in enumerate(task.acceptance_criteria):
                if isinstance(criterion, dict):
                    if not criterion.get("verified", False) and criterion.get("status") != "PASSED":
                        notes.append(f"Acceptance criterion #{idx + 1} ('{criterion.get('description', 'unnamed')}') is not verified")
                        return False, notes

        # 5. Git Main presence check (if git_commits_on_main provided)
        if git_commits_on_main is not None:
            target_shas = {task.current_commit_sha}
            if task.merge_commit_sha:
                target_shas.add(task.merge_commit_sha)
            if not target_shas.intersection(git_commits_on_main):
                notes.append(f"Neither current_commit_sha '{task.current_commit_sha}' nor merge_commit_sha exists on main branch")
                return False, notes

        return True, ["Evidence verified and valid"]

    def determine_milestone_decomposition_status(self, milestone_id: str, tasks_in_milestone: List[TaskEvidence]) -> str:
        """
        Assesses whether a milestone has sufficient task decomposition for real implementation.
        - NOT_STARTED: 0 tasks registered
        - PARTIAL: 1-2 placeholder or initial tasks, but real production implementation requires full breakdown.
        - COMPLETE: Comprehensive multi-component task decomposition.
        """
        count = len(tasks_in_milestone)
        if count == 0:
            return "NOT_STARTED"
        elif count <= 2:
            return "PARTIAL"
        return "COMPLETE"

    def calculate_milestone_progress(
        self,
        milestone_id: str,
        milestone_name: str,
        tasks: List[TaskEvidence],
        git_commits_on_main: Optional[Set[str]] = None,
    ) -> MilestoneProgressResult:
        """
        Calculates progress for a single milestone.
        milestone_progress = sum(weight task yang DONE dan evidence valid) / sum(weight seluruh task milestone) * 100
        """
        m_tasks = [t for t in tasks if t.milestone == milestone_id]
        total_weight = sum(t.progress_weight for t in m_tasks)
        completed_weight = 0.0

        task_counts = {
            "done": 0,
            "in_progress": 0,
            "queued": 0,
            "blocked": 0,
            "stale": 0,
            "inconsistent": 0,
        }

        task_results: List[TaskProgressResult] = []

        for t in m_tasks:
            is_valid_done = False
            notes: List[str] = []

            if t.status == "DONE":
                is_valid, notes = self.verify_task_evidence(t, git_commits_on_main)
                if is_valid:
                    is_valid_done = True
                    completed_weight += t.progress_weight
                    task_counts["done"] += 1
                else:
                    task_counts["inconsistent"] += 1
                    task_counts["stale"] += 1
            elif t.status in STATUS_IN_PROGRESS_GROUP:
                task_counts["in_progress"] += 1
                notes.append(f"Task in progress: {t.status}")
            elif t.status in ("QUEUED", "BACKLOG"):
                task_counts["queued"] += 1
                notes.append("Task queued")
            elif t.status == "BLOCKED":
                task_counts["blocked"] += 1
                notes.append("Task blocked")
            elif t.status == "STALE":
                task_counts["stale"] += 1
                notes.append("Task stale")
            else:
                task_counts["queued"] += 1
                notes.append(f"Status {t.status}")

            progress_val = 100.0 if is_valid_done else 0.0

            task_results.append(TaskProgressResult(
                task_key=t.task_key,
                milestone=t.milestone,
                specialization=t.specialization,
                status=t.status if (t.status != "DONE" or is_valid_done) else "INCONSISTENT",
                progress=progress_val,
                progress_weight=t.progress_weight,
                evidence_commit_sha=t.current_commit_sha,
                is_evidence_valid=is_valid_done,
                evidence_notes=notes,
            ))

        pct = round((completed_weight / total_weight) * 100.0, 2) if total_weight > 0 else 0.0
        decomp_status = self.determine_milestone_decomposition_status(milestone_id, m_tasks)

        return MilestoneProgressResult(
            milestone=milestone_id,
            name=milestone_name,
            progress=pct,
            total_weight=round(total_weight, 2),
            completed_weight=round(completed_weight, 2),
            decomposition_status=decomp_status,
            task_counts=task_counts,
            tasks=task_results,
        )

    def calculate_project_progress(
        self,
        tasks: List[TaskEvidence],
        git_commits_on_main: Optional[Set[str]] = None,
        milestones_dict: Optional[Dict[str, str]] = None,
        milestone_weights: Optional[Dict[str, float]] = None,
        is_project_scope_complete: bool = False,
    ) -> ProjectProgressResult:
        """
        Calculates the canonical project progress with strict reality check:
        - registered_scope_progress: Progress calculated from currently registered task set.
        - project_scope_progress: None if project scope is INCOMPLETE, or percentage if complete.
        """
        m_dict = milestones_dict or CANONICAL_MILESTONES
        milestone_results: List[MilestoneProgressResult] = []
        all_task_results: List[TaskProgressResult] = []
        discrepancies: List[Dict[str, Any]] = []

        total_done_weight = 0.0
        total_registered_weight = 0.0

        done_count = 0
        in_progress_count = 0
        queued_count = 0
        blocked_count = 0
        stale_count = 0
        inconsistent_count = 0

        # Calculate per milestone
        for m_id, m_name in m_dict.items():
            m_res = self.calculate_milestone_progress(m_id, m_name, tasks, git_commits_on_main)
            milestone_results.append(m_res)
            all_task_results.extend(m_res.tasks)

            total_registered_weight += m_res.total_weight
            total_done_weight += m_res.completed_weight

            done_count += m_res.task_counts["done"]
            in_progress_count += m_res.task_counts["in_progress"]
            queued_count += m_res.task_counts["queued"]
            blocked_count += m_res.task_counts["blocked"]
            stale_count += m_res.task_counts["stale"]
            inconsistent_count += m_res.task_counts["inconsistent"]

            # Record discrepancies
            for tr in m_res.tasks:
                if tr.status == "INCONSISTENT" or (tr.status == "DONE" and not tr.is_evidence_valid):
                    discrepancies.append({
                        "task_key": tr.task_key,
                        "milestone": tr.milestone,
                        "status": "INCONSISTENT",
                        "claimed_status": "DONE",
                        "notes": tr.evidence_notes,
                    })

        # Calculate Registered Scope Progress
        registered_scope_progress = (
            round((total_done_weight / total_registered_weight) * 100.0, 2)
            if total_registered_weight > 0
            else 0.0
        )

        # Check project scope completeness
        any_partial = any(m.decomposition_status == "PARTIAL" for m in milestone_results)
        any_not_started = any(m.decomposition_status == "NOT_STARTED" for m in milestone_results)
        scope_status = "COMPLETE" if (is_project_scope_complete and not any_partial and not any_not_started) else "INCOMPLETE"

        project_scope_progress: Optional[float] = None
        if scope_status == "COMPLETE":
            project_scope_progress = registered_scope_progress

        # Optional Analytical View: Milestone-Weighted
        optional_milestone_weighted: Optional[float] = None
        if milestone_weights:
            sum_m_progress_times_weight = 0.0
            sum_m_weights = 0.0
            for m_res in milestone_results:
                mw = milestone_weights.get(m_res.milestone, 1.0)
                sum_m_progress_times_weight += m_res.progress * mw
                sum_m_weights += mw
            optional_milestone_weighted = (
                round(sum_m_progress_times_weight / sum_m_weights, 2)
                if sum_m_weights > 0
                else 0.0
            )

        return ProjectProgressResult(
            project_scope_status=scope_status,
            registered_scope_progress=registered_scope_progress,
            project_scope_progress=project_scope_progress,
            project_progress=registered_scope_progress,  # Preserved for backward compatibility
            total_weight=round(total_registered_weight, 2),
            completed_weight=round(total_done_weight, 2),
            done_count=done_count,
            in_progress_count=in_progress_count,
            queued_count=queued_count,
            blocked_count=blocked_count,
            stale_count=stale_count,
            inconsistent_count=inconsistent_count,
            registered_task_count=len(tasks),
            project_scope_task_count=self.expected_project_task_count,
            milestones=milestone_results,
            tasks=all_task_results,
            reconciliation_discrepancies=discrepancies,
            optional_analytical_milestone_weighted_progress=optional_milestone_weighted,
        )

    def create_snapshot(
        self,
        tasks: List[TaskEvidence],
        main_commit_sha: str,
        git_commits_on_main: Optional[Set[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        is_project_scope_complete: bool = False,
    ) -> ProgressSnapshot:
        """
        Creates a frozen, timestamped snapshot of project progress.
        """
        res = self.calculate_project_progress(tasks, git_commits_on_main, is_project_scope_complete=is_project_scope_complete)
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        snapshot_id = f"snap-{int(datetime.datetime.now(datetime.timezone.utc).timestamp())}"

        m_progress_json = [
            {
                "milestone": m.milestone,
                "name": m.name,
                "progress": m.progress,
                "total_weight": m.total_weight,
                "completed_weight": m.completed_weight,
                "decomposition_status": m.decomposition_status,
                "task_counts": m.task_counts,
            }
            for m in res.milestones
        ]

        snapshot = ProgressSnapshot(
            snapshot_id=snapshot_id,
            calculated_at=now_iso,
            main_commit_sha=main_commit_sha,
            project_scope_status=res.project_scope_status,
            registered_scope_progress=res.registered_scope_progress,
            project_progress=res.project_progress,
            registered_task_count=res.registered_task_count,
            project_scope_task_count=res.project_scope_task_count,
            done_count=res.done_count,
            in_progress_count=res.in_progress_count,
            queued_count=res.queued_count,
            blocked_count=res.blocked_count,
            stale_count=res.stale_count,
            inconsistent_count=res.inconsistent_count,
            milestone_progress=m_progress_json,
            metadata=metadata or {},
        )

        # Emit PROGRESS_UPDATED event
        self.events_bus.append({
            "event_id": f"evt-{snapshot_id}",
            "event_type": "PROGRESS_UPDATED",
            "source": "PROGRESS_ENGINE",
            "payload": {
                "snapshot_id": snapshot_id,
                "project_scope_status": res.project_scope_status,
                "registered_scope_progress": res.registered_scope_progress,
                "main_commit_sha": main_commit_sha,
                "calculated_at": now_iso,
            },
            "timestamp": now_iso,
        })

        return snapshot

    def get_machine_readable_progress(
        self,
        tasks: List[TaskEvidence],
        git_commits_on_main: Optional[Set[str]] = None,
        is_project_scope_complete: bool = False,
    ) -> Dict[str, Any]:
        """
        Produces the canonical machine-readable JSON structure.
        """
        res = self.calculate_project_progress(tasks, git_commits_on_main, is_project_scope_complete=is_project_scope_complete)
        return {
            "project_scope_status": res.project_scope_status,
            "registered_scope_progress": res.registered_scope_progress,
            "project_scope_progress": res.project_scope_progress,
            "project_progress": res.project_progress,
            "total_registered_weight": res.total_weight,
            "completed_weight": res.completed_weight,
            "registered_task_count": res.registered_task_count,
            "project_scope_task_count": res.project_scope_task_count,
            "counts": {
                "done": res.done_count,
                "in_progress": res.in_progress_count,
                "queued": res.queued_count,
                "blocked": res.blocked_count,
                "stale": res.stale_count,
                "inconsistent": res.inconsistent_count,
            },
            "milestones": [
                {
                    "milestone": m.milestone,
                    "name": m.name,
                    "progress": m.progress,
                    "decomposition_status": m.decomposition_status,
                    "total_weight": m.total_weight,
                    "completed_weight": m.completed_weight,
                    "task_counts": m.task_counts,
                }
                for m in res.milestones
            ],
            "tasks": [
                {
                    "task_key": t.task_key,
                    "milestone": t.milestone,
                    "specialization": t.specialization,
                    "status": t.status,
                    "progress": t.progress,
                    "evidence_commit_sha": t.evidence_commit_sha,
                    "is_evidence_valid": t.is_evidence_valid,
                }
                for t in res.tasks
            ],
            "discrepancies": res.reconciliation_discrepancies,
            "optional_analytical_milestone_weighted_progress": res.optional_analytical_milestone_weighted_progress,
        }

    def format_text_dashboard(
        self,
        tasks: List[TaskEvidence],
        git_commits_on_main: Optional[Set[str]] = None,
        is_project_scope_complete: bool = False,
    ) -> str:
        """
        Produces human-readable terminal dashboard with strict Reality Check.
        """
        res = self.calculate_project_progress(tasks, git_commits_on_main, is_project_scope_complete=is_project_scope_complete)
        lines = [
            "============================================================",
            "ARENA MILESTONE-BASED PROGRESS DASHBOARD (REALITY CHECK)",
            "============================================================",
            "PROJECT: n8n-rust-v4",
            f"PROJECT SCOPE: {res.project_scope_status}",
            f"REGISTERED TASK SCOPE PROGRESS : {res.registered_scope_progress}%",
            f"PROJECT COMPLETION PROGRESS    : " + (f"{res.project_scope_progress}%" if res.project_scope_progress is not None else "NOT AVAILABLE (Awaiting Full Project Decomposition)"),
            "",
            f"TASK COUNTS (REGISTERED SCOPE: {res.registered_task_count} tasks):",
            f"  DONE: {res.done_count}",
            f"  IN_PROGRESS: {res.in_progress_count}",
            f"  QUEUED: {res.queued_count}",
            f"  BLOCKED: {res.blocked_count}",
            f"  STALE: {res.stale_count}",
            f"  INCONSISTENT: {res.inconsistent_count}",
            "",
            "DECOMPOSITION STATUS PER MILESTONE:",
        ]

        for m in res.milestones:
            lines.append(f"  {m.milestone:4} {m.name:22} : [{m.decomposition_status}] {m.progress}% registered progress ({m.completed_weight}/{m.total_weight} weight)")

        return "\n".join(lines)
