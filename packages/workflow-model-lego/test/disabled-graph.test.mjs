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
const caseDir = join(repoRoot, 'tests', 'reference', '04-disabled-node');

const { getHighestNode, getStartNode, STARTING_NODE_TYPES, MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE } =
	await import(join(laneRoot, 'dist', 'index.js'));

const golden = JSON.parse(readFileSync(join(caseDir, 'expected.json'), 'utf8'));
const testCase = JSON.parse(readFileSync(join(caseDir, 'case.json'), 'utf8'));

// Same stand-in registry as the observation harness (tests/reference/harness/disabled-graph.js).
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
const nodeTypes = {
	getByNameAndVersion(type) {
		const isTrigger = TRIGGER_TYPES.has(type);
		return {
			description: { name: type, properties: [] },
			...(isTrigger ? { trigger: async () => ({}) } : {}),
		};
	},
};

/** Mirror the real Workflow constructor's name-keyed nodes + destination index. */
function buildModel(probe) {
	let nodes = probe.nodes;
	if (probe.fixtureNodes) {
		nodes = JSON.parse(readFileSync(join(caseDir, 'workflow.json'), 'utf8')).nodes;
	}
	const map = {};
	for (const n of nodes) {
		map[n.name] = {
			id: `id-${n.name}`,
			name: n.name,
			type: n.type,
			typeVersion: n.typeVersion,
			position: [0, 0],
			parameters: {},
			...(n.disabled === undefined ? {} : { disabled: n.disabled }),
		};
	}
	const byDestination = {};
	for (const [from, to] of probe.edges ?? []) {
		byDestination[to] = byDestination[to] ?? { main: [[]] };
		byDestination[to].main[0].push({ node: from, type: 'main', index: 0 });
	}
	return { nodes: map, connectionsByDestinationNode: byDestination };
}

const snapshot = (probe, calls) =>
	calls.map((call) => {
		const model = buildModel(probe);
		const args = call.args ?? [];
		if (call.method === 'getStartNode') {
			const result = getStartNode(model.nodes, model.connectionsByDestinationNode, nodeTypes, ...args);
			return result
				? { startNode: result.name, type: result.type, disabled: result.disabled === true }
				: { startNode: null };
		}
		return { highestNodes: getHighestNode(model.nodes, model.connectionsByDestinationNode, ...args) };
	});

test('0. the committed golden matches the real runtime (observation harness verify mode)', () => {
	// expected.json is never hand-written; this re-observes n8n-workflow@2.9.1 and diffs.
	execFileSync(process.execPath, [join(repoRoot, 'tests', 'reference', 'harness', 'disabled-graph.js')], {
		cwd: join(repoRoot, 'tests', 'reference', 'harness'),
		stdio: 'pipe',
	});
	assert.ok(golden._meta.runtime.startsWith('n8n-workflow@'));
});

for (const [name, probe] of Object.entries(testCase.probes)) {
	test(`1..5 ${name}: reconstruction deep-equals the observed golden`, () => {
		assert.deepEqual(snapshot(probe, probe.calls), golden[name]);
	});
}

// Negative control: a "cleaned up" port that normalises the D-04 asymmetry
// (omitted key treated as enabled everywhere) MUST diverge from the golden —
// this is the exact bug recorded as ISSUE-017 / D-04 in the Rust port.
test('N1. the D-04 golden rejects the asymmetry-normalising mutation', () => {
	const probe = testCase.probes['D-04_getHighestNode_omittedKeyAsymmetry'];
	const model = buildModel(probe);
	// mutation: STRICT self test replaced by the LOOSE one
	const mutated = (nodes, conns, nodeName, nodeConnectionIndex, checkedNodes) => {
		const currentHighest = [];
		if (nodes[nodeName].disabled !== true) currentHighest.push(nodeName); // <- normalised
		if (!Object.prototype.hasOwnProperty.call(conns, nodeName)) return currentHighest;
		if (!Object.prototype.hasOwnProperty.call(conns[nodeName], 'main')) return currentHighest;
		checkedNodes = checkedNodes || [];
		if (checkedNodes.includes(nodeName)) return currentHighest;
		checkedNodes.push(nodeName);
		const returnNodes = [];
		for (const connectionsByIndex of conns[nodeName].main) {
			connectionsByIndex?.forEach((connection) => {
				if (checkedNodes.includes(connection.node)) return;
				if (!(connection.node in nodes)) return;
				let addNodes = mutated(nodes, conns, connection.node, undefined, checkedNodes);
				if (addNodes.length === 0 && nodes[connection.node].disabled !== true) addNodes = [connection.node];
				addNodes.forEach((name) => {
					if (!returnNodes.includes(name)) returnNodes.push(name);
				});
			});
		}
		return returnNodes;
	};
	const observed = probe.calls.map((call) =>
		mutated(model.nodes, model.connectionsByDestinationNode, ...call.args),
	);
	assert.notDeepEqual(
		observed,
		golden['D-04_getHighestNode_omittedKeyAsymmetry'],
		'the mutated (asymmetry-normalising) implementation must NOT match the observed golden',
	);
});

test('N2. STARTING_NODE_TYPES matches the reference constants.ts :53-59 order', () => {
	assert.deepEqual([...STARTING_NODE_TYPES], [
		'n8n-nodes-base.manualTrigger',
		'n8n-nodes-base.executeWorkflowTrigger',
		'n8n-nodes-base.errorTrigger',
		'n8n-nodes-base.evaluationTrigger',
		'n8n-nodes-base.formTrigger',
	]);
});
