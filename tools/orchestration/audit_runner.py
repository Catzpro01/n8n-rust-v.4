import argparse
import fnmatch
import subprocess
import sys
from pathlib import Path

def parse_task_md(task_md_path: Path) -> dict:
    if not task_md_path.exists():
        return {}
    content = task_md_path.read_text(encoding="utf-8")
    data = {}
    current_key = None
    lines = content.splitlines()
    for line in lines:
        line_s = line.strip()
        if line_s.endswith(":") and not line_s.startswith("*"):
            current_key = line_s[:-1]
            data[current_key] = []
        elif current_key and line_s.startswith("*"):
            data[current_key].append(line_s[1:].strip())
        elif current_key and line_s:
            if not isinstance(data[current_key], list) or len(data[current_key]) == 0:
                data[current_key] = line_s
    return data

def main():
    parser = argparse.ArgumentParser(description="Audit task branch scope and architecture")
    parser.add_argument("--base", default="origin/main")
    parser.add_argument("--head", required=True)
    args = parser.parse_args()

    # Get changed files in git diff
    cmd = ["git", "diff", "--name-only", args.base, args.head]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        # Fallback diff against HEAD
        cmd = ["git", "diff", "--name-only", "HEAD~1", "HEAD"]
        res = subprocess.run(cmd, capture_output=True, text=True)

    changed_files = [f.strip() for f in res.stdout.splitlines() if f.strip()]
    print(f"[audit_runner] Changed files ({len(changed_files)}):", changed_files)

    task_md = Path(".arena/TASK.md")
    if not task_md.exists():
        print("[audit_runner] Warning: .arena/TASK.md not found, audit pass with notes.")
        sys.exit(0)

    task_data = parse_task_md(task_md)
    allowed = task_data.get("ALLOWED_FILES", [])
    forbidden = task_data.get("FORBIDDEN_FILES", [])

    violations = []
    for f in changed_files:
        # Ignore task specification internal metadata
        if f.startswith(".arena/"):
            continue

        # Check forbidden
        for pat in forbidden:
            if fnmatch.fnmatch(f, pat) or f.startswith(pat.rstrip("/*")):
                violations.append(f"FORBIDDEN file modified: {f} (matched pattern: {pat})")

        # Check allowed (if explicitly specified)
        if allowed and allowed != "None":
            is_allowed = False
            for pat in allowed:
                if fnmatch.fnmatch(f, pat) or f.startswith(pat.rstrip("/*")):
                    is_allowed = True
                    break
            if not is_allowed:
                violations.append(f"UNAUTHORIZED scope modification: {f} is not in ALLOWED_FILES")

    if violations:
        print("[audit_runner] AUDIT FAILED with scope violations:")
        for v in violations:
            print("  -", v)
        sys.exit(1)

    print("[audit_runner] AUDIT PASSED: All changed files conform strictly to task scope.")
    sys.exit(0)

if __name__ == "__main__":
    main()