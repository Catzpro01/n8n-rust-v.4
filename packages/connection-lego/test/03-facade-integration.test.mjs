/**
 * Connection LEGO — Phase 5 facade integration (INTEGRATED step of the LEGO cycle).
 *
 * `n8n-reconstructed-facade.ts` used to carry its own `InternalConnectionEngine` copy of the
 * connection mapping. It now imports the verified port `P-CONNECTION-GRAPH` directly, so this
 * suite pins three things:
 *
 *   1. identity   — `facade.connection` *is* the verified port module (same function objects),
 *   2. no duplicate — the facade source carries no inline connection engine,
 *   3. behaviour  — `resolveExecutionPlan()` produces the documented depth-first plan, and
 *                   `executeWorkflow()` returns its results in exactly that order.
 *
 * The facade is TypeScript; Node >= 22.18 executes it natively (type stripping). On an older
 * runtime the whole suite skips with a note instead of failing — `npm run connection:check`
 * (check C08) covers the same ground with the reference oracle whenever the runner supports it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG = join(fileURLToPath(import.meta.url), '..', '..');
const REPO = join(PKG, '..', '..');
const FACADE_PATH = join(REPO, 'packages/reconstructed-engine/src/n8n-reconstructed-facade.ts');
const PORT_PATH = join(REPO, 'packages/reconstructed-engine/src/connection-routing-engine.ts');
const TWIN_PATH = join(REPO, 'packages/reconstructed-engine/src/connection-routing-engine.mjs');

let facade = null;
let tsPort = null;
let skipReason = false;
try {
	facade = (await import(pathToFileURL(FACADE_PATH).href)).n8nFacade;
	tsPort = await import(pathToFileURL(PORT_PATH).href);
} catch (error) {
	skipReason = `native TypeScript import unavailable (${error?.message ?? error})`;
}
const suite = skipReason ? { skip: skipReason } : {};

const workflow = (names, connections) => ({ nodes: names.map((name) => ({ name })), connections });
const chain = (from, to) => ({ node: to, type: 'main', index: 0 });

test('facade.connection is the verified port itself, not a wrapper', suite, () => {
	assert.ok(facade, 'facade must be importable');
	for (const symbol of [
		'mapConnectionsByDestination',
		'buildAdjacencyList',
		'getRootNodes',
		'getLeafNodes',
		'hasPath',
	]) {
		assert.equal(facade.connection[symbol], tsPort[symbol], `${symbol} must be the port function itself`);
	}
});

test('the facade keeps no inline connection engine', suite, () => {
	const source = readFileSync(FACADE_PATH, 'utf8');
	assert.doesNotMatch(source, /class InternalConnectionEngine/, 'duplicate connection engine must be gone');
	assert.match(source, /import \* as connectionPort from '\.\/connection-routing-engine\.ts'/, 'port import');
	assert.match(source, /public readonly connection = connectionPort/, 'port exposed by reference');
});

test('the facade port behaves exactly like the verified ESM twin', suite, async () => {
	const { mapConnectionsByDestination: twin } = await import(pathToFileURL(TWIN_PATH).href);
	const connections = {
		A: { main: [[chain('A', 'B')], [chain('A', 'C')]] },
		B: { main: [[{ node: 'D', type: 'main', index: 2 }]] },
		L: { main: [[chain('L', 'D')]] },
	};
	assert.deepEqual(facade.connection.mapConnectionsByDestination(connections), twin(connections));
});

test('resolveExecutionPlan walks depth-first from every root, in output order', suite, () => {
	const branched = workflow(['A', 'B', 'C', 'D'], {
		A: { main: [[chain('A', 'B')], [chain('A', 'C')]] },
		B: { main: [[chain('B', 'D')]] },
		C: { main: [[chain('C', 'D')]] },
	});
	assert.deepEqual(facade.resolveExecutionPlan(branched), {
		order: ['A', 'B', 'D', 'C'],
		roots: ['A'],
		leaves: ['D'],
	});

	const linear = workflow(['A', 'B', 'C'], { A: { main: [[chain('A', 'B')]] }, B: { main: [[chain('B', 'C')]] } });
	assert.deepEqual(facade.resolveExecutionPlan(linear), { order: ['A', 'B', 'C'], roots: ['A'], leaves: ['C'] });
});

test('cycles without a root, self-loops and dangling destinations stay safe', suite, () => {
	const cycle = workflow(['A', 'B', 'C'], {
		A: { main: [[chain('A', 'B')]] },
		B: { main: [[chain('B', 'C')]] },
		C: { main: [[chain('C', 'A')]] },
	});
	assert.deepEqual(facade.resolveExecutionPlan(cycle), { order: ['A', 'B', 'C'], roots: [], leaves: [] });

	const selfLoop = workflow(['A', 'B'], { A: { main: [[chain('A', 'A')], [chain('A', 'B')]] } });
	assert.deepEqual(facade.resolveExecutionPlan(selfLoop), { order: ['A', 'B'], roots: ['A'], leaves: ['B'] });

	const dangling = workflow(['A', 'B'], { A: { main: [[chain('A', 'B')]] }, B: { main: [[chain('B', 'not-a-node')]] } });
	assert.deepEqual(facade.resolveExecutionPlan(dangling), { order: ['A', 'B'], roots: ['A'], leaves: ['B'] });

	assert.deepEqual(facade.resolveExecutionPlan({}), { order: [], roots: [], leaves: [] });
	assert.deepEqual(facade.resolveExecutionPlan({ nodes: [], connections: {} }), { order: [], roots: [], leaves: [] });
});

test('executeWorkflow returns results in connection order, not declaration order', suite, async () => {
	const declaredBackwards = workflow(['C', 'A', 'B'], {
		A: { main: [[chain('A', 'B')]] },
		B: { main: [[chain('B', 'C')]] },
	});
	const result = await facade.executeWorkflow({ workflowId: 'order', workflow: declaredBackwards, mode: 'manual' });
	assert.equal(result.success, true);
	assert.deepEqual(result.executionOrder, ['A', 'B', 'C']);
	assert.deepEqual(
		result.data.map((entry) => entry.node),
		['A', 'B', 'C'],
	);
});

test('an invalid workflow is reported, not thrown', suite, async () => {
	const result = await facade.executeWorkflow({ workflowId: 'bad', workflow: { nodes: 'nope' }, mode: 'manual' });
	assert.equal(result.success, false);
	assert.match(result.error, /nodes must be an array/);
});
