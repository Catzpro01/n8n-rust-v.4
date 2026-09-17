/**
 * Port-equivalence check for the partial-execution graph foundation — reconstructed vs the REAL
 * n8n-core 2.9.1 implementation.
 *
 * `packages/reconstructed-engine/partial.mjs` claims to be a 1:1 port of
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/directed-graph.ts
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/filter-disabled-nodes.ts
 *   reference/n8n/packages/core/src/execution-engine/partial-execution-utils/find-subgraph.ts
 *
 * The pinned runtime EXPORTS those implementations (`DirectedGraph`, `findSubgraph`,
 * `filterDisabledNodes`), so this file does not have to trust the reading: it builds the same graph
 * on both sides and compares node sets, connection sets, traversals, cycle detection, node removal,
 * disabled-node filtering and the subgraph search.
 *
 * Skipped automatically when the pinned runtime is absent (`scripts/setup-reference-runtime.sh`).
 * run: npm run engine:test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	DirectedGraph as MineDirectedGraph,
	filterDisabledNodes as mineFilterDisabled,
	findSubgraph as mineFindSubgraph,
} from '../partial.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const RUNTIME = process.env.LEGO_LIVE_RUNTIME ?? join(REPO, '.runtime', 'node_modules');
const runtimeReady =
	existsSync(join(RUNTIME, 'n8n-core', 'package.json')) &&
	existsSync(join(RUNTIME, 'n8n-workflow', 'package.json'));
const skipReason = runtimeReady
	? false
	: `pinned reference runtime not installed at ${RUNTIME} (run scripts/setup-reference-runtime.sh)`;

const req = runtimeReady ? createRequire(join(RUNTIME, 'package.json')) : null;
const core = runtimeReady ? req('n8n-core') : null;
const wf = runtimeReady ? req('n8n-workflow') : null;

const RealDirectedGraph = runtimeReady ? core.DirectedGraph : null;

/* ------------------------------------------------------------------ *
 * fixtures — node lists plus IConnections, in the shape a workflow file stores
 * ------------------------------------------------------------------ */

const edge = (node, index = 0) => ({ node, type: 'main', index });
const aiEdge = (node, index = 0) => ({ node, type: 'ai_tool', index });

const FIXTURES = {
	single: {
		nodes: [{ name: 'A' }],
		connections: {},
	},
	linear: {
		nodes: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
		connections: { A: { main: [[edge('B')]] }, B: { main: [[edge('C')]] }, C: { main: [[edge('D')]] } },
	},
	diamond: {
		nodes: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
		connections: {
			A: { main: [[edge('B'), edge('C')]] },
			B: { main: [[edge('D')]] },
			C: { main: [[edge('D')]] },
		},
	},
	// a node in the middle is switched off: parents must be rewired to children
	withDisabled: {
		nodes: [{ name: 'A' }, { name: 'B', disabled: true }, { name: 'C' }],
		connections: { A: { main: [[edge('B')]] }, B: { main: [[edge('C')]] } },
	},
	// a disabled node that also has an AI utility parent: only `main` may be rewired
	disabledWithAiParent: {
		nodes: [{ name: 'A' }, { name: 'Model' }, { name: 'B', disabled: true }, { name: 'C' }],
		connections: {
			A: { main: [[edge('B')]] },
			Model: { ai_tool: [[aiEdge('B')]] },
			B: { main: [[edge('C')]] },
		},
	},
	cycle: {
		nodes: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
		connections: { A: { main: [[edge('B')]] }, B: { main: [[edge('C')]] }, C: { main: [[edge('A')]] } },
	},
	selfLoop: {
		nodes: [{ name: 'A' }],
		connections: { A: { main: [[edge('A')]] } },
	},
	// branch that cannot reach the trigger at all
	orphanBranch: {
		nodes: [{ name: 'T' }, { name: 'B' }, { name: 'C' }, { name: 'X' }],
		connections: {
			T: { main: [[edge('B')]] },
			B: { main: [[edge('C')]] },
			X: { main: [[edge('C')]] },
		},
	},
	multiType: {
		nodes: [{ name: 'Agent' }, { name: 'Tool' }, { name: 'Model' }],
		connections: {
			Agent: { main: [[edge('Tool')]], ai_tool: [[aiEdge('Tool')]] },
			Model: { ai_tool: [[aiEdge('Agent')]] },
		},
	},
	// only input slot 1 is used → slot 0 must be padded with an empty array on export
	sparseIndex: {
		nodes: [{ name: 'Merge' }, { name: 'B' }],
		connections: { B: { main: [[edge('Merge', 1)]] } },
	},
};

/** Fresh node objects per graph — the reference compares nodes by OBJECT IDENTITY. */
const makeNodes = (fixture) =>
	fixture.nodes.map((node) => ({
		type: 'n8n-nodes-base.noOp',
		typeVersion: 1,
		position: [0, 0],
		parameters: {},
		...structuredClone(node),
	}));

const build = (Impl, fixture) =>
	Impl.fromNodesAndConnections(makeNodes(fixture), structuredClone(fixture.connections));

/* comparable views -------------------------------------------------- */

const nodeNames = (graph) => [...graph.getNodes().keys()].sort();

const connectionTuples = (graph) =>
	graph
		.getConnections()
		.map((c) => `${c.from.name}|${c.type}|${c.outputIndex}|${c.inputIndex}|${c.to.name}`)
		.sort();

const sccView = (graph) =>
	graph
		.getStronglyConnectedComponents()
		.map((component) => [...component].map((n) => n.name).sort().join(','))
		.sort();

/* ------------------------------------------------------------------ */

test('PORT DirectedGraph exposes exactly the reference class surface (minus toWorkflow)', { timeout: 60000, skip: skipReason }, () => {
	const realMethods = Object.getOwnPropertyNames(RealDirectedGraph.prototype).filter(
		(name) => name !== 'constructor',
	);
	const mineMethods = Object.getOwnPropertyNames(MineDirectedGraph.prototype).filter(
		(name) => name !== 'constructor',
	);

	// toWorkflow builds a `Workflow` instance, which belongs to the Workflow LEGO.
	assert.deepEqual(
		mineMethods.sort(),
		realMethods.filter((name) => name !== 'toWorkflow').sort(),
		'the ported class must expose the same methods as the reference',
	);
	assert.deepEqual(
		Object.getOwnPropertyNames(MineDirectedGraph)
			.filter((n) => !['length', 'name', 'prototype'].includes(n))
			.sort(),
		Object.getOwnPropertyNames(RealDirectedGraph)
			.filter((n) => !['length', 'name', 'prototype'].includes(n))
			.sort(),
		'same static factories',
	);
});

test('PORT fromNodesAndConnections imports nodes and connections identically', { timeout: 60000, skip: skipReason }, () => {
	for (const [name, fixture] of Object.entries(FIXTURES)) {
		assert.deepEqual(nodeNames(build(MineDirectedGraph, fixture)), nodeNames(build(RealDirectedGraph, fixture)), `nodes differ on "${name}"`);
		assert.deepEqual(
			connectionTuples(build(MineDirectedGraph, fixture)),
			connectionTuples(build(RealDirectedGraph, fixture)),
			`connections differ on "${name}"`,
		);
	}
});

test('PORT fromWorkflow imports a real Workflow identically', { timeout: 60000, skip: skipReason }, () => {
	for (const [name, fixture] of Object.entries(FIXTURES)) {
		const workflow = new wf.Workflow({
			id: 'partial-equivalence',
			name: 'partial-equivalence',
			active: false,
			// n8n-workflow 2.9.1 takes the node list as an array
			nodes: makeNodes(fixture),
			connections: structuredClone(fixture.connections),
			nodeTypes: { getByNameAndVersion: () => undefined }, // never called by fromWorkflow
			settings: {},
		});

		assert.deepEqual(
			nodeNames(MineDirectedGraph.fromWorkflow(workflow)),
			nodeNames(RealDirectedGraph.fromWorkflow(workflow)),
			`nodes differ on "${name}"`,
		);
		assert.deepEqual(
			connectionTuples(MineDirectedGraph.fromWorkflow(workflow)),
			connectionTuples(RealDirectedGraph.fromWorkflow(workflow)),
			`connections differ on "${name}"`,
		);
	}
});

test('PORT traversals (children, parent connections, DFS) match on every fixture', { timeout: 60000, skip: skipReason }, () => {
	for (const [name, fixture] of Object.entries(FIXTURES)) {
		const mine = build(MineDirectedGraph, fixture);
		const real = build(RealDirectedGraph, fixture);

		for (const nodeName of nodeNames(mine)) {
			const mineNode = mine.getNodes().get(nodeName);
			const realNode = real.getNodes().get(nodeName);

			assert.deepEqual(
				mine.getDirectChildConnections(mineNode).map((c) => c.to.name).sort(),
				real.getDirectChildConnections(realNode).map((c) => c.to.name).sort(),
				`direct children of "${nodeName}" differ on "${name}"`,
			);
			assert.deepEqual(
				mine.getDirectParentConnections(mineNode).map((c) => c.from.name).sort(),
				real.getDirectParentConnections(realNode).map((c) => c.from.name).sort(),
				`direct parents of "${nodeName}" differ on "${name}"`,
			);
			assert.deepEqual(
				[...mine.getChildren(mineNode)].map((n) => n.name).sort(),
				[...real.getChildren(realNode)].map((n) => n.name).sort(),
				`children of "${nodeName}" differ on "${name}"`,
			);
			assert.deepEqual(
				[...mine.getParentConnections(mineNode)].map((c) => `${c.from.name}->${c.to.name}`).sort(),
				[...real.getParentConnections(realNode)].map((c) => `${c.from.name}->${c.to.name}`).sort(),
				`parent connections of "${nodeName}" differ on "${name}"`,
			);

			// depthFirstSearch for a predicate that only matches one specific node
			for (const target of nodeNames(mine)) {
				assert.equal(
					mine.depthFirstSearch({ from: mineNode, fn: (n) => n.name === target })?.name,
					real.depthFirstSearch({ from: realNode, fn: (n) => n.name === target })?.name,
					`DFS from "${nodeName}" to "${target}" differs on "${name}"`,
				);
			}
		}
	}
});

test('PORT getStronglyConnectedComponents (Tarjan) matches on every fixture', { timeout: 60000, skip: skipReason }, () => {
	for (const [name, fixture] of Object.entries(FIXTURES)) {
		assert.deepEqual(
			sccView(build(MineDirectedGraph, fixture)),
			sccView(build(RealDirectedGraph, fixture)),
			`strongly connected components differ on "${name}"`,
		);
	}

	// sanity: the cycle fixture really is one component of three nodes
	const cycleScc = sccView(build(MineDirectedGraph, FIXTURES.cycle));
	assert.ok(cycleScc.includes('A,B,C'), `expected a 3-node component, got ${JSON.stringify(cycleScc)}`);
});

test('PORT removeNode matches for both modes, including skipConnectionFn', { timeout: 60000, skip: skipReason }, () => {
	const variants = [
		{ reconnectConnections: false },
		{ reconnectConnections: true },
		{ reconnectConnections: true, skipConnectionFn: (c) => c.type !== 'main' },
	];

	for (const [name, fixture] of Object.entries(FIXTURES)) {
		for (const nodeName of fixture.nodes.map((n) => n.name)) {
			for (const options of variants) {
				const mine = build(MineDirectedGraph, fixture);
				const real = build(RealDirectedGraph, fixture);

				const mineReturned = mine.removeNode(mine.getNodes().get(nodeName), { ...options });
				const realReturned = real.removeNode(real.getNodes().get(nodeName), { ...options });

				assert.deepEqual(nodeNames(mine), nodeNames(real), `nodes after removing "${nodeName}" differ on "${name}" (${JSON.stringify(options)})`);
				assert.deepEqual(
					connectionTuples(mine),
					connectionTuples(real),
					`connections after removing "${nodeName}" differ on "${name}" (${JSON.stringify(options)})`,
				);
				assert.deepEqual(
					(mineReturned ?? []).map((c) => `${c.from.name}->${c.to.name}:${c.inputIndex}`).sort(),
					(realReturned ?? []).map((c) => `${c.from.name}->${c.to.name}:${c.inputIndex}`).sort(),
					`returned rewired connections differ on "${name}" (${JSON.stringify(options)})`,
				);
			}
		}
	}
});

test('PORT filterDisabledNodes rewires parents to children identically', { timeout: 60000, skip: skipReason }, () => {
	for (const [name, fixture] of Object.entries(FIXTURES)) {
		const mine = mineFilterDisabled(build(MineDirectedGraph, fixture));
		const real = core.filterDisabledNodes(build(RealDirectedGraph, fixture));

		assert.deepEqual(nodeNames(mine), nodeNames(real), `nodes differ on "${name}"`);
		assert.deepEqual(connectionTuples(mine), connectionTuples(real), `connections differ on "${name}"`);
	}

	// sanity: the disabled node is gone and its parent now feeds its child directly
	const filtered = mineFilterDisabled(build(MineDirectedGraph, FIXTURES.withDisabled));
	assert.deepEqual(nodeNames(filtered), ['A', 'C']);
	assert.deepEqual(connectionTuples(filtered), ['A|main|0|0|C']);

	// …and an AI utility link is NOT rewired into a dataflow edge
	const aiFiltered = mineFilterDisabled(build(MineDirectedGraph, FIXTURES.disabledWithAiParent));
	assert.deepEqual(connectionTuples(aiFiltered), ['A|main|0|0|C'], 'only main connections are rewired');
});

test('PORT findSubgraph keeps exactly the branches that reach the trigger', { timeout: 60000, skip: skipReason }, () => {
	let compared = 0;

	for (const [name, fixture] of Object.entries(FIXTURES)) {
		const names = fixture.nodes.map((n) => n.name);
		for (const destinationName of names) {
			for (const triggerName of names) {
				// the destination and the trigger must come from the SAME graph instance — both the
				// reference and the port look nodes up by OBJECT IDENTITY and assert they exist
				const mineGraph = build(MineDirectedGraph, fixture);
				const mine = mineFindSubgraph({
					graph: mineGraph,
					destination: mineGraph.getNodes().get(destinationName),
					trigger: mineGraph.getNodes().get(triggerName),
				});
				const realGraph = build(RealDirectedGraph, fixture);
				const real = core.findSubgraph({
					graph: realGraph,
					destination: realGraph.getNodes().get(destinationName),
					trigger: realGraph.getNodes().get(triggerName),
				});

				assert.deepEqual(
					nodeNames(mine),
					nodeNames(real),
					`findSubgraph(${destinationName} <- ${triggerName}) nodes differ on "${name}"`,
				);
				assert.deepEqual(
					connectionTuples(mine),
					connectionTuples(real),
					`findSubgraph(${destinationName} <- ${triggerName}) connections differ on "${name}"`,
				);
				compared += 1;
			}
		}
	}

	assert.ok(compared > 50, `expected a meaningful comparison, made ${compared}`);

	// sanity: on the orphan-branch fixture the unreachable parent X is dropped
	const graph = build(MineDirectedGraph, FIXTURES.orphanBranch);
	const sub = mineFindSubgraph({
		graph,
		destination: graph.getNodes().get('C'),
		trigger: graph.getNodes().get('T'),
	});
	assert.deepEqual(nodeNames(sub), ['B', 'C', 'T'], 'a branch that cannot reach the trigger is dropped');
});
