#!/usr/bin/env python3
"""
Executable oracle for docs/isolation/connection-rust-port-spec.md §3/§4.

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
            else:
                continue
            tot += 1
            if got == e[p['name']]: ok += 1
            else: print(f'  [{label}] MISMATCH {os.path.basename(os.path.dirname(f))} :: {p["name"]}\n      got {got}\n      exp {e[p["name"]]}')
    print(f'{label}: {ok}/{tot}')
    return ok == tot

if __name__ == '__main__':
    a = run(ref_gcn, 'spec §3 transcription')
    b = run(rust_gcn, 'crates/n8n-connection @ 8ed00851')
    sys.exit(0 if a else 1)
