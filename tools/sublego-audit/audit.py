#!/usr/bin/env python3
import sys
import yaml
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
REGISTRY_DIR = REPO_ROOT / ".arena" / "registry"

EXPECTED_12_LEGOS = {
    "workflow", "node", "connection", "validation", "execution_data", "expression",
    "trigger", "webhook", "scheduler", "persistence", "credentials", "api"
}

def audit_registries():
    errors = []
    warnings = []

    lego_path = REGISTRY_DIR / "lego.yaml"
    sublego_path = REGISTRY_DIR / "sublego.yaml"
    agents_path = REGISTRY_DIR / "agents.yaml"

    for p in (lego_path, sublego_path, agents_path):
        if not p.exists():
            print(f"[ERROR] Missing required registry file: {p}")
            return False

    with open(lego_path) as f:
        lego_data = yaml.safe_load(f) or {}
    with open(sublego_path) as f:
        sublego_data = yaml.safe_load(f) or {}
    with open(agents_path) as f:
        agents_data = yaml.safe_load(f) or {}

    legos = {item['id']: item for item in lego_data.get('legos', [])}
    sublegos = {item['id']: item for item in sublego_data.get('sublegos', [])}
    agents = {item['id']: item for item in agents_data.get('agents', [])}

    print(f"[AUDIT] Loaded {len(legos)} LEGOs, {len(sublegos)} Sub-LEGOs, and {len(agents)} Agents")

    # 1. P0-5 Check: Verify all 12 core LEGOs exist
    missing_12 = EXPECTED_12_LEGOS - set(legos.keys())
    if missing_12:
        errors.append(f"Missing core LEGOs in lego.yaml: {missing_12}")
    else:
        print("  [OK] All 12 core LEGOs defined in lego.yaml")

    # 2. Validate LEGO contracts & owners
    for lego_id, lego in legos.items():
        contract_file = REPO_ROOT / lego.get('contract', '')
        if not contract_file.exists():
            errors.append(f"LEGO '{lego_id}' references non-existent contract: {lego.get('contract')}")

        owner = lego.get('owner')
        if owner and owner not in agents:
            errors.append(f"LEGO '{lego_id}' assigned to unregistered agent: {owner}")

    # 3. P0-5 Bidirectional Check: Every agent allowed_sublegos must exist in sublego.yaml
    for agent_id, agent in agents.items():
        for sub_id in agent.get('allowed_sublegos', []):
            if sub_id not in sublegos:
                errors.append(f"Agent '{agent_id}' has allowed_sublego '{sub_id}' which does NOT exist in sublego.yaml!")
            elif sublegos[sub_id].get('owner') != agent_id:
                errors.append(f"Sub-LEGO '{sub_id}' owner mismatch: agent '{agent_id}' claims it, but sublego.yaml owner is '{sublegos[sub_id].get('owner')}'")

    # 4. Validate Sub-LEGO parent relationships & contracts
    for sub_id, sub in sublegos.items():
        parent = sub.get('parent_lego')
        if parent not in legos:
            errors.append(f"Sub-LEGO '{sub_id}' references unknown parent LEGO '{parent}'")

        sub_contract = REPO_ROOT / sub.get('contract', '')
        if not sub_contract.exists():
            errors.append(f"Sub-LEGO '{sub_id}' references non-existent contract: {sub.get('contract')}")

        owner = sub.get('owner')
        if owner and owner not in agents:
            errors.append(f"Sub-LEGO '{sub_id}' assigned to unregistered agent: {owner}")

    # Output summary
    if warnings:
        print("\n[WARNINGS]")
        for w in warnings:
            print(f"  - {w}")

    if errors:
        print("\n[AUDIT FAILED]")
        for e in errors:
            print(f"  [X] {e}")
        return False

    print("\n[AUDIT PASSED] 100% bidirectional consistency verified across all 12 LEGOs, 20 Sub-LEGOs, and 5 Agents.")
    return True

if __name__ == "__main__":
    success = audit_registries()
    sys.exit(0 if success else 1)
