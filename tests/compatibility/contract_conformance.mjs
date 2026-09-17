#!/usr/bin/env node
// Agent 5 — offline contract-conformance harness.
// Checks the golden reference workflows in tests/reference/* against the
// invariants declared in contracts/*.contract.md. NO network, NO docker,
// NO running n8n required -> can be executed on any checkout.
// It does NOT re-implement n8n behavior; it only asserts that the golden
// fixtures satisfy the contracts the LEGO owners published.
//
// Phase logic (see docs/isolation/PHASE-3-OPENING-RECORD.md):
//   * Phase 2 (no opening record): Rust anywhere under crates/ or apps/ FAILS.
//   * Phase 3 (record present + well-formed): Rust is accepted ONLY under
//     crates/** and apps/** with a root workspace manifest, and four Phase-3
//     invariant checks replace the single Phase-2 guard.
// Negative fixtures: a directory ending in `-invalid` MUST be rejected by the
// check it targets (currently CycleDetection). The suite FAILS if a negative
// fixture is accepted — otherwise a hardcoded "acyclic" detector would pass.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONN_TYPES = ['main', 'ai_tool', 'ai_memory', 'ai_languageModel'];
const OPENING_RECORD = join(ROOT, 'docs', 'isolation', 'PHASE-3-OPENING-RECORD.md');

const results = [];
const check = (name, fn) => {
  try { const d = fn(); results.push({ name, ok: true, detail: d ?? '' }); }
  catch (e) { results.push({ name, ok: false, detail: e.message }); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

// --- contract presence (contracts are the communication channel) -----------
// Phase 2 closed with 12/12 contracts (LEGO-MASTER-MAP section 4); the gate
// asserts all of them, not just the 4 core ones.
const CONTRACTS = [
  'workflow', 'node', 'connection', 'validation',
  'execution-data', 'expression', 'trigger', 'webhook',
  'scheduler', 'persistence', 'credentials', 'api',
];
for (const c of CONTRACTS) {
  check(`contract:${c} present`, () => {
    const p = join(ROOT, 'contracts', `${c}.contract.md`);
    assert(existsSync(p), `missing contracts/${c}.contract.md`);
    return `${readFileSync(p, 'utf8').length} bytes`;
  });
}

// --- golden fixtures -------------------------------------------------------
const refDir = join(ROOT, 'tests', 'reference');
const allFixtures = readdirSync(refDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(refDir, d.name, 'workflow.json')))
  .map((d) => ({
    name: d.name,
    negative: d.name.endsWith('-invalid'),
    wf: JSON.parse(readFileSync(join(refDir, d.name, 'workflow.json'), 'utf8')),
  }));

check('golden fixtures discovered', () => {
  assert(allFixtures.length > 0, 'no golden fixtures found under tests/reference');
  return allFixtures.map((f) => (f.negative ? `${f.name} (negative)` : f.name)).join(', ');
});

const detectCycle = (wf) => {
  const adj = new Map(wf.nodes.map((n) => [n.name, []]));
  for (const [src, byType] of Object.entries(wf.connections))
    for (const outputs of Object.values(byType))
      for (const slot of outputs) for (const c of slot ?? []) adj.get(src).push(c.node);
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map(wf.nodes.map((n) => [n.name, WHITE]));
  const stack = [];
  const visit = (n) => {
    color.set(n, GREY); stack.push(n);
    for (const m of adj.get(n) ?? []) {
      if (color.get(m) === GREY) throw new Error(`cycle detected: ${[...stack, m].join(' -> ')}`);
      if (color.get(m) === WHITE) visit(m);
    }
    stack.pop(); color.set(n, BLACK);
  };
  for (const n of color.keys()) if (color.get(n) === WHITE) visit(n);
  return 'acyclic';
};

for (const { name, negative, wf } of allFixtures) {
  // WorkflowContract schema (negative fixtures must still be well-formed
  // documents — only the targeted rule may reject them).
  check(`${name}: workflow schema`, () => {
    assert(typeof wf.id === 'string' && wf.id, 'id must be a non-empty string');
    assert(typeof wf.name === 'string' && wf.name, 'name must be a non-empty string');
    assert(Array.isArray(wf.nodes), 'nodes must be an array');
    assert(wf.connections && typeof wf.connections === 'object', 'connections must be an object');
    return `${wf.nodes.length} node(s)`;
  });

  // NodeContract schema
  check(`${name}: node schema`, () => {
    for (const n of wf.nodes) {
      assert(typeof n.id === 'string' && n.id, 'node.id required');
      assert(typeof n.name === 'string' && n.name, 'node.name required');
      assert(typeof n.type === 'string' && n.type, 'node.type required');
      assert(Number.isFinite(n.typeVersion), `node ${n.name}: typeVersion must be numeric`);
      assert(Array.isArray(n.position) && n.position.length === 2, `node ${n.name}: position must be [x,y]`);
      assert(n.parameters && typeof n.parameters === 'object', `node ${n.name}: parameters required`);
    }
    return 'ok';
  });

  // WorkflowContract invariant: unique node names
  check(`${name}: NodeUniqueness`, () => {
    const seen = new Set();
    for (const n of wf.nodes) {
      assert(!seen.has(n.name), `duplicate node name '${n.name}'`);
      seen.add(n.name);
    }
    return `${seen.size} unique name(s)`;
  });

  // ConnectionContract schema + DanglingConnections
  check(`${name}: connection schema + DanglingConnections`, () => {
    const names = new Set(wf.nodes.map((n) => n.name));
    let count = 0;
    for (const [src, byType] of Object.entries(wf.connections)) {
      assert(names.has(src), `connection source '${src}' is not a declared node`);
      for (const [type, outputs] of Object.entries(byType)) {
        assert(CONN_TYPES.includes(type), `unknown connection type '${type}'`);
        assert(Array.isArray(outputs), `${src}.${type} must be an array of output slots`);
        outputs.forEach((slot, outIdx) => {
          assert(slot === null || Array.isArray(slot), `${src}.${type}[${outIdx}] must be array|null`);
          for (const c of slot ?? []) {
            assert(names.has(c.node), `dangling connection ${src} -> '${c.node}'`);
            assert(CONN_TYPES.includes(c.type), `unknown target connection type '${c.type}'`);
            assert(Number.isInteger(c.index) && c.index >= 0, `input index must be integer >= 0`);
            assert(outIdx >= 0, 'output index must be >= 0');
            count++;
          }
        });
      }
    }
    return `${count} edge(s)`;
  });

  // ValidationContract: CycleDetection (inverted for negative fixtures)
  if (!negative) {
    check(`${name}: CycleDetection (acyclic)`, () => detectCycle(wf));
  } else {
    check(`${name}: CycleDetection (NEGATIVE — must reject)`, () => {
      let rejected = false;
      try { detectCycle(wf); } catch (e) {
        assert(/cycle detected/.test(e.message), `unexpected rejection reason: ${e.message}`);
        rejected = true;
        return e.message;
      }
      assert(rejected, 'NEGATIVE fixture was accepted as acyclic — cycle detector is not falsifiable');
    });
  }
}

// --- phase gate: no premature Rust (Phase 2) vs confinement (Phase 3) ------
const recordText = existsSync(OPENING_RECORD) ? readFileSync(OPENING_RECORD, 'utf8') : null;
const phase3 = recordText !== null
  && recordText.includes('PHASE_3_STATUS: OPEN')
  && recordText.includes('PHASE_2_VERDICT: VERIFIED')
  && recordText.includes('REFERENCE_PIN: 15050/f8da35180669');

const rustFilesUnder = (dir) => {
  const hits = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.rs') || e.name === 'Cargo.toml') hits.push(p.slice(ROOT.length + 1));
    }
  };
  walk(dir);
  return hits;
};

if (!phase3) {
  check('Phase 2: no Rust implementation introduced', () => {
    const offenders = [...rustFilesUnder(join(ROOT, 'crates')), ...rustFilesUnder(join(ROOT, 'apps'))];
    assert(offenders.length === 0, `Rust artifacts present in Phase 2: ${offenders.join(', ')}`);
    return 'crates/ and apps/ contain no Rust sources';
  });
} else {
  check('Phase 3: opening record present and well-formed', () => {
    assert(recordText.includes('PHASE_3_STATUS: OPEN'), 'missing PHASE_3_STATUS: OPEN marker');
    assert(recordText.includes('PHASE_2_VERDICT: VERIFIED'), 'missing PHASE_2_VERDICT: VERIFIED marker');
    assert(recordText.includes('REFERENCE_PIN: 15050/f8da35180669'), 'missing REFERENCE_PIN marker');
    return 'docs/isolation/PHASE-3-OPENING-RECORD.md';
  });

  check('Phase 3: Rust confined to crates/** and apps/**', () => {
    const SKIP = new Set(['.git', 'reference', 'node_modules', 'target', '.runtime']);
    const offenders = [];
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory() && SKIP.has(e.name)) continue;
        const p = join(d, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (e.name.endsWith('.rs') || e.name === 'Cargo.toml') {
          const rel = p.slice(ROOT.length + 1);
          if (rel === 'Cargo.toml') continue; // root workspace manifest — required, see below
          if (!rel.startsWith('crates/') && !rel.startsWith('apps/')) offenders.push(rel);
        }
      }
    };
    walk(ROOT);
    assert(offenders.length === 0, `Rust outside crates/** and apps/**: ${offenders.join(', ')}`);
    const rootManifest = join(ROOT, 'Cargo.toml');
    assert(existsSync(rootManifest), 'Phase 3 requires a root Cargo.toml workspace manifest');
    assert(readFileSync(rootManifest, 'utf8').includes('[workspace]'), 'root Cargo.toml is not a [workspace] manifest');
    const confined = rustFilesUnder(join(ROOT, 'crates')).length + rustFilesUnder(join(ROOT, 'apps')).length;
    return `${confined} Rust file(s) under crates/** and apps/**, workspace manifest present`;
  });

  check('Phase 3: frozen Workflow surface intact', () => {
    const contract = readFileSync(join(ROOT, 'contracts', 'workflow.contract.md'), 'utf8');
    const FROZEN = [
      'getNode', 'getNodes', 'getChildNodes', 'getParentNodes', 'getConnectedNodes',
      'getStartNode', 'setNodes', 'setConnections', 'renameNode', 'timezone',
      'calculateWorkflowChecksum', 'compareConnections',
      'getNodeByName', 'getHighestNode', 'getNodeConnectionIndexes',
    ];
    const missing = FROZEN.filter((s) => !contract.includes(s));
    assert(missing.length === 0, `frozen Workflow symbol(s) missing from contract: ${missing.join(', ')}`);
    return `${FROZEN.length}/${FROZEN.length} frozen symbols present`;
  });

  check('Phase 3: Rust-port acceptance fixtures present', () => {
    const p = join(ROOT, 'tests', 'reference', 'workflow-rust', 'fixtures.json');
    assert(existsSync(p), 'missing tests/reference/workflow-rust/fixtures.json (Phase-3 acceptance criteria)');
    const fx = JSON.parse(readFileSync(p, 'utf8'));
    const GROUPS = ['checksum', 'compareConnections', 'toJSON', 'rename', 'traversal'];
    const missing = GROUPS.filter((g) => fx[g] === undefined);
    assert(missing.length === 0, `fixture group(s) missing: ${missing.join(', ')}`);
    return GROUPS.map((g) => `${g}:${Array.isArray(fx[g]) ? fx[g].length : Object.keys(fx[g]).length}`).join(' ');
  });
}

const passed = results.filter((r) => r.ok).length;
console.log('=== [AGENT 5] CONTRACT CONFORMANCE (offline) ===');
for (const r of results) console.log(`${r.ok ? '[PASS]' : '[FAIL]'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
console.log('-------------------------------------------------------');
console.log(`RESULT: ${passed}/${results.length} CHECKS PASSED`);
process.exit(passed === results.length ? 0 : 1);
