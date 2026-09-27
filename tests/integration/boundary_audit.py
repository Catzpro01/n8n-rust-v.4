#!/usr/bin/env python3
"""Agent 5 — static boundary / dependency / hidden-coupling auditor.

Scans reference/n8n/packages/workflow/src, maps every module to the LEGO that
owns it (per docs/LEGO_PARALLEL_RULES.md), and reports:
  * cross-LEGO edges (DIRECT RUNTIME vs TYPE-ONLY)
  * circular dependencies between LEGOs
  * hidden coupling signals (global state, env vars, filesystem/db access)
  * Rust placement (phase-aware, see below)

Rust placement guard
  * `reference/n8n/` is the upstream TypeScript snapshot and must NEVER contain
    `.rs` files or a `Cargo.toml`, in any phase (reference-source integrity).
  * `crates/` and `apps/` were forbidden to hold Rust while
    PHASE_2_LEGO_ISOLATION was active. The active phase is read from
    `.arena/state/phases.yaml`; once Phase 2 is `completed` and
    PHASE_3_RUST_RUNTIME (or later) is `active`, Rust under `crates/` is the
    expected state and is reported as allowed. If the phase file is missing or
    unreadable the guard fails closed and applies the Phase-2 rule.

Read-only: it never modifies reference source. Exit 1 on undocumented findings.
Run with `--selftest` to exercise the phase parser and the guard on a temp tree.
"""
import os, re, sys, json

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "reference", "n8n", "packages", "workflow", "src")
PHASES = os.path.join(ROOT, ".arena", "state", "phases.yaml")
RUST_FREE_ALWAYS = (os.path.join("reference", "n8n"),)
RUST_FREE_PHASE2 = ("crates", "apps")

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

def read_phases(path=None):
    """Parse the tiny `.arena/state/phases.yaml` (id/status pairs) without PyYAML.

    Returns {phase_id: status} or None when the file is missing/unparseable.
    """
    path = path or PHASES
    try:
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    except OSError:
        return None
    phases, current = {}, None
    for raw in lines:
        line = raw.split("#", 1)[0].rstrip()
        m = re.match(r"^\s*-\s*id:\s*([A-Za-z0-9_.-]+)\s*$", line)
        if m:
            current = m.group(1)
            phases.setdefault(current, "unknown")
            continue
        m = re.match(r"^\s*status:\s*([A-Za-z_-]+)\s*$", line)
        if m and current:
            phases[current] = m.group(1).lower()
    return phases or None

def rust_policy(phases):
    """Decide where Rust is forbidden.

    Returns (forbidden_bases, reason). Fail-closed: no readable phase file means
    the strict Phase-2 rule applies.
    """
    if not phases:
        return RUST_FREE_ALWAYS + RUST_FREE_PHASE2, "phase file unreadable -> Phase-2 rule applied (fail-closed)"
    if phases.get("PHASE_2_LEGO_ISOLATION") == "active":
        return RUST_FREE_ALWAYS + RUST_FREE_PHASE2, "PHASE_2_LEGO_ISOLATION active -> no Rust in crates/ or apps/"
    active = [pid for pid, st in phases.items() if st == "active"]
    label = ", ".join(active) if active else "no active phase, Phase 2 completed"
    return RUST_FREE_ALWAYS, f"{label} -> Rust allowed under crates/ (workspace), reference/n8n/ stays Rust-free"

def rust_offenders(bases, root=None):
    root = root or ROOT
    offenders = []
    for base in bases:
        for dp, _dn, fn in os.walk(os.path.join(root, base)):
            if "node_modules" in dp.split(os.sep):
                continue
            for f in fn:
                if f.endswith(".rs") or f == "Cargo.toml":
                    offenders.append(os.path.relpath(os.path.join(dp, f), root).replace(os.sep, "/"))
    return sorted(offenders)

def rust_guard(root=None, phases_path=None):
    """Return (offenders, reason) for the current phase."""
    bases, reason = rust_policy(read_phases(phases_path))
    return rust_offenders(bases, root), reason

def selftest():
    import tempfile, shutil
    tmp = tempfile.mkdtemp(prefix="boundary-audit-selftest-")
    try:
        def touch(rel):
            p = os.path.join(tmp, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            open(p, "w", encoding="utf-8").close()
        def phases_file(name, body):
            p = os.path.join(tmp, name)
            with open(p, "w", encoding="utf-8") as fh:
                fh.write(body)
            return p
        touch("crates/n8n-workflow/src/lib.rs")
        touch("crates/n8n-workflow/Cargo.toml")
        touch("apps/n8n-ts/node_modules/dep/Cargo.toml")   # vendored, ignored
        touch("apps/n8n-ts/src/server.ts")
        touch("reference/n8n/packages/workflow/src/workflow.ts")

        p2 = phases_file("phases-p2.yaml", "phases:\n  - id: PHASE_2_LEGO_ISOLATION\n    status: active\n")
        p3 = phases_file("phases-p3.yaml", "phases:\n  - id: PHASE_2_LEGO_ISOLATION\n    status: completed\n  - id: PHASE_3_RUST_RUNTIME\n    status: active # comment\n")

        checks = []
        off, why = rust_guard(tmp, p3)
        checks.append(("phase 3: crates Rust allowed", off == [], f"{off} / {why}"))
        off, why = rust_guard(tmp, p2)
        checks.append(("phase 2: crates Rust flagged", off == ["crates/n8n-workflow/Cargo.toml", "crates/n8n-workflow/src/lib.rs"], f"{off} / {why}"))
        off, why = rust_guard(tmp, os.path.join(tmp, "missing.yaml"))
        checks.append(("missing phase file fails closed", len(off) == 2 and "fail-closed" in why, f"{off} / {why}"))
        touch("reference/n8n/packages/core/native.rs")
        off, why = rust_guard(tmp, p3)
        checks.append(("phase 3: Rust inside reference/n8n still flagged", off == ["reference/n8n/packages/core/native.rs"], f"{off} / {why}"))
        checks.append(("phase parser reads id/status pairs", read_phases(p3) == {"PHASE_2_LEGO_ISOLATION": "completed", "PHASE_3_RUST_RUNTIME": "active"}, str(read_phases(p3))))

        failed = 0
        for name, ok, detail in checks:
            print(f"[{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f" -> {detail}"))
            failed += 0 if ok else 1
        print(f"SELFTEST: {len(checks) - failed}/{len(checks)} passed")
        return 1 if failed else 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

def main():
    if "--selftest" in sys.argv[1:]:
        return selftest()
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

    offenders, reason = rust_guard()
    print(f"\n-- Rust placement guard ({reason}) --")
    print(f"  {'VIOLATION ' + str(offenders) if offenders else 'clean'}")

    print("\n-------------------------------------------------------")
    failed = bool(undocumented) or bool(offenders)
    if undocumented:
        print(f"BOUNDARY VIOLATION: {len(undocumented)} undocumented edge(s): {undocumented}")
    if offenders:
        print(f"RUST PLACEMENT VIOLATION: {len(offenders)} file(s) outside the allowed zone: {offenders[:5]}")
    print("AUDIT RESULT:", "FAIL" if failed else "PASS (all edges documented)")
    return 1 if failed else 0

if __name__ == "__main__":
    sys.exit(main())
