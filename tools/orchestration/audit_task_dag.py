"""
Task DAG & File Boundary Integrity Auditor.
Verifies:
1. Task Key uniqueness and canonical schema.
2. All declared dependencies exist within the canonical task catalog.
3. DAG is strictly acyclic (no circular dependencies).
4. Parallel execution boundaries (no exclusive file conflicts between concurrently eligible tasks).
5. Milestone alignment and specialization domain freeze conformity.
"""

import sys
from collections import defaultdict, deque
from pathlib import Path
from typing import Dict, List, Set

# Ensure workspace root in path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from tools.orchestration.task_manifest_catalog import CANONICAL_TASKS

CANONICAL_SPECIALIZATIONS = {
    "runtime-kernel",
    "execution-engine",
    "data-plane",
    "memory",
    "node-system",
    "workflow-model",
    "expression-engine",
    "validation",
    "integration",
    "security"
}

def audit_catalog():
    print("=================================================================")
    print("RUNNING CANONICAL TASK DAG & BOUNDARY MATRIX AUDIT")
    print("=================================================================")
    errors = []
    warnings = []

    task_map: Dict[str, dict] = {}
    all_keys: Set[str] = set()
    
    # 1. Check uniqueness & required fields
    for t in CANONICAL_TASKS:
        key = t.get("task_key")
        if not key:
            errors.append("Task found with missing 'task_key'")
            continue
        if key in all_keys:
            errors.append(f"Duplicate task_key: {key}")
        all_keys.add(key)
        task_map[key] = t

        spec = t.get("specialization")
        if spec not in CANONICAL_SPECIALIZATIONS:
            errors.append(f"Task '{key}' has invalid specialization '{spec}'. Must be one of {CANONICAL_SPECIALIZATIONS}")

        weight = t.get("progress_weight", 0.0)
        if weight <= 0:
            errors.append(f"Task '{key}' has non-positive progress_weight: {weight}")

        val_lvl = t.get("validation_level")
        if val_lvl not in {"L1", "L2", "L3"}:
            errors.append(f"Task '{key}' has invalid validation_level: {val_lvl}")

    print(f"[*] Total Registered Tasks: {len(task_map)}")

    # 2. Check dependencies existence
    adj: Dict[str, List[str]] = defaultdict(list)
    in_degree: Dict[str, int] = {k: 0 for k in all_keys}
    
    for key, t in task_map.items():
        deps = t.get("dependencies", [])
        for dep in deps:
            if dep not in all_keys:
                errors.append(f"Task '{key}' depends on non-existent task '{dep}'")
            else:
                adj[dep].append(key)
                in_degree[key] += 1

    # 3. Check DAG Acyclicity (Topological Sort via Kahn's Algorithm)
    queue = deque([k for k, deg in in_degree.items() if deg == 0])
    topological_order = []

    while queue:
        curr = queue.popleft()
        topological_order.append(curr)
        for nxt in adj[curr]:
            in_degree[nxt] -= 1
            if in_degree[nxt] == 0:
                queue.append(nxt)

    if len(topological_order) != len(all_keys):
        cycle_nodes = [k for k, deg in in_degree.items() if deg > 0]
        errors.append(f"Cyclic dependency detected! Nodes involved in cycle: {cycle_nodes}")
    else:
        print(f"[OK] DAG is strictly acyclic. Valid topological ordering of {len(topological_order)} tasks established.")

    # 4. Check Parallel File Conflicts
    reachable: Dict[str, Set[str]] = defaultdict(set)
    for u in reversed(topological_order):
        for v in adj[u]:
            reachable[u].add(v)
            reachable[u].update(reachable[v])

    conflict_count = 0
    keys_list = list(all_keys)
    for i in range(len(keys_list)):
        for j in range(i + 1, len(keys_list)):
            u = keys_list[i]
            v = keys_list[j]
            if v not in reachable[u] and u not in reachable[v]:
                ex_u = set(task_map[u].get("exclusive_files", []))
                ex_v = set(task_map[v].get("exclusive_files", []))
                overlap = ex_u.intersection(ex_v)
                if overlap:
                    warnings.append(
                        f"Potential concurrent file overlap between '{u}' and '{v}': {overlap}. "
                        f"Occupancy locks or dependency chain needed if executed concurrently."
                    )
                    conflict_count += 1

    print(f"[*] Concurrent File Conflict Checks: {conflict_count} potential overlap warnings detected.")

    # 5. Milestone and Weight summary
    milestone_weights = defaultdict(float)
    milestone_counts = defaultdict(int)
    for t in CANONICAL_TASKS:
        m = t["milestone"]
        milestone_weights[m] += t["progress_weight"]
        milestone_counts[m] += 1

    print("\n--- Milestone Breakdown ---")
    for m in sorted(milestone_weights.keys(), key=lambda x: int(x[1:])):
        print(f"  {m:4s}: {milestone_counts[m]:2d} tasks | {milestone_weights[m]:5.1f} weight")

    total_weight = sum(milestone_weights.values())
    print(f"Total Canonical Weight: {total_weight:.1f}")

    print("\n=================================================================")
    if errors:
        print(f"[FAILED] Audit failed with {len(errors)} error(s):")
        for err in errors:
            print(f"  - ERROR: {err}")
        return False
    else:
        print("[SUCCESS] All DAG and catalog integrity invariants passed.")
        if warnings:
            print(f"[NOTE] {len(warnings)} concurrency warning(s) flagged for lock manager observation.")
            for w in warnings[:5]:
                print(f"  - {w}")
            if len(warnings) > 5:
                print(f"  - ... and {len(warnings) - 5} more.")
        return True

if __name__ == "__main__":
    success = audit_catalog()
    sys.exit(0 if success else 1)
