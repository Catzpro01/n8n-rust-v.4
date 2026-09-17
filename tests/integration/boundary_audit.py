#!/usr/bin/env python3
"""Agent 5 — static boundary / dependency / hidden-coupling auditor.

Scans reference/n8n/packages/workflow/src, maps every module to the LEGO that
owns it (per docs/LEGO_PARALLEL_RULES.md), and reports:
  * cross-LEGO edges (DIRECT RUNTIME vs TYPE-ONLY)
  * circular dependencies between LEGOs
  * hidden coupling signals (global state, env vars, filesystem/db access)
  * phase guard: no Rust in Phase 2; Rust confined to crates/** and apps/**
    once docs/isolation/PHASE-3-OPENING-RECORD.md opens Phase 3

Read-only: it never modifies reference source. Exit 1 on undocumented findings.
"""
import os, re, sys, json

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "reference", "n8n", "packages", "workflow", "src")
OPENING_RECORD = os.path.join(ROOT, "docs", "isolation", "PHASE-3-OPENING-RECORD.md")

LEGO_OWNERSHIP = {
    "workflow":       (["workflow.ts"], "Agent 1"),
    "node":           (["node-helpers.ts", "node-validation.ts", "node-parameters",
                        "node-reference-parser-utils.ts"], "Agent 2"),
    "connection":     (["graph/graph-utils.ts", "connections-diff.ts"], "Agent 3"),
    "validation":     (["workflow-validation.ts", "type-validation.ts"], "Agent 4"),
    "expression":     (["expression.ts", "expressions", "extensions",
                        "expression-sandboxing.ts", "expression-evaluator-proxy.ts",
                        "workflow-data-proxy.ts"], "Agent 3 (support)"),
    "execution-data": (["run-execution-data", "run-execution-data-factory.ts",
                        "execution-context.ts", "execution-status.ts"], "Agent 3 (support)"),
    "interfaces":     (["interfaces.ts", "types.d.ts", "schemas.ts"], "shared"),
}
# Cross-LEGO edges accepted as intentional and documented in
# docs/isolation/DEPENDENCY-GRAPH.md. Anything else is a new finding.
ALLOWED_EDGES = {
    ("connection", "interfaces"), ("execution-data", "interfaces"),
    ("execution-data", "shared-util"), ("expression", "execution-data"),
    ("expression", "interfaces"), ("expression", "node"),
    ("expression", "shared-util"), ("expression", "validation"),
    ("expression", "workflow"), ("interfaces", "execution-data"),
    ("interfaces", "shared-util"), ("interfaces", "workflow"),
    ("node", "execution-data"), ("node", "expression"), ("node", "interfaces"),
    ("node", "shared-util"), ("node", "validation"), ("node", "workflow"),
    ("shared-util", "connection"), ("shared-util", "expression"),
    ("shared-util", "interfaces"), ("shared-util", "node"),
    ("validation", "interfaces"), ("validation", "shared-util"),
    ("workflow", "expression"), ("workflow", "interfaces"),
    ("workflow", "node"), ("workflow", "shared-util"),
}

def lego_of(rel):
    for lego, (paths, _owner) in LEGO_OWNERSHIP.items():
        for p in paths:
            if rel == p or rel.startswith(p + "/"):
                return lego
    return "shared-util"

IMPORT_RE = re.compile(r"import\s+(type\s+)?[\s\S]{0,400}?from\s+'(\.[^']+)'")

def build_graph():
    edges, type_only, evidence = {}, {}, {}
    for dp, _dn, fn in os.walk(SRC):
        for f in fn:
            if not f.endswith(".ts"):
                continue
            full = os.path.join(dp, f)
            rel = os.path.relpath(full, SRC)
            if "__tests__" in rel or rel.endswith(".test.ts"):
                continue
            src_lego = lego_of(rel)
            txt = open(full, encoding="utf8", errors="replace").read()
            for m in IMPORT_RE.finditer(txt):
                is_type = bool(m.group(1))
                tp = os.path.normpath(os.path.join(os.path.dirname(rel), m.group(2)))
                resolved = tp
                for cand in (tp + ".ts", tp + "/index.ts", tp):
                    if os.path.exists(os.path.join(SRC, cand)):
                        resolved = cand
                        break
                if resolved.endswith("/index.ts"):
                    resolved = resolved[: -len("/index.ts")]
                dst_lego = lego_of(resolved)
                if dst_lego == src_lego:
                    continue
                key = (src_lego, dst_lego)
                edges.setdefault(key, 0)
                edges[key] += 1
                type_only[key] = type_only.get(key, True) and is_type
                evidence.setdefault(key, set()).add(rel)
    return edges, type_only, evidence

def find_cycles(adj):
    cycles, stack, state = [], [], {}
    def dfs(n):
        state[n] = 1; stack.append(n)
        for m in sorted(adj.get(n, [])):
            if state.get(m) == 1:
                cycles.append(stack[stack.index(m):] + [m])
            elif state.get(m, 0) == 0:
                dfs(m)
        stack.pop(); state[n] = 2
    for n in sorted(adj):
        if state.get(n, 0) == 0:
            dfs(n)
    return cycles

HIDDEN_PATTERNS = {
    "env-coupling": re.compile(r"process\.env"),
    "global-mutable-state": re.compile(r"getGlobalState\(|setGlobalState\("),
    "filesystem-coupling": re.compile(r"require\('fs'\)|from 'node:fs'|from 'fs'"),
    "database-coupling": re.compile(r"typeorm|DataSource|pg\.Client"),
}

def hidden_coupling():
    hits = {}
    for dp, _dn, fn in os.walk(SRC):
        for f in fn:
            if not f.endswith(".ts"):
                continue
            rel = os.path.relpath(os.path.join(dp, f), SRC)
            if "__tests__" in rel or rel.endswith(".test.ts") or rel.endswith("global-state.ts"):
                continue
            txt = open(os.path.join(dp, f), encoding="utf8", errors="replace").read()
            for kind, rx in HIDDEN_PATTERNS.items():
                for i, line in enumerate(txt.splitlines(), 1):
                    if line.lstrip().startswith(("*", "//")):
                        continue
                    if rx.search(line):
                        hits.setdefault(kind, []).append(f"{rel}:{i}")
    return hits

def phase3_open():
    """Phase 3 is open only when the opening record exists AND carries its
    machine markers. A bare file with the right name does not open anything."""
    if not os.path.exists(OPENING_RECORD):
        return False
    text = open(OPENING_RECORD, encoding="utf8", errors="replace").read()
    return (
        "PHASE_3_STATUS: OPEN" in text
        and "PHASE_2_VERDICT: VERIFIED" in text
        and "REFERENCE_PIN: 15050/f8da35180669" in text
    )


def rust_guard():
    """Returns (offenders, mode, detail).

    Phase 2: any .rs / Cargo.toml under crates/ or apps/ is an offender.
    Phase 3: Rust is accepted under crates/** and apps/** (with a root
    workspace manifest); a .rs / Cargo.toml anywhere else is an offender.
    reference/** is excluded from the scan — its integrity belongs to G04."""
    offenders = []
    if not phase3_open():
        for base in ("crates", "apps"):
            for dp, _dn, fn in os.walk(os.path.join(ROOT, base)):
                for f in fn:
                    if f.endswith(".rs") or f == "Cargo.toml":
                        offenders.append(os.path.relpath(os.path.join(dp, f), ROOT))
        return offenders, "phase-2", "no Rust may exist"
    skip = {".git", "reference", "node_modules", "target", ".runtime"}
    for dp, dn, fn in os.walk(ROOT):
        dn[:] = [d for d in dn if d not in skip]
        for f in fn:
            if f.endswith(".rs") or f == "Cargo.toml":
                rel = os.path.relpath(os.path.join(dp, f), ROOT)
                if rel == "Cargo.toml":
                    continue  # root workspace manifest — required, checked below
                if not (rel.startswith("crates/") or rel.startswith("apps/")):
                    offenders.append(rel)
    root_manifest = os.path.join(ROOT, "Cargo.toml")
    if not os.path.exists(root_manifest):
        offenders.append("Cargo.toml: missing root workspace manifest (required in Phase 3)")
    elif "[workspace]" not in open(root_manifest, encoding="utf8", errors="replace").read():
        offenders.append("Cargo.toml: root manifest is not a [workspace] manifest")
    confined = sum(
        1
        for base in ("crates", "apps")
        for _dp, _dn, fn in os.walk(os.path.join(ROOT, base))
        for f in fn
        if f.endswith(".rs") or f == "Cargo.toml"
    )
    return offenders, "phase-3", f"{confined} Rust file(s) confined, workspace manifest present"

def main():
    if not os.path.isdir(SRC):
        print(f"[FAIL] reference source missing: {SRC}")
        return 1
    edges, type_only, evidence = build_graph()
    print("=== [AGENT 5] BOUNDARY & DEPENDENCY AUDIT ===\n")
    print("-- Cross-LEGO dependency edges --")
    undocumented = []
    for (s, d), n in sorted(edges.items()):
        kind = "TYPE-ONLY" if type_only[(s, d)] else "DIRECT RUNTIME"
        flag = "" if (s, d) in ALLOWED_EDGES else "  <== UNDOCUMENTED"
        if flag:
            undocumented.append((s, d))
        ev = sorted(evidence[(s, d)])[:2]
        print(f"  {s:>14} -> {d:<14} [{kind}] x{n}  e.g. {ev}{flag}")

    adj = {}
    for (s, d) in edges:
        adj.setdefault(s, set()).add(d)
    cycles = find_cycles(adj)
    print(f"\n-- Circular dependencies: {len(cycles)} cycle(s) --")
    for c in cycles[:12]:
        print("  " + " -> ".join(c))

    print("\n-- Hidden coupling signals --")
    hits = hidden_coupling()
    if not hits:
        print("  none")
    for kind, locs in sorted(hits.items()):
        print(f"  {kind}: {len(locs)} hit(s) e.g. {locs[:3]}")

    offenders, mode, detail = rust_guard()
    if mode == "phase-2":
        print(f"\n-- Phase-2 Rust guard: {'VIOLATION ' + str(offenders) if offenders else 'clean (no .rs / Cargo.toml)'}")
    else:
        print(f"\n-- Phase-3 Rust confinement: {'VIOLATION ' + str(offenders) if offenders else detail}")

    print("\n-------------------------------------------------------")
    failed = bool(undocumented) or bool(offenders)
    if undocumented:
        print(f"BOUNDARY VIOLATION: {len(undocumented)} undocumented edge(s): {undocumented}")
    if offenders:
        if mode == "phase-2":
            print("PHASE VIOLATION: Rust introduced during Phase 2 (no Phase-3 opening record)")
        else:
            print("PHASE VIOLATION: Rust outside crates/** and apps/**, or workspace manifest missing (Phase 3 confinement)")
    print("AUDIT RESULT:", "FAIL" if failed else "PASS (all edges documented)")
    return 1 if failed else 0

if __name__ == "__main__":
    sys.exit(main())
