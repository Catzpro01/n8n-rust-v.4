'use strict';
/**
 * Disabled-graph observer for tests/reference/04-disabled-node (TASK-DGRAPH-01).
 *
 * Drives the REAL pinned runtime package (`n8n-workflow@2.9.1`, the version the n8n
 * 2.9.4 reference pins) over the D-01..D-05 probes in ../04-disabled-node/case.json
 * and snapshots the OBSERVED behaviour of `Workflow.getHighestNode` /
 * `Workflow.getStartNode`. Like the other harness runners:
 *
 *   node disabled-graph.js            -> verify the committed expected.json matches
 *   UPDATE=1 node disabled-graph.js   -> (re)write expected.json from the runtime
 *
 * expected.json is NEVER hand-written. Prerequisite: `npm install` in
 * packages/workflow-lego (provides n8n-workflow@2.9.1).
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const ROOT = path.resolve(__dirname, '..');
const CASE_DIR = path.join(ROOT, '04-disabled-node');
const EXPECTED = path.join(CASE_DIR, 'expected.json');

// The real runtime package lives in workflow-lego's node_modules (devDependency).
const workflowLegoRequire = createRequire(path.join(ROOT, '..', '..', 'packages', 'workflow-lego', 'package.json'));
const { Workflow } = workflowLegoRequire('n8n-workflow');

// Trigger-time constants mirrored from the pinned reference source for probe D-05.
const MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE = '@n8n/n8n-nodes-langchain.manualChatTrigger';

/** Stand-in node types registry: every type resolves; triggers/polls are marked. */
function makeNodeTypes(triggerTypes) {
  return {
    getByNameAndVersion(type) {
      const isTrigger = triggerTypes.has(type);
      return {
        description: { name: type, properties: [] },
        ...(isTrigger ? { trigger: async function () { return {}; } } : {}),
        ...(type === 'n8n-nodes-base.poll' ? { poll: async function () { return null; } } : {}),
      };
    },
  };
}

const TRIGGER_TYPES = new Set([
  'n8n-nodes-base.manualTrigger',
  'n8n-nodes-base.executeWorkflowTrigger',
  'n8n-nodes-base.errorTrigger',
  'n8n-nodes-base.evaluationTrigger',
  'n8n-nodes-base.formTrigger',
  'n8n-nodes-base.scheduleTrigger',
  'n8n-nodes-base.cron',
  'n8n-nodes-base.poll',
  'n8n-nodes-base.webhook',
  MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE,
]);

/** Build a real Workflow from case.json probe inputs. */
function buildWorkflow(probe) {
  let nodes = probe.nodes;
  if (probe.fixtureNodes) {
    nodes = JSON.parse(fs.readFileSync(path.join(CASE_DIR, 'workflow.json'), 'utf8')).nodes;
  }
  const connections = {};
  for (const [from, to] of probe.edges ?? []) {
    connections[from] = connections[from] ?? { main: [[]] };
    connections[from].main[0].push({ node: to, type: 'main', index: 0 });
  }
  return new Workflow({
    id: 'wf-disabled-probe',
    name: 'Disabled Graph Probe',
    nodes: nodes.map((n) => ({
      id: `id-${n.name}`,
      name: n.name,
      type: n.type,
      typeVersion: n.typeVersion,
      position: [0, 0],
      parameters: {},
      ...(n.disabled === undefined ? {} : { disabled: n.disabled }),
    })),
    connections,
    active: false,
    nodeTypes: makeNodeTypes(TRIGGER_TYPES),
  });
}

function observe() {
  const testCase = JSON.parse(fs.readFileSync(path.join(CASE_DIR, 'case.json'), 'utf8'));
  const observed = { _meta: {
    runtime: `${workflowLegoRequire('n8n-workflow/package.json').name}@${workflowLegoRequire('n8n-workflow/package.json').version}`,
    observedAt: 'UPDATE=1 run of tests/reference/harness/disabled-graph.js',
    method: 'OBSERVED runtime behaviour — never hand-written (see tests/reference/README.md)',
  } };
  for (const [name, probe] of Object.entries(testCase.probes)) {
    const workflow = buildWorkflow(probe);
    observed[name] = probe.calls.map((call) => {
      const result = workflow[call.method](...(call.args ?? []));
      if (call.method === 'getStartNode') {
        return result ? { startNode: result.name, type: result.type, disabled: result.disabled === true } : { startNode: null };
      }
      return { highestNodes: result };
    });
  }
  return observed;
}

const observed = observe();
if (process.env.UPDATE === '1') {
  fs.writeFileSync(EXPECTED, `${JSON.stringify(observed, null, '\t')}\n`);
  console.log(`updated ${path.relative(ROOT, EXPECTED)}`);
} else {
  const committed = JSON.parse(fs.readFileSync(EXPECTED, 'utf8'));
  const a = JSON.stringify(committed, null, 1);
  const b = JSON.stringify(observed, null, 1);
  if (a !== b) {
    console.error('MISMATCH: committed expected.json differs from observed runtime behaviour');
    process.exit(1);
  }
  console.log(`verified: expected.json matches observed n8n-workflow behaviour (${Object.keys(observed).length - 1} probes)`);
}
