/**
 * Gate: differential parity against the pinned reference runtime.
 *
 * For every workflow in the corpus the reconstruction and the real
 * `n8n-workflow@2.9.1` must produce the *same* answer set (tools/collect.mjs).
 * The corpus is the golden fixtures under `tests/reference/` plus synthetic
 * cases that pin the edge semantics the `disabled` flag drives.
 *
 * Needs the pinned runtime:  bash scripts/setup-reference-runtime.sh
 * Without it the parity tests are reported as skipped, never as passed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectCalls } from '../tools/collect.mjs';
import {
	buildRealNodeTypes,
	findRuntime,
	loadReference,
	nodeTypesOf,
	registryFromIndex,
} from '../tools/reference-runtime.mjs';
import { WorkflowRecon } from '../src/workflow.ts';
import {
	MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE,
	STARTING_NODE_TYPES,
} from '../src/constants.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');

const runtime = findRuntime();
const skip = runtime
	? false
	: 'pinned reference runtime missing — run: bash scripts/setup-reference-runtime.sh';

const goldenIndex = JSON.parse(
	readFileSync(join(REPO, 'tests', 'reference', '04-disabled-node', 'expected.json'), 'utf8'),
).nodeTypeIndex;

/** Golden fixtures: every directory under tests/reference holding a workflow.json. */
const fixtures = readdirSync(join(REPO, 'tests', 'reference'), { withFileTypes: true })
	.filter((d) => d.isDirectory() && existsSync(join(REPO, 'tests', 'reference', d.name, 'workflow.json')))
	.map((d) => ({
		name: d.name,
		workflow: JSON.parse(
			readFileSync(join(REPO, 'tests', 'reference', d.name, 'workflow.json'), 'utf8'),
		),
	}));

const node = (
	name: string,
	type: string,
	typeVersion: number,
	extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
	id: `id-${name.replace(/\W+/g, '-').toLowerCase()}`,
	name,
	type,
	typeVersion,
	position: [0, 0],
	parameters: {},
	...extra,
});

const edge = (to: string, index = 0) => ({ node: to, type: 'main', index });

/** Synthetic cases pinning the semantics the `disabled` tri-state drives. */
const synthetic: Array<{ name: string; workflow: Record<string, any> }> = [
	{
		name: 'synthetic: only node is a disabled trigger',
		workflow: {
			id: 'syn-disabled-only',
			name: 'Disabled Only Trigger',
			nodes: [node('Manual Trigger', 'n8n-nodes-base.manualTrigger', 1, { disabled: true })],
			connections: {},
		},
	},
	{
		name: 'synthetic: disabled===false root counts as highest, absent flag does not',
		workflow: {
			id: 'syn-disabled-tri-state',
			name: 'Disabled Tri State',
			nodes: [
				node('Explicitly Enabled', 'n8n-nodes-base.code', 2, { disabled: false }),
				node('Flag Absent', 'n8n-nodes-base.set', 3.4),
			],
			connections: {},
		},
	},
	{
		name: 'synthetic: disabled node mid-chain',
		workflow: {
			id: 'syn-mid-chain',
			name: 'Mid Chain Disabled',
			nodes: [
				node('Manual Trigger', 'n8n-nodes-base.manualTrigger', 1),
				node('Disabled Step', 'n8n-nodes-base.code', 2, { disabled: true }),
				node('Tail', 'n8n-nodes-base.set', 3.4),
			],
			connections: {
				'Manual Trigger': { main: [[edge('Disabled Step')]] },
				'Disabled Step': { main: [[edge('Tail')]] },
			},
		},
	},
	{
		name: 'synthetic: multi-output fan-out and sparse input slots',
		workflow: {
			id: 'syn-multi-output',
			name: 'Multi Output',
			nodes: [
				node('Manual Trigger', 'n8n-nodes-base.manualTrigger', 1),
				node('Filter', 'n8n-nodes-base.filter', 2.2),
				node('Kept', 'n8n-nodes-base.set', 3.4),
				node('Dropped', 'n8n-nodes-base.noOp', 1),
			],
			connections: {
				'Manual Trigger': { main: [[edge('Filter')]] },
				Filter: { main: [[edge('Kept')], [edge('Dropped')]] },
			},
		},
	},
	{
		name: 'synthetic: connection to an undeclared node is ignored',
		workflow: {
			id: 'syn-dangling',
			name: 'Dangling Target',
			nodes: [
				node('Manual Trigger', 'n8n-nodes-base.manualTrigger', 1),
				node('Tail', 'n8n-nodes-base.code', 2),
			],
			connections: {
				'Manual Trigger': { main: [[edge('Ghost')]] },
				Ghost: { main: [[edge('Tail')]] },
			},
		},
	},
	{
		name: 'synthetic: cycle terminates and both sides agree',
		workflow: {
			id: 'syn-cycle',
			name: 'Cycle',
			nodes: [
				node('A', 'n8n-nodes-base.code', 2),
				node('B', 'n8n-nodes-base.set', 3.4),
				node('C', 'n8n-nodes-base.noOp', 1),
			],
			connections: {
				A: { main: [[edge('B')]] },
				B: { main: [[edge('C')]] },
				C: { main: [[edge('A')]] },
			},
		},
	},
];

test('vocabulary snapshot matches the reference export', { skip }, () => {
	const ref = loadReference(runtime!);
	assert.deepEqual(STARTING_NODE_TYPES, ref.STARTING_NODE_TYPES);
	assert.equal(
		MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE,
		ref.MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE,
	);
	assert.equal(
		STARTING_NODE_TYPES[0],
		'n8n-nodes-base.manualTrigger',
		'start-node ordering is index-sensitive',
	);
});

for (const { name, workflow } of [...fixtures.map((f) => ({ name: f.name, workflow: f.workflow })), ...synthetic]) {
	test(`parity: ${name}`, { skip }, () => {
		const types: string[] = nodeTypesOf(workflow);
		const known = types.filter((t: string) => goldenIndex[t]);
		assert.deepEqual(known, types, `node type index is missing ${types.filter((t) => !known.includes(t))}`);

		const built = buildRealNodeTypes(runtime!, types);
		const realRegistry = built.realRegistry;
		const index = built.index as Record<string, Record<string, unknown>>;
		for (const type of types) {
			assert.deepEqual(
				index[type],
				goldenIndex[type],
				`node type index drifted from the recorded golden: ${type}`,
			);
		}

		const real = new (loadReference(runtime!).Workflow)({
			id: workflow.id,
			name: workflow.name,
			nodes: structuredClone(workflow.nodes),
			connections: structuredClone(workflow.connections),
			active: false,
			nodeTypes: realRegistry,
		});

		const recon = new WorkflowRecon({
			id: workflow.id,
			name: workflow.name,
			nodes: structuredClone(workflow.nodes),
			connections: structuredClone(workflow.connections),
			active: false,
			nodeTypes: registryFromIndex(index),
		});

		const expected = collectCalls(real, workflow);
		const actual = collectCalls(recon, workflow);

		assert.ok(Object.keys(expected).length > 0, 'empty comparison surface');
		for (const [key, value] of Object.entries(expected)) {
			assert.deepEqual(actual[key], value, `divergence at ${key}`);
		}
	});
}
