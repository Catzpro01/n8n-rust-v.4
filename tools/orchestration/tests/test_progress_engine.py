import concurrent.futures
import unittest
from tools.orchestration.progress_engine import (
    CANONICAL_MILESTONES,
    ProgressEngine,
    TaskEvidence,
    ValidationRecord,
)


class TestMilestoneProgressEngine(unittest.TestCase):
    def setUp(self):
        self.engine = ProgressEngine(canonical_model="task_weighted")
        self.dummy_sha = "a1b2c3d4e5f678901234567890abcdef12345678"
        self.old_sha = "f0e1d2c3b4a596871234567890abcdef98765432"

    def _make_valid_done_task(self, task_key: str, milestone: str, weight: float = 1.0, sha: str = None) -> TaskEvidence:
        c_sha = sha or self.dummy_sha
        return TaskEvidence(
            task_key=task_key,
            specialization="runtime-kernel",
            milestone=milestone,
            status="DONE",
            progress_weight=weight,
            validation_level="L1",
            current_commit_sha=c_sha,
            acceptance_criteria=[{"description": "Criterion 1", "verified": True}],
            validations=[
                ValidationRecord(
                    commit_sha=c_sha,
                    suite="cargo-test",
                    level="L1",
                    status="PASSED",
                    passed_count=10,
                )
            ],
        )

    # --------------------------------------------------------------------------
    # Test A: Empty Project
    # --------------------------------------------------------------------------
    def test_a_empty_project(self):
        res = self.engine.calculate_project_progress(tasks=[])
        self.assertEqual(res.project_progress, 0.0)
        self.assertEqual(res.total_weight, 0.0)
        self.assertEqual(res.completed_weight, 0.0)
        self.assertEqual(res.done_count, 0)
        self.assertEqual(res.queued_count, 0)

    # --------------------------------------------------------------------------
    # Test B: Semua Task QUEUED -> 0%
    # --------------------------------------------------------------------------
    def test_b_all_tasks_queued(self):
        tasks = [
            TaskEvidence(task_key=f"task-{i}", specialization="runtime-kernel", milestone="M1", status="QUEUED")
            for i in range(4)
        ]
        res = self.engine.calculate_project_progress(tasks=tasks)
        self.assertEqual(res.project_progress, 0.0)
        self.assertEqual(res.queued_count, 4)
        self.assertEqual(res.done_count, 0)
        self.assertEqual(res.completed_weight, 0.0)

    # --------------------------------------------------------------------------
    # Test C: Semua Task DONE -> 100%
    # --------------------------------------------------------------------------
    def test_c_all_tasks_done(self):
        tasks = [
            self._make_valid_done_task(f"task-{i}", "M1", weight=1.0)
            for i in range(4)
        ]
        res = self.engine.calculate_project_progress(tasks=tasks)
        self.assertEqual(res.project_progress, 100.0)
        self.assertEqual(res.done_count, 4)
        self.assertEqual(res.total_weight, 4.0)
        self.assertEqual(res.completed_weight, 4.0)

    # --------------------------------------------------------------------------
    # Test D: Sebagian DONE
    # --------------------------------------------------------------------------
    def test_d_partially_done(self):
        tasks = [
            self._make_valid_done_task("task-1", "M1", weight=1.0),
            self._make_valid_done_task("task-2", "M1", weight=1.0),
            TaskEvidence(task_key="task-3", specialization="runtime-kernel", milestone="M1", status="QUEUED", progress_weight=1.0),
            TaskEvidence(task_key="task-4", specialization="runtime-kernel", milestone="M1", status="QUEUED", progress_weight=1.0),
        ]
        res = self.engine.calculate_project_progress(tasks=tasks)
        self.assertEqual(res.project_progress, 50.0)
        self.assertEqual(res.done_count, 2)
        self.assertEqual(res.queued_count, 2)
        self.assertEqual(res.completed_weight, 2.0)
        self.assertEqual(res.total_weight, 4.0)

    # --------------------------------------------------------------------------
    # Test E: Weighted Tasks
    # --------------------------------------------------------------------------
    def test_e_weighted_tasks(self):
        # 1 task besar DONE (weight 3.0), 1 task normal QUEUED (weight 1.0)
        tasks = [
            self._make_valid_done_task("task-core-arch", "M1", weight=3.0),
            TaskEvidence(task_key="task-minor-doc", specialization="runtime-kernel", milestone="M1", status="QUEUED", progress_weight=1.0),
        ]
        res = self.engine.calculate_project_progress(tasks=tasks)
        # 3.0 / 4.0 * 100 = 75.0%
        self.assertEqual(res.project_progress, 75.0)
        self.assertEqual(res.completed_weight, 3.0)
        self.assertEqual(res.total_weight, 4.0)

    # --------------------------------------------------------------------------
    # Test F: Weighted Milestones (Optional Analytical View)
    # --------------------------------------------------------------------------
    def test_f_weighted_milestones(self):
        engine_mw = ProgressEngine(canonical_model="task_weighted")
        tasks = [
            self._make_valid_done_task("task-m1", "M1", weight=1.0),
            TaskEvidence(task_key="task-m2", specialization="execution-engine", milestone="M2", status="QUEUED", progress_weight=1.0),
        ]
        # M1 progress is 100%, M2 progress is 0%
        # Milestone weights: M1 = 2.0, M2 = 1.0
        m_weights = {"M1": 2.0, "M2": 1.0}
        custom_dict = {"M1": "Runtime Kernel", "M2": "Execution Engine"}
        res = engine_mw.calculate_project_progress(tasks=tasks, milestones_dict=custom_dict, milestone_weights=m_weights)
        
        # Single Canonical formula is Task-Weighted: 1.0 / 2.0 = 50.0%
        self.assertEqual(res.project_progress, 50.0)
        self.assertEqual(res.registered_scope_progress, 50.0)
        
        # Optional Analytical View: (100.0 * 2.0 + 0.0 * 1.0) / (2.0 + 1.0) = 200 / 3 = 66.67%
        self.assertEqual(res.optional_analytical_milestone_weighted_progress, 66.67)

    # --------------------------------------------------------------------------
    # Test G: IN_PROGRESS tidak dihitung sebagai DONE
    # --------------------------------------------------------------------------
    def test_g_in_progress_not_done(self):
        in_progress_statuses = ["CLAIMED", "IN_PROGRESS", "READY_TO_MERGE"]
        tasks = [
            TaskEvidence(task_key=f"task-{idx}", specialization="runtime-kernel", milestone="M1", status=st, progress_weight=1.0)
            for idx, st in enumerate(in_progress_statuses)
        ]
        res = self.engine.calculate_project_progress(tasks=tasks)
        self.assertEqual(res.project_progress, 0.0)
        self.assertEqual(res.done_count, 0)
        self.assertEqual(res.in_progress_count, 3)

    # --------------------------------------------------------------------------
    # Test H: BLOCKED tidak dihitung sebagai DONE
    # --------------------------------------------------------------------------
    def test_h_blocked_not_done(self):
        tasks = [
            TaskEvidence(task_key="task-blocked-1", specialization="data-plane", milestone="M3", status="BLOCKED", progress_weight=2.0)
        ]
        res = self.engine.calculate_project_progress(tasks=tasks)
        self.assertEqual(res.project_progress, 0.0)
        self.assertEqual(res.done_count, 0)
        self.assertEqual(res.blocked_count, 1)

    # --------------------------------------------------------------------------
    # Test I: STALE Validation
    # --------------------------------------------------------------------------
    def test_i_stale_validation(self):
        # Task claims DONE, but its validation record is for old commit SHA
        task = TaskEvidence(
            task_key="task-stale",
            specialization="runtime-kernel",
            milestone="M1",
            status="DONE",
            current_commit_sha="bbbb222233334444555566667777888899990000",
            validations=[
                ValidationRecord(
                    commit_sha="aaaa111122223333444455556666777788889999",  # MISMATCH
                    suite="cargo-test",
                    level="L1",
                    status="PASSED",
                )
            ],
        )
        res = self.engine.calculate_project_progress(tasks=[task])
        self.assertEqual(res.project_progress, 0.0)
        self.assertEqual(res.done_count, 0)
        self.assertEqual(res.stale_count, 1)
        self.assertTrue(len(res.reconciliation_discrepancies) > 0)
        self.assertIn("STALE", res.reconciliation_discrepancies[0]["notes"][0])

    # --------------------------------------------------------------------------
    # Test J: Commit berubah setelah validation
    # --------------------------------------------------------------------------
    def test_j_commit_changed_after_validation(self):
        initial_commit = "1111222233334444555566667777888899990000"
        new_commit = "9999888877776666555544443333222211110000"

        # Initially task was valid
        task = self._make_valid_done_task("task-evolve", "M1", sha=initial_commit)
        is_valid_before, _ = self.engine.verify_task_evidence(task)
        self.assertTrue(is_valid_before)

        # Agent pushed new commit without re-running validation
        task.current_commit_sha = new_commit
        is_valid_after, notes = self.engine.verify_task_evidence(task)
        self.assertFalse(is_valid_after)
        self.assertTrue(any("STALE" in n for n in notes))

    # --------------------------------------------------------------------------
    # Test K: Task MERGED tetapi post-merge belum selesai
    # --------------------------------------------------------------------------
    def test_k_merged_without_post_merge_verify_not_done(self):
        tasks = [
            TaskEvidence(
                task_key="task-merged",
                specialization="node-system",
                milestone="M5",
                status="MERGED",
                current_commit_sha=self.dummy_sha,
                merge_commit_sha="3333444455556666777788889999000011112222",
                progress_weight=1.0,
            ),
            TaskEvidence(
                task_key="task-post-verify",
                specialization="node-system",
                milestone="M5",
                status="POST_MERGE_VERIFY",
                current_commit_sha=self.dummy_sha,
                progress_weight=1.0,
            ),
        ]
        res = self.engine.calculate_project_progress(tasks=tasks)
        self.assertEqual(res.project_progress, 0.0)
        self.assertEqual(res.done_count, 0)
        self.assertEqual(res.in_progress_count, 2)

    # --------------------------------------------------------------------------
    # Test L: Task DONE dengan evidence commit yang salah / tidak ada di main
    # --------------------------------------------------------------------------
    def test_l_done_with_invalid_git_main_commit(self):
        main_commits = {"1111111111111111111111111111111111111111", "2222222222222222222222222222222222222222"}
        task = self._make_valid_done_task("task-fake-done", "M1", sha="9999999999999999999999999999999999999999")
        res = self.engine.calculate_project_progress(tasks=[task], git_commits_on_main=main_commits)
        self.assertEqual(res.project_progress, 0.0)
        self.assertEqual(res.done_count, 0)
        self.assertEqual(res.stale_count, 1)
        self.assertTrue(len(res.reconciliation_discrepancies) > 0)

    # --------------------------------------------------------------------------
    # Test M: Concurrent Progress Calculation
    # --------------------------------------------------------------------------
    def test_m_concurrent_progress_calculation(self):
        tasks = [
            self._make_valid_done_task(f"t-done-{i}", "M1", weight=1.0)
            for i in range(5)
        ] + [
            TaskEvidence(task_key=f"t-queued-{i}", specialization="execution-engine", milestone="M2", status="QUEUED", progress_weight=1.0)
            for i in range(5)
        ]

        def run_calc():
            res = self.engine.calculate_project_progress(tasks)
            return res.project_progress, res.done_count, res.queued_count

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            futures = [executor.submit(run_calc) for _ in range(20)]
            results = [f.result() for f in futures]

        # All concurrent executions must yield identical deterministic results
        for pct, done, queued in results:
            self.assertEqual(pct, 50.0)
            self.assertEqual(done, 5)
            self.assertEqual(queued, 5)

    # --------------------------------------------------------------------------
    # Test N: Reconciliation ketika Supabase dan GitHub tidak konsisten
    # --------------------------------------------------------------------------
    def test_n_reconciliation_supabase_github_inconsistency(self):
        # Supabase says DONE, but GitHub main does not have the commit
        known_git_commits = {"1111111111111111111111111111111111111111"}
        phantom_sha = "9999999999999999999999999999999999999999"
        task = TaskEvidence(
            task_key="runtime-kernel/m1-runner",
            specialization="runtime-kernel",
            milestone="M1",
            status="DONE",
            progress_weight=2.0,
            current_commit_sha=phantom_sha,
            validations=[
                ValidationRecord(
                    commit_sha=phantom_sha,
                    suite="unit",
                    level="L1",
                    status="PASSED",
                )
            ],
            acceptance_criteria=[{"description": "Kernel runner executes", "verified": True}],
        )

        res = self.engine.calculate_project_progress(tasks=[task], git_commits_on_main=known_git_commits)

        # Inconsistency must be captured
        self.assertEqual(res.project_progress, 0.0)
        self.assertEqual(len(res.reconciliation_discrepancies), 1)
        disc = res.reconciliation_discrepancies[0]
        self.assertEqual(disc["status"], "INCONSISTENT")
        self.assertEqual(disc["task_key"], "runtime-kernel/m1-runner")
        self.assertTrue(any("main" in note for note in disc["notes"]))

        # Check snapshot mechanism
        snapshot = self.engine.create_snapshot(
            tasks=[task],
            main_commit_sha="1111111111111111111111111111111111111111",
            git_commits_on_main=known_git_commits,
        )
        self.assertEqual(snapshot.project_progress, 0.0)
        self.assertEqual(snapshot.stale_count, 1)
        self.assertTrue(len(self.engine.events_bus) > 0)
        self.assertEqual(self.engine.events_bus[-1]["event_type"], "PROGRESS_UPDATED")


if __name__ == "__main__":
    unittest.main()
