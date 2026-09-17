/**
 * Captures runnable proof for POOL-002-R1's claims into packages/reconstructed-engine/evidence/.
 *
 * Why this exists: the task records and the isolation doc assert gate counts
 * ("96/96 live", "96/96 offline", "15/15 mutants caught"). This repo has already been
 * burned by result files whose claims nothing could reproduce (ISSUE-018), so instead of
 * prose this writes the transcripts, and `test/08-evidence` refuses to let them drift from
 * the artifacts they describe.
 *
 *   npm run verify:engine:evidence
 *
 * Refuses to record a red run — an evidence file that quietly contains a failure is worse
 * than no evidence file, because the next reader will not open it.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PKG = resolve(import.meta.dirname, '..', '..');
const REPO = resolve(PKG, '..', '..');
const EVIDENCE = join(PKG, 'evidence');
const RUNTIME = join(REPO, '.runtime', 'node_modules');

const MODES = [
	{
		name: 'live',
		file: 'POOL-002-R1-live.txt',
		command: 'bash scripts/run-engine-tests.sh',
		env: { LEGO_LIVE_RUNTIME: join(REPO, '.runtime') },
	},
	{
		name: 'offline',
		file: 'POOL-002-R1-offline.txt',
		command: 'ENGINE_NO_RUNTIME=1 ENGINE_ALLOW_NO_ORACLE=1 bash scripts/run-engine-tests.sh',
		env: { ENGINE_NO_RUNTIME: '1', ENGINE_ALLOW_NO_ORACLE: '1' },
	},
];

// What the transcripts are *about*: the recorded evidence and the surface manifest. `src/`
// is deliberately NOT hash-pinned here — behaviour freshness is the job of gates 04/07/10,
// and a transcript must not go stale because a comment was reworded. The src file LIST is
// recorded (below) so a renamed module still shows up as an inconsistency.
const WATCHED = [
	'fixtures/data-proxy.golden.json',
	'fixtures/corpus.json',
	'fixtures/reference-snapshot.json',
	'manifest/port-surface.json',
];
const VOLATILE_KEYS = ['$recordedAt', 'capturedAt', '$generatedAt', 'recordedAt'];

/** Timestamp-free content hash: re-recording the manifest must not invalidate evidence. */
function canonical(path) {
	const text = readFileSync(path, 'utf8');
	if (!path.endsWith('.json')) return text;
	const parsed = JSON.parse(text);
	for (const key of VOLATILE_KEYS) delete parsed[key];
	return JSON.stringify(parsed, null, 2);
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const git = (...args) => run1('git', ['-C', REPO, ...args]);
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function run(cmd, args, opts = {}) {
	const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: REPO, timeout: 1_800_000, ...opts });
	if (r.error) throw r.error;
	return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

/** git output is one value per line; keeping the newline produced a 41-char "sha". */
function run1(cmd, args) {
	return run(cmd, args).trim();
}

function summaryCounts(text) {
	const pick = (key) => Number(new RegExp(`^# ${key} (\\d+)$`, 'm').exec(text)?.[1] ?? NaN);
	return { tests: pick('tests'), pass: pick('pass'), fail: pick('fail'), skipped: pick('skipped') };
}

/**
 * Keep it auditable, not bloated: verdicts, counts and diagnostics — none of the
 * per-assertion YAML blocks. Node indents subtest diagnostics, so the pattern is
 * whitespace-tolerant; dropping those lines is what once made an evidence transcript
 * look like the offline run had graded nothing.
 */
function trimTranscript(text) {
	return text
		.split('\n')
		.filter((line) => /^\s*(ok \d+ - |not ok \d+ - |# |\s*# )/.test(line))
		.join('\n');
}

const head = git('rev-parse', 'HEAD');
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const versionOf = (pkg) => {
	try {
		return readJson(join(RUNTIME, pkg, 'package.json')).version;
	} catch {
		return null;
	}
};

const artifacts = Object.fromEntries(
	WATCHED.map((rel) => [
		rel,
		{ sha256: sha256(canonical(join(PKG, rel))), bytes: readFileSync(join(PKG, rel)).length, volatileKeysSkipped: VOLATILE_KEYS },
	]),
);


mkdirSync(EVIDENCE, { recursive: true });

const records = {};
let failed = [];
for (const mode of MODES) {
	console.log(`running ${mode.name} suite: ${mode.command}`);
	const out = run('bash', ['-c', mode.command], { env: { ...process.env, ...mode.env, ENGINE_EVIDENCE_RECORDER: '1' } });
	const counts = summaryCounts(out);
	const nonOk = out.split('\n').filter((l) => l.startsWith('not ok '));
	if (!Number.isFinite(counts.tests) || counts.tests === 0) {
		failed.push(`${mode.name}: no TAP summary in the output — the run itself is broken, refusing to record it`);
		continue;
	}
	if (counts.fail !== 0) {
		failed.push(`${mode.name}: ${counts.fail} failing test(s) — refusing to write evidence for a red run`);
		continue;
	}
	// What the SUITE saw, not what this process sees: in offline mode .runtime is on disk
	// but suppressed, and a header claiming the version would misreport the run.
	const seenRuntime = /^reference runtime: .*$/m.exec(out)?.[0] ?? 'reference runtime: (not reported)';
	const header = [
		`captured: ${new Date().toISOString()}`,
		`command: ${mode.command}`,
		`head: ${head}`,
		`branch: ${branch}`,
		`node: ${process.version}`,
		seenRuntime,
		`installed reference packages: n8n-workflow@${versionOf('n8n-workflow') ?? 'ABSENT'} n8n-core@${versionOf('n8n-core') ?? 'ABSENT'}`,
		'',
	].join('\n');
	writeFileSync(join(EVIDENCE, mode.file), `${header}\n${trimTranscript(out)}\n`);
	records[mode.name] = {
		transcript: `evidence/${mode.file}`,
		command: mode.command,
		counts,
		runtimeAsSeenBySuite: seenRuntime.replace('reference runtime: ', ''),
		notOk: nonOk,
	};
	console.log(`  ${mode.name}: # tests ${counts.tests} / pass ${counts.pass} / fail 0 / skipped ${counts.skipped}`);
}

if (failed.length) {
	console.error(`NOT RECORDED:\n${failed.map((f) => `  - ${f}`).join('\n')}`);
	process.exit(1);
}

writeFileSync(
	join(EVIDENCE, 'summary.json'),
	`${JSON.stringify(
		{
			$comment:
				'Machine-readable companion to the transcripts in this directory, produced by test/helpers/capture-evidence.mjs (npm run verify:engine:evidence). Transcripts hold verdict lines only; these counts are what test/08-evidence asserts. Re-run after ANY change to fixtures/ or src/ — the gate fails when the hashes here stop matching the tree, which is the point.',
			capturedAt: new Date().toISOString(),
			head,
			branch,
			node: process.version,
			referenceRuntime: { n8nWorkflow: versionOf('n8n-workflow'), n8nCore: versionOf('n8n-core') },
			artifacts,
			srcFiles: readdirSync(join(PKG, 'src'))
				.filter((f) => f.endsWith('.mjs'))
				.sort(),
			runs: records,
		},
		null,
		2,
	)}\n`,
);
writeFileSync(
	join(EVIDENCE, 'README.md'),
	`# Evidence transcripts

Produced by \`npm run verify:engine:evidence\` (root). Two modes, both required:

| file | what it proves |
|---|---|
| \`${MODES[0].file}\` | the whole suite plus the live-oracle gate, run against the installed n8n 2.9.1 reference |
| \`${MODES[1].file}\` | the same suite with the oracle suppressed (\`ENGINE_NO_RUNTIME=1\`), i.e. what a machine without \`.runtime\` actually sees |

\`summary.json\` carries the counts and the sha256 of the fixtures the transcripts describe;
\`test/08-evidence\` fails if those hashes drift, so a stale transcript cannot be quoted as
current proof. Nothing here is hand-editable evidence — regenerate, never rewrite.
`,
);
console.log(`wrote evidence/ (2 transcripts + summary.json + README.md) at head ${head.slice(0, 8)}`);
