/**
 * Gate: the reconstruction must reproduce the RECORDED reference answers for
 * `tests/reference/04-disabled-node/`.
 *
 * No runtime install is needed — the golden file carries both the expected
 * answers and the node-type index they were recorded with, so this test runs in
 * a bare sandbox and is the committed regression net that ISSUE-012/R1 and
 * ISSUE-015 asked for ("no committed test consumes the disabled-node fixture").
 *
 * The golden was produced by `tools/record-disabled-golden.mjs` against
 * n8n-workflow@2.9.1 and is never hand-edited (tests/reference/README.md).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectCalls } from '../tools/collect.mjs';
import { registryFromIndex } from '../tools/reference-runtime.mjs';
import { WorkflowRecon } from '../src/workflow.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const CASE_DIR = join(REPO, 'tests', 'reference', '04-disabled-node');

const golden = JSON.parse(readFileSync(join(CASE_DIR, 'expected.json'), 'utf8'));
const fixture = JSON.parse(readFileSync(join(CASE_DIR, 'workflow.json'), 'utf8'));

function buildRecon() {
	return new WorkflowRecon({
		id: fixture.id,
		name: fixture.name,
		nodes: structuredClone(fixture.nodes),
		connections: structuredClone(fixture.connections),
		active: false,
		nodeTypes: registryFromIndex(golden.nodeTypeIndex),
	});
}

test('golden provenance: recorded from the pinned runtime, not hand-written', () => {
	assert.equal(golden.meta.oracle.package, 'n8n-workflow');
	assert.equal(golden.meta.oracle.version, '2.9.1', 'oracle must be the runtime n8n 2.9.4 ships');
	assert.equal(golden.meta.oracle.registryMode, 'real-node-classes');
	assert.equal(golden.meta.generator, 'packages/workflow-recon/tools/record-disabled-golden.mjs');
	assert.ok(Object.keys(golden.calls).length >= 100, 'golden must cover the whole surface');
});

test(`reconstruction == recorded reference (${Object.keys(golden.calls).length} recorded calls)`, () => {
	const actual = collectCalls(buildRecon(), fixture);

	assert.deepEqual(
		Object.keys(actual).sort(),
		Object.keys(golden.calls).sort(),
		'the comparison surface drifted — recorder and test must stay in sync',
	);

	for (const [key, expected] of Object.entries(golden.calls)) {
		assert.deepEqual(actual[key], expected, `divergence from n8n-workflow@2.9.1 at ${key}`);
	}
});

/* --------------------------------------------------------------------- *
 * The `disabled` semantics ISSUE-015 / ISSUE-017 are about, pinned by name
 * so a future reader sees the rule without re-deriving it from the golden.
 * --------------------------------------------------------------------- */

test('ISSUE-017: a disabled trigger is never chosen as start node (workflow.ts:839,853)', () => {
	const wf = buildRecon();
	assert.equal(fixture.nodes[0].disabled, true, 'fixture precondition: Manual Trigger is disabled');
	assert.equal(wf.getStartNode()?.name, 'Schedule Trigger');
	assert.equal(golden.calls['getStartNode()'], 'Schedule Trigger');
});

test('ISSUE-017: a disabled trigger asked for its own start node falls back to itself (workflow.ts:864-885)', () => {
	const wf = buildRecon();
	// getHighestNode -> [] (disabled !== false), so __getStartNode gets the single
	// disabled candidate, rejects it three times, and getStartNode returns
	// nodes[nodeNames[0]] — the disabled node. This is n8n's real behaviour.
	assert.deepEqual(wf.getHighestNode('Manual Trigger'), []);
	assert.equal(wf.getStartNode('Manual Trigger')?.name, 'Manual Trigger');
	assert.equal(golden.calls['getStartNode(Manual Trigger)'], 'Manual Trigger');
});

test('ISSUE-015: getHighestNode skips disabled ancestors but keeps them in parent sets (workflow.ts:498,553)', () => {
	const wf = buildRecon();

	// highest node of everything downstream of the disabled filter is the enabled root
	assert.deepEqual(wf.getHighestNode('Set'), ['Schedule Trigger']);
	assert.deepEqual(wf.getHighestNode('Disabled Filter'), ['Schedule Trigger']);
	assert.deepEqual(wf.getHighestNode('NoOp'), ['Schedule Trigger']);

	// ... while the traversals still report the disabled nodes
	assert.deepEqual(wf.getParentNodes('Set'), [
		'Schedule Trigger',
		'Manual Trigger',
		'Code',
		'Disabled Filter',
	]);
	assert.deepEqual(wf.getChildNodes('Code'), ['NoOp', 'Set', 'Disabled Filter']);
});

test('queryNodes drops disabled nodes before the type check (workflow.ts:282)', () => {
	const wf = buildRecon();
	assert.deepEqual(wf.getTriggerNodes().map((n) => n.name), ['Schedule Trigger']);
	assert.deepEqual(wf.getPollNodes().map((n) => n.name), []);
});

test('pin data is readable, not merely stored (workflow.ts:330 — ISSUE-016)', () => {
	const pinned = [{ json: { pinned: true } }];
	const wf = new WorkflowRecon({
		id: fixture.id,
		nodes: structuredClone(fixture.nodes),
		connections: structuredClone(fixture.connections),
		nodeTypes: registryFromIndex(golden.nodeTypeIndex),
		pinData: { Set: pinned },
	});
	assert.deepEqual(wf.getPinDataOfNode('Set'), pinned);
	assert.equal(wf.getPinDataOfNode('NoOp'), undefined);
});
