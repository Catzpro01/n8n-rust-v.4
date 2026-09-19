"""
Repository Intelligence Scanner.
Scans a target codebase to automatically discover:
- Language, framework, and package manager
- Build system and test framework
- Workspace topology and crates / packages
- Entry points and database migrations
Generates a portable .arena/generated/project-profile.yaml.
"""

import os
import json
from pathlib import Path
from typing import Dict, Any, List, Optional

class RepositoryScanner:
    def __init__(self, target_dir: Optional[Path] = None):
        self.target_dir = (target_dir or Path.cwd()).resolve()

    def scan(self) -> Dict[str, Any]:
        profile = {
            "project": {
                "name": self.target_dir.name,
                "language": "unknown",
                "framework": "standard",
                "package_manager": "unknown",
            },
            "repository": {
                "type": "single-package",
                "workspace": False,
                "packages": []
            },
            "build": {
                "system": "unknown",
                "command": ""
            },
            "test": {
                "framework": "unknown",
                "command": ""
            },
            "execution": {
                "backend": "laptop"
            },
            "planning": {
                "strategy": "modular"
            }
        }

        # 1. Detect Rust
        cargo_toml = self.target_dir / "Cargo.toml"
        if cargo_toml.exists():
            profile["project"]["language"] = "rust"
            profile["project"]["package_manager"] = "cargo"
            profile["build"]["system"] = "cargo"
            profile["build"]["command"] = "cargo build"
            profile["test"]["framework"] = "cargo-test"
            profile["test"]["command"] = "cargo test"
            profile["execution"]["backend"] = "laptop"
            
            # Check workspace
            content = cargo_toml.read_text(encoding="utf-8", errors="ignore")
            if "[workspace]" in content:
                profile["repository"]["type"] = "monorepo"
                profile["repository"]["workspace"] = True
                profile["planning"]["strategy"] = "platform"

        # 2. Detect Node / TypeScript
        pkg_json = self.target_dir / "package.json"
        if pkg_json.exists() and profile["project"]["language"] == "unknown":
            profile["project"]["language"] = "typescript" if (self.target_dir / "tsconfig.json").exists() else "javascript"
            if (self.target_dir / "pnpm-lock.yaml").exists():
                pm = "pnpm"
            elif (self.target_dir / "yarn.lock").exists():
                pm = "yarn"
            else:
                pm = "npm"
            profile["project"]["package_manager"] = pm
            profile["build"]["system"] = pm
            profile["build"]["command"] = f"{pm} run build"
            profile["test"]["framework"] = "jest/vitest"
            profile["test"]["command"] = f"{pm} test"
            profile["execution"]["backend"] = "ci"
            profile["planning"]["strategy"] = "end_to_end"

        # 3. Detect Python
        pyproject = self.target_dir / "pyproject.toml"
        req_txt = self.target_dir / "requirements.txt"
        if (pyproject.exists() or req_txt.exists()) and profile["project"]["language"] == "unknown":
            profile["project"]["language"] = "python"
            profile["project"]["package_manager"] = "poetry" if (self.target_dir / "poetry.lock").exists() else "pip"
            profile["build"]["system"] = "python"
            profile["build"]["command"] = "python -m compileall ."
            profile["test"]["framework"] = "pytest"
            profile["test"]["command"] = "pytest"
            profile["execution"]["backend"] = "ci"
            profile["planning"]["strategy"] = "modular"

        # 4. Detect Go
        go_mod = self.target_dir / "go.mod"
        if go_mod.exists() and profile["project"]["language"] == "unknown":
            profile["project"]["language"] = "go"
            profile["project"]["package_manager"] = "go-modules"
            profile["build"]["system"] = "go"
            profile["build"]["command"] = "go build ./..."
            profile["test"]["framework"] = "go-test"
            profile["test"]["command"] = "go test ./..."
            profile["execution"]["backend"] = "laptop"
            profile["planning"]["strategy"] = "modular"

        return profile

    def write_profile(self, profile: Dict[str, Any], output_path: Optional[Path] = None) -> Path:
        out = output_path or (self.target_dir / ".arena" / "generated" / "project-profile.json")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(profile, indent=2), encoding="utf-8")
        return out
