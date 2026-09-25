#!/usr/bin/env python3
"""Post-merge verification & resource cleanup runner (``.github/workflows/cleanup.yml``).

Runs after a pull request into ``main`` was merged.  In order it

1. makes sure the merge commit is present locally **and** is an ancestor of
   ``<remote>/<main>`` -- even when ``main`` has advanced past it since the PR
   was merged.  A shallow checkout is deepened, the SHA is fetched explicitly
   and, as a last resort, the checkout is unshallowed; the runner never aborts
   just because the commit is behind the shallow boundary of a ``fetch-depth: 1``
   checkout,
2. optionally re-runs the post-merge verification (``cargo check`` /
   ``cargo test``; the workflow already runs them and passes ``--skip-tests``),
3. mirrors the task state into the legacy Supabase control plane when it is
   configured (best effort: under DEC-0017 git is the task authority, so a
   control-plane problem never blocks the cleanup),
4. deletes the PR head branch on the remote -- unless the branch is permanent
   (``main``, ``master``, ``arena-manager`` or an ``arena/agent-NN`` agent
   workspace, DEC-0017) or already gone.  Both cases exit ``0`` with a clear
   message; nothing else is ever deleted.

Exit codes: ``0`` success or clean skip, ``1`` failure (clear message, nothing
deleted), ``2`` usage error.

No secret is read from the command line, written to a file or printed.  Git
uses the credential the checkout already persisted; the control-plane client
receives ``SUPABASE_URL`` / ``SUPABASE_SERVICE_ROLE_KEY`` from the environment
and any text echoed from a subprocess passes through :func:`redact`.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from typing import Callable, Iterator, List, Mapping, Optional, Sequence, Tuple

try:  # the module is imported from tools/orchestration (script) or via pytest
    from control_plane import ControlPlaneClient
except ImportError:  # pragma: no cover - resolved on the second attempt below
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from control_plane import ControlPlaneClient

LOG_PREFIX = "[cleanup_runner]"

# Branches that are never deleted, whatever the PR head was.
PROTECTED_BRANCHES = frozenset({"main", "master", "arena-manager"})
# arena/agent-NN are permanent agent workspaces (DEC-0017).  Any number of digits
# is treated as permanent on purpose: refusing a deletion is recoverable, deleting
# a workspace is not.  Legacy per-task branches (arena/agent-01/TASK-0001) and
# Slice PR heads (arena/manager/<slice>) do not match and stay deletable.
AGENT_WORKSPACE_RE = re.compile(r"^arena/agent-\d+$")

SHA_RE = re.compile(r"^[0-9a-f]{7,40}$")
# How far a shallow checkout is deepened, step by step, before --unshallow.
DEEPEN_STEPS: Tuple[int, ...] = (50, 500)

# Outcomes of the branch-deletion step.
DELETED = "DELETED"
ALREADY_GONE = "ALREADY_GONE"
PROTECTED = "PROTECTED"
DRY_RUN = "DRY_RUN"

Runner = Callable[[Sequence[str]], subprocess.CompletedProcess]

_REDACTIONS = (
    (re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"), "***"),
    (re.compile(r"github_pat_[A-Za-z0-9_]{20,}"), "***"),
    (re.compile(r"sb_(?:secret|publishable)_[A-Za-z0-9_-]{10,}"), "***"),
    (re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"), "***"),
    (re.compile(r"(://)[^/\s@]+@"), r"\1***@"),  # user:token@host in URLs
    (re.compile(r"(?i)\b(authorization|bearer|apikey|api[-_]?key|token|password|secret)(\s*[:=]\s*)\S+"), r"\1\2***"),
)


class CleanupError(Exception):
    """A condition that stops the cleanup with a clear message (exit 1)."""


def redact(text: str) -> str:
    """Mask credential-shaped material before it reaches a log line."""
    for pattern, replacement in _REDACTIONS:
        text = pattern.sub(replacement, text)
    return text


def first_line(text: str) -> str:
    for line in (text or "").splitlines():
        if line.strip():
            return line.strip()
    return ""


def make_runner(cwd: Optional[str] = None, env: Optional[Mapping[str, str]] = None) -> Runner:
    """Return a subprocess runner; git never prompts for credentials."""
    merged = dict(os.environ)
    if env:
        merged.update(env)
    merged["GIT_TERMINAL_PROMPT"] = "0"

    def run(cmd: Sequence[str]) -> subprocess.CompletedProcess:
        return subprocess.run(list(cmd), cwd=cwd, env=merged, capture_output=True, text=True)

    return run


# ----------------------------------------------------------------- branch names

def normalize_branch(name: str, run: Optional[Runner] = None) -> str:
    """Strip whitespace and a ``refs/heads/`` prefix; reject invalid names."""
    branch = (name or "").strip()
    if branch.startswith("refs/heads/"):
        branch = branch[len("refs/heads/"):]
    if not branch:
        raise CleanupError("no head branch name given (--branch)")
    check = (run or make_runner())(["git", "check-ref-format", "--branch", branch])
    if check.returncode != 0:
        raise CleanupError(f"'{redact(branch)}' is not a valid branch name")
    return branch


def is_permanent_branch(name: str) -> bool:
    """True for main/master, arena-manager and every arena/agent-NN workspace."""
    branch = (name or "").strip()
    if branch.startswith("refs/heads/"):
        branch = branch[len("refs/heads/"):]
    return branch in PROTECTED_BRANCHES or bool(AGENT_WORKSPACE_RE.match(branch))


def validate_sha(sha: str) -> str:
    value = (sha or "").strip().lower()
    if not SHA_RE.match(value):
        raise CleanupError("merge SHA must be 7-40 hexadecimal characters (--merge-sha)")
    return value


# ------------------------------------------------------------------ git queries

def commit_exists(run: Runner, sha: str) -> bool:
    return run(["git", "cat-file", "-e", f"{sha}^{{commit}}"]).returncode == 0


def ref_exists(run: Runner, ref: str) -> bool:
    return run(["git", "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"]).returncode == 0


def is_ancestor(run: Runner, sha: str, ref: str) -> bool:
    return run(["git", "merge-base", "--is-ancestor", sha, ref]).returncode == 0


def is_shallow(run: Runner) -> bool:
    result = run(["git", "rev-parse", "--is-shallow-repository"])
    return result.returncode == 0 and result.stdout.strip() == "true"


def fetch_main(run: Runner, remote: str, main_branch: str, extra: Sequence[str] = ()) -> subprocess.CompletedProcess:
    """Fetch ``main`` into ``refs/remotes/<remote>/<main>`` with an explicit refspec."""
    refspec = f"+refs/heads/{main_branch}:refs/remotes/{remote}/{main_branch}"
    return run(["git", "fetch", "--no-tags", "--quiet", *extra, remote, refspec])


# ------------------------------------------------------- merge-commit recovery

def _recovery_attempts(run: Runner, sha: str, remote: str, main_branch: str) -> Iterator[Tuple[str, Callable[[], subprocess.CompletedProcess]]]:
    """Cheapest first.  Shallowness is re-checked lazily because an earlier step
    may already have completed the history (``--unshallow`` on a complete
    repository is an error)."""
    yield f"fetching {remote}/{main_branch}", lambda: fetch_main(run, remote, main_branch)
    for depth in DEEPEN_STEPS:
        if is_shallow(run):
            yield (f"deepening {remote}/{main_branch} by {depth} commits",
                   lambda d=depth: fetch_main(run, remote, main_branch, [f"--deepen={d}"]))
    yield f"fetching {sha} explicitly", lambda: run(["git", "fetch", "--no-tags", "--quiet", remote, sha])
    if is_shallow(run):
        yield f"unshallowing {remote}/{main_branch}", lambda: fetch_main(run, remote, main_branch, ["--unshallow"])


def ensure_merge_commit_on_main(run: Runner, sha: str, remote: str, main_branch: str, log: Callable[[str], None]) -> str:
    """Make ``sha`` available locally and prove it is on ``<remote>/<main>``.

    Returns a short description of how that was established; raises
    :class:`CleanupError` (with the reason) when it cannot be.
    """
    main_ref = f"refs/remotes/{remote}/{main_branch}"

    def verified() -> bool:
        return commit_exists(run, sha) and ref_exists(run, main_ref) and is_ancestor(run, sha, main_ref)

    if verified():
        return f"present in local history and on {main_ref}"

    log(f"merge commit {sha} is not in local history or not yet connected to {main_ref} "
        f"({main_branch} may have advanced past it, shallow={is_shallow(run)}); recovering")
    for label, action in _recovery_attempts(run, sha, remote, main_branch):
        result = action()
        if result.returncode != 0:
            log(f"{label}: git exited {result.returncode}: {redact(first_line(result.stderr))}")
        if verified():
            return f"verified after {label}"

    if not commit_exists(run, sha):
        raise CleanupError(f"merge commit {sha} does not exist on {remote}; nothing was deleted")
    raise CleanupError(f"merge commit {sha} exists but is not an ancestor of {main_ref} "
                       f"({main_branch} may have been rewritten); nothing was deleted")


# ---------------------------------------------------------------- verification

def run_verification(run: Runner, log: Callable[[str], None]) -> None:
    log("running post-merge verification (cargo check --workspace, cargo test -p n8n-workflow)")
    for cmd in (["cargo", "check", "--workspace"], ["cargo", "test", "-p", "n8n-workflow"]):
        result = run(cmd)
        if result.returncode != 0:
            raise CleanupError(f"post-merge verification failed: {' '.join(cmd)} exited {result.returncode}\n"
                               f"{redact(result.stderr.strip())}")
    log("post-merge verification: PASSED")


# ------------------------------------------------------------ branch deletion

def remote_branch_exists(run: Runner, remote: str, branch: str) -> Optional[bool]:
    """True / False, or None when the remote could not be queried."""
    result = run(["git", "ls-remote", "--exit-code", "--heads", remote, f"refs/heads/{branch}"])
    if result.returncode == 0:
        return True
    if result.returncode == 2:  # talked to the remote, no matching ref
        return False
    return None


def delete_head_branch(run: Runner, remote: str, branch: str, log: Callable[[str], None], dry_run: bool = False) -> str:
    """Delete the PR head branch; never a permanent one.  Returns the outcome."""
    if is_permanent_branch(branch):
        log(f"'{branch}' is a permanent branch (main, arena-manager or an arena/agent-NN workspace, DEC-0017); "
            "it is never deleted. SKIPPED.")
        log(f"::warning::cleanup skipped deleting permanent branch '{branch}'")
        return PROTECTED

    exists = remote_branch_exists(run, remote, branch)
    if exists is False:
        log(f"head branch '{branch}' no longer exists on {remote}; nothing to delete. OK.")
        return ALREADY_GONE
    if exists is None:
        log(f"could not query {remote} for '{branch}'; attempting the deletion anyway")
    if dry_run:
        log(f"DRY RUN: would delete '{branch}' on {remote}")
        return DRY_RUN

    result = run(["git", "push", remote, "--delete", f"refs/heads/{branch}"])
    if result.returncode == 0:
        log(f"remote branch '{branch}' deleted on {remote}.")
        return DELETED
    stderr = result.stderr or ""
    if "remote ref does not exist" in stderr or "deleting a non-existent ref" in stderr:
        log(f"head branch '{branch}' was already gone on {remote}. OK.")
        return ALREADY_GONE
    raise CleanupError(f"could not delete '{branch}' on {remote}: {redact(first_line(stderr)) or f'git exited {result.returncode}'}")


# ------------------------------------------------- legacy control plane (Supabase)

def build_control_plane():
    """Client for the legacy Supabase control plane, configured from the environment
    (the workflow passes the secret *names* as env references).  Values are never printed."""
    return ControlPlaneClient(url=os.environ.get("SUPABASE_URL") or None,
                              service_key=os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or None)


def sync_control_plane(client, branch: str, merge_sha: str, log: Callable[[str], None]) -> Optional[Callable[[], None]]:
    """Advance the legacy task state (MERGING -> POST_MERGE_VERIFY -> CLEANUP).

    Returns a callable that completes the cleanup once the branch is handled, or
    None when there is nothing to complete.  Best effort only (DEC-0017).
    """
    if client is None or not getattr(client, "url", None) or not getattr(client, "key", None):
        log("control plane not configured; skipped legacy state transition")
        return None
    task = client.get_task_by_key(branch)
    if not task:
        log(f"no control-plane task matches branch key '{branch}'; nothing to transition")
        return None
    task_id, status, version = task["id"], task["status"], task["version"]
    log(f"control-plane task {task_id} is '{status}' (v{version})")
    if status == "MERGING":
        code, res = client.record_merge(task_id, merge_sha, version)
        if code in (200, 204) and isinstance(res, dict) and res.get("success"):
            version, status = res.get("version", version + 1), "POST_MERGE_VERIFY"
            log(f"task {task_id} -> POST_MERGE_VERIFY (v{version})")
        else:
            log(f"record_merge not applied (status {code})")
    if status == "POST_MERGE_VERIFY":
        code, res = client.start_cleanup(task_id, version)
        if code in (200, 204) and isinstance(res, dict) and res.get("success"):
            version, status = res.get("version", version + 1), "CLEANUP"
            log(f"task {task_id} -> CLEANUP (v{version})")
        elif isinstance(res, dict) and res.get("action") == "ALREADY_COMPLETED":
            log(f"task {task_id} already completed in the control plane; continuing idempotently")
            return None
        else:
            log(f"start_cleanup not applied (status {code}); continuing without it")
            return None
    if status != "CLEANUP":
        return None

    def complete() -> None:
        code, res = client.complete_cleanup(task_id, version)
        if code in (200, 204) and isinstance(res, dict) and res.get("success"):
            log(f"task {task_id} COMPLETED in the control plane; locks released")
        else:
            log(f"complete_cleanup not applied (status {code})")

    return complete


# ------------------------------------------------------------------------ main

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Post-merge verification & resource cleanup runner")
    parser.add_argument("--branch", required=True, help="PR head branch to clean up")
    parser.add_argument("--merge-sha", required=True, help="merge commit SHA on main")
    parser.add_argument("--pr", default=None, help="PR number (log only)")
    parser.add_argument("--remote", default="origin", help="git remote (default: origin)")
    parser.add_argument("--main-branch", default="main", help="integration branch (default: main)")
    parser.add_argument("--skip-tests", action="store_true", help="do not re-run cargo check/test (the workflow step already did)")
    parser.add_argument("--dry-run", action="store_true", help="verify everything but do not delete the branch")
    return parser


def main(argv: Optional[List[str]] = None, *, cwd: Optional[str] = None, run: Optional[Runner] = None,
         control_plane_factory: Callable[[], object] = build_control_plane, out: Callable[[str], None] = print) -> int:
    args = build_parser().parse_args(argv)
    run = run or make_runner(cwd)

    def log(message: str) -> None:
        out(f"{LOG_PREFIX} {message}")

    try:
        branch = normalize_branch(args.branch, run)
        merge_sha = validate_sha(args.merge_sha)
        pr = f" (PR #{args.pr})" if args.pr else ""
        log(f"post-merge cleanup for head branch '{branch}'{pr}, merge commit {merge_sha[:12]}")

        how = ensure_merge_commit_on_main(run, merge_sha, args.remote, args.main_branch, log)
        log(f"merge commit {merge_sha[:12]}: {how}")

        if args.skip_tests:
            log("post-merge verification skipped (--skip-tests)")
        else:
            run_verification(run, log)

        complete = None
        try:
            complete = sync_control_plane(control_plane_factory(), branch, merge_sha, log)
        except Exception as exc:  # legacy layer: never blocks the cleanup
            log(f"control plane unavailable ({type(exc).__name__}: {redact(str(exc))}); continuing")

        outcome = delete_head_branch(run, args.remote, branch, log, dry_run=args.dry_run)

        if complete is not None:
            try:
                complete()
            except Exception as exc:
                log(f"control plane completion failed ({type(exc).__name__}: {redact(str(exc))})")

        log(f"cleanup finished: {outcome}")
        return 0
    except CleanupError as exc:
        log(f"ERROR: {exc}")
        log(f"::error::cleanup aborted: {first_line(str(exc))}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
