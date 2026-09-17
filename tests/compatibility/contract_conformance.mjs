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
// A directory whose name contains `-invalid` is a NEGATIVE fixture: it must be rejected by at
// least one rule. Every other fixture is positive. A suite built only from positive cases cannot
// fail, so it cannot be evidence — the negative cases are what make the rules falsifiable.
const fixtures = readdirSync(refDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(refDir, d.name, 'workflow.json')))
  .map((d) => ({
    name: d.name,
    negative: d.name.includes('-invalid'),
    wf: JSON.parse(readFileSync(join(refDir, d.name, 'workflow.json'), 'utf8')),
  }));

check('golden fixtures discovered', () => {
  assert(fixtures.length > 0, 'no golden fixtures found under tests/reference');
  return fixtures.map((f) => f.name).join(', ');
});

check('negative fixtures present', () => {
  const negative = fixtures.filter((f) => f.negative);
  assert(negative.length > 0, 'no `-invalid` fixture under tests/reference — the suite cannot fail');
  return negative.map((f) => f.name).join(', ');
});

for (const { name, wf, negative } of fixtures) {
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

  // ConnectionContract schema + DanglingConnections + INVALID_CONNECTION_TYPE.
  // Shape is always required — even a negative fixture must be well-formed JSON. The *rules*
  // (dangling target, unknown connection type) are what a `-invalid` fixture may be built to
  // violate, so they are collected here and reported; the blanket falsifiability check below is
  // what insists every negative fixture violates at least one rule somewhere.
  check(`${name}: connection schema + DanglingConnections`, () => {
    const names = new Set(wf.nodes.map((n) => n.name));
    const violations = [];
    let count = 0;
    for (const [src, byType] of Object.entries(wf.connections)) {
      assert(names.has(src), `connection source '${src}' is not a declared node`);
      for (const [type, outputs] of Object.entries(byType)) {
        if (!CONN_TYPES.includes(type)) violations.push(`unknown connection type '${type}'`);
        assert(Array.isArray(outputs), `${src}.${type} must be an array of output slots`);
        outputs.forEach((slot, outIdx) => {
          assert(slot === null || Array.isArray(slot), `${src}.${type}[${outIdx}] must be array|null`);
          for (const c of slot ?? []) {
            if (!names.has(c.node)) violations.push(`dangling connection ${src} -> '${c.node}'`);
            if (!CONN_TYPES.includes(c.type)) violations.push(`unknown target connection type '${c.type}'`);
            assert(Number.isInteger(c.index) && c.index >= 0, `input index must be integer >= 0`);
            assert(outIdx >= 0, 'output index must be >= 0');
            count++;
          }
        });
      }
    }
    if (negative) {
      return violations.length
        ? `rejected here too (${count} edge(s)): ${violations.join('; ')}`
        : `no connection-rule violation (${count} edge(s)) — rejected by another rule`;
    }
    assert(violations.length === 0, violations.join('; '));
    return `${count} edge(s)`;
  });

  // ValidationContract: CycleDetection — positive fixtures must be acyclic. A `-invalid` fixture
  // violates *some* rule, not necessarily this one (`06-invalid-connection-type` is acyclic by
  // design), so the blanket check below carries the falsifiability assertion.
  check(`${name}: CycleDetection${negative ? ' (negative)' : ' (acyclic)'}`, () => {
    const adj = new Map(wf.nodes.map((n) => [n.name, []]));
    for (const [src, byType] of Object.entries(wf.connections))
      for (const outputs of Object.values(byType))
        for (const slot of outputs) for (const c of slot ?? []) adj.get(src)?.push(c.node);
    const WHITE = 0, GREY = 1, BLACK = 2;
    const color = new Map(wf.nodes.map((n) => [n.name, WHITE]));
    const stack = [];
    let cycle = null;
    const visit = (n) => {
      color.set(n, GREY); stack.push(n);
      for (const m of adj.get(n) ?? []) {
        if (color.get(m) === GREY) { cycle = [...stack, m].join(' -> '); return; }
        if (color.get(m) === WHITE) { visit(m); if (cycle) return; }
      }
      stack.pop(); color.set(n, BLACK);
    };
    for (const n of color.keys()) if (color.get(n) === WHITE && !cycle) visit(n);
    if (negative) return cycle ? `correctly rejected: ${cycle}` : 'acyclic — rejected by another rule';
    assert(!cycle, `cycle detected: ${cycle}`);
    return 'acyclic';
  });
}

// --- negative fixtures must actually be rejected ---------------------------
// Each `-invalid` fixture has to fail at least one rule. Without this, renaming a fixture to
// `-invalid` would exempt it from every assertion and the suite would get weaker while reporting
// more checks.
for (const { name, wf } of fixtures.filter((f) => f.negative)) {
  check(`${name}: negative fixture is falsifiable`, () => {
    const names = new Set(wf.nodes.map((n) => n.name));
    const reasons = [];

    for (const [src, byType] of Object.entries(wf.connections)) {
      if (!names.has(src)) reasons.push(`unknown source '${src}'`);
      for (const [type, outputs] of Object.entries(byType)) {
        if (!CONN_TYPES.includes(type)) reasons.push(`unknown connection type '${type}'`);
        for (const slot of outputs)
          for (const c of slot ?? []) {
            if (!names.has(c.node)) reasons.push(`dangling ${src} -> '${c.node}'`);
            if (!CONN_TYPES.includes(c.type)) reasons.push(`unknown target type '${c.type}'`);
          }
      }
    }

    const seen = new Set();
    for (const n of wf.nodes)
      if (seen.has(n.name)) reasons.push(`duplicate name '${n.name}'`);
      else seen.add(n.name);

    const adj = new Map(wf.nodes.map((n) => [n.name, []]));
    for (const [src, byType] of Object.entries(wf.connections))
      for (const outputs of Object.values(byType))
        for (const slot of outputs) for (const c of slot ?? []) adj.get(src)?.push(c.node);
    const color = new Map(wf.nodes.map((n) => [n.name, 0]));
    const stack = [];
    const visit = (n) => {
      color.set(n, 1); stack.push(n);
      for (const m of adj.get(n) ?? []) {
        if (color.get(m) === 1) { reasons.push(`cycle ${[...stack, m].join(' -> ')}`); return; }
        if (color.get(m) === 0) { visit(m); if (reasons.some((r) => r.startsWith('cycle'))) return; }
      }
      stack.pop(); color.set(n, 2);
    };
    for (const n of color.keys())
      if (color.get(n) === 0 && !reasons.some((r) => r.startsWith('cycle'))) visit(n);

    assert(reasons.length > 0, `NEGATIVE fixture satisfies every rule — it proves nothing`);
    return `rejected by: ${reasons.join('; ')}`;
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
    // Evidence stays valid while the Rust inputs are unchanged since the
    // recorded commit (the record commit itself only adds the record, so it
    // never invalidates evidence). Uncommitted Rust-input changes fail too.
    try {
      const recHead = String(record.headCommit || '');
      assert(recHead && recHead !== 'unknown', `record has no headCommit — re-run: ${rerun}`);
      const changed = execSync(
        `git diff --name-only ${recHead} HEAD -- crates Cargo.toml Cargo.lock tests/reference/workflow-rust tools/rust-offline-rig tools/phase3-rust-acceptance.sh`,
        { cwd: ROOT, encoding: 'utf8' },
      ).trim();
      assert(
        !changed,
        `Rust inputs changed since the last green cargo test (${changed.split('\n').slice(0, 3).join(', ')}…) — re-run: ${rerun}`,
      );
      const dirty = execSync(
        'git status --porcelain -- crates Cargo.toml Cargo.lock tests/reference/workflow-rust tools/rust-offline-rig tools/phase3-rust-acceptance.sh',
        { cwd: ROOT, encoding: 'utf8' },
      ).trim();
      assert(
        !dirty,
        `uncommitted Rust-input changes present (${dirty.split('\n').slice(0, 3).join(', ')}…) — commit and re-run: ${rerun}`,
      );
    } catch (e) {
      if (/re-run: /.test(e.message)) throw e;
      // No git (or shallow oddity): fall back to the fixtures-hash check above.
    }
    assert(
      record.referenceIntegrity === 'PASS',
      `reference-integrity (G04) was not PASS at the last green run — re-run: ${rerun}`,
    );
    return `PASS at ${String(record.headCommit).slice(0, 8)} via ${record.runner} (${record.generatedAt})`;
  });
}

// The frontend constraint is absolute and is NOT relaxed by Phase 3.
check('editor-ui remains untouched by the Rust port', () => {
  const offenders = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.rs') || e.name === 'Cargo.toml') offenders.push(p.slice(ROOT.length + 1));
    }
  };
  walk(join(ROOT, 'packages', 'editor-ui'));
  assert(offenders.length === 0, `Rust artifacts in the UI tree: ${offenders.join(', ')}`);
  return 'no Rust sources under packages/editor-ui';
});

const passed = results.filter((r) => r.ok).length;
console.log('=== [AGENT 5] CONTRACT CONFORMANCE (offline) ===');
for (const r of results) console.log(`${r.ok ? '[PASS]' : '[FAIL]'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
console.log('-------------------------------------------------------');
console.log(`RESULT: ${passed}/${results.length} CHECKS PASSED`);
process.exit(passed === results.length ? 0 : 1);
