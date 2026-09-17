/**
 * Workflow Model LEGO — Phase 3 conformance suite.
 *
 * Oracle: `tests/reference/workflow-rust/fixtures.json`, derived from the pinned reference runtime
 * (`n8n-workflow@2.9.1`, the dependency set of n8n `2.9.4`) by
 * `tests/reference/workflow-rust/build-fixtures.mjs`. Nothing here is hand-written.
 *
 * Covers the three fixture groups that belong to this LEGO:
 *   - `checksum` (8)  — `calculateWorkflowChecksum`, surface symbol #14
 *   - `toJSON`   (6)  — the aggregate's in-memory shape
 *   - `rename`   (6)  — `renameNode`, including restricted names, collision and defect D-08
 *
 * The probe construction mirrors `build-fixtures.mjs` line-for-line, so the reconstruction is
 * measured exactly the way the reference was.
 *
 * run:  npm --prefix packages/workflow-model-lego test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');

const lego = await import('../dist/index.js');
const { Workflow, calculateWorkflowChecksum, resolveGraphPort } = lego;

const fixtures = JSON.parse(
	readFileSync(join(REPO, 'tests/reference/workflow-rust/fixtures.json'), 'utf8'),
);
const golden = (name) =>
	JSON.parse(readFileSync(join(REPO, 'tests/reference', name, 'workflow.json'), 'utf8'));

const empty = golden('01-empty-workflow');
const oneNode = golden('02-one-node');
const linear = golden('03-linear');

/** Same normalisation the fixtures went through when they were written as JSON. */
const plain = (v) => JSON.parse(JSON.stringify(v));

/* ------------------------------------------------------------------ */
/* 0. provenance + port integrity                                     */
/* ------------------------------------------------------------------ */

test('fixtures.json: reference provenance is the pinned runtime', () => {
	assert.equal(fixtures.provenance.package, 'n8n-workflow');
	assert.equal(fixtures.provenance.version, '2.9.1');
	assert.match(fixtures.provenance.referenceSource, /b6dc2787c45677a29a9612cd27eb911302961a83/);
});

test('graph port CD-02 resolves to the real Connection LEGO, not a local copy', async () => {
	const connection = await import('../../connection-lego/dist/index.js');
	const port = resolveGraphPort();
	for (const symbol of [
		'getConnectedNodes',
		'getChildNodes',
		'getParentNodes',
		'mapConnectionsByDestination',
	]) {
		assert.equal(port[symbol], connection[symbol], `${symbol} is not the Connection LEGO's`);
	}
});

/* ------------------------------------------------------------------ */
/* 1. checksum (8)                                                    */
/* ------------------------------------------------------------------ */

for (const kase of fixtures.checksum.cases) {
	test(`checksum/${kase.id} — ${kase.note}`, async () => {
		assert.equal(await calculateWorkflowChecksum(kase.snapshot), kase.sha256);
	});
}

test('checksum: the whitelist really excludes id/active/staticData', async () => {
	const base = fixtures.checksum.cases.find((k) => k.id === 'base').snapshot;
	const excluded = fixtures.checksum.cases.find((k) => k.id === 'excluded-fields-ignored').snapshot;
	assert.notDeepEqual(
		Object.keys(excluded).sort(),
		Object.keys(base).sort(),
		'the case must actually carry extra fields to be meaningful',
	);
	assert.equal(await calculateWorkflowChecksum(excluded), await calculateWorkflowChecksum(base));
});

/* ------------------------------------------------------------------ */
/* 2. aggregate shape (6)                                             */
/* ------------------------------------------------------------------ */

/** `build-fixtures.mjs:69` — node factory: the reference re-keys nodes by name. */
const node = (name, type = 'n8n-nodes-base.noOp', extra = {}) => ({
	id: `id-${name}`,
	name,
	type,
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
	...extra,
});
const c = (n, t = 'main', i = 0) => ({ node: n, type: t, index: i });

/** `build-fixtures.mjs:174-203` — the exact probe the reference was measured with. */
function shape(workflowJson, extraNodes = []) {
	const wf = new Workflow({
		id: workflowJson.id ?? 'wf-shape',
		name: workflowJson.name,
		nodes: [...workflowJson.nodes, ...extraNodes],
		connections: workflowJson.connections,
		active: false,
		nodeTypes: { getByNameAndVersion: () => undefined },
		settings: workflowJson.settings,
		staticData: workflowJson.staticData,
		pinData: workflowJson.pinData,
	});
	return {
		id: wf.id,
		nodeKeys: Object.keys(wf.nodes).sort(),
		nodesAreKeyedByName: !Array.isArray(wf.nodes) && typeof wf.nodes === 'object',
		nodeCount: Object.keys(wf.nodes).length,
		connectionsBySourceNode: wf.connectionsBySourceNode,
		connectionsByDestinationNode: wf.connectionsByDestinationNode,
		settings: wf.settings,
		staticData: wf.staticData,
		pinData: wf.pinData ?? null,
		timezone: wf.timezone,
		active: wf.active,
		name: wf.name ?? null,
	};
}

/** The six shape cases, in the builder's order, with the same inputs. */
const shapeInputs = {
	'wf-empty': () => shape(empty),
	'wf-one-node': () => shape(oneNode),
	'wf-linear': () => shape(linear),
	'wf-all': () =>
		shape({
			id: 'wf-all',
			name: 'Everything',
			nodes: [node('A'), node('B', undefined, { disabled: true })],
			connections: { A: { main: [[c('B')]] } },
			settings: { timezone: 'Asia/Jakarta', executionOrder: 'v1', saveDataErrorExecution: 'all' },
			staticData: { lastId: 42 },
			pinData: { A: [{ json: { pinned: true } }] },
		}),
	'wf-dup': () =>
		shape({
			id: 'wf-dup',
			name: 'Duplicate',
			nodes: [node('A'), node('A', undefined, { parameters: { second: true } })],
			connections: {},
		}),
	'wf-proto': () =>
		shape({ id: 'wf-proto', name: 'Proto', nodes: [node('A')], connections: {} }, [node('__proto__')]),
};

for (const kase of fixtures.toJSON) {
	test(`toJSON/${kase.id} — ${kase.note}`, () => {
		const build = shapeInputs[kase.id];
		assert.ok(build, `no probe registered for fixture id ${kase.id}`);
		const { note, ...expected } = kase;
		assert.deepEqual(plain(build()), expected);
	});
}

/* ------------------------------------------------------------------ */
/* 3. renameNode (6)                                                  */
/* ------------------------------------------------------------------ */

/** `build-fixtures.mjs:214-221` — 3-node chain A → B → C plus an unrelated D. */
const chain = () =>
	new Workflow({
		id: 'wf-rename',
		name: 'Rename',
		nodes: [node('A'), node('B'), node('C'), node('D')],
		connections: { A: { main: [[c('B')]] }, B: { main: [[c('C')]] } },
		active: false,
		nodeTypes: { getByNameAndVersion: () => undefined },
	});

for (const kase of fixtures.rename.filter((k) => k.id.startsWith('restricted-'))) {
	test(`rename/${kase.id} — ${kase.note}`, () => {
		const restricted = kase.id.slice('restricted-'.length);
		const wf = chain();
		let outcome;
		try {
			wf.renameNode('D', restricted);
			outcome = { threw: false };
		} catch (error) {
			outcome = { threw: true, errorName: error.constructor?.name ?? null, message: error.message };
		}
		assert.deepEqual(outcome, kase.outcome);
	});
}

test('rename/collision-overwrites — no collision guard, last write wins', () => {
	const kase = fixtures.rename.find((k) => k.id === 'collision-overwrites');
	const wf = chain();
	let outcome;
	try {
		wf.renameNode('D', 'C');
		outcome = {
			threw: false,
			nodeNames: Object.keys(wf.nodes).sort(),
			ownerOfC: wf.nodes.C?.id,
			cStillHasItsEdges: Object.keys(wf.connectionsBySourceNode).sort(),
		};
	} catch (error) {
		outcome = { threw: true, message: error.message };
	}
	assert.deepEqual(plain(outcome), kase.outcome);
});

test('rename/d-08-stale-destination-index — D-08 is reproduced, not fixed', () => {
	const kase = fixtures.rename.find((k) => k.id === 'd-08-stale-destination-index');
	const wf = chain();
	wf.renameNode('B', 'Beta');
	const outcome = {
		sourceKeys: Object.keys(wf.connectionsBySourceNode).sort(),
		destinationKeys: Object.keys(wf.connectionsByDestinationNode).sort(),
		childNodesOfA: wf.getChildNodes('A'),
		parentNodesOfBeta: wf.getParentNodes('Beta'),
		parentNodesOfOldName: wf.getParentNodes('B'),
		sourceEdgeToBeta: wf.connectionsBySourceNode.Beta,
		afterRederive: (() => {
			wf.setConnections(wf.connectionsBySourceNode);
			return wf.getParentNodes('Beta');
		})(),
		nodeNames: Object.keys(wf.nodes).sort(),
	};
	assert.deepEqual(plain(outcome), kase.outcome);
});

test('rename/parameter-references-rewritten — expressions rewritten, plain strings untouched', () => {
	const kase = fixtures.rename.find((k) => k.id === 'parameter-references-rewritten');
	const wf = new Workflow({
		id: 'wf-rename-params',
		name: 'Rename Params',
		nodes: [
			node('A'),
			node('B', 'n8n-nodes-base.set', { parameters: { value: "={{ $('A').item.json.x }}", plain: 'A' } }),
		],
		connections: {},
		active: false,
		nodeTypes: { getByNameAndVersion: () => undefined },
	});
	wf.renameNode('A', 'Alpha');
	assert.deepEqual(
		{ value: wf.nodes.B.parameters.value, plain: wf.nodes.B.parameters.plain },
		kase.outcome,
	);
});

/* ------------------------------------------------------------------ */
/* 4. negative controls — the oracle must be able to fail             */
/* ------------------------------------------------------------------ */

test('negative control: hashing without the recursive key sort is rejected', async () => {
	const { sortObjectKeys } = lego;
	const kase = fixtures.checksum.cases.find((k) => k.id === 'key-order-invariance');
	const naive = async (snapshot) => {
		const { createHash } = await import('node:crypto');
		return createHash('sha256').update(JSON.stringify(snapshot), 'utf8').digest('hex');
	};
	assert.notEqual(await naive(kase.snapshot), kase.sha256, 'oracle failed to discriminate');
	// and the reconstruction's own sort is what makes the two orders agree
	assert.deepEqual(sortObjectKeys(kase.snapshot), sortObjectKeys(fixtures.checksum.cases[0].snapshot));
});

test('negative control: "fixing" D-08 by rebuilding the destination index is rejected', () => {
	const kase = fixtures.rename.find((k) => k.id === 'd-08-stale-destination-index');
	// A plausible reimplementation calls setConnections() at the end of renameNode.
	const wf = chain();
	wf.renameNode('B', 'Beta');
	wf.setConnections(wf.connectionsBySourceNode); // the "fix"
	const fixed = {
		destinationKeys: Object.keys(wf.connectionsByDestinationNode).sort(),
		parentNodesOfBeta: wf.getParentNodes('Beta'),
		parentNodesOfOldName: wf.getParentNodes('B'),
	};
	assert.notDeepEqual(fixed.destinationKeys, kase.outcome.destinationKeys, 'oracle failed to discriminate');
	assert.notDeepEqual(fixed.parentNodesOfBeta, kase.outcome.parentNodesOfBeta);
	assert.notDeepEqual(fixed.parentNodesOfOldName, kase.outcome.parentNodesOfOldName);
});

test('negative control: adding a collision guard to renameNode is rejected', () => {
	const kase = fixtures.rename.find((k) => k.id === 'collision-overwrites');
	const wf = chain();
	// A plausible reimplementation refuses to rename onto an existing name.
	if (wf.nodes.C !== undefined) {
		const guarded = { threw: false, nodeNames: Object.keys(wf.nodes).sort(), ownerOfC: wf.nodes.C?.id };
		assert.notDeepEqual(guarded.nodeNames, kase.outcome.nodeNames, 'oracle failed to discriminate');
		assert.notEqual(guarded.ownerOfC, kase.outcome.ownerOfC);
		return;
	}
	assert.fail('unreachable');
});

/* ------------------------------------------------------------------ */
/* 5. the Workflow-aggregate probes of the connection goldens (14)    */
/* ------------------------------------------------------------------ */

/**
 * `tests/reference/connection/01..04` also probe the Workflow aggregate (`wf.*`). Those 14 probes
 * were skipped by `packages/connection-lego` because they belong to this LEGO
 * (`contracts/connection.contract.md` §7). They are asserted here.
 *
 * The node-type stub and the Workflow construction mirror `tests/reference/harness/connection.js`
 * exactly, so the same recorded expectations apply: a generic 1-in/1-out node per fixture name,
 * except names starting with `Trigger`, which have no inputs.
 */
const generic = (name) => ({
	description: {
		displayName: name,
		name,
		group: ['transform'],
		version: 1,
		description: '',
		defaults: {},
		inputs: name.startsWith('Trigger') ? [] : ['main'],
		outputs: ['main'],
		properties: [],
	},
});
const stubNodeTypes = {
	getByName: (n) => generic(n),
	getByNameAndVersion: (n) => generic(n),
	getKnownTypes: () => ({}),
};

/**
 * CD-05 port for these probes.
 *
 * - `getNodeOutputs` is the **real** `packages/node-lego` implementation, resolved by the package
 *   itself; it is re-declared here only so the constructor has a port at all.
 * - `getNodeParameters` is **not reconstructed anywhere on this branch** (it is ~1 000 lines of
 *   `node-helpers.ts` and outside both this LEGO's and `packages/node-lego`'s delivered scope).
 *   The identity stand-in below leaves `node.parameters` untouched. That is a declared gap, not a
 *   claim of parity — and the test further down proves the 14 probe expectations do not depend on
 *   it, so the acceptance set is not being satisfied by the stand-in.
 */
const identityNodeHelpers = {
	getNodeOutputs: (wf, node, nodeTypeData) =>
		lego.resolveNodeHelpersPort().getNodeOutputs(wf, node, nodeTypeData),
	getNodeParameters: (node) => node.parameters ?? {},
};

const WF_OPS = new Set([
	'wf.getNodeConnectionIndexes',
	'wf.getHighestNode',
	'wf.getStartNode',
	'wf.getParentMainInputNode',
	'wf.getParentNodesByDepth',
]);

/** Same value normalisation the recording harness applied. */
const harnessPlain = (v) =>
	v === undefined
		? { undefined: true }
		: JSON.parse(
				JSON.stringify(v, (_, x) =>
					x instanceof Set ? [...x] : x instanceof Map ? Object.fromEntries(x) : x,
				),
			);

function runWfProbe(wf, p) {
	switch (p.op) {
		case 'wf.getNodeConnectionIndexes':
			return wf.getNodeConnectionIndexes(p.node, p.parent, p.type);
		case 'wf.getHighestNode':
			return wf.getHighestNode(p.node);
		case 'wf.getStartNode':
			return wf.getStartNode(p.node)?.name ?? null;
		case 'wf.getParentMainInputNode':
			return wf.getParentMainInputNode(wf.getNode(p.node)).name;
		case 'wf.getParentNodesByDepth':
			return wf.getParentNodesByDepth(p.node, p.depth);
		default:
			throw new Error(`unhandled op ${p.op}`);
	}
}

let wfProbes = 0;
for (const name of readdirSync(join(REPO, 'tests/reference/connection')).sort()) {
	const dir = join(REPO, 'tests/reference/connection', name);
	let kase;
	let expected;
	try {
		kase = JSON.parse(readFileSync(join(dir, 'case.json'), 'utf8'));
		expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
	} catch {
		continue;
	}
	if (!kase.nodes) continue;

	const wf = new Workflow({
		id: 'conn',
		name: 'conn',
		nodes: kase.nodes.map((n) => ({ ...n, type: n.name })),
		connections: kase.connections,
		active: false,
		nodeTypes: stubNodeTypes,
		settings: {},
		nodeHelpersPort: identityNodeHelpers,
	});

	for (const p of kase.probes) {
		if (!WF_OPS.has(p.op)) continue;
		wfProbes++;
		test(`connection/${name} :: ${p.op.slice(3)} :: ${p.name}`, () => {
			assert.deepEqual(harnessPlain(runWfProbe(wf, p)), expected[p.name]);
		});
	}
}

test('Workflow-aggregate coverage: all 14 wf.* probes asserted', () => {
	assert.equal(wfProbes, 14, `expected 14 wf.* probes, ran ${wfProbes}`);
});

test('negative control: a DFS getHighestNode order is rejected', () => {
	const kase = JSON.parse(
		readFileSync(join(REPO, 'tests/reference/connection/04-cycle/expected.json'), 'utf8'),
	);
	// A plausible reimplementation returns ancestors nearest-first instead of following the
	// reference's checkedNodes + indexOf de-duplication order.
	const reversed = [...kase['highest nodes of End']].reverse();
	assert.notDeepEqual(reversed, kase['highest nodes of End'], 'fixture is order-insensitive');
});

test('negative control: returning null instead of undefined for an unconnected pair is rejected', () => {
	const kase = JSON.parse(
		readFileSync(join(REPO, 'tests/reference/connection/02-multi-output/expected.json'), 'utf8'),
	);
	const expected = kase['Merge <- Sparse (not connected)'];
	assert.deepEqual(expected, { undefined: true });
	assert.notDeepEqual(harnessPlain(null), expected, 'oracle failed to discriminate');
});

test('falsification: the 14 wf.* expectations do not depend on the getNodeParameters stand-in', () => {
	// Replace the identity stand-in with one that deliberately mangles node.parameters. If any of
	// the 14 probe results changed, the acceptance set would be sensitive to a function this
	// branch does not reconstruct — which would make the 14/14 claim unsound.
	const mangling = {
		getNodeOutputs: identityNodeHelpers.getNodeOutputs,
		getNodeParameters: () => ({ __mangled: true, nested: { a: [1, 2, 3] } }),
	};
	const results = { identity: {}, mangling: {} };
	for (const name of readdirSync(join(REPO, 'tests/reference/connection')).sort()) {
		const dir = join(REPO, 'tests/reference/connection', name);
		let kase;
		try {
			kase = JSON.parse(readFileSync(join(dir, 'case.json'), 'utf8'));
		} catch {
			continue;
		}
		if (!kase.nodes) continue;
		for (const [label, port] of [
			['identity', identityNodeHelpers],
			['mangling', mangling],
		]) {
			const wf = new Workflow({
				id: 'conn',
				name: 'conn',
				nodes: kase.nodes.map((n) => ({ ...n, type: n.name })),
				connections: kase.connections,
				active: false,
				nodeTypes: stubNodeTypes,
				settings: {},
				nodeHelpersPort: port,
			});
			for (const p of kase.probes) {
				if (!WF_OPS.has(p.op)) continue;
				results[label][`${name}/${p.name}`] = JSON.stringify(harnessPlain(runWfProbe(wf, p)));
			}
		}
	}
	const keys = Object.keys(results.identity);
	assert.equal(keys.length, 14, `expected 14 probes compared, got ${keys.length}`);
	for (const key of keys) {
		assert.equal(results.mangling[key], results.identity[key], `${key} depends on getNodeParameters`);
	}
});
