/**
 * Gate 4 — no hidden coupling.
 *
 * Runs the isolated unit with `LEGO_PORT_MODE=strict`: every port is answered by
 * a standalone implementation that never touches the reference runtime or its
 * third-party dependencies.
 *
 * Claims verified:
 *   1. the isolated unit loads and answers with NO reference runtime in the module graph
 *   2. every port-independent answer is identical to the reference (structure,
 *      adjacency, traversal, indexes, checksum, diff, graph validation, setters)
 *   3. answers in the declared port-dependent sections DO change — proving those
 *      dependencies are truly routed through ports instead of being baked in
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

/**
 * Sections whose answers are produced BY a port implementation:
 *   nodeParameters → P-NODE-MODEL (parameter defaults)
 *   rename         → P-NODE-RENAME / P-NODE-REFERENCE (form fields, access patterns)
 *
 * Note: 'triggers' (getTriggerNodes/getStartNode/getParentMainInputNode) is NOT
 * here — it depends on the node-type registry the HOST injects into the
 * constructor, so it stays identical even in strict mode. That is declared, not
 * accidental: the registry is part of the model's host contract.
 */
const PORT_DEPENDENT = new Set(['nodeParameters', 'rename']);

const runDigest = (source, mode) => {
	const out = join(mkdtempSync(join(tmpdir(), 'lego-strict-')), 'digest.json');
	const result = spawnSync(process.execPath, [RUNNER, '--source', source, '--mode', mode, '--out', out], {
		cwd: REPO,
		encoding: 'utf8',
		env: { ...process.env, LEGO_NODES_JSON: process.env.LEGO_NODES_JSON ?? '' },
	});
	assert.equal(result.status, 0, `digest run (${source}/${mode}) failed:\n${result.stdout}\n${result.stderr}`);
	return JSON.parse(readFileSync(out, 'utf8'));
};

let strict;
let reference;

before(() => {
	assert.ok(existsSync(join(PKG, '.extract', 'dist', 'model-api.js')), 'isolated unit not built — run `npm run build`');
	strict = runDigest('isolated', 'strict');
	reference = runDigest('isolated', 'reference');
});

test('strict mode runs the isolated unit without the reference runtime', () => {
	assert.equal(strict.portMode, 'strict');
	assert.equal(strict.loadedReferenceRuntime, false, 'reference runtime leaked into the strict module graph');
	assert.equal(strict.workflowCount, reference.workflowCount);
});

test('port-independent model behavior is identical without any engine', () => {
	const leaks = [];
	let identical = 0;
	for (const wf of Object.keys(reference.digests)) {
		for (const section of Object.keys(reference.digests[wf])) {
			const same = JSON.stringify(reference.digests[wf][section]) === JSON.stringify(strict.digests[wf][section]);
			if (same) identical++;
			else if (!PORT_DEPENDENT.has(section)) leaks.push(`${wf} :: ${section}`);
		}
	}
	assert.ok(identical > 150, `expected broad port-independent equality, got ${identical}`);
	assert.deepEqual(leaks, [], `undeclared coupling detected (behavior changed outside a declared port): ${leaks.join(', ')}`);
});

test('declared port seams really are seams (answers change when the port changes)', () => {
	const changed = new Set();
	for (const wf of Object.keys(reference.digests)) {
		for (const section of PORT_DEPENDENT) {
			if (JSON.stringify(reference.digests[wf][section]) !== JSON.stringify(strict.digests[wf][section])) changed.add(section);
		}
	}
	for (const section of PORT_DEPENDENT) {
		assert.ok(changed.has(section), `section '${section}' did not change in strict mode — the port is not actually used`);
	}
});
