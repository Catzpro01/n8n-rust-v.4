"""
Hard Boundary Enforcement Guard for Arena AI Tasks.
Ensures that Arena AI agents strictly modify ONLY the files declared in
their claimed task's `allowed_files` manifest. Any modification outside this boundary
aborts the commit transition and flags the task as BLOCKED.
"""

import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
from tools.orchestration.task_manifest_catalog import CANONICAL_TASKS

class BoundaryViolationError(Exception):
    pass

class TaskBoundaryGuard:
    def __init__(self, workspace_root: Optional[Path] = None):
        self.workspace_root = (workspace_root or Path(__file__).resolve().parent.parent.parent).resolve()
        self.task_manifest: Dict[str, dict] = {t["task_key"]: t for t in CANONICAL_TASKS}

    def get_task_spec(self, task_key: str) -> dict:
        spec = self.task_manifest.get(task_key)
        if not spec:
            raise KeyError(f"Task '{task_key}' not found in canonical task catalog")
        return spec

    def get_commit_modified_files(self, commit_sha: str) -> List[str]:
        """
        Retrieves the exact list of modified, added, or deleted files in a commit.
        """
        try:
            # git diff-tree --no-commit-id --name-only -r <commit_sha>
            res = subprocess.run(
                ["git", "diff-tree", "--no-commit-id", "--name-only", "-r", commit_sha],
                cwd=self.workspace_root,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=True
            )
            files = [line.strip().replace("\\", "/") for line in res.stdout.splitlines() if line.strip()]
            return files
        except Exception as e:
            raise RuntimeError(f"Failed to inspect commit '{commit_sha}': {e}")

    def validate_file_list(self, task_key: str, modified_files: List[str]) -> Tuple[bool, List[str]]:
        """
        Verifies that every file in modified_files is explicitly permitted by allowed_files.
        Returns (is_valid, list_of_violations).
        """
        spec = self.get_task_spec(task_key)
        allowed = {f.replace("\\", "/") for f in spec.get("allowed_files", [])}

        violations = []
        for mf in modified_files:
            clean_mf = mf.replace("\\", "/")
            # Also allow files under tests/ if task specifically is integration/validation,
            # otherwise strictly require exact match or allowed subtree
            matched = False
            for allowed_pattern in allowed:
                if clean_mf == allowed_pattern or clean_mf.startswith(allowed_pattern.rstrip("/*") + "/"):
                    matched = True
                    break
            if not matched:
                violations.append(clean_mf)

        return (len(violations) == 0, violations)

    def verify_commit_boundary(self, task_key: str, commit_sha: str) -> Tuple[bool, List[str]]:
        """
        End-to-end verification of a commit SHA against a task's allowed boundary.
        """
        modified = self.get_commit_modified_files(commit_sha)
        return self.validate_file_list(task_key, modified)
