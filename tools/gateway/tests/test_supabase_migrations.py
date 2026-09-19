"""
Automated Test Suite for Supabase Schema Migrations Lifecycle.
Verifies Phase 8 requirements:
    CREATE migration
    ↓
    apply migration
    ↓
    verify migration status
    ↓
    verify schema
    ↓
    rollback/cleanup
    ↓
    verify final state
    All credentials remain hidden and isolated.
"""

import unittest
import sqlite3
import shutil
from pathlib import Path
from tools.gateway.gateway import CapabilityGateway

class TestSupabaseMigrations(unittest.TestCase):
    def setUp(self):
        self.gateway = CapabilityGateway()
        self.manager_token = self.gateway.auth.get_token_for_role("manager")
        self.worker_token = self.gateway.auth.get_token_for_role("worker")
        self.migrations_dir = self.gateway.supabase._get_migrations_dir()
        self.created_files = []

    def tearDown(self):
        # Clean up any test migration files created during tests
        for f in self.created_files:
            if f.exists():
                try:
                    f.unlink()
                except Exception:
                    pass

    def test_migration_lifecycle_create_apply_status_rollback(self):
        """Tests the full migration lifecycle: create, apply, status, schema verify, rollback."""
        # 1. CREATE MIGRATION
        test_tbl = "test_worker_heartbeats_audit"
        sql_up = f"""
        CREATE TABLE IF NOT EXISTS public.{test_tbl} (
            id TEXT PRIMARY KEY,
            worker_id TEXT NOT NULL,
            heartbeat_at TEXT NOT NULL
        );
        """
        sql_down = f"DROP TABLE IF EXISTS public.{test_tbl};"

        create_res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="supabase.create_migration",
            params={
                "name": "create_worker_heartbeats_audit",
                "sql_up": sql_up,
                "sql_down": sql_down
            },
            bearer_token=self.manager_token
        )
        self.assertTrue(create_res["ok"], f"Create migration failed: {create_res}")
        self.assertEqual(create_res["result"]["status"], "SUCCESS")
        version = create_res["result"]["version"]
        file_path = self.gateway.repo_root / create_res["result"]["file_path"]
        self.created_files.append(file_path)
        self.assertTrue(file_path.exists())

        # 2. VERIFY MIGRATION STATUS (PENDING)
        status_res1 = self.gateway.invoke(
            caller_id="arena-manager",
            capability="supabase.migration_status",
            bearer_token=self.manager_token
        )
        self.assertTrue(status_res1["ok"])
        m_list = status_res1["result"]["migrations"]
        our_mig = next((m for m in m_list if m["version"] == version), None)
        self.assertIsNotNone(our_mig)
        self.assertEqual(our_mig["status"], "PENDING")
        self.assertTrue(our_mig["reversible"])

        # 3. APPLY MIGRATION
        apply_res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="supabase.apply_migration",
            params={"version": version},
            bearer_token=self.manager_token
        )
        self.assertTrue(apply_res["ok"], f"Apply migration failed: {apply_res}")
        self.assertEqual(apply_res["result"]["status"], "MIGRATION_APPLIED")
        self.assertEqual(apply_res["result"]["version"], version)

        # 4. DUPLICATE APPLY SHOULD RETURN MIGRATION_ALREADY_APPLIED
        dup_apply = self.gateway.invoke(
            caller_id="arena-manager",
            capability="supabase.apply_migration",
            params={"version": version},
            bearer_token=self.manager_token
        )
        self.assertTrue(dup_apply["ok"])
        self.assertEqual(dup_apply["result"]["status"], "MIGRATION_ALREADY_APPLIED")

        # 5. VERIFY MIGRATION STATUS (APPLIED)
        status_res2 = self.gateway.invoke(
            caller_id="arena-manager",
            capability="supabase.migration_status",
            bearer_token=self.manager_token
        )
        m_list2 = status_res2["result"]["migrations"]
        our_mig2 = next((m for m in m_list2 if m["version"] == version), None)
        self.assertIsNotNone(our_mig2)
        self.assertEqual(our_mig2["status"], "APPLIED")
        self.assertIsNotNone(our_mig2["applied_at"])

        # 6. VERIFY SCHEMA (TABLE EXISTS & ACCESSIBLE)
        write_res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="supabase.write_table",
            params={
                "table": test_tbl,
                "data": {"id": "hb-001", "worker_id": "worker-1", "heartbeat_at": "2026-09-20T12:00:00Z"}
            },
            bearer_token=self.manager_token
        )
        self.assertTrue(write_res["ok"])

        read_res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="supabase.read_table",
            params={"table": test_tbl},
            bearer_token=self.manager_token
        )
        self.assertTrue(read_res["ok"])
        self.assertGreaterEqual(len(read_res["result"]), 1)
        self.assertEqual(read_res["result"][0]["worker_id"], "worker-1")

        # 7. ROLLBACK MIGRATION
        rollback_res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="supabase.rollback_migration",
            params={"version": version},
            bearer_token=self.manager_token
        )
        self.assertTrue(rollback_res["ok"], f"Rollback failed: {rollback_res}")
        self.assertEqual(rollback_res["result"]["status"], "MIGRATION_ROLLED_BACK")
        self.assertEqual(rollback_res["result"]["version"], version)

        # 8. VERIFY FINAL STATE
        status_res3 = self.gateway.invoke(
            caller_id="arena-manager",
            capability="supabase.migration_status",
            bearer_token=self.manager_token
        )
        m_list3 = status_res3["result"]["migrations"]
        our_mig3 = next((m for m in m_list3 if m["version"] == version), None)
        self.assertIsNotNone(our_mig3)
        self.assertEqual(our_mig3["status"], "PENDING")

        # Verify table is dropped
        with sqlite3.connect(self.gateway.supabase.local_db_path) as conn:
            c = conn.cursor()
            c.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{test_tbl}'")
            self.assertIsNone(c.fetchone(), f"Table {test_tbl} should be dropped after rollback")

    def test_worker_blocked_from_migrations(self):
        """Worker agents must be blocked by policy from running schema migrations."""
        for cap in ["supabase.create_migration", "supabase.apply_migration", "supabase.schema_upgrade", "supabase.rollback_migration"]:
            res = self.gateway.invoke(
                caller_id="arena-agent-worker-2",
                capability=cap,
                params={"name": "illegal_test", "sql_up": "CREATE TABLE test_x (id int);"},
                bearer_token=self.worker_token
            )
            self.assertFalse(res["ok"])
            self.assertFalse(res["authorized"])
            self.assertIn("POLICY_VIOLATION", res["error"])

if __name__ == "__main__":
    unittest.main()
