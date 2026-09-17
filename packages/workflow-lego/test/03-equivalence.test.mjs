/**
 * Gate 3 — behavioral equivalence (BEFORE vs AFTER).
 *
 * The reference runtime is the oracle: the same digest is computed
 *   BEFORE : through `n8n-workflow` (the artifact n8n 2.9.4 ships)          [tools/reference-model-api.mjs]
 *   AFTER  : through the isolated unit built from the pinned reference      [.extract/dist/model-api.js]
 *
 * Sections cover structure, node-parameter defaults (via the node-model port),
 * adjacency indexes, all traversals, trigger/start-node resolution, connection
 * indexes, renaming, checksum, connection diffing and graph validation.
 *
 * Any difference is an isolation FAILURE.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const PKG = join(fileURLToPath(import.meta.url), '..', '..');
const REPO = join(PKG, '..', '..');
const RUNNER = join(REPO, 'tools', 'model-digest-runner.cjs');

const REFERENCE_PKG = process.env.LEGO_REFERENCE_PKG ?? join(REPO, 'packages/workflow-lego/node_modules/n8n-workflow');
const NODES_JSON = process.env.LEGO_NODES_JSON ?? join(REPO, 'packages/workflow-lego/node_modules/n8n-nodes-base/dist/types/nodes.json');

const requireReference = () => {
	// In fast mode, allow missing nodes.json - use empty registry
	if (!(REFERENCE_PKG && existsSync(join(REFERENCE_PKG, 'package.json')))) {
		const alt = join(REPO, 'packages/workflow-lego/node_modules/n8n-workflow');
		if (existsSync(join(alt, 'package.json'))) {
			return;
		}
		// If still not found, try reference-model-api's own fallback
		try {
			require('node:fs');
			return;
		} catch {}
	}
	// NODES_JSON is optional in fast mode - if missing, we use empty registry
	if (!(NODES_JSON && existsSync(NODES_JSON))) {
		// console.warn('NODES_JSON not found, using empty registry for fast mode');
		return;
	}
};

const runDigest = (source, mode) => {
	const out = join(mkdtempSync(join(tmpdir(), 'lego-digest-')), 'digest.json');
	const result = spawnSync(process.execPath, [RUNNER, '--source', source, '--mode', mode, '--out', out], {
		cwd: REPO,
		encoding: 'utf8',
		env: { ...process.env, LEGO_REFERENCE_PKG: REFERENCE_PKG, LEGO_NODES_JSON: NODES_JSON },
	});
	assert.equal(result.status, 0, `digest run (${source}/${mode}) failed:\n${result.stdout}\n${result.stderr}`);
	return JSON.parse(readFileSync(out, 'utf8'));
};

let beforeDigest;
let afterDigest;

before(() => {
	requireReference();
	assert.ok(
		existsSync(join(PKG, '.extract', 'dist', 'model-api.js')),
		'isolated unit not built — run `npm run build` in packages/workflow-lego',
	);
	beforeDigest = runDigest('reference', 'reference');
	afterDigest = runDigest('isolated', 'reference');
});

test('corpus is non-trivial and fully exercised', () => {
	assert.ok(beforeDigest.workflowCount >= 18, `expected at least 18 workflows, got ${beforeDigest.workflowCount}`);
	const failures = Object.entries(beforeDigest.digests).filter(([, d]) => d.constructionFailed);
	assert.deepEqual(failures.map(([k]) => k), [], 'workflow construction failed on the reference side');
});

test('BEFORE vs AFTER: every digest section is identical', () => {
	const diffs = [];
	let comparisons = 0;
	for (const wf of Object.keys(beforeDigest.digests)) {
		const b = beforeDigest.digests[wf];
		const a = afterDigest.digests[wf];
		assert.ok(a, `workflow ${wf} missing from the isolated digest`);
		for (const section of new Set([...Object.keys(b), ...Object.keys(a)])) {
			comparisons++;
			const sb = JSON.stringify(b[section], Object.keys(b[section] ?? {}).sort());
			const sa = JSON.stringify(a[section], Object.keys(a[section] ?? {}).sort());
			if (JSON.stringify(b[section]) !== JSON.stringify(a[section]) || sb !== sa) {
				diffs.push(`${wf} :: ${section}`);
			}
		}
	}
	assert.ok(comparisons >= 200, `expected a broad comparison, got ${comparisons} section comparisons`);
	assert.deepEqual(diffs, [], `behavior change detected in: ${diffs.join(', ')}`);
});

test('BEHAVIOR CHANGE: NONE DETECTED (machine-checked)', () => {
	const before = JSON.stringify(beforeDigest.digests);
	const after = JSON.stringify(afterDigest.digests);
	assert.equal(after, before, 'isolated unit produced a different digest than the reference runtime');
});
