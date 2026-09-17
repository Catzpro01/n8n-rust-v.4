/**
 * Gate 4 — strict isolation: in LEGO_PORT_MODE=strict the module graph must not contain n8n-workflow
 * (or any node_modules package), and the strict outputs must equal reference outputs on a smoke graph.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { PKG, plain } from './_setup.mjs';

const SMOKE = {
	Trigger: { main: [[{ node: 'IF', type: 'main', index: 0 }]] },
	IF: { main: [[{ node: 'A', type: 'main', index: 0 }], [{ node: 'B', type: 'main', index: 0 }]] },
	A: { main: [[{ node: 'Merge', type: 'main', index: 0 }]] },
	B: { main: [[{ node: 'Merge', type: 'main', index: 1 }]] },
	Tool: { ai_tool: [[{ node: 'Merge', type: 'ai_tool', index: 0 }]] },
};
const PROBE = `
	const { createRequire } = await import('node:module'); const req = createRequire(import.meta.url);
	const M = await import(${JSON.stringify(join(PKG, 'src', 'model-surface.ts'))});
	const c = ${JSON.stringify(SMOKE)};
	const adj = M.buildAdjacencyList(c);
	const byDest = M.mapConnectionsByDestination(c);
	const r = {
		children: M.getChildNodes(c, 'Trigger'), parentsAll: M.getParentNodes(byDest, 'Merge', 'ALL'),
		parentsNonMain: M.getParentNodes(byDest, 'Merge', 'ALL_NON_MAIN'), depth1: M.getChildNodes(c, 'IF', 'main', 1),
		roots: [...M.getRootNodes(new Set(Object.keys(c)), adj)], leaves: [...M.getLeafNodes(new Set(['IF','A','B']), adj)],
		hasPath: M.hasPath('Trigger', 'Merge', adj), extract: M.parseExtractableSubgraphSelection(new Set(['IF','A','B']), adj),
		diff: M.compareConnections(c, { ...c, A: { main: [[]] } }),
		loaded: Object.keys(req.cache ?? {}).filter((k) => k.includes('node_modules')),
	};
	console.log(JSON.stringify(r, (_, x) => (x instanceof Set ? [...x] : x instanceof Map ? Object.fromEntries(x) : x)));
`;
const run = (mode) => {
	const r = spawnSync(process.execPath, ['--input-type=module', '-e', PROBE], {
		cwd: PKG,
		encoding: 'utf8',
		env: { ...process.env, LEGO_PORT_MODE: mode, NODE_NO_WARNINGS: '1' },
	});
	assert.equal(r.status, 0, `${mode}: ${r.stderr}`);
	return JSON.parse(r.stdout);
};

test('strict mode loads without any node_modules package on the module graph', () => {
	const strict = run('strict');
	assert.deepEqual(strict.loaded, []);
});

test('strict outputs == reference outputs (traversal, graph, diff)', () => {
	const { loaded: _a, ...strict } = run('strict');
	const { loaded, ...reference } = run('reference');
	assert.ok(loaded.some((k) => k.includes('n8n-workflow')), 'reference mode did not load n8n-workflow');
	assert.deepEqual(plain(strict), plain(reference));
});
