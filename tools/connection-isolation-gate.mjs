#!/usr/bin/env node
/**
 * Connection LEGO — Phase 3 gate (port `P-CONNECTION-GRAPH`).
 *
 * The reference runtime is the oracle: every function the routing engine claims to
 * reconstruct 1:1 is executed twice — once through the pinned `n8n-workflow@2.9.1`
 * artifact (the n8n 2.9.4 dependency set) and once through
 * `packages/reconstructed-engine/src/connection-routing-engine.mjs` — over a corpus of
 * connection graphs. Any difference in order or content is reported with a minimal
 * reproduction; the gate exits non-zero when anything diverges.
 *
 *   C01 declared surface — manifest publicSurface symbols exist in reference + candidate
 *   C02 boundary         — the candidate imports nothing (no runtime, no port)
 *   C03 traversal        — mapConnectionsByDestination, getChildNodes/ParentNodes/ConnectedNodes
 *   C04 graph analysis   — adjacency, input/output edges, roots, leaves, hasPath, extractable
 *   C05 connection diff  — compareConnections over corpus pairs
 *   C06 twin parity      — the compiled TypeScript twin == the committed ESM twin
 *   C07 unit suite       — packages/connection-lego/test/*.test.mjs
 *
 * usage: node tools/connection-isolation-gate.mjs [--quiet]
 * evidence: docs/isolation/evidence/connection-lego-gate.json
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, TWIN_SOURCES, compileTwin, COMPILED_TWIN } from './connection-isolation-extract.mjs';

const args = process.argv.slice(2);
const EVIDENCE = join(REPO, 'docs/isolation/evidence/connection-lego-gate.json');
const CONNECTION_PKG = join(REPO, 'packages/connection-lego');
const MANIFEST = JSON.parse(readFileSync(join(CONNECTION_PKG, 'manifest/ownership.json'), 'utf8'));

/* ---------------------------------------------------------------- */
/* reference runtime                                                 */
/* ---------------------------------------------------------------- */
function findRuntime() {
	for (const dir of [process.env.LEGO_LIVE_RUNTIME, join(REPO, '.runtime/node_modules'), '/home/user/.n8n-live/node_modules']) {
		if (dir && existsSync(join(dir, 'n8n-workflow/package.json'))) return dir;
	}
	return null;
}
const runtimeDir = findRuntime();
if (!runtimeDir) {
	console.error('reference runtime not found — run scripts/setup-reference-runtime.sh (or set LEGO_LIVE_RUNTIME)');
	process.exit(2);
}
const referencePackage = join(runtimeDir, 'n8n-workflow');
const req = createRequire(join(referencePackage, 'package.json'));
const barrel = req(referencePackage);
const graphUtils = req(join(referencePackage, 'dist/cjs/graph/graph-utils.js'));
const connectionsDiff = req(join(referencePackage, 'dist/cjs/connections-diff.js'));

const reference = {
	mapConnectionsByDestination: barrel.mapConnectionsByDestination,
	getConnectedNodes: barrel.getConnectedNodes,
	getChildNodes: barrel.getChildNodes,
	getParentNodes: barrel.getParentNodes,
	getNodeByName: barrel.getNodeByName,
	buildAdjacencyList: barrel.buildAdjacencyList ?? graphUtils.buildAdjacencyList,
	getInputEdges: graphUtils.getInputEdges,
	getOutputEdges: graphUtils.getOutputEdges,
	getRootNodes: graphUtils.getRootNodes,
	getLeafNodes: graphUtils.getLeafNodes,
	hasPath: graphUtils.hasPath,
	parseExtractableSubgraphSelection: graphUtils.parseExtractableSubgraphSelection,
	compareConnections: connectionsDiff.compareConnections,
	__version: req(join(referencePackage, 'package.json')).version,
};

const candidateModule = await import(pathToFileURL(join(REPO, 'packages/reconstructed-engine/src/connection-routing-engine.mjs')).href);
const candidate = candidateModule;

/* ---------------------------------------------------------------- */
/* corpus                                                            */
/* ---------------------------------------------------------------- */
const main = (node, index = 0) => ({ node, type: 'main', index });
const ai = (node, type = 'ai_languageModel', index = 0) => ({ node, type, index });

export const CORPUS = [
	{
		id: 'G01-linear',
		description: 'A → B → C',
		nodes: ['A', 'B', 'C'],
		connections: { A: { main: [[main('B')]] }, B: { main: [[main('C')]] } },
	},
	{
		id: 'G02-multi-output',
		description: 'A fans out to B and C, both join D',
		nodes: ['A', 'B', 'C', 'D'],
		connections: {
			A: { main: [[main('B')], [main('C')]] },
			B: { main: [[main('D')]] },
			C: { main: [[main('D')]] },
		},
	},
	{
		id: 'G03-sparse-slots',
		description: 'A has an empty middle slot and a null slot',
		nodes: ['A', 'B', 'C'],
		connections: { A: { main: [null, [main('B')], [], [main('C')]] }, B: { main: [[main('C')]] } },
	},
	{
		id: 'G04-multi-type',
		description: 'A → B on main plus an ai_languageModel sub-node',
		nodes: ['A', 'B', 'L'],
		connections: { A: { main: [[main('B')]], ai_languageModel: [[ai('L')]] }, L: {} },
	},
	{
		id: 'G05-cycle',
		description: 'A → B → C → A (cycles are legal)',
		nodes: ['A', 'B', 'C'],
		connections: { A: { main: [[main('B')]] }, B: { main: [[main('C')]] }, C: { main: [[main('A')]] } },
	},
	{
		id: 'G06-self-loop',
		description: 'A → A plus A → B',
		nodes: ['A', 'B'],
		connections: { A: { main: [[main('A')], [main('B')]] } },
	},
	{
		id: 'G07-dangling',
		description: 'A → X where X is not part of the workflow, B → A',
		nodes: ['A', 'B'],
		connections: { A: { main: [[main('X')]] }, B: { main: [[main('A')]] } },
	},
	{
		id: 'G08-diamond-duplicates',
		description: 'diamond with duplicated paths A→B→D, A→C→D, C→E, D→E',
		nodes: ['A', 'B', 'C', 'D', 'E'],
		connections: {
			A: { main: [[main('B')], [main('C')]] },
			B: { main: [[main('D')]] },
			C: { main: [[main('D')], [main('E')]] },
			D: { main: [[main('E')]] },
		},
	},
	{
		id: 'G09-chain-depth',
		description: 'A → B → C → D → E for depth-bounded traversal',
		nodes: ['A', 'B', 'C', 'D', 'E'],
		connections: {
			A: { main: [[main('B')]] },
			B: { main: [[main('C')]] },
			C: { main: [[main('D')]] },
			D: { main: [[main('E')]] },
		},
	},
	{
		id: 'G10-empty',
		description: 'no connections at all',
		nodes: ['A', 'B'],
		connections: {},
	},
	{
		id: 'G11-external-input',
		description: 'sub-selection {B,C} receives an input edge from A outside the selection',
		nodes: ['A', 'B', 'C', 'D'],
		connections: { A: { main: [[main('B')]] }, B: { main: [[main('C')]] }, C: { main: [[main('D')]] } },
	},
	{
		id: 'G12-loop-back',
		description: 'selection with a loop back into itself (root tolerance rule)',
		nodes: ['A', 'B', 'C'],
		connections: { A: { main: [[main('B')]] }, B: { main: [[main('A')], [main('C')]] } },
	},
];

/** Selection subsets used by the graph-analysis functions. */
function selections(entry) {
	const all = new Set(entry.nodes);
	const subsets = { all };
	if (entry.nodes.length > 2) subsets.firstHalf = new Set(entry.nodes.slice(0, 2));
	if (entry.id === 'G11-external-input') subsets.two = new Set(['B', 'C']);
	if (entry.id === 'G12-loop-back') subsets.loop = new Set(['A', 'B']);
	if (entry.id === 'G08-diamond-duplicates') subsets.middle = new Set(['B', 'C', 'D']);
	return subsets;
}

/* ---------------------------------------------------------------- */
/* normalization + differential                                      */
/* ---------------------------------------------------------------- */
const norm = (value) => {
	if (value instanceof Map) {
		return [...value.entries()]
			.map(([key, val]) => [key, norm(val)])
			.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
	}
	if (value instanceof Set) return [...value].map(norm).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
	if (Array.isArray(value)) return value.map(norm);
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.keys(value).sort().map((key) => [key, norm(value[key])]));
	}
	return value;
};

const show = (value, max = 200) => {
	const text = JSON.stringify(norm(value));
	return text.length > max ? `${text.slice(0, max)}…` : text;
};

const differences = [];
const comparisons = { total: 0, byCheck: {} };

function compare(check, entryId, call, referenceValue, candidateValue) {
	comparisons.total++;
	comparisons.byCheck[check] = (comparisons.byCheck[check] ?? 0) + 1;
	const a = JSON.stringify(norm(referenceValue));
	const b = JSON.stringify(norm(candidateValue));
	if (a === b) return;
	differences.push({
		check,
		corpus: entryId,
		call,
		reference: show(referenceValue),
		candidate: show(candidateValue),
	});
}

function runTraversal(entry) {
	const connections = entry.connections;
	compare('C03', entry.id, 'mapConnectionsByDestination(connections)', reference.mapConnectionsByDestination(connections), candidate.mapConnectionsByDestination(connections));
	for (const nodeName of [...entry.nodes, 'missing-node']) {
		for (const type of ['main', 'ALL', 'ALL_NON_MAIN', 'ai_languageModel']) {
			for (const depth of [-1, 0, 1, 2]) {
				const label = `getConnectedNodes(${nodeName}, ${type}, ${depth})`;
				compare('C03', entry.id, label, reference.getConnectedNodes(connections, nodeName, type, depth), candidate.getConnectedNodes(connections, nodeName, type, depth));
			}
		}
		const childLabel = `getChildNodes(${nodeName})`;
		compare('C03', entry.id, childLabel, reference.getChildNodes(connections, nodeName), candidate.getChildNodes(connections, nodeName));
		const byDest = reference.mapConnectionsByDestination(connections);
		const parentLabel = `getParentNodes(${nodeName})`;
		compare('C03', entry.id, parentLabel, reference.getParentNodes(byDest, nodeName), candidate.getParentNodes(byDest, nodeName));
	}
	const nodesAsObjects = entry.nodes.map((name) => ({ name, type: 'n8n-nodes-base.noOp' }));
	for (const nodeName of entry.nodes) {
		compare('C03', entry.id, `getNodeByName(${nodeName})`, reference.getNodeByName(nodesAsObjects, nodeName), candidate.getNodeByName(nodesAsObjects, nodeName));
	}
}

const skippedSymbols = new Set();
const hasCandidate = (symbol) => {
	if (typeof candidate[symbol] === 'function') return true;
	skippedSymbols.add(symbol);
	return false;
};

function runGraphAnalysis(entry) {
	const connections = entry.connections;
	const referenceAdjacency = reference.buildAdjacencyList(connections);
	const candidateAdjacency = candidate.buildAdjacencyList(connections);
	if (hasCandidate('buildAdjacencyList')) compare('C04', entry.id, 'buildAdjacencyList(connections)', referenceAdjacency, candidateAdjacency);

	for (const [name, graphIds] of Object.entries(selections(entry))) {
		if (hasCandidate('getInputEdges')) compare('C04', entry.id, `getInputEdges(${name})`, reference.getInputEdges(graphIds, referenceAdjacency), candidate.getInputEdges(graphIds, candidateAdjacency));
		if (hasCandidate('getOutputEdges')) compare('C04', entry.id, `getOutputEdges(${name})`, reference.getOutputEdges(graphIds, referenceAdjacency), candidate.getOutputEdges(graphIds, candidateAdjacency));
		if (hasCandidate('getRootNodes')) compare('C04', entry.id, `getRootNodes(${name})`, reference.getRootNodes(graphIds, referenceAdjacency), candidate.getRootNodes(graphIds, candidateAdjacency));
		if (hasCandidate('getLeafNodes')) compare('C04', entry.id, `getLeafNodes(${name})`, reference.getLeafNodes(graphIds, referenceAdjacency), candidate.getLeafNodes(graphIds, candidateAdjacency));
		if (hasCandidate('parseExtractableSubgraphSelection')) {
			compare(
				'C04',
				entry.id,
				`parseExtractableSubgraphSelection(${name})`,
				reference.parseExtractableSubgraphSelection(graphIds, referenceAdjacency),
				candidate.parseExtractableSubgraphSelection(graphIds, candidateAdjacency),
			);
		}
	}
	if (hasCandidate('hasPath')) {
		for (const start of entry.nodes) {
			for (const end of entry.nodes) {
				compare('C04', entry.id, `hasPath(${start}, ${end})`, reference.hasPath(start, end, referenceAdjacency), candidate.hasPath(start, end, candidateAdjacency));
			}
		}
	}
}

function runConnectionsDiff(prevEntry, nextEntry) {
	compare(
		'C05',
		`${prevEntry.id}→${nextEntry.id}`,
		'compareConnections(prev, next)',
		reference.compareConnections(prevEntry.connections, nextEntry.connections),
		candidate.compareConnections(prevEntry.connections, nextEntry.connections),
	);
}

/* ---------------------------------------------------------------- */
/* checks                                                            */
/* ---------------------------------------------------------------- */
const checks = [];
const record = async (id, title, fn) => {
	let status = 'PASS';
	let detail = '';
	try {
		detail = (await fn()) ?? '';
	} catch (error) {
		status = 'FAIL';
		detail = error?.message ?? String(error);
	}
	checks.push({ id, title, status, detail: String(detail).trim().slice(0, 900) });
	console.log(`[${status}] ${id} ${title}${detail ? ` — ${String(detail).split('\n')[0]}` : ''}`);
};

await record('C01', 'declared surface (P-CONNECTION-GRAPH) exists in the reference and the candidate', () => {
	const missing = [];
	for (const symbol of MANIFEST.publicSurface) {
		if (typeof reference[symbol] !== 'function') missing.push(`reference:${symbol}`);
		if (typeof candidate[symbol] !== 'function') missing.push(`candidate:${symbol}`);
	}
	if (missing.length) throw new Error(`missing functions → ${missing.join(', ')}`);
	return `${MANIFEST.publicSurface.length} symbols in both, reference n8n-workflow@${reference.__version}`;
});

await record('C02', 'boundary: the candidate routing engine imports nothing', () => {
	const source = readFileSync(join(REPO, 'packages/reconstructed-engine/src/connection-routing-engine.mjs'), 'utf8');
	const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
	if (/^\s*import\s/m.test(stripped)) throw new Error('the routing engine imports a module');
	return 'ESM twin: 0 imports';
});

await record('C03', 'traversal differential: mapConnectionsByDestination + getConnected/Child/ParentNodes', () => {
	for (const entry of CORPUS) runTraversal(entry);
	const failed = differences.filter((d) => d.check === 'C03');
	if (failed.length) {
		throw new Error(
			`${failed.length}/${comparisons.byCheck.C03} traversal calls diverge; first: ${failed[0].corpus} ${failed[0].call}\n  reference: ${failed[0].reference}\n  candidate: ${failed[0].candidate}`,
		);
	}
	return `${comparisons.byCheck.C03} calls identical`;
});

await record('C04', 'graph analysis differential: adjacency, edges, roots, leaves, hasPath, extractable', () => {
	for (const entry of CORPUS) runGraphAnalysis(entry);
	const failed = differences.filter((d) => d.check === 'C04');
	if (failed.length) {
		throw new Error(
			`${failed.length}/${comparisons.byCheck.C04} graph calls diverge; first: ${failed[0].corpus} ${failed[0].call}\n  reference: ${failed[0].reference}\n  candidate: ${failed[0].candidate}`,
		);
	}
	const skippedNote = skippedSymbols.size ? ` · skipped (not implemented): ${[...skippedSymbols].join(', ')}` : '';
	return `${comparisons.byCheck.C04} calls identical${skippedNote}`;
});

await record('C05', 'connection diff differential: compareConnections', () => {
	const pairs = [
		[CORPUS[0], CORPUS[1]],
		[CORPUS[1], CORPUS[0]],
		[CORPUS[8], CORPUS[2]],
		[CORPUS[2], CORPUS[8]],
		[CORPUS[10], CORPUS[0]],
		[CORPUS[0], CORPUS[10]],
	];
	for (const [prev, next] of pairs) runConnectionsDiff(prev, next);
	const failed = differences.filter((d) => d.check === 'C05');
	if (failed.length) {
		throw new Error(
			`${failed.length}/${comparisons.byCheck.C05} diff calls diverge; first: ${failed[0].corpus} ${failed[0].call}\n  reference: ${failed[0].reference}\n  candidate: ${failed[0].candidate}`,
		);
	}
	return `${comparisons.byCheck.C05} pairs identical`;
});

await record('C06', 'twin parity: the compiled TypeScript twin behaves exactly like the committed ESM twin', async () => {
	compileTwin();
	const compiled = await import(`${pathToFileURL(COMPILED_TWIN).href}?t=${Date.now()}`);
	const twinDifferences = [];
	for (const entry of CORPUS) {
		for (const symbol of MANIFEST.publicSurface) {
			if (typeof candidate[symbol] !== 'function') continue;
			const argumentsFor = (fn) => {
				const connections = entry.connections;
				const adjacency = candidate.buildAdjacencyList(connections);
				const byDest = candidate.mapConnectionsByDestination(connections);
				switch (fn) {
					case 'mapConnectionsByDestination':
						return [connections];
					case 'getConnectedNodes':
						return [connections, entry.nodes[0], 'ALL', -1];
					case 'getChildNodes':
						return [connections, entry.nodes[0]];
					case 'getParentNodes':
						return [byDest, entry.nodes[0]];
					case 'getNodeByName':
						return [[{ name: entry.nodes[0] }], entry.nodes[0]];
					case 'buildAdjacencyList':
						return [connections];
					case 'getInputEdges':
					case 'getOutputEdges':
					case 'getRootNodes':
					case 'getLeafNodes':
					case 'parseExtractableSubgraphSelection':
						return [new Set(entry.nodes), adjacency];
					case 'hasPath':
						return [entry.nodes[0], entry.nodes[entry.nodes.length - 1], adjacency];
					case 'compareConnections':
						return [connections, CORPUS[(CORPUS.indexOf(entry) + 1) % CORPUS.length].connections];
					default:
						return null;
				}
			};
			const argv = argumentsFor(symbol);
			if (!argv) continue;
			const a = JSON.stringify(norm(candidate[symbol](...argv)));
			const b = JSON.stringify(norm(compiled[symbol](...argv)));
			if (a !== b) twinDifferences.push(`${entry.id} ${symbol}`);
		}
	}
	if (twinDifferences.length) {
		throw new Error(`${twinDifferences.length} twin divergences → ${twinDifferences.slice(0, 6).join(', ')}`);
	}
	return `typescript twin == esm twin over ${CORPUS.length} graphs`;
});

await record('C07', 'unit suite PASS (packages/connection-lego/test)', () => {
	const result = spawnSync(process.execPath, ['--test', 'test/*.test.mjs'], { cwd: CONNECTION_PKG, encoding: 'utf8', timeout: 300_000 });
	const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
	const pass = Number(/(?:^|\n)# pass (\d+)/.exec(output)?.[1] ?? 0);
	const fail = Number(/(?:^|\n)# fail (\d+)/.exec(output)?.[1] ?? 0);
	if (result.status !== 0 || fail !== 0 || pass === 0) throw new Error(`suite exited ${result.status} (${pass} pass / ${fail} fail)\n${output.slice(-900)}`);
	return `node --test test/*.test.mjs → ${pass}/${pass + fail} PASS`;
});

/* ---------------------------------------------------------------- */
/* evidence                                                          */
/* ---------------------------------------------------------------- */
const failed = checks.filter((check) => check.status === 'FAIL');
const evidence = {
	generatedAt: new Date().toISOString(),
	phase: 'phase-3-connection',
	lego: 'connection',
	port: 'P-CONNECTION-GRAPH',
	oracle: { package: referencePackage, version: reference.__version },
	corpus: CORPUS.map((entry) => ({ id: entry.id, description: entry.description, nodes: entry.nodes.length })),
	comparisons,
	differences: differences.slice(0, 40),
	checks,
	verdict: failed.length === 0 ? 'PASS' : 'FAIL',
};
mkdirSync(join(REPO, 'docs/isolation/evidence'), { recursive: true });
writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');

if (!args.includes('--quiet')) {
	console.log(`\nconnection lego: ${evidence.verdict} (${checks.length - failed.length}/${checks.length} checks · ${comparisons.total} differential calls)`);
	if (differences.length) console.log(`first divergences: ${differences.slice(0, 3).map((d) => `${d.corpus} ${d.call}`).join(' | ')}`);
	console.log('evidence: docs/isolation/evidence/connection-lego-gate.json');
}
process.exit(failed.length === 0 ? 0 : 1);
