#!/usr/bin/env python3
"""Independent cross-check oracle for the workflow compatibility suite.

Second, independent implementation of the reference behavior, translated
directly (line by line) from the original n8n TypeScript sources:

    reference/n8n/packages/workflow/src/common/get-connected-nodes.ts
    reference/n8n/packages/workflow/src/common/get-child-nodes.ts
    reference/n8n/packages/workflow/src/common/get-parent-nodes.ts
    reference/n8n/packages/workflow/src/common/map-connections-by-destination.ts
    (n8n v2.9.4)

plus the spec-defined functions (docs/isolation/workflow_spec.md §3, §7.2).

It speaks the exact same query grammar / output format as
`reference/harness.mjs` (one line per query: `<query>\t<canonical-json>`),
so its output can be diffed against:
  1. the golden files (node harness output) for fixtures, and
  2. the node harness output for arbitrary workflow JSON files
     (e.g. the real reference workflows in tests/reference/).

Canonical JSON: object keys sorted at every level, compact separators —
byte-identical to JS `JSON.stringify(sortKeys(...))` for ASCII data.

Usage:
    python3 crosscheck.py <fixture-or-workflow.json>   # prints query lines
    python3 crosscheck.py --emit-fixture <wf.json> <out.json>
        # adapt a plain workflow JSON (nodes+connections) to fixture schema
        # with the standard query set

Exit code 0 on success.
"""

import json
import sys

# ────────────────────────────────────────────────────────────────────────────
# ORIGINAL n8n functions — independent translation (see module docstring)
# ────────────────────────────────────────────────────────────────────────────

def get_connected_nodes(connections, node_name, connection_type="main",
                        depth=-1, checked_nodes_incoming=None):
    """Original `getConnectedNodes` (common/get-connected-nodes.ts)."""
    new_depth = depth if depth == -1 else depth - 1
    if depth == 0:
        # Reached max depth
        return []

    if node_name not in connections:
        # Node does not have incoming connections
        return []

    if connection_type == "ALL":
        types = list(connections[node_name].keys())
    elif connection_type == "ALL_NON_MAIN":
        types = [t for t in connections[node_name].keys() if t != "main"]
    else:
        types = [connection_type]

    return_nodes = []

    for type_ in types:
        if type_ not in connections[node_name]:
            # Node does not have incoming connections of given type
            continue

        checked_nodes = (list(checked_nodes_incoming)
                         if checked_nodes_incoming is not None else [])

        if node_name in checked_nodes:
            # Node got checked already before
            continue

        checked_nodes.append(node_name)

        for connections_by_index in connections[node_name][type_]:
            if connections_by_index is None:
                continue  # original: `connectionsByIndex?.forEach`
            for connection in connections_by_index:
                if connection["node"] in checked_nodes:
                    # Node got checked already before
                    continue

                return_nodes.insert(0, connection["node"])

                add_nodes = get_connected_nodes(
                    connections, connection["node"], connection_type,
                    new_depth, checked_nodes,
                )

                # Original: `for (i = addNodes.length; i--; i > 0)` —
                # body runs for i = n-1 ..= 0.
                for i in range(len(add_nodes) - 1, -1, -1):
                    parent_node_name = add_nodes[i]
                    if parent_node_name in return_nodes:
                        return_nodes.remove(parent_node_name)
                    return_nodes.insert(0, parent_node_name)

    return return_nodes


def get_child_nodes(connections_by_source_node, node_name,
                    connection_type="main", depth=-1):
    """Original `getChildNodes` (common/get-child-nodes.ts)."""
    return get_connected_nodes(connections_by_source_node, node_name,
                               connection_type, depth)


def get_parent_nodes(connections_by_destination_node, node_name,
                     connection_type="main", depth=-1):
    """Original `getParentNodes` (common/get-parent-nodes.ts)."""
    return get_connected_nodes(connections_by_destination_node, node_name,
                               connection_type, depth)


def map_connections_by_destination(connections):
    """Original `mapConnectionsByDestination`
    (common/map-connections-by-destination.ts)."""
    return_connection = {}

    for source_node in connections:  # insertion order (fixture convention)
        for type_ in connections[source_node]:
            for input_index, connections_by_index in enumerate(
                    connections[source_node][type_]):
                for connection_info in (
                        connections_by_index
                        if connections_by_index is not None else []):
                    dest_node = connection_info["node"]
                    if dest_node not in return_connection:
                        return_connection[dest_node] = {}
                    if connection_info["type"] not in return_connection[dest_node]:
                        return_connection[dest_node][connection_info["type"]] = []

                    arr = return_connection[dest_node][connection_info["type"]]
                    max_index = len(arr) - 1
                    j = max_index
                    while j < connection_info["index"]:
                        arr.append([])
                        j += 1

                    if connection_info["index"] < len(arr):
                        arr[connection_info["index"]].append({
                            "node": source_node,
                            "type": type_,
                            "index": input_index,
                        })

    return return_connection


# ────────────────────────────────────────────────────────────────────────────
# SPEC-DEFINED pure functions (workflow_spec.md §3 — same algorithm as the
# node harness)
# ────────────────────────────────────────────────────────────────────────────

def _edges_of(connections, scope):
    nodes = set()
    adj = {}
    for source in connections:
        nodes.add(source)
        for type_ in connections[source]:
            if scope == "main" and type_ != "main":
                continue
            for slot in connections[source][type_]:
                if slot is None:
                    continue
                for conn in slot:
                    nodes.add(conn["node"])
                    adj.setdefault(source, []).append(conn["node"])
    for k in adj:
        adj[k].sort()
    return sorted(nodes), adj


def find_cycle(connections, scope):
    node_names, adj = _edges_of(connections, scope)
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {n: WHITE for n in node_names}
    stack = []
    found = []

    def visit(v):
        if found:
            return True
        color[v] = GRAY
        stack.append(v)
        for u in adj.get(v, []):
            c = color.get(u, WHITE)
            if c == GRAY:
                i = stack.index(u)
                found.extend(stack[i:])
                return True
            if c == WHITE and visit(u):
                return True
        stack.pop()
        color[v] = BLACK
        return False

    for n in node_names:
        if color[n] == WHITE and visit(n):
            return list(found)
    return None


def detect_cycles(connections, scope):
    return find_cycle(connections, scope) is not None


def get_start_nodes(node_names, by_destination):
    out = []
    for name in sorted(node_names):
        by_type = by_destination.get(name)
        if by_type is None:
            out.append(name)
            continue
        slots = by_type.get("main")
        has_incoming = (isinstance(slots, list) and
                        any(isinstance(s, list) and len(s) > 0 for s in slots))
        if not has_incoming:
            out.append(name)
    return out


# ────────────────────────────────────────────────────────────────────────────
# Canonical JSON (byte-identical to JS JSON.stringify(sortKeys(...)) for
# ASCII data: sorted keys at every level, compact separators, standard
# escapes)
# ────────────────────────────────────────────────────────────────────────────

def canonicalize(value):
    # ensure_ascii=False ⇒ non-ASCII passes through unescaped, exactly like
    # JS JSON.stringify (byte-identical canonical form for UTF-8 data).
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False)


def project_node(n):
    return {
        "disabled": n.get("disabled") is True,
        "name": n["name"],
        "position": n["position"],
        "type": n["type"],
        "typeVersion": n["typeVersion"],
    }


# ────────────────────────────────────────────────────────────────────────────
# Query engine (mirrors harness.mjs 1:1)
# ────────────────────────────────────────────────────────────────────────────

def run_query(q, ctx):
    parts = q.split(":")
    head = parts[0]

    if head == "mapByDestination":
        return canonicalize(map_connections_by_destination(ctx["by_source"]))

    if head == "getChild":
        return canonicalize(get_child_nodes(
            ctx["by_source"], parts[1],
            parts[2] if len(parts) > 2 else "main",
            int(parts[3]) if len(parts) > 3 else -1,
        ))

    if head == "getParent":
        return canonicalize(get_parent_nodes(
            ctx["by_destination"], parts[1],
            parts[2] if len(parts) > 2 else "main",
            int(parts[3]) if len(parts) > 3 else -1,
        ))

    if head == "getConnected":
        return canonicalize(get_connected_nodes(
            ctx["by_source"], parts[1],
            parts[2] if len(parts) > 2 else "main",
            int(parts[3]) if len(parts) > 3 else -1,
        ))

    if head == "getNode":
        nodes = ctx["nodes"]
        n = nodes[parts[1]] if parts[1] in nodes else None
        return canonicalize(project_node(n)) if n else "null"

    if head == "getAllNodes":
        return canonicalize(ctx["node_names"])

    if head == "detectCycles":
        scope = parts[1] if len(parts) > 1 else "main"
        return canonicalize(detect_cycles(ctx["by_source"], scope))

    if head == "findCycle":
        scope = parts[1] if len(parts) > 1 else "main"
        return canonicalize(find_cycle(ctx["by_source"], scope))

    if head == "getStartNodes":
        return canonicalize(get_start_nodes(ctx["node_names"], ctx["by_destination"]))

    raise ValueError(f"unknown query: {q}")


def build_context(fx):
    nodes = {}
    for n in fx.get("nodes", []):
        nodes[n["name"]] = n
    by_source = fx.get("connections", {})
    by_destination = map_connections_by_destination(by_source)
    return {
        "nodes": nodes,
        "by_source": by_source,
        "by_destination": by_destination,
        "node_names": sorted(nodes.keys()),
    }


STANDARD_QUERIES = [
    "mapByDestination",
    "getAllNodes",
    "getStartNodes",
    "detectCycles:main",
    "findCycle:main",
    "detectCycles:all",
    "findCycle:all",
]


def emit_fixture(wf_path, out_path):
    """Adapt a plain workflow JSON (nodes+connections) to fixture schema."""
    wf = json.load(open(wf_path))
    names = [n["name"] for n in wf.get("nodes", [])]
    queries = list(STANDARD_QUERIES)
    for n in names:
        if ":" in n:
            raise ValueError(f"node name must not contain ':': {n}")
        queries += [f"getChild:{n}", f"getParent:{n}", f"getNode:{n}"]
    fx = {
        "name": wf.get("id", wf.get("name", "adapted")),
        "nodes": wf.get("nodes", []),
        "connections": wf.get("connections", {}),
        "queries": queries,
    }
    with open(out_path, "w") as f:
        json.dump(fx, f, indent=2)
        f.write("\n")
    print(f"wrote {out_path} ({len(queries)} queries)")


def main():
    # Deterministic UTF-8 output regardless of locale.
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) >= 2 and sys.argv[1] == "--emit-fixture":
        if len(sys.argv) != 4:
            print("usage: crosscheck.py --emit-fixture <wf.json> <out.json>",
                  file=sys.stderr)
            return 2
        emit_fixture(sys.argv[2], sys.argv[3])
        return 0

    if len(sys.argv) != 2:
        print("usage: crosscheck.py <fixture.json>", file=sys.stderr)
        return 2

    fx = json.load(open(sys.argv[1]))
    ctx = build_context(fx)
    lines = [f"{q}\t{run_query(q, ctx)}" for q in fx.get("queries", [])]
    sys.stdout.write("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
