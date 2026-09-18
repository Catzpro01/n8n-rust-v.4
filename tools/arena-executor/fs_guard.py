import os
import fnmatch
from pathlib import Path

class SecurityViolation(Exception):
    pass

class FilesystemGuard:
    def __init__(self, workspace_root: Path, allowed_patterns: list[str], forbidden_patterns: list[str]):
        self.workspace_root = workspace_root.resolve()
        self.allowed_patterns = allowed_patterns
        self.forbidden_patterns = forbidden_patterns

    def validate_path(self, target_path: str, is_write: bool = False) -> Path:
        """
        Validates target path against directory escape, symlink escape,
        and allowed/forbidden pattern whitelists. Fail closed.
        """
        raw_path = Path(target_path)
        
        # Prevent absolute paths outside workspace
        if raw_path.is_absolute():
            resolved = raw_path.resolve()
        else:
            resolved = (self.workspace_root / raw_path).resolve()

        # 1. Jail check: Must be inside workspace_root
        try:
            resolved.relative_to(self.workspace_root)
        except ValueError:
            raise SecurityViolation(f"Path traversal detected: '{target_path}' is outside workspace '{self.workspace_root}'")

        # 2. Symlink check: Real path must not escape workspace
        real_path = Path(os.path.realpath(str(resolved)))
        try:
            real_path.relative_to(self.workspace_root)
        except ValueError:
            raise SecurityViolation(f"Symlink escape detected: '{target_path}' resolves to '{real_path}'")

        # Calculate relative path from workspace root for pattern matching
        rel_str = str(resolved.relative_to(self.workspace_root)).replace("\\", "/")

        # 3. Global sensitive patterns (always forbidden)
        sensitive_patterns = [
            "*.env*", "*.key", "*.pem", "*.id_ed25519", "*.id_rsa", ".git/*", ".git"
        ]
        for pattern in sensitive_patterns:
            if fnmatch.fnmatch(rel_str, pattern) or fnmatch.fnmatch(resolved.name, pattern):
                raise SecurityViolation(f"Access to sensitive file '{rel_str}' is strictly blocked")

        # 4. Explicit forbidden patterns from LEGO contract
        for pattern in self.forbidden_patterns:
            clean_pat = pattern.rstrip("/*")
            if fnmatch.fnmatch(rel_str, pattern) or fnmatch.fnmatch(rel_str, f"{clean_pat}*"):
                raise SecurityViolation(f"Path '{rel_str}' matches forbidden pattern '{pattern}'")

        # 5. For writes, must match at least one allowed pattern
        if is_write:
            matched = False
            for pattern in self.allowed_patterns:
                clean_pat = pattern.rstrip("/*")
                if fnmatch.fnmatch(rel_str, pattern) or fnmatch.fnmatch(rel_str, f"{clean_pat}*") or rel_str.startswith(clean_pat):
                    matched = True
                    break
            if not matched:
                raise SecurityViolation(f"Write to '{rel_str}' rejected: does not match any allowed_paths: {self.allowed_patterns}")

        return resolved
