"""
Resource Governor Interface with Stale Lock Recovery and Atomic Ownership Release.
Limits concurrency of intensive tasks (compilation and test execution)
across multiple concurrent worker processes to protect low-resource host environments (e.g. 2 CPU / 2 GB RAM).

Uses atomic file-based locks:
- Stale lock detection via PID liveness inspection (P0-3)
- Atomic release strictly enforcing owner PID check (P1-2)
- Zero kill of external processes
"""

import os
import time
import ctypes
from pathlib import Path
from typing import Optional, Tuple, Callable

def default_is_pid_alive(pid: int) -> bool:
    """Checks whether a process with given PID is currently active on the host OS."""
    if pid <= 0:
        return False
    if os.name == "nt":
        try:
            kernel32 = ctypes.windll.kernel32
            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            h_proc = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
            if not h_proc:
                return False
            exit_code = ctypes.c_ulong()
            still_active = 259
            if kernel32.GetExitCodeProcess(h_proc, ctypes.byref(exit_code)):
                kernel32.CloseHandle(h_proc)
                return exit_code.value == still_active
            kernel32.CloseHandle(h_proc)
            return False
        except Exception:
            return False
    else:
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False

class ResourceGovernor:
    def __init__(
        self,
        lock_dir: Optional[Path] = None,
        max_build_slots: int = 1,
        max_test_slots: int = 1,
        is_pid_alive_fn: Optional[Callable[[int], bool]] = None
    ):
        self.repo_root = Path(__file__).resolve().parents[2]
        self.lock_dir = (lock_dir or (self.repo_root / ".arena" / "run" / "locks")).resolve()
        self.lock_dir.mkdir(parents=True, exist_ok=True)

        self.max_build_slots = max_build_slots
        self.max_test_slots = max_test_slots
        self.is_pid_alive = is_pid_alive_fn or default_is_pid_alive

    def _parse_lock_file(self, lock_file: Path) -> Tuple[Optional[int], Optional[float]]:
        """Reads PID and timestamp from lock file. Returns (pid, timestamp) or (None, None)."""
        try:
            content = lock_file.read_text(encoding="utf-8").strip()
            if ":" in content:
                parts = content.split(":", 1)
                return int(parts[0]), float(parts[1])
            return int(content), 0.0
        except Exception:
            return None, None

    def _try_reclaim_stale_lock(self, lock_file: Path) -> bool:
        """
        P0-3: If lock file exists but owner PID is dead or file is malformed,
        reclaims it by attempting safe deletion.
        """
        if not lock_file.exists():
            return False

        owner_pid, _ = self._parse_lock_file(lock_file)
        
        # If lock is malformed or PID is dead
        should_reclaim = False
        if owner_pid is None or owner_pid <= 0:
            should_reclaim = True
        elif not self.is_pid_alive(owner_pid):
            should_reclaim = True

        if should_reclaim:
            try:
                lock_file.unlink()
                return True
            except Exception:
                return False

        return False

    def _acquire_slot(self, slot_type: str, max_slots: int, timeout_seconds: float = 0.0) -> Optional[int]:
        """Attempts to acquire an exclusive slot index from 0 to max_slots-1."""
        start_time = time.time()
        current_pid = os.getpid()

        while True:
            for slot in range(max_slots):
                lock_file = self.lock_dir / f"{slot_type}_{slot}.lock"

                # Check for stale lock first
                if lock_file.exists():
                    self._try_reclaim_stale_lock(lock_file)

                try:
                    # Atomic creation across POSIX and Windows
                    fd = os.open(str(lock_file), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                    os.write(fd, f"{current_pid}:{time.time()}".encode("utf-8"))
                    os.close(fd)
                    return slot
                except FileExistsError:
                    continue
                except Exception:
                    continue

            if (time.time() - start_time) >= timeout_seconds:
                return None
            time.sleep(0.05)

    def _release_slot(self, slot_type: str, slot_index: int, caller_pid: Optional[int] = None) -> bool:
        """
        P1-2: Releases the slot lock strictly verifying owner PID matches caller PID.
        Rejects release if not owner.
        """
        lock_file = self.lock_dir / f"{slot_type}_{slot_index}.lock"
        if not lock_file.exists():
            return False

        expected_caller = caller_pid if caller_pid is not None else os.getpid()
        owner_pid, _ = self._parse_lock_file(lock_file)

        # Non-owner cannot release live lock
        if owner_pid is not None and owner_pid != expected_caller:
            return False

        try:
            lock_file.unlink()
            return True
        except Exception:
            return False

    def acquire_build_slot(self, timeout_seconds: float = 0.0) -> Optional[int]:
        """Acquires a compilation build slot (default max=1)."""
        return self._acquire_slot("build", self.max_build_slots, timeout_seconds=timeout_seconds)

    def release_build_slot(self, slot_index: int, caller_pid: Optional[int] = None) -> bool:
        """Releases a compilation build slot strictly verifying caller is owner."""
        return self._release_slot("build", slot_index, caller_pid=caller_pid)

    def acquire_test_slot(self, timeout_seconds: float = 0.0) -> Optional[int]:
        """Acquires a test runner slot (default max=1)."""
        return self._acquire_slot("test", self.max_test_slots, timeout_seconds=timeout_seconds)

    def release_test_slot(self, slot_index: int, caller_pid: Optional[int] = None) -> bool:
        """Releases a test runner slot strictly verifying caller is owner."""
        return self._release_slot("test", slot_index, caller_pid=caller_pid)
