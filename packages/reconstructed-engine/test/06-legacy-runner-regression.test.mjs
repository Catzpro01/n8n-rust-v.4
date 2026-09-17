/**
 * Gate 06 — POOL-001 regression pin.
 *
 * `runner.mjs` / `test-run.mjs` are the earlier execution-loop prototype (task
 * POOL-001). They are NOT part of this port's proven surface: nothing here is
 * derived from them, and they are not derived from the reference. They stay in the
 * tree because a sibling agent's task record points at them, so the one thing this
 * package must guarantee is that the new golden machinery does not quietly edit
 * them — a "cleanup" of a neighbour's artifact is exactly the kind of cross-task
 * damage the LEGO isolation rules forbid.
 *
 * Pinned by content hash (checked in two ways, so neither the file nor the pin can
 * rot unnoticed): an inline sha256, and — when this is a git checkout — a byte
 * comparison against the same path at the baseline commit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PKG = resolve(import.meta.dirname, '..');
const BASELINE = 'fc4e5631e1fde390d4c21789d407aeef890fb602';

const PINS = {
	'runner.mjs': 'fa90e50441f5e049b1fccd29e04dd9751ea77a85cdbff6ffcc656ead96a433fe',
	'test-run.mjs': 'a9e7e0355c7f1caa1fb1ca7adb4e8fd0c7fd14c38573b16e6f8c3fc42241a705',
};

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

test('POOL-001 runner/test-run are byte-identical to their recorded hashes', () => {
	for (const [file, hash] of Object.entries(PINS)) {
		const actual = sha256(readFileSync(join(PKG, file)));
		assert.equal(actual, hash, `${file} changed. POOL-001 is a separate task: revert it (git checkout ${BASELINE.slice(0, 7)} -- packages/reconstructed-engine/${file}) and if the change is genuinely required, update the pin in this file AND say why in results/.`);
	}
});

test('POOL-001 files match the baseline commit when git is available', (t) => {
	let git;
	try {
		git = (args) =>
			execFileSync('git', ['-C', resolve(PKG, '..', '..'), ...args], { encoding: 'utf8' });
		git(['rev-parse', BASELINE]);
	} catch {
		t.diagnostic('git or the baseline commit is unavailable — hash pin above is still enforced');
		return;
	}
	for (const file of Object.keys(PINS)) {
		const atBaseline = git(['show', `${BASELINE}:packages/reconstructed-engine/${file}`]);
		const working = readFileSync(join(PKG, file), 'utf8');
		assert.equal(working, atBaseline, `${file} differs from ${BASELINE.slice(0, 7)}`);
	}
});

test('the legacy runner is not imported by the port or its tests', () => {
	// It is a prototype with its own (unverified) semantics. If src/ started
	// importing it, unverified behaviour would ride in under the goldens' badge.
	const walk = (dir) => {
		const out = [];
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) out.push(...walk(full));
			else if (entry.name.endsWith('.mjs')) out.push(full);
		}
		return out;
	};
	const files = [...walk(join(PKG, 'src')), ...walk(join(PKG, 'test'))];
	assert.ok(files.length > 12, 'the scan found nothing — that is not a pass');
	for (const file of files) {
		assert.doesNotMatch(
			readFileSync(file, 'utf8'),
			/from ['"][^'"]*(?:runner|test-run)\.mjs['"]/,
			`${file} imports the POOL-001 prototype — that code is not reference-verified`,
		);
	}
});
