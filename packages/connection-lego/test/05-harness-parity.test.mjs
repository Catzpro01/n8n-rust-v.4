/**
 * Gate 5 — driver parity: the seam must agree with the canonical golden driver
 * `tests/reference/harness/connection.js` (the code that produced every expected.json) on ALL
 * non-`wf.*` probes of ALL cases, probe-by-probe. This makes convention drift between the two
 * drivers ({"undefined":true}, Set/Map flattening, key order) impossible to introduce silently
 * (the exact failure class of ISSUE-023 Stage 2h).
 *
 * Reference mode only: the harness driver needs the pinned runtime. In strict mode this gate
 * is reported as skipped (not passed).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES, REPO, HARNESS_NM, plain } from './_setup.mjs';

const strict = process.env.LEGO_PORT_MODE === 'strict';
const harnessDir = join(REPO, 'tests', 'reference', 'harness');
const canRun = !strict && existsSync(join(HARNESS_NM, 'n8n-workflow', 'package.json'));

const M = await import('../src/model-surface.ts');
const { runConnectionCase } = canRun ? createRequire(join(harnessDir, 'x.js'))('./connection.js') : {};

function seamReplay(c) {
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

let compared = 0;
for (const dir of readdirSync(FIXTURES).sort()) {
	const c = JSON.parse(readFileSync(join(FIXTURES, dir, 'case.json'), 'utf8'));
	test(`[driver parity] ${dir}`, { skip: canRun ? false : 'reference runtime required (strict mode or harness not installed)' }, () => {
		const seam = seamReplay(c);
		const harness = runConnectionCase(c);
		for (const name of Object.keys(seam)) {
			assert.ok(name in harness, `${dir}/${name}: missing from harness driver`);
			assert.deepEqual(seam[name], harness[name], `${dir}/${name}: seam != harness driver`);
			compared++;
		}
	});
}
test('parity tally', { skip: canRun ? false : 'reference runtime required' }, () => {
	assert.ok(compared >= 57, `only ${compared} probes compared`);
	// every harness op that is not wf.* must be covered by the seam — no probe class may fall through
	const ops = new Set();
	for (const dir of readdirSync(FIXTURES)) for (const p of JSON.parse(readFileSync(join(FIXTURES, dir, 'case.json'), 'utf8')).probes) if (!p.op.startsWith('wf.')) ops.add(p.op);
	assert.deepEqual([...ops].sort(), ['adjacencyKeys','byDestination','compareConnections','getChildNodes','getConnectedNodes','getInputEdges','getLeafNodes','getOutputEdges','getParentNodes','getRootNodes','hasPath','parseExtractable'].filter((o) => ops.has(o)));
});
