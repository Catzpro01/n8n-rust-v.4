import os
import re
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional
from .control_plane import ControlPlaneClient

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
    "security"
}

BRANCH_REGEX = re.compile(r"^([a-z0-9\-]+)/([a-z0-9]+)-([a-z0-9\-]+)$")

def parse_and_validate_branch(branch_name: str) -> Dict[str, str]:
    m = BRANCH_REGEX.match(branch_name)
    if not m:
        raise ValueError(
            f"Invalid branch name '{branch_name}'. Format MUST be: <SPECIALIZATION>/<MILESTONE>-<TASK> "
            f"(e.g. 'runtime-kernel/m1-runner')"
        )
    specialization, milestone, task = m.groups()
    if specialization not in VALID_SPECIALIZATIONS:
        raise ValueError(
            f"Invalid specialization '{specialization}'. Must be one of: {sorted(list(VALID_SPECIALIZATIONS))}"
        )
    return {
        "specialization": specialization,
        "milestone": milestone,
        "task": task,
        "branch_name": branch_name
    }

def generate_task_markdown(
    task_id: str,
    specialization: str,
    milestone: str,
    task: str,
    objective: str,
    scope: List[str],
    allowed_files: List[str],
    forbidden_files: List[str],
    dependencies: List[str],
    acceptance_criteria: List[str],
    required_tests: List[str],
    audit_requirements: List[str],
    base_commit: str,
    branch_name: str,
    status: str = "QUEUED"
) -> str:
    def format_list(items: List[str]) -> str:
        if not items:
            return "None"
        return "\n".join(f"* {item}" for item in items)

    return f"""# TASK SPECIFICATION

TASK_ID:
{task_id}

SPECIALIZATION:
{specialization}

MILESTONE:
{milestone}

TASK:
{task}

OBJECTIVE:
{objective}

SCOPE:
{format_list(scope)}

ALLOWED_FILES:
{format_list(allowed_files)}

FORBIDDEN_FILES:
{format_list(forbidden_files)}

DEPENDENCIES:
{format_list(dependencies)}

ACCEPTANCE_CRITERIA:
{format_list(acceptance_criteria)}

REQUIRED_TESTS:
{format_list(required_tests)}

AUDIT_REQUIREMENTS:
{format_list(audit_requirements)}

BASE_COMMIT:
{base_commit}

BRANCH:
{branch_name}

STATUS:
{status}
"""

class TaskManager:
    def __init__(self, repo_root: Optional[Path] = None):
        self.repo_root = repo_root or Path(__file__).resolve().parents[2]
        self.client = ControlPlaneClient()

    def get_current_main_sha(self) -> str:
        cmd = ["git", "-C", str(self.repo_root), "rev-parse", "HEAD"]
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return res.stdout.strip()

    def create_task_branch(
        self,
        task_id: str,
        specialization: str,
        milestone: str,
        task_slug: str,
        objective: str,
        scope: List[str],
        allowed_files: List[str],
        forbidden_files: List[str],
        acceptance_criteria: List[str],
        required_tests: List[str],
        audit_requirements: List[str],
        dependencies: Optional[List[str]] = None,
        push_remote: bool = False
    ) -> Dict[str, Any]:
        branch_name = f"{specialization}/{milestone.lower()}-{task_slug.lower()}"
        meta = parse_and_validate_branch(branch_name)
        base_sha = self.get_current_main_sha()

        # 1. Create branch from current base_sha
        subprocess.run(["git", "-C", str(self.repo_root), "checkout", "-b", branch_name, base_sha], check=True)

        # 2. Write .arena/TASK.md
        arena_dir = self.repo_root / ".arena"
        arena_dir.mkdir(exist_ok=True)
        task_md_content = generate_task_markdown(
            task_id=task_id,
            specialization=specialization,
            milestone=milestone,
            task=task_slug,
            objective=objective,
            scope=scope,
            allowed_files=allowed_files,
            forbidden_files=forbidden_files,
            dependencies=dependencies or [],
            acceptance_criteria=acceptance_criteria,
            required_tests=required_tests,
            audit_requirements=audit_requirements,
            base_commit=base_sha,
            branch_name=branch_name,
            status="QUEUED"
        )
        task_file = arena_dir / "TASK.md"
        task_file.write_text(task_md_content, encoding="utf-8")

        # 3. Commit task specification
        subprocess.run(["git", "-C", str(self.repo_root), "add", ".arena/TASK.md", ".arena/AGENT_INSTRUCTIONS.md"], check=True)
        commit_msg = f"chore(arena): initialize task {task_id} ({branch_name})"
        subprocess.run(["git", "-C", str(self.repo_root), "commit", "-m", commit_msg], check=True)

        if push_remote:
            subprocess.run(["git", "-C", str(self.repo_root), "push", "-u", "origin", branch_name], check=True)

        # 4. Switch back to main to keep working tree clean
        subprocess.run(["git", "-C", str(self.repo_root), "checkout", "main"], check=True)

        return {
            "task_id": task_id,
            "branch_name": branch_name,
            "base_commit": base_sha,
            "status": "QUEUED"
        }