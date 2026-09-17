/**
 * Port-equivalence + unit checks for the partial-execution STEPS added on top of the graph
 * foundation — reconstructed vs the REAL n8n-core 2.9.1 implementation.
 *
 * Covers (all in `packages/reconstructed-engine/partial.mjs`):
 *   getNextExecutionIndex              run-data-utils.ts:11-26                      (vs real)
 *   cleanRunData                       clean-run-data.ts:12-49                      (vs real)
 *   handleCycles                       handle-cycles.ts:15-56                       (vs real)
 *   anyReachableRootHasRunData         find-trigger-for-partial-execution.ts:30-64  (vs real)
 *   findTriggerForPartialExecution     find-trigger-for-partial-execution.ts:67-112 (vs real)
 *   getIncomingData / getIncomingDataFromAnyRun   get-incoming-data.ts:3-34         (unit only —
 *                                      the reference does not export these two)
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
	anyReachableRootHasRunData as mineAnyRootHasRunData,
	cleanRunData as mineCleanRunData,
	findTriggerForPartialExecution as mineFindTrigger,
	getIncomingData as mineGetIncomingData,
	getIncomingDataFromAnyRun as mineGetIncomingDataFromAnyRun,
	getNextExecutionIndex as mineGetNextExecutionIndex,
	handleCycles as mineHandleCycles,
} from '../partial.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const RUNTIME = process.env.LEGO_LIVE_RUNTIME ?? join(REPO, '.runtime', 'node_modules');
const runtimeReady =
	existsSync(join(RUNTIME, 'n8n-core', 'package.json')) &&
	existsSync(join(RUNTIME, 'n8n-nodes-base', 'package.json'));
const skipReason = runtimeReady
	? false
	: `pinned reference runtime not installed at ${RUNTIME} (run scripts/setup-reference-runtime.sh)`;

const req = runtimeReady ? createRequire(join(RUNTIME, 'package.json')) : null;
const core = runtimeReady ? req('n8n-core') : null;
const wf = runtimeReady ? req('n8n-workflow') : null;
const RealDirectedGraph = runtimeReady ? core.DirectedGraph : null;

/* ------------------------------------------------------------------ *
 * fixtures
 * ------------------------------------------------------------------ */

const edge = (node, index = 0) => ({ node, type: 'main', index });
const aiEdge = (node, index = 0) => ({ node, type: 'ai_tool', index });

const FIXTURES = {
	linear: {
		nodes: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
		connections: { A: { main: [[edge('B')]] }, B: { main: [[edge('C')]] } },
	},
	withAiParent: {
		nodes: [{ name: 'A' }, { name: 'Model' }, { name: 'B' }, { name: 'C' }],
		connections: {
			A: { main: [[edge('B')]] },
			Model: { ai_tool: [[aiEdge('B')]] },
			B: { main: [[edge('C')]] },
		},
	},
	cycle: {
		nodes: [{ name: 'T' }, { name: 'A' }, { name: 'B' }, { name: 'C' }],
		connections: {
			T: { main: [[edge('A')]] },
			A: { main: [[edge('B')]] },
			B: { main: [[edge('C')]] },
			C: { main: [[edge('A')]] },
		},
	},
	diamond: {
		nodes: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
		connections: {
			A: { main: [[edge('B'), edge('C')]] },
			B: { main: [[edge('D')]] },
			C: { main: [[edge('D')]] },
		},
	},
};

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

/** Run data for every node in a fixture — every node ran once with one item. */
const runDataFor = (fixture, { indexes = true, only = null } = {}) => {
	const runData = {};
	for (const node of fixture.nodes) {
		if (only && !only.includes(node.name)) continue;
		runData[node.name] = [
			{
				startTime: 1,
				executionTime: 1,
				source: [],
				data: { main: [[{ json: { node: node.name } }]] },
				...(indexes ? { executionIndex: 0 } : {}),
			},
		];
	}
	return runData;
};

/* ------------------------------------------------------------------ *
 * unit checks for the two helpers the reference does not export
 * ------------------------------------------------------------------ */

test('UNIT getIncomingData reads one slot of one run', { timeout: 60000 }, () => {
	const runData = {
		A: [
			{ data: { main: [[{ json: { run: 0, slot: 0 } }], [{ json: { run: 0, slot: 1 } }]] } },
			{ data: { main: [[{ json: { run: 1, slot: 0 } }]] } },
		],
	};

	assert.deepEqual(mineGetIncomingData(runData, 'A', 0, 'main', 1), [{ json: { run: 0, slot: 1 } }]);
	assert.deepEqual(mineGetIncomingData(runData, 'A', 1, 'main', 0), [{ json: { run: 1, slot: 0 } }]);

	// missing node / missing run index / missing output slot all give null, not undefined
	assert.equal(mineGetIncomingData(runData, 'Z', 0, 'main', 0), null);
	assert.equal(mineGetIncomingData(runData, 'A', 7, 'main', 0), null);
	assert.equal(mineGetIncomingData(runData, 'A', 1, 'main', 3), null);
});

test('UNIT getIncomingDataFromAnyRun returns the first run that actually has items', { timeout: 60000 }, () => {
	const runData = {
		A: [
			{ data: { main: [[]] } }, // run 0 produced nothing
			{ data: { main: [[{ json: { found: true } }]] } },
		],
	};

	assert.deepEqual(mineGetIncomingDataFromAnyRun(runData, 'A', 'main', 0), {
		data: [{ json: { found: true } }],
		runIndex: 1,
	});

	// nothing anywhere -> undefined; missing node -> undefined
	assert.equal(mineGetIncomingDataFromAnyRun({ A: [{ data: { main: [[]] } }] }, 'A', 'main', 0), undefined);
	assert.equal(mineGetIncomingDataFromAnyRun({}, 'A', 'main', 0), undefined);
});

/* ------------------------------------------------------------------ *
 * equivalence against the real n8n-core implementation
 * ------------------------------------------------------------------ */

test('PORT getNextExecutionIndex matches for empty, sparse and legacy run data', { timeout: 60000, skip: skipReason }, () => {
	const cases = [
		undefined,
		{},
		{ A: [{ executionIndex: 0 }] },
		{ A: [{ executionIndex: 3 }], B: [{ executionIndex: 1 }, { executionIndex: 5 }] },
		// nodes executed before `executionIndex` existed simply lack the field
		{ A: [{ startTime: 1 }], B: [{ executionIndex: 2 }] },
		{ A: [{ startTime: 1 }] },
		runDataFor(FIXTURES.linear),
		runDataFor(FIXTURES.linear, { indexes: false }),
	];

	for (const [i, runData] of cases.entries()) {
		assert.equal(
			mineGetNextExecutionIndex(runData),
			core.getNextExecutionIndex(runData),
			`case ${i} (${JSON.stringify(runData) ?? 'undefined'}) differs`,
		);
	}

	assert.equal(mineGetNextExecutionIndex(), 0, 'no argument at all -> 0');
	assert.equal(mineGetNextExecutionIndex({ A: [{ executionIndex: 4 }] }), 5, 'highest + 1');
});

test('PORT cleanRunData drops the cleaned node, its children and its sub-nodes', { timeout: 60000, skip: skipReason }, () => {
	let compared = 0;

	for (const [name, fixture] of Object.entries(FIXTURES)) {
		const nodeNames = fixture.nodes.map((n) => n.name);

		for (const nodeName of nodeNames) {
			for (const variant of [{ withIndexes: true }, { withIndexes: false }]) {
				const mineGraph = build(MineDirectedGraph, fixture);
				const realGraph = build(RealDirectedGraph, fixture);
				const runData = runDataFor(fixture, variant);
				// plus a node that is not part of the graph at all
				runData.NotInGraph = [{ executionIndex: 0 }];

				assert.deepEqual(
					Object.keys(mineCleanRunData(runData, mineGraph, new Set([mineGraph.getNodes().get(nodeName)]))).sort(),
					Object.keys(core.cleanRunData(runData, realGraph, new Set([realGraph.getNodes().get(nodeName)]))).sort(),
					`cleanRunData("${nodeName}") differs on "${name}"`,
				);
				compared += 1;
			}
		}

		// cleaning nothing must leave the graph's own run data alone but drop the foreign node
		const mineGraph = build(MineDirectedGraph, fixture);
		const realGraph = build(RealDirectedGraph, fixture);
		const runData = runDataFor(fixture);
		runData.NotInGraph = [{ executionIndex: 0 }];
		assert.deepEqual(
			Object.keys(mineCleanRunData(runData, mineGraph, new Set())).sort(),
			Object.keys(core.cleanRunData(runData, realGraph, new Set())).sort(),
			`cleanRunData(empty set) differs on "${name}"`,
		);
		compared += 1;
	}

	assert.ok(compared > 20, `expected a meaningful comparison, made ${compared}`);

	// sanity: cleaning A on the AI fixture also drops the Model sub-node, and does not mutate input
	const graph = build(MineDirectedGraph, FIXTURES.withAiParent);
	const runData = runDataFor(FIXTURES.withAiParent);
	const cleaned = mineCleanRunData(runData, graph, new Set([graph.getNodes().get('A')]));
	assert.deepEqual(Object.keys(cleaned), [], 'A, its children and its AI sub-node all go');
	assert.deepEqual(
		Object.keys(runData).sort(),
		['A', 'B', 'C', 'Model'],
		'the run data passed in must not be mutated',
	);
});

test('PORT handleCycles replaces a start node inside a cycle with the cycle start', { timeout: 60000, skip: skipReason }, () => {
	for (const [name, fixture] of Object.entries(FIXTURES)) {
		const mineGraph = build(MineDirectedGraph, fixture);
		const realGraph = build(RealDirectedGraph, fixture);

		for (const nodeName of fixture.nodes.map((n) => n.name)) {
			const mineStart = new Set([mineGraph.getNodes().get(nodeName)]);
			const realStart = new Set([realGraph.getNodes().get(nodeName)]);

			assert.deepEqual(
				[...mineHandleCycles(mineGraph, mineStart, mineGraph.getNodes().get(nodeName))].map((n) => n.name).sort(),
				[...core.handleCycles(realGraph, realStart, realGraph.getNodes().get(nodeName))].map((n) => n.name).sort(),
				`handleCycles from "${nodeName}" differs on "${name}"`,
			);
		}

		// Also the way runPartialWorkflow2 calls it: the trigger as DFS start point and every node of
		// the subgraph as a start node. Start nodes can only come from the subgraph, i.e. they must be
		// reachable from the trigger — a node that is not (the AI `Model` parent on the withAiParent
		// fixture) makes BOTH implementations throw the same assertion, which is checked below.
		const triggerName = fixture.nodes[0].name;
		const mineGraph2 = build(MineDirectedGraph, fixture);
		const realGraph2 = build(RealDirectedGraph, fixture);
		const reachableNames = (graph, fromName) => {
			const from = graph.getNodes().get(fromName);
			return new Set([fromName, ...[...graph.getChildren(from)].map((n) => n.name)]);
		};
		const mineReachable = reachableNames(mineGraph2, triggerName);
		const realReachable = reachableNames(realGraph2, triggerName);
		assert.deepEqual(
			[...mineHandleCycles(
				mineGraph2,
				mineGraph2.getNodesByNames([...mineReachable]),
				mineGraph2.getNodes().get(triggerName),
			)]
				.map((n) => n.name)
				.sort(),
			[...core.handleCycles(
				realGraph2,
				realGraph2.getNodesByNames([...realReachable]),
				realGraph2.getNodes().get(triggerName),
			)]
				.map((n) => n.name)
				.sort(),
			`handleCycles with all subgraph start nodes differs on "${name}"`,
		);
	}

	// A start node that is not reachable from the trigger is rejected by both implementations with
	// the same message (the reference's own assertion, handle-cycles.ts:44-47).
	{
		const mineGraph3 = build(MineDirectedGraph, FIXTURES.withAiParent);
		const realGraph3 = build(RealDirectedGraph, FIXTURES.withAiParent);
		const messageOf = (fn) => {
			try {
				fn();
				return '(no throw)';
			} catch (error) {
				return error.message;
			}
		};
		assert.equal(
			messageOf(() => mineHandleCycles(mineGraph3, mineGraph3.getNodesByNames(['Model']), mineGraph3.getNodes().get('A'))),
			messageOf(() => core.handleCycles(realGraph3, realGraph3.getNodesByNames(['Model']), realGraph3.getNodes().get('A'))),
			'an unreachable start node must fail the same way on both sides',
		);
	}

	// sanity: on the cycle fixture the start node B is replaced by the cycle's first reachable node
	const graph = build(MineDirectedGraph, FIXTURES.cycle);
	const result = mineHandleCycles(
		graph,
		new Set([graph.getNodes().get('B')]),
		graph.getNodes().get('T'),
	);
	assert.deepEqual([...result].map((n) => n.name), ['A'], 'B is inside the cycle, A is its entry');
});

test('PORT anyReachableRootHasRunData agrees on every fixture and run-data variant', { timeout: 60000, skip: skipReason }, () => {
	for (const [name, fixture] of Object.entries(FIXTURES)) {
		for (const destinationName of fixture.nodes.map((n) => n.name)) {
			for (const variant of [
				runDataFor(fixture),
				runDataFor(fixture, { only: [fixture.nodes[0].name] }),
				{},
			]) {
				const mineGraph = build(MineDirectedGraph, fixture);
				const realGraph = build(RealDirectedGraph, fixture);

				assert.equal(
					mineAnyRootHasRunData(mineGraph, destinationName, variant),
					core.anyReachableRootHasRunData(realGraph, destinationName, variant),
					`anyReachableRootHasRunData("${destinationName}") differs on "${name}"`,
				);
			}
		}
	}

	// unknown destination -> false on both sides
	const graph = build(MineDirectedGraph, FIXTURES.linear);
	assert.equal(mineAnyRootHasRunData(graph, 'Nope', runDataFor(FIXTURES.linear)), false);
});

/* ------------------------------------------------------------------ *
 * findTriggerForPartialExecution needs a real Workflow with real node types
 * ------------------------------------------------------------------ */

let registryPromise = null;
function loadRegistry() {
	registryPromise ??= (async () => {
		process.env.N8N_RUNNERS_ENABLED ??= 'false';
		process.env.N8N_RUNNERS_TASK_BROKER_URI ??= '';
		const loader = new core.PackageDirectoryLoader(join(RUNTIME, 'n8n-nodes-base'));
		await loader.loadAll();
		const byShortName = loader.nodeTypes;
		const known = loader.known?.nodes ?? {};

		return {
			getByNameAndVersion(type, version) {
				let entry = null;
				if (known[type]) {
					const { className } = known[type];
					if (className && byShortName[className]) entry = byShortName[className];
				}
				if (!entry) {
					const short = type.includes('.') ? type.split('.').slice(1).join('.') : type;
					entry = byShortName[short] ?? byShortName[short.charAt(0).toLowerCase() + short.slice(1)] ?? null;
				}
				if (!entry) return undefined;
				return wf.NodeHelpers.getVersionedNodeType(entry.type, version);
			},
		};
	})();
	return registryPromise;
}

const realNode = (name, type, extra = {}) => ({
	name,
	type,
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
	...extra,
});

test('PORT findTriggerForPartialExecution follows the reference precedence', { timeout: 120000, skip: skipReason }, async () => {
	const nodeTypes = await loadRegistry();

	const buildWorkflow = (nodes, connections, pinData) =>
		new wf.Workflow({
			id: 'find-trigger',
			name: 'find-trigger',
			nodes,
			connections,
			active: false,
			nodeTypes,
			pinData,
			settings: { executionOrder: 'v1' },
		});

	const cases = [
		{
			name: 'the destination is itself an enabled trigger',
			workflow: () =>
				buildWorkflow(
					[realNode('Hook', 'n8n-nodes-base.webhook'), realNode('After', 'n8n-nodes-base.noOp')],
					{ Hook: { main: [[edge('After')]] } },
					{},
				),
			destination: 'Hook',
			runData: {},
			expected: 'Hook',
		},
		{
			name: 'a disabled trigger as destination falls through to its parent trigger',
			workflow: () =>
				buildWorkflow(
					[
						realNode('Manual', 'n8n-nodes-base.manualTrigger'),
						realNode('Hook', 'n8n-nodes-base.webhook', { disabled: true }),
						realNode('After', 'n8n-nodes-base.noOp'),
					],
					{ Manual: { main: [[edge('Hook')]] }, Hook: { main: [[edge('After')]] } },
					{},
				),
			destination: 'Hook',
			runData: {},
			expected: 'Manual',
		},
		{
			name: 'a parent trigger that already has run data wins over a pinned one',
			workflow: () =>
				buildWorkflow(
					[
						realNode('Manual', 'n8n-nodes-base.manualTrigger'),
						realNode('Hook', 'n8n-nodes-base.webhook'),
						realNode('After', 'n8n-nodes-base.noOp'),
					],
					{ Manual: { main: [[edge('After')]] }, Hook: { main: [[edge('After')]] } },
					{ Hook: [{ json: { pinned: true } }] },
				),
			destination: 'After',
			runData: { Manual: [{ startTime: 1 }] },
			expected: 'Manual',
		},
		{
			name: 'a pinned webhook trigger wins over a pinned non-webhook trigger',
			workflow: () =>
				buildWorkflow(
					[
						realNode('Manual', 'n8n-nodes-base.manualTrigger'),
						realNode('Hook', 'n8n-nodes-base.webhook'),
						realNode('After', 'n8n-nodes-base.noOp'),
					],
					{ Manual: { main: [[edge('After')]] }, Hook: { main: [[edge('After')]] } },
					{ Manual: [{ json: { a: 1 } }], Hook: [{ json: { b: 2 } }] },
				),
			destination: 'After',
			runData: {},
			expected: 'Hook',
		},
		{
			// Arrangement chosen so that `getParentNodes('After')` really is
			// ["Manual","Mid","Hook"] (verified against n8n-workflow 2.9.1), i.e. `parentTriggers[0]`
			// is the NON-webhook trigger. Dropping the webhook preference makes this return Manual,
			// so the case only passes if the reference's last precedence rule is applied.
			name: 'a webhook trigger wins over another trigger when nothing is pinned',
			workflow: () =>
				buildWorkflow(
					[
						realNode('Manual', 'n8n-nodes-base.manualTrigger'),
						realNode('Hook', 'n8n-nodes-base.webhook'),
						realNode('After', 'n8n-nodes-base.noOp'),
						realNode('Mid', 'n8n-nodes-base.noOp'),
					],
					{
						Manual: { main: [[edge('Mid')]] },
						Hook: { main: [[edge('After')]] },
						Mid: { main: [[edge('After')]] },
					},
					{},
				),
			destination: 'After',
			runData: {},
			expected: 'Hook',
		},
		{
			name: 'with only one parent trigger, that one is used',
			workflow: () =>
				buildWorkflow(
					[realNode('Manual', 'n8n-nodes-base.manualTrigger'), realNode('After', 'n8n-nodes-base.noOp')],
					{ Manual: { main: [[edge('After')]] } },
					{},
				),
			destination: 'After',
			runData: {},
			expected: 'Manual',
		},
		{
			name: 'no trigger anywhere -> undefined',
			workflow: () =>
				buildWorkflow(
					[realNode('A', 'n8n-nodes-base.noOp'), realNode('B', 'n8n-nodes-base.noOp')],
					{ A: { main: [[edge('B')]] } },
					{},
				),
			destination: 'B',
			runData: {},
			expected: undefined,
		},
		{
			name: 'unknown destination -> undefined',
			workflow: () =>
				buildWorkflow(
					[realNode('Manual', 'n8n-nodes-base.manualTrigger'), realNode('After', 'n8n-nodes-base.noOp')],
					{ Manual: { main: [[edge('After')]] } },
					{},
				),
			destination: 'Nowhere',
			runData: {},
			expected: undefined,
		},
	];

	for (const testCase of cases) {
		const mineWorkflow = testCase.workflow();
		const realWorkflow = testCase.workflow();

		const mine = mineFindTrigger(mineWorkflow, testCase.destination, testCase.runData);
		const real = core.findTriggerForPartialExecution(realWorkflow, testCase.destination, testCase.runData);

		assert.equal(mine?.name, real?.name, `reference disagrees on "${testCase.name}"`);
		assert.equal(mine?.name, testCase.expected, `wrong trigger for "${testCase.name}"`);
	}
});
