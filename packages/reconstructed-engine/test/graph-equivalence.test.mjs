/**
 * Port-equivalence check for the graph helpers — reconstructed vs the REAL n8n-workflow 2.9.1.
 *
 * `packages/reconstructed-engine/graph.mjs` claims to be a 1:1 port of
 *   reference/n8n/packages/workflow/src/common/get-connected-nodes.ts
 *   reference/n8n/packages/workflow/src/common/get-parent-nodes.ts
 *   reference/n8n/packages/workflow/src/workflow.ts:492-568  (Workflow#getHighestNode)
 * and `runner.mjs` claims the same for
 *   reference/n8n/packages/workflow/src/common/map-connections-by-destination.ts
 *
 * Those claims are checked here by calling the real implementations exported by the pinned
 * `n8n-workflow` package (the 2.9.4 dependency set) on the same inputs and comparing the
 * results exactly — including ordering, empty-slot padding and cycle termination.
 *
 * `engine:test` skips when the runtime is absent; `engine:test:strict` fails instead and is the
 * integration/merge path. Install with `scripts/setup-reference-runtime.sh`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	getConnectedNodes as mineConnected,
	getHighestNode as mineHighest,
	getParentNodes as mineParents,
	mapConnectionsByDestination as mineByDestination,
} from '../runner.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const RUNTIME = process.env.LEGO_LIVE_RUNTIME ?? join(REPO, '.runtime', 'node_modules');
const runtimeReady = existsSync(join(RUNTIME, 'n8n-workflow', 'package.json'));
const missingRuntimeMessage =
	`pinned reference runtime not installed at ${RUNTIME} (run scripts/setup-reference-runtime.sh)`;
if (!runtimeReady && process.env.REQUIRE_REFERENCE_RUNTIME === '1') {
	throw new Error(missingRuntimeMessage);
}
const skipReason = runtimeReady ? false : missingRuntimeMessage;

const req = runtimeReady ? createRequire(join(RUNTIME, 'package.json')) : null;
const real = runtimeReady ? req('n8n-workflow') : null;

const edge = (node, index = 0) => ({ node, type: 'main', index });
const aiEdge = (node, index = 0) => ({ node, type: 'ai_tool', index });

const GRAPHS = {
	empty: {},
	linear: { A: { main: [[edge('B')]] }, B: { main: [[edge('C')]] }, C: { main: [[edge('D')]] } },
	diamond: {
		A: { main: [[edge('B'), edge('C')]] },
		B: { main: [[edge('D')]] },
		C: { main: [[edge('D')]] },
	},
	cycle: { A: { main: [[edge('B')]] }, B: { main: [[edge('C')]] }, C: { main: [[edge('A')]] } },
	selfLoop: { A: { main: [[edge('A')]] } },
	// only input slot 1 is used → slot 0 must be padded with an empty array
	sparseIndex: { B: { main: [[edge('Merge', 1)]] } },
	// more than one connection type, to exercise connectionType 'ALL'
	multiType: {
		Agent: { main: [[edge('Tool')]], ai_tool: [[aiEdge('Tool')]] },
		Model: { ai_tool: [[aiEdge('Agent')]] },
	},
	fanInThree: {
		A: { main: [[edge('M', 0)]] },
		B: { main: [[edge('M', 1)]] },
		C: { main: [[edge('M', 2)]] },
	},
};

const NODES = {
	empty: ['A'],
	linear: ['A', 'B', 'C', 'D'],
	diamond: ['A', 'B', 'C', 'D'],
	cycle: ['A', 'B', 'C'],
	selfLoop: ['A'],
	sparseIndex: ['Merge', 'B'],
	multiType: ['Agent', 'Tool', 'Model'],
	fanInThree: ['M', 'A', 'B', 'C'],
};

test('PORT mapConnectionsByDestination is identical to n8n-workflow 2.9.1 on every fixture', { timeout: 60000, skip: skipReason }, () => {
	for (const [name, connections] of Object.entries(GRAPHS)) {
		const expected = real.mapConnectionsByDestination(structuredClone(connections));
		const actual = mineByDestination(structuredClone(connections));
		assert.deepEqual(
			JSON.parse(JSON.stringify(actual)),
			JSON.parse(JSON.stringify(expected)),
			`graph "${name}" produced a different by-destination map`,
		);
	}
});

test('PORT getParentNodes is identical to n8n-workflow 2.9.1 (all ancestors, cycle-safe)', { timeout: 60000, skip: skipReason }, () => {
	for (const [name, connections] of Object.entries(GRAPHS)) {
		const byDestination = real.mapConnectionsByDestination(structuredClone(connections));
		for (const node of NODES[name]) {
			assert.deepEqual(
				mineParents(structuredClone(byDestination), node),
				real.getParentNodes(structuredClone(byDestination), node),
				`getParentNodes("${node}") differs on graph "${name}"`,
			);
		}
	}
});

test('PORT getConnectedNodes matches for connectionType main/ALL/ALL_NON_MAIN and depth limits', { timeout: 60000, skip: skipReason }, () => {
	const variants = [
		['main', -1],
		['main', 0],
		['main', 1],
		['main', 2],
		['ALL', -1],
		['ALL', 1],
		['ALL_NON_MAIN', -1],
	];
	for (const [name, connections] of Object.entries(GRAPHS)) {
		const byDestination = real.mapConnectionsByDestination(structuredClone(connections));
		for (const node of NODES[name]) {
			for (const [type, depth] of variants) {
				assert.deepEqual(
					mineConnected(structuredClone(byDestination), node, type, depth),
					real.getConnectedNodes(structuredClone(byDestination), node, type, depth),
					`getConnectedNodes("${node}", ${type}, depth=${depth}) differs on graph "${name}"`,
				);
			}
		}
	}
});

/* ------------------------------------------------------------------ *
 * getHighestNode — workflow.ts:492-568, compared against a real Workflow
 * ------------------------------------------------------------------ */

/**
 * `getHighestNode` is a Workflow method and depends on the `disabled` flag of every node it
 * visits, so the comparison needs real Workflow instances and explicit `disabled` values
 * (`undefined` and `false` are NOT the same to the reference: `:498` tests `=== false`).
 */
const HIGHEST_FIXTURES = {
	linear: { connections: GRAPHS.linear, nodes: { A: {}, B: {}, C: {}, D: {} } },
	linearDisabledFlag: {
		connections: GRAPHS.linear,
		nodes: { A: { disabled: false }, B: { disabled: false }, C: { disabled: false }, D: { disabled: false } },
	},
	diamondDisabledBranch: {
		connections: GRAPHS.diamond,
		nodes: { A: {}, B: { disabled: true }, C: {}, D: {} },
	},
	allParentsDisabled: {
		connections: { A: { main: [[edge('C')]] }, B: { main: [[edge('C')]] } },
		nodes: { A: { disabled: true }, B: { disabled: true }, C: {} },
	},
	fanInThree: { connections: GRAPHS.fanInThree, nodes: { M: {}, A: {}, B: {}, C: {} } },
	cycle: { connections: GRAPHS.cycle, nodes: { A: {}, B: {}, C: {} } },
};

const realWorkflow = (fixture) =>
	new real.Workflow({
		id: 'graph-equivalence',
		name: 'graph-equivalence',
		active: false,
		// n8n-workflow 2.9.1 takes the node list as an array (not the by-name map of later versions)
		nodes: Object.entries(fixture.nodes).map(([name, extra]) => ({
			name,
			type: 'n8n-nodes-base.noOp',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
			...extra,
		})),
		connections: structuredClone(fixture.connections),
		nodeTypes: { getByNameAndVersion: () => undefined }, // getHighestNode never touches it
		settings: {},
	});

test('PORT getHighestNode is identical to Workflow#getHighestNode in n8n-workflow 2.9.1', { timeout: 60000, skip: skipReason }, () => {
	let compared = 0;
	for (const [name, fixture] of Object.entries(HIGHEST_FIXTURES)) {
		const workflow = realWorkflow(fixture);
		const nodes = new Map(Object.entries(fixture.nodes).map(([n, extra]) => [n, { name: n, ...extra }]));
		const byDestination = real.mapConnectionsByDestination(structuredClone(fixture.connections));

		for (const node of Object.keys(fixture.nodes)) {
			for (const connectionIndex of [undefined, 0, 1, 2]) {
				assert.deepEqual(
					mineHighest(nodes, structuredClone(byDestination), node, connectionIndex),
					workflow.getHighestNode(node, connectionIndex),
					`getHighestNode("${node}", ${connectionIndex}) differs on fixture "${name}"`,
				);
				compared += 1;
			}
		}
	}
	assert.ok(compared > 50, `expected a meaningful comparison, made ${compared}`);
});
