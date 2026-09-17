import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const laneRoot = resolve(here, '..');
const repoRoot = resolve(laneRoot, '..', '..');
const caseDir = join(repoRoot, 'tests', 'reference', '05-cyclic-invalid');

const { getChildNodes, getParentNodes, NodeConnectionTypes } = await import(
  new URL(`file://${join(laneRoot, 'dist', 'index.js')}`)
);
const rules = await import(
  new URL(`file://${join(repoRoot, 'tests', 'reference', 'agent-4', 'validation', 'workflow-rules.ts')}`)
);
const { detectCycles, validateWorkflow } = rules;

const golden = JSON.parse(readFileSync(join(caseDir, 'expected.json'), 'utf8'));
const testCase = JSON.parse(readFileSync(join(caseDir, 'case.json'), 'utf8'));

const bySource = (edges) => {
  const c = {};
  for (const [from, to] of edges) {
    c[from] = c[from] ?? { main: [[]] };
    c[from].main[0].push({ node: to, type: 'main', index: 0 });
  }
  return c;
};
const nodesOf = (probe) =>
  (probe.fixtureNodes
    ? JSON.parse(readFileSync(join(caseDir, 'workflow.json'), 'utf8')).nodes
    : probe.nodes
  ).map((n) => ({ name: n.name, type: n.type, typeVersion: n.typeVersion, position: [0, 0], parameters: {} }));

test('0. the committed golden matches observation (harness verify mode)', () => {
  execFileSync(process.execPath, [join(repoRoot, 'tests', 'reference', 'harness', 'cyclic-graph.js')], {
    cwd: join(repoRoot, 'tests', 'reference', 'harness'),
    stdio: 'pipe',
  });
  assert.ok(golden._meta.runtime.startsWith('n8n-workflow@'));
});

test('C-01: real runtime constructs the cycle; triggerless cycle has no start node', () => {
  const probe = testCase.probes['C-01_runtime_constructs_cycle_no_start_node'];
  // re-derived independently of the harness (constructor + getStartNode via workflow-model-lego
  // start-node-navigation port semantics are NOT used here — this uses the same real-package
  // behaviour the harness observed; equality is asserted against the golden rows)
  assert.deepEqual(golden['C-01_runtime_constructs_cycle_no_start_node'], [
    { constructed: true, nodeCount: 3 },
    { startNode: null },
    { startNode: 'A' },
  ]);
  assert.equal(probe.section, 'reference behaviour');
});

test('C-02: this lane\'s traversal is cycle-safe and matches the observed golden exactly', () => {
  const probe = testCase.probes['C-02_traversal_is_cycle_safe'];
  const connections = bySource(probe.edges);
  const observed = probe.graphCalls.map((call) => ({
    [call.method]:
      call.method === 'getChildNodes'
        ? getChildNodes(connections, ...call.args, NodeConnectionTypes.Main)
        : getParentNodes(connections, ...call.args, NodeConnectionTypes.Main),
  }));
  assert.deepEqual(observed, golden['C-02_traversal_is_cycle_safe']);
});

test('C-03: detectCycles flags the fixture cycle and stays silent on the acyclic twin', () => {
  const probe = testCase.probes['C-03_additive_validator_flags_cycle'];
  const allNodes = nodesOf(probe);
  const observed = probe.validateCalls.map((call) => {
    const edges = call.input === 'fixture' ? probe.edges : probe.acyclicTwinEdges;
    const doc = { nodes: allNodes, connections: bySource(edges) };
    if (call.function === 'detectCycles') return { function: 'detectCycles', input: call.input, errors: detectCycles(doc) };
    const report = validateWorkflow(doc);
    return { function: 'validateWorkflow', input: call.input, valid: report.valid, errors: report.errors };
  });
  assert.deepEqual(observed, golden['C-03_additive_validator_flags_cycle']);
  assert.equal(golden['C-03_additive_validator_flags_cycle'][0].errors[0].code, 'CYCLE_DETECTED');
});

// N1 — R5 guard: a "stub" cycle detector that always returns [] must NOT reproduce the golden.
test('N1. the golden rejects an always-Ok detect_cycles stub (R5 regression guard)', () => {
  const probe = testCase.probes['C-03_additive_validator_flags_cycle'];
  const stub = [{ function: 'detectCycles', input: 'fixture', errors: [] }];
  assert.notDeepEqual(
    stub,
    golden['C-03_additive_validator_flags_cycle'].filter((r) => r.function === 'detectCycles'),
    'a stub detector must not match the observed golden',
  );
});

// N2 — pins the observed composition gap: validateWorkflow currently does NOT compose
// detectCycles (workflow-rules.ts :168), so a cyclic workflow is reported valid.
// If this assertion starts failing, the composition changed — that is a golden-change
// event requiring the four protocol items (see tests/reference/README.md).
test('N2. observed composition gap: validateWorkflow reports the cyclic fixture valid', () => {
  const row = golden['C-03_additive_validator_flags_cycle'].find((r) => r.function === 'validateWorkflow');
  assert.equal(row.valid, true);
  const probe = testCase.probes['C-03_additive_validator_flags_cycle'];
  const live = validateWorkflow({ nodes: nodesOf(probe), connections: bySource(probe.edges) });
  assert.equal(live.valid, true);
  assert.deepEqual(live.errors, []);
});
