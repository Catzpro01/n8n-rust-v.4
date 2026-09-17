#!/usr/bin/env node
/**
 * Node LEGO — Rust port conformance fixtures (`INode` fidelity corpus).
 *
 * The Phase-3 Rust crate (`crates/n8n-node-model`) must parse every real
 * reference node shape (contracts/node.contract.md §2) and retain unknown
 * fields verbatim. This script extracts the `nodes[]` arrays from a FROZEN
 * list of 10 workflow JSONs (2 in-repo goldens + 8 pinned-reference files,
 * read-only) covering every observed §2 optional key, and writes them with
 * per-node `expectExtraKeys` (node keys minus the 7 known `INode` fields).
 * Fixtures are EXTRACTED, never hand-transcribed.
 *
 * Self-guards: every extracted node must be complete (all 6 required shapes
 * present with the right types) and the corpus must cover each key below —
 * the script fails loudly instead of silently pinning a degenerate corpus.
 *
 * Usage:
 *   node tests/reference/agent-2/node-model/build-fixtures.mjs           # derive + write
 *   node tests/reference/agent-2/node-model/build-fixtures.mjs --check   # re-derive + compare (exit 1 on drift)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REF = resolve(HERE, '..', '..', '..', '..', 'reference', 'n8n');
const GOLDEN = resolve(HERE, '..', '..');
const OUT = resolve(HERE, 'fixtures.json');

const SOURCES = [
	resolve(GOLDEN, '02-one-node', 'workflow.json'),
	resolve(GOLDEN, '03-linear', 'workflow.json'),
	resolve(REF, 'packages/nodes-base/nodes/Beeminder/test/workflow.json'),
	resolve(REF, 'packages/nodes-base/nodes/Merge/test/node/workflow.update_2_1.json'),
	resolve(REF, 'packages/nodes-base/nodes/DebugHelper/test/ThrowAnError.workflow.json'),
	resolve(REF, 'packages/nodes-base/nodes/Microsoft/AzureCosmosDb/test/item/query.workflow.json'),
	resolve(REF, 'packages/testing/playwright/workflows/Test_workflow_4_executions_view.json'),
	resolve(REF, 'packages/testing/playwright/workflows/Workflow_wait_for_webhook.json'),
	resolve(REF, 'packages/testing/playwright/workflows/Onboarding_workflow.json'),
	resolve(REF, 'packages/@n8n/ai-workflow-builder.ee/evaluations/fixtures/reference-workflows/lead-qualification.json'),
];

const KNOWN = new Set(['id', 'name', 'type', 'typeVersion', 'position', 'parameters', 'disabled']);
const REQUIRED_COVERAGE = ['credentials', 'webhookId', 'alwaysOutputData', 'onError', 'continueOnFail', 'disabled', 'notes', 'notesInFlow', 'retryOnFail'];

const isComplete = (n) =>
	typeof n?.id === 'string' &&
	typeof n?.name === 'string' &&
	typeof n?.type === 'string' &&
	typeof n?.typeVersion === 'number' &&
	Array.isArray(n?.position) && n.position.length === 2 && n.position.every((x) => typeof x === 'number') &&
	n?.parameters !== null && typeof n?.parameters === 'object' && !Array.isArray(n?.parameters);

const nodes = [];
const seenKeys = new Set();
let floatTv = 0;
let formFields = 0;
for (const src of SOURCES) {
	const wf = JSON.parse(readFileSync(src, 'utf8'));
	if (!Array.isArray(wf.nodes)) throw new Error(`no nodes array in ${src}`);
	wf.nodes.forEach((node, i) => {
		if (!isComplete(node)) throw new Error(`INCOMPLETE node ${basename(src)}#${i}: ${Object.keys(node ?? {}).join(',')}`);
		for (const k of Object.keys(node)) seenKeys.add(k);
		if (!Number.isInteger(node.typeVersion)) floatTv++;
		if (node.parameters?.formFields !== undefined) formFields++;
		nodes.push({
			id: `${basename(src)}#${i}`,
			source: src.includes('reference/n8n/') ? src.slice(src.indexOf('reference/n8n/')) : src.slice(src.indexOf('tests/reference/')),
			node,
			expectExtraKeys: Object.keys(node).filter((k) => !KNOWN.has(k)).sort(),
		});
	});
}
for (const k of REQUIRED_COVERAGE) {
	if (!seenKeys.has(k)) throw new Error(`COVERAGE GAP: no corpus node carries \`${k}\``);
}
if (floatTv === 0) throw new Error('COVERAGE GAP: no float typeVersion in corpus');
if (formFields === 0) throw new Error('COVERAGE GAP: no parameters.formFields node in corpus');

const payload = { generator: 'build-fixtures.mjs', source: 'reference node corpus (10 frozen workflow JSONs)', nodes };
const json = JSON.stringify(payload, null, 1) + '\n';

if (process.argv.includes('--check')) {
	let committed;
	try {
		committed = readFileSync(OUT, 'utf8');
	} catch {
		console.error(`MISSING: ${OUT} does not exist; run without --check to generate it`);
		process.exit(1);
	}
	if (committed !== json) {
		const a = committed.split('\n');
		const b = json.split('\n');
		const at = a.findIndex((line, i) => line !== b[i]);
		console.error(`DRIFT: fixtures differ from the corpus (first difference at line ${at + 1})`);
		console.error(`  committed:  ${a[at]}`);
		console.error(`  recomputed: ${b[at]}`);
		process.exit(1);
	}
	console.log(`fixtures match the corpus: ${nodes.length} nodes`);
	process.exit(0);
}

writeFileSync(OUT, json);
console.log(`wrote ${OUT}: ${nodes.length} nodes (${floatTv} float typeVersion, ${formFields} formFields)`);
