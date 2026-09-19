"""
Workspace Filesystem Sandbox Boundary Guard
===========================================

Task   : ``security/m10-fs-sandbox`` (Milestone M10 — Security & Sandbox)
Owner  : agent-05 (security specialization)
Boundary (allowed_files / exclusive_files): ``tools/arena-executor/fs_guard.py`` ONLY.

Security model (STRICT FAIL-CLOSED)
-----------------------------------
``FilesystemGuard.validate_path`` is the single choke point every filesystem
path used by the Arena executor must pass through. A path is only accepted
when the guard can *positively certify* it as safe; any doubt is a rejection
(``SecurityError``). Concretely, in order:

1.  **Input sanity** — the input must be a non-empty ``str`` without NUL
    bytes or control characters, within sane length/depth limits. Anything
    else (``None``, ``int``, ``Path`` objects, ...) is rejected. Unexpected
    internal errors (e.g. ``OSError`` from a symlink loop during resolution)
    are converted into ``SecurityError`` — validation never fails open.
2.  **Jail containment** — the path is canonicalised with ``Path.resolve()``
    *and* re-checked with ``os.path.realpath()`` (defence in depth) and must
    land inside ``workspace_root``. Directory escapes via ``..`` (absolute or
    relative), absolute paths outside the workspace, and symlink escapes
    (direct, nested, or chained) are all rejected.
3.  **Workspace-root write deny** — writes may never target the workspace
    root directory itself.
4.  **Sensitive patterns** — credential material (``*.env*``, ``*.key``,
    ``*.pem``, ``*.id_ed25519``, ``*.id_rsa``, ``*.secret`` and the canonical
    SSH private-key names ``id_rsa``/``id_ed25519``/``id_ecdsa``/``id_dsa``)
    is denied by basename at any depth, and any path containing a ``.git``
    *component* (at any depth, not only the top level) is denied for both
    reads and writes.
5.  **Forbidden patterns** — the Sub-LEGO ``forbidden_paths`` denylist is
    enforced with the legacy (deliberately over-broad) matching, never
    weakened.
6.  **Write allowlist** — writes additionally require the canonical relative
    path to match at least one ``allowed_paths`` pattern using
    boundary-safe semantics: a pattern ``a/b`` or ``a/b/**`` permits exactly
    ``a/b`` and everything *under* ``a/b/`` — it can never be satisfied by a
    sibling such as ``a/b-evil`` (fixes the former prefix-matching hole).
    An empty allowlist denies every write.

``is_write`` defaults to ``True`` (deny-by-default): callers that do not
state their intent receive the *stricter* policy. Read-only validation must
pass ``is_write=False`` explicitly.

Pattern semantics
-----------------
Matching uses ``fnmatch`` on the canonical, forward-slash relative path, so
``*`` crosses ``/`` boundaries (legacy behaviour, kept for compatibility).
On top of that, directory-subtree matching requires an exact component
boundary (``rel == clean`` or ``rel.startswith(clean + "/")``).

Residual risks (documented, NOT solvable at this layer — see
``.arena/bootstrap/SECURITY_GAPS.md`` and the M10 progress record):
    * TOCTOU: a symlink can be swapped between ``validate_path`` and the
      actual filesystem operation. Callers MUST use the resolved path
      returned by this method (the executor does) and must not re-derive
      paths from raw input.
    * Hard links pointing outside the workspace cannot be detected by path
      validation (requires OS-level isolation — GAP-01).
    * POSIX path lookups are byte-exact; no Unicode normalisation tricks
      apply, but the guard assumes POSIX separator semantics for its
      jail invariants. No shell is ever involved, so ``~`` and glob
      expansion never occur inside this guard.

Self-test
---------
Run ``python3 tools/arena-executor/fs_guard.py`` to execute the embedded M10
security regression suite (path traversal, boundary paths, absolute/relative
paths, symlink escapes, sensitive/forbidden patterns, write-allowlist
enforcement, and invalid-input cases). It is dependency-free (stdlib only)
and portable across POSIX and Windows runners.
"""

import fnmatch
import os
from pathlib import Path

# Hard fail-closed limits for untrusted path input.
MAX_PATH_INPUT_LENGTH = 4096  # PATH_MAX on Linux
MAX_PATH_COMPONENTS = 512
MAX_PATTERN_COUNT = 4096


class SecurityError(Exception):
    """
    Raised when a path (or guard configuration) cannot be certified as safe.

    This is the canonical exception of the filesystem sandbox (the M10
    acceptance criteria name it ``SecurityError``). The historical name
    ``SecurityViolation`` is kept as an alias below so every existing caller
    (``executor.py``, ``cli.py``, ``tests/arena/*``) keeps working unchanged.
    """


# Backward-compatible alias: both names refer to the SAME class object, so
# `except SecurityViolation` still catches everything the guard raises.
SecurityViolation = SecurityError

# Globally sensitive basenames — always denied (reads and writes), any depth.
# Aligned with the strict subset of `.arena/policies/sensitive-paths.yaml`
# that is safe to enforce inside executor workspaces. (The policy's `*token*`
# pattern is intentionally NOT enforced here: it would over-block legitimate
# source files such as `token.rs`; see progress record for the divergence.)
# The exact SSH private-key names (`id_rsa`, ...) are listed because the
# `*.id_rsa`-style patterns do NOT match the canonical key filenames (they
# have no dot prefix) — a pre-existing gap uncovered by the M10 audit.
SENSITIVE_BASENAME_PATTERNS = (
    "*.env*",
    "*.key",
    "*.pem",
    "*.id_ed25519",
    "*.id_rsa",
    "*.secret",
    "id_rsa",
    "id_ed25519",
    "id_ecdsa",
    "id_dsa",
)

# Path components that are denied wherever they appear (any depth).
SENSITIVE_COMPONENT_NAMES = (".git",)


def _reject(msg: str) -> "SecurityError":
    """Helper so every failure path returns (rather than raises) a fully
    constructed SecurityError. Callers do `raise _reject(...)`. Exists to
    keep stack traces pointing at the raiser."""
    return SecurityError(msg)


class FilesystemGuard:
    """
    Fail-closed filesystem sandbox jail for one agent workspace.

    Parameters
    ----------
    workspace_root:
        The jail root. ``str`` or ``os.PathLike``. Must not be empty, must
        not resolve to the filesystem root, and must be resolvable.
    allowed_patterns:
        ``forbidden``-complementary write allowlist (Sub-LEGO
        ``allowed_paths``). Empty list => all writes denied (fail-closed).
    forbidden_patterns:
        Sub-LEGO ``forbidden_paths`` denylist applied to reads and writes.
        May be empty.
    """

    def __init__(self, workspace_root, allowed_patterns, forbidden_patterns):
        # ---- Configuration validation (fail-closed on bad config) -------
        try:
            root_str = os.fspath(workspace_root)
        except TypeError as exc:
            raise SecurityError(
                f"Invalid workspace_root type {type(workspace_root).__name__}: "
                f"expected str or PathLike (fail-closed): {exc}"
            ) from exc
        if not isinstance(root_str, str) or not root_str.strip():
            raise SecurityError(
                "workspace_root must be a non-empty path string (fail-closed)"
            )
        if "\x00" in root_str:
            raise SecurityError("workspace_root contains NUL byte (fail-closed)")

        self.allowed_patterns = self._validate_patterns(allowed_patterns, "allowed_patterns")
        self.forbidden_patterns = self._validate_patterns(forbidden_patterns, "forbidden_patterns")

        try:
            self.workspace_root = Path(root_str).resolve()
        except OSError as exc:
            raise SecurityError(
                f"workspace_root '{root_str}' could not be resolved (fail-closed): {exc}"
            ) from exc

        # A jail anchored at the filesystem root is a misconfiguration that
        # would silently permit everything — reject it.
        if str(self.workspace_root) == self.workspace_root.anchor:
            raise SecurityError(
                "workspace_root must not be the filesystem root (fail-closed)"
            )

    # ------------------------------------------------------------------
    # Configuration helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _validate_patterns(patterns, label: str) -> "list[str]":
        if patterns is None:
            raise SecurityError(f"{label} must be a list of strings, got None (fail-closed)")
        if isinstance(patterns, (str, bytes)) or not isinstance(patterns, (list, tuple)):
            raise SecurityError(
                f"{label} must be a list of strings, got {type(patterns).__name__} (fail-closed)"
            )
        if len(patterns) > MAX_PATTERN_COUNT:
            raise SecurityError(f"{label} exceeds {MAX_PATTERN_COUNT} entries (fail-closed)")
        cleaned: "list[str]" = []
        for pattern in patterns:
            if not isinstance(pattern, str):
                raise SecurityError(
                    f"{label} entries must be str, got {type(pattern).__name__} (fail-closed)"
                )
            if not pattern.strip():
                raise SecurityError(f"{label} contains an empty pattern (fail-closed)")
            if "\x00" in pattern:
                raise SecurityError(f"{label} contains a NUL byte (fail-closed)")
            cleaned.append(pattern)
        return cleaned

    # ------------------------------------------------------------------
    # Pattern matching
    # ------------------------------------------------------------------
    @staticmethod
    def _clean_dir(pattern: str) -> str:
        """Strip trailing '/', '*', '**' so the remainder denotes a directory."""
        return pattern.rstrip("/*")

    @classmethod
    def _matches_allowed(cls, rel: str, pattern: str) -> bool:
        """
        Boundary-safe allowlist match for WRITES.

        True when either:
          * ``fnmatch(rel, pattern)`` (legacy glob semantics — ``*`` crosses
            ``/``), or
          * ``rel`` is exactly the pattern's directory prefix, or lies
            strictly beneath it (``rel == clean`` or
            ``rel.startswith(clean + "/")``).

        The former ``rel.startswith(clean)`` / ``fnmatch(rel, clean + "*")``
        forms permitted sibling escapes (pattern ``src`` also allowed
        ``src-evil/...``) and were removed as a security hardening. This can
        only ever reject *more* writes than the legacy matcher.
        """
        if fnmatch.fnmatch(rel, pattern):
            return True
        clean = cls._clean_dir(pattern)
        if clean and (rel == clean or rel.startswith(clean + "/")):
            return True
        return False

    @classmethod
    def _matches_forbidden(cls, rel: str, pattern: str) -> bool:
        """
        Denylist match (reads and writes). Superset of the legacy matcher:
        keeps the intentionally over-broad ``fnmatch(rel, clean + "*")`` form
        (e.g. forbidding ``.git/**`` also blocks ``.gitignore``-style names —
        over-blocking is the fail-closed direction) and adds the exact
        component-boundary directory match.
        """
        if fnmatch.fnmatch(rel, pattern):
            return True
        clean = cls._clean_dir(pattern)
        if not clean:
            return False
        if fnmatch.fnmatch(rel, clean + "*"):
            return True
        if rel == clean or rel.startswith(clean + "/"):
            return True
        return False

    # ------------------------------------------------------------------
    # Core validation
    # ------------------------------------------------------------------
    def validate_path(self, target_path: str, is_write: bool = True) -> Path:
        """
        Validate ``target_path`` against the sandbox policy and return the
        fully resolved, jail-canonical path the caller MUST use afterwards.

        Fail-closed: if the guard cannot positively certify the path as
        safe — including when an unexpected internal error occurs — a
        ``SecurityError`` (alias ``SecurityViolation``) is raised and the
        operation must be treated as denied.

        ``is_write`` defaults to ``True`` (deny-by-default). Pass
        ``is_write=False`` explicitly for read validation, which skips the
        write allowlist but still enforces the jail, sensitive patterns and
        forbidden patterns.
        """
        try:
            return self._validate_path(target_path, is_write)
        except SecurityError:
            raise
        except Exception as exc:  # noqa: BLE001 — deliberate fail-closed catch-all
            raise SecurityError(
                f"Fail-closed: unable to certify {repr(target_path)[:120]!s} as safe "
                f"({type(exc).__name__}: {exc})"
            ) from exc

    def _validate_path(self, target_path, is_write: bool) -> Path:
        # ---- 1. Input sanity (fail-closed) ------------------------------
        if not isinstance(target_path, str):
            raise _reject(
                f"Invalid path type {type(target_path).__name__}: expected str (fail-closed)"
            )
        if not target_path or not target_path.strip():
            raise _reject("Empty or whitespace-only path rejected (fail-closed)")
        if "\x00" in target_path:
            raise _reject("Path contains NUL byte (fail-closed)")
        if any(ord(ch) < 32 or ord(ch) == 127 for ch in target_path):
            raise _reject("Path contains control characters (fail-closed)")
        if len(target_path) > MAX_PATH_INPUT_LENGTH:
            raise _reject(
                f"Path exceeds maximum length {MAX_PATH_INPUT_LENGTH} (fail-closed)"
            )

        raw_path = Path(target_path)
        if len(raw_path.parts) > MAX_PATH_COMPONENTS:
            raise _reject(
                f"Path exceeds maximum component depth {MAX_PATH_COMPONENTS} (fail-closed)"
            )

        # ---- 2. Jail containment ----------------------------------------
        # Both branches canonicalise symlinks; relative paths are jailed to
        # the workspace root BEFORE resolution.
        if raw_path.is_absolute():
            resolved = raw_path.resolve()
        else:
            resolved = (self.workspace_root / raw_path).resolve()

        rel_str = self._relative_to_workspace(resolved, target_path)

        # Defence in depth: re-check via the OS real-path resolution. This
        # also catches symlinked parent directories that escaped above.
        real_path = Path(os.path.realpath(str(resolved)))
        self._relative_to_workspace(real_path, target_path)

        # ---- 3. Workspace-root write deny --------------------------------
        if is_write and resolved == self.workspace_root:
            raise _reject(
                "Write to the workspace root directory itself is rejected (fail-closed)"
            )

        # ---- 4. Sensitive patterns (reads and writes) --------------------
        for pattern in SENSITIVE_BASENAME_PATTERNS:
            if fnmatch.fnmatch(resolved.name, pattern) or fnmatch.fnmatch(rel_str, pattern):
                raise _reject(
                    f"Access to sensitive file '{rel_str}' is strictly blocked "
                    f"(pattern '{pattern}')"
                )
        for component in rel_str.split("/"):
            if component in SENSITIVE_COMPONENT_NAMES:
                raise _reject(
                    f"Access to '{rel_str}' is blocked: '{component}' is a "
                    f"protected path component"
                )

        # ---- 5. Explicit forbidden patterns from the LEGO contract --------
        for pattern in self.forbidden_patterns:
            if self._matches_forbidden(rel_str, pattern):
                raise _reject(
                    f"Path '{rel_str}' matches forbidden pattern '{pattern}'"
                )

        # ---- 6. Write allowlist (strict, boundary-safe) -------------------
        if is_write:
            if not self.allowed_patterns:
                raise _reject(
                    "Write rejected: no allowed_paths configured (fail-closed, "
                    "empty allowlist denies all writes)"
                )
            if not any(
                self._matches_allowed(rel_str, pattern)
                for pattern in self.allowed_patterns
            ):
                raise _reject(
                    f"Write to '{rel_str}' rejected: does not match any "
                    f"allowed_paths: {self.allowed_patterns}"
                )

        return resolved

    def _relative_to_workspace(self, candidate: Path, original_input) -> str:
        """
        Return the canonical forward-slash relative path of ``candidate``
        inside the workspace, or raise ``SecurityError`` if it escapes.
        """
        try:
            rel = candidate.relative_to(self.workspace_root)
        except ValueError:
            raise _reject(
                f"Path traversal detected: {repr(original_input)[:120]!s} "
                f"resolves to '{candidate}', outside workspace "
                f"'{self.workspace_root}'"
            ) from None
        return rel.as_posix()


# =============================================================================
# Embedded M10 security regression suite (stdlib only, no external deps).
#
# The task file boundary is `tools/arena-executor/fs_guard.py` ONLY, so the
# required tests (path traversal, boundary paths, absolute/relative paths,
# invalid inputs, symlink escapes, write-allowlist enforcement) live here and
# run via:  python3 tools/arena-executor/fs_guard.py
# =============================================================================
def _build_self_test_suite():
    import tempfile
    import unittest

    def _can_symlink() -> bool:
        try:
            with tempfile.TemporaryDirectory() as probe:
                os.symlink("nowhere", os.path.join(probe, "probe_link"))
            return True
        except (OSError, NotImplementedError):
            return False

    SYMLINKS_AVAILABLE = _can_symlink()

    class FsSandboxBoundaryTests(unittest.TestCase):
        """M10 acceptance tests: fail-closed workspace filesystem jail."""

        def setUp(self):
            self._ws_tmp = tempfile.TemporaryDirectory()
            self.ws = Path(self._ws_tmp.name)
            (self.ws / "src" / "deep" / "nest").mkdir(parents=True)
            (self.ws / "src" / "lib.rs").write_text("fn main() {}", encoding="utf-8")
            (self.ws / "src" / "deep" / "nest" / "a.rs").write_text("// a", encoding="utf-8")
            (self.ws / "Cargo.toml").write_text("[workspace]", encoding="utf-8")
            (self.ws / "docs").mkdir()
            # A second temp dir strictly outside the workspace (portable
            # "outside" location on POSIX and Windows alike).
            self._outside_tmp = tempfile.TemporaryDirectory()
            self.outside = Path(self._outside_tmp.name).resolve()
            (self.outside / "secret.txt").write_text("top-secret", encoding="utf-8")
            (self.outside / "payload.rs").write_text("// evil", encoding="utf-8")
            self.guard = FilesystemGuard(
                self.ws,
                ["src/**", "Cargo.toml", "docs"],
                ["forbidden_zone/**"],
            )

        def tearDown(self):
            self._outside_tmp.cleanup()
            self._ws_tmp.cleanup()

        # ------------------------------------------------------------------
        # Path traversal — must be DENIED (SecurityError/SecurityViolation)
        # ------------------------------------------------------------------
        def assert_denied(self, path, is_write=False):
            with self.assertRaises((SecurityError, SecurityViolation), msg=repr(path)):
                self.guard.validate_path(path, is_write=is_write)

        def test_relative_dotdot_traversal_denied(self):
            for evil in (
                "..",
                "../",
                "../../etc/passwd",
                "../../../root/.ssh/id_rsa",
                "src/../../escape.txt",
                "a/./b/../../..",
                "src/lib.rs/../../../../etc/shadow",
            ):
                self.assert_denied(evil)

        def test_sibling_workspace_traversal_denied(self):
            # Mirrors the executor regression scenario (GATE 5 of
            # tests/arena/test_sublego_enforcement.py): accessing another
            # agent's workspace via ../ is a jail escape.
            self.assert_denied("../agent-04")
            self.assert_denied("../agent-04/crates/x.rs")

        def test_absolute_path_outside_denied(self):
            self.assert_denied(str(self.outside / "payload.rs"))
            self.assert_denied(str(self.outside))
            if os.name == "posix":
                self.assert_denied("/etc/passwd")
                self.assert_denied("/proc/self/environ")
                self.assert_denied("/dev/mem")

        def test_absolute_filesystem_root_denied(self):
            self.assert_denied(self.ws.anchor)  # "/" or "C:\\"
            self.assert_denied(str(Path(self.ws.anchor) / "etc" / "passwd"))

        def test_traversal_read_and_write_both_denied(self):
            evil = "../../outside/escape.rs"
            self.assert_denied(evil, is_write=False)
            self.assert_denied(evil, is_write=True)

        # ------------------------------------------------------------------
        # Invalid inputs — must be DENIED (fail-closed)
        # ------------------------------------------------------------------
        def test_invalid_input_types_denied(self):
            for bad in (None, 123, 4.5, b"src/lib.rs", Path("src/lib.rs"), ["src"], {"a": 1}):
                with self.subTest(bad=bad):
                    with self.assertRaises(SecurityError):
                        self.guard.validate_path(bad)

        def test_empty_and_whitespace_paths_denied(self):
            for bad in ("", "   ", "\t", "\n"):
                with self.subTest(bad=repr(bad)):
                    with self.assertRaises(SecurityError):
                        self.guard.validate_path(bad)

        def test_nul_byte_and_control_chars_denied(self):
            for bad in ("src/\x00lib.rs", "src/\nlib.rs", "src/\x07lib.rs", "src/\x1blib.rs"):
                with self.subTest(bad=repr(bad)):
                    with self.assertRaises(SecurityError):
                        self.guard.validate_path(bad)

        def test_overlong_path_denied(self):
            with self.assertRaises(SecurityError):
                self.guard.validate_path("a" * (MAX_PATH_INPUT_LENGTH + 1))

        def test_excessive_component_depth_denied(self):
            deep = "/".join(["a"] * (MAX_PATH_COMPONENTS + 1))
            with self.assertRaises(SecurityError):
                self.guard.validate_path(deep)

        def test_unexpected_errors_fail_closed_to_security_error(self):
            # A TypeError is converted into SecurityError rather than
            # escaping the guard (fail-closed containment).
            with self.assertRaises(SecurityError):
                self.guard.validate_path(object())

        # ------------------------------------------------------------------
        # Symlink escapes — must be DENIED
        # ------------------------------------------------------------------
        @unittest.skipIf(not SYMLINKS_AVAILABLE, "os.symlink unavailable on this platform")
        def test_symlink_file_escape_denied(self):
            os.symlink(self.outside / "secret.txt", self.ws / "leaked.txt")
            self.assert_denied("leaked.txt", is_write=False)
            self.assert_denied("leaked.txt", is_write=True)

        @unittest.skipIf(not SYMLINKS_AVAILABLE, "os.symlink unavailable on this platform")
        def test_symlink_dir_escape_denied(self):
            os.symlink(self.outside, self.ws / "linkdir")
            self.assert_denied("linkdir/secret.txt", is_write=False)
            self.assert_denied("linkdir/secret.txt", is_write=True)
            self.assert_denied("linkdir", is_write=True)

        @unittest.skipIf(not SYMLINKS_AVAILABLE, "os.symlink unavailable on this platform")
        def test_symlink_chain_escape_denied(self):
            os.symlink(self.outside, self.ws / "l2")
            os.symlink("l2", self.ws / "l1")
            self.assert_denied("l1/secret.txt")

        @unittest.skipIf(not SYMLINKS_AVAILABLE, "os.symlink unavailable on this platform")
        def test_symlink_loop_fail_closed(self):
            os.symlink("loop_b", self.ws / "loop_a")
            os.symlink("loop_a", self.ws / "loop_b")
            with self.assertRaises(SecurityError):
                self.guard.validate_path("loop_a/inner.txt")

        # ------------------------------------------------------------------
        # Sensitive patterns — must be DENIED (reads and writes)
        # ------------------------------------------------------------------
        def test_sensitive_env_files_denied(self):
            for evil in (".env", ".env.local", "prod.env", "src/.env", "config/.env.production"):
                with self.subTest(evil=evil):
                    self.assert_denied(evil, is_write=False)
                    self.assert_denied(evil, is_write=True)

        def test_sensitive_key_material_denied(self):
            for evil in (
                "server.key",
                "certs/api.pem",
                ".ssh/id_rsa",
                ".ssh/id_ed25519",
                "vault.secret",
            ):
                with self.subTest(evil=evil):
                    self.assert_denied(evil, is_write=False)
                    self.assert_denied(evil, is_write=True)

        def test_git_component_denied_at_any_depth(self):
            for evil in (
                ".git",
                ".git/config",
                ".git/hooks/pre-commit",
                "vendor/.git/HEAD",       # nested .git — formerly a bypass
                "nested/deep/.git/index",
            ):
                with self.subTest(evil=evil):
                    self.assert_denied(evil, is_write=False)
                    self.assert_denied(evil, is_write=True)

        # ------------------------------------------------------------------
        # Forbidden patterns (Sub-LEGO denylist) — must be DENIED
        # ------------------------------------------------------------------
        def test_forbidden_subtree_denied(self):
            self.assert_denied("forbidden_zone/notes.txt", is_write=False)
            self.assert_denied("forbidden_zone/notes.txt", is_write=True)
            self.assert_denied("forbidden_zone", is_write=True)

        # ------------------------------------------------------------------
        # Write allowlist — strict, boundary-safe
        # ------------------------------------------------------------------
        def test_write_inside_allowed_subtree_allowed(self):
            resolved = self.guard.validate_path("src/deep/nest/new_file.rs", is_write=True)
            self.assertEqual(resolved, (self.ws / "src" / "deep" / "nest" / "new_file.rs").resolve())

        def test_write_prefix_sibling_collision_denied(self):
            # Regression for the former prefix-matching hole: pattern `src`
            # (or `src/**`) must NEVER allow `src-evil/...`.
            for evil in ("src-evil/x.rs", "src2/y.rs", "src_backup/z.rs"):
                with self.subTest(evil=evil):
                    self.assert_denied(evil, is_write=True)

        def test_write_long_prefix_sibling_collision_denied(self):
            g = FilesystemGuard(self.ws, ["crates/n8n-workflow/**"], [])
            for evil in ("crates/n8n-workflow-evil/x.rs", "crates/n8n-workflow2/y.rs"):
                with self.subTest(evil=evil):
                    with self.assertRaises(SecurityError):
                        g.validate_path(evil, is_write=True)
            # The legitimate subtree itself stays writable.
            ok = g.validate_path("crates/n8n-workflow/src/lib.rs", is_write=True)
            self.assertEqual(ok, (self.ws / "crates" / "n8n-workflow" / "src" / "lib.rs").resolve())

        def test_write_outside_allowlist_denied(self):
            self.assert_denied("README.md", is_write=True)
            self.assert_denied("docs2/plan.md", is_write=True)

        def test_write_empty_allowlist_denies_everything(self):
            strict = FilesystemGuard(self.ws, [], [])
            with self.assertRaises(SecurityError):
                strict.validate_path("src/lib.rs", is_write=True)

        def test_write_to_workspace_root_denied(self):
            permissive = FilesystemGuard(self.ws, ["**"], [])
            with self.assertRaises(SecurityError):
                permissive.validate_path(".", is_write=True)
            with self.assertRaises(SecurityError):
                permissive.validate_path("foo/..", is_write=True)

        def test_write_exact_pattern_and_dir_prefix_allowed(self):
            self.assertEqual(
                self.guard.validate_path("Cargo.toml", is_write=True),
                (self.ws / "Cargo.toml").resolve(),
            )
            self.assertEqual(
                self.guard.validate_path("docs/plan.md", is_write=True),
                (self.ws / "docs" / "plan.md").resolve(),
            )
            self.assertEqual(
                self.guard.validate_path("docs", is_write=True),
                (self.ws / "docs").resolve(),
            )

        def test_validate_path_defaults_to_write_policy(self):
            # Deny-by-default: omitting is_write applies the STRICTER
            # (write) policy, so a non-allowlisted read-only target is
            # still rejected unless the caller states is_write=False.
            with self.assertRaises(SecurityError):
                self.guard.validate_path("README.md")
            ok = self.guard.validate_path("src/lib.rs")
            self.assertEqual(ok, (self.ws / "src" / "lib.rs").resolve())

        # ------------------------------------------------------------------
        # Boundary paths — must be ALLOWED (no false positives)
        # ------------------------------------------------------------------
        def test_read_cwd_workspace_root_allowed(self):
            resolved = self.guard.validate_path(".", is_write=False)
            self.assertEqual(resolved, self.ws.resolve())

        def test_read_inside_workspace_allowed_without_allowlist_check(self):
            resolved = self.guard.validate_path("README-not-present.md", is_write=False)
            self.assertEqual(resolved, (self.ws / "README-not-present.md").resolve())

        def test_safe_internal_dotdot_normalization_allowed(self):
            resolved = self.guard.validate_path("src/../src/lib.rs", is_write=False)
            self.assertEqual(resolved, (self.ws / "src" / "lib.rs").resolve())
            resolved = self.guard.validate_path("src/../src/lib.rs", is_write=True)
            self.assertEqual(resolved, (self.ws / "src" / "lib.rs").resolve())

        def test_absolute_path_inside_workspace_allowed(self):
            inside_abs = (self.ws / "src" / "lib.rs").resolve()
            resolved = self.guard.validate_path(str(inside_abs), is_write=False)
            self.assertEqual(resolved, inside_abs)
            resolved = self.guard.validate_path(str(inside_abs), is_write=True)
            self.assertEqual(resolved, inside_abs)

        def test_trailing_separator_and_dots_allowed(self):
            resolved = self.guard.validate_path("src/", is_write=True)
            self.assertEqual(resolved, (self.ws / "src").resolve())
            resolved = self.guard.validate_path("./src/./deep/../lib.rs", is_write=False)
            self.assertEqual(resolved, (self.ws / "src" / "lib.rs").resolve())

        def test_non_sensitive_dot_prefixed_files_allowed(self):
            resolved = self.guard.validate_path("src/.gitkeep", is_write=True)
            self.assertEqual(resolved, (self.ws / "src" / ".gitkeep").resolve())

        # ------------------------------------------------------------------
        # Executor-compat mirror (GATE 5 semantics must keep holding)
        # ------------------------------------------------------------------
        def test_executor_gate5_scenario_mirror(self):
            g = FilesystemGuard(self.ws, ["crates/n8n-workflow/**"], [])
            # cwd "." must validate (read) — executor relies on this.
            self.assertEqual(g.validate_path(".", is_write=False), self.ws.resolve())
            # traversal argument must be rejected.
            with self.assertRaises(SecurityError):
                g.validate_path("../../agent-04", is_write=False)

        # ------------------------------------------------------------------
        # Exception identity / backward compatibility
        # ------------------------------------------------------------------
        def test_security_error_and_violation_are_same_class(self):
            self.assertIs(SecurityViolation, SecurityError)
            try:
                self.guard.validate_path("../../etc/passwd")
            except SecurityViolation as exc:  # legacy name still catches
                self.assertIsInstance(exc, SecurityError)
            else:
                self.fail("expected SecurityViolation")

        # ------------------------------------------------------------------
        # Constructor validation (fail-closed configuration)
        # ------------------------------------------------------------------
        def test_constructor_rejects_invalid_root(self):
            for bad_root in ("", "   ", None, 123, Path(os.sep), self.ws.anchor):
                with self.subTest(bad_root=repr(bad_root)):
                    with self.assertRaises(SecurityError):
                        FilesystemGuard(bad_root, ["src/**"], [])

        def test_constructor_rejects_invalid_patterns(self):
            for bad_allowed in (None, "src/**", ["src/**", 5], ["src/**", ""], ["src/**", None]):
                with self.subTest(bad_allowed=repr(bad_allowed)):
                    with self.assertRaises(SecurityError):
                        FilesystemGuard(self.ws, bad_allowed, [])
            for bad_forbidden in (None, "x", [1], [""]):
                with self.subTest(bad_forbidden=repr(bad_forbidden)):
                    with self.assertRaises(SecurityError):
                        FilesystemGuard(self.ws, ["src/**"], bad_forbidden)

    return unittest.TestLoader().loadTestsFromTestCase(FsSandboxBoundaryTests)


def run_self_tests() -> int:
    """Execute the embedded M10 security regression suite. 0 = pass, 1 = fail."""
    import sys
    import unittest

    suite = _build_self_test_suite()
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print(
        f"\n[M10 fs-sandbox self-test] ran={result.testsRun} "
        f"failures={len(result.failures)} errors={len(result.errors)} "
        f"skipped={len(result.skipped)}"
    )
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    import sys

    sys.exit(run_self_tests())
