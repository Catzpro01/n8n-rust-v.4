#!/usr/bin/env python3
"""Agent 5 — static boundary / dependency / hidden-coupling auditor.

Scans reference/n8n/packages/workflow/src, maps every module to the LEGO that
owns it (per docs/LEGO_PARALLEL_RULES.md), and reports:
  * cross-LEGO edges (DIRECT RUNTIME vs TYPE-ONLY)
  * circular dependencies between LEGOs
  * hidden coupling signals (global state, env vars, filesystem/db access)
  * reference-source integrity (no Rust in Phase 2)
  * Rust legacy archive hygiene (legacy/rust-port/ documented; no root cargo manifest)

Read-only: it never modifies reference source. Exit 1 on undocumented findings.
"""
import os, re, sys, json

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "reference", "n8n", "packages", "workflow", "src")

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

def rust_guard():
    offenders = []
    for base in ("crates", "apps"):
        for dp, _dn, fn in os.walk(os.path.join(ROOT, base)):
            for f in fn:
                if f.endswith(".rs") or f == "Cargo.toml":
                    offenders.append(os.path.relpath(os.path.join(dp, f), ROOT))
    return offenders

def legacy_archive_findings():
    """PROJECT_RULES #1: the Phase-3 Rust track lives archived under legacy/rust-port/.

    The archive is allowed to exist; it is NOT allowed to be undocumented, and it must not
    present a cargo manifest at the repository root (cargo auto-discovers Cargo.toml upward),
    which would silently turn this ZERO RUST tree back into a Rust workspace.
    """
    findings = []
    legacy = os.path.join(ROOT, "legacy", "rust-port")
    if not os.path.isdir(legacy):
        return findings
    if not os.path.isfile(os.path.join(legacy, "README.md")):
        findings.append("legacy/rust-port/ exists without README.md")
    crates = os.path.join(legacy, "crates")
    if not os.path.isdir(crates) or not os.listdir(crates):
        findings.append("legacy/rust-port/crates/ missing or empty")
    for name in ("Cargo.toml", "Cargo.lock"):
        if os.path.exists(os.path.join(ROOT, name)):
            findings.append(f"{name} at the repository root (cargo would build this tree)")
    return findings

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

    offenders = rust_guard()
    print(f"\n-- Phase-2 Rust guard: {'VIOLATION ' + str(offenders) if offenders else 'clean (no .rs / Cargo.toml)'}")
    legacy = legacy_archive_findings()
    print(f"-- Rust legacy archive: {'FINDINGS ' + str(legacy) if legacy else 'documented and inert (legacy/rust-port/)'}")

    print("\n-------------------------------------------------------")
    failed = bool(undocumented) or bool(offenders) or bool(legacy)
    if undocumented:
        print(f"BOUNDARY VIOLATION: {len(undocumented)} undocumented edge(s): {undocumented}")
    if offenders:
        print("PHASE VIOLATION: Rust introduced during Phase 2")
    if legacy:
        print(f"ARCHIVE VIOLATION: {legacy}")
    print("AUDIT RESULT:", "FAIL" if failed else "PASS (all edges documented)")
    return 1 if failed else 0

if __name__ == "__main__":
    sys.exit(main())
