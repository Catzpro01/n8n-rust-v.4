/**
 * Gate 08 — the evidence must describe the artifacts it is quoted against.
 *
 * `evidence/` holds transcripts of two real runs (live vs oracle-suppressed) plus
 * summary.json. This repo has already had to retract result files whose numbers nothing
 * could reproduce, so the fix is not "write better prose" — it is a gate that goes red
 * when the quoted evidence stops matching the tree.
 *
 * Deliberately strict: a missing evidence directory is a FAILURE, not a skip. The one
 * thing that legitimately invalidates this gate is a *changed* fixture, answered by
 * `npm run verify:engine:evidence`.
 *
 * Why this gate is NOT in gate 07's mutation suite: gate 07 mutates `src/` to prove the
 * behaviour gates can fail, and nothing in `src/` changes what a transcript says. Grading
 * prose against a mutated module would make the mutation suite believe it tests more than
 * it does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PKG = resolve(import.meta.dirname, '..');
const REPO = resolve(PKG, '..', '..');
const EVIDENCE = join(PKG, 'evidence');
const VOLATILE_KEYS = ['$recordedAt', 'capturedAt', '$generatedAt', 'recordedAt'];

/**
 * The recorder (`test/helpers/capture-evidence.mjs`) runs the whole suite *before* it
 * writes the new transcripts, so the freshness assertions cannot be judged during that
 * run — they would fail on the very change that requires re-capturing, and the recorder
 * refuses red runs. It sets ENGINE_EVIDENCE_RECORDER=1; every bypass prints a diagnostic
 * into the transcript, so "graded" and "self-certified" stay distinguishable after the fact.
 */
const recording = process.env.ENGINE_EVIDENCE_RECORDER === '1';

/**
 * One place, so the bypass cannot be narrowed to whichever test happened to be written
 * first: while capturing, every assertion that grades the EXISTING evidence is moot (it is
 * about to be overwritten) and would otherwise deadlock the recorder against itself.
 */
function bypassWhileRecording(t) {
	if (!recording) return false;
	t.diagnostic('recorder run (ENGINE_EVIDENCE_RECORDER=1): existing evidence is about to be rewritten, not graded');
	return true;
}

const summaryPath = join(EVIDENCE, 'summary.json');
const hasSummary = existsSync(summaryPath);
const summary = hasSummary ? JSON.parse(readFileSync(summaryPath, 'utf8')) : null;

/** Same canonicalisation as the recorder: timestamps are not evidence drift. */
function canonical(absPath) {
	const text = readFileSync(absPath, 'utf8');
	if (!absPath.endsWith('.json')) return text;
	const parsed = JSON.parse(text);
	for (const key of VOLATILE_KEYS) delete parsed[key];
	return JSON.stringify(parsed, null, 2);
}
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

test('the evidence directory exists and is complete', (t) => {

	assert.ok(hasSummary, 'evidence/summary.json is missing — run: npm run verify:engine:evidence (from the repo root)');
	const files = readdirSync(EVIDENCE).sort();
	for (const expected of ['summary.json', 'README.md']) {
		assert.ok(files.includes(expected), `evidence/${expected} is missing (found: ${files.join(', ')})`);
	}
	assert.ok(
		files.filter((f) => f.endsWith('.txt')).length >= 2,
		'expected at least two transcripts (live + offline); one transcript proves nothing about the other mode',
	);
});

test('the transcripts describe the artifacts currently in the tree', (t) => {
	if (bypassWhileRecording(t)) return;

	const stale = [];
	for (const [rel, meta] of Object.entries(summary.artifacts ?? {})) {
		if (!existsSync(join(PKG, rel))) {
			stale.push(`${rel}: recorded in the evidence but no longer present`);
			continue;
		}
		const actual = sha256(canonical(join(PKG, rel)));
		if (actual !== meta.sha256) stale.push(`${rel}: evidence was captured against different content (${meta.sha256.slice(0, 12)}… ≠ ${actual.slice(0, 12)}…)`);
	}
	assert.deepEqual(
		stale,
		[],
		'the fixtures/manifest the transcripts quote have moved since capture. Re-run: npm run verify:engine:evidence — and never hand-edit evidence/summary.json to make this pass.',
	);
	assert.deepEqual(
		summary.srcFiles,
		readdirSync(join(PKG, 'src')).filter((f) => f.endsWith('.mjs')).sort(),
		'the module list changed since the evidence was captured; re-run the recorder so the transcripts name the current surface',
	);
});

test('both recorded runs are green and internally consistent', (t) => {
	if (bypassWhileRecording(t)) return;

	const problems = [];
	for (const [mode, rec] of Object.entries(summary.runs ?? {})) {
		const c = rec.counts ?? {};
		if (c.fail !== 0) problems.push(`${mode}: recorded ${c.fail} failure(s) — evidence of a red run is not evidence`);
		if (c.tests !== c.pass + (c.skipped ?? 0)) problems.push(`${mode}: # tests ${c.tests} ≠ pass ${c.pass} + skipped ${c.skipped}`);
		if (!(c.tests > 60)) problems.push(`${mode}: only ${c.tests} tests — that is not the suite this package ships (a runner that skipped whole files reads the same as a small suite)`);
		if ((rec.notOk ?? []).length) problems.push(`${mode}: notOk array is not empty`);
		if (!existsSync(join(PKG, rec.transcript ?? 'x'))) problems.push(`${mode}: transcript ${rec.transcript} is missing`);
	}
	assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
});

test('the live run really used the pinned reference, the offline run really did not', (t) => {
	if (bypassWhileRecording(t)) return;

	const live = readTranscript('live');
	const offline = readTranscript('offline');
	const golden = JSON.parse(readFileSync(join(PKG, 'fixtures', 'data-proxy.golden.json'), 'utf8'));

	// The recorder reports the version it had installed; the suite reports the one it used.
	assert.match(
		live,
		/^reference runtime: .*\.runtime\/node_modules$/m,
		'the live transcript does not show the suite discovering .runtime, so it cannot certify oracle equivalence',
	);
	assert.equal(
		summary.referenceRuntime?.n8nWorkflow,
		golden.$runtimeVersion,
		'the captured runtime version is not the one the goldens were recorded from',
	);
	assert.equal(summary.referenceRuntime?.n8nCore, golden.$runtimeVersion);
	assert.doesNotMatch(live, /oracle equivalence NOT RUN/, 'the "live" transcript shows the oracle gate bailing out');

	assert.match(
		offline,
		/reference runtime: suppressed by ENGINE_NO_RUNTIME=1/,
		'the offline transcript did not suppress the oracle — "works without the runtime" would be unproven',
	);
	const notRun = (offline.match(/oracle equivalence NOT RUN/g) ?? []).length;
	assert.ok(notRun >= 6, `expected the offline transcript to record the oracle gate degrading on every test (saw ${notRun} of ~6)`);
	// The offline mode degrades host-dependent probes to "must raise" — say so in the
	// transcript, or a reader cannot tell which assertions were live-graded.
	assert.match(offline, /host-dependent probe/);
});

test('the recorded head is a real commit, not an invented sha', (t) => {
	if (bypassWhileRecording(t)) return;
	if (!summary) {
		assert.fail('no evidence/summary.json to audit — run: npm run verify:engine:evidence');
	}
	const head = summary.head ?? '';
	assert.match(head, /^[0-9a-f]{40}$/, `summary.head is not a full sha: ${head || '(empty)'}`);
	let inRepo = true;
	try {
		execFileSync('git', ['-C', REPO, 'rev-parse', '--git-dir'], { stdio: 'ignore' });
	} catch {
		inRepo = false;
	}
	if (!inRepo) {
		// Temp copies of the package (gate 07) and snapshot exports without .git land here:
		// the sha format check above still runs, only history lookup is skipped.
		t.diagnostic('not a git checkout — cannot look the recorded head up in history');
		return;
	}
	assert.doesNotThrow(
		() => execFileSync('git', ['-C', REPO, 'cat-file', '-e', `${head}^{commit}`], { stdio: 'ignore' }),
		`${head.slice(0, 8)} is not in this repo's history`,
	);
	// The transcripts are also stamped with a head; the two must agree or one was hand-made.
	for (const mode of ['live', 'offline']) {
		const match = /head: ([0-9a-f]{40})/.exec(readTranscript(mode));
		assert.equal(match?.[1], head, `${mode} transcript names a different head than summary.json`);
	}
});

test('evidence is committed, not scratch output', (t) => {
	// An evidence dir that is gitignored would let the lane claim green runs that nobody
	// else can see — the exact defect class this directory exists to prevent.
	const check = spawnSync('git', ['check-ignore', '-q', '--', 'packages/reconstructed-engine/evidence/summary.json'], {
		cwd: REPO,
		encoding: 'utf8',
	});
	// git exits 0 when the path IS ignored, 1 when it is not (and 128 outside a repo).
	if (check.status === 0) {
		assert.fail('evidence/ is gitignored — transcripts must be tracked to be citable');
	} else if (check.status !== 1) {
		t.diagnostic(`git check-ignore exited ${check.status} — cannot verify tracking state here`);
	}
});

function readTranscript(mode) {
	const rec = Object.values(summary.runs ?? {}).find((r) => r.transcript?.includes(mode));
	const path = rec ? join(PKG, rec.transcript) : null;
	assert.ok(path && existsSync(path), `no ${mode} transcript recorded`);
	return readFileSync(path, 'utf8');
}
