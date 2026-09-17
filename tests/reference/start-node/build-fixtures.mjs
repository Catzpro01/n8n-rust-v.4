#!/usr/bin/env node
/**
 * Start-node / highest-node conformance fixtures (LEGO 01 — Workflow).
 *
 * `getStartNode` and `getHighestNode` are the two reference methods whose result depends on the
 * `disabled` flag, and the flag is *asymmetric* between them (`workflow.ts:498` tests the starting
 * node with `disabled === false`, `:553` tests parents with `disabled !== true`). A port that
 * normalises both into one `!disabled` check diverges on every node that omits the key.
 *
 * The golden values below are **derived from the pinned reference runtime**
 * (`n8n-workflow@2.9.1`, the dependency set of n8n 2.9.4) — never hand-written. `--check`
 * re-derives every case and exits non-zero on drift.
 *
 * Usage:
 *   node tests/reference/start-node/build-fixtures.mjs           # derive + write
 *   node tests/reference/start-node/build-fixtures.mjs --check   # re-derive + compare
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const OUT = join(HERE, 'fixtures.json');

const runtimeDir =
	process.env.LEGO_LIVE_RUNTIME ??
	[join(REPO, '.runtime', 'node_modules'), '/home/user/.n8n-live/node_modules'].find((p) =>
		existsSync(join(p, 'n8n-workflow', 'package.json')));
if (!runtimeDir) {
	console.error('reference runtime not found — run scripts/setup-reference-runtime.sh (or set LEGO_LIVE_RUNTIME)');
	process.exit(2);
}
const req = createRequire(join(runtimeDir, 'n8n-workflow', 'package.json'));
const { Workflow } = req('n8n-workflow');

/** Same node factory as tests/reference/workflow-rust/build-fixtures.mjs. */
const node = (name, type = 'n8n-nodes-base.noOp', extra = {}) => ({
	id: `id-${name}`, name, type, typeVersion: 1, position: [0, 0], parameters: {}, ...extra,
});
const c = (n) => ({ node: n, type: 'main', index: 0 });

/**
 * The reference `__getStartNode` asks the node-type registry whether a type is a trigger/poll
 * (`workflow.ts:830-843`). The registry is host input, so each case declares exactly which types
 * it registers as triggers — the Rust port consumes the same list.
 */
const registryFor = (triggerTypes) => {
	const describe = (name, isTrigger) => ({
		description: {
			displayName: name, name, group: ['trigger'], version: 1, description: '',
			defaults: {}, inputs: isTrigger ? [] : ['main'], outputs: ['main'], properties: [],
		},
		trigger: isTrigger ? function triggerStub() {} : undefined,
	});
	return {
		getByName: (n) => describe(n, triggerTypes.includes(n)),
		getByNameAndVersion: (n) => describe(n, triggerTypes.includes(n)),
		getKnownTypes: () => ({}),
	};
};

/* ------------------------------------------------------------------ */
/* cases                                                              */
/* ------------------------------------------------------------------ */
const CASES = [
	{
		id: 'D-01',
		note: 'a DISABLED trigger is skipped by __getStartNode (workflow.ts:839 `if (node.disabled === true) continue`) — nothing else qualifies, so the result is undefined',
		triggerTypes: ['n8n-nodes-base.manualTrigger'],
		nodes: [node('Manual Trigger', 'n8n-nodes-base.manualTrigger', { disabled: true }), node('Code', 'n8n-nodes-base.code')],
		connections: { 'Manual Trigger': { main: [[c('Code')]] } },
	},
	{
		id: 'D-02',
		note: 'the same workflow with the trigger ENABLED returns the trigger',
		triggerTypes: ['n8n-nodes-base.manualTrigger'],
		nodes: [node('Manual Trigger', 'n8n-nodes-base.manualTrigger'), node('Code', 'n8n-nodes-base.code')],
		connections: { 'Manual Trigger': { main: [[c('Code')]] } },
	},
	{
		id: 'D-03',
		note: 'getHighestNode: a parent with `disabled: false` IS the highest (workflow.ts:553 `disabled !== true`)',
		triggerTypes: [],
		nodes: [node('A', 'n8n-nodes-base.noOp', { disabled: false }), node('End')],
		connections: { A: { main: [[c('End')]] } },
		highestOf: 'End',
	},
	{
		id: 'D-04',
		note: 'ASYMMETRY: a parent that OMITS `disabled` is still the highest (`undefined !== true`), while as a starting node it is NOT its own highest (`undefined === false` is false, workflow.ts:498)',
		triggerTypes: [],
		nodes: [node('A', 'n8n-nodes-base.noOp'), node('End')],
		connections: { A: { main: [[c('End')]] } },
		highestOf: 'End',
		highestOfSelf: 'A',
	},
	{
		id: 'D-05',
		note: 'getHighestNode: `disabled: false` on a node with NO incoming connections makes it its own highest (workflow.ts:498-503 early return)',
		triggerTypes: [],
		nodes: [node('Only', 'n8n-nodes-base.noOp', { disabled: false })],
		connections: {},
		highestOf: 'Only',
	},
	{
		id: 'D-06',
		note: 'getHighestNode: a node that OMITS `disabled` and has no incoming connections is NOT its own highest — the early return yields []',
		triggerTypes: [],
		nodes: [node('Only', 'n8n-nodes-base.noOp')],
		connections: {},
		highestOf: 'Only',
	},
	{
		id: 'D-07',
		note: 'a disabled node mid-chain is transparent: the walk continues past it to the enabled root',
		triggerTypes: [],
		nodes: [node('A'), node('B', 'n8n-nodes-base.noOp', { disabled: true }), node('End')],
		connections: { A: { main: [[c('B')]] }, B: { main: [[c('End')]] } },
		highestOf: 'End',
	},
	{
		id: 'D-08',
		note: 'two parents, one disabled: only the enabled parent is reported',
		triggerTypes: [],
		nodes: [node('P1', 'n8n-nodes-base.noOp', { disabled: true }), node('P2'), node('End')],
		connections: { P1: { main: [[c('End')]] }, P2: { main: [[c('End')]] } },
		highestOf: 'End',
	},
	{
		id: 'D-09',
		note: 'single disabled node: the `nodeNames.length === 1` shortcut requires `!node.disabled` (workflow.ts:824), and no fallback qualifies → undefined',
		triggerTypes: [],
		nodes: [node('Only', 'n8n-nodes-base.noOp', { disabled: true })],
		connections: {},
	},
	{
		id: 'D-10',
		note: 'STARTING_NODE_TYPES fallback skips disabled entries (workflow.ts:853) and picks the next one',
		triggerTypes: [],
		nodes: [node('F', 'n8n-nodes-base.formTrigger', { disabled: true }), node('E', 'n8n-nodes-base.evaluationTrigger')],
		connections: {},
	},
	{
		id: 'D-11',
		note: 'STARTING_NODE_TYPES order decides (constants.ts:53-59): evaluationTrigger precedes formTrigger; scheduleTrigger/cron are NOT in the list',
		triggerTypes: [],
		nodes: [node('S', 'n8n-nodes-base.scheduleTrigger'), node('F', 'n8n-nodes-base.formTrigger'), node('E', 'n8n-nodes-base.evaluationTrigger')],
		connections: {},
	},
	{
		id: 'D-12',
		note: 'getStartNode(destination): highest nodes empty → the destination itself is the only candidate, and the length-1 shortcut returns it even though its trigger parent is disabled',
		triggerTypes: ['n8n-nodes-base.manualTrigger'],
		nodes: [node('Manual Trigger', 'n8n-nodes-base.manualTrigger', { disabled: true }), node('Code', 'n8n-nodes-base.code')],
		connections: { 'Manual Trigger': { main: [[c('Code')]] } },
		destination: 'Code',
		highestOf: 'Code',
	},
	{
		id: 'D-13',
		note: 'a node WITH incoming connections is never its own highest, even with `disabled: false` — currentHighest is only returned on the early exits',
		triggerTypes: [],
		nodes: [node('A'), node('B', 'n8n-nodes-base.noOp', { disabled: false })],
		connections: { A: { main: [[c('B')]] } },
		highestOf: 'B',
	},
	{
		id: 'D-14',
		note: 'getHighestNode dereferences `this.nodes[nodeName].disabled` unguarded → TypeError for an unknown node (workflow.ts:498)',
		triggerTypes: [],
		nodes: [node('A')],
		connections: {},
		highestOfUnknown: 'ZZZ',
	},
];

const derived = CASES.map((kase) => {
	const wf = new Workflow({
		id: 'wf-start-node',
		name: 'Start Node',
		nodes: kase.nodes,
		connections: kase.connections,
		active: false,
		nodeTypes: registryFor(kase.triggerTypes),
		settings: {},
	});
	const record = {
		id: kase.id,
		note: kase.note,
		triggerTypes: kase.triggerTypes,
		nodes: kase.nodes,
		connections: kase.connections,
		startNode: wf.getStartNode()?.name ?? null,
	};
	if (kase.destination) {
		record.destination = kase.destination;
		record.startNodeOfDestination = wf.getStartNode(kase.destination)?.name ?? null;
	}
	if (kase.highestOf) {
		record.highestOf = kase.highestOf;
		record.highestNodes = wf.getHighestNode(kase.highestOf);
	}
	if (kase.highestOfSelf) {
		record.highestOfSelf = kase.highestOfSelf;
		record.highestNodesOfSelf = wf.getHighestNode(kase.highestOfSelf);
	}
	if (kase.highestOfUnknown) {
		record.highestOfUnknown = kase.highestOfUnknown;
		try {
			wf.getHighestNode(kase.highestOfUnknown);
			record.highestUnknownThrows = null;
		} catch (error) {
			record.highestUnknownThrows = error.constructor.name;
		}
	}
	return record;
});

const payload = {
	generatedAt: new Date().toISOString(),
	source: 'reference runtime (n8n-workflow 2.9.1 — the 2.9.4 dependency set)',
	runtimeDir,
	provenance: {
		package: 'n8n-workflow',
		version: req(join(runtimeDir, 'n8n-workflow', 'package.json')).version,
		referenceSource: 'reference/n8n/packages/workflow/src @ b6dc2787c45677a29a9612cd27eb911302961a83',
		citedLines: ['workflow.ts:498', 'workflow.ts:553', 'workflow.ts:824', 'workflow.ts:839', 'workflow.ts:853', 'constants.ts:53-59'],
	},
	startingNodeTypes: ['n8n-nodes-base.manualTrigger', 'n8n-nodes-base.executeWorkflowTrigger', 'n8n-nodes-base.errorTrigger', 'n8n-nodes-base.evaluationTrigger', 'n8n-nodes-base.formTrigger'],
	cases: derived,
};

const json = JSON.stringify(payload, null, '\t') + '\n';

if (process.argv.includes('--check')) {
	if (!existsSync(OUT)) {
		console.error(`${OUT} missing — run without --check first`);
		process.exit(2);
	}
	const committed = JSON.parse(readFileSync(OUT, 'utf8'));
	const same = JSON.stringify({ ...committed, generatedAt: null }) === JSON.stringify({ ...payload, generatedAt: null });
	if (!same) {
		console.error('DRIFT: start-node fixtures differ from the pinned reference');
		process.exit(1);
	}
	console.log(`start-node fixtures match the pinned reference: ${derived.length} cases`);
	process.exit(0);
}

writeFileSync(OUT, json);
console.log(`wrote ${OUT} (${derived.length} cases)`);
