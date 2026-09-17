/**
 * TASK-WORKFLOW-MODEL-03 — differential conformance for the six Workflow members that sit outside
 * the frozen §6 surface: `getStaticData`, `setTestStaticData`, `getTriggerNodes`, `getPollNodes`,
 * `queryNodes`, `getConnectionsBetweenNodes`.
 *
 * The oracle is the **published reference build** (`n8n-workflow` from `.runtime/node_modules`,
 * installed by `scripts/setup-reference-runtime.sh`), the same technique `tools/node-lego-gate.mjs`
 * uses for its `N05` differential. Every probe is run against a freshly constructed pair of
 * workflows — one mine, one the reference's — so the stateful members (`getStaticData` mutates
 * `staticData`; `setTestStaticData` mutates `testStaticData`) cannot leak between probes.
 *
 * Runtime note: the installed package is `n8n-workflow@2.9.1` while the pinned source tree is
 * `2.9.4`. The six members under test are byte-identical between them in
 * `reference/n8n/packages/workflow/src/workflow.ts`; the version delta is reported, not hidden.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(import.meta.url);

const lego = require_(join(REPO, 'packages/workflow-model-lego/dist/index.js'));

/**
 * Resolve the published reference build the same way `tools/node-lego-differential.mjs` does:
 * `packages/workflow-lego` declares `n8n-workflow@2.9.1` as a devDependency, so requiring from
 * there needs no `NODE_PATH` and works from a plain `npm test`.
 *
 * `node_modules` is gitignored, so on a freshly cloned sandbox the reference build can be absent.
 * In that case the differential reports itself SKIPPED — loudly, and with the fix — rather than
 * passing. A skipped differential never contributes to the agreement count.
 */
const requireFromWorkflowLego = createRequire(join(REPO, 'packages/workflow-lego/package.json'));
let ref = null;
let REF_VERSION = null;
try {
	requireFromWorkflowLego.resolve('n8n-workflow');
	ref = requireFromWorkflowLego('n8n-workflow');
	REF_VERSION = requireFromWorkflowLego('n8n-workflow/package.json').version;
} catch {
	console.error(
		'[static-data-queries] reference build not resolvable — differential will be SKIPPED.\n' +
			'  fix: npm install --prefix packages/workflow-lego   (declares n8n-workflow@2.9.1)',
	);
}

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

/**
 * A node-type registry that resolves every requested type. `properties` is deliberately empty so
 * that `NodeHelpers.getNodeParameters` — a different LEGO's surface, and a *different* package on
 * each side of this differential — has nothing to default and cannot perturb the comparison.
 */
function makeNodeTypes() {
	const describe = (name) => ({
		description: {
			displayName: name,
			name,
			group: ['transform'],
			version: 1,
			description: '',
			defaults: {},
			inputs: ['main'],
			outputs: ['main'],
			properties: [],
		},
		// `getTriggerNodes` / `getPollNodes` test exactly these two fields.
		trigger: name.endsWith('Trigger') ? {} : undefined,
		poll: name.endsWith('Poll') ? {} : undefined,
	});
	return {
		getByName: (n) => describe(n),
		getByNameAndVersion: (n) => describe(n),
		getKnownTypes: () => ({}),
	};
}

const CASES = {
	// trigger + poll + plain + disabled + a type the registry does not know
	mixed: {
		nodes: [
			{ id: '1', name: 'WebhookTrigger', type: 'xTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
			{ id: '2', name: 'CronPoll', type: 'xPoll', typeVersion: 1, position: [0, 0], parameters: {} },
			{ id: '3', name: 'Plain', type: 'plain', typeVersion: 1, position: [0, 0], parameters: {} },
			{ id: '4', name: 'OffTrigger', type: 'xTrigger', typeVersion: 1, position: [0, 0], parameters: {}, disabled: true },
		],
		connections: {
			WebhookTrigger: { main: [[{ node: 'Plain', type: 'main', index: 0 }]] },
			Plain: {
				main: [[{ node: 'CronPoll', type: 'main', index: 0 }]],
				ai_tool: [[{ node: 'OffTrigger', type: 'ai_tool', index: 0 }]],
			},
		},
	},
	// sparse branches: a `null` slot and an empty slot must not produce tuple entries
	sparse: {
		nodes: [
			{ id: '1', name: 'Trigger', type: 'xTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
			{ id: '2', name: 'Switch', type: 'plain', typeVersion: 1, position: [0, 0], parameters: {} },
			{ id: '3', name: 'A', type: 'plain', typeVersion: 1, position: [0, 0], parameters: {} },
			{ id: '4', name: 'B', type: 'plain', typeVersion: 1, position: [0, 0], parameters: {} },
		],
		connections: {
			Trigger: { main: [[{ node: 'Switch', type: 'main', index: 0 }]] },
			Switch: { main: [[], null, [{ node: 'A', type: 'main', index: 2 }], [{ node: 'B', type: 'main', index: 3 }]] },
		},
	},
	// no connections at all
	isolated: {
		nodes: [
			{ id: '1', name: 'OnlyTrigger', type: 'xTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
		],
		connections: {},
	},
};

function build(Ctor, kase) {
	return new Ctor({
		id: 'diff',
		name: 'diff',
		nodes: kase.nodes.map((n) => ({ ...n })),
		connections: JSON.parse(JSON.stringify(kase.connections)),
		active: false,
		nodeTypes: makeNodeTypes(),
		settings: {},
	});
}

/** Serialise anything the probes may return, including thrown errors. */
function normalise(value) {
	if (value instanceof Error) {
		return {
			threw: true,
			name: value.name,
			message: value.message,
			level: value.level,
			extra: value.extra ?? null,
		};
	}
	return JSON.parse(
		JSON.stringify(value, (k, v) => (v === undefined ? null : v instanceof Set ? [...v] : v)),
	);
}

function attempt(fn) {
	try {
		return normalise(fn());
	} catch (error) {
		return normalise(error);
	}
}

/* ------------------------------------------------------------------ */
/* probes                                                              */
/* ------------------------------------------------------------------ */

const PROBES = [
	['getStaticData(global)', (wf) => wf.getStaticData('global')],
	['getStaticData(global) is observable-parented', (wf) => {
		const d = wf.getStaticData('global');
		d.written = 1;
		return { bucket: wf.getStaticData('global'), dataChanged: wf.staticData.__dataChanged };
	}],
	['getStaticData(node)', (wf) => wf.getStaticData('node', wf.getNode('Trigger') ?? wf.getNodes()[0])],
	['getStaticData(node) per-name isolation', (wf) => {
		const nodes = wf.getNodes();
		const a = wf.getStaticData('node', nodes[0]);
		a.marker = nodes[0].name;
		const b = wf.getStaticData('node', nodes[nodes.length - 1]);
		return { a: wf.getStaticData('node', nodes[0]), b, keys: Object.keys(wf.staticData).sort() };
	}],
	['getStaticData(node) without a node throws', (wf) => wf.getStaticData('node')],
	['getStaticData(unknown type) throws with extra', (wf) => wf.getStaticData('session')],
	['setTestStaticData short-circuits', (wf) => {
		const nodes = wf.getNodes();
		wf.setTestStaticData({ global: { from: 'test' }, [`node:${nodes[0].name}`]: { from: 'test-node' } });
		return {
			global: wf.getStaticData('global'),
			node: wf.getStaticData('node', nodes[0]),
			other: wf.getStaticData('node', nodes[nodes.length - 1]),
		};
	}],
	['setTestStaticData falsy bucket falls through', (wf) => {
		wf.setTestStaticData({ global: null });
		const d = wf.getStaticData('global');
		d.real = true;
		return wf.getStaticData('global');
	}],
	['getTriggerNodes', (wf) => wf.getTriggerNodes().map((n) => n.name)],
	['getPollNodes', (wf) => wf.getPollNodes().map((n) => n.name)],
	['queryNodes(everything)', (wf) => wf.queryNodes(() => true).map((n) => n.name)],
	['queryNodes(never)', (wf) => wf.queryNodes(() => false).map((n) => n.name)],
	['queryNodes sees the disabled node never', (wf) => {
		const seen = [];
		wf.queryNodes((nodeType) => {
			seen.push(nodeType.description.name);
			return true;
		});
		return seen;
	}],
	['getConnectionsBetweenNodes(all,all)', (wf) =>
		wf.getConnectionsBetweenNodes(wf.getNodes().map((n) => n.name), wf.getNodes().map((n) => n.name))],
	['getConnectionsBetweenNodes(one pair)', (wf) => {
		const names = wf.getNodes().map((n) => n.name);
		return wf.getConnectionsBetweenNodes([names[0]], names.slice(1));
	}],
	['getConnectionsBetweenNodes(no match)', (wf) => wf.getConnectionsBetweenNodes(['nope'], ['nada'])],
	['getConnectionsBetweenNodes(sparse skips null slot)', (wf) =>
		wf.getConnectionsBetweenNodes(['Switch'], ['A', 'B'])],
];

/* ------------------------------------------------------------------ */
/* the differential                                                    */
/* ------------------------------------------------------------------ */

let agree = 0;
const divergences = [];

for (const [caseName, kase] of Object.entries(CASES)) {
	for (const [probeName, probe] of PROBES) {
		const mine = attempt(() => probe(build(lego.Workflow, kase)));
		const theirs = attempt(() => probe(build(ref.Workflow, kase)));
		if (JSON.stringify(mine) === JSON.stringify(theirs)) {
			agree++;
		} else {
			divergences.push({ case: caseName, probe: probeName, mine, theirs });
		}
	}
}

test(
	`differential vs n8n-workflow@${REF_VERSION ?? 'ABSENT'}: 6 members agree on every probe`,
	{ skip: ref === null && 'reference build not installed — see the fix hint above' },
	() => {
	assert.deepEqual(
		divergences,
		[],
		`${divergences.length} divergence(s):\n${JSON.stringify(divergences, null, 2)}`,
	);
	assert.equal(agree, Object.keys(CASES).length * PROBES.length);
	},
);

test('the differential actually ran (guard against a silently empty matrix)', () => {
	assert.equal(agree, 3 * PROBES.length, `expected ${3 * PROBES.length} comparisons, got ${agree}`);
	assert.ok(PROBES.length >= 17, 'probe matrix shrank');
});

test('all six members exist on the reconstructed aggregate', () => {
	for (const m of [
		'getStaticData',
		'setTestStaticData',
		'getTriggerNodes',
		'getPollNodes',
		'queryNodes',
		'getConnectionsBetweenNodes',
	]) {
		assert.equal(typeof lego.Workflow.prototype[m], 'function', `${m} missing`);
	}
});

/* ------------------------------------------------------------------ */
/* negative controls — the oracle must reject plausible-but-wrong code  */
/* ------------------------------------------------------------------ */

test('negative control: an order-insensitive comparison would miss a queryNodes ordering bug', () => {
	const kase = CASES.mixed;
	const refNames = build(ref.Workflow, kase).queryNodes(() => true).map((n) => n.name);
	const reversed = [...refNames].reverse();
	assert.notDeepEqual(reversed, refNames, 'fixture cannot detect ordering');
});

test('negative control: skipping the disabled filter is rejected', () => {
	const kase = CASES.mixed;
	const expected = build(ref.Workflow, kase).getTriggerNodes().map((n) => n.name);
	// A plausible implementation queries by type only and forgets `disabled === true`.
	const withDisabled = kase.nodes.filter((n) => n.type.endsWith('Trigger')).map((n) => n.name);
	assert.notDeepEqual(withDisabled, expected, 'oracle failed to discriminate');
});

test('negative control: presence instead of truthiness in the testStaticData short-circuit is rejected', () => {
	const kase = CASES.isolated;
	const wf = build(ref.Workflow, kase);
	wf.setTestStaticData({ global: null });
	const d = wf.getStaticData('global');
	d.real = true;
	// `key in testStaticData` is true here, but the reference uses truthiness, so the REAL bucket
	// is returned and keeps the write. A presence check would have returned `null`.
	assert.deepEqual(wf.getStaticData('global'), { real: true });
	assert.notEqual(wf.getStaticData('global'), null);
});

test('negative control: copying the destination connection instead of referencing it is detectable', () => {
	const kase = CASES.sparse;
	const wf = build(ref.Workflow, kase);
	const [[, dest]] = wf.getConnectionsBetweenNodes(['Switch'], ['A']);
	const stored = wf.connectionsBySourceNode.Switch.main[2][0];
	assert.equal(dest, stored, 'the reference returns the stored object by identity');
});
