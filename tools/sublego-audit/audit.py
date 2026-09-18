#!/usr/bin/env python3
import sys
import yaml
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
REGISTRY_DIR = REPO_ROOT / ".arena" / "registry"

def audit_registries():
    errors = []
    warnings = []

    lego_path = REGISTRY_DIR / "lego.yaml"
    sublego_path = REGISTRY_DIR / "sublego.yaml"
    agents_path = REGISTRY_DIR / "agents.yaml"

    if not lego_path.exists():
        errors.append(f"Missing registry: {lego_path}")
    if not sublego_path.exists():
        errors.append(f"Missing registry: {sublego_path}")
    if not agents_path.exists():
        errors.append(f"Missing registry: {agents_path}")

    if errors:
        for err in errors:
            print(f"[ERROR] {err}")
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

    # 1. Validate LEGO contracts & owners
    for lego_id, lego in legos.items():
        contract_file = REPO_ROOT / lego.get('contract', '')
        if not contract_file.exists():
            errors.append(f"LEGO '{lego_id}' references non-existent contract: {lego.get('contract')}")

        owner = lego.get('owner')
        if owner and owner not in agents:
            errors.append(f"LEGO '{lego_id}' assigned to unregistered agent: {owner}")

        if not lego.get('allowed_paths'):
            warnings.append(f"LEGO '{lego_id}' has no allowed_paths defined")

    # 2. Validate Sub-LEGO parent relationships & contracts
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

        # Check path overlaps with parent forbidden paths
        if parent in legos:
            parent_forbidden = legos[parent].get('forbidden_paths', [])
            for p in sub.get('allowed_paths', []):
                if p in parent_forbidden:
                    errors.append(f"Sub-LEGO '{sub_id}' allowed path '{p}' conflicts with parent forbidden path")

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

    print("\n[AUDIT PASSED] All LEGO/Sub-LEGO boundaries and ownership registries are valid.")
    return True

if __name__ == "__main__":
    success = audit_registries()
    sys.exit(0 if success else 1)
