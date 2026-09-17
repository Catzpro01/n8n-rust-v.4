/**
 * Gate 06 — POOL-001 non-entanglement pin.
 *
 * `runner.mjs` / `test-run.mjs` / `runner.test.mjs` are the execution-loop prototype
 * from task POOL-001. They are NOT part of this port's proven surface: nothing here
 * is derived from them (they are not reference-derived), and they are not derived
 * from the reference. A sibling lane rewrote `runner.mjs` on this branch (cc2d111f),
 * so "byte-identical to commit X" was the wrong invariant — it blocked a legitimate
 * neighbour change while proving nothing about correctness.
 *
 * What IS worth pinning, and what this gate enforces:
 *   1. the port did not quietly edit them (content hashes, via fixtures/legacy-runner.lock.json);
 *   2. the pin is traceable, not folklore (each lock entry names the commit whose blob
 *      it records, and the working file must hash to the same git blob object);
 *   3. the dependency runs in NEITHER direction — `src/`+`test/` must not import the
 *      prototype, and the prototype must not import the port, because a half-migrated
 *      loop would put unverified behaviour under the goldens' badge.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PKG = resolve(import.meta.dirname, '..');
const REPO = resolve(PKG, '..', '..');
const LOCK = JSON.parse(readFileSync(join(PKG, 'fixtures', 'legacy-runner.lock.json'), 'utf8'));

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const hasGit = (() => {
	try {
		execFileSync('git', ['-C', REPO, 'rev-parse', '--git-dir'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

test('POOL-001 files still hash to what the lock recorded', () => {
	for (const [file, meta] of Object.entries(LOCK.files)) {
		const path = join(PKG, file);
		assert.ok(existsSync(path), `${file} disappeared — POOL-001's artifact is not this lane's to delete`);
		const buffer = readFileSync(path);
		assert.equal(
			sha256(buffer),
			meta.sha256,
			`${file} changed without re-recording the lock. If the change is authorized (it belongs to POOL-001), run: node test/helpers/record-runner-lock.mjs — and say why in results/. If it is not, revert: git checkout ${meta.lastCommit.slice(0, 8)} -- packages/reconstructed-engine/${file}`,
		);
		assert.equal(buffer.length, meta.bytes, `${file} length drifted from the lock (${meta.bytes}B)`);
	}
});

test('the lock is traceable to a commit, not to a vibe', (t) => {
	if (!hasGit) {
		t.diagnostic('no git checkout here — the content hashes above are still enforced');
		return;
	}
	const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).trim();
	for (const [file, meta] of Object.entries(LOCK.files)) {
		const workingBlob = git('hash-object', join(PKG, file));
		assert.equal(workingBlob, meta.gitBlob, `${file}: working tree blob ${workingBlob} is not the recorded ${meta.gitBlob}`);
		const recorded = git('rev-parse', `${meta.lastCommit}:packages/reconstructed-engine/${file}`);
		assert.equal(recorded, meta.gitBlob, `${meta.lastCommit.slice(0, 8)} does not contain the recorded blob for ${file} — the lock was hand-edited`);
	}
});

test('the pin covers every POOL-001 file at the package root', () => {
	// A new sibling artifact must not slip in un-pinned: whoever adds one re-records,
	// and that is the moment to decide whether it belongs to this lane or theirs.
	const rootArtifacts = readdirSync(PKG, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
		.map((entry) => entry.name)
		.sort();
	assert.deepEqual(
		rootArtifacts,
		Object.keys(LOCK.files).sort(),
		'the package root gained or lost a top-level .mjs that the lock does not describe (test/helpers/record-runner-lock.mjs)',
	);
});

for (const [label, from, to, pattern] of [
	['port → prototype', 'src', 'the POOL-001 prototype', /from ['"][^'"]*(?:runner|test-run)(?:\.test)?\.mjs['"]/],
	['prototype → port', '.', 'the reference-verified port', /(?:from|import)\s*\(?\s*['"][^'"]*(?:^|\/)src\//m],
]) {
	test(`${label}: the dependency does not exist in either direction`, () => {
		const files = from === '.' ? ['runner.mjs', 'test-run.mjs', 'runner.test.mjs'].map((f) => join(PKG, f)) : walk(join(PKG, 'src'));
		const offenders = files.filter((file) => pattern.test(stripComments(readFileSync(file, 'utf8'))));
		assert.deepEqual(
			offenders.map((file) => file.replace(`${PKG}/`, '')),
			[],
			`${to} is imported; the two lanes must stay independently replaceable (POOL-001 semantics are not reference-verified, and the port must not become a dependency of the loop)`,
		);
	});
}

function walk(dir) {
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(full));
		else if (entry.name.endsWith('.mjs')) out.push(full);
	}
	return out;
}

/** Citation comments legitimately *name* the files; only real imports count. */
function stripComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}
