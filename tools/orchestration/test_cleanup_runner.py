"""Unit tests for ``tools/orchestration/cleanup_runner.py`` (TASK-0018).

Run with ``python3 -m pytest -q tools/orchestration/test_cleanup_runner.py``
(``python3 -m unittest`` works too).

No network and no secrets are involved: every "remote" is a bare repository in
a temporary directory reached through ``file://`` (so ``--depth 1`` clones behave
like an ``actions/checkout`` ``fetch-depth: 1`` checkout), ``cargo`` is never
invoked (``--skip-tests``) and the Supabase control plane is replaced by
in-memory stubs.  ``HOME`` points at a scratch directory so no user git
configuration or credential helper can leak in.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from subprocess import CompletedProcess
from typing import Dict, List, Optional, Sequence, Tuple

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import cleanup_runner as cr  # noqa: E402


# ----------------------------------------------------------------- git fixture

def _git_env(home: Path) -> Dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith(("GIT_", "SUPABASE_"))}
    env.update({
        "HOME": str(home),
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_AUTHOR_NAME": "cleanup-test", "GIT_AUTHOR_EMAIL": "cleanup-test@example.invalid",
        "GIT_COMMITTER_NAME": "cleanup-test", "GIT_COMMITTER_EMAIL": "cleanup-test@example.invalid",
        "LANG": "C", "LC_ALL": "C",
    })
    return env


class GitFixture:
    """A bare ``origin`` with a linear ``main`` history plus named side branches."""

    SLICE = "arena/manager/P5-M04"
    PERMANENT = ("main", "arena-manager", "arena/agent-01", "arena/agent-10")

    def __init__(self, commits: int = 6):
        self.tmp = Path(tempfile.mkdtemp(prefix="cleanup-runner-"))
        self.env = _git_env(self.tmp / "home")
        (self.tmp / "home").mkdir()
        self.origin = self.tmp / "origin.git"
        self.url = self.origin.as_uri()
        self.work = self.tmp / "work"
        self.git(None, "init", "-q", "--bare", str(self.origin))
        self.git(self.origin, "symbolic-ref", "HEAD", "refs/heads/main")
        self.git(None, "init", "-q", str(self.work))
        self.git(self.work, "symbolic-ref", "HEAD", "refs/heads/main")
        self.git(self.work, "remote", "add", "origin", self.url)
        self.shas: List[str] = []
        self.commit(commits)
        # The Slice PR head and the permanent branches all point at main's tip.
        refspecs = [f"main:{b}" for b in (self.SLICE, "arena-manager", "arena/agent-01", "arena/agent-10")]
        self.git(self.work, "push", "-q", "origin", "main", *refspecs)

    def cleanup(self) -> None:
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    # -- helpers --------------------------------------------------------------
    def git(self, cwd: Optional[Path], *args: str) -> str:
        result = subprocess.run(["git", *args], cwd=str(cwd) if cwd else None, env=self.env,
                                capture_output=True, text=True)
        if result.returncode != 0:
            raise AssertionError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
        return result.stdout.strip()

    def commit(self, count: int, push: bool = False) -> List[str]:
        new = []
        for _ in range(count):
            n = len(self.shas) + 1
            self.git(self.work, "commit", "-q", "--allow-empty", "-m", f"c{n}")
            new.append(self.git(self.work, "rev-parse", "HEAD"))
        self.shas.extend(new)
        if push:
            self.git(self.work, "push", "-q", "origin", "main")
        return new

    def clone(self, name: str, depth: Optional[int] = None) -> Path:
        dest = self.tmp / name
        args = ["clone", "-q", "--branch", "main"]
        if depth:
            args += ["--depth", str(depth)]
        self.git(None, *args, self.url, str(dest))
        return dest

    def remote_heads(self) -> List[str]:
        out = self.git(self.origin, "for-each-ref", "--format=%(refname:short)", "refs/heads/")
        return sorted(out.splitlines())

    def runner(self, cwd: Path, extra_env: Optional[Dict[str, str]] = None) -> cr.Runner:
        env = dict(self.env)
        if extra_env:
            env.update(extra_env)
        return cr.make_runner(str(cwd), env=env)


class StubControlPlane:
    """Unconfigured control plane: the runner must skip it."""
    url = ""
    key = ""


class RecordingControlPlane:
    """A configured legacy control plane whose RPCs are recorded, not sent."""

    def __init__(self, status: str = "MERGING", start_response=None, fail: Optional[Exception] = None):
        self.url, self.key = "https://control-plane.invalid", "configured"
        self.status, self.calls = status, []
        self.start_response = start_response
        self.fail = fail

    def get_task_by_key(self, key):
        self.calls.append(("get_task_by_key", key))
        if self.fail:
            raise self.fail
        return {"id": "T-1", "status": self.status, "version": 3}

    def record_merge(self, task_id, sha, version):
        self.calls.append(("record_merge", task_id, sha, version))
        return 200, {"success": True, "version": version + 1}

    def start_cleanup(self, task_id, version):
        self.calls.append(("start_cleanup", task_id, version))
        return self.start_response or (200, {"success": True, "version": version + 1})

    def complete_cleanup(self, task_id, version):
        self.calls.append(("complete_cleanup", task_id, version))
        return 200, {"success": True}


class FakeGit:
    """Scripted ``git`` for pure unit tests.  ``rules`` map a command prefix to a
    ``CompletedProcess`` or to a callable producing one; unmatched commands succeed."""

    def __init__(self, rules: Sequence[Tuple[Tuple[str, ...], object]]):
        self.rules = list(rules)
        self.calls: List[List[str]] = []

    def __call__(self, cmd: Sequence[str]) -> CompletedProcess:
        cmd = list(cmd)
        self.calls.append(cmd)
        for prefix, response in self.rules:
            if tuple(cmd[:len(prefix)]) == prefix:
                return response(cmd) if callable(response) else response
        return CompletedProcess(cmd, 0, "", "")

    def saw(self, *prefix: str) -> bool:
        return any(tuple(c[:len(prefix)]) == prefix for c in self.calls)


def ok(out: str = "") -> CompletedProcess:
    return CompletedProcess([], 0, out, "")


def fail(rc: int = 1, err: str = "") -> CompletedProcess:
    return CompletedProcess([], rc, "", err)


def run_main(fx: GitFixture, cwd: Path, *args: str, control_plane=None, extra_env=None) -> Tuple[int, str]:
    lines: List[str] = []
    factory = (lambda: control_plane) if control_plane is not None else (lambda: StubControlPlane())
    code = cr.main(list(args) + ["--skip-tests"], run=fx.runner(cwd, extra_env), control_plane_factory=factory, out=lines.append)
    return code, "\n".join(lines)


# ------------------------------------------------------------ permanent names

class TestPermanentBranches(unittest.TestCase):
    def test_permanent_names_are_recognised(self):
        for name in ("main", "master", "arena-manager", "arena/agent-01", "arena/agent-05", "arena/agent-10",
                     "arena/agent-42", "refs/heads/arena/agent-03", " arena/agent-07 "):
            self.assertTrue(cr.is_permanent_branch(name), name)

    def test_task_and_slice_branches_stay_deletable(self):
        for name in ("arena/manager/P5-M04", "arena/manager/dec-0017-promote", "arena/agent-01/TASK-0001",
                     "arena/agent-", "arena/agentx-01", "arena/agent-01-old", "feature/x", "main-runtime", "mainline", ""):
            self.assertFalse(cr.is_permanent_branch(name), name)

    def test_normalize_strips_refs_heads_and_rejects_garbage(self):
        run = cr.make_runner()
        self.assertEqual(cr.normalize_branch("refs/heads/arena/manager/P5-M04", run), "arena/manager/P5-M04")
        self.assertEqual(cr.normalize_branch("  arena/agent-01\n", run), "arena/agent-01")
        for bad in ("", "   ", "bad name", "-x", "a..b", "x/"):
            with self.assertRaises(cr.CleanupError, msg=repr(bad)):
                cr.normalize_branch(bad, run)

    def test_validate_sha(self):
        self.assertEqual(cr.validate_sha(" ABCDEF1 "), "abcdef1")
        for bad in ("", "abc", "xyz1234", "abc;rm -rf", "0" * 41):
            with self.assertRaises(cr.CleanupError, msg=repr(bad)):
                cr.validate_sha(bad)


# ---------------------------------------------------------------- redaction

class TestRedaction(unittest.TestCase):
    def test_credential_shapes_are_masked(self):
        secrets = {
            "github app token in a URL": ("ghs_" + "a" * 36, "fatal: could not read from https://x-access-token:{s}@github.com/o/r"),
            "jwt (supabase key)": ("eyJ" + "a" * 20 + ".eyJ" + "b" * 20 + "." + "c" * 20, "Authorization: Bearer {s}"),
            "fine-grained pat": ("github_pat_" + "Z" * 30, "token={s}"),
            "supabase secret key": ("sb_secret_" + "k" * 20, "apikey: {s}"),
            "basic auth in a URL": ("hunter2", "error: failed to push to 'https://bot:{s}@example.invalid/r.git'"),
        }
        for label, (secret, template) in secrets.items():
            out = cr.redact(template.format(s=secret))
            self.assertNotIn(secret, out, label)
            self.assertIn("***", out, label)

    def test_ordinary_git_errors_are_untouched(self):
        for text in ("error: failed to push some refs to 'https://github.com/Catzpro01/n8n-rust-v.4.git'",
                     "fatal: Not a valid object name 0123abcd^{commit}",
                     "remote: warning: deleting a non-existent ref"):
            self.assertEqual(cr.redact(text), text)


# ------------------------------------------------ merge-commit recovery (git)

class TestMergeCommitRecovery(unittest.TestCase):
    def setUp(self):
        self.fx = GitFixture(commits=6)
        self.addCleanup(self.fx.cleanup)
        self.log: List[str] = []

    def ensure(self, cwd: Path, sha: str) -> str:
        return cr.ensure_merge_commit_on_main(self.fx.runner(cwd), sha, "origin", "main", self.log.append)

    def test_shallow_checkout_when_main_advanced_past_the_merge(self):
        # actions/checkout fetch-depth: 1 of main (tip c6); the PR merged as c4, then c5 and c6 landed.
        merge_sha = self.fx.shas[3]
        clone = self.fx.clone("shallow", depth=1)
        run = self.fx.runner(clone)
        self.assertTrue(cr.is_shallow(run))
        self.assertFalse(cr.commit_exists(run, merge_sha), "precondition: the merge commit is behind the shallow boundary")

        how = self.ensure(clone, merge_sha)

        self.assertIn("verified after deepening origin/main", how)
        self.assertTrue(cr.commit_exists(run, merge_sha))
        self.assertTrue(cr.is_ancestor(run, merge_sha, "refs/remotes/origin/main"))

    def test_shallow_checkout_falls_back_to_explicit_fetch_and_unshallow(self):
        merge_sha = self.fx.shas[1]
        clone = self.fx.clone("shallow-small-steps", depth=1)
        original = cr.DEEPEN_STEPS
        cr.DEEPEN_STEPS = (1,)
        self.addCleanup(setattr, cr, "DEEPEN_STEPS", original)

        how = self.ensure(clone, merge_sha)

        self.assertIn("verified after unshallowing origin/main", how)
        run = self.fx.runner(clone)
        self.assertFalse(cr.is_shallow(run))
        self.assertTrue(cr.is_ancestor(run, merge_sha, "refs/remotes/origin/main"))

    def test_complete_checkout_behind_the_remote_fetches_main(self):
        clone = self.fx.clone("full")
        merge_sha = self.fx.commit(2, push=True)[0]  # main advanced after the clone
        how = self.ensure(clone, merge_sha)
        self.assertEqual(how, "verified after fetching origin/main")

    def test_commit_already_present_needs_no_fetch(self):
        clone = self.fx.clone("full-current")
        how = self.ensure(clone, self.fx.shas[2])
        self.assertEqual(how, "present in local history and on refs/remotes/origin/main")
        self.assertEqual(self.log, [])

    def test_unknown_sha_is_a_clear_error(self):
        clone = self.fx.clone("shallow-unknown", depth=1)
        with self.assertRaises(cr.CleanupError) as ctx:
            self.ensure(clone, "0123456789abcdef0123456789abcdef01234567")
        self.assertIn("does not exist on origin", str(ctx.exception))
        self.assertIn("nothing was deleted", str(ctx.exception))

    def test_commit_that_is_not_on_main_is_refused(self):
        self.fx.git(self.fx.work, "checkout", "-q", "-b", "other")
        self.fx.git(self.fx.work, "commit", "-q", "--allow-empty", "-m", "not on main")
        stray = self.fx.git(self.fx.work, "rev-parse", "HEAD")
        self.fx.git(self.fx.work, "push", "-q", "origin", "other")
        clone = self.fx.clone("full-stray")
        with self.assertRaises(cr.CleanupError) as ctx:
            self.ensure(clone, stray)
        self.assertIn("not an ancestor of refs/remotes/origin/main", str(ctx.exception))

    def test_explicit_sha_fetch_is_tried_and_a_failing_fetch_is_not_fatal(self):
        sha = "f" * 40
        state = {"fetched": False}

        def cat_file(cmd):
            return ok() if state["fetched"] else fail(128, "fatal: Not a valid object name")

        def fetch(cmd):
            if cmd[-1] == sha:
                state["fetched"] = True
                return ok()
            return fail(128, "fatal: couldn't find remote ref (simulated)")

        git = FakeGit([
            (("git", "cat-file"), cat_file),
            (("git", "rev-parse", "--is-shallow-repository"), ok("false\n")),
            (("git", "rev-parse", "--verify"), ok()),
            (("git", "merge-base", "--is-ancestor"), lambda cmd: ok() if state["fetched"] else fail(1)),
            (("git", "fetch"), fetch),
        ])
        how = cr.ensure_merge_commit_on_main(git, sha, "origin", "main", self.log.append)
        self.assertEqual(how, f"verified after fetching {sha} explicitly")
        self.assertTrue(git.saw("git", "fetch", "--no-tags", "--quiet", "origin", sha))
        self.assertFalse(git.saw("git", "fetch", "--no-tags", "--quiet", "--deepen=50"), "not shallow: no deepening")
        self.assertTrue(any("fetching origin/main: git exited 128" in line for line in self.log))


# ------------------------------------------------------------- main flow (git)

class TestMainFlow(unittest.TestCase):
    def setUp(self):
        self.fx = GitFixture(commits=6)
        self.addCleanup(self.fx.cleanup)
        self.merge_sha = self.fx.shas[3]  # main advanced by two commits since the merge

    def test_deletes_the_slice_head_when_main_has_advanced(self):
        clone = self.fx.clone("shallow", depth=1)
        code, out = run_main(self.fx, clone, "--branch", GitFixture.SLICE, "--merge-sha", self.merge_sha, "--pr", "301")
        self.assertEqual(code, 0, out)
        self.assertIn("verified after deepening origin/main", out)
        self.assertIn("cleanup finished: DELETED", out)
        heads = self.fx.remote_heads()
        self.assertNotIn(GitFixture.SLICE, heads)
        for permanent in GitFixture.PERMANENT:
            self.assertIn(permanent, heads)

    def test_never_deletes_permanent_branches_whatever_the_head_was(self):
        clone = self.fx.clone("shallow", depth=1)
        before = self.fx.remote_heads()
        for head in ("main", "arena-manager", "arena/agent-01", "arena/agent-10", "refs/heads/arena/agent-01"):
            code, out = run_main(self.fx, clone, "--branch", head, "--merge-sha", self.merge_sha)
            self.assertEqual(code, 0, out)
            self.assertIn("is a permanent branch", out)
            self.assertIn("cleanup finished: PROTECTED", out)
            self.assertIn("::warning::", out)
            self.assertNotIn("deleted on origin", out)
        self.assertEqual(self.fx.remote_heads(), before)

    def test_head_branch_already_gone_exits_cleanly(self):
        self.fx.git(self.fx.work, "push", "-q", "origin", "--delete", GitFixture.SLICE)  # e.g. deleted by GitHub already
        clone = self.fx.clone("full")
        code, out = run_main(self.fx, clone, "--branch", GitFixture.SLICE, "--merge-sha", self.merge_sha)
        self.assertEqual(code, 0, out)
        self.assertIn(f"head branch '{GitFixture.SLICE}' no longer exists on origin; nothing to delete", out)
        self.assertIn("cleanup finished: ALREADY_GONE", out)

    def test_unknown_merge_sha_aborts_without_deleting(self):
        clone = self.fx.clone("shallow", depth=1)
        code, out = run_main(self.fx, clone, "--branch", GitFixture.SLICE, "--merge-sha", "0123456789abcdef0123456789abcdef01234567")
        self.assertEqual(code, 1)
        self.assertIn("does not exist on origin; nothing was deleted", out)
        self.assertIn("::error::", out)
        self.assertIn(GitFixture.SLICE, self.fx.remote_heads())

    def test_dry_run_keeps_the_branch(self):
        clone = self.fx.clone("full")
        code, out = run_main(self.fx, clone, "--branch", GitFixture.SLICE, "--merge-sha", self.merge_sha, "--dry-run")
        self.assertEqual(code, 0, out)
        self.assertIn("cleanup finished: DRY_RUN", out)
        self.assertIn(GitFixture.SLICE, self.fx.remote_heads())

    def test_invalid_inputs_exit_one_before_touching_the_remote(self):
        clone = self.fx.clone("full")
        for args in (("--branch", "bad name", "--merge-sha", self.merge_sha),
                     ("--branch", GitFixture.SLICE, "--merge-sha", "not-a-sha")):
            code, out = run_main(self.fx, clone, *args)
            self.assertEqual(code, 1, out)
            self.assertIn("ERROR:", out)
        with self.assertRaises(SystemExit) as ctx:
            cr.main(["--branch", "x"], run=self.fx.runner(clone), out=lambda _: None)
        self.assertEqual(ctx.exception.code, 2)
        self.assertIn(GitFixture.SLICE, self.fx.remote_heads())


# ------------------------------------------------ deletion edge cases (fakes)

class TestDeletionWithFakeGit(unittest.TestCase):
    def test_push_race_with_github_auto_delete_is_already_gone(self):
        git = FakeGit([
            (("git", "ls-remote"), ok("deadbeef\trefs/heads/arena/manager/P5-M04\n")),
            (("git", "push"), fail(1, "error: unable to delete 'arena/manager/P5-M04': remote ref does not exist\n"
                                     "error: failed to push some refs to 'https://github.com/o/r.git'")),
        ])
        log: List[str] = []
        self.assertEqual(cr.delete_head_branch(git, "origin", "arena/manager/P5-M04", log.append), cr.ALREADY_GONE)
        self.assertTrue(any("already gone" in line for line in log))

    def test_refused_deletion_is_an_error_with_a_redacted_message(self):
        token = "ghs_" + "Q" * 36
        git = FakeGit([
            (("git", "ls-remote"), ok("deadbeef\trefs/heads/arena/manager/P5-M04\n")),
            (("git", "push"), fail(1, f"remote: Permission denied for https://x-access-token:{token}@github.com/o/r.git\n"
                                     "error: failed to push some refs")),
        ])
        with self.assertRaises(cr.CleanupError) as ctx:
            cr.delete_head_branch(git, "origin", "arena/manager/P5-M04", lambda _: None)
        self.assertIn("could not delete", str(ctx.exception))
        self.assertNotIn(token, str(ctx.exception))

    def test_permanent_branch_never_reaches_git(self):
        git = FakeGit([])
        log: List[str] = []
        self.assertEqual(cr.delete_head_branch(git, "origin", "arena/agent-04", log.append), cr.PROTECTED)
        self.assertEqual(git.calls, [])

    def test_ls_remote_failure_still_attempts_the_delete(self):
        git = FakeGit([(("git", "ls-remote"), fail(128, "fatal: unable to access")), (("git", "push"), ok())])
        self.assertEqual(cr.delete_head_branch(git, "origin", "arena/manager/P5-M04", lambda _: None), cr.DELETED)
        self.assertTrue(git.saw("git", "push", "origin", "--delete", "refs/heads/arena/manager/P5-M04"))


# ------------------------------------------- legacy control plane (best effort)

class TestControlPlaneBestEffort(unittest.TestCase):
    def setUp(self):
        self.fx = GitFixture(commits=4)
        self.addCleanup(self.fx.cleanup)
        self.clone = self.fx.clone("full")
        self.merge_sha = self.fx.shas[-1]

    def test_unconfigured_control_plane_is_skipped(self):
        code, out = run_main(self.fx, self.clone, "--branch", GitFixture.SLICE, "--merge-sha", self.merge_sha)
        self.assertEqual(code, 0, out)
        self.assertIn("control plane not configured", out)
        self.assertNotIn(GitFixture.SLICE, self.fx.remote_heads())

    def test_legacy_transitions_wrap_the_deletion(self):
        plane = RecordingControlPlane(status="MERGING")
        code, out = run_main(self.fx, self.clone, "--branch", GitFixture.SLICE, "--merge-sha", self.merge_sha, control_plane=plane)
        self.assertEqual(code, 0, out)
        self.assertEqual([c[0] for c in plane.calls], ["get_task_by_key", "record_merge", "start_cleanup", "complete_cleanup"])
        self.assertEqual(plane.calls[1][2], self.merge_sha)
        self.assertNotIn(GitFixture.SLICE, self.fx.remote_heads())

    def test_already_completed_task_does_not_stop_the_cleanup(self):
        plane = RecordingControlPlane(status="POST_MERGE_VERIFY", start_response=(200, {"success": False, "action": "ALREADY_COMPLETED"}))
        code, out = run_main(self.fx, self.clone, "--branch", GitFixture.SLICE, "--merge-sha", self.merge_sha, control_plane=plane)
        self.assertEqual(code, 0, out)
        self.assertIn("already completed", out)
        self.assertNotIn("complete_cleanup", [c[0] for c in plane.calls])
        self.assertNotIn(GitFixture.SLICE, self.fx.remote_heads())

    def test_control_plane_failure_never_blocks_the_cleanup(self):
        plane = RecordingControlPlane(fail=RuntimeError("connection refused"))
        code, out = run_main(self.fx, self.clone, "--branch", GitFixture.SLICE, "--merge-sha", self.merge_sha, control_plane=plane)
        self.assertEqual(code, 0, out)
        self.assertIn("control plane unavailable (RuntimeError: connection refused)", out)
        self.assertNotIn(GitFixture.SLICE, self.fx.remote_heads())

    def test_build_control_plane_reads_env_without_printing_it(self):
        fake = {"SUPABASE_URL": "https://control-plane.invalid/", "SUPABASE_SERVICE_ROLE_KEY": "not-a-real-key-value"}
        saved = {k: os.environ.get(k) for k in fake}
        os.environ.update(fake)
        try:
            client = cr.build_control_plane()
        finally:
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        self.assertEqual(client.url, "https://control-plane.invalid")
        self.assertEqual(client.key, "not-a-real-key-value")
        # Nothing about the client is ever logged by the runner: the log lines only name the outcome.
        lines: List[str] = []
        cr.sync_control_plane(StubControlPlane(), "b", "0" * 40, lines.append)
        self.assertEqual(lines, ["control plane not configured; skipped legacy state transition"])


if __name__ == "__main__":
    unittest.main()
