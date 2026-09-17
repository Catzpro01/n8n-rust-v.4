/**
 * Connection LEGO — graph analysis behaviour (port `P-CONNECTION-GRAPH`).
 *
 * Every expectation below was read off the pinned reference artifact
 * (`n8n-workflow@2.9.1` — the n8n 2.9.4 dependency set) before it was written down:
 * `getRootNodes`, `getLeafNodes`, `getInputEdges`, `getOutputEdges`,
 * `parseExtractableSubgraphSelection`, `buildAdjacencyList` and `hasPath` are executed
 * through the real package and the values pinned here. `npm run connection:check`
 * (`tools/connection-isolation-gate.mjs`) re-proves them over a 12-graph corpus on every
 * run, including the order of returned arrays.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(fileURLToPath(import.meta.url), '..', '..');
const REPO = join(PKG, '..', '..');
const engine = await import(
	join(REPO, 'packages/reconstructed-engine/src/connection-routing-engine.mjs')
);
const {
	buildAdjacencyList,
	getInputEdges,
	getOutputEdges,
	getRootNodes,
	getLeafNodes,
	hasPath,
	parseExtractableSubgraphSelection,
	mapConnectionsByDestination,
	getHighestNode,
	getNodeConnectionIndexes,
} = engine;

const main = (node, index = 0) => ({ node, type: 'main', index });
const ai = (node, type = 'ai_languageModel', index = 0) => ({ node, type, index });
const asArray = (value) => (value instanceof Set ? [...value] : value);

const CHAIN = { A: { main: [[main('B')]] }, B: { main: [[main('C')]] }, C: { main: [[main('D')]] } };

test('buildAdjacencyList keeps the reference key set — no invented destination keys', () => {
	const adjacency = buildAdjacencyList(CHAIN);
	assert.deepEqual([...adjacency.keys()], ['A', 'B', 'C'], 'D has no outgoing edge and must not appear');
	assert.deepEqual([...adjacency.get('A')], [main('B')]);
	assert.equal(adjacency.get('D'), undefined);
});

test('getInputEdges / getOutputEdges are edges leading in and out of the selection', () => {
	const adjacency = buildAdjacencyList(CHAIN);
	const selection = new Set(['B', 'C']);
	assert.deepEqual(getInputEdges(selection, adjacency), [['A', main('B')]]);
	assert.deepEqual(getOutputEdges(selection, adjacency), [['C', main('D')]]);
	assert.deepEqual(getInputEdges(new Set(['A', 'B', 'C', 'D']), adjacency), [], 'internal edges are not input edges');
	assert.deepEqual(getOutputEdges(new Set(['A', 'B', 'C', 'D']), adjacency), []);
});

test('roots/leaves ignore edges coming from outside the selection (reference semantics)', () => {
	const adjacency = buildAdjacencyList(CHAIN);
	const selection = new Set(['B', 'C']);
	assert.deepEqual(asArray(getRootNodes(selection, adjacency)), ['B'], 'A is outside the selection');
	assert.deepEqual(asArray(getLeafNodes(selection, adjacency)), ['C']);
	assert.deepEqual(asArray(getRootNodes(new Set(['A', 'B', 'C', 'D']), adjacency)), ['A']);
	assert.deepEqual(asArray(getLeafNodes(new Set(['A', 'B', 'C', 'D']), adjacency)), ['D']);
});

test('self-loops and cycles are legal and never add a node to the root set', () => {
	const selfLoop = buildAdjacencyList({ A: { main: [[main('A')], [main('B')]] } });
	assert.deepEqual(asArray(getRootNodes(new Set(['A', 'B']), selfLoop)), ['A']);
	assert.deepEqual(asArray(getLeafNodes(new Set(['A', 'B']), selfLoop)), ['B']);

	const cycle = buildAdjacencyList({ A: { main: [[main('B')]] }, B: { main: [[main('A')]] } });
	assert.deepEqual(asArray(getRootNodes(new Set(['A', 'B']), cycle)), [], 'both nodes have an internal parent');
	assert.ok(hasPath('A', 'B', cycle) && hasPath('B', 'A', cycle), 'cycles stay reachable');
	assert.ok(!hasPath('A', 'Z', cycle));
});

test('multi-type edges are visible to adjacency and edges, ignored by roots/leaves/hasPath', () => {
	const adjacency = buildAdjacencyList({
		A: { main: [[main('B')]], ai_languageModel: [[ai('L')]] },
	});
	assert.deepEqual(getOutputEdges(new Set(['A']), adjacency), [
		['A', main('B')],
		['A', ai('L')],
	]);
	assert.deepEqual(
		asArray(getRootNodes(new Set(['A', 'B', 'L']), adjacency)),
		['A', 'L'],
		'root = no incoming MAIN edge; the ai sub-node has none either',
	);
	assert.deepEqual(asArray(getLeafNodes(new Set(['A', 'B', 'L']), adjacency)), ['B', 'L']);
	assert.ok(!hasPath('A', 'L', adjacency), 'hasPath walks main edges only');
});

test('parseExtractableSubgraphSelection returns the reference payloads', () => {
	const adjacency = buildAdjacencyList(CHAIN);
	assert.deepEqual(parseExtractableSubgraphSelection(new Set(['B', 'C']), adjacency), { start: 'B', end: 'C' });
	assert.deepEqual(
		parseExtractableSubgraphSelection(new Set(['A', 'B', 'C', 'D']), adjacency),
		{ start: undefined, end: undefined },
		'start/end only exist for root∩input and leaf∩output nodes',
	);

	// Two disconnected chains: the reference reports multiple roots only when they are also
	// INPUT nodes, so a selection without external input edges returns an empty result.
	const disconnected = buildAdjacencyList({ A: { main: [[main('B')]] }, C: { main: [[main('D')]] } });
	assert.deepEqual(parseExtractableSubgraphSelection(new Set(['A', 'B', 'C', 'D']), disconnected), {
		start: undefined,
		end: undefined,
	});

	const plain = (value) => JSON.parse(JSON.stringify(value, (key, val) => (val instanceof Set ? [...val] : val)));

	// Loop-back tolerance: one input node with a loop back into the selection is accepted.
	const loopBack = buildAdjacencyList({ A: { main: [[main('B')]] }, B: { main: [[main('C')]] }, C: { main: [[main('B')]] } });
	assert.deepEqual(plain(parseExtractableSubgraphSelection(new Set(['B', 'C']), loopBack)), { start: 'B' });

	// Two input root nodes.
	const twoInputs = buildAdjacencyList({ A: { main: [[main('C')]] }, B: { main: [[main('D')]] } });
	assert.deepEqual(plain(parseExtractableSubgraphSelection(new Set(['C', 'D']), twoInputs)), [
		{ errorCode: 'Multiple Input Nodes', nodes: ['C', 'D'] },
	]);

	// An input edge landing on a node that is not a root of the selection.
	const inputToNonRoot = buildAdjacencyList({
		A: { main: [[main('C')]] },
		B: { main: [[main('C')]] },
		C: { main: [[main('D')]] },
	});
	assert.deepEqual(plain(parseExtractableSubgraphSelection(new Set(['B', 'C']), inputToNonRoot)), [
		{ errorCode: 'Input Edge To Non-Root Node', node: 'C' },
	]);

	// Two output leaf nodes.
	const twoOutputs = buildAdjacencyList({ B: { main: [[main('X')]] }, C: { main: [[main('X')]] } });
	assert.deepEqual(plain(parseExtractableSubgraphSelection(new Set(['B', 'C']), twoOutputs)), [
		{ errorCode: 'Multiple Output Nodes', nodes: ['B', 'C'] },
	]);

	// Root and leaf exist but nothing connects them inside the selection.
	const noPath = buildAdjacencyList({ A: { main: [[main('C')]] }, B: { main: [[main('D')]] } });
	assert.deepEqual(plain(parseExtractableSubgraphSelection(new Set(['B', 'C']), noPath)), [
		{ errorCode: 'No Continuous Path From Root To Leaf In Selection', start: 'C', end: 'B' },
	]);

	assert.equal(typeof parseExtractableSubgraphSelection, 'function', 'invalid selections return data, not exceptions');
});

test('dangling destinations do not break traversal', () => {
	const adjacency = buildAdjacencyList({ A: { main: [[main('X')]] }, B: { main: [[main('A')]] } });
	assert.ok(hasPath('B', 'X', adjacency));
	assert.deepEqual(asArray(getRootNodes(new Set(['A', 'B']), adjacency)), ['B']);
	assert.deepEqual(mapConnectionsByDestination({ A: { main: [[main('X')]] } }).X.main[0][0].node, 'A');
});

test('getHighestNode walks to the top of the selection and honours `disabled`', () => {
	// Expected values read off the reference Workflow (`n8n-workflow@2.9.1`) before being written.
	const nodes = (names, disabled = []) =>
		Object.fromEntries(names.map((name) => [name, { name, disabled: disabled.includes(name) ? true : false }]));
	const chain = mapConnectionsByDestination(CHAIN);

	assert.deepEqual(getHighestNode(chain, nodes(['A', 'B', 'C', 'D']), 'C'), ['A']);
	assert.deepEqual(getHighestNode(chain, nodes(['A', 'B', 'C', 'D']), 'B'), ['A']);
	assert.deepEqual(getHighestNode(chain, nodes(['A', 'B', 'C', 'D']), 'A'), ['A'], 'A is a root and enabled');
	assert.deepEqual(getHighestNode(chain, nodes(['A', 'B', 'C', 'D']), 'C', 0), ['A']);
	// The reference only accepts a node whose flag is exactly `false` — an absent flag is not
	// "enabled" for this method (n8n always materialises `disabled`, workflows built by hand may not).
	assert.deepEqual(
		getHighestNode(chain, { A: { name: 'A' }, B: { name: 'B' }, C: { name: 'C' } }, 'A'),
		[],
		'`disabled: undefined` is not treated as enabled',
	);

	// Disabled nodes are never proposed as highest, but they are still traversed.
	assert.deepEqual(getHighestNode(chain, nodes(['A', 'B', 'C', 'D'], ['A']), 'C'), ['B']);
	assert.deepEqual(getHighestNode(chain, nodes(['A', 'B', 'C', 'D'], ['A']), 'B'), []);

	const diamond = mapConnectionsByDestination({
		A: { main: [[main('B')], [main('C')]] },
		B: { main: [[main('D')]] },
		C: { main: [[main('D')]] },
	});
	assert.deepEqual(getHighestNode(diamond, nodes(['A', 'B', 'C', 'D']), 'D'), ['A']);
});

test('getNodeConnectionIndexes reports the edge, and bails out when the parent is absent', () => {
	// Values read off the reference Workflow before being written.
	const chain = mapConnectionsByDestination(CHAIN);
	const existing = (name) => ({ name, disabled: false });

	assert.deepEqual(getNodeConnectionIndexes(chain, 'C', 'B', 'main', existing), { sourceIndex: 0, destinationIndex: 0 });
	assert.deepEqual(getNodeConnectionIndexes(chain, 'C', 'A', 'main', existing), { sourceIndex: 0, destinationIndex: 0 }, 'transitive parents are found by BFS');
	assert.deepEqual(getNodeConnectionIndexes(chain, 'A', 'B', 'main', existing), undefined, 'B is not a parent of A');

	const fanOut = mapConnectionsByDestination({ A: { main: [[main('B')], [main('C')]] } });
	assert.deepEqual(getNodeConnectionIndexes(fanOut, 'B', 'A', 'main', existing), { sourceIndex: 0, destinationIndex: 0 });
	assert.deepEqual(getNodeConnectionIndexes(fanOut, 'C', 'A', 'main', existing), { sourceIndex: 1, destinationIndex: 0 }, 'the output slot is reported');

	// A connection source that is not a node of the workflow (n8n keeps these when a node is
	// deleted): the reference returns undefined because `getNode(parent)` is null.
	const ghost = mapConnectionsByDestination({ Ghost: { main: [[main('A')]] }, A: { main: [[main('B')]] } });
	assert.equal(
		getNodeConnectionIndexes(ghost, 'A', 'Ghost', 'main', (name) => (name === 'Ghost' ? null : existing(name))),
		undefined,
	);
	// Without the getNode port the lookup falls back to a pure graph walk.
	assert.deepEqual(getNodeConnectionIndexes(ghost, 'A', 'Ghost', 'main'), { sourceIndex: 0, destinationIndex: 0 });
	assert.equal(getNodeConnectionIndexes(chain, 'C', 'B', 'ai_languageModel', existing), undefined, 'other connection types are ignored');
});

test('the ESM twin is the generated artifact of the TypeScript source', () => {
	const twin = readFileSync(join(REPO, 'packages/reconstructed-engine/src/connection-routing-engine.mjs'), 'utf8');
	assert.match(twin, /^\/\/ AUTO-GENERATED from connection-routing-engine\.ts/);
	assert.match(twin, /node tools\/connection-isolation-extract\.mjs --emit-esm/);
});
