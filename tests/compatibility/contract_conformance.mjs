#!/usr/bin/env node
// Agent 5 — offline contract-conformance harness.
// Checks the golden reference workflows in tests/reference/* against the
// invariants declared in contracts/*.contract.md. NO network, NO docker,
// NO running n8n required -> can be executed on any checkout.
// It does NOT re-implement n8n behavior; it only asserts that the golden
// fixtures satisfy the contracts the LEGO owners published.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONN_TYPES = ['main', 'ai_tool', 'ai_memory', 'ai_languageModel'];

const results = [];
const check = (name, fn) => {
  try { const d = fn(); results.push({ name, ok: true, detail: d ?? '' }); }
  catch (e) { results.push({ name, ok: false, detail: e.message }); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

// --- contract presence (contracts are the communication channel) -----------
const CONTRACTS = ['workflow', 'node', 'connection', 'validation'];
for (const c of CONTRACTS) {
  check(`contract:${c} present`, () => {
    const p = join(ROOT, 'contracts', `${c}.contract.md`);
    assert(existsSync(p), `missing contracts/${c}.contract.md`);
    return `${readFileSync(p, 'utf8').length} bytes`;
  });
}

// --- golden fixtures -------------------------------------------------------
const refDir = join(ROOT, 'tests', 'reference');
const fixtures = readdirSync(refDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(refDir, d.name, 'workflow.json')))
  .map((d) => ({ name: d.name, wf: JSON.parse(readFileSync(join(refDir, d.name, 'workflow.json'), 'utf8')) }));

check('golden fixtures discovered', () => {
  assert(fixtures.length > 0, 'no golden fixtures found under tests/reference');
  return fixtures.map((f) => f.name).join(', ');
});

for (const { name, wf } of fixtures) {
  // WorkflowContract schema
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

  // ValidationContract: CycleDetection
  check(`${name}: CycleDetection (acyclic)`, () => {
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
  });
}

// --- Phase gate: Rust presence vs project phase -------------------------------
// Phase 3 opens when the workspace manifest exists at the repo root
// (MSG-14/MSG-19: "accept Rust under crates/** when the workspace manifest
// exists at the repo root"). In Phase 2 the strict rule stands; in Phase 3 the
// gate asserts the workspace, the frozen surface, the acceptance fixtures and
// fresh `cargo test` evidence instead of forbidding crates/**.
// Spec: docs/isolation/phase3-gate-mode.md
const collectRustArtifacts = () => {
  const offenders = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.rs') || e.name === 'Cargo.toml') offenders.push(p.slice(ROOT.length + 1));
    }
  };
  walk(join(ROOT, 'crates')); walk(join(ROOT, 'apps'));
  return offenders;
};
const RUST_ARTIFACTS = collectRustArtifacts();
const PHASE3 = (() => {
  try {
    return /\[workspace\]/.test(readFileSync(join(ROOT, 'Cargo.toml'), 'utf8'));
  } catch {
    return false;
  }
})();

if (!PHASE3) {
  check('Phase 2: no Rust implementation introduced', () => {
    assert(RUST_ARTIFACTS.length === 0, `Rust artifacts present in Phase 2: ${RUST_ARTIFACTS.join(', ')}`);
    return 'crates/ and apps/ contain no Rust sources';
  });
} else {
  check('Phase 3: Rust workspace manifest present', () => {
    const manifest = readFileSync(join(ROOT, 'Cargo.toml'), 'utf8');
    const members = [...manifest.matchAll(/"([^"]+)"/g)]
      .map((m) => m[1])
      .filter((m) => m.startsWith('crates/') || m.startsWith('apps/'));
    assert(members.length > 0, 'workspace declares no crates/* or apps/* members');
    const missing = members.filter((m) => !existsSync(join(ROOT, m, 'Cargo.toml')));
    assert(missing.length === 0, `workspace members without a manifest: ${missing.join(', ')}`);
    return `${members.length} workspace member(s): ${members.join(', ')}`;
  });

  check('Phase 3: workflow-rust acceptance fixtures present (35 cases)', () => {
    const fxPath = join(ROOT, 'tests', 'reference', 'workflow-rust', 'fixtures.json');
    assert(existsSync(fxPath), 'missing tests/reference/workflow-rust/fixtures.json');
    const fx = JSON.parse(readFileSync(fxPath, 'utf8'));
    const counts = {
      checksum: (fx.checksum?.cases ?? []).length,
      compareConnections: (fx.compareConnections ?? []).length,
      toJSON: (fx.toJSON ?? []).length,
      rename: (fx.rename ?? []).length,
      traversal: (fx.traversal ?? []).length,
    };
    // Mirrors the Rust harness constants in crates/n8n-workflow/tests/reference_fixtures.rs
    const expected = { checksum: 8, compareConnections: 6, toJSON: 6, rename: 6, traversal: 9 };
    for (const [k, want] of Object.entries(expected)) {
      assert(
        counts[k] === want,
        `${k}: want ${want} cases, have ${counts[k]} (fixtures.json drifted vs the Rust harness constants)`,
      );
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return `${total} cases (8/6/6/6/9)`;
  });

  check('Phase 3: frozen 15-symbol Workflow surface intact', () => {
    const ownershipPath = join(ROOT, 'packages', 'workflow-lego', 'manifest', 'ownership.json');
    assert(existsSync(ownershipPath), 'missing packages/workflow-lego/manifest/ownership.json');
    const ownership = JSON.parse(readFileSync(ownershipPath, 'utf8'));
    const surface = ownership.publicSurface;
    assert(surface, 'ownership.json has no publicSurface block');
    const eq = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
    assert(eq(surface.aggregate ?? [], ['Workflow']), 'aggregate surface drifted from the frozen record');
    assert(
      eq(surface.graph ?? [], [
        'getChildNodes', 'getParentNodes', 'getConnectedNodes', 'getNodeByName',
        'mapConnectionsByDestination', 'buildAdjacencyList', 'parseExtractableSubgraphSelection',
        'getRootNodes', 'getLeafNodes', 'hasPath', 'getInputEdges', 'getOutputEdges',
      ]),
      'graph surface drifted from the frozen record',
    );
    assert(
      eq(surface.content ?? [], ['calculateWorkflowChecksum', 'compareConnections']),
      'content surface drifted from the frozen record',
    );
    return '1 aggregate + 12 graph + 2 content symbols';
  });

  check('Phase 3: cargo test evidence fresh', () => {
    const recordPath = join(ROOT, 'docs', 'isolation', 'evidence', 'rust-test-record.json');
    const rerun = 'bash tools/phase3-rust-acceptance.sh';
    assert(existsSync(recordPath), `no cargo test evidence on this tree — run: ${rerun}`);
    const record = JSON.parse(readFileSync(recordPath, 'utf8'));
    assert(record.result === 'PASS', `last Rust acceptance run did not pass (result=${record.result}) — re-run: ${rerun}`);
    const fixturesSha = createHash('sha256')
      .update(readFileSync(join(ROOT, 'tests', 'reference', 'workflow-rust', 'fixtures.json')))
      .digest('hex');
    assert(
      record.fixturesSha256 === fixturesSha,
      `fixtures.json changed since the last green cargo test — re-run: ${rerun}`,
    );
    let head = null;
    try {
      head = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
    } catch {
      head = null;
    }
    if (head) {
      assert(
        record.headCommit === head,
        `tree moved since the last green cargo test (${String(record.headCommit).slice(0, 8)} -> ${head.slice(0, 8)}) — re-run: ${rerun}`,
      );
    }
    assert(
      record.referenceIntegrity === 'PASS',
      `reference-integrity (G04) was not PASS at the last green run — re-run: ${rerun}`,
    );
    return `PASS at ${String(record.headCommit).slice(0, 8)} via ${record.runner} (${record.generatedAt})`;
  });
}

const passed = results.filter((r) => r.ok).length;
console.log('=== [AGENT 5] CONTRACT CONFORMANCE (offline) ===');
for (const r of results) console.log(`${r.ok ? '[PASS]' : '[FAIL]'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
console.log('-------------------------------------------------------');
console.log(`RESULT: ${passed}/${results.length} CHECKS PASSED`);
process.exit(passed === results.length ? 0 : 1);
