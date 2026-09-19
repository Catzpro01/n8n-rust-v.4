"""
Arena Project Adapter Interface.
Translates detected project profile into build commands, test commands,
file boundaries, and verification pipelines across different languages and runtimes.
"""

import os
from pathlib import Path
from typing import Dict, Any, List, Optional

class ProjectAdapter:
    def __init__(self, project_root: Optional[Path] = None):
        self.project_root = (project_root or Path(__file__).resolve().parents[2]).resolve()

    def get_build_command(self) -> List[str]:
        raise NotImplementedError

    def get_test_command(self) -> List[str]:
        raise NotImplementedError

    def get_clean_command(self) -> List[str]:
        raise NotImplementedError

class RustProjectAdapter(ProjectAdapter):
    def get_build_command(self) -> List[str]:
        return ["cargo", "build"]

    def get_test_command(self) -> List[str]:
        return ["cargo", "test"]

    def get_clean_command(self) -> List[str]:
        return ["cargo", "clean"]

class NodeProjectAdapter(ProjectAdapter):
    def __init__(self, project_root: Optional[Path] = None, package_manager: str = "npm"):
        super().__init__(project_root)
        self.pm = package_manager

    def get_build_command(self) -> List[str]:
        return [self.pm, "run", "build"]

    def get_test_command(self) -> List[str]:
        return [self.pm, "test"]

    def get_clean_command(self) -> List[str]:
        return [self.pm, "run", "clean"]

class PythonProjectAdapter(ProjectAdapter):
    def get_build_command(self) -> List[str]:
        return ["python", "-m", "compileall", "."]

    def get_test_command(self) -> List[str]:
        return ["pytest"]

    def get_clean_command(self) -> List[str]:
        return ["python", "-c", "import shutil; shutil.rmtree('.pytest_cache', ignore_errors=True)"]

class GoProjectAdapter(ProjectAdapter):
    def get_build_command(self) -> List[str]:
        return ["go", "build", "./..."]

    def get_test_command(self) -> List[str]:
        return ["go", "test", "./..."]

    def get_clean_command(self) -> List[str]:
        return ["go", "clean"]

def get_adapter_for_language(language: str, project_root: Optional[Path] = None) -> ProjectAdapter:
    lang = language.lower().strip()
    if lang == "rust":
        return RustProjectAdapter(project_root)
    elif lang in ("node", "typescript", "javascript"):
        return NodeProjectAdapter(project_root)
    elif lang == "python":
        return PythonProjectAdapter(project_root)
    elif lang == "go":
        return GoProjectAdapter(project_root)
    else:
        return RustProjectAdapter(project_root)
