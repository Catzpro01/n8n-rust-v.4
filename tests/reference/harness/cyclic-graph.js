'use strict';
/**
 * Cyclic-graph observer for tests/reference/05-cyclic-invalid (TASK-CGRAPH-01).
 *
 *   node cyclic-graph.js            -> verify the committed expected.json matches
 *   UPDATE=1 node cyclic-graph.js   -> (re)write expected.json from observation
 *
 * Observation sources (each section labelled in the snapshot):
 *   C-01  REAL pinned runtime `n8n-workflow@2.9.1` (packages/workflow-lego node_modules):
 *         the Workflow constructor has no cycle validation; getStartNode over a
 *         triggerless cycle returns undefined.
 *   C-02  Connection LEGO built dist (1:1 port of common/*.ts + graph-utils.ts):
 *         traversal over the cycle terminates via visited-sets.
 *   C-03  ADDITIVE validator (tests/reference/agent-4/validation/workflow-rules.ts,
 *         NEW CAPABILITY, imported natively — Node >=22.18 type stripping):
 *         validateWorkflow flags CYCLE_DETECTED. NOT reference behaviour.
 *
 * expected.json is NEVER hand-written. Prerequisites: `npm install` in
 * packages/workflow-lego and `npm run build` in packages/connection-lego.
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const ROOT = path.resolve(__dirname, '..');
const CASE_DIR = path.join(ROOT, '05-cyclic-invalid');
const EXPECTED = path.join(CASE_DIR, 'expected.json');

const workflowLegoRequire = createRequire(path.join(ROOT, '..', '..', 'packages', 'workflow-lego', 'package.json'));
const { Workflow } = workflowLegoRequire('n8n-workflow');
const connectionLegoRequire = createRequire(path.join(ROOT, '..', '..', 'packages', 'connection-lego', 'package.json'));
const { getChildNodes, getParentNodes, NodeConnectionTypes } = connectionLegoRequire('./dist/index.js');

function makeNodeTypes() {
  return {
    getByNameAndVersion(type) {
      return { description: { name: type, properties: [] } };
    },
  };
}

/** connections keyed BY SOURCE (getChildNodes/getParentNodes input shape). */
function bySource(edges) {
  const connections = {};
  for (const [from, to] of edges) {
    connections[from] = connections[from] ?? { main: [[]] };
    connections[from].main[0].push({ node: to, type: 'main', index: 0 });
  }
  return connections;
}

/** connections keyed BY DESTINATION (Workflow constructor input shape). */
function byDestination(edges) {
  const connections = {};
  for (const [from, to] of edges) {
    connections[to] = connections[to] ?? { main: [[]] };
    connections[to].main[0].push({ node: from, type: 'main', index: 0 });
  }
  return connections;
}

function fixtureDoc() {
  return JSON.parse(fs.readFileSync(path.join(CASE_DIR, 'workflow.json'), 'utf8'));
}

function nodesFrom(probe) {
  const nodes = probe.fixtureNodes ? fixtureDoc().nodes : probe.nodes;
  return nodes.map((n) => ({
    id: `id-${n.name}`,
    name: n.name,
    type: n.type,
    typeVersion: n.typeVersion,
    position: [0, 0],
    parameters: {},
  }));
}

const ACYCLIC_EDGES = [['A', 'B'], ['B', 'C']]; // the fixture minus the C->A closing edge

async function observe() {
  const testCase = JSON.parse(fs.readFileSync(path.join(CASE_DIR, 'case.json'), 'utf8'));
  const rules = await import(path.join(ROOT, 'agent-4', 'validation', 'workflow-rules.ts'));
  const { validateWorkflow, detectCycles } = rules;

  const observed = { _meta: {
    runtime: `${workflowLegoRequire('n8n-workflow/package.json').name}@${workflowLegoRequire('n8n-workflow/package.json').version}`,
    traversal: `packages/connection-lego dist`,
    additiveValidator: 'tests/reference/agent-4/validation/workflow-rules.ts (NEW CAPABILITY, not reference behaviour)',
    observedAt: 'UPDATE=1 run of tests/reference/harness/cyclic-graph.js',
    method: 'OBSERVED behaviour — never hand-written (see tests/reference/README.md)',
  } };

  for (const [name, probe] of Object.entries(testCase.probes)) {
    const nodes = nodesFrom(probe);
    if (probe.calls) {
      // C-01: real runtime construction + start-node resolution over the cycle
      const edges = probe.edges ?? [];
      const results = probe.calls.map((call) => {
        if (call.method === 'construct') {
          const wf = new Workflow({
            id: 'wf-cyclic-probe',
            name: 'Cyclic Graph Probe',
            nodes,
            connections: byDestination(edges),
            active: false,
            nodeTypes: makeNodeTypes(),
          });
          return { constructed: true, nodeCount: Object.keys(wf.nodes).length };
        }
        const wf = new Workflow({
          id: 'wf-cyclic-probe',
          name: 'Cyclic Graph Probe',
          nodes,
          connections: byDestination(edges),
          active: false,
          nodeTypes: makeNodeTypes(),
        });
        const result = wf.getStartNode(...(call.args ?? []));
        return { startNode: result ? result.name : null };
      });
      observed[name] = results;
    } else if (probe.graphCalls) {
      // C-02: Connection LEGO traversal (cycle-safe visited-sets)
      const connections = bySource(probe.edges ?? []);
      observed[name] = probe.graphCalls.map((call) => {
        const fn = call.method === 'getChildNodes' ? getChildNodes : getParentNodes;
        return { [call.method]: fn(connections, ...call.args, NodeConnectionTypes.Main) };
      });
    } else if (probe.validateCalls) {
      // C-03: ADDITIVE validator — reference n8n has no cycle validation
      observed[name] = probe.validateCalls.map((call) => {
        const allNodes = nodesFrom(probe).map(({ id, ...rest }) => rest);
        const edges = call.input === 'fixture' ? (probe.edges ?? []) : (probe.acyclicTwinEdges ?? []);
        const keep = call.input === 'fixture' ? allNodes : allNodes.filter((n) => ['A', 'B', 'C'].includes(n.name));
        const doc = { nodes: keep, connections: bySource(edges) };
        if (call.function === 'detectCycles') {
          return { function: 'detectCycles', input: call.input, errors: detectCycles(doc) };
        }
        const report = validateWorkflow(doc);
        return { function: 'validateWorkflow', input: call.input, valid: report.valid, errors: report.errors };
      });
    }
  }
  return observed;
}

observe()
  .then((observed) => {
    if (process.env.UPDATE === '1') {
      fs.writeFileSync(EXPECTED, `${JSON.stringify(observed, null, '\t')}\n`);
      console.log(`updated ${path.relative(ROOT, EXPECTED)}`);
    } else {
      const committed = JSON.parse(fs.readFileSync(EXPECTED, 'utf8'));
      if (JSON.stringify(committed, null, 1) !== JSON.stringify(observed, null, 1)) {
        console.error('MISMATCH: committed expected.json differs from observed behaviour');
        process.exit(1);
      }
      console.log(`verified: expected.json matches observed behaviour (${Object.keys(observed).length - 1} probes)`);
    }
  })
  .catch((error) => {
    console.error(error?.stack ?? error);
    process.exit(1);
  });
