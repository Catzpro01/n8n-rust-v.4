/**
 * Gate 07 — the suite must be capable of failing.
 *
 * A green golden harness proves nothing until you have shown it goes red when the
 * port is wrong. So this test copies the package to a temp dir, introduces ONE
 * targeted defect into `src/`, re-runs the whole suite there, and requires a
 * failure. Each mutation is a bug an agent could plausibly write while "improving"
 * the port — including the ISSUE-016 pattern (present but inert), which is the one
 * a value-comparing test is worst at catching.
 *
 * The control case (an untouched copy) must PASS, otherwise every mutation "passes"
 * for environmental reasons and the whole gate is theatre.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PKG = resolve(import.meta.dirname, '..');

/**
 * Each entry: file, `from`/`to` line-blocks, and (where useful) why the defect is
 * plausible. Matching is whitespace-insensitive per line (see `replaceBlock`) so a
 * re-indent cannot silently turn this gate into a no-op; a zero-match or a
 * multi-match aborts the test instead.
 */
const MUTATIONS = [
	{
		name: 'binaryMode unwrap inverted',
		file: 'src/workflow-data-proxy.mjs',
		from: ["if (this.workflow.settings?.binaryMode !== BINARY_MODE_COMBINED) return data;"],
		to: ["if (this.workflow.settings?.binaryMode === BINARY_MODE_COMBINED) return data;"],
	},
	{
		name: 'context errors normalised instead of raised',
		file: 'src/workflow-data-proxy.mjs',
		from: ["return readNodeContext(this.runExecutionData, 'node', node);"],
		to: ["if (node === undefined) return {};", "return readNodeContext(this.runExecutionData, 'node', node);"],
		note: 'the REAL bug the goldens caught earlier in this task: swallowing the "node parameter has to be set" error',
	},
	{
		name: 'inert-pinData (ISSUE-016 pattern)',
		file: 'src/workflow-data-proxy.mjs',
		from: ['const pinData = getPinDataIfManualExecution(this.workflow, nodeName, this.mode);'],
		to: ['const pinData = undefined;'],
		note: 'the accessor still exists and still returns data — it just stops honouring pinned nodes, which a "did it throw?" test cannot see',
	},
	{
		name: 'default branchIndex shifted',
		file: 'src/workflow-data-proxy.mjs',
		from: ['that.workflow.getNodeConnectionIndexes(that.activeNodeName, nodeName)?.sourceIndex ?? 0;'],
		to: ['that.workflow.getNodeConnectionIndexes(that.activeNodeName, nodeName)?.sourceIndex ?? 1;'],
	},
	{
		name: 'metadata limit "fixed" to 20',
		file: 'src/execution-metadata.mjs',
		from: ['export const KV_LIMIT = 10;'],
		to: ['export const KV_LIMIT = 20;'],
	},
	{
		name: 'unsupported-version error swallowed',
		file: 'src/run-execution-data.mjs',
		from: ['throw new Error(`Unsupported IRunExecutionData version: ${data.version}`);'],
		to: ['data.version = 1; // migrated forward instead of refusing'],
	},
	{
		name: 'default error level downgraded to warning',
		file: 'src/errors.mjs',
		from: ["this.level = level ?? 'error';"],
		to: ["this.level = level ?? 'warning';"],
	},
	{
		name: 'BINARY_MODE_COMBINED literal typo',
		file: 'src/constants.mjs',
		from: ["export const BINARY_MODE_COMBINED = 'combined';"],
		to: ["export const BINARY_MODE_COMBINED = 'combine';"],
	},
	{
		name: '$secrets proxy accepts writes',
		file: 'src/get-secrets-proxy.mjs',
		from: [
			'set() {',
			'return false;',
			'},',
			'ownKeys() {',
			'return externalSecretsProxy.listProviders();',
			'},',
		],
		to: [
			'set(_t, _k, value) {',
			'externalSecretsProxy.injected = value;',
			'return true;',
			'},',
			'ownKeys() {',
			'return externalSecretsProxy.listProviders();',
			'},',
		],
		note: 'a workflow being able to write into the secrets bag is a security bug, not a style one',
	},
	{
		name: '$execution.mode mapping swapped',
		file: 'src/additional-keys.mjs',
		from: ["mode: mode === 'manual' ? 'test' : 'production',"],
		to: ["mode: mode === 'manual' ? 'production' : 'test',"],
	},
];

/** Files the mutants are judged by. Gate 07 itself is excluded (it would recurse). */
const SUITE = [
	'00-constants',
	'01-module-graph',
	'02-errors',
	'03-run-execution-data',
	'04-data-proxy-golden',
	'05-surface-coverage',
	'06-legacy-runner-regression',
]
	.map((n) => `test/${n}.test.mjs`)
	.filter((f) => existsSync(join(PKG, f)));

function replaceBlock(source, fromLines, toLines, label) {
	const src = source.split('\n');
	const norm = (lines) => lines.map((l) => l.trim());
	const hay = norm(src);
	const needle = norm(fromLines);
	const starts = [];
	for (let i = 0; i + needle.length <= hay.length; i++) {
		if (hay.slice(i, i + needle.length).every((line, j) => line === needle[j])) starts.push(i);
	}
	assert.equal(
		starts.length,
		1,
		`mutation "${label}": anchor matched ${starts.length} times in the file (expected exactly 1). A 0-match anchor would silently disable this gate, so it is an error, not a skip.`,
	);
	// Re-indent the inserted block to the anchor's own indentation: the point of the
	// gate is the mutated SEMANTICS, and prettier output keeps diffs readable if a
	// mutation ever has to be inspected by hand.
	const base = /^\s*/.exec(src[starts[0]])[0];
	const replacement = toLines.map((line) => `${base}${line.trim()}`);
	return [...src.slice(0, starts[0]), ...replacement, ...src.slice(starts[0] + needle.length)].join('\n');
}

const runSuite = (dir) => {
	// A nested `node --test` INSIDE a running test file inherits NODE_TEST_CONTEXT (and
	// NODE_OPTIONS) from the outer runner, and then reports nothing and exits 0 — which
	// reads as "the mutant passed" and silently turns this whole gate off. Strip them.
	const env = { ...process.env };
	delete env.NODE_TEST_CONTEXT;
	delete env.NODE_OPTIONS;
	env.LEGO_LIVE_RUNTIME ??= resolve(PKG, '..', '..', '.runtime');
	const result = spawnSync(process.execPath, ['--test', '--test-force-exit', ...SUITE], {
		cwd: dir,
		encoding: 'utf8',
		timeout: 600_000,
		env,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	if (result.error) throw result.error;
	if (!/# (tests|pass|fail)/.test(result.stdout ?? '')) {
		throw new Error(
			`the nested suite produced no TAP summary (exit ${result.status}); mutant output:\n${(result.stdout ?? '').slice(-500)}\n${(result.stderr ?? '').slice(-500)}`,
		);
	}
	return result;
};

const makeCopy = (t, name) => {
	const dir = mkdtempSync(join(tmpdir(), `engine-falsify-${name}-`));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	cpSync(PKG, dir, {
		recursive: true,
		filter: (src) => !/(^|\/)(node_modules|\.git)(\/|$)/.test(src),
	});
	return dir;
};

test('control: an untouched copy of the package passes the whole suite', (t) => {
	const dir = makeCopy(t, 'control');
	const result = runSuite(dir);
	assert.equal(
		result.status,
		0,
		`the suite is not green on its own (exit ${result.status}) — falsification would be meaningless:\n${result.stdout?.slice(-3000)}\n${result.stderr?.slice(-800)}`,
	);
});

for (const mutation of MUTATIONS) {
	test(`mutation "${mutation.name}" is caught by the suite`, (t) => {
		const dir = makeCopy(t, 'm');
		const file = join(dir, mutation.file);
		const source = readFileSync(file, 'utf8');
		const mutated = replaceBlock(source, mutation.from, mutation.to, mutation.name);
		assert.notEqual(mutated, source, `mutation "${mutation.name}" changed nothing`);
		writeFileSync(file, mutated);
		const result = runSuite(dir);
		assert.notEqual(
			result.status,
			0,
			`${mutation.name} produced NO failure — the suite does not cover this behaviour${mutation.note ? ` (${mutation.note})` : ''}. Extend fixtures/corpus.json and re-record, or record the gap in docs/isolation.`,
		);
		// The mutant must fail a real comparison, not crash on import: a syntax error
		// would make this test pass for the wrong reason.
		const output = `${result.stdout}${result.stderr}`;
		assert.doesNotMatch(
			output,
			/SyntaxError|ReferenceError|Cannot find module/,
			`the mutant crashed instead of failing a probe:\n${output.slice(-1500)}`,
		);
		assert.match(output, /not ok/, 'the mutant must report failing subtests');
	});
}
