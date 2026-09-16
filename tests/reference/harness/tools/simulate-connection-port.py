#!/usr/bin/env python3
"""
Executable oracle for docs/isolation/connection-rust-port-spec.md §3–§6 (every non-wf.* probe).

Runs (a) the literal transcription of common/get-connected-nodes.ts (spec §3) and
(b) the algorithm currently in crates/n8n-connection/src/lib.rs, against the pinned
fixtures tests/reference/connection/*/{case,expected}.json. No cargo required.

  python3 tests/reference/harness/tools/simulate-connection-port.py
"""
import json, glob, os, sys
ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'connection')

def ref_gcn(conns, name, filt, depth, checked_in=None):          # spec §3, line refs = get-connected-nodes.ts
    nd = depth if depth == -1 else depth - 1                     # L18
    if depth == 0: return []                                     # L19
    if name not in conns: return []                              # L24
    if filt == 'ALL': types = list(conns[name].keys())           # L29-37
    elif filt == 'ALL_NON_MAIN': types = [t for t in conns[name] if t != 'main']
    else: types = [filt]
    ret = []
    for t in types:                                              # L45
        if t not in conns[name]: continue
        checked = list(checked_in) if checked_in else []         # L52 per-type copy
        if name in checked: continue
        checked.append(name)
        for slot in conns[name][t]:
            for con in (slot or []):
                if con['node'] in checked: continue
                ret.insert(0, con['node'])                       # L67 unshift
                add = ref_gcn(conns, con['node'], filt, nd, checked)
                for i in range(len(add) - 1, -1, -1):            # L77 reverse iteration
                    n = add[i]
                    if n in ret: ret.remove(n)                   # L86
                    ret.insert(0, n)                             # L89
    return ret

def rust_gcn(conns, name, filt, depth, checked=None):            # crates/n8n-connection/src/lib.rs @ 8ed00851
    if checked is None: checked = set()
    if name in checked or depth == 0: return []
    checked.add(name)
    direct, rec = [], []
    for t, slots in (conns.get(name) or {}).items():
        ok = (t == filt) if filt not in ('ALL', 'ALL_NON_MAIN') else (True if filt == 'ALL' else t != 'main')
        if not ok: continue
        for slot in slots:
            for it in (slot or []):
                if it['node'] not in direct: direct.append(it['node'])
    nd = depth - 1 if depth > 0 else -1
    for n in direct:
        for s in rust_gcn(conns, n, filt, nd, checked):
            if s not in rec and s not in direct: rec.append(s)
    res = rec[:]
    for d in direct:
        if d not in res: res.append(d)
    return res

def by_dest(c):                                                  # spec §4
    r = {}
    for s, bt in c.items():
        for t, slots in bt.items():
            for i, slot in enumerate(slots):
                for it in (slot or []):
                    e = r.setdefault(it['node'], {}).setdefault(it['type'], [])
                    while len(e) <= it['index']: e.append([])
                    e[it['index']].append({'node': s, 'type': t, 'index': i})
    return r


# ---------------------------------------------------------------- spec §5 (graph/graph-utils.ts)
def _key(c): return (c['node'], c['type'], c['index'])
def build_adjacency_list(by_source):                             # L170-204; all types; IndexSet semantics
    adj = {}
    for src, bt in by_source.items():
        for t, slots in bt.items():
            for slot in slots:
                for con in (slot or []):
                    lst = adj.setdefault(src, [])
                    if _key(con) not in map(_key, lst): lst.append(con)
    return adj
def _main_targets(adj, nid, exclude_self):
    return [x['node'] for x in adj.get(nid, []) if x['type'] == 'main' and (not exclude_self or x['node'] != nid)]
def _uniq(seq):
    out = []
    for x in seq:
        if x not in out: out.append(x)
    return out
def get_input_edges(graph, adj):                                 # L41-56
    return [[f, to] for f, tos in adj.items() if f not in graph for to in tos if to['node'] in graph]
def get_output_edges(graph, adj):                                # L62-76
    return [[f, to] for f, tos in adj.items() if f in graph for to in tos if to['node'] not in graph]
def get_root_nodes(graph, adj):                                  # L103-118
    inner = _uniq(n for nid in graph for n in _main_targets(adj, nid, True))
    return [g for g in graph if g not in inner]
def get_leaf_nodes(graph, adj):                                  # L123-140
    return [nid for nid in graph if not [n for n in _main_targets(adj, nid, True) if n in graph]]
def has_path(start, end, adj):                                   # L145-160 DFS stack, main-only
    seen, paths = [], [start]
    while True:
        if not paths: return False
        nxt = paths.pop()
        if nxt == end: return True
        seen.append(nxt)
        paths.extend([n for n in _uniq(_main_targets(adj, nxt, False)) if n not in seen])
def parse_extractable(graph, adj):                               # L209-273
    errors = []
    input_nodes = _uniq(e[1]['node'] for e in get_input_edges(graph, adj) if e[1]['type'] == 'main')
    roots = get_root_nodes(graph, adj)
    if not roots and len(input_nodes) == 1: roots = list(input_nodes)
    for n in [n for n in input_nodes if n not in roots]:
        errors.append({'errorCode': 'Input Edge To Non-Root Node', 'node': n})
    root_input = [n for n in roots if n in input_nodes]
    if len(root_input) > 1: errors.append({'errorCode': 'Multiple Input Nodes', 'nodes': root_input})
    output_nodes = _uniq(e[0] for e in get_output_edges(graph, adj) if e[1]['type'] == 'main')
    leaves = get_leaf_nodes(graph, adj)
    if not leaves and len(output_nodes) == 1: leaves = list(output_nodes)
    for n in [n for n in output_nodes if n not in leaves]:
        errors.append({'errorCode': 'Output Edge From Non-Leaf Node', 'node': n})
    leaf_output = [n for n in leaves if n in output_nodes]
    if len(leaf_output) > 1: errors.append({'errorCode': 'Multiple Output Nodes', 'nodes': leaf_output})
    start = root_input[0] if root_input else None
    end = leaf_output[0] if leaf_output else None
    if start and end and not has_path(start, end, adj):
        errors.append({'errorCode': 'No Continuous Path From Root To Leaf In Selection', 'start': start, 'end': end})
    if errors: return errors
    out = {}
    if start is not None: out['start'] = start
    if end is not None: out['end'] = end
    return out

# ---------------------------------------------------------------- spec §6 (connections-diff.ts)
def compare_connections(prev, nxt):                              # L15-87
    added, removed = {}, {}
    for node in _uniq(list(prev) + list(nxt)):
        pt, nt = prev.get(node) or {}, nxt.get(node) or {}
        for t in _uniq(list(pt) + list(nt)):
            ps, ns = pt.get(t) or [], nt.get(t) or []
            for si in range(max(len(ps), len(ns))):
                pc = (ps[si] if si < len(ps) else None) or []
                nc = (ns[si] if si < len(ns) else None) or []
                pm = {json.dumps(c, separators=(',', ':')): {'index': i, 'connection': c} for i, c in enumerate(pc)}
                nm = {json.dumps(c, separators=(',', ':')): {'index': i, 'connection': c} for i, c in enumerate(nc)}
                for k, v in nm.items():
                    if k not in pm: added.setdefault(node, {}).setdefault(t, []).append({'sourceIndex': si, 'value': v})
                for k, v in pm.items():
                    if k not in nm: removed.setdefault(node, {}).setdefault(t, []).append({'sourceIndex': si, 'value': v})
    return {'added': added, 'removed': removed}

GRAPH_OPS = {
    'getRootNodes':      lambda p, adj, c: get_root_nodes(p['graph'], adj),
    'getLeafNodes':      lambda p, adj, c: get_leaf_nodes(p['graph'], adj),
    'getInputEdges':     lambda p, adj, c: get_input_edges(p['graph'], adj),
    'getOutputEdges':    lambda p, adj, c: get_output_edges(p['graph'], adj),
    'hasPath':           lambda p, adj, c: has_path(p['start'], p['end'], adj),
    'parseExtractable':  lambda p, adj, c: parse_extractable(p['graph'], adj),
    'compareConnections':lambda p, adj, c: compare_connections(c, p['next']),
    'adjacencyKeys':     lambda p, adj, c: list(adj.keys()),
}

def run(impl, label):
    ok = tot = 0
    for f in sorted(glob.glob(os.path.join(ROOT, '*', 'case.json'))):
        c = json.load(open(f)); e = json.load(open(f.replace('case.json', 'expected.json')))
        bd = by_dest(c['connections'])
        for p in c['probes']:
            if p['op'] in ('getChildNodes', 'getConnectedNodes', 'getParentNodes'):
                m = bd if p['op'] == 'getParentNodes' else c['connections']
                got = impl(m, p['node'], p.get('type', 'main'), p.get('depth', -1))
            elif p['op'] == 'byDestination':
                got = bd.get(p['node']) if p.get('node') else bd
            elif impl is ref_gcn and p['op'] in GRAPH_OPS:
                adj = build_adjacency_list(c['connections'])
                got = GRAPH_OPS[p['op']](p, adj, c['connections'])
            else:
                continue
            tot += 1
            if got == e[p['name']]: ok += 1
            else: print(f'  [{label}] MISMATCH {os.path.basename(os.path.dirname(f))} :: {p["name"]}\n      got {got}\n      exp {e[p["name"]]}')
    print(f'{label}: {ok}/{tot}')
    return ok == tot

if __name__ == '__main__':
    a = run(ref_gcn, 'spec §3-§6 transcription')
    b = run(rust_gcn, 'crates/n8n-connection @ 8ed00851')
    sys.exit(0 if a else 1)
