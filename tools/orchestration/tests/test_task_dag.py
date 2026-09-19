"""
Unit tests for Canonical Task DAG & File Boundary Integrity.
Runs as part of automated CI / pre-push verification.
"""

import unittest
from tools.orchestration.audit_task_dag import audit_catalog

class TestTaskDagIntegrity(unittest.TestCase):
    def test_canonical_catalog_dag_and_boundaries(self):
        success = audit_catalog()
        self.assertTrue(success, "Canonical Task DAG and boundary matrix audit must pass with 0 errors")

if __name__ == "__main__":
    unittest.main()
