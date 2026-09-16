/**
 * Gate 1 — boundary integrity.
 *
 * The LEGO's dependency boundary must match the declaration:
 *   - every owned file exists in the reference package
 *   - every dependency leaving the LEGO maps to a declared port (or a declared deviation)
 *   - no new / removed crossing or inbound edge (drift gate)
 *   - the kernel snapshots still equal the pinned reference values
 *   - the port surface still matches what the owned sources import
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyse, MANIFEST } from '../../../tools/workflow-boundary-map.mjs';

const PKG = join(fileURLToPath(import.meta.url), '..', '..');
const REPO = join(PKG, '..', '..');

const run = (script, args = []) =>
	spawnSync(process.execPath, [join(REPO, 'tools', script), ...args], { cwd: REPO, encoding: 'utf8' });

test('every owned file exists in the pinned reference package', () => {
	const report = analyse();
	assert.deepEqual(report.owned.missing, [], `missing owned files: ${report.owned.missing.join(', ')}`);
	assert.equal(report.owned.count, MANIFEST.owns.files.length);
});

test('no dependency leaves the LEGO without a declared port', () => {
	const report = analyse();
	assert.deepEqual(report.undeclared, [], 'undeclared boundary crossings found');
});

test('boundary crossings and inbound edges match the pinned expectations', () => {
	const result = run('workflow-boundary-map.mjs', ['--check']);
	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
	assert.match(result.stdout, /Boundary check: PASS/);
});

test('kernel snapshots equal the pinned reference constants', () => {
	const result = run('workflow-kernel-conformance.mjs', ['--check']);
	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
	assert.match(result.stdout, /Kernel snapshot check: PASS/);
});

test('port surface matches the imports of the owned sources', () => {
	const result = run('workflow-port-surface.mjs', ['--check']);
	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
	assert.match(result.stdout, /Port surface check: PASS/);
});

test('declared ports cover every consumed port module exactly once', () => {
	const modules = MANIFEST.ports.map((p) => p.adapter);
	assert.equal(new Set(modules).size, modules.length, 'duplicate port adapter declared');
	const ids = MANIFEST.ports.map((p) => p.id);
	assert.equal(new Set(ids).size, ids.length, 'duplicate port id declared');
});
