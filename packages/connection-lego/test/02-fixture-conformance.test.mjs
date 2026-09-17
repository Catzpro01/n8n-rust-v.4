/**
 * Gate 2 — the seam reproduces the pinned fixtures tests/reference/connection/*.
 * Only pure P-CONNECTION-GRAPH probes are replayed here; `wf.*` probes belong to the Workflow class
 * (LEGO 01) and stay in tests/reference/harness/connection.js.
 * Runs in whichever LEGO_PORT_MODE is set (reference default; strict via `npm run test:strict`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES, plain } from './_setup.mjs';

const M = await import('../src/model-surface.ts');

function replay(c) {
	const conn = c.connections;
	const byDest = M.mapConnectionsByDestination(conn);
	const adj = M.buildAdjacencyList(conn);
	const out = {};
	for (const p of c.probes) {
		if (p.op.startsWith('wf.')) continue;
		let v;
		switch (p.op) {
			case 'byDestination': v = p.node ? byDest[p.node] : byDest; break;
			case 'getChildNodes': v = M.getChildNodes(conn, p.node, p.type, p.depth); break;
			case 'getParentNodes': v = M.getParentNodes(byDest, p.node, p.type, p.depth); break;
			case 'getConnectedNodes': v = M.getConnectedNodes(conn, p.node, p.type, p.depth); break;
			case 'adjacencyKeys': v = [...adj.keys()]; break;
			case 'getRootNodes': v = M.getRootNodes(new Set(p.graph), adj); break;
			case 'getLeafNodes': v = M.getLeafNodes(new Set(p.graph), adj); break;
			case 'getInputEdges': v = M.getInputEdges(new Set(p.graph), adj); break;
			case 'getOutputEdges': v = M.getOutputEdges(new Set(p.graph), adj); break;
			case 'hasPath': v = M.hasPath(p.start, p.end, adj); break;
			case 'parseExtractable': v = M.parseExtractableSubgraphSelection(new Set(p.graph), adj); break;
			case 'compareConnections': v = M.compareConnections(conn, p.next); break;
			default: throw new Error('unknown op ' + p.op);
		}
		out[p.name] = v === undefined ? { undefined: true } : plain(v instanceof Set ? [...v] : v);
	}
	return out;
}

let total = 0;
for (const dir of readdirSync(FIXTURES).sort()) {
	const c = JSON.parse(readFileSync(join(FIXTURES, dir, 'case.json'), 'utf8'));
	const expected = JSON.parse(readFileSync(join(FIXTURES, dir, 'expected.json'), 'utf8'));
	test(`[${process.env.LEGO_PORT_MODE ?? 'reference'}] ${dir}`, () => {
		const got = replay(c);
		for (const name of Object.keys(got)) {
			assert.deepEqual(got[name], expected[name], `${dir}/${name}`);
			total++;
		}
		if (c.probes.every((p) => p.op.startsWith('wf.'))) return; // Workflow-class-only fixture (LEGO 01 surface)
	});
}
test('probe tally recorded', () => assert.ok(total >= 30, `only ${total} pure probes replayed`));
