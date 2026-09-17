/**
 * Connection LEGO — Phase 3 conformance suite.
 *
 * The oracle is never hand-written: every expectation comes from the pinned n8n 2.9.4
 * reference runtime, captured into
 *
 *   - `tests/reference/workflow-rust/fixtures.json`  (traversal 9, compareConnections 6)
 *     derived by `tests/reference/workflow-rust/build-fixtures.mjs` from `n8n-workflow@2.9.1`;
 *   - `tests/reference/connection/01..05/expected.json`
 *     recorded by `tests/reference/harness/` against the same runtime.
 *
 * What this suite proves: the reconstruction in `packages/connection-lego/src` reproduces those
 * recorded values, and the suite can tell a correct implementation from a plausible-but-wrong
 * one (the negative controls at the bottom).
 *
 * run:  npm --prefix packages/connection-lego test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');

const lego = await import('../dist/index.js');
const {
	getChildNodes,
	getParentNodes,
	getConnectedNodes,
	mapConnectionsByDestination,
	buildAdjacencyList,
	getRootNodes,
	getLeafNodes,
	getInputEdges,
	getOutputEdges,
	hasPath,
	parseExtractableSubgraphSelection,
	compareConnections,
} = lego;

const fixtures = JSON.parse(
	readFileSync(join(REPO, 'tests/reference/workflow-rust/fixtures.json'), 'utf8'),
);

/** Same normalisation the recording harness applied, so goldens stay comparable. */
const setToArr = (v) => (v instanceof Set ? [...v] : v);
const plain = (v) =>
	JSON.parse(
		JSON.stringify(v, (_, x) =>
			x instanceof Set ? [...x] : x instanceof Map ? Object.fromEntries(x) : x,
		),
	);

/* ------------------------------------------------------------------ */
/* 1. fixtures.json — traversal (9) + compareConnections (6)          */
/* ------------------------------------------------------------------ */

/**
 * The graph the `traversal` fixtures were derived from.
 * Source: `tests/reference/workflow-rust/build-fixtures.mjs:333-342`. If this ever diverges
 * from the builder the 9 assertions below fail, so the copy is self-checking.
 */
const c = (n, t = 'main', i = 0) => ({ node: n, type: t, index: i });
const traversalGraph = {
	A: { main: [[c('B')]], ai_languageModel: [[c('M')]] },
	B: { main: [[c('C')]] },
	C: { main: [[c('D')]] },
	D: {},
	M: {},
};

test('fixtures.json: reference provenance is the pinned runtime', () => {
	assert.equal(fixtures.provenance.package, 'n8n-workflow');
	assert.equal(fixtures.provenance.version, '2.9.1');
	assert.match(fixtures.provenance.referenceSource, /b6dc2787c45677a29a9612cd27eb911302961a83/);
});

for (const kase of fixtures.traversal) {
	test(`traversal/${kase.id} — getConnectedNodes(${kase.from}, ${kase.type}, depth=${kase.depth})`, () => {
		const got = getConnectedNodes(traversalGraph, kase.from, kase.type, kase.depth);
		assert.deepEqual(got, kase.result);
	});
}

for (const kase of fixtures.compareConnections) {
	test(`compareConnections/${kase.id}`, () => {
		const got = plain(compareConnections(kase.prev, kase.next));
		assert.deepEqual(got, kase.result);
	});
}

/* ------------------------------------------------------------------ */
/* 2. tests/reference/connection/01..05 golden cases                  */
/* ------------------------------------------------------------------ */

/**
 * Ops this LEGO owns (`contracts/connection.contract.md` §7). The `wf.*` ops in the same
 * golden files probe the Workflow aggregate and belong to LEGO 01 — they are skipped and
 * counted, so the suite reports exactly what it did and did not cover.
 */
const OWNED_OPS = new Set([
	'byDestination',
	'getChildNodes',
	'getParentNodes',
	'getConnectedNodes',
	'adjacencyKeys',
	'getRootNodes',
	'getLeafNodes',
	'getInputEdges',
	'getOutputEdges',
	'hasPath',
	'parseExtractable',
	'compareConnections',
]);

function runProbe(p, conn, byDest, adj) {
	switch (p.op) {
		case 'byDestination':
			return p.node ? byDest[p.node] : byDest;
		case 'getChildNodes':
			return getChildNodes(conn, p.node, p.type, p.depth);
		case 'getParentNodes':
			return getParentNodes(byDest, p.node, p.type, p.depth);
		case 'getConnectedNodes':
			return getConnectedNodes(conn, p.node, p.type, p.depth);
		case 'adjacencyKeys':
			return [...adj.keys()];
		case 'getRootNodes':
			return getRootNodes(new Set(p.graph), adj);
		case 'getLeafNodes':
			return getLeafNodes(new Set(p.graph), adj);
		case 'getInputEdges':
			return getInputEdges(new Set(p.graph), adj);
		case 'getOutputEdges':
			return getOutputEdges(new Set(p.graph), adj);
		case 'hasPath':
			return hasPath(p.start, p.end, adj);
		case 'parseExtractable':
			return parseExtractableSubgraphSelection(new Set(p.graph), adj);
		case 'compareConnections':
			return compareConnections(conn, p.next);
		default:
			throw new Error(`unhandled op ${p.op}`);
	}
}

let owned = 0;
let skipped = 0;
const skippedOps = new Set();

for (const name of readdirSync(join(REPO, 'tests/reference/connection')).sort()) {
	const dir = join(REPO, 'tests/reference/connection', name);
	let kase;
	let expected;
	try {
		kase = JSON.parse(readFileSync(join(dir, 'case.json'), 'utf8'));
		expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
	} catch {
		continue; // not a case directory
	}

	const conn = kase.connections;
	const byDest = mapConnectionsByDestination(conn);
	const adj = buildAdjacencyList(conn);

	for (const p of kase.probes) {
		if (!OWNED_OPS.has(p.op)) {
			skipped++;
			skippedOps.add(p.op);
			continue;
		}
		owned++;
		test(`connection/${name} :: ${p.name}`, () => {
			const got = plain(setToArr(runProbe(p, conn, byDest, adj)));
			assert.deepEqual(got, expected[p.name]);
		});
	}
}

test('golden coverage: every Connection-owned probe was asserted', () => {
	assert.ok(owned >= 30, `expected at least 30 owned probes, ran ${owned}`);
	// The workflow-aggregate probes are LEGO 01's; make the exclusion explicit and stable.
	assert.deepEqual([...skippedOps].sort(), [
		'wf.getNodeConnectionIndexes',
		'wf.getHighestNode',
		'wf.getParentMainInputNode',
		'wf.getParentNodesByDepth',
		'wf.getStartNode',
	].sort());
});

/* ------------------------------------------------------------------ */
/* 3. negative controls — the oracle must be able to fail             */
/* ------------------------------------------------------------------ */

test('negative control: a sorted traversal order does NOT satisfy the goldens', () => {
	// A "reasonable" reimplementation would sort or append instead of unshift+splice.
	const naive = (connections, nodeName) => {
		const out = [];
		const seen = new Set([nodeName]);
		const queue = [nodeName];
		while (queue.length) {
			const n = queue.shift();
			for (const slot of connections[n]?.main ?? []) {
				for (const conn of slot ?? []) {
					if (seen.has(conn.node)) continue;
					seen.add(conn.node);
					out.push(conn.node); // append, BFS order
					queue.push(conn.node);
				}
			}
		}
		return out;
	};
	const expected = fixtures.traversal.find((k) => k.id === 'default-main-depth-unlimited').result;
	assert.notDeepEqual(naive(traversalGraph, 'A'), expected, 'oracle failed to discriminate');
	assert.deepEqual(getConnectedNodes(traversalGraph, 'A', 'main', -1), expected);
});

test('negative control: positional slot comparison changes compareConnections', () => {
	const kase = fixtures.compareConnections.find((k) => k.id === 'slot-shifted');
	// A plausible reimplementation compares each slot position-by-position. The reference
	// compares each slot as a SET keyed by JSON.stringify, so reordering inside a slot is a
	// no-op — a positional diff would report two adds and two removals here.
	const positional = (prev, next) => {
		const added = {};
		const removed = {};
		for (const node of new Set([...Object.keys(prev), ...Object.keys(next)])) {
			const a = prev[node] ?? {};
			const b = next[node] ?? {};
			for (const input of new Set([...Object.keys(a), ...Object.keys(b)])) {
				const pa = a[input] ?? [];
				const pb = b[input] ?? [];
				for (let s = 0; s < Math.max(pa.length, pb.length); s++) {
					const ca = pa[s] ?? [];
					const cb = pb[s] ?? [];
					for (let i = 0; i < Math.max(ca.length, cb.length); i++) {
						if (JSON.stringify(ca[i]) !== JSON.stringify(cb[i])) {
							if (cb[i] !== undefined) {
								(added[node] ??= {})[input] ??= [];
								added[node][input].push({ sourceIndex: s, value: { index: i, connection: cb[i] } });
							}
							if (ca[i] !== undefined) {
								(removed[node] ??= {})[input] ??= [];
								removed[node][input].push({ sourceIndex: s, value: { index: i, connection: ca[i] } });
							}
						}
					}
				}
			}
		}
		return { added, removed };
	};
	assert.notDeepEqual(
		plain(positional(kase.prev, kase.next)),
		kase.result,
		'oracle failed to discriminate',
	);
	assert.deepEqual(plain(compareConnections(kase.prev, kase.next)), kase.result);
});

test('coverage summary', () => {
	console.log(
		`  Connection-owned probes asserted: ${owned} · skipped (Workflow LEGO wf.*): ${skipped}`,
	);
});
